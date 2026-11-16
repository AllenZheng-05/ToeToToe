import { describe, expect, it } from 'vitest';
import { DuelSession, type SessionEvent } from '../../src/core/session';
import { createTunables } from '../../src/core/tunables';
import type { Transport, Tunables } from '../../src/core/types';
import { BotDriver } from '../../src/net/bot';
import { createMemoryHub } from '../../src/net/memoryHub';
import { createPairingTransport } from '../../src/net/pairing';
import { PROTOCOL_VERSION, Room, type RoomEvent, type StartInfo } from '../../src/net/room';
import { FakeClock } from '../helpers/fakeClock';

const DIFF = 1234.5; // host clock minus guest clock
const LATENCY = 0.04;
const STEP = 0.001;

interface Side {
  room: Room;
  transport: Transport;
  clock: FakeClock;
  tunables: Tunables;
  events: RoomEvent[];
  starts: StartInfo[];
}

function rig(opts: { hostTunables?: Partial<Tunables>; guestTunables?: Partial<Tunables> } = {}) {
  const wall = new FakeClock(0);
  const hub = createMemoryHub({ latencySec: LATENCY, clock: wall });
  const deferred: { at: number; fn: () => void }[] = [];
  const defer = (fn: () => void, ms: number) => void deferred.push({ at: wall.now() + ms / 1000, fn });

  const make = (role: 'host' | 'guest', clockStart: number, name: string, tun: Partial<Tunables>): Side => {
    const transport = createPairingTransport({ link: hub.join(), role });
    const clock = new FakeClock(clockStart);
    const tunables = createTunables(tun);
    const room = new Room({ transport, clock, name, tunables, defer });
    const events: RoomEvent[] = [];
    const starts: StartInfo[] = [];
    room.on((e) => {
      events.push(e);
      if (e.type === 'start') starts.push(e.info);
    });
    return { room, transport, clock, tunables, events, starts };
  };

  const guestStart = 500;
  const host = make('host', guestStart + DIFF, 'Hosty', opts.hostTunables ?? {});
  const guest = make('guest', guestStart, 'Guesty', opts.guestTunables ?? {});

  /** Move all clocks together by `sec`, in small steps, delivering traffic and due deferred callbacks. */
  const run = (sec: number, each?: () => void) => {
    const n = Math.round(sec / STEP);
    for (let i = 0; i < n; i++) {
      wall.advance(STEP);
      host.clock.advance(STEP);
      guest.clock.advance(STEP);
      hub.pump();
      for (;;) {
        const idx = deferred.findIndex((d) => d.at <= wall.now() + 1e-9);
        if (idx < 0) break;
        const [d] = deferred.splice(idx, 1);
        d?.fn();
      }
      each?.();
    }
  };
  return { host, guest, run, wall };
}

/** Both players ready, guest synced; returns after the start events arrived. */
function startMatch(r: ReturnType<typeof rig>) {
  r.run(1.5);
  r.host.room.setReady(true);
  r.guest.room.setReady(true);
  r.run(0.2);
  expect(r.host.room.start()).toBe(true);
  r.run(0.2);
}

describe('Room handshake', () => {
  it('exchanges names, roles and the default theme', () => {
    const r = rig();
    r.run(0.5);
    expect(r.host.room.role).toBe('host');
    expect(r.guest.room.role).toBe('guest');
    expect(r.host.room.localPlayer).toBe(0);
    expect(r.guest.room.localPlayer).toBe(1);
    expect(r.host.room.peerName).toBe('Guesty');
    expect(r.guest.room.peerName).toBe('Hosty');
    expect(r.guest.room.theme).toEqual(r.host.room.theme);
    expect(r.host.room.theme?.source).toBe('click');
    expect(r.host.room.theme?.bpm).toBe(120);
    expect(r.guest.events.some((e) => e.type === 'theme')).toBe(true);
    r.guest.room.setName('Renamed');
    r.run(0.2);
    expect(r.host.room.peerName).toBe('Renamed');
  });

  it('reports a protocol version mismatch and does not proceed', () => {
    const r = rig();
    r.run(0.3);
    r.guest.transport.send({ t: 'hello', name: 'Old', v: PROTOCOL_VERSION + 1 });
    r.run(0.2);
    expect(r.host.events.some((e) => e.type === 'versionMismatch')).toBe(true);
    r.guest.room.setReady(true);
    r.host.room.setReady(true);
    r.run(0.2);
    expect(r.host.room.start()).toBe(false);
  });

  it('passes a host theme change to the guest', () => {
    const r = rig();
    r.run(0.3);
    r.host.room.setTheme({ source: 'house', id: 'x', title: 'X', bpm: 100, firstBeatOffset: 0.2 });
    r.run(0.2);
    expect(r.guest.room.theme?.id).toBe('x');
    expect(r.guest.events.filter((e) => e.type === 'theme')).toHaveLength(2);
  });
});

describe('Room clock sync', () => {
  it('converges to the true offset with symmetric latency', () => {
    const r = rig();
    expect(r.guest.room.synced).toBe(false);
    r.run(2);
    expect(r.guest.room.synced).toBe(true);
    expect(r.host.room.synced).toBe(true);
    expect(Math.abs(r.guest.room.clockOffsetSec - DIFF)).toBeLessThan(0.002);
    expect(r.host.room.clockOffsetSec).toBe(0);
    expect(r.guest.room.rttMs).toBeGreaterThan(70);
    expect(r.guest.room.rttMs).toBeLessThan(90);
    const synced = r.guest.events.filter((e) => e.type === 'synced');
    expect(synced.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps pinging every few seconds in the lobby, and only slowly (no bursts) through a match', () => {
    const r = rig();
    const pings = () => {
      let n = 0;
      r.host.transport.onMessage((m) => void (m.t === 'ping' && n++));
      return () => n;
    };
    const count = pings();
    r.run(2);
    const afterBurst = count();
    r.run(11);
    expect(count()).toBeGreaterThanOrEqual(afterBurst + 2);
    r.host.room.setReady(true);
    r.guest.room.setReady(true);
    r.run(0.2);
    r.host.room.start();
    r.run(0.2);
    const atStart = count();
    r.run(12);
    // One ping every 4 s through the match: it keeps the drift on record and never plays a burst.
    expect(count() - atStart).toBeGreaterThanOrEqual(2);
    expect(count() - atStart).toBeLessThanOrEqual(4);
  });
});

describe('Room ready and start', () => {
  it('holds a guest ready until synced', () => {
    const r = rig();
    r.run(0.2); // open, hello exchanged, burst under way
    r.guest.room.setReady(true);
    expect(r.guest.room.localReady).toBe(true);
    r.run(0.3);
    expect(r.guest.room.synced).toBe(false);
    expect(r.host.room.peerReady).toBe(false);
    r.run(1.5);
    expect(r.guest.room.synced).toBe(true);
    expect(r.host.room.peerReady).toBe(true);
    r.guest.room.setReady(false);
    r.run(0.2);
    expect(r.host.room.peerReady).toBe(false);
  });

  it('refuses to start until both are ready, and the guest cannot start', () => {
    const r = rig();
    r.run(1.5);
    expect(r.host.room.start()).toBe(false);
    r.host.room.setReady(true);
    expect(r.host.room.start()).toBe(false);
    expect(r.guest.room.start()).toBe(false);
    r.guest.room.setReady(true);
    r.run(0.2);
    expect(r.guest.room.start()).toBe(false);
    expect(r.host.room.start()).toBe(true);
    expect(r.host.starts).toHaveLength(1);
  });

  it('gives both sides grids describing the same instant', () => {
    const r = rig({ hostTunables: { countInPhrases: 2 } });
    const hostNow = r.host.clock.now();
    startMatch(r);
    expect(r.host.starts).toHaveLength(1);
    expect(r.guest.starts).toHaveLength(1);
    const h = r.host.starts[0] as StartInfo;
    const g = r.guest.starts[0] as StartInfo;
    expect(Math.abs(h.grid.startTime - g.grid.startTime - DIFF)).toBeLessThan(0.002);
    expect(h.grid.startTime).toBeGreaterThan(hostNow + 2);
    expect(h.grid.bpm).toBe(120);
    expect(g.grid.bpm).toBe(120);
    expect(h.firstAttacker).toBe(0);
    expect(g.firstAttacker).toBe(0);
    expect(h.firstPhrase).toBe(2);
    expect(g.firstPhrase).toBe(2);
    // flags reset
    expect(r.host.room.localReady).toBe(false);
    expect(r.guest.room.localReady).toBe(false);
    expect(r.host.room.peerReady).toBe(false);
    expect(r.guest.room.peerReady).toBe(false);
  });

  it('folds the theme bpm into range', () => {
    const r = rig();
    r.run(0.3);
    r.host.room.setTheme({ source: 'house', id: 'f', title: 'Fast', bpm: 280, firstBeatOffset: 0 });
    startMatch(r);
    expect(r.host.starts[0]?.grid.bpm).toBe(140);
    expect(r.guest.starts[0]?.grid.bpm).toBe(140);
  });

  it('overwrites the guest tunables in place with the hosts', () => {
    const r = rig({
      hostTunables: { bravoWindowMs: 60, countInPhrases: 2 },
      guestTunables: { bravoWindowMs: 10 },
    });
    const ref = r.guest.tunables;
    r.run(0.3);
    expect(r.guest.tunables.bravoWindowMs).toBe(60);
    startMatch(r);
    expect(r.guest.tunables).toBe(ref);
    expect(r.guest.tunables).toEqual(r.host.tunables);
  });
});

describe('Room full match', () => {
  it('plays two sessions with different clocks to the same matchOver state', () => {
    const r = rig();
    startMatch(r);
    const makeSession = (side: Side, player: 0 | 1) => {
      const info = side.starts[0] as StartInfo;
      const session = new DuelSession({
        localPlayer: player,
        clock: side.clock,
        grid: info.grid,
        transport: side.transport,
        tunables: side.tunables,
        firstAttacker: info.firstAttacker,
        firstPhrase: info.firstPhrase,
      });
      const driver = new BotDriver(
        session,
        { clock: side.clock, grid: info.grid, tunables: side.tunables },
        { seed: player + 5 },
      );
      const events: SessionEvent[] = [];
      session.on((e) => events.push(e));
      return { session, driver, events };
    };
    const h = makeSession(r.host, 0);
    const g = makeSession(r.guest, 1);

    const frame = () => {
      h.session.update();
      g.session.update();
      h.driver.update();
      g.driver.update();
    };
    for (
      let i = 0;
      i < 1200 && !(h.session.state.phase === 'matchOver' && g.session.state.phase === 'matchOver');
      i++
    ) {
      r.run(0.5, frame);
    }
    expect(h.session.state.phase).toBe('matchOver');
    expect(g.session.state.phase).toBe('matchOver');
    // let the last messages land
    r.run(0.2, frame);
    expect(g.session.state).toEqual(h.session.state);
    expect(h.events.some((e) => e.type === 'desync')).toBe(false);
    expect(g.events.some((e) => e.type === 'desync')).toBe(false);
    expect(h.events.some((e) => e.type === 'matchOver')).toBe(true);
    expect(g.events.some((e) => e.type === 'matchOver')).toBe(true);
  }, 120_000);
});

describe('Room rematch and leaving', () => {
  it('starts a new match when both ask, flipping the first attacker', () => {
    const r = rig();
    startMatch(r);
    r.guest.room.requestRematch();
    r.run(0.2);
    expect(r.host.starts).toHaveLength(1);
    expect(r.host.room.peerReady).toBe(false);
    expect(r.host.events.some((e) => e.type === 'rematch' && e.peer && !e.local)).toBe(true);
    r.host.room.requestRematch();
    r.run(0.2);
    expect(r.host.starts).toHaveLength(2);
    expect(r.guest.starts).toHaveLength(2);
    expect(r.host.starts[1]?.firstAttacker).toBe(1);
    expect(r.guest.starts[1]?.firstAttacker).toBe(1);
    const dt = (r.host.starts[1]?.grid.startTime ?? 0) - (r.guest.starts[1]?.grid.startTime ?? 0);
    expect(Math.abs(dt - DIFF)).toBeLessThan(0.002);
    // and flips back on the next one
    r.host.room.requestRematch();
    r.guest.room.requestRematch();
    r.run(0.2);
    expect(r.host.starts[2]?.firstAttacker).toBe(0);
    expect(r.guest.starts[2]?.firstAttacker).toBe(0);
  });

  it('tells the other side when a player leaves', () => {
    const r = rig();
    r.run(1);
    r.guest.room.leave();
    r.run(0.2);
    expect(r.host.events.some((e) => e.type === 'state' && e.state === 'closed')).toBe(true);
    expect(r.host.transport.state).toBe('closed');
    expect(r.host.events.filter((e) => e.type === 'state' && e.state === 'closed')).toHaveLength(1);

    const r2 = rig();
    r2.run(1);
    r2.host.room.leave();
    r2.run(0.2);
    expect(r2.guest.events.some((e) => e.type === 'state' && e.state === 'closed')).toBe(true);
  });

  it('reports the transport closing without a leave message', () => {
    const r = rig();
    r.run(1);
    r.guest.transport.close();
    r.run(0.2);
    expect(r.host.events.some((e) => e.type === 'state' && e.state === 'closed')).toBe(true);
  });
});
