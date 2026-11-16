import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioClock, AudioEngine, planLoopStart } from '../../src/audio/engine';

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

  it('timeOfEvent never returns more than now()', () => {
    const { clock } = make();
    const now = clock.now();
    expect(clock.timeOfEvent(1010)).toBeLessThanOrEqual(clock.now());
    expect(clock.timeOfEvent(1010)).toBeCloseTo(now, 9);
  });

  it('widens the interpolation cap to the largest context step seen, up to 50 ms', () => {
    const { s, clock } = make();
    clock.now();
    s.ctx += 0.01; // a 10 ms jump
    s.perf += 10;
    clock.now();
    s.perf += 8;
    expect(clock.now()).toBeCloseTo(10.01 + 0.008, 9); // not stuck at one 3 ms quantum
    s.perf += 500;
    expect(clock.now()).toBeCloseTo(10.02, 9);

    const big = make();
    big.clock.now();
    big.s.ctx += 1;
    big.clock.now();
    big.s.perf += 500;
    expect(big.clock.now()).toBeCloseTo(11.05, 9);
  });

  it('now() stays monotonic when latencySec is raised after a read', () => {
    const { s, clock } = make();
    const a = clock.now();
    clock.latencySec = 0.1;
    expect(clock.now()).toBeGreaterThanOrEqual(a);
    s.ctx += 0.2;
    const b = clock.now();
    expect(b).toBeGreaterThanOrEqual(a);
    clock.latencySec = 0.5;
    expect(clock.now()).toBeGreaterThanOrEqual(b);
  });
});

describe('planLoopStart', () => {
  const base = { offset: 0, loopStart: 0, loopEnd: 8 };

  it('keeps a start that is far enough ahead', () => {
    expect(planLoopStart({ ...base, startCtx: 12, nowCtx: 10 })).toEqual({ when: 12, position: 0 });
  });

  it('pushes a start that is only just ahead and advances the position by the same amount', () => {
    const p = planLoopStart({ ...base, startCtx: 10.02, nowCtx: 10 });
    expect(p.when).toBeCloseTo(10.05, 9);
    expect(p.position).toBeCloseTo(0.03, 9);
  });

  it('handles a late start with a first-beat offset', () => {
    const p = planLoopStart({ startCtx: 9, nowCtx: 10, offset: 0.5, loopStart: 0.5, loopEnd: 8 });
    expect(p.when).toBeCloseTo(10.05, 9);
    expect(p.position).toBeCloseTo(0.5 + 1.05, 9);
  });

  it('wraps a start that is late by several loops into the loop region', () => {
    const p = planLoopStart({ startCtx: 0, nowCtx: 20, offset: 1, loopStart: 2, loopEnd: 6 });
    expect(p.when).toBeCloseTo(20.05, 9);
    // 1 + 20.05 = 21.05; (21.05 - 2) mod 4 = 3.05; + 2 = 5.05
    expect(p.position).toBeCloseTo(5.05, 9);
  });
});

describe('AudioEngine.resume', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the output latency only the first time the context runs', async () => {
    const node = (): unknown => ({ connect: node, gain: { value: 1 } });
    class FakeContext {
      state = 'suspended';
      currentTime = 0;
      outputLatency = 0.04;
      baseLatency = 0.01;
      destination = {};
      createGain = node;
      async resume() {
        this.state = 'running';
      }
    }
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('performance', { now: () => 0 });
    const engine = new AudioEngine();
    await engine.resume();
    expect(engine.clock.latencySec).toBeCloseTo(0.04, 9);
    (engine.context as unknown as FakeContext).outputLatency = 0.2;
    await engine.resume();
    expect(engine.clock.latencySec).toBeCloseTo(0.04, 9);
  });
});
