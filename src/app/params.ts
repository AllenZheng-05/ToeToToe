import { DEFAULT_TUNABLES } from '../core/tunables';
import type { Tunables } from '../core/types';

/** Options read from the page URL. Everything is optional; no parameters means a normal game. */
export interface AppParams {
  /** ?debug=1 */
  debug: boolean;
  /** ?bot=1: go straight to a bot match after the first click on the title. */
  bot: boolean;
  /** ?autoplay=1: a BotDriver also plays the local side (for unattended checks). */
  autoplay: boolean;
  /** ?bpm=140 */
  bpm: number | null;
  /** ?seed=7: bot seed. */
  seed: number | null;
  /** ?botAccuracy=0.5 */
  botAccuracy: number | null;
  /** ?room=ROW-G-12 or the path /ROW-G-12. */
  room: string | null;
  /** ?tunables={"startHealth":30}: JSON; unknown keys and non-number values are dropped. */
  tunables: Partial<Tunables>;
}

function flag(v: string | null): boolean {
  return v === '1' || v === 'true';
}

function num(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseTunables(raw: string | null): Partial<Tunables> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (Object.hasOwn(DEFAULT_TUNABLES, key) && typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out as Partial<Tunables>;
}

const ROOM_CODE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

function parseRoom(query: string | null, pathname: string): string | null {
  if (query && ROOM_CODE.test(query)) return query;
  const first = pathname.split('/').find((s) => s.length > 0);
  if (!first) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(first);
  } catch {
    return null;
  }
  return ROOM_CODE.test(decoded) ? decoded : null;
}

/** Accepts a full URL, a path with a query, or just a query string. */
export function parseParams(url: string): AppParams {
  let u: URL;
  try {
    u = new URL(url, 'http://localhost/');
  } catch {
    u = new URL('http://localhost/');
  }
  const q = u.searchParams;
  return {
    debug: flag(q.get('debug')),
    bot: flag(q.get('bot')),
    autoplay: flag(q.get('autoplay')),
    bpm: num(q.get('bpm')),
    seed: num(q.get('seed')),
    botAccuracy: num(q.get('botAccuracy')),
    room: parseRoom(q.get('room'), u.pathname),
    tunables: parseTunables(q.get('tunables')),
  };
}
