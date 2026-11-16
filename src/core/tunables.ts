import type { Tunables } from './types';

export const DEFAULT_TUNABLES: Readonly<Tunables> = Object.freeze({
  minBpm: 80,
  maxBpm: 180,
  beatsPerPhrase: 4,
  slotsPerBeat: 2,
  countInPhrases: 1,
  intermissionPhrases: 2,

  bravoWindowMs: 45,
  goodWindowMs: 100,
  missWindowMs: 200,
  inputGraceMs: 60,
  targetRadius: 0.06,
  targetRadiusTouch: 0.085,
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
});

/** A fresh mutable copy with overrides applied. */
export function createTunables(overrides: Partial<Tunables> = {}): Tunables {
  return { ...DEFAULT_TUNABLES, ...overrides };
}
