import { describe, expect, it } from 'vitest';
import {
  foldBpm,
  nearestSlot,
  phraseAt,
  phraseDuration,
  phraseStart,
  positionAt,
  slotDuration,
  slotsPerPhrase,
  slotTime,
} from '../../src/core/beat';
import { createTunables } from '../../src/core/tunables';

const t = createTunables();
// 120 BPM: slot 0.25 s, phrase 2 s.
const grid = { bpm: 120, startTime: 10 };

describe('foldBpm', () => {
  it.each([
    [60, 120],
    [200, 100],
    [80, 80],
    [180, 180],
    [40, 80],
    [120, 120],
    [0, 120],
    [-5, 120],
    [NaN, 120],
    [Infinity, 120],
  ])('%s -> %s', (input, out) => {
    expect(foldBpm(input, t)).toBe(out);
  });
});

describe('slot and phrase maths at 120 BPM', () => {
  it('durations', () => {
    expect(slotsPerPhrase(t)).toBe(8);
    expect(slotDuration(120, t)).toBeCloseTo(0.25, 12);
    expect(phraseDuration(120, t)).toBeCloseTo(2, 12);
  });

  it('phraseStart and slotTime', () => {
    expect(phraseStart(grid, 0, t)).toBeCloseTo(10, 12);
    expect(phraseStart(grid, 3, t)).toBeCloseTo(16, 12);
    expect(slotTime(grid, 3, 5, t)).toBeCloseTo(17.25, 12);
    expect(phraseStart(grid, -1, t)).toBeCloseTo(8, 12);
  });

  it('phraseAt floors, negative before start', () => {
    expect(phraseAt(grid, 10, t)).toBe(0);
    expect(phraseAt(grid, 11.99, t)).toBe(0);
    expect(phraseAt(grid, 12, t)).toBe(1);
    expect(phraseAt(grid, 9.99, t)).toBe(-1);
    expect(phraseAt(grid, 6, t)).toBe(-2);
  });

  it('positionAt is fractional and within the phrase', () => {
    const p = positionAt(grid, 13.5, t);
    expect(p.phrase).toBe(1);
    expect(p.slotPosition).toBeCloseTo(6, 9);
    expect(p.beatPosition).toBeCloseTo(3, 9);
    const q = positionAt(grid, 10.125, t);
    expect(q.slotPosition).toBeCloseTo(0.5, 9);
    expect(q.beatPosition).toBeCloseTo(0.25, 9);
    const n = positionAt(grid, 9.5, t);
    expect(n.phrase).toBe(-1);
    expect(n.slotPosition).toBeCloseTo(6, 9);
    for (const time of [5, 9.999, 10, 11.9999, 12, 33.3]) {
      const r = positionAt(grid, time, t);
      expect(r.slotPosition).toBeGreaterThanOrEqual(0);
      expect(r.slotPosition).toBeLessThanOrEqual(8);
    }
  });

  it('nearestSlot rounds and reports the offset', () => {
    const a = nearestSlot(grid, 10.26, t);
    expect(a.phrase).toBe(0);
    expect(a.slot).toBe(1);
    expect(a.offsetSec).toBeCloseTo(0.01, 9);
    const b = nearestSlot(grid, 10.24, t);
    expect(b.slot).toBe(1);
    expect(b.offsetSec).toBeCloseTo(-0.01, 9);
  });

  it('nearestSlot rounds across a phrase boundary into the next phrase', () => {
    const r = nearestSlot(grid, 11.95, t);
    expect(r.phrase).toBe(1);
    expect(r.slot).toBe(0);
    expect(r.offsetSec).toBeCloseTo(-0.05, 9);
    const s = nearestSlot(grid, 12.05, t);
    expect(s.phrase).toBe(1);
    expect(s.slot).toBe(0);
    expect(s.offsetSec).toBeCloseTo(0.05, 9);
  });

  it('nearestSlot handles negative times', () => {
    const r = nearestSlot(grid, 9.9, t);
    expect(r.phrase).toBe(0);
    expect(r.slot).toBe(0);
    expect(r.offsetSec).toBeCloseTo(-0.1, 9);
    const q = nearestSlot(grid, 9.3, t);
    expect(q.phrase).toBe(-1);
    expect(q.slot).toBe(5);
    expect(q.offsetSec).toBeCloseTo(0.05, 9);
  });
});
