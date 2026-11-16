import type { App } from '../app/app';
import { loadName } from '../app/profile';
import { clickLoopSeconds, createClickBuffer } from '../audio/click';
import { foldBpm } from '../core/beat';
import type { BeatGrid } from '../core/types';
import { BotDriver, createBotOpponent, type BotOptions } from '../net/bot';
import type { MatchSetup } from './types';

/** Seconds between the click and the first beat, so the count-in has something to start from. */
const START_DELAY_SEC = 0.6;
const CLICK_LOOP_BEATS = 16;

/** A match against the bot, with the click track as the song. Call after the audio engine is resumed. */
export function createBotMatch(app: App): MatchSetup {
  const { engine, tunables, params } = app;
  const bpm = foldBpm(params.bpm ?? 120, tunables);
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

  const spec = { bpm, beats: CLICK_LOOP_BEATS };
  const music = engine.playLoop(createClickBuffer(engine.context, bpm, CLICK_LOOP_BEATS), {
    startTime: grid.startTime,
    loopEnd: clickLoopSeconds(spec),
  });

  let localDriver: BotDriver | null = null;

  return {
    localPlayer: 0,
    names: [loadName(), 'Bot'],
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
    rematch: () => {
      return Promise.resolve(createBotMatch(app));
    },
  };
}
