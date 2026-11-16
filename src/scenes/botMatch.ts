import type { App } from '../app/app';
import { foldBpm } from '../core/beat';
import type { BeatGrid } from '../core/types';
import { initialTheme } from '../app/connection';
import { BotDriver, createBotOpponent, type BotOptions } from '../net/bot';
import { playTheme } from '../theme/theme';
import type { MatchSetup } from './types';

/** Seconds between the click and the first beat, so the count-in has something to start from. */
const START_DELAY_SEC = 0.6;

/**
 * A match against the bot, to the player's selected battle theme (the click track at `?bpm=` when that is given).
 * Call after the audio engine is resumed.
 */
export async function createBotMatch(app: App): Promise<MatchSetup> {
  const { engine, tunables, params } = app;
  const theme = await initialTheme(app);
  const bpm = foldBpm(params.bpm ?? theme.info.bpm, tunables);
  const grid: BeatGrid = { bpm, startTime: engine.clock.now() + START_DELAY_SEC };
  const firstPhrase = tunables.countInPhrases;

  const options: Partial<BotOptions> = {};
  if (params.botAccuracy !== null) options.accuracy = Math.min(1, Math.max(0, params.botAccuracy));
  if (params.seed !== null) options.seed = params.seed;

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
          ...options,
          seed: (options.seed ?? 1) + 1,
        },
      );
    },
    dispose() {
      music.stop();
      opponent.dispose();
    },
    rematch: () => createBotMatch(app),
  };
}
