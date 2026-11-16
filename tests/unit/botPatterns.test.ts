import { describe, expect, it } from 'vitest';
import { slotsPerPhrase } from '../../src/core/beat';
import { initialDuelState, playDistance, plantError, reduceDuel } from '../../src/core/duel';
import { createTunables } from '../../src/core/tunables';
import {
  affordableCount,
  generatePattern,
  offBeatSlots,
  onBeatSlots,
  PATTERN_NAMES,
  PATTERNS,
  planCost,
  X_MAX,
  X_MIN,
  Y_MAX,
  Y_MIN,
  type PatternName,
  type Point,
} from '../../src/net/botPatterns';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const t = createTunables();
const RUNS = 400;
const starts: Point[] = [
  { x: 0.5, y: 0.5 },
  { x: 0.12, y: 0.15 },
  { x: 0.88, y: 0.85 },
  { x: 0.3, y: 0.7 },
];

function runs(name: PatternName, tun = t): ReturnType<typeof generatePattern>[] {
  const out = [];
  for (let i = 0; i < RUNS; i++) {
    out.push(generatePattern(name, mulberry32(i + 1), tun, starts[i % starts.length] as Point));
  }
  return out;
}

describe('every pattern', () => {
  it.each(PATTERN_NAMES)(
    '%s: sorted distinct slots inside the phrase, positions inside the bounds',
    (name) => {
      for (const plan of runs(name)) {
        expect(plan.length).toBeGreaterThan(0);
        for (const [i, s] of plan.entries()) {
          expect(Number.isInteger(s.slot)).toBe(true);
          expect(s.slot).toBeGreaterThanOrEqual(0);
          expect(s.slot).toBeLessThan(slotsPerPhrase(t));
          if (i > 0) expect(s.slot).toBeGreaterThan((plan[i - 1] as { slot: number }).slot);
          expect(s.x).toBeGreaterThanOrEqual(X_MIN);
          expect(s.x).toBeLessThanOrEqual(X_MAX);
          expect(s.y).toBeGreaterThanOrEqual(Y_MIN);
          expect(s.y).toBeLessThanOrEqual(Y_MAX);
        }
      }
    },
  );

  it.each(PATTERN_NAMES)('%s: strike count inside its range', (name) => {
    const { minStrikes, maxStrikes } = PATTERNS[name];
    const seen = new Set<number>();
    for (const plan of runs(name)) {
      expect(plan.length).toBeGreaterThanOrEqual(minStrikes);
      expect(plan.length).toBeLessThanOrEqual(maxStrikes);
      seen.add(plan.length);
    }
    expect(seen.size).toBe(maxStrikes - minStrikes + 1);
  });

  it.each(PATTERN_NAMES)('%s: every hop is inside its distance range', (name) => {
    const { min, max } = PATTERNS[name].hop;
    const eps = 1e-9;
    const startsToo = new Set<PatternName>(['steps', 'stroll', 'syncopated', 'flurry', 'breather']);
    for (let i = 0; i < RUNS; i++) {
      const start = starts[i % starts.length] as Point;
      const plan = generatePattern(name, mulberry32(i + 1), t, start);
      let prev: Point | null = startsToo.has(name) ? start : null;
      for (const s of plan) {
        if (prev) {
          const d = playDistance(prev, s, t);
          expect(d).toBeGreaterThanOrEqual(min - eps);
          expect(d).toBeLessThanOrEqual(max + eps);
        }
        prev = s;
      }
    }
  });

  it.each(PATTERN_NAMES)('%s: the same seed gives the same plan', (name) => {
    const a = generatePattern(name, mulberry32(9), t, { x: 0.4, y: 0.4 });
    const b = generatePattern(name, mulberry32(9), t, { x: 0.4, y: 0.4 });
    expect(a).toEqual(b);
    const others = new Set(runs(name).map((p) => JSON.stringify(p)));
    expect(others.size).toBeGreaterThan(RUNS / 2);
  });
});

describe('the rhythm of each pattern', () => {
  const on = new Set(onBeatSlots(t));

  it('Steps and Stroll stay on the beat', () => {
    for (const name of ['steps', 'stroll'] as const) {
      for (const plan of runs(name)) for (const s of plan) expect(on.has(s.slot)).toBe(true);
    }
  });

  it('Breather is on the beat too', () => {
    for (const plan of runs('breather')) for (const s of plan) expect(on.has(s.slot)).toBe(true);
  });

  it('Steps is short, Stroll is four on four beats', () => {
    for (const plan of runs('steps')) expect(plan.length).toBeLessThanOrEqual(3);
    for (const plan of runs('stroll')) expect(plan.map((s) => s.slot)).toEqual(onBeatSlots(t));
  });

  it('Syncopated mixes beats and half-beats', () => {
    for (const plan of runs('syncopated')) {
      expect(plan.some((s) => on.has(s.slot))).toBe(true);
      expect(plan.some((s) => !on.has(s.slot))).toBe(true);
    }
  });

  it('Flurry and Zig-zag are runs of consecutive slots', () => {
    for (const name of ['flurry', 'zigzag'] as const) {
      for (const plan of runs(name)) {
        for (let i = 1; i < plan.length; i++) {
          expect((plan[i] as { slot: number }).slot - (plan[i - 1] as { slot: number }).slot).toBe(1);
        }
      }
    }
  });

  it('Zig-zag alternates sides of the stage', () => {
    for (const plan of runs('zigzag')) {
      for (let i = 1; i < plan.length; i++) {
        const a = (plan[i - 1] as Point).x < 0.5;
        const b = (plan[i] as Point).x < 0.5;
        expect(a).not.toBe(b);
      }
    }
  });
});

describe('cost', () => {
  const avgCost = (name: PatternName): { lo: number; hi: number; mean: number } => {
    const costs = runs(name).map((p) => planCost(p, t));
    return {
      lo: Math.min(...costs),
      hi: Math.max(...costs),
      mean: costs.reduce((a, b) => a + b, 0) / costs.length,
    };
  };

  it('lands near the intended price of each pattern at the default tunables', () => {
    const near = (name: PatternName, lo: number, hi: number): void => {
      const { mean } = avgCost(name);
      expect(mean).toBeGreaterThanOrEqual(lo);
      expect(mean).toBeLessThanOrEqual(hi);
    };
    near('steps', 22, 36);
    near('stroll', 40, 55);
    near('syncopated', 45, 70);
    near('leaps', 65, 90);
    near('flurry', 55, 78);
    near('zigzag', 80, 108);
    near('breather', 8, 22);
  });

  it('adds up exactly as the rules charge it', () => {
    for (const name of PATTERN_NAMES) {
      // A big bar, so no plan is turned away for stamina here.
      const rich = createTunables({ startStamina: 1000 });
      const plan = generatePattern(name, mulberry32(5), rich, { x: 0.5, y: 0.5 });
      let s = initialDuelState(rich, 0, 0);
      const before = s.players[0].stamina;
      for (const st of plan) s = reduceDuel(s, { type: 'plant', phrase: 0, strike: st }, rich, 120);
      expect(s.strikes).toHaveLength(plan.length);
      expect(before - s.players[0].stamina).toBeCloseTo(planCost(plan, rich), 9);
    }
  });

  it('affordableCount matches what the rules accept from any stamina', () => {
    for (const name of PATTERN_NAMES) {
      for (let seed = 1; seed <= 20; seed++) {
        const plan = generatePattern(name, mulberry32(seed), t, { x: 0.5, y: 0.5 });
        for (let stamina = 0; stamina <= 100; stamina += 7) {
          let s = initialDuelState(t, 0, 0);
          s = { ...s, players: [{ ...s.players[0], stamina }, s.players[1]] };
          let accepted = 0;
          for (const st of plan) {
            if (plantError(s, 0, st, t) !== null) break;
            s = reduceDuel(s, { type: 'plant', phrase: 0, strike: st }, t, 120);
            accepted++;
          }
          expect(affordableCount(plan, stamina, t)).toBe(accepted);
          // Keeping above zero never counts a strike that would leave the bot Winded.
          const safe = affordableCount(plan, stamina, t, true);
          expect(safe).toBeLessThanOrEqual(accepted);
          let left = stamina;
          const planted: typeof plan = [];
          for (const st of plan.slice(0, safe)) {
            left -= planCost([...planted, st], t) - planCost(planted, t);
            planted.push(st);
          }
          if (safe > 0) expect(left).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('other phrase sizes', () => {
  const shapes = [
    { beatsPerPhrase: 4, slotsPerBeat: 1 },
    { beatsPerPhrase: 2, slotsPerBeat: 2 },
    { beatsPerPhrase: 8, slotsPerBeat: 3 },
    { beatsPerPhrase: 3, slotsPerBeat: 4 },
  ];
  it.each(shapes)('stays valid with $beatsPerPhrase beats of $slotsPerBeat slots', (shape) => {
    const tun = createTunables(shape);
    const spp = slotsPerPhrase(tun);
    for (const name of PATTERN_NAMES) {
      for (const plan of runs(name, tun)) {
        expect(plan.length).toBeLessThanOrEqual(spp);
        const slots = plan.map((s) => s.slot);
        expect(new Set(slots).size).toBe(slots.length);
        expect(slots).toEqual([...slots].sort((a, b) => a - b));
        for (const s of plan) {
          expect(s.slot).toBeGreaterThanOrEqual(0);
          expect(s.slot).toBeLessThan(spp);
        }
      }
    }
    // Steps and Stroll stay on the beat whatever the subdivision.
    for (const name of ['steps', 'stroll'] as const) {
      for (const plan of runs(name, tun)) {
        for (const s of plan) expect(s.slot % tun.slotsPerBeat).toBe(0);
      }
    }
    expect(onBeatSlots(tun)).toHaveLength(tun.beatsPerPhrase);
    expect(offBeatSlots(tun).length).toBeGreaterThan(0);
  });
});
