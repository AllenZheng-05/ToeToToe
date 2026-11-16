/** Theatre-flavoured three-letter words used as the first part of a room code. */
const WORDS: readonly string[] = [
  'ROW',
  'BOX',
  'BOW',
  'CUE',
  'ACT',
  'WIG',
  'HAT',
  'FAN',
  'MIC',
  'SET',
  'PIT',
  'LAP',
  'JIG',
  'GAG',
  'HAM',
  'AWE',
  'ART',
  'BAT',
  'BIT',
  'CAP',
  'DYE',
  'DUO',
  'FLY',
  'GEL',
  'HUE',
  'INK',
  'JAM',
  'KEY',
  'LEG',
  'LIT',
  'MAP',
  'MUG',
  'NET',
  'OAR',
  'OWL',
  'PAD',
  'PEG',
  'PEN',
  'PIN',
  'PLY',
  'POP',
  'PRO',
  'RAG',
  'RED',
  'RIG',
  'ROD',
  'RUG',
  'SAW',
  'SKY',
  'SUN',
  'TAB',
  'TAP',
  'TIP',
  'TOE',
  'TOP',
  'URN',
  'VAN',
  'WAX',
  'WEB',
  'YAM',
  'ZIP',
  'FOG',
  'FUN',
  'GIG',
  'JOY',
  'LAW',
  'SIP',
];

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O
const CODE_RE = /^([A-Z]{3})[\s-]*([A-HJ-NP-Z])[\s-]*(\d{2})$/;

function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  do {
    crypto.getRandomValues(buf);
  } while ((buf[0] as number) >= limit);
  return (buf[0] as number) % max;
}

/** Three short parts, e.g. "ROW-G-12". Uses crypto.getRandomValues. */
export function generateRoomCode(): string {
  const word = WORDS[randomInt(WORDS.length)] as string;
  const letter = LETTERS[randomInt(LETTERS.length)] as string;
  const digits = String(randomInt(100)).padStart(2, '0');
  return `${word}-${letter}-${digits}`;
}

/** Trims, upper-cases, accepts spaces or dashes or nothing between parts. Returns "ROW-G-12" form or null. */
export function normaliseRoomCode(input: string): string | null {
  const m = CODE_RE.exec(input.trim().toUpperCase());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Room code from a URL: `?room=` wins, else the first path segment if it is a valid code. */
export function roomCodeFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, 'http://localhost');
  } catch {
    return null;
  }
  const q = parsed.searchParams.get('room');
  if (q !== null) {
    const code = normaliseRoomCode(q);
    if (code) return code;
  }
  const first = parsed.pathname.split('/').find((s) => s.length > 0);
  if (first === undefined) return null;
  let seg = first;
  try {
    seg = decodeURIComponent(first);
  } catch {
    // keep the raw segment
  }
  return normaliseRoomCode(seg);
}

/** Link for sharing: origin + "/" + code. */
export function roomLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/${code}`;
}
