import { phraseStart } from '../../src/core/beat';
import { DuelSession, type SessionEvent } from '../../src/core/session';
import { createTunables } from '../../src/core/tunables';
import type { BeatGrid, PlayerId, Tunables } from '../../src/core/types';
import { BotDriver, createBotOpponent, type BotOptions } from '../../src/net/bot';
import { FakeClock } from './fakeClock';

export interface BotDuelResult {
  winner: PlayerId | null;
  host: DuelSession;
  bot: ReturnType<typeof createBotOpponent>;
  hostEvents: SessionEvent[];
  botEvents: SessionEvent[];
  /** Seconds each finished act lasted, from its first phrase to the resolve that ended it. */
  actSeconds: number[];
  /** Stamina rejections seen by either session. */
  staminaRejections: number;
  /** Every plant, by player. */
  planted: [number, number];
  frames: number;
}

export interface BotDuelOptions {
  host: Partial<BotOptions>;
  bot: Partial<BotOptions>;
  tunables?: Partial<Tunables>;
  bpm?: number;
  /** Called once per frame after both sides have updated. */
  onFrame?: (ctx: {
    host: DuelSession;
    bot: ReturnType<typeof createBotOpponent>;
    hostDriver: BotDriver;
  }) => void;
  maxSeconds?: number;
}

const FRAME = 1 / 60;

/** A whole match on a fake clock: the host (player 0) driven by a BotDriver, against the bot opponent (player 1). */
export function playBotDuel(o: BotDuelOptions): BotDuelResult {
  const clock = new FakeClock(0);
  const tunables = createTunables(o.tunables);
  const grid: BeatGrid = { bpm: o.bpm ?? 120, startTime: 0 };
  const bot = createBotOpponent({ clock, grid, tunables, firstAttacker: 0, firstPhrase: 1, options: o.bot });
  const host = new DuelSession({
    localPlayer: 0,
    clock,
    grid,
    transport: bot.transport,
    tunables,
    firstAttacker: 0,
    firstPhrase: 1,
  });
  const hostDriver = new BotDriver(host, { clock, grid, tunables }, o.host);
  const hostEvents: SessionEvent[] = [];
  const botEvents: SessionEvent[] = [];
  host.on((e) => hostEvents.push(e));
  bot.session.on((e) => botEvents.push(e));

  const actSeconds: number[] = [];
  let actFirst = host.state.actFirstPhrase;
  let staminaRejections = 0;
  const planted: [number, number] = [0, 0];
  host.on((e) => {
    if (e.type === 'actOver') actSeconds.push(clock.now() - phraseStart(grid, actFirst, tunables));
    if (e.type === 'rejected' && e.reason === 'stamina') staminaRejections++;
    if (e.type === 'planted') planted[e.player]++;
  });
  bot.session.on((e) => {
    if (e.type === 'rejected' && e.reason === 'stamina') staminaRejections++;
  });

  const max = Math.ceil((o.maxSeconds ?? 2400) / FRAME);
  let frames = 0;
  for (; frames < max; frames++) {
    clock.advance(FRAME);
    host.update();
    bot.update();
    hostDriver.update();
    o.onFrame?.({ host, bot, hostDriver });
    actFirst = host.state.actFirstPhrase;
    if (host.state.phase === 'matchOver' && bot.session.state.phase === 'matchOver') break;
  }
  return {
    winner: host.state.matchWinner,
    host,
    bot,
    hostEvents,
    botEvents,
    actSeconds,
    staminaRejections,
    planted,
    frames,
  };
}
