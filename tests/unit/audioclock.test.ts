import { describe, expect, it } from 'vitest';
import { AudioClock } from '../../src/audio/engine';

function make(quantum = 0.003) {
  const s = { ctx: 10, perf: 1000 };
  const clock = new AudioClock(
    () => s.ctx,
    () => s.perf,
    quantum,
  );
  return { s, clock };
}

describe('AudioClock', () => {
  it('subtracts latency', () => {
    const { clock } = make();
    clock.latencySec = 0.05;
    expect(clock.now()).toBeCloseTo(9.95, 9);
  });

  it('interpolates between context steps', () => {
    const { s, clock } = make();
    clock.now();
    s.perf += 2;
    expect(clock.now()).toBeCloseTo(10.002, 9);
  });

  it('caps interpolation at one quantum past the last seen context time', () => {
    const { s, clock } = make();
    clock.now();
    s.perf += 500;
    expect(clock.now()).toBeCloseTo(10.003, 9);
  });

  it('never goes backwards when the context stalls or perf jitters', () => {
    const { s, clock } = make();
    clock.now();
    s.perf += 2.5;
    const a = clock.now();
    s.perf -= 2; // jitter backwards
    expect(clock.now()).toBeGreaterThanOrEqual(a);
    s.perf += 100; // stall: capped
    const b = clock.now();
    s.ctx = 10.001; // context steps to less than the interpolated value
    expect(clock.now()).toBeGreaterThanOrEqual(b);
    let prev = clock.now();
    for (let i = 0; i < 50; i++) {
      s.perf += (i % 3) - 1;
      if (i % 7 === 0) s.ctx += 0.003;
      const v = clock.now();
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('toContextTime adds latency', () => {
    const { clock } = make();
    clock.latencySec = 0.04;
    expect(clock.toContextTime(5)).toBeCloseTo(5.04, 9);
  });

  it('timeOfEvent maps an older timestamp to an earlier clock time', () => {
    const { clock } = make();
    const now = clock.now();
    expect(clock.timeOfEvent(1000)).toBeCloseTo(now, 9);
    expect(clock.timeOfEvent(950)).toBeCloseTo(now - 0.05, 9);
    expect(clock.timeOfEvent(900)).toBeLessThan(clock.timeOfEvent(950));
  });
});
