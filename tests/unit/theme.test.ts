import { describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/engine';
import { DEFAULT_TUNABLES } from '../../src/core/tunables';
import type { ThemeOffer } from '../../src/core/types';
import { sha256Hex } from '../../src/data/songFile';
import { SETTINGS, createMemoryStore } from '../../src/data/store';
import { CLICK_TRACK } from '../../src/data/tracks';
import { loadOfferedSong, loadSelectedTheme, type ThemeDeps } from '../../src/theme/theme';

const t = { ...DEFAULT_TUNABLES };

function fakeBuffer(duration: number): AudioBuffer {
  return {
    duration,
    length: Math.floor(duration * 8000),
    sampleRate: 8000,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(8),
    copyToChannel: () => undefined,
  } as unknown as AudioBuffer;
}

function engine(duration: number, fail = false): AudioEngine {
  return {
    context: { sampleRate: 8000, createBuffer: (_c: number, len: number) => fakeBuffer(len / 8000) },
    decode: () => (fail ? Promise.reject(new Error('bad')) : Promise.resolve(fakeBuffer(duration))),
  } as unknown as AudioEngine;
}

function wav(): ArrayBuffer {
  const b = new Uint8Array(64);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
  return b.buffer;
}

async function offerFor(data: ArrayBuffer, over: Partial<ThemeOffer> = {}): Promise<ThemeOffer> {
  return {
    source: 'upload',
    id: 'song-1',
    title: 'Song',
    bpm: 120,
    firstBeatOffset: 0.1,
    hash: await sha256Hex(data),
    bytes: data.byteLength,
    ...over,
  };
}

function deps(duration: number, fail = false): ThemeDeps {
  return {
    store: createMemoryStore(),
    engine: engine(duration, fail),
    tunables: t,
    house: {
      list: () => Promise.reject(new Error('offline')),
      load: () => Promise.reject(new Error('offline')),
    },
  };
}

describe('loadOfferedSong', () => {
  it('accepts good bytes with the matching hash', async () => {
    const data = wav();
    const theme = await loadOfferedSong(await offerFor(data), data, deps(30));
    expect(theme.info.source).toBe('upload');
    expect(theme.file?.mime).toBe('audio/wav');
    expect(theme.loopStart).toBeCloseTo(0.1);
    expect(theme.loopEnd).toBeGreaterThan(theme.loopStart);
  });

  it('rejects bytes that are not a song type', async () => {
    const data = new Uint8Array(64).buffer;
    await expect(loadOfferedSong(await offerFor(data), data, deps(30))).rejects.toThrow(/not an MP3/);
  });

  it('rejects bytes that will not decode', async () => {
    const data = wav();
    await expect(loadOfferedSong(await offerFor(data), data, deps(30, true))).rejects.toThrow(
      /could not be read/,
    );
  });

  it('rejects the wrong hash', async () => {
    const data = wav();
    const offer = await offerFor(data, { hash: 'ab'.repeat(32) });
    await expect(loadOfferedSong(offer, data, deps(30))).rejects.toThrow(/intact/);
  });

  it('rejects a song over six minutes', async () => {
    const data = wav();
    await expect(loadOfferedSong(await offerFor(data), data, deps(361))).rejects.toThrow(/six minutes/);
  });

  it('rejects a song over 10 MB', async () => {
    const data = new Uint8Array(10 * 1024 * 1024 + 1);
    data.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    await expect(loadOfferedSong(await offerFor(data.buffer), data.buffer, deps(30))).rejects.toThrow(
      /10 MB/,
    );
  });

  it('rejects an offer with a nonsense tempo', async () => {
    const data = wav();
    await expect(loadOfferedSong(await offerFor(data, { bpm: 9000 }), data, deps(30))).rejects.toThrow(
      /offer/,
    );
  });
});

describe('loadSelectedTheme', () => {
  it('falls back to the click track when the setting names a missing song', async () => {
    const d = deps(30);
    await d.store.settings.set(SETTINGS.selectedThemeId, 'gone');
    const theme = await loadSelectedTheme(d);
    expect(theme.info.id).toBe(CLICK_TRACK.id);
    expect(theme.file).toBeNull();
    expect(theme.loopStart).toBe(0);
    expect(theme.loopEnd).toBeCloseTo(8);
  });

  it('falls back to the click track when the stored song will not decode', async () => {
    const d = deps(30, true);
    await d.store.songs.put({
      id: 'mine',
      title: 'Mine',
      mime: 'audio/wav',
      bytes: 64,
      hash: 'x',
      data: wav(),
      bpm: 120,
      firstBeatOffset: 0,
      durationSec: 30,
      createdAt: 1,
    });
    await d.store.settings.set(SETTINGS.selectedThemeId, 'mine');
    expect((await loadSelectedTheme(d)).info.id).toBe(CLICK_TRACK.id);
  });

  it('loads a stored song that is selected', async () => {
    const d = deps(30);
    await d.store.songs.put({
      id: 'mine',
      title: 'Mine',
      mime: 'audio/wav',
      bytes: 64,
      hash: 'x',
      data: wav(),
      bpm: 100,
      firstBeatOffset: 0.2,
      durationSec: 30,
      createdAt: 1,
    });
    await d.store.settings.set(SETTINGS.selectedThemeId, 'mine');
    const theme = await loadSelectedTheme(d);
    expect(theme.info.id).toBe('mine');
    expect(theme.file?.data.byteLength).toBe(64);
  });

  it('uses the click track when nothing is selected', async () => {
    expect((await loadSelectedTheme(deps(30))).info.id).toBe(CLICK_TRACK.id);
  });
});
