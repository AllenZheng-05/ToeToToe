import { describe, expect, it } from 'vitest';
import {
  DIFFICULTIES,
  DIFFICULTY_TABLE,
  isBotDifficulty,
  tiredness,
  type BotDifficulty,
} from '../../src/net/botDifficulty';
import { createTunables } from '../../src/core/tunables';

const ACT = createTunables().actDurationSec;

describe('the difficulty table', () => {
  it('has four levels, easiest first, with the agreed numbers', () => {
    expect(DIFFICULTIES).toEqual(['easy', 'medium', 'hard', 'expert']);
    const pair = (d: BotDifficulty) => [DIFFICULTY_TABLE[d].parry.fresh, DIFFICULTY_TABLE[d].parry.tired];
    const bravo = (d: BotDifficulty) => [DIFFICULTY_TABLE[d].bravo.fresh, DIFFICULTY_TABLE[d].bravo.tired];
    expect(pair('easy')).toEqual([0.5, 0.35]);
    expect(pair('medium')).toEqual([0.75, 0.55]);
    expect(pair('hard')).toEqual([0.9, 0.68]);
    expect(pair('expert')).toEqual([0.97, 0.72]);
    expect(bravo('easy')).toEqual([0.2, 0.1]);
    expect(bravo('medium')).toEqual([0.4, 0.2]);
    expect(bravo('hard')).toEqual([0.6, 0.3]);
    expect(bravo('expert')).toEqual([0.85, 0.4]);
    for (const d of DIFFICULTIES) expect(DIFFICULTY_TABLE[d].tiredAtActFraction).toBe(0.7);
  });

  it('recognises its own levels and nothing else', () => {
    for (const d of DIFFICULTIES) expect(isBotDifficulty(d)).toBe(true);
    for (const junk of ['impossible', 'Expert', '', null, undefined, 3, {}]) {
      expect(isBotDifficulty(junk)).toBe(false);
    }
  });
});

describe('tiredness', () => {
  it.each(DIFFICULTIES)('%s: fresh at 0, linear to the floor at 70% of the act, flat after', (level) => {
    const row = DIFFICULTY_TABLE[level];
    const at = (s: number) => tiredness(level, s, ACT);
    expect(at(0)).toEqual({ accuracy: row.parry.fresh, bravoRate: row.bravo.fresh });

    const mid = at(0.35 * ACT);
    expect(mid.accuracy).toBeCloseTo((row.parry.fresh + row.parry.tired) / 2, 12);
    expect(mid.bravoRate).toBeCloseTo((row.bravo.fresh + row.bravo.tired) / 2, 12);

    const edge = at(0.7 * ACT);
    expect(edge.accuracy).toBeCloseTo(row.parry.tired, 12);
    expect(edge.bravoRate).toBeCloseTo(row.bravo.tired, 12);

    for (const s of [0.71 * ACT, ACT, 3 * ACT, 1e9]) {
      expect(at(s).accuracy).toBeCloseTo(row.parry.tired, 12);
      expect(at(s).bravoRate).toBeCloseTo(row.bravo.tired, 12);
    }
  });

  it('never rises and never leaves the fresh..tired range', () => {
    for (const level of DIFFICULTIES) {
      let last = Infinity;
      for (let s = -5; s <= 1.2 * ACT; s += 0.7) {
        const v = tiredness(level, s, ACT);
        expect(v.accuracy).toBeLessThanOrEqual(last + 1e-12);
        last = v.accuracy;
        expect(v.accuracy).toBeLessThanOrEqual(DIFFICULTY_TABLE[level].parry.fresh);
        expect(v.accuracy).toBeGreaterThanOrEqual(DIFFICULTY_TABLE[level].parry.tired);
      }
    }
  });

  it('starts fresh again in a new act (time is counted from the act, so it restarts at 0)', () => {
    const late = tiredness('expert', 0.9 * ACT, ACT);
    const newAct = tiredness('expert', 0, ACT);
    expect(late.accuracy).toBeCloseTo(0.72, 12);
    expect(newAct.accuracy).toBe(0.97);
    expect(newAct.bravoRate).toBe(0.85);
  });

  it('follows the act length it is given, and survives odd input', () => {
    expect(tiredness('medium', 10, 20).accuracy).toBeCloseTo(0.75 + (0.55 - 0.75) * (10 / 14), 12);
    expect(tiredness('medium', 5, 0).accuracy).toBeCloseTo(0.55, 12);
    expect(tiredness('medium', NaN, ACT).accuracy).toBe(0.75);
    expect(tiredness('medium', -3, ACT).accuracy).toBe(0.75);
  });
});
