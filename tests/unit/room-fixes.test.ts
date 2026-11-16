import { describe, expect, it } from 'vitest';
import { createTunables } from '../../src/core/tunables';
import type { Message, ThemeOffer, Transport, Tunables } from '../../src/core/types';
import { createMemoryHub } from '../../src/net/memoryHub';
import { createPairingTransport } from '../../src/net/pairing';
import { Room, type RoomEvent, type StartInfo } from '../../src/net/room';
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
  running: boolean;
}

function rig() {
  const wall = new FakeClock(0);
  const hub = createMemoryHub({ latencySec: LATENCY, clock: wall });
  const deferred: { at: number; fn: () => void }[] = [];
  const defer = (fn: () => void, ms: number) => void deferred.push({ at: wall.now() + ms / 1000, fn });

  const make = (role: 'host' | 'guest', clockStart: number, name: string): Side => {
    const transport = createPairingTransport({ link: hub.join(), role });
    const clock = new FakeClock(clockStart);
    const tunables = createTunables();
    const side = { running: true } as Side;
    const room = new Room({ transport, clock, name, tunables, defer, isClockRunning: () => side.running });
    const events: RoomEvent[] = [];
    const starts: StartInfo[] = [];
    room.on((e) => {
      events.push(e);
      if (e.type === 'start') starts.push(e.info);
    });
    Object.assign(side, { room, transport, clock, tunables, events, starts });
    return side;
  };

  const guestStart = 500;
  const host = make('host', guestStart + DIFF, 'Hosty');
  const guest = make('guest', guestStart, 'Guesty');

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
  return { host, guest, run };
}

const onWire = (t: Transport) => {
  const seen: Message[] = [];
  t.onMessage((m) => seen.push(m));
  return seen;
};

/** Both ready and started. */
function startMatch(r: ReturnType<typeof rig>) {
  r.run(1.5);
  r.host.room.setReady(true);
  r.guest.room.setReady(true);
  r.run(1.2);
  expect(r.host.room.start()).toBe(true);
  r.run(0.3);
  expect(r.host.starts).toHaveLength(1);
}

const gridGap = (a: StartInfo | undefined, b: StartInfo | undefined) =>
  (a?.grid.startTime ?? 0) - (b?.grid.startTime ?? 0);

describe('clock offset recovery', () => {
  it('follows a jump in the host clock (a window, not the all-time best)', () => {
    const r = rig();
    r.run(3);
    expect(r.guest.room.synced).toBe(true);
    expect(Math.abs(r.guest.room.clockOffsetSec - DIFF)).toBeLessThan(0.002);
    r.host.clock.advance(7); // the host's audio clock jumps forward
    r.run(14);
    expect(Math.abs(r.guest.room.clockOffsetSec - (DIFF + 7))).toBeLessThan(0.002);
    expect(r.guest.room.synced).toBe(true);
    const last = [...r.guest.events].reverse().find((e) => e.type === 'synced');
    expect(last?.type === 'synced' && Math.abs(last.offsetSec - (DIFF + 7)) < 0.002).toBe(true);
  });

  it('follows a jump in the guest clock too', () => {
    const r = rig();
    r.run(3);
    r.guest.clock.advance(-20);
    r.run(14);
    expect(Math.abs(r.guest.room.clockOffsetSec - (DIFF + 20))).toBeLessThan(0.002);
  });

  it('does not take a single odd sample for a jump', () => {
    const r = rig();
    r.run(3);
    r.host.clock.advance(0.5);
    r.run(0.05); // one pong could land with the new offset, then it goes back
    r.host.clock.advance(-0.5);
    r.run(8);
    expect(Math.abs(r.guest.room.clockOffsetSec - DIFF)).toBeLessThan(0.002);
    expect(r.guest.room.synced).toBe(true);
  });

  it('keeps following a slow drift', () => {
    const r = rig();
    r.run(3);
    r.run(60, () => r.host.clock.advance(4e-6)); // 4 ms per second
    expect(Math.abs(r.guest.room.clockOffsetSec - (DIFF + 0.24))).toBeLessThan(0.05);
  });

  it('re-syncs before a rematch after the host clock jumped during the match', () => {
    const r = rig();
    startMatch(r);
    r.host.clock.advance(9);
    r.guest.room.requestRematch();
    r.run(1.5);
    r.host.room.requestRematch();
    r.run(0.4);
    expect(r.host.starts).toHaveLength(2);
    expect(r.guest.starts).toHaveLength(2);
    expect(Math.abs(gridGap(r.host.starts[1], r.guest.starts[1]) - (DIFF + 9))).toBeLessThan(0.002);
  });

  it('pings again, slowly, once the lobby is showing after a match', () => {
    const r = rig();
    startMatch(r);
    const seen = onWire(r.host.transport);
    r.run(12);
    // Through the match only the slow ping (one every 4 s), never the lobby's bursts.
    expect(seen.filter((m) => m.t === 'ping').length).toBeLessThanOrEqual(4);
    r.guest.room.resumeLobby();
    r.run(12);
    expect(seen.filter((m) => m.t === 'ping').length).toBeGreaterThanOrEqual(8 + 2);
  });

  it('takes a fresh burst when Ready is pressed and when a rematch is asked for', () => {
    const r = rig();
    r.run(3);
    const seen = onWire(r.host.transport);
    r.guest.room.setReady(true);
    r.run(1.5);
    expect(seen.filter((m) => m.t === 'ping').length).toBeGreaterThanOrEqual(8);
  });
});

describe('a clock that is not running', () => {
  it('a guest whose clock is stopped sends no pings, and syncs once it runs', () => {
    const r = rig();
    r.guest.running = false;
    const seen = onWire(r.host.transport);
    r.run(3);
    expect(seen.filter((m) => m.t === 'ping')).toHaveLength(0);
    expect(r.guest.room.synced).toBe(false);
    r.guest.running = true;
    r.run(3);
    expect(r.guest.room.synced).toBe(true);
    expect(Math.abs(r.guest.room.clockOffsetSec - DIFF)).toBeLessThan(0.002);
  });

  it('a host whose clock is stopped does not answer pings', () => {
    const r = rig();
    r.host.running = false;
    const seen = onWire(r.guest.transport);
    r.run(3);
    expect(seen.filter((m) => m.t === 'pong')).toHaveLength(0);
    expect(r.guest.room.synced).toBe(false);
    r.host.running = true;
    r.run(4);
    expect(r.guest.room.synced).toBe(true);
    expect(Math.abs(r.guest.room.clockOffsetSec - DIFF)).toBeLessThan(0.002);
  });

  it('throws away samples whose round trip spanned a stop of the local clock', () => {
    const r = rig();
    r.run(0.1); // hello exchanged, first ping on its way
    r.guest.running = false;
    r.run(0.4); // its pong arrives while the clock is stopped
    expect(r.guest.room.rttMs).toBeNull();
    r.guest.running = true;
    r.run(3);
    expect(r.guest.room.synced).toBe(true);
    expect(Math.abs(r.guest.room.clockOffsetSec - DIFF)).toBeLessThan(0.002);
  });

  it('the host will not start on a stopped clock, and the guest measures again after a restart', () => {
    const r = rig();
    r.run(1.5);
    r.host.room.setReady(true);
    r.guest.room.setReady(true);
    r.run(1.2);
    r.host.running = false;
    r.run(0.5);
    expect(r.host.room.start()).toBe(false);
    r.host.clock.advance(30); // the clock was away for a while
    r.host.running = true;
    r.run(0.4); // the restart is noticed and the guest is asked to measure again
    expect(r.guest.room.synced).toBe(false);
    expect(r.host.room.start()).toBe(false); // the guest has withdrawn its ready until it has
    r.run(2);
    expect(r.guest.room.synced).toBe(true);
    expect(r.host.room.start()).toBe(true);
    r.run(0.3);
    expect(r.host.starts).toHaveLength(1);
    expect(Math.abs(gridGap(r.host.starts[0], r.guest.starts[0]) - (DIFF + 30))).toBeLessThan(0.002);
  });

  it('a rematch waits for the guest to measure again after a host clock restart, then goes', () => {
    const r = rig();
    startMatch(r);
    r.host.running = false;
    r.run(0.4);
    r.host.clock.advance(20);
    r.host.running = true;
    r.run(0.5);
    r.guest.room.requestRematch();
    r.host.room.requestRematch();
    r.run(0.4);
    expect(r.host.starts).toHaveLength(1); // holding for the guest's fresh measurement
    r.run(2);
    expect(r.host.starts).toHaveLength(2);
    expect(r.guest.starts).toHaveLength(2);
    expect(Math.abs(gridGap(r.host.starts[1], r.guest.starts[1]) - (DIFF + 20))).toBeLessThan(0.002);
  });

  it('a rematch is never held for good: it goes ahead after a bounded wait', () => {
    const r = rig();
    startMatch(r);
    r.host.running = false;
    r.run(0.4);
    r.host.running = true;
    r.run(0.5);
    r.guest.room.requestRematch();
    r.guest.running = false; // the guest cannot measure
    r.host.room.requestRematch();
    r.run(3);
    expect(r.host.starts).toHaveLength(1);
    r.run(1);
    expect(r.host.starts).toHaveLength(2);
    expect(r.guest.starts).toHaveLength(2);
  });
});

describe('what the other player sends', () => {
  it('cleans a long or control-character name', () => {
    const r = rig();
    r.run(0.5);
    r.guest.transport.send({ t: 'hello', name: `‮${'x'.repeat(60)}\u0007\u0000`, v: 1 });
    r.run(0.2);
    expect(r.host.room.peerName).toBe('x'.repeat(20));
    r.guest.transport.send({ t: 'hello', name: '‮\u0007', v: 1 });
    r.run(0.2);
    expect(r.host.room.peerName).toBe('Player');
    expect(
      r.host.events.filter((e) => e.type === 'peer').every((e) => e.type === 'peer' && e.name.length <= 20),
    ).toBe(true);
  });

  it('caps the theme title', () => {
    const r = rig();
    r.run(0.5);
    r.host.room.setTheme({
      source: 'house',
      id: 'long',
      title: `${'T'.repeat(300)}‮`,
      bpm: 100,
      firstBeatOffset: 0,
    });
    r.run(0.2);
    expect(r.guest.room.theme?.id).toBe('long');
    expect(r.guest.room.theme?.title).toBe('T'.repeat(80));
  });

  it('ignores tunables that are out of range or not whole where they must be', () => {
    const r = rig();
    r.run(0.5);
    const before = { ...r.guest.tunables };
    const send = (patch: Record<string, unknown>) => {
      r.host.transport.send({
        t: 'tunables',
        tunables: { ...r.host.tunables, ...patch } as unknown as Tunables,
      });
      r.run(0.2);
    };
    send({ slotsPerBeat: 1e9 });
    send({ slotsPerBeat: 2.5 });
    send({ startHealth: -4 });
    send({ goodWindowMs: 1e6 });
    send({ beatsPerPhrase: 0 });
    expect(r.guest.tunables).toEqual(before);
    send({ startHealth: 55, slotsPerBeat: 3 });
    expect(r.guest.tunables.startHealth).toBe(55);
    expect(r.guest.tunables.slotsPerBeat).toBe(3);
  });

  it('ignores a theme with a tempo or first beat out of bounds', () => {
    const r = rig();
    r.run(0.5);
    const before = r.guest.room.theme;
    const offer = (patch: Partial<ThemeOffer>) => {
      r.host.transport.send({
        t: 'theme',
        theme: { source: 'upload', id: 'u', title: 'U', hash: 'h', bpm: 120, firstBeatOffset: 0.1, ...patch },
      });
      r.run(0.2);
    };
    offer({ bpm: 5 });
    offer({ bpm: 5000 });
    offer({ bpm: 70 });
    offer({ firstBeatOffset: -1 });
    offer({ firstBeatOffset: 1e9 });
    offer({ bpm: Number.NaN });
    expect(r.guest.room.theme).toEqual(before);
    offer({ bpm: 120, firstBeatOffset: 0.25 });
    expect(r.guest.room.theme?.id).toBe('u');
  });

  it('keeps a two-decimal tempo in a theme offer and in the start message', () => {
    const r = rig();
    r.run(0.5);
    r.host.transport.send({
      t: 'theme',
      theme: { source: 'upload', id: 'fast', title: 'Fast', hash: 'h', bpm: 222.22, firstBeatOffset: 0.1 },
    });
    r.run(0.2);
    expect(r.guest.room.theme?.bpm).toBe(222.22);
    r.host.room.setTheme({
      source: 'upload',
      id: 'fast',
      title: 'Fast',
      hash: 'h',
      bpm: 222.22,
      firstBeatOffset: 0.1,
    });
    startMatch(r);
    expect(r.host.starts[0]?.grid.bpm).toBe(222.22);
    expect(r.guest.starts[0]?.grid.bpm).toBe(222.22);
  });

  it('refuses a start with a bad first phrase, tempo or attacker, and accepts a good one', () => {
    const r = rig();
    r.run(1.5);
    const start = (patch: Record<string, unknown>) => {
      r.host.transport.send({
        t: 'start',
        startTime: r.host.clock.now() + 3,
        bpm: 120,
        firstAttacker: 0,
        firstPhrase: 1,
        ...patch,
      } as unknown as Message);
      r.run(0.2);
    };
    start({ firstPhrase: -1 });
    start({ firstPhrase: 1.5 });
    start({ firstPhrase: 2 ** 60 });
    start({ firstPhrase: '1' });
    start({ bpm: 1000 });
    start({ bpm: 5 });
    start({ bpm: -120 });
    start({ firstAttacker: 2 });
    expect(r.guest.starts).toHaveLength(0);
    start({});
    expect(r.guest.starts).toHaveLength(1);
  });
});

describe('rematch', () => {
  it('a withdrawn request does not start anything when the friend then asks', () => {
    const r = rig();
    startMatch(r);
    r.host.room.requestRematch();
    r.run(0.2);
    r.host.room.cancelRematch(); // back to the room
    r.run(0.2);
    expect(r.guest.events.some((e) => e.type === 'rematch' && !e.peer && e.peerBack)).toBe(true);
    r.guest.room.requestRematch();
    r.run(0.5);
    expect(r.host.starts).toHaveLength(1);
    expect(r.guest.starts).toHaveLength(1);
  });

  it('reports a friend who went back to the room, and clears it when they ask again', () => {
    const r = rig();
    startMatch(r);
    r.guest.room.requestRematch();
    r.run(0.2);
    r.guest.room.cancelRematch();
    r.run(0.2);
    const last = [...r.host.events].reverse().find((e) => e.type === 'rematch');
    expect(last).toMatchObject({ peer: false, peerBack: true });
    r.guest.room.requestRematch();
    r.run(0.2);
    const again = [...r.host.events].reverse().find((e) => e.type === 'rematch');
    expect(again).toMatchObject({ peer: true, peerBack: false });
  });

  it('asking twice sends one request', () => {
    const r = rig();
    startMatch(r);
    const seen = onWire(r.host.transport);
    r.guest.room.requestRematch();
    r.guest.room.requestRematch();
    r.run(0.3);
    expect(seen.filter((m) => m.t === 'rematch')).toHaveLength(1);
  });

  it('the host starts only when the start gate allows, and once when it opens', () => {
    const r = rig();
    startMatch(r);
    let open = false;
    r.host.room.setStartGate(() => open);
    r.guest.room.requestRematch();
    r.host.room.requestRematch();
    r.run(0.5);
    expect(r.host.starts).toHaveLength(1);
    open = true;
    r.host.room.retryRematch();
    r.run(0.3);
    expect(r.host.starts).toHaveLength(2);
    expect(r.guest.starts).toHaveLength(2);
    r.host.room.retryRematch();
    r.run(0.3);
    expect(r.host.starts).toHaveLength(2);
  });

  it('a theme changed in the room while the rematch was withdrawn blocks a late request', () => {
    const r = rig();
    startMatch(r);
    r.host.room.requestRematch();
    r.run(0.2);
    r.host.room.cancelRematch();
    r.host.room.setTheme({ source: 'house', id: 'new', title: 'New', bpm: 100, firstBeatOffset: 0 });
    r.run(0.3);
    r.guest.room.requestRematch(); // the friend, still on the victory screen, asks late
    r.run(0.5);
    expect(r.host.starts).toHaveLength(1);
  });
});
