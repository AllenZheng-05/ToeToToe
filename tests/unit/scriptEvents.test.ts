import { describe, expect, it } from 'vitest';
import { slotTime } from '../../src/core/beat';
import { createTunables } from '../../src/core/tunables';
import { isDue } from '../../src/debug/script';

describe('isDue', () => {
  const t = createTunables();
  const grid = { bpm: 120, startTime: 10 };

  it('is due exactly when the clock reaches the slot', () => {
    const at = slotTime(grid, 2, 3, t);
    expect(isDue({ phrase: 2, slot: 3, x: 0.5, y: 0.5 }, grid, t, at - 0.001)).toBe(false);
    expect(isDue({ phrase: 2, slot: 3, x: 0.5, y: 0.5 }, grid, t, at)).toBe(true);
  });

  it('applies the millisecond offset', () => {
    const at = slotTime(grid, 2, 3, t);
    const early = { phrase: 2, slot: 3, x: 0, y: 0, offsetMs: -50 };
    expect(isDue(early, grid, t, at - 0.051)).toBe(false);
    expect(isDue(early, grid, t, at - 0.05)).toBe(true);
  });
});
