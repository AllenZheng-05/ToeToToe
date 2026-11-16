import type { AudioEngine, PlayHandle } from '../audio/engine';
import { clickLoopSeconds, createClickBuffer } from '../audio/click';
import { themeBeatOk } from '../core/tunables';
import type { Tunables, ThemeOffer } from '../core/types';
import {
  checkSongBytes,
  checkSongDuration,
  mimeForSongType,
  sha256Hex,
  songRejectionMessage,
  type SongRejection,
  type SongType,
} from '../data/songFile';
import { SETTINGS, type Store } from '../data/store';
import {
  CLICK_TRACK,
  createHouseTrackSource,
  createLocalTrackSource,
  loopRegion,
  type TrackInfo,
  type TrackSource,
} from '../data/tracks';

export interface LoadedTheme {
  /** Source, id, title, bpm (as set by the player), firstBeatOffset, hash/bytes for uploads. */
  info: TrackInfo;
  /** Decoded (or synthesised for the click track). */
  buffer: AudioBuffer;
  /** Loop region in buffer seconds: whole phrases after the first beat. For the click track, its exact loop. */
  loopStart: number;
  loopEnd: number;
  /** The encoded file for sending to the other player; null for house tracks and the click track. */
  file: { data: ArrayBuffer; mime: string } | null;
}

export interface ThemeDeps {
  store: Store;
  engine: AudioEngine;
  tunables: Tunables;
  house?: TrackSource;
  /** Reads a song's length from its metadata without decoding it. Null when unknown. Defaults to an audio element. */
  probeDuration?: (data: ArrayBuffer, mime: string) => Promise<number | null>;
}

/** How long to wait for an audio element to report a song's length before decoding it anyway. */
const PROBE_TIMEOUT_MS = 4000;

/**
 * The song's length from an audio element's metadata (preload = 'metadata' on a Blob URL, revoked afterwards),
 * so a very long file is refused before its decoded samples (hundreds of MB) are ever made.
 * Null when the browser cannot say within a few seconds; the caller then decodes and checks the length after.
 */
export function probeSongDuration(data: ArrayBuffer, mime: string): Promise<number | null> {
  if (
    typeof Audio === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let url: string | null = null;
    const audio = new Audio();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const finish = (duration: number | null): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      audio.removeAttribute('src');
      audio.load();
      if (url !== null) URL.revokeObjectURL(url);
      resolve(duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null);
    };
    try {
      url = URL.createObjectURL(new Blob([data], { type: mime }));
      audio.preload = 'metadata';
      audio.addEventListener('loadedmetadata', () => finish(audio.duration), { once: true });
      audio.addEventListener('error', () => finish(null), { once: true });
      timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
      audio.src = url;
    } catch {
      finish(null);
    }
  });
}

/** Error with the rejection reason attached; the message is the plain text for the player. */
export class ThemeError extends Error {
  constructor(
    message: string,
    readonly reason?: SongRejection,
  ) {
    super(message);
    this.name = 'ThemeError';
  }
}

const CLICK_BEATS = 16;

function rejection(reason: SongRejection): ThemeError {
  return new ThemeError(songRejectionMessage(reason), reason);
}

function clickTheme(info: TrackInfo, deps: ThemeDeps): LoadedTheme {
  const buffer = createClickBuffer(deps.engine.context, info.bpm, CLICK_BEATS);
  return {
    info,
    buffer,
    loopStart: 0,
    loopEnd: clickLoopSeconds({ bpm: info.bpm, beats: CLICK_BEATS }),
    file: null,
  };
}

/** The same theme with a new tempo / first beat: the loop region follows the beat. */
export function withBeat(
  theme: LoadedTheme,
  beat: { bpm: number; firstBeatOffset: number },
  tunables: Tunables,
): LoadedTheme {
  const info = { ...theme.info, bpm: beat.bpm, firstBeatOffset: beat.firstBeatOffset };
  if (info.source === 'click') return { ...theme, info };
  const { loopStart, loopEnd } = loopRegion(
    theme.buffer.duration,
    info.bpm,
    info.firstBeatOffset,
    tunables.beatsPerPhrase,
  );
  return { ...theme, info, loopStart, loopEnd };
}

async function decodeChecked(
  data: ArrayBuffer,
  engine: AudioEngine,
  probe: ThemeDeps['probeDuration'] = probeSongDuration,
): Promise<{ buffer: AudioBuffer; type: SongType }> {
  const checked = checkSongBytes(data);
  if (!checked.ok) throw rejection(checked.reason);
  // Length first, from the metadata alone; when that cannot be read, decode and check afterwards.
  const probed = await probe(data, mimeForSongType(checked.type)).catch((): null => null);
  if (probed !== null) {
    const early = checkSongDuration(probed);
    if (!early.ok) throw rejection(early.reason);
  }
  let buffer: AudioBuffer;
  try {
    // decodeAudioData detaches the array it is given; decode a copy.
    buffer = await engine.decode(data.slice(0));
  } catch {
    throw rejection('decode');
  }
  const long = checkSongDuration(buffer.duration);
  if (!long.ok) throw rejection(long.reason);
  return { buffer, type: checked.type };
}

/** Resolve a TrackInfo to something playable. Rejects with a ThemeError (plain message) on failure. */
export async function loadTheme(info: TrackInfo, deps: ThemeDeps): Promise<LoadedTheme> {
  if (info.source === 'click') return clickTheme(info, deps);
  const source =
    info.source === 'house' ? (deps.house ?? createHouseTrackSource()) : createLocalTrackSource(deps.store);
  let data: ArrayBuffer;
  try {
    data = await source.load(info.id);
  } catch {
    throw new ThemeError('That song could not be loaded.');
  }
  const { buffer, type } = await decodeChecked(data, deps.engine, deps.probeDuration);
  const { loopStart, loopEnd } = loopRegion(
    buffer.duration,
    info.bpm,
    info.firstBeatOffset,
    deps.tunables.beatsPerPhrase,
  );
  return {
    info,
    buffer,
    loopStart,
    loopEnd,
    file: info.source === 'upload' ? { data, mime: mimeForSongType(type) } : null,
  };
}

/** The theme named by `selectedThemeId`, falling back to the click track if it is missing or fails to load. Never rejects. */
export async function loadSelectedTheme(deps: ThemeDeps): Promise<LoadedTheme> {
  try {
    const id = await deps.store.settings.get<string>(SETTINGS.selectedThemeId, CLICK_TRACK.id);
    if (id !== CLICK_TRACK.id) {
      let info: TrackInfo | undefined;
      try {
        info = (await createLocalTrackSource(deps.store).list()).find((t) => t.id === id);
      } catch {
        /* fall through to the house list */
      }
      if (!info) {
        try {
          info = (await (deps.house ?? createHouseTrackSource()).list()).find((t) => t.id === id);
        } catch {
          /* no house list */
        }
      }
      if (info) return await loadTheme(info, deps);
    }
  } catch {
    /* fall back to the click track */
  }
  return clickTheme(CLICK_TRACK, deps);
}

function validOffer(o: ThemeOffer, t: Tunables): boolean {
  return (
    o.source === 'upload' &&
    typeof o.id === 'string' &&
    typeof o.title === 'string' &&
    typeof o.hash === 'string' &&
    themeBeatOk('upload', o.bpm, o.firstBeatOffset, t)
  );
}

/**
 * Decode and load a song received from the other player (untrusted bytes): type and size, decode, length,
 * and the SHA-256 must equal `offer.hash`. Rejects with a plain message otherwise.
 */
export async function loadOfferedSong(
  offer: ThemeOffer,
  data: ArrayBuffer,
  deps: ThemeDeps,
): Promise<LoadedTheme> {
  if (!validOffer(offer, deps.tunables)) throw new ThemeError('That song offer is not valid.');
  const { buffer, type } = await decodeChecked(data, deps.engine, deps.probeDuration);
  const hash = await sha256Hex(data);
  if (hash !== offer.hash) throw new ThemeError('The song did not arrive intact.');
  const info: TrackInfo = {
    id: offer.id,
    source: 'upload',
    title: offer.title.slice(0, 80),
    bpm: offer.bpm,
    firstBeatOffset: offer.firstBeatOffset,
    hash,
    bytes: data.byteLength,
  };
  const { loopStart, loopEnd } = loopRegion(
    buffer.duration,
    info.bpm,
    info.firstBeatOffset,
    deps.tunables.beatsPerPhrase,
  );
  return { info, buffer, loopStart, loopEnd, file: { data, mime: mimeForSongType(type) } };
}

/** Start a LoadedTheme so that its first beat is heard at clock time `startTime`, looping over the loop region. */
export function playTheme(theme: LoadedTheme, engine: AudioEngine, startTime: number): PlayHandle {
  return engine.playLoop(theme.buffer, {
    startTime,
    offset: theme.info.source === 'click' ? 0 : theme.info.firstBeatOffset,
    loopStart: theme.loopStart,
    loopEnd: theme.loopEnd,
  });
}
