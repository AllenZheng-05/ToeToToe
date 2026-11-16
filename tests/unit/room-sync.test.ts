import { describe, expect, it } from 'vitest';
import { createTunables } from '../../src/core/tunables';
import type {
  BlobMeta,
  Message,
  Transport,
  TransportState,
  Tunables,
  Unsubscribe,
} from '../../src/core/types';
import { Room, type RoomEvent, type StartInfo } from '../../src/net/room';
import { FakeClock } from '../helpers/fakeClock';

const HOST_AHEAD = 1234.5; // host clock minus guest clock, true value
const STEP = 0.001;

/** One direction's delay in seconds for a message sent at true time `t`. */
type Delay = (t: number, msg: Message, n: number) => number;

class End implements Transport {
  state: TransportState = 'open';
  readonly rttMs = null;
  peer!: End;
  readonly seen: Message[] = [];
  private cbs = new Set<(m: Message) => void>();
  constructor(
    readonly role: 'host' | 'guest',
    private readonly queue: { due: number; to: End; msg: Message }[],
    private readonly now: () => number,
    private readonly delay: () => Delay,
  ) {}
  sent = 0;
  send(msg: Message): void {
    const n = this.sent++;
    this.queue.push({
      due: this.now() + this.delay()(this.now(), msg, n),
      to: this.peer,
      msg: structuredClone(msg),
    });
  }
  sendBlob(_d: ArrayBuffer, _m: BlobMeta): Promise<void> {
    return Promise.resolve();
  }
  onMessage(cb: (m: Message) => void): Unsubscribe {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }
  onBlob(): Unsubscribe {
    return () => undefined;
  }
  onBlobProgress(): Unsubscribe {
    return () => undefined;
  }
  onState(): Unsubscribe {
    return () => undefined;
  }
  close(): void {
    this.state = 'closed';
  }
  deliver(msg: Message): void {
    this.seen.push(msg);
    for (const cb of [...this.cbs]) cb(msg);
  }
}

interface Rig {
  host: Room;
  guest: Room;
  hostEnd: End;
  guestEnd: End;
  hostClock: FakeClock;
  guestClock: FakeClock;
  hostTun: Tunables;
  guestTun: Tunables;
  guestEvents: RoomEvent[];
  starts: { host: StartInfo[]; guest: StartInfo[] };
  /** Whether files are moving (read by the guest room). */
  transfers: { active: boolean };
  /** Hand the guest room a change in the transfer state. */
  setTransfers(active: boolean): void;
  run(sec: number, each?: () => void): void;
  now(): number;
}

function rig(opts: {
  /** Guest to host delay. */
  toHost?: Delay;
  /** Host to guest delay. */
  toGuest?: Delay;
  withTransferGate?: boolean;
}): Rig {
  let wall = 0;
  const queue: { due: number; to: End; msg: Message }[] = [];
  const deferred: { at: number; fn: () => void }[] = [];
  const defer = (fn: () => void, ms: number) => void deferred.push({ at: wall + ms / 1000, fn });
  const toHost = opts.toHost ?? (() => 0.02);
  const toGuest = opts.toGuest ?? (() => 0.02);
  const hostEnd = new End(
    'host',
    queue,
    () => wall,
    () => toGuest,
  );
  const guestEnd = new End(
    'guest',
    queue,
    () => wall,
    () => toHost,
  );
  hostEnd.peer = guestEnd;
  guestEnd.peer = hostEnd;
  const hostClock = new FakeClock(HOST_AHEAD);
  const guestClock = new FakeClock(0);
  const hostTun = createTunables();
  const guestTun = createTunables();
  const transfers = { active: false };
  const host = new Room({ transport: hostEnd, clock: hostClock, name: 'H', tunables: hostTun, defer });
  const guest = new Room({
    transport: guestEnd,
    clock: guestClock,
    name: 'G',
    tunables: guestTun,
    defer,
    ...(opts.withTransferGate ? { transfersActive: () => transfers.active } : {}),
  });
  const guestEvents: RoomEvent[] = [];
  const starts = { host: [] as StartInfo[], guest: [] as StartInfo[] };
  guest.on((e) => {
    guestEvents.push(e);
    if (e.type === 'start') starts.guest.push(e.info);
  });
  host.on((e) => {
    if (e.type === 'start') starts.host.push(e.info);
  });
  const run = (sec: number, each?: () => void): void => {
    const n = Math.round(sec / STEP);
    for (let i = 0; i < n; i++) {
      wall += STEP;
      hostClock.advance(STEP);
      guestClock.advance(STEP);
      queue.sort((a, b) => a.due - b.due);
      while (queue.length > 0 && (queue[0] as { due: number }).due <= wall + 1e-9) {
        const q = queue.shift() as { to: End; msg: Message };
        q.to.deliver(q.msg);
      }
      for (;;) {
        const idx = deferred.findIndex((d) => d.at <= wall + 1e-9);
        if (idx < 0) break;
        const [d] = deferred.splice(idx, 1);
        d?.fn();
      }
      each?.();
    }
  };
  return {
    host,
    guest,
    hostEnd,
    guestEnd,
    hostClock,
    guestClock,
    hostTun,
    guestTun,
    guestEvents,
    starts,
    transfers,
    setTransfers: (active) => {
      transfers.active = active;
      guest.transfersChanged();
    },
    run,
    now: () => wall,
  };
}

const err = (r: Rig) => Math.abs(r.guest.clockOffsetSec - HOST_AHEAD);
const readyMessages = (r: Rig): boolean[] =>
  r.hostEnd.seen.flatMap((m) => (m.t === 'ready' ? [m.ready] : []));

describe('the clock estimate with unequal delays', () => {
  it('stays within half the best round trip plus a few ms, with a burst of delayed samples at the start', () => {
    // 20 ms there, 60 ms back; for the first 1.5 s everything coming back is held behind a "file" (400 ms).
    const r = rig({
      toHost: () => 0.02,
      toGuest: (t) => (t < 1.5 ? 0.4 : 0.06),
    });
    r.run(12);
    expect(r.guest.synced).toBe(true);
    const best = r.guest.syncStats.bestRttMs / 1000;
    expect(best).toBeLessThan(0.1);
    expect(err(r)).toBeLessThan(best / 2 + 0.004);
    expect(readyMessages(r)).toEqual([]);
  });

  it('Ready does not flicker when better samples follow a bad first burst', () => {
    // No transfer gate here: the first burst is slow (as if behind a file), then the link is quick.
    const r = rig({ toHost: () => 0.02, toGuest: (t) => (t < 1.5 ? 0.4 : 0.02) });
    r.run(0.3);
    r.guest.setReady(true); // held until the first burst has an estimate
    r.run(15);
    expect(r.guest.synced).toBe(true);
    expect(readyMessages(r)).toEqual([true]);
    expect(err(r)).toBeLessThan(0.002); // the quick samples took over
  });

  it('a pair of slow outliers does not move the estimate', () => {
    let n = 0;
    const r = rig({
      toHost: () => 0.02,
      // pongs numbered 12 and 13 take 350 ms
      toGuest: (_t, msg) => (msg.t === 'pong' && (n++ === 12 || n === 14) ? 0.35 : 0.04),
    });
    r.run(6);
    const before = r.guest.clockOffsetSec;
    // more pongs, including the two slow ones
    r.run(25);
    expect(err(r)).toBeLessThan(0.02);
    expect(Math.abs(r.guest.clockOffsetSec - before)).toBeLessThan(0.002);
    expect(r.guest.synced).toBe(true);
    expect(r.guest.syncStats.jumps).toBe(0);
  });

  it('two slow outliers in a row, agreeing with each other, are still not taken for a jump', () => {
    let slow = 0;
    const r = rig({
      toHost: () => 0.02,
      toGuest: (_t, msg) => {
        if (msg.t !== 'pong') return 0.02;
        return slow > 0 && slow-- > 0 ? 0.3 : 0.02;
      },
    });
    r.run(4);
    slow = 2;
    r.guest.resumeLobby(); // a burst: the next two pongs are slow
    r.run(4);
    expect(err(r)).toBeLessThan(0.002);
    expect(r.guest.syncStats.jumps).toBe(0);
    expect(readyMessages(r)).toEqual([]);
  });

  it('a real jump in the host clock is followed within one burst, and only then does Ready drop', () => {
    const r = rig({});
    r.run(3);
    r.guest.setReady(true);
    r.run(1.2);
    expect(r.guest.synced).toBe(true);
    expect(readyMessages(r)).toEqual([true]);
    r.hostClock.advance(0.3);
    // The next ping (the lobby rate is one every 5 s) sees it; a burst after that has the estimate again.
    r.run(8);
    expect(Math.abs(r.guest.clockOffsetSec - (HOST_AHEAD + 0.3))).toBeLessThan(0.003);
    expect(r.guest.synced).toBe(true);
    expect(r.guest.syncStats.jumps).toBe(1);
    // Ready went off once, for the confirmed jump, and back on after the fresh burst.
    expect(readyMessages(r)).toEqual([true, false, true]);
  });

  it('a single odd sample (a suspect) does not toggle Ready', () => {
    const r = rig({});
    r.run(3);
    r.guest.setReady(true);
    r.run(1.2);
    // One pong carries a host time that is 0.5 s off, then it is back to normal.
    r.hostClock.advance(0.5);
    r.run(0.05);
    r.hostClock.advance(-0.5);
    r.run(10);
    expect(err(r)).toBeLessThan(0.002);
    expect(readyMessages(r)).toEqual([true]);
    expect(r.guest.synced).toBe(true);
  });
});

describe('measuring while files move', () => {
  it('sends no pings and keeps no samples while transfers are active, then takes a fresh burst when they end', () => {
    const r = rig({ withTransferGate: true, toGuest: () => 0.03 });
    r.run(0.05);
    r.setTransfers(true);
    r.run(6);
    const pingsWhile = r.hostEnd.seen.filter((m) => m.t === 'ping').length;
    expect(pingsWhile).toBeLessThanOrEqual(1); // at most the one already out when the files began
    expect(r.guest.synced).toBe(false); // nothing measured yet
    r.setTransfers(false);
    r.run(2);
    expect(r.hostEnd.seen.filter((m) => m.t === 'ping').length).toBeGreaterThanOrEqual(pingsWhile + 8);
    expect(r.guest.synced).toBe(true);
    expect(err(r)).toBeLessThan(0.005 + 0.0001); // 10 ms apart in the two directions
  });

  it('discards a sample whose round trip spanned the start of a transfer', () => {
    const r = rig({ withTransferGate: true, toGuest: (t) => (t > 3 && t < 4 ? 0.5 : 0.02) });
    r.run(3.0);
    const discarded = r.guest.syncStats.discarded;
    r.guest.resumeLobby(); // a burst: its pongs now take half a second
    r.run(0.2);
    r.setTransfers(true); // while those pongs are in flight
    r.run(1);
    r.setTransfers(false);
    r.run(6);
    expect(r.guest.syncStats.discarded).toBeGreaterThan(discarded);
    expect(err(r)).toBeLessThan(0.002);
    expect(r.guest.synced).toBe(true);
  });

  it('a fresh burst before the start reflects what the clocks are now', () => {
    const r = rig({ withTransferGate: true });
    r.run(3);
    r.setTransfers(true);
    r.run(1);
    r.hostClock.advance(0.25); // the clocks moved apart while files were moving
    r.setTransfers(false);
    r.run(2.5);
    expect(Math.abs(r.guest.clockOffsetSec - (HOST_AHEAD + 0.25))).toBeLessThan(0.003);
  });
});

/** Both ready and started. */
function startMatch(r: Rig): void {
  r.run(1.5);
  r.host.setReady(true);
  r.guest.setReady(true);
  r.run(1.2);
  expect(r.host.start()).toBe(true);
  r.run(0.3);
  expect(r.starts.guest).toHaveLength(1);
}

describe('syncing during a match', () => {
  it('pings now and then, without a burst, and never touches Ready or synced', () => {
    const r = rig({});
    startMatch(r);
    const before = r.hostEnd.seen.filter((m) => m.t === 'ping').length;
    r.run(20);
    const pings = r.hostEnd.seen.filter((m) => m.t === 'ping').length - before;
    expect(pings).toBeGreaterThanOrEqual(3);
    expect(pings).toBeLessThanOrEqual(8);
    expect(r.guest.synced).toBe(true);
    expect(readyMessages(r).every((x) => x === true)).toBe(true);
  });

  it('records a drift, offers the correction, and never moves the grid itself', () => {
    const r = rig({});
    startMatch(r);
    const grid = r.starts.guest[0]!.grid;
    const startTime = grid.startTime;
    expect(r.guest.syncStats.driftMs).toBe(0);
    expect(r.guest.pendingGridShiftSec()).toBeNull();
    r.hostClock.advance(0.2); // the host's clock moves away mid-match
    r.run(20);
    expect(r.guest.synced).toBe(true);
    expect(Math.abs((r.guest.syncStats.driftMs ?? 0) - 200)).toBeLessThan(3);
    const shift = r.guest.pendingGridShiftSec();
    expect(shift).not.toBeNull();
    expect(Math.abs((shift ?? 0) + 0.2)).toBeLessThan(0.003);
    expect(grid.startTime).toBe(startTime); // the room never moves a grid in play
    // Taking the correction is up to the match, between acts: once taken it is no longer pending.
    r.guest.acceptGridShift();
    expect(r.guest.pendingGridShiftSec()).toBeNull();
    expect(r.guest.syncStats.gridShifts).toBe(1);
  });

  it('a drift smaller than the jump threshold offers no correction', () => {
    const r = rig({});
    startMatch(r);
    r.hostClock.advance(0.02);
    r.run(20);
    expect(r.guest.pendingGridShiftSec()).toBeNull();
  });

  it('the host and the guest still agree on the instant the match started', () => {
    const r = rig({});
    startMatch(r);
    const h = r.starts.host[0]!.grid.startTime;
    const g = r.starts.guest[0]!.grid.startTime;
    expect(Math.abs(h - g - HOST_AHEAD)).toBeLessThan(0.002);
  });
});
