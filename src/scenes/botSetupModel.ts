/** The bot match set-up: what the player chose on the "Play against the bot" screen. Pure; no DOM. */

import { DIFFICULTIES, DIFFICULTY_TABLE, type BotDifficulty } from '../net/botDifficulty';

export { DIFFICULTIES, type BotDifficulty };

export interface BotSetup {
  version: 1;
  difficulty: BotDifficulty;
  /**
   * A preset id, `'surprise'` (a random preset each match) or `'default'` (a preset that differs from
   * the player's own: pink, or teal when the player's is pink).
   */
  botPuppet: string;
}

export const SURPRISE = 'surprise';
export const DEFAULT_PUPPET = 'default';

export const DEFAULT_BOT_SETUP: BotSetup = { version: 1, difficulty: 'medium', botPuppet: DEFAULT_PUPPET };

/** The preset the bot wears by default, and the one it wears when the player's puppet is that default. */
const DEFAULT_PRESET = 'preset-pink';
const FALLBACK_PRESET = 'preset-teal';

/** A fresh bot's chance of parrying each strike at this level (it tires over an act; see botDifficulty.ts). */
export function accuracyFor(d: BotDifficulty): number {
  return DIFFICULTY_TABLE[d].parry.fresh;
}

/** Anything stored is untrusted: unknown fields dropped, bad values replaced by defaults. */
export function parseBotSetup(raw: unknown, presetIds: readonly string[]): BotSetup {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_BOT_SETUP };
  const r = raw as Record<string, unknown>;
  const difficulty = DIFFICULTIES.find((d) => d === r.difficulty) ?? DEFAULT_BOT_SETUP.difficulty;
  const puppet = r.botPuppet;
  const botPuppet =
    typeof puppet === 'string' &&
    (puppet === SURPRISE || puppet === DEFAULT_PUPPET || presetIds.includes(puppet))
      ? puppet
      : DEFAULT_BOT_SETUP.botPuppet;
  return { version: 1, difficulty, botPuppet };
}

/** The preset the default setting stands for: pink, or teal when the player's own puppet is pink. */
export function defaultBotPreset(presetIds: readonly string[], playerPresetId: string | null): string {
  const first = presetIds[0] ?? FALLBACK_PRESET;
  const wanted = presetIds.includes(DEFAULT_PRESET) ? DEFAULT_PRESET : (presetIds[1] ?? first);
  if (playerPresetId !== wanted) return wanted;
  return presetIds.includes(FALLBACK_PRESET) ? FALLBACK_PRESET : first;
}

/** The preset id the bot wears this match. `random` returns a number in [0, 1). */
export function resolveBotPuppet(
  setup: BotSetup,
  presetIds: readonly string[],
  playerPresetId: string | null,
  random: () => number,
): string {
  if (setup.botPuppet === SURPRISE && presetIds.length > 0) {
    const i = Math.min(presetIds.length - 1, Math.max(0, Math.floor(random() * presetIds.length)));
    return presetIds[i] as string;
  }
  if (setup.botPuppet !== DEFAULT_PUPPET && presetIds.includes(setup.botPuppet)) return setup.botPuppet;
  return defaultBotPreset(presetIds, playerPresetId);
}
