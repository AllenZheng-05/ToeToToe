import { describe, expect, it } from 'vitest';
import { initialDuelState, plantError, reduceDuel } from '../../src/core/duel';
import { createTunables } from '../../src/core/tunables';
import type { PlayerState } from '../../src/core/types';
import type { BotDifficulty } from '../../src/net/botDifficulty';
import {
  affordableCount,
  generatePattern,
  onBeatSlots,
  PATTERN_NAMES,
  planCost,
  type PatternName,
  type Rng,
} from '../../src/net/botPatterns';
import { chooseAttack, type ChosenAttack } from '../../src/net/botStrategy';

function mulberry32(seed: number): Rng {
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
const START = { x: 0.5, y: 0.5 };
const player = (p: Partial<PlayerState> = {}): PlayerState => ({
  health: 100,
  stamina: 100,
  winded: false,
  streak: 0,
  ...p,
});

function choose(
  level: BotDifficulty,
  seed: number,
  me: Partial<PlayerState> = {},
  opp: Partial<PlayerState> = {},
  tun = t,
): ChosenAttack {
  return chooseAttack(level, {
    rng: mulberry32(seed),
    tunables: tun,
    start: START,
    me: player(me),
    opp: player(opp),
  });
}

/** Plants the strikes through the real rules and returns how many were accepted and the stamina left. */
function plant(chosen: ChosenAttack, stamina: number): { accepted: number; left: number } {
  let s = initialDuelState(t, 0, 0);
  s = { ...s, players: [{ ...s.players[0], stamina }, s.players[1]] };
  let accepted = 0;
  for (const st of chosen.strikes) {
    if (plantError(s, 0, st, t) !== null) break;
    s = reduceDuel(s, { type: 'plant', phrase: 0, strike: st }, t, 120);
    accepted++;
  }
  return { accepted, left: s.players[0].stamina };
}

/** The plans an Expert sees for a seed: every pattern, generated in order from one random source. */
function plansFor(seed: number): Record<PatternName, ReturnType<typeof generatePattern>> {
  const rng = mulberry32(seed);
  const out = {} as Record<PatternName, ReturnType<typeof generatePattern>>;
  for (const name of PATTERN_NAMES) out[name] = generatePattern(name, rng, t, START);
  return out;
}

describe('every level only plans what the rules accept', () => {
  it.each(['easy', 'medium', 'hard', 'expert'] as const)('%s', (level) => {
    for (let seed = 1; seed <= 300; seed++) {
      const stamina = (seed * 7) % 101;
      const chosen = choose(
        level,
        seed,
        { stamina },
        { health: 60 + (seed % 41), stamina: 40 + (seed % 61) },
      );
      expect(plant(chosen, stamina).accepted).toBe(chosen.strikes.length);
    }
  });
});

describe('Easy', () => {
  it('plays Steps only, on the beat, over many phrases', () => {
    const on = new Set(onBeatSlots(t));
    for (let seed = 1; seed <= 500; seed++) {
      const chosen = choose('easy', seed, { stamina: 100 });
      expect(chosen.pattern).toBe('steps');
      expect(chosen.strikes.length).toBeGreaterThanOrEqual(2);
      expect(chosen.strikes.length).toBeLessThanOrEqual(3);
      for (const s of chosen.strikes) expect(on.has(s.slot)).toBe(true);
    }
  });
});

describe('Medium', () => {
  it('mixes Steps, Stroll and Syncopated, with Syncopated about one phrase in four', () => {
    const counts: Record<string, number> = {};
    const n = 2000;
    for (let seed = 1; seed <= n; seed++) {
      const name = choose('medium', seed, { stamina: 100 }).pattern;
      counts[name] = (counts[name] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(['steps', 'stroll', 'syncopated']);
    expect((counts.syncopated ?? 0) / n).toBeGreaterThan(0.2);
    expect((counts.syncopated ?? 0) / n).toBeLessThan(0.3);
    expect((counts.steps ?? 0) / n).toBeGreaterThan(0.3);
    expect((counts.stroll ?? 0) / n).toBeGreaterThan(0.3);
  });
});

describe('Hard', () => {
  it('uses every pattern over a long run, and a Breather only when it cannot afford the rest', () => {
    const used = new Set<string>();
    for (let seed = 1; seed <= 1500; seed++) {
      const stamina = (seed * 13) % 101;
      const chosen = choose('hard', seed, { stamina });
      used.add(chosen.pattern);
      expect(planCost(chosen.strikes, t)).toBeLessThanOrEqual(stamina + 1e-9);
      if (chosen.pattern === 'breather') {
        // Nothing else was affordable.
        const plans = plansFor(seed);
        for (const name of PATTERN_NAMES) {
          if (name === 'breather') continue;
          const min = Math.min(name === 'steps' ? 2 : name === 'flurry' ? 6 : name === 'zigzag' ? 5 : 4, 8);
          expect(affordableCount(plans[name], stamina, t)).toBeLessThan(min);
        }
      }
    }
    expect([...used].sort()).toEqual([...PATTERN_NAMES].sort());
  });

  it('takes a shorter variant when the full pattern is too dear', () => {
    let trimmed = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const chosen = choose('hard', seed, { stamina: 60 });
      if (chosen.pattern === 'flurry' && chosen.strikes.length < 8) trimmed++;
    }
    expect(trimmed).toBeGreaterThan(0);
  });
});

describe('Expert', () => {
  it('rule 1: when a full phrase of misses would end the act it plans the most strikes it can afford', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const chosen = choose('expert', seed, { stamina: 100 }, { health: 30, stamina: 100 });
      const plans = plansFor(seed);
      const best = Math.max(...PATTERN_NAMES.map((n) => affordableCount(plans[n], 100, t)));
      expect(chosen.strikes).toHaveLength(best);
      expect(chosen.pattern).toBe('flurry');
    }
  });

  it('rule 1 may leave it Winded, and counts a Winded opponent double', () => {
    // 10 health left against a Winded opponent: even two misses (2 x 10 x 2) end it, so it plans as many strikes as it can.
    const chosen = choose('expert', 3, { stamina: 30 }, { health: 40, winded: true, stamina: 50 });
    expect(chosen.strikes.length).toBeGreaterThan(2);
    expect(plant(chosen, 30).accepted).toBe(chosen.strikes.length);
    // The same health against a healthy opponent is not a finishing chance: it saves.
    const calm = choose('expert', 3, { stamina: 30 }, { health: 100, stamina: 100 });
    expect(calm.pattern).toBe('breather');
  });

  it('rule 2: against a Winded opponent it plays the most expensive pattern it can afford', () => {
    // Health beyond what one phrase could take, so rule 1 stays out of it.
    const tall = createTunables({ startHealth: 1000 });
    for (let seed = 1; seed <= 40; seed++) {
      const stamina = 100;
      const chosen = choose('expert', seed, { stamina }, { health: 1000, winded: true, stamina: 50 }, tall);
      const rng = mulberry32(seed);
      let top = 0;
      for (const name of PATTERN_NAMES) {
        const plan = generatePattern(name, rng, tall, START);
        const n = affordableCount(plan, stamina, tall, true);
        top = Math.max(top, planCost(plan.slice(0, n), tall));
      }
      expect(planCost(chosen.strikes, tall)).toBeCloseTo(top, 9);
      expect(plant(chosen, stamina).left).toBeGreaterThan(0);
    }
  });

  it('rule 2: against an opponent low on stamina too', () => {
    let big = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const chosen = choose('expert', seed, { stamina: 100 }, { health: 100, stamina: 20 });
      if (planCost(chosen.strikes, t) > 60) big++;
      expect(plant(chosen, 100).left).toBeGreaterThan(0);
    }
    expect(big).toBeGreaterThan(30);
  });

  it('rule 3: spends on a big pattern when it can afford one, saves with a Breather when it cannot', () => {
    const spent = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const rich = choose('expert', seed, { stamina: 100 }, { health: 100, stamina: 100 });
      expect(['zigzag', 'leaps', 'flurry']).toContain(rich.pattern);
      spent.add(rich.pattern);
      const poor = choose('expert', seed, { stamina: 40 }, { health: 100, stamina: 100 });
      expect(poor.pattern).toBe('breather');
    }
    expect(spent.size).toBe(3);
  });

  it('rule 4: never plans itself down to 0 stamina unless it is finishing', () => {
    for (let seed = 1; seed <= 600; seed++) {
      const stamina = 1 + ((seed * 11) % 100);
      const oppStamina = 36 + (seed % 65);
      const chosen = choose('expert', seed, { stamina }, { health: 100, stamina: oppStamina });
      const { accepted, left } = plant(chosen, stamina);
      expect(accepted).toBe(chosen.strikes.length);
      expect(left).toBeGreaterThan(0);
    }
    // Finishing is the one exception: it will spend everything for the kill.
    let emptied = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const stamina = 20 + (seed % 60);
      const chosen = choose('expert', seed, { stamina }, { health: 10, stamina: 100 });
      if (plant(chosen, stamina).left < 1) emptied++;
    }
    expect(emptied).toBeGreaterThan(0);
  });

  it('does not read anything but the two players it is given', () => {
    // Same state and seed, same choice: nothing hidden feeds it.
    const a = choose('expert', 77, { stamina: 80 }, { health: 70, stamina: 60 });
    const b = choose('expert', 77, { stamina: 80 }, { health: 70, stamina: 60 });
    expect(a).toEqual(b);
  });
});
