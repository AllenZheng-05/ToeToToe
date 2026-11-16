/**
 * Which attack pattern the bot plays this phrase. Pure: a level, a random source, the tunables, and what both
 * players can see (health, stamina, Winded). It never reads the pointer or pending inputs.
 */
import type { PlayerState, Tunables } from '../core/types';
import { DIFFICULTY_TABLE, type BotDifficulty } from './botDifficulty';
import {
  affordableCount,
  generatePattern,
  minStrikesFor,
  PATTERN_NAMES,
  planCost,
  type PatternName,
  type PlannedStrike,
  type Point,
  type Rng,
} from './botPatterns';

export interface AttackContext {
  rng: Rng;
  tunables: Tunables;
  /** Where the bot's last strike was. */
  start: Point;
  me: PlayerState;
  opp: PlayerState;
}

export interface ChosenAttack {
  pattern: PatternName;
  /** Always affordable from `me.stamina`: the rules accept every one of them. */
  strikes: PlannedStrike[];
}

/** The patterns an Expert spends on when it can. */
const BIG: readonly PatternName[] = ['zigzag', 'leaps', 'flurry'];

interface Candidate {
  name: PatternName;
  plan: PlannedStrike[];
  /** Strikes the rules accept from the current stamina. */
  n: number;
  /** The same, keeping the bot above 0 stamina (not Winded). */
  nSafe: number;
  min: number;
}

function candidates(ctx: AttackContext): Candidate[] {
  const { rng, tunables: t, start, me } = ctx;
  return PATTERN_NAMES.map((name) => {
    const plan = generatePattern(name, rng, t, start);
    return {
      name,
      plan,
      n: affordableCount(plan, me.stamina, t),
      nSafe: affordableCount(plan, me.stamina, t, true),
      min: Math.min(minStrikesFor(name, t), plan.length),
    };
  });
}

function weightedName(rng: Rng, weights: Partial<Record<PatternName, number>>): PatternName {
  const entries = PATTERN_NAMES.map((n) => [n, weights[n] ?? 0] as const).filter(([, w]) => w > 0);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [name, w] of entries) {
    r -= w;
    if (r < 0) return name;
  }
  return entries[entries.length - 1]?.[0] ?? 'steps';
}

function choose<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))] as T;
}

const trimmed = (c: Candidate, n: number): ChosenAttack => ({ pattern: c.name, strikes: c.plan.slice(0, n) });

function breather(all: Candidate[], safe: boolean): ChosenAttack {
  const b = all.find((c) => c.name === 'breather') as Candidate;
  return trimmed(b, safe ? b.nSafe : b.n);
}

export function chooseAttack(level: BotDifficulty, ctx: AttackContext): ChosenAttack {
  const row = DIFFICULTY_TABLE[level];
  const { rng, tunables: t, me, opp } = ctx;

  if (row.strategy === 'weighted') {
    const name = weightedName(rng, row.weights);
    const plan = generatePattern(name, rng, t, ctx.start);
    return { pattern: name, strikes: plan.slice(0, affordableCount(plan, me.stamina, t)) };
  }

  const all = candidates(ctx);

  if (row.strategy === 'affordable-random') {
    const pool = all.filter((c) => c.name !== 'breather' && c.n >= c.min && c.n > 0);
    if (pool.length === 0) return breather(all, false);
    const c = choose(rng, pool);
    return trimmed(c, c.n);
  }

  // Expert, in this order.
  // 1. A full phrase of misses would end the act (damage doubles against a Winded opponent): the pattern with the
  //    most strikes it can afford, even if that leaves it Winded.
  const mult = opp.winded ? t.windedDamageMultiplier : 1;
  const fit = all.filter((c) => c.n >= c.min && c.n > 0);
  const most = fit.reduce((m, c) => Math.max(m, c.n), 0);
  if (most > 0 && opp.health <= most * t.missDamage * mult) {
    const c = choose(
      rng,
      fit.filter((x) => x.n === most),
    );
    return trimmed(c, c.n);
  }

  // 2. The opponent is Winded or low on stamina: the most expensive pattern it can afford without going Winded.
  const safe = all.filter((c) => c.nSafe >= c.min && c.nSafe > 0);
  if (opp.winded || opp.stamina <= row.lowOpponentStamina) {
    let top: Candidate | null = null;
    let topCost = -1;
    for (const c of safe) {
      const cost = planCost(c.plan.slice(0, c.nSafe), t);
      if (cost > topCost) {
        top = c;
        topCost = cost;
      }
    }
    return top ? trimmed(top, top.nSafe) : breather(all, true);
  }

  // 3. Otherwise alternate: spend on a full big pattern whenever it is affordable, else save with a Breather.
  const spend = safe.filter((c) => BIG.includes(c.name) && c.nSafe === c.plan.length);
  if (spend.length > 0) {
    const c = choose(rng, spend);
    return trimmed(c, c.nSafe);
  }
  return breather(all, true);
}
