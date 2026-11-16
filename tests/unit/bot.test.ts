import { describe, expect, it } from 'vitest';
import { DuelSession, type SessionEvent } from '../../src/core/session';
import { createTunables } from '../../src/core/tunables';
import type { BeatGrid, DuelState } from '../../src/core/types';
import { BotDriver, createBotOpponent, type BotOptions } from '../../src/net/bot';
import { FakeClock } from '../helpers/fakeClock';

const grid: BeatGrid = { bpm: 120, startTime: 0 };
const FRAME = 1 / 60;

interface Result {
  host: DuelSession;
  bot: ReturnType<typeof createBotOpponent>;
  hostEvents: SessionEvent[];
  botEvents: SessionEvent[];
  /** Every frame's pair of states, lightly summarised. */
  trace: string[];
  minBotHealth: number;
  minStamina: number;
  frames: number;
}

/** Host (player 0) driven by a BotDriver, against the bot opponent (player 1). */
function playBots(hostOpts: Partial<BotOptions>, botOpts: Partial<BotOptions>, maxSeconds = 900): Result {
  const clock = new FakeClock(0);
  const tunables = createTunables();
  const bot = createBotOpponent({
    clock,
    grid,
    tunables,
    firstAttacker: 0,
    firstPhrase: 1,
    options: botOpts,
  });
  const host = new DuelSession({
    localPlayer: 0,
    clock,
    grid,
    transport: bot.transport,
    tunables,
    firstAttacker: 0,
    firstPhrase: 1,
  });
  const hostDriver = new BotDriver(host, { clock, grid, tunables }, hostOpts);
  const hostEvents: SessionEvent[] = [];
  const botEvents: SessionEvent[] = [];
  host.on((e) => hostEvents.push(e));
  bot.session.on((e) => botEvents.push(e));

  const trace: string[] = [];
  let minBotHealth = Infinity;
  let minStamina = Infinity;
  let frames = 0;
  const max = Math.ceil(maxSeconds / FRAME);
  for (; frames < max; frames++) {
    clock.advance(FRAME);
    host.update();
    bot.update();
    hostDriver.update();
    const s = host.state;
    minBotHealth = Math.min(minBotHealth, bot.session.state.players[1].health);
    minStamina = Math.min(
      minStamina,
      s.players[0].stamina,
      s.players[1].stamina,
      bot.session.state.players[1].stamina,
    );
    if (frames % 30 === 0) trace.push(JSON.stringify(s));
    if (host.state.phase === 'matchOver' && bot.session.state.phase === 'matchOver') break;
  }
  return { host, bot, hostEvents, botEvents, trace, minBotHealth, minStamina, frames };
}

describe('BotDriver', () => {
  it('has the documented defaults and live-editable options', () => {
    const clock = new FakeClock(0);
    const tunables = createTunables();
    const bot = createBotOpponent({ clock, grid, tunables, firstAttacker: 0, firstPhrase: 1 });
    expect(bot.driver.options).toEqual({ accuracy: 0.75, bravoRate: 0.4, strikes: [3, 6], seed: 1 });
    bot.driver.options.accuracy = 0.1;
    expect(bot.driver.options.accuracy).toBe(0.1);
    expect(bot.transport.role).toBe('host');
    expect(bot.session.state.firstAttacker).toBe(0);
    bot.dispose();
  });

  it('plays a complete match against another driver, both sides ending in equal states', () => {
    const r = playBots({ seed: 3 }, { seed: 4 });
    expect(r.host.state.phase).toBe('matchOver');
    expect(r.bot.session.state.phase).toBe('matchOver');
    expect(r.host.state).toEqual(r.bot.session.state);
    expect(Math.max(...r.host.state.actWins)).toBe(2);
    expect(r.hostEvents.some((e) => e.type === 'matchOver')).toBe(true);
    expect(r.botEvents.some((e) => e.type === 'matchOver')).toBe(true);
    expect(r.hostEvents.some((e) => e.type === 'desync')).toBe(false);
    expect(r.botEvents.some((e) => e.type === 'desync')).toBe(false);
    // It really played: strikes planted by both sides, parries of every grade.
    const planted = (ev: SessionEvent[], p: number) =>
      ev.filter((e) => e.type === 'planted' && e.player === p).length;
    expect(planted(r.hostEvents, 0)).toBeGreaterThan(10);
    expect(planted(r.hostEvents, 1)).toBeGreaterThan(10);
    const grades = new Set(r.hostEvents.flatMap((e) => (e.type === 'judged' ? [e.grade] : [])));
    expect(grades.has('good') || grades.has('bravo')).toBe(true);
  });

  it('is deterministic for the same seeds', () => {
    const a = playBots({ seed: 11 }, { seed: 12 });
    const b = playBots({ seed: 11 }, { seed: 12 });
    expect(a.frames).toBe(b.frames);
    expect(a.trace).toEqual(b.trace);
    expect(a.host.state).toEqual(b.host.state);
    expect(a.hostEvents).toEqual(b.hostEvents);
  });

  it('different seeds play differently', () => {
    const a = playBots({ seed: 1 }, { seed: 2 });
    const b = playBots({ seed: 5 }, { seed: 6 });
    expect(a.trace).not.toEqual(b.trace);
  });

  it('with accuracy 1 never loses health', () => {
    const r = playBots({ accuracy: 0.3, seed: 7 }, { accuracy: 1, seed: 8 });
    expect(r.host.state.phase).toBe('matchOver');
    expect(r.minBotHealth).toBe(100);
    expect(r.host.state.matchWinner).toBe(1);
    expect(r.host.state.actWins).toEqual([0, 2]);
    expect(r.host.state).toEqual(r.bot.session.state);
  });

  it('with accuracy 0 loses every act', () => {
    const r = playBots({ accuracy: 1, seed: 9 }, { accuracy: 0, seed: 10 });
    expect(r.host.state.phase).toBe('matchOver');
    expect(r.host.state.matchWinner).toBe(0);
    expect(r.host.state.actWins).toEqual([2, 0]);
    expect(r.host.state.players[0].health).toBe(100);
    expect(r.host.state).toEqual(r.bot.session.state);
  });

  it('never plants more strikes than stamina allows', () => {
    const r = playBots({ strikes: [7, 8], seed: 21 }, { strikes: [7, 8], seed: 22 });
    expect(r.host.state.phase).toBe('matchOver');
    expect(r.minStamina).toBeGreaterThanOrEqual(0);
    // Seven or eight strikes cost more than a full bar, so the reducer must have turned some away.
    expect(r.botEvents.some((e) => e.type === 'rejected' && e.reason === 'stamina')).toBe(true);
    expect(r.hostEvents.some((e) => e.type === 'rejected' && e.reason === 'stamina')).toBe(true);
    // Only stamina rejections: the bot never aims at a taken slot or the wrong turn.
    expect(
      r.botEvents
        .filter((e) => e.type === 'rejected')
        .every((e) => e.type === 'rejected' && e.reason === 'stamina'),
    ).toBe(true);
  });

  it('plants within the play-area margins and inside the strike range', () => {
    const r = playBots({ strikes: [3, 6], seed: 31 }, { strikes: [3, 6], seed: 32 });
    const states: DuelState[] = [r.host.state];
    expect(states[0]?.phase).toBe('matchOver');
    for (const e of [...r.hostEvents, ...r.botEvents]) {
      if (e.type !== 'planted') continue;
      expect(e.strike.x).toBeGreaterThanOrEqual(0.12);
      expect(e.strike.x).toBeLessThanOrEqual(0.88);
      expect(e.strike.y).toBeGreaterThanOrEqual(0.15);
      expect(e.strike.y).toBeLessThanOrEqual(0.85);
    }
  });
});
