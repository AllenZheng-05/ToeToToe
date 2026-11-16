import { describe, expect, it } from 'vitest';
import { clickLoopSeconds, renderClickTrack } from '../../src/audio/click';

const spec = { bpm: 120, beats: 16, sampleRate: 44100 };

function energy(d: Float32Array, from: number, to: number): number {
  let e = 0;
  for (let i = from; i < to; i++) e += (d[i] ?? 0) ** 2;
  return e;
}

describe('click track', () => {
  const data = renderClickTrack(spec);

  it('has the expected length', () => {
    const body = Math.ceil(clickLoopSeconds(spec) * spec.sampleRate);
    expect(data.length).toBeGreaterThanOrEqual(body);
    expect(data.length).toBeLessThan(body + 1000);
  });

  it('peaks at most 0.9 and has no NaN', () => {
    let peak = 0;
    for (const v of data) {
      expect(Number.isNaN(v)).toBe(false);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeLessThanOrEqual(0.9 + 1e-6);
    expect(peak).toBeGreaterThan(0.3);
  });

  it('has far more energy just after each beat than just before', () => {
    const win = Math.round(0.005 * spec.sampleRate);
    const body = Math.ceil(clickLoopSeconds(spec) * spec.sampleRate);
    for (let b = 0; b < spec.beats; b++) {
      const onset = Math.round(b * (60 / spec.bpm) * spec.sampleRate);
      const from = (onset - win + body) % body;
      const before = energy(data, from, from + win);
      const after = energy(data, onset, onset + win);
      expect(after).toBeGreaterThan(before * 10);
    }
  });

  it('is deterministic', () => {
    expect(renderClickTrack(spec)).toEqual(data);
  });

  it('reports exact loop seconds', () => {
    expect(clickLoopSeconds({ bpm: 120, beats: 16 })).toBe(8);
    expect(clickLoopSeconds({ bpm: 90, beats: 8 })).toBeCloseTo(5.3333333333, 9);
  });
});
