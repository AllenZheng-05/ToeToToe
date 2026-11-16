import type { ThemeOffer } from '../core/types';
import type { Store } from './store';

export interface TrackInfo {
  id: string;
  source: 'house' | 'upload' | 'click';
  title: string;
  bpm: number;
  firstBeatOffset: number;
  credit?: string;
  licence?: string;
  /** House tracks: file name inside public/tracks/. */
  file?: string;
  hash?: string;
  bytes?: number;
}

export interface TrackSource {
  list(): Promise<TrackInfo[]>;
  /** The encoded audio file. Rejects if the id is unknown or the fetch fails. */
  load(id: string): Promise<ArrayBuffer>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseHouseEntry(raw: unknown): TrackInfo | null {
  if (!isRecord(raw)) return null;
  const { id, title, file, bpm, firstBeatOffset, credit, licence } = raw;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof title !== 'string' || title === '') return null;
  // Plain file name only: no path separators, so a manifest cannot point outside public/tracks/.
  if (typeof file !== 'string' || file === '' || /[\\/]|\.\./.test(file)) return null;
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < 30 || bpm > 300) return null;
  if (typeof firstBeatOffset !== 'number' || !Number.isFinite(firstBeatOffset) || firstBeatOffset < 0) {
    return null;
  }
  const info: TrackInfo = { id, source: 'house', title, bpm, firstBeatOffset, file };
  if (typeof credit === 'string') info.credit = credit;
  if (typeof licence === 'string') info.licence = licence;
  return info;
}

/** Reads `${baseUrl}tracks/tracks.json` with an injectable fetch; validates each entry and drops bad ones. */
export function createHouseTrackSource(opts?: { baseUrl?: string; fetch?: typeof fetch }): TrackSource {
  const baseUrl = opts?.baseUrl ?? import.meta.env.BASE_URL;
  const doFetch = opts?.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const dir = `${baseUrl}tracks/`;

  const list = async (): Promise<TrackInfo[]> => {
    const res = await doFetch(`${dir}tracks.json`);
    if (!res.ok) throw new Error(`Could not load the track list (${res.status})`);
    const json: unknown = await res.json();
    if (!Array.isArray(json)) return [];
    const seen = new Set<string>();
    const out: TrackInfo[] = [];
    for (const raw of json) {
      const info = parseHouseEntry(raw);
      if (info && !seen.has(info.id)) {
        seen.add(info.id);
        out.push(info);
      }
    }
    return out;
  };

  return {
    list,
    async load(id) {
      const info = (await list()).find((t) => t.id === id);
      if (!info?.file) throw new Error(`Unknown track: ${id}`);
      const res = await doFetch(`${dir}${encodeURIComponent(info.file)}`);
      if (!res.ok) throw new Error(`Could not load track ${id} (${res.status})`);
      return res.arrayBuffer();
    },
  };
}

/** Uploaded songs kept in the Store. */
export function createLocalTrackSource(store: Store): TrackSource {
  return {
    async list() {
      const songs = await store.songs.list();
      return songs.map((s): TrackInfo => ({
        id: s.id,
        source: 'upload',
        title: s.title,
        bpm: s.bpm,
        firstBeatOffset: s.firstBeatOffset,
        hash: s.hash,
        bytes: s.bytes,
      }));
    },
    async load(id) {
      const song = await store.songs.get(id);
      if (!song) throw new Error(`Unknown song: ${id}`);
      return song.data;
    },
  };
}

/** The always-available generated click track. Synthesised, not loaded. */
export const CLICK_TRACK: TrackInfo = {
  id: 'click-120',
  source: 'click',
  title: 'Click track (120)',
  bpm: 120,
  firstBeatOffset: 0,
};

export function toThemeOffer(info: TrackInfo): ThemeOffer {
  const offer: ThemeOffer = {
    source: info.source,
    id: info.id,
    title: info.title,
    bpm: info.bpm,
    firstBeatOffset: info.firstBeatOffset,
  };
  if (info.hash !== undefined) offer.hash = info.hash;
  if (info.bytes !== undefined) offer.bytes = info.bytes;
  return offer;
}

/** Loop region covering the largest whole number of phrases that fits after the first beat; at least one phrase. */
export function loopRegion(
  durationSec: number,
  bpm: number,
  firstBeatOffset: number,
  beatsPerPhrase: number,
): { loopStart: number; loopEnd: number } {
  const phraseSec = (beatsPerPhrase * 60) / bpm;
  const available = Math.max(0, durationSec - firstBeatOffset);
  // Small epsilon so an exact fit is not lost to floating point error.
  const phrases = Math.max(1, Math.floor(available / phraseSec + 1e-9));
  return { loopStart: firstBeatOffset, loopEnd: firstBeatOffset + phrases * phraseSec };
}
