import { describe, expect, it } from 'vitest';
import type { App } from '../../src/app/app';
import type { Connection } from '../../src/app/connection';
import { phraseStart } from '../../src/core/beat';
import { initialDuelState } from '../../src/core/duel';
import type { DuelSession } from '../../src/core/session';
import { createTunables } from '../../src/core/tunables';
import type { BeatGrid, DuelState } from '../../src/core/types';
import type { StartInfo } from '../../src/net/room';
import { ArrivalLog } from '../../src/net/syncStats';
import { createRoomMatch, gridShiftIsSafe } from '../../src/scenes/roomMatch';
import { FakeClock } from '../helpers/fakeClock';

const tunables = createTunables();
const grid: BeatGrid = { bpm: 120, startTime: 0 }; // phrase 2 s

/** The state just after an act ended on phrase 9 (its last defend phrase), the next act starting at phrase 13. */
function betweenActs(): DuelState {
  return {
    ...initialDuelState(tunables, 0, 13),
    act: 1,
    lastActEndPhrase: 9,
    lastActWinner: 0,
    actWins: [1, 0],
  };
}

const safe = (now: number, shiftSec: number, state = betweenActs()) =>
  gridShiftIsSafe({ state, grid, tunables, now, shiftSec });

describe('when the grid may be moved', () => {
  // The act ended with phrase 9, which finishes at 20 s; the next act's first phrase starts at 26 s.
  it('only in the break between acts', () => {
    expect(safe(23, 0.2)).toBe(true);
    expect(safe(23, -0.2)).toBe(true);
  });

  it('never in the first act, mid-act or after an act has already begun', () => {
    expect(safe(23, 0.2, { ...betweenActs(), lastActEndPhrase: null })).toBe(false);
    expect(safe(23, 0.2, { ...betweenActs(), phase: 'defend' })).toBe(false);
    expect(safe(23, 0.2, { ...betweenActs(), phrase: 14 })).toBe(false);
    expect(safe(23, 0.2, { ...betweenActs(), strikes: [{ slot: 0, x: 0.5, y: 0.5 }], results: [null] })).toBe(
      false,
    );
    expect(safe(23, 0.2, { ...betweenActs(), phase: 'matchOver' })).toBe(false);
  });

  it('not while the last act is still on screen, nor when the next one is about to start', () => {
    expect(safe(20.1, 0.2)).toBe(false); // the old defend phrase has only just ended
    expect(safe(25.9, 0.2)).toBe(false); // the count-in is about to begin
    expect(safe(20.5, 0.2)).toBe(true);
    expect(safe(20.5, 0.4)).toBe(false); // a bigger shift needs more room
    expect(phraseStart(grid, 10, tunables)).toBe(20);
    expect(phraseStart(grid, 13, tunables)).toBe(26);
  });

  it('a shift too large for the break is never taken (the drift stays on record)', () => {
    expect(safe(23, 3.2)).toBe(false);
  });
});

/** A guest room match whose room reports a pending shift, with the pieces of the app it touches stubbed. */
function guestMatch(shift: number | null) {
  const clock = new FakeClock(23);
  const played: number[] = [];
  const stopped: number[] = [];
  const accepted: number[] = [];
  let pending = shift;
  const room = {
    role: 'guest',
    localPlayer: 1,
    peerName: 'Host',
    arrivals: new ArrivalLog(),
    on: () => () => undefined,
    pendingGridShiftSec: () => pending,
    acceptGridShift: () => {
      accepted.push(1);
      pending = null;
    },
  };
  const connection = {
    room,
    transport: {},
    name: 'Guest',
    exchange: {
      theme: { info: { bpm: 120, source: 'click', firstBeatOffset: 0 }, buffer: {} },
      view: { peerPuppet: null },
    },
  } as unknown as Connection;
  const engine = {
    clock,
    playLoop: (_b: unknown, opts: { startTime: number }) => {
      played.push(opts.startTime);
      return { stop: () => void stopped.push(played.length) };
    },
  };
  const app = { engine, store: {}, tunables } as unknown as App;
  const info: StartInfo = { grid: { bpm: 120, startTime: 0 }, firstAttacker: 0, firstPhrase: 1 };
  const match = createRoomMatch(app, connection, info);
  const sessionAt = (state: DuelState) => {
    const session = { state, onArrival: null } as unknown as DuelSession;
    match.attach?.(session);
    return session;
  };
  return { match, info, clock, played, stopped, accepted, room, sessionAt };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('a guest room match following the clock estimate between acts', () => {
  it('moves its own grid and restarts the music on it, once, in the break', async () => {
    const g = guestMatch(0.2);
    await settle();
    expect(g.played).toEqual([0]); // the music started on the first grid
    g.sessionAt(betweenActs());
    g.match.tick?.();
    await settle();
    expect(g.info.grid.startTime).toBeCloseTo(0.2);
    expect(g.match.grid.startTime).toBeCloseTo(0.2); // the same object the session reads
    expect(g.accepted).toHaveLength(1);
    expect(g.stopped).toHaveLength(1); // the old copy stopped
    expect(g.played).toHaveLength(2);
    expect(g.played[1]).toBeCloseTo(0.2);
    g.match.tick?.(); // nothing more is pending
    await settle();
    expect(g.played).toHaveLength(2);
  });

  it('leaves the grid alone mid-act', async () => {
    const g = guestMatch(0.2);
    await settle();
    g.sessionAt({ ...betweenActs(), phase: 'defend', phrase: 7, lastActEndPhrase: null });
    g.match.tick?.();
    await settle();
    expect(g.info.grid.startTime).toBe(0);
    expect(g.accepted).toHaveLength(0);
    expect(g.played).toHaveLength(1);
  });

  it('does nothing when the estimate has not moved', async () => {
    const g = guestMatch(null);
    await settle();
    g.sessionAt(betweenActs());
    g.match.tick?.();
    expect(g.info.grid.startTime).toBe(0);
  });

  it('records how the friend messages arrive on the room, through the session hook', () => {
    const g = guestMatch(null);
    const session = g.sessionAt(betweenActs());
    session.onArrival?.('commit', -0.12);
    session.onArrival?.('plant', 0.03);
    expect(g.room.arrivals.latest().commit).toBeCloseTo(-120);
    expect(g.room.arrivals.latest().plant).toBeCloseTo(30);
  });
});
