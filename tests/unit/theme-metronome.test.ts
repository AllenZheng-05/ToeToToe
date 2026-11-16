import { describe, expect, it } from 'vitest';
import { beatsToSchedule } from '../../src/theme/metronome';

function run(
  grid: { bpm: number; startTime: number },
  until: number,
  step: number,
  window: number,
): number[] {
  const all: number[] = [];
  let through = Number.NEGATIVE_INFINITY;
  for (let now = 0; now < until; now += step) {
    for (const t of beatsToSchedule(now, now + window, grid, through)) {
      all.push(t);
      through = t;
    }
  }
  return all;
}

describe('beatsToSchedule', () => {
  it('returns each beat in a window', () => {
    expect(beatsToSchedule(0, 2.1, { bpm: 120, startTime: 0 }, -Infinity)).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('schedules each beat exactly once across overlapping windows', () => {
    const grid = { bpm: 120, startTime: 0.3 };
    const all = run(grid, 10, 0.025, 0.12);
    const expected: number[] = [];
    for (let k = 0; grid.startTime + k * 0.5 < 10.1; k++) expected.push(grid.startTime + k * 0.5);
    expect(all.length).toBe(new Set(all).size);
    expect(all.slice(0, 18)).toEqual(expected.slice(0, 18));
  });

  it('returns nothing for a window before the grid starts', () => {
    expect(beatsToSchedule(0, 0.9, { bpm: 100, startTime: 1 }, -Infinity)).toEqual([]);
  });

  it('picks up the first beat when the window reaches the grid start', () => {
    expect(beatsToSchedule(0.95, 1.07, { bpm: 100, startTime: 1 }, -Infinity)).toEqual([1]);
  });

  it('does not repeat beats already scheduled', () => {
    expect(beatsToSchedule(0.9, 1.6, { bpm: 120, startTime: 0 }, 1)).toEqual([1.5]);
  });

  it('does not drift at a non-integer tempo', () => {
    const grid = { bpm: 127.3, startTime: 0.2 };
    const beat = 60 / 127.3;
    const all = run(grid, 600, 0.025, 0.12);
    expect(all.length).toBe(new Set(all).size);
    all.forEach((t, k) => expect(t).toBe(grid.startTime + k * beat));
    // Every index matched its beat above, so none went missing; 600 s is about 1273 beats.
    expect(all.length).toBeGreaterThan(1270);
  });

  it('ignores a bad tempo', () => {
    expect(beatsToSchedule(0, 1, { bpm: 0, startTime: 0 }, -Infinity)).toEqual([]);
  });
});
