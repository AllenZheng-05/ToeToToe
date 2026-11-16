import { describe, expect, it } from 'vitest';
import { createTunables, DEFAULT_TUNABLES } from '../../src/core/tunables';

describe('tunables', () => {
  it('defaults match the spec', () => {
    expect({ ...DEFAULT_TUNABLES }).toEqual({
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
  });

  it('createTunables returns independent mutable copies', () => {
    const a = createTunables();
    const b = createTunables();
    a.missDamage = 99;
    expect(b.missDamage).toBe(10);
    expect(DEFAULT_TUNABLES.missDamage).toBe(10);
    expect(a).not.toBe(b);
  });

  it('applies overrides', () => {
    const t = createTunables({ actsToWin: 3, startHealth: 40 });
    expect(t.actsToWin).toBe(3);
    expect(t.startHealth).toBe(40);
    expect(t.startStamina).toBe(100);
  });
});
