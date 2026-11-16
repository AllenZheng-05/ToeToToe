import type { Tunables } from './types';

export const DEFAULT_TUNABLES: Readonly<Tunables> = Object.freeze({
  minBpm: 80,
  maxBpm: 240,
  beatsPerPhrase: 4,
  slotsPerBeat: 2,
  countInPhrases: 1,
  intermissionPhrases: 2,

  bravoWindowMs: 45,
  goodWindowMs: 100,
  missWindowMs: 200,
  inputGraceMs: 60,
  targetRadius: 0.05,
  targetRadiusTouch: 0.075,
  playAreaAspect: 2,

  startHealth: 100,
  startStamina: 100,
  missDamage: 10,
  missStaminaLoss: 8,
  bravoStaminaLoss: 6,
  strikeBaseCost: 8,
  strikeDistanceCostMax: 12,
  strikeDistanceForMaxCost: 0.6,
  staminaRegen: 35,
  windedDamageMultiplier: 2,
  windedResetStamina: 50,

  actDurationSec: 90,
  actsToWin: 2,

  clockJumpMs: 50,
  startLeadSec: 3,
  ringLeadBeats: 2,
});

/** A fresh mutable copy with overrides applied. */
export function createTunables(overrides: Partial<Tunables> = {}): Tunables {
  return { ...DEFAULT_TUNABLES, ...overrides };
}

interface Range {
  min: number;
  max: number;
  int?: true;
}

const small = (min: number, max: number): Range => ({ min, max, int: true });
const amount: Range = { min: 0, max: 10_000 };
const windowMs: Range = { min: 0, max: 1000 };
const radius: Range = { min: 0.001, max: 0.5 };

/** The accepted range of every tunable. Values from the other player or the URL must fall inside. */
const RANGES: Readonly<Record<keyof Tunables, Range>> = {
  minBpm: { min: 20, max: 400 },
  maxBpm: { min: 20, max: 400 },
  beatsPerPhrase: small(1, 8),
  slotsPerBeat: small(1, 4),
  countInPhrases: small(0, 8),
  intermissionPhrases: small(0, 16),

  bravoWindowMs: windowMs,
  goodWindowMs: windowMs,
  missWindowMs: windowMs,
  inputGraceMs: windowMs,
  targetRadius: radius,
  targetRadiusTouch: radius,
  playAreaAspect: { min: 0.25, max: 8 },

  startHealth: { min: 1, max: 10_000 },
  startStamina: { min: 1, max: 10_000 },
  missDamage: amount,
  missStaminaLoss: amount,
  bravoStaminaLoss: amount,
  strikeBaseCost: amount,
  strikeDistanceCostMax: amount,
  strikeDistanceForMaxCost: { min: 0.01, max: 10 },
  staminaRegen: amount,
  windedDamageMultiplier: { min: 0, max: 20 },
  windedResetStamina: amount,

  actDurationSec: { min: 1, max: 3600 },
  actsToWin: small(1, 9),

  clockJumpMs: { min: 1, max: 5000 },
  startLeadSec: { min: 0.5, max: 30 },
  ringLeadBeats: { min: 0, max: 16 },
};

/** True when `key` is a tunable and `value` is a finite number inside its range (an integer where required). */
export function tunableInRange(key: string, value: unknown): boolean {
  if (!Object.hasOwn(RANGES, key) || typeof value !== 'number' || !Number.isFinite(value)) return false;
  const r = RANGES[key as keyof Tunables];
  if (value < r.min || value > r.max) return false;
  return r.int !== true || Number.isInteger(value);
}

/** A complete, in-range Tunables from untrusted input, or null. Unknown keys are dropped; a missing or bad field rejects it all. */
export function validateTunables(input: unknown): Tunables | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const src = input as Record<string, unknown>;
  const out = { ...DEFAULT_TUNABLES };
  for (const key of Object.keys(DEFAULT_TUNABLES) as (keyof Tunables)[]) {
    const v = src[key];
    if (!tunableInRange(key, v)) return null;
    out[key] = v as number;
  }
  if (out.minBpm > out.maxBpm) return null;
  return out;
}

/** House tracks and the click track may be any tempo a manifest allows (they are folded into range at start). */
const HOUSE_BPM = { min: 30, max: 300 };
/** The longest song is 6 minutes (SONG_LIMITS.maxSeconds), so the first beat cannot be later than that. */
const MAX_FIRST_BEAT_SEC = 360;

/**
 * Tempo and first-beat bounds for a theme offer. Uploads (which the player tunes on the theme screen) must
 * be inside [minBpm, maxBpm]; house and click themes may be anything a track manifest allows.
 */
export function themeBeatOk(
  source: 'house' | 'upload' | 'click',
  bpm: unknown,
  firstBeatOffset: unknown,
  t: Tunables,
): boolean {
  if (typeof bpm !== 'number' || !Number.isFinite(bpm)) return false;
  if (typeof firstBeatOffset !== 'number' || !Number.isFinite(firstBeatOffset)) return false;
  if (firstBeatOffset < 0 || firstBeatOffset > MAX_FIRST_BEAT_SEC) return false;
  const lo = source === 'upload' ? t.minBpm : HOUSE_BPM.min;
  const hi = source === 'upload' ? t.maxBpm : HOUSE_BPM.max;
  return bpm >= lo && bpm <= hi;
}
