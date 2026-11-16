import type { App } from '../app/app';
import { foldBpm } from '../core/beat';
import type { BeatGrid } from '../core/types';
import { initialTheme } from '../app/connection';
import { BotDriver, createBotOpponent, type BotOptions } from '../net/bot';
import { PRESETS } from '../puppet/presets';
import { loadPresetImages } from '../stage/art/puppetView';
import { playTheme, type LoadedTheme } from '../theme/theme';
import { loadSelectedPuppet } from '../workshop/selection';
import { resolveBotPuppet } from './botSetupModel';
import type { MatchSetup, Scene } from './types';

/** Seconds between the click and the first beat, so the count-in has something to start from. */
const START_DELAY_SEC = 0.6;

export interface BotMatchOptions {
  /** Where the victory screen's Rematch goes (the set-up screen). */
  rematchScene: () => Scene;
  /** The theme the set-up screen already loaded; loaded here when missing. */
  theme?: LoadedTheme;
  /** The preset the bot wears, when the set-up screen already settled it (Surprise me is rolled there, once). */
  botPuppetId?: string;
  /** Random numbers in [0, 1) for Surprise me. Default Math.random. */
  random?: () => number;
}

/**
 * A match against the bot, built from the app's bot set-up: the selected battle theme (the click track at
 * `?bpm=` when that is given), the bot's difficulty and puppet. `?botAccuracy=` and `?seed=` still override.
 * Call after the audio engine is resumed.
 */
export async function createBotMatch(app: App, o: BotMatchOptions): Promise<MatchSetup> {
  const { engine, tunables, params } = app;
  const theme = o.theme ?? (await initialTheme(app));
  const bpm = foldBpm(params.bpm ?? theme.info.bpm, tunables);
  const grid: BeatGrid = { bpm, startTime: engine.clock.now() + START_DELAY_SEC };
  const firstPhrase = tunables.countInPhrases;

  // URL overrides apply to both bots (the autoplaying local side too); the difficulty is the opponent's alone.
  const overrides: Partial<BotOptions> = {};
  if (params.botAccuracy !== null) overrides.accuracy = Math.min(1, Math.max(0, params.botAccuracy));
  if (params.seed !== null) overrides.seed = params.seed;
  // Without ?botAccuracy= the level's own parry chance applies, sliding down over each act.
  const options: Partial<BotOptions> = { difficulty: app.botSetup.difficulty, ...overrides };

  // The bot's puppet: the chosen preset, or one that differs from the player's own.
  const presetIds = PRESETS.map((p) => p.id);
  const botPuppetId =
    o.botPuppetId ??
    resolveBotPuppet(
      app.botSetup,
      presetIds,
      (await loadSelectedPuppet(app.store)).presetId ?? null,
      o.random ?? Math.random,
    );
  const preset = PRESETS.find((p) => p.id === botPuppetId);
  let botImages: Awaited<ReturnType<typeof loadPresetImages>> | null = null;
  try {
    if (preset) botImages = await loadPresetImages(preset);
  } catch {
    botImages = null; // the duel picks the default partner
  }

  const opponent = createBotOpponent({
    clock: engine.clock,
    grid,
    tunables,
    firstAttacker: 0,
    firstPhrase,
    options,
  });

  const music = playTheme(theme, engine, grid.startTime);

  let localDriver: BotDriver | null = null;

  return {
    localPlayer: 0,
    names: [app.displayName, 'Bot'],
    transport: opponent.transport,
    grid,
    firstAttacker: 0,
    firstPhrase,
    bot: opponent.driver,
    botPuppetId,
    puppets: botImages ? [null, botImages] : undefined,
    tick() {
      opponent.update();
      localDriver?.update();
    },
    attach(session) {
      if (!params.autoplay) return;
      localDriver = new BotDriver(
        session,
        { clock: engine.clock, grid, tunables },
        {
          ...overrides,
          seed: (overrides.seed ?? 1) + 1,
        },
      );
    },
    dispose() {
      music.stop();
      opponent.dispose();
    },
    rematchScene: o.rematchScene,
  };
}
