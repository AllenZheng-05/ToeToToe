import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../src/data/store';
import {
  CLICK_TRACK,
  createHouseTrackSource,
  createLocalTrackSource,
  loopRegion,
  toThemeOffer,
  type TrackInfo,
} from '../../src/data/tracks';

const dir = join(process.cwd(), 'public', 'tracks');

describe('committed manifest', () => {
  const manifest: unknown = JSON.parse(readFileSync(join(dir, 'tracks.json'), 'utf8'));

  it('has three entries with the expected fields', () => {
    expect(Array.isArray(manifest)).toBe(true);
    const entries = manifest as Record<string, unknown>[];
    expect(entries).toHaveLength(3);
    for (const e of entries) {
      expect(e.title).toMatch(/^Placeholder: /);
      expect(e.firstBeatOffset).toBe(0);
      expect(typeof e.credit).toBe('string');
      expect(typeof e.licence).toBe('string');
    }
    expect(entries.map((e) => e.bpm)).toEqual([100, 126, 152]);
  });

  it('points at WAV files that exist with valid headers and sensible size', () => {
    for (const e of manifest as { file: string }[]) {
      const path = join(dir, e.file);
      expect(statSync(path).size).toBeLessThan(1.5 * 1024 * 1024);
      const b = readFileSync(path);
      expect(b.toString('ascii', 0, 4)).toBe('RIFF');
      expect(b.toString('ascii', 8, 12)).toBe('WAVE');
      expect(b.readUInt16LE(20)).toBe(1); // PCM
      expect(b.readUInt16LE(22)).toBe(1); // mono
      expect(b.readUInt32LE(24)).toBe(22050);
      expect(b.readUInt16LE(34)).toBe(16);
      expect(b.toString('ascii', 36, 40)).toBe('data');
      expect(b.readUInt32LE(40)).toBe(b.length - 44);
    }
  });

  it('is readable through the house source', async () => {
    const fetchFile = ((url: string) => {
      const name = url.split('/').pop() ?? '';
      const body = readFileSync(join(dir, decodeURIComponent(name)));
      return Promise.resolve(
        new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
      );
    }) as unknown as typeof fetch;
    const source = createHouseTrackSource({ baseUrl: '/', fetch: fetchFile });
    const list = await source.list();
    expect(list).toHaveLength(3);
    const first = list[0] as TrackInfo;
    const data = await source.load(first.id);
    expect(data.byteLength).toBeGreaterThan(1000);
  });
});

function fakeFetch(files: Record<string, string | ArrayBuffer>): typeof fetch {
  return ((url: string) => {
    const hit = files[url];
    if (hit === undefined) return Promise.resolve(new Response('missing', { status: 404 }));
    return Promise.resolve(new Response(hit, { status: 200 }));
  }) as unknown as typeof fetch;
}

describe('house track source', () => {
  const good = {
    id: 'a',
    title: 'A',
    file: 'a.wav',
    bpm: 120,
    firstBeatOffset: 0.1,
    credit: 'me',
    licence: 'CC0',
  };

  it('lists valid entries and drops malformed ones', async () => {
    const manifest = [
      good,
      null,
      'text',
      { ...good, id: '' },
      { ...good, id: 'nobpm', bpm: 'fast' },
      { ...good, id: 'neg', firstBeatOffset: -1 },
      { ...good, id: 'path', file: '../secret.wav' },
      { ...good, id: 'nofile', file: undefined },
      { ...good },
    ];
    const source = createHouseTrackSource({
      baseUrl: '/base/',
      fetch: fakeFetch({ '/base/tracks/tracks.json': JSON.stringify(manifest) }),
    });
    const list = await source.list();
    expect(list.map((t) => t.id)).toEqual(['a']);
    expect(list[0]).toMatchObject({
      source: 'house',
      bpm: 120,
      firstBeatOffset: 0.1,
      file: 'a.wav',
      credit: 'me',
    });
  });

  it('returns an empty list when the manifest is not an array', async () => {
    const source = createHouseTrackSource({
      baseUrl: '/',
      fetch: fakeFetch({ '/tracks/tracks.json': '{"a":1}' }),
    });
    expect(await source.list()).toEqual([]);
  });

  it('loads a file by id and rejects for unknown ids or failed fetches', async () => {
    const audio = new Uint8Array([1, 2, 3]).buffer;
    const source = createHouseTrackSource({
      baseUrl: '/',
      fetch: fakeFetch({ '/tracks/tracks.json': JSON.stringify([good]), '/tracks/a.wav': audio }),
    });
    expect(new Uint8Array(await source.load('a'))).toEqual(new Uint8Array([1, 2, 3]));
    await expect(source.load('zzz')).rejects.toThrow();

    const noFile = createHouseTrackSource({
      baseUrl: '/',
      fetch: fakeFetch({ '/tracks/tracks.json': JSON.stringify([good]) }),
    });
    await expect(noFile.load('a')).rejects.toThrow();
  });

  it('rejects list when the manifest fetch fails', async () => {
    const source = createHouseTrackSource({ baseUrl: '/', fetch: fakeFetch({}) });
    await expect(source.list()).rejects.toThrow();
  });
});

describe('local track source', () => {
  it('lists and loads uploaded songs', async () => {
    const store = createMemoryStore();
    const data = new Uint8Array([9, 8, 7]).buffer;
    await store.songs.put({
      id: 's1',
      title: 'Mine',
      mime: 'audio/mpeg',
      bytes: 3,
      hash: 'h1',
      data,
      bpm: 90,
      firstBeatOffset: 0.5,
      durationSec: 12,
      createdAt: 1,
    });
    const source = createLocalTrackSource(store);
    expect(await source.list()).toEqual([
      { id: 's1', source: 'upload', title: 'Mine', bpm: 90, firstBeatOffset: 0.5, hash: 'h1', bytes: 3 },
    ]);
    expect(new Uint8Array(await source.load('s1'))).toEqual(new Uint8Array([9, 8, 7]));
    await expect(source.load('nope')).rejects.toThrow();
  });
});

describe('loopRegion', () => {
  // 120 BPM, 8 beats per phrase: 4 s per phrase.
  it('uses an exact fit', () => {
    expect(loopRegion(16, 120, 0, 8)).toEqual({ loopStart: 0, loopEnd: 16 });
  });

  it('drops the remainder', () => {
    expect(loopRegion(18.5, 120, 0, 8)).toEqual({ loopStart: 0, loopEnd: 16 });
  });

  it('applies the first beat offset', () => {
    const r = loopRegion(17, 120, 1.5, 8);
    expect(r.loopStart).toBe(1.5);
    expect(r.loopEnd).toBeCloseTo(13.5, 9); // 15.5 s available: three phrases
  });

  it('returns one phrase for a short song', () => {
    expect(loopRegion(2, 120, 0, 8)).toEqual({ loopStart: 0, loopEnd: 4 });
    expect(loopRegion(0.5, 120, 1, 8)).toEqual({ loopStart: 1, loopEnd: 5 });
  });
});

describe('toThemeOffer', () => {
  it('maps a house track without optional fields', () => {
    const info: TrackInfo = {
      id: 'h',
      source: 'house',
      title: 'H',
      bpm: 100,
      firstBeatOffset: 0,
      file: 'h.wav',
    };
    expect(toThemeOffer(info)).toEqual({
      source: 'house',
      id: 'h',
      title: 'H',
      bpm: 100,
      firstBeatOffset: 0,
    });
  });

  it('carries hash and bytes for uploads', () => {
    const info: TrackInfo = {
      id: 'u',
      source: 'upload',
      title: 'U',
      bpm: 90,
      firstBeatOffset: 0.2,
      hash: 'abc',
      bytes: 42,
    };
    expect(toThemeOffer(info)).toEqual({
      source: 'upload',
      id: 'u',
      title: 'U',
      bpm: 90,
      firstBeatOffset: 0.2,
      hash: 'abc',
      bytes: 42,
    });
  });

  it('describes the click track', () => {
    expect(toThemeOffer(CLICK_TRACK).source).toBe('click');
    expect(CLICK_TRACK.bpm).toBe(120);
  });
});
