/**
 * The bot's named attack patterns. Each is a pure function from a random source, the tunables and the point the
 * last phrase ended on, to the strikes of one attack phrase (sorted by slot, positions inside the play area).
 * Costs come from the rules' own `strikeCost`, so a plan is checked exactly the way a plant is.
 */
import { slotsPerPhrase } from '../core/beat';
import { playDistance, strikeCost } from '../core/duel';
import type { Strike, Tunables } from '../core/types';

export const X_MIN = 0.12;
export const X_MAX = 0.88;
export const Y_MIN = 0.15;
export const Y_MAX = 0.85;

export type Rng = () => number;

export interface Point {
  x: number;
  y: number;
}

export type PlannedStrike = Strike;

export type PatternName = 'steps' | 'stroll' | 'syncopated' | 'leaps' | 'flurry' | 'zigzag' | 'breather';

export const PATTERN_NAMES: readonly PatternName[] = [
  'steps',
  'stroll',
  'syncopated',
  'leaps',
  'flurry',
  'zigzag',
  'breather',
];

export interface PatternDef {
  name: PatternName;
  /** Fewest and most strikes it plans (before clipping to the phrase). */
  minStrikes: number;
  maxStrikes: number;
  /** The allowed distance between successive strikes, in play-area widths. */
  hop: { min: number; max: number };
  generate(rng: Rng, t: Tunables, start: Point): PlannedStrike[];
}

// ---------------------------------------------------------------- helpers

function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function between(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

function inBounds(p: Point): boolean {
  return p.x >= X_MIN && p.x <= X_MAX && p.y >= Y_MIN && p.y <= Y_MAX;
}

function bandError(d: number, lo: number, hi: number): number {
  return d < lo ? lo - d : d > hi ? d - hi : 0;
}

/** A point `lo..hi` play-area widths from `from`, inside the bounds; the closest it can find when none exists. */
function hopFrom(rng: Rng, t: Tunables, from: Point, lo: number, hi: number): Point {
  let best: Point = { x: from.x, y: from.y };
  let bestErr = Infinity;
  const consider = (p: Point): boolean => {
    const err = bandError(playDistance(from, p, t), lo, hi);
    if (err < bestErr) {
      best = p;
      bestErr = err;
    }
    return err === 0;
  };
  for (let i = 0; i < 16; i++) {
    const d = between(rng, lo, hi);
    const a = rng() * Math.PI * 2;
    const p = { x: from.x + d * Math.cos(a), y: from.y + d * Math.sin(a) * t.playAreaAspect };
    if (inBounds(p) && consider(p)) return p;
  }
  // Corners: sweep every direction from a random start until one lands inside the bounds.
  const sweep = rng() * Math.PI * 2;
  for (let i = 0; i < 24; i++) {
    const a = sweep + (i * Math.PI * 2) / 24;
    const d = (lo + hi) / 2;
    const p = { x: from.x + d * Math.cos(a), y: from.y + d * Math.sin(a) * t.playAreaAspect };
    if (inBounds(p) && consider(p)) return p;
  }
  for (let i = 0; i < 32; i++) {
    const p = { x: between(rng, X_MIN, X_MAX), y: between(rng, Y_MIN, Y_MAX) };
    if (consider(p)) return p;
  }
  return best;
}

/** A point in the x-zone, `lo..hi` from `from` (or anywhere in the zone when there is no `from`). */
function zonePoint(
  rng: Rng,
  t: Tunables,
  from: Point | null,
  zone: [number, number],
  lo: number,
  hi: number,
): Point {
  let best: Point = { x: between(rng, zone[0], zone[1]), y: between(rng, Y_MIN, Y_MAX) };
  if (from === null) return best;
  let bestErr = bandError(playDistance(from, best, t), lo, hi);
  for (let i = 0; i < 32 && bestErr > 0; i++) {
    const p = { x: between(rng, zone[0], zone[1]), y: between(rng, Y_MIN, Y_MAX) };
    const err = bandError(playDistance(from, p, t), lo, hi);
    if (err < bestErr) {
      best = p;
      bestErr = err;
    }
  }
  return best;
}

/** The slots that fall on a beat, in order. */
export function onBeatSlots(t: Tunables): number[] {
  const out: number[] = [];
  for (let b = 0; b < t.beatsPerPhrase; b++) out.push(b * t.slotsPerBeat);
  return out;
}

/** The slots between beats; with one slot per beat there are none, so every slot counts. */
export function offBeatSlots(t: Tunables): number[] {
  const all = Array.from({ length: slotsPerPhrase(t) }, (_, i) => i);
  const off = all.filter((s) => s % t.slotsPerBeat !== 0);
  return off.length > 0 ? off : all;
}

/** `k` distinct entries of `pool` (partial Fisher-Yates), returned in ascending order. */
function pick(rng: Rng, pool: readonly number[], k: number): number[] {
  const a = pool.slice();
  const n = Math.max(0, Math.min(k, a.length));
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (a.length - i));
    const tmp = a[i] as number;
    a[i] = a[j] as number;
    a[j] = tmp;
  }
  return a.slice(0, n).sort((x, y) => x - y);
}

/** `k` consecutive slots starting somewhere that fits. */
function run(rng: Rng, spp: number, k: number): number[] {
  const n = Math.max(0, Math.min(k, spp));
  const first = Math.floor(rng() * (spp - n + 1));
  return Array.from({ length: n }, (_, i) => first + i);
}

/** Positions for the slots, each a hop from the one before (the first from `start`). */
function walk(
  rng: Rng,
  t: Tunables,
  start: Point,
  slots: readonly number[],
  lo: number,
  hi: number,
): PlannedStrike[] {
  const out: PlannedStrike[] = [];
  let at = start;
  for (const slot of slots) {
    at = hopFrom(rng, t, at, lo, hi);
    out.push({ slot, x: at.x, y: at.y });
  }
  return out;
}

/** Strikes that alternate between two x-zones, each hop inside the band. The first side is random. */
function sides(
  rng: Rng,
  t: Tunables,
  slots: readonly number[],
  left: [number, number],
  right: [number, number],
  lo: number,
  hi: number,
): PlannedStrike[] {
  const out: PlannedStrike[] = [];
  let side = rng() < 0.5 ? 0 : 1;
  let prev: Point | null = null;
  for (const slot of slots) {
    const p: Point = zonePoint(rng, t, prev, side === 0 ? left : right, lo, hi);
    out.push({ slot, x: p.x, y: p.y });
    prev = p;
    side = 1 - side;
  }
  return out;
}

// ---------------------------------------------------------------- the patterns

const STEPS_HOP = { min: 0.1, max: 0.2 };
const MEDIUM_HOP = { min: 0.15, max: 0.35 };
const LEAP_HOP = { min: 0.45, max: 0.75 };
const FLURRY_HOP = { min: 0.02, max: 0.075 };
const ZIGZAG_HOP = { min: 0.5, max: 0.84 };
const LEAP_ZONES: { left: [number, number]; right: [number, number] } = {
  left: [X_MIN, 0.35],
  right: [0.65, X_MAX],
};
const ZIGZAG_ZONES: { left: [number, number]; right: [number, number] } = {
  left: [X_MIN, 0.25],
  right: [0.75, X_MAX],
};

export const PATTERNS: Readonly<Record<PatternName, PatternDef>> = {
  /** 2 to 3 strikes on the beat, short hops. */
  steps: {
    name: 'steps',
    minStrikes: 2,
    maxStrikes: 3,
    hop: STEPS_HOP,
    generate(rng, t, start) {
      const slots = pick(rng, onBeatSlots(t), randInt(rng, 2, 3));
      return walk(rng, t, start, slots, STEPS_HOP.min, STEPS_HOP.max);
    },
  },
  /** 4 strikes on the beat, medium hops. */
  stroll: {
    name: 'stroll',
    minStrikes: 4,
    maxStrikes: 4,
    hop: MEDIUM_HOP,
    generate(rng, t, start) {
      const slots = pick(rng, onBeatSlots(t), 4);
      return walk(rng, t, start, slots, MEDIUM_HOP.min, MEDIUM_HOP.max);
    },
  },
  /** 4 to 5 strikes mixing beats and half-beats, medium hops. */
  syncopated: {
    name: 'syncopated',
    minStrikes: 4,
    maxStrikes: 5,
    hop: MEDIUM_HOP,
    generate(rng, t, start) {
      const spp = slotsPerPhrase(t);
      const k = Math.min(spp, randInt(rng, 4, 5));
      const on = onBeatSlots(t);
      const off = offBeatSlots(t);
      const chosen = new Set<number>();
      // At least one of each kind, when the phrase has both.
      chosen.add(on[Math.floor(rng() * on.length)] as number);
      if (k > 1) {
        const o = off.filter((s) => !chosen.has(s));
        if (o.length > 0) chosen.add(o[Math.floor(rng() * o.length)] as number);
      }
      const rest = Array.from({ length: spp }, (_, i) => i).filter((s) => !chosen.has(s));
      for (const s of pick(rng, rest, k - chosen.size)) chosen.add(s);
      const slots = [...chosen].sort((a, b) => a - b);
      return walk(rng, t, start, slots, MEDIUM_HOP.min, MEDIUM_HOP.max);
    },
  },
  /** 4 to 5 strikes far apart across the stage. */
  leaps: {
    name: 'leaps',
    minStrikes: 4,
    maxStrikes: 5,
    hop: LEAP_HOP,
    generate(rng, t) {
      const k = Math.min(slotsPerPhrase(t), randInt(rng, 4, 5));
      const on = onBeatSlots(t);
      const slots =
        k <= on.length
          ? pick(rng, on, k)
          : [
              ...on,
              ...pick(
                rng,
                offBeatSlots(t).filter((s) => !on.includes(s)),
                k - on.length,
              ),
            ].sort((a, b) => a - b);
      return sides(rng, t, slots, LEAP_ZONES.left, LEAP_ZONES.right, LEAP_HOP.min, LEAP_HOP.max);
    },
  },
  /** 6 to 8 consecutive half-beats in a tight cluster. */
  flurry: {
    name: 'flurry',
    minStrikes: 6,
    maxStrikes: 8,
    hop: FLURRY_HOP,
    generate(rng, t, start) {
      const slots = run(rng, slotsPerPhrase(t), randInt(rng, 6, 8));
      return walk(rng, t, start, slots, FLURRY_HOP.min, FLURRY_HOP.max);
    },
  },
  /** 5 to 6 strikes alternating sides of the stage on consecutive half-beats. */
  zigzag: {
    name: 'zigzag',
    minStrikes: 5,
    maxStrikes: 6,
    hop: ZIGZAG_HOP,
    generate(rng, t) {
      const slots = run(rng, slotsPerPhrase(t), randInt(rng, 5, 6));
      return sides(rng, t, slots, ZIGZAG_ZONES.left, ZIGZAG_ZONES.right, ZIGZAG_HOP.min, ZIGZAG_HOP.max);
    },
  },
  /** 1 to 2 strikes, for when stamina is low. */
  breather: {
    name: 'breather',
    minStrikes: 1,
    maxStrikes: 2,
    hop: MEDIUM_HOP,
    generate(rng, t, start) {
      const slots = pick(rng, onBeatSlots(t), randInt(rng, 1, 2));
      return walk(rng, t, start, slots, MEDIUM_HOP.min, MEDIUM_HOP.max);
    },
  },
};

export function generatePattern(name: PatternName, rng: Rng, t: Tunables, start: Point): PlannedStrike[] {
  return PATTERNS[name].generate(rng, t, start);
}

/** The fewest strikes a pattern may be trimmed to, given the phrase's size. */
export function minStrikesFor(name: PatternName, t: Tunables): number {
  return Math.min(PATTERNS[name].minStrikes, slotsPerPhrase(t));
}

// ---------------------------------------------------------------- cost

/** Stamina the rules charge to plant `plan` in slot order. */
export function planCost(plan: readonly PlannedStrike[], t: Tunables): number {
  const planted: Strike[] = [];
  let total = 0;
  for (const s of plan) {
    total += strikeCost(planted, s, t);
    planted.push(s);
  }
  return total;
}

/**
 * How many leading strikes of `plan` the rules would accept from `stamina` (a plant is refused when stamina is below
 * its cost). With `keepAboveZero`, a strike that would leave exactly 0 (Winded) is not counted either.
 */
export function affordableCount(
  plan: readonly PlannedStrike[],
  stamina: number,
  t: Tunables,
  keepAboveZero = false,
): number {
  const planted: Strike[] = [];
  let left = stamina;
  for (const s of plan) {
    const cost = strikeCost(planted, s, t);
    if (left < cost || (keepAboveZero && left - cost <= 0)) break;
    left -= cost;
    planted.push(s);
  }
  return planted.length;
}
