/**
 * Everything that differs between the bot's difficulty levels, in one table. A fifth level is one more row.
 * Pure data and one pure function; the bot (bot.ts) and the set-up screen both read it.
 */
import type { PatternName } from './botPatterns';

export type BotDifficulty = 'easy' | 'medium' | 'hard' | 'expert';

/** In the order the set-up screen shows them. */
export const DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'medium', 'hard', 'expert'];

/** How the bot picks its attack pattern each phrase. */
export type AttackStrategy =
  /** Pick by `weights`, then trim the strikes to what the stamina allows. */
  | 'weighted'
  /** Any pattern it can afford, uniformly; a Breather when none. */
  | 'affordable-random'
  /** Readable rules over what both players can see (see botStrategy.ts). */
  | 'expert';

export interface FreshToTired {
  fresh: number;
  tired: number;
}

export interface DifficultyRow {
  label: string;
  strategy: AttackStrategy;
  /** For 'weighted': relative weight of each pattern. */
  weights: Partial<Record<PatternName, number>>;
  /** Chance of parrying a strike. */
  parry: FreshToTired;
  /** Of the parries, the share that are Bravo. */
  bravo: FreshToTired;
  /** The share of the act's length over which parry chance and Bravo share slide from fresh to tired. */
  tiredAtActFraction: number;
  /** Expert: the opponent counts as low on stamina at or below this. */
  lowOpponentStamina: number;
}

export const DIFFICULTY_TABLE: Readonly<Record<BotDifficulty, Readonly<DifficultyRow>>> = {
  easy: {
    label: 'Easy',
    strategy: 'weighted',
    weights: { steps: 1 },
    parry: { fresh: 0.5, tired: 0.35 },
    bravo: { fresh: 0.2, tired: 0.1 },
    tiredAtActFraction: 0.7,
    lowOpponentStamina: 0,
  },
  medium: {
    label: 'Medium',
    // Steps and Stroll mostly, Syncopated about one phrase in four.
    strategy: 'weighted',
    weights: { steps: 3, stroll: 3, syncopated: 2 },
    parry: { fresh: 0.75, tired: 0.55 },
    bravo: { fresh: 0.4, tired: 0.2 },
    tiredAtActFraction: 0.7,
    lowOpponentStamina: 0,
  },
  hard: {
    label: 'Hard',
    strategy: 'affordable-random',
    weights: {},
    parry: { fresh: 0.9, tired: 0.68 },
    bravo: { fresh: 0.6, tired: 0.3 },
    tiredAtActFraction: 0.7,
    lowOpponentStamina: 0,
  },
  expert: {
    label: 'Expert',
    strategy: 'expert',
    weights: {},
    parry: { fresh: 0.97, tired: 0.72 },
    bravo: { fresh: 0.85, tired: 0.4 },
    tiredAtActFraction: 0.7,
    lowOpponentStamina: 35,
  },
};

export function isBotDifficulty(v: unknown): v is BotDifficulty {
  return DIFFICULTIES.some((d) => d === v);
}

/**
 * The bot's parry chance and Bravo share `secondsIntoAct` seconds after the act's first phrase began:
 * the fresh values at 0, sliding linearly to the tired floor at `tiredAtActFraction` of the act, then flat.
 * Every act starts fresh again because `secondsIntoAct` is measured from the current act.
 */
export function tiredness(
  level: BotDifficulty,
  secondsIntoAct: number,
  actDurationSec: number,
): { accuracy: number; bravoRate: number } {
  const row = DIFFICULTY_TABLE[level];
  const span = row.tiredAtActFraction * actDurationSec;
  const raw = span > 0 ? secondsIntoAct / span : 1;
  const k = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
  return {
    accuracy: row.parry.fresh + (row.parry.tired - row.parry.fresh) * k,
    bravoRate: row.bravo.fresh + (row.bravo.tired - row.bravo.fresh) * k,
  };
}
