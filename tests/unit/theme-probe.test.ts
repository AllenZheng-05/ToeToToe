import { describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/engine';
import { DEFAULT_TUNABLES } from '../../src/core/tunables';
import type { ThemeOffer } from '../../src/core/types';
import { sha256Hex } from '../../src/data/songFile';
import { createMemoryStore } from '../../src/data/store';
import {
  loadOfferedSong,
  probeSongDuration,
  withBeat,
  type LoadedTheme,
  type ThemeDeps,
} from '../../src/theme/theme';

function wav(): ArrayBuffer {
  const b = new Uint8Array(64);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
  return b.buffer;
}

function setup(decodedSeconds: number, probe?: ThemeDeps['probeDuration']) {
  let decodes = 0;
  const engine = {
    context: { sampleRate: 8000 },
    decode: () => {
      decodes++;
      return Promise.resolve({ duration: decodedSeconds } as AudioBuffer);
    },
  } as unknown as AudioEngine;
  const deps: ThemeDeps = {
    store: createMemoryStore(),
    engine,
    tunables: { ...DEFAULT_TUNABLES },
    ...(probe ? { probeDuration: probe } : {}),
  };
  return { deps, decodes: () => decodes };
}

async function offerFor(data: ArrayBuffer): Promise<ThemeOffer> {
  return {
    source: 'upload',
    id: 'song-1',
    title: 'Song',
    bpm: 120,
    firstBeatOffset: 0.1,
    hash: await sha256Hex(data),
    bytes: data.byteLength,
  };
}

describe('song length before decoding', () => {
  it('refuses a long song from its metadata without decoding it', async () => {
    const data = wav();
    const { deps, decodes } = setup(30, () => Promise.resolve(900));
    await expect(loadOfferedSong(await offerFor(data), data, deps)).rejects.toThrow(/six minutes/);
    expect(decodes()).toBe(0);
  });

  it('asks the probe with the sniffed type of the file', async () => {
    const data = wav();
    const asked: string[] = [];
    const { deps } = setup(30, (_d, mime) => {
      asked.push(mime);
      return Promise.resolve(30);
    });
    await loadOfferedSong(await offerFor(data), data, deps);
    expect(asked).toEqual(['audio/wav']);
  });

  it('decodes a song the metadata says is short enough', async () => {
    const data = wav();
    const { deps, decodes } = setup(30, () => Promise.resolve(30));
    const theme = await loadOfferedSong(await offerFor(data), data, deps);
    expect(theme.info.hash).toBeDefined();
    expect(decodes()).toBe(1);
  });

  it('falls back to decoding and checking afterwards when the length cannot be read', async () => {
    const data = wav();
    for (const probe of [
      () => Promise.resolve(null),
      () => Promise.reject(new Error('no metadata')),
    ] as ThemeDeps['probeDuration'][]) {
      const long = setup(900, probe);
      await expect(loadOfferedSong(await offerFor(data), data, long.deps)).rejects.toThrow(/six minutes/);
      expect(long.decodes()).toBe(1);
      const short = setup(30, probe);
      await expect(loadOfferedSong(await offerFor(data), data, short.deps)).resolves.toBeDefined();
    }
  });

  it('the default probe gives up quietly where there is no audio element', async () => {
    await expect(probeSongDuration(wav(), 'audio/wav')).resolves.toBeNull();
  });
});

describe('withBeat', () => {
  it('moves the loop region with the beat and keeps the audio', () => {
    const theme: LoadedTheme = {
      info: { id: 'a', source: 'house', title: 'A', bpm: 100, firstBeatOffset: 0 },
      buffer: { duration: 60 } as AudioBuffer,
      loopStart: 0,
      loopEnd: 58,
      file: null,
    };
    const next = withBeat(theme, { bpm: 150, firstBeatOffset: 0.5 }, { ...DEFAULT_TUNABLES });
    expect(next.buffer).toBe(theme.buffer);
    expect(next.info).toMatchObject({ bpm: 150, firstBeatOffset: 0.5 });
    expect(next.loopStart).toBe(0.5);
  });
});
