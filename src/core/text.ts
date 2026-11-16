/** Longest display name, and the name used when none is left. */
export const MAX_NAME_LENGTH = 20;
export const DEFAULT_NAME = 'Player';

/** Control characters, zero-width characters, line separators and the bidirectional overrides and isolates. */
function isHidden(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x061c ||
    (code >= 0x200b && code <= 0x200f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/**
 * Text from another player made safe to show: control and direction-changing characters removed, trimmed,
 * capped at `max` characters (counted in code points), and `fallback` if nothing is left. Pure.
 */
export function cleanText(raw: unknown, max: number, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  let out = '';
  for (const ch of raw) {
    if (!isHidden(ch.codePointAt(0) ?? 0)) out += ch;
  }
  const text = Array.from(out.trim()).slice(0, max).join('').trim();
  return text === '' ? fallback : text;
}
