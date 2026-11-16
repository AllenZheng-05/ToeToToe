import { describe, expect, it } from 'vitest';
import {
  clampOffset,
  describeOffset,
  estimateOffset,
  MAX_TAP_ERROR_MS,
  tapErrorMs,
} from '../../src/scenes/calibrationModel';

const grid = { bpm: 100, startTime: 10 };
const BEAT = 0.6;
const taps = (n: number, errMs: (i: number) => number): number[] =>
  Array.from({ length: n }, (_, i) => grid.startTime + (i + 1) * BEAT + errMs(i) / 1000);

describe('estimateOffset', () => {
  it('reads steady late taps as a positive mean with no spread', () => {
    const e = estimateOffset(
      taps(8, () => 34),
      grid,
    );
    expect(e?.meanMs).toBeCloseTo(34, 6);
    expect(e?.spreadMs).toBeCloseTo(0, 6);
    expect(e?.used).toBe(8);
  });

  it('reads early taps as negative', () => {
    const e = estimateOffset(
      taps(8, () => -50),
      grid,
    );
    expect(e?.meanMs).toBeCloseTo(-50, 6);
  });

  it('reports the spread of uneven taps', () => {
    const e = estimateOffset(
      taps(8, (i) => (i % 2 === 0 ? 20 : 40)),
      grid,
    );
    expect(e?.meanMs).toBeCloseTo(30, 6);
    expect(e?.spreadMs).toBeCloseTo(10, 6);
  });

  it('drops taps more than 200 ms from a beat', () => {
    const t = taps(8, () => 30);
    t.push(grid.startTime + 9.5 * BEAT + 0.001); // half a beat off
    t.push(grid.startTime + 12 * BEAT + (MAX_TAP_ERROR_MS + 20) / 1000);
    const e = estimateOffset(t, grid);
    expect(e?.used).toBe(8);
    expect(e?.meanMs).toBeCloseTo(30, 6);
  });

  it('wraps a tap just before a beat to a small negative error', () => {
    expect(tapErrorMs(grid.startTime + 3 * BEAT - 0.04, grid)).toBeCloseTo(-40, 6);
    expect(tapErrorMs(grid.startTime + 3 * BEAT + 0.04, grid)).toBeCloseTo(40, 6);
    // Taps before the grid starts wrap the same way.
    expect(tapErrorMs(grid.startTime - BEAT + 0.02, grid)).toBeCloseTo(20, 6);
  });

  it('handles taps right at the half-beat wrap', () => {
    const e = estimateOffset(
      taps(8, () => 299),
      grid,
    );
    expect(e).toBeNull(); // 299 ms is over the 200 ms limit
  });

  it('needs enough taps', () => {
    expect(estimateOffset([], grid)).toBeNull();
    expect(
      estimateOffset(
        taps(3, () => 10),
        grid,
      ),
    ).toBeNull();
    expect(
      estimateOffset(
        taps(4, () => 10),
        grid,
      )?.used,
    ).toBe(4);
    expect(
      estimateOffset(
        taps(8, () => 10),
        { bpm: 0, startTime: 0 },
      ),
    ).toBeNull();
  });
});

describe('describeOffset and clampOffset', () => {
  it('words the result', () => {
    expect(describeOffset(34.4)).toBe('You tap 34 ms late');
    expect(describeOffset(-12.6)).toBe('You tap 13 ms early');
    expect(describeOffset(0.2)).toBe('You tap right on the beat');
  });
  it('keeps the stored value whole and bounded', () => {
    expect(clampOffset(33.6)).toBe(34);
    expect(clampOffset(9999)).toBe(500);
    expect(clampOffset(-9999)).toBe(-500);
    expect(clampOffset(Number.NaN)).toBe(0);
  });
});
