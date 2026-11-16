import { describe, expect, it } from 'vitest';
import {
  checkSongBytes,
  checkSongDuration,
  mimeForSongType,
  SONG_LIMITS,
  sha256Hex,
  sniffSongType,
  songRejectionMessage,
  type SongRejection,
} from '../../src/data/songFile';

const enc = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const bytes = (...parts: number[][]): Uint8Array => new Uint8Array(parts.flat());
const zeros = (n: number): number[] => new Array<number>(n).fill(0);

describe('sniffSongType', () => {
  it('recognises each container', () => {
    expect(sniffSongType(bytes(enc('ID3'), [4, 0, 0, 0]))).toBe('mp3');
    expect(sniffSongType(bytes([0xff, 0xfb, 0x90, 0x00]))).toBe('mp3');
    expect(sniffSongType(bytes(enc('OggS'), zeros(8)))).toBe('ogg');
    expect(sniffSongType(bytes(enc('RIFF'), zeros(4), enc('WAVE')))).toBe('wav');
    expect(sniffSongType(bytes(zeros(3), [0x20], enc('ftypM4A '), zeros(4)))).toBe('m4a');
  });

  it('accepts isom and mp42 brands as m4a', () => {
    expect(sniffSongType(bytes([0, 0, 0, 0x18], enc('ftypisom'), zeros(4)))).toBe('m4a');
    expect(sniffSongType(bytes([0, 0, 0, 0x18], enc('ftypmp42'), zeros(4)))).toBe('m4a');
  });

  it('rejects other things', () => {
    expect(sniffSongType(bytes([0x89], enc('PNG'), [0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(sniffSongType(bytes(enc('hello, this is text')))).toBeNull();
    expect(sniffSongType(new Uint8Array(0))).toBeNull();
    expect(sniffSongType(bytes(enc('RIFF'), zeros(4), enc('AVI ')))).toBeNull();
    expect(sniffSongType(bytes([0, 0, 0, 0x18], enc('ftypheic'), zeros(4)))).toBeNull();
  });
});

describe('mimeForSongType', () => {
  it('maps every type', () => {
    for (const t of SONG_LIMITS.types) expect(mimeForSongType(t)).toMatch(/^audio\//);
  });
});

describe('checkSongBytes', () => {
  const withHeader = (size: number, header: number[]): ArrayBuffer => {
    const u = new Uint8Array(size);
    u.set(header);
    return u.buffer;
  };

  it('accepts a file exactly at the limit and rejects one byte over', () => {
    const header = enc('OggS');
    expect(checkSongBytes(withHeader(SONG_LIMITS.maxBytes, header))).toEqual({ ok: true, type: 'ogg' });
    expect(checkSongBytes(withHeader(SONG_LIMITS.maxBytes + 1, header))).toEqual({
      ok: false,
      reason: 'size',
    });
  });

  it('rejects an unknown type', () => {
    expect(checkSongBytes(withHeader(100, enc('nope')))).toEqual({ ok: false, reason: 'type' });
    expect(checkSongBytes(new ArrayBuffer(0))).toEqual({ ok: false, reason: 'type' });
  });
});

describe('checkSongDuration', () => {
  it('allows up to six minutes', () => {
    expect(checkSongDuration(360)).toEqual({ ok: true });
    expect(checkSongDuration(360.01)).toEqual({ ok: false, reason: 'length' });
  });
});

describe('songRejectionMessage', () => {
  it('gives plain sentences', () => {
    const all: SongRejection[] = ['type', 'size', 'length', 'decode'];
    for (const r of all) {
      const m = songRejectionMessage(r);
      expect(m.length).toBeGreaterThan(10);
      expect(m).toMatch(/^[A-Z].*\.$/);
    }
    expect(songRejectionMessage('size')).toBe('That song is over 10 MB.');
  });
});

describe('sha256Hex', () => {
  it('hashes known inputs', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc').buffer)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await sha256Hex(new ArrayBuffer(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
