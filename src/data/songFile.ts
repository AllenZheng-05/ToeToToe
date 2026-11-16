export const SONG_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxSeconds: 6 * 60,
  /** Accepted container types. */
  types: ['mp3', 'ogg', 'wav', 'm4a'] as const,
};

export type SongType = (typeof SONG_LIMITS.types)[number];

const M4A_BRANDS = new Set(['M4A ', 'M4B ', 'isom', 'iso2', 'mp41', 'mp42', 'MSNV', 'dash']);

function ascii(b: Uint8Array, from: number, len: number): string {
  let s = '';
  for (let i = from; i < from + len; i++) s += String.fromCharCode(b[i] ?? 0);
  return s;
}

/** Looks at the first bytes only. Returns null when unrecognised. */
export function sniffSongType(bytes: Uint8Array): SongType | null {
  if (bytes.length < 4) return null;
  if (ascii(bytes, 0, 3) === 'ID3') return 'mp3';
  if (ascii(bytes, 0, 4) === 'OggS') return 'ogg';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'wav';
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp' && M4A_BRANDS.has(ascii(bytes, 8, 4))) return 'm4a';
  // MPEG audio frame sync: 11 set bits, version not reserved, layer not reserved.
  const b0 = bytes[0] ?? 0;
  const b1 = bytes[1] ?? 0;
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0 && (b1 & 0x18) !== 0x08 && (b1 & 0x06) !== 0) return 'mp3';
  return null;
}

export function mimeForSongType(t: SongType): string {
  switch (t) {
    case 'mp3':
      return 'audio/mpeg';
    case 'ogg':
      return 'audio/ogg';
    case 'wav':
      return 'audio/wav';
    case 'm4a':
      return 'audio/mp4';
  }
}

export type SongRejection = 'type' | 'size' | 'length' | 'decode';

export function songRejectionMessage(r: SongRejection): string {
  switch (r) {
    case 'type':
      return 'That file is not an MP3, OGG, WAV or M4A.';
    case 'size':
      return 'That song is over 10 MB.';
    case 'length':
      return 'That song is longer than six minutes.';
    case 'decode':
      return 'That file could not be read as audio.';
  }
}

/** Size and sniffed type. Does not decode. */
export function checkSongBytes(
  data: ArrayBuffer,
): { ok: true; type: SongType } | { ok: false; reason: 'type' | 'size' } {
  if (data.byteLength > SONG_LIMITS.maxBytes) return { ok: false, reason: 'size' };
  const type = sniffSongType(new Uint8Array(data, 0, Math.min(data.byteLength, 16)));
  if (!type) return { ok: false, reason: 'type' };
  return { ok: true, type };
}

export function checkSongDuration(durationSec: number): { ok: true } | { ok: false; reason: 'length' } {
  return durationSec > SONG_LIMITS.maxSeconds ? { ok: false, reason: 'length' } : { ok: true };
}

/** SHA-256 hex with crypto.subtle. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
