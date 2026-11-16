import { describe, expect, it } from 'vitest';
import { phraseStart, positionAt, slotTime } from '../../src/core/beat';
import { DuelSession, type SessionEvent } from '../../src/core/session';
import { createTunables } from '../../src/core/tunables';
import type { BeatGrid, DuelView, Message, Tunables } from '../../src/core/types';
import { createLoopbackPair } from '../../src/net/loopback';
import { FakeClock } from '../helpers/fakeClock';

/**
 * Messages arriving ahead of (or behind) the local beat. Two sessions with clocks that disagree: the view must
 * keep showing the phase the local clock is in, never a count-in or an empty frame in the middle of an act.
 */

const grid: BeatGrid = { bpm: 120, startTime: 0 }; // slot 0.25 s, phrase 2 s
const FIRST_PHRASE = 1; // phrase 0 is the count-in

interface Duo {
  trueClock: FakeClock;
  hostClock: FakeClock;
  guestClock: FakeClock;
  host: DuelSession;
  guest: DuelSession;
  hostEvents: SessionEvent[];
  guestEvents: SessionEvent[];
  wire: Message[];
  tun: [Tunables, Tunables];
  /** Move true time to `t` (the guest's clock reads t + skew) and update both sessions. */
  at: (t: number) => void;
}

function duo(skew: number, latencySec = 0, tweak: Partial<Tunables> = {}): Duo {
  const trueClock = new FakeClock(0);
  const hostClock = new FakeClock(0);
  const guestClock = new FakeClock(skew);
  const pair = latencySec > 0 ? createLoopbackPair({ latencySec, clock: trueClock }) : createLoopbackPair();
  const tun: [Tunables, Tunables] = [createTunables(tweak), createTunables(tweak)];
  const mk = (id: 0 | 1, clock: FakeClock) =>
    new DuelSession({
      localPlayer: id,
      clock,
      grid,
      transport: id === 0 ? pair.host : pair.guest,
      tunables: tun[id],
      firstAttacker: 0,
      firstPhrase: FIRST_PHRASE,
    });
  const host = mk(0, hostClock);
  const guest = mk(1, guestClock);
  const hostEvents: SessionEvent[] = [];
  const guestEvents: SessionEvent[] = [];
  host.on((e) => hostEvents.push(e));
  guest.on((e) => guestEvents.push(e));
  const wire: Message[] = [];
  pair.host.onMessage((m) => wire.push(m));
  pair.guest.onMessage((m) => wire.push(m));
  const at = (t: number): void => {
    trueClock.set(t);
    hostClock.set(t);
    guestClock.set(t + skew);
    pair.pump();
    host.update();
    guest.update();
    pair.pump();
  };
  return { trueClock, hostClock, guestClock, host, guest, hostEvents, guestEvents, wire, tun, at };
}

/** The host plants slots 0 and 3 in phrase 1 (true time 2 s onwards). */
function hostPlants(d: Duo, slots: number[] = [0, 3]): void {
  for (const slot of slots) {
    const t = slotTime(grid, FIRST_PHRASE, slot, d.tun[0]);
    d.at(t);
    d.host.pointerDown(0.2 + 0.1 * slot, 0.5, t, false);
  }
}

describe('a commit that arrives before the local beat', () => {
  it('keeps the attack phrase on screen, with the committed strikes, until the defend phrase starts', () => {
    const d = duo(-0.3); // the guest's clock runs 0.3 s behind
    hostPlants(d);
    d.at(3.9);
    const before = d.guest.view();
    expect(before.phase).toBe('attack');
    expect(before.strikes).toHaveLength(2);
    d.at(4.0); // the host commits at its boundary; the guest's clock reads 3.7
    expect(d.guest.state.phase).toBe('defend'); // it has the commit
    const early = d.guest.view();
    expect(d.guestClock.now()).toBeCloseTo(3.7);
    expect(early.phase).toBe('attack');
    expect(early.attacker).toBe(0);
    expect(early.localActive).toBe(false);
    expect(early.strikes).toHaveLength(2);
    expect(early.targets).toEqual([]);
    expect(early.countInBeatsLeft).toBe(0);
    expect(early.clockPhrase).toBe(1);
    // The defender-to-be's pre-phrase warning keeps working: it is computed from the local clock's position.
    expect(early.slotPosition).toBeCloseTo(6.8, 5);
    d.at(4.29);
    expect(d.guest.view().phase).toBe('attack');
    d.at(4.31); // the guest's own phrase begins
    const now = d.guest.view();
    expect(now.phase).toBe('defend');
    expect(now.targets).toHaveLength(2);
    expect(now.targets[0]?.timeToHit).toBeCloseTo(-0.01, 5); // slot 0 of phrase 2 was 4.0 on the host clock = 4.3 here
  });

  it('is the same on a count-in-sized error: one second early', () => {
    const d = duo(-1);
    hostPlants(d);
    d.at(4.0);
    expect(d.guest.state.phase).toBe('defend');
    const v = d.guest.view();
    expect(v.phase).toBe('attack');
    expect(v.strikes).toHaveLength(2);
    expect(['countIn', 'intermission']).not.toContain(v.phase);
  });

  it('a click in that moment is not a parry of a phrase that has not started', () => {
    const d = duo(-0.3);
    hostPlants(d);
    d.at(4.0); // guest clock 3.7: 0.3 s before its defend phrase, outside the miss window
    d.guest.pointerDown(0.2, 0.5, d.guestClock.now(), false);
    expect(d.guestEvents.filter((e) => e.type === 'judged')).toEqual([]);
    expect(d.guest.state.results).toEqual([null, null]);
    expect(d.guestEvents.filter((e) => e.type === 'rejected')).toEqual([]);
  });

  it('a click inside the miss window of slot 0 is handled as today: judged against slot 0', () => {
    const d = duo(-0.3);
    hostPlants(d);
    d.at(4.0);
    d.at(4.14); // guest clock 3.84: 0.16 s before slot 0, inside the 200 ms window
    d.guest.pointerDown(0.2, 0.5, d.guestClock.now(), false);
    const judged = d.guestEvents.filter((e) => e.type === 'judged');
    expect(judged).toHaveLength(1);
    expect(judged[0]).toMatchObject({ index: 0, grade: 'miss' });
  });

  it('an attacker whose commit has not gone out yet plants as usual', () => {
    const d = duo(-0.3);
    hostPlants(d, [0]);
    // The host (attacker) is unaffected by anything the guest's clock says.
    d.at(3.2);
    d.host.pointerDown(0.9, 0.5, 3.25, false); // slot 5
    expect(d.host.state.strikes.map((s) => s.slot)).toEqual([0, 5]);
    expect(d.host.view().phase).toBe('attack');
    expect(d.host.view().localActive).toBe(true);
  });
});

describe('a resolve that arrives before the local beat', () => {
  it('keeps the defend phrase on screen with the final results until it ends locally', () => {
    const d = duo(0.3); // the guest's clock runs 0.3 s ahead: its phrases end first
    hostPlants(d);
    // The guest's defend phrase 2 starts at its clock 4.0 = true 3.7: it parries slot 0 on time.
    d.at(3.7);
    d.guest.pointerDown(0.2, 0.5, d.guestClock.now(), false);
    d.at(4.0); // the host commits; the guest's pending parry goes out
    expect(d.guest.state.results[0]).toBe('bravo');
    d.at(5.69); // the guest's clock reads 5.99
    expect(d.host.state.phase).toBe('defend');
    d.at(5.71); // the guest resolves at its 6.0 = true 5.7; the host's clock reads 5.71
    expect(d.guest.state.phase).toBe('attack');
    expect(d.host.state.phase).toBe('attack'); // the host has the resolve
    expect(d.host.state.phrase).toBe(3);
    const v = d.host.view();
    expect(v.phase).toBe('defend'); // the host's clock is still in phrase 2
    expect(v.attacker).toBe(0);
    expect(v.localActive).toBe(false);
    expect(v.strikes).toHaveLength(2);
    expect(v.targets.map((t) => t.result)).toEqual(['bravo', 'miss']);
    expect(v.targets[0]?.timeToHit).toBeLessThan(0);
    expect(v.clockPhrase).toBe(2);
    d.at(6.01);
    const next = d.host.view();
    expect(next.phase).toBe('attack');
    expect(next.attacker).toBe(1);
    expect(next.strikes).toEqual([]);
  });

  it('after the resolve that ends an act, the defend phrase finishes before the intermission begins', () => {
    const d = duo(0.3, 0, { startHealth: 10, missDamage: 10 });
    hostPlants(d);
    d.at(3.5);
    d.at(5.71); // the guest let everything go and resolved at true 5.7: it is out of health
    expect(d.guest.state.act).toBe(1);
    expect(d.host.state.act).toBe(1); // the host already has the new act
    expect(d.host.state.lastActEndPhrase).toBe(2);
    const v = d.host.view();
    expect(v.phase).toBe('defend');
    expect(v.strikes).toHaveLength(2);
    expect(v.targets.map((t) => t.result)).toEqual(['miss', 'miss']);
    d.at(6.01); // the host's phrase 2 is over: now the break
    const after = d.host.view();
    expect(after.phase).toBe('intermission');
    expect(after.strikes).toEqual([]);
  });

  it('a defender-to-be sees nothing of the old phrase once its own clock leaves it, and clicks before that go nowhere', () => {
    const d = duo(0.3);
    hostPlants(d);
    d.at(3.5);
    d.at(5.71);
    expect(d.host.state.phase).toBe('attack');
    const heard = d.hostEvents.length;
    d.host.pointerDown(0.5, 0.5, d.hostClock.now(), false);
    // The host is the defender of the next phrase, which has not started: a click outside its window is ignored.
    expect(d.hostEvents.slice(heard)).toEqual([]);
  });
});

describe('messages that arrive late', () => {
  it('shows the targets from the defender own clock, adds late plants, and keeps results when the commit confirms', () => {
    const d = duo(0, 0.3); // 0.3 s each way, the clocks agree
    // The host plants slot 0 and slot 7 (the very last): the plant for slot 7 is sent at 3.75 and arrives at 4.05.
    for (const slot of [0, 7]) {
      const t = slotTime(grid, FIRST_PHRASE, slot, d.tun[0]);
      d.at(t);
      d.host.pointerDown(0.3 + 0.05 * slot, 0.5, t, false);
    }
    d.at(4.01); // the guest's defend phrase has begun on its own clock; only the plant for slot 0 is here
    let v = d.guest.view();
    expect(d.guest.state.phase).toBe('attack'); // the commit has not arrived (it arrives at 4.3)
    expect(v.phase).toBe('defend');
    expect(v.localActive).toBe(true);
    expect(v.targets.map((t) => t.strike.slot)).toEqual([0]);
    expect(v.targets[0]?.timeToHit).toBeCloseTo(-0.01, 5);

    // The guest parries slot 0 on time (stamped 4.0 on the clock), before the commit has arrived.
    d.guest.pointerDown(0.3, 0.5, 4.0, false);
    expect(d.guestEvents.filter((e) => e.type === 'judged')).toHaveLength(1);
    v = d.guest.view();
    expect(v.targets[0]?.result).toBe('bravo'); // shown from the pending queue

    d.at(4.06); // the plant for slot 7 arrives
    v = d.guest.view();
    expect(v.targets.map((t) => t.strike.slot)).toEqual([0, 7]);
    expect(v.targets[1]?.timeToHit).toBeCloseTo(slotTime(grid, 2, 7, d.tun[1]) - 4.06, 5);
    expect(v.targets[1]?.result).toBeNull();
    expect(v.targets[0]?.result).toBe('bravo');

    d.at(4.31); // the commit arrives and confirms the same strikes
    expect(d.guest.state.phase).toBe('defend');
    expect(d.guest.state.results[0]).toBe('bravo');
    v = d.guest.view();
    expect(v.targets.map((t) => t.result)).toEqual(['bravo', null]);
    expect(d.guestEvents.filter((e) => e.type === 'desync')).toEqual([]);
    // The parry went out once the commit let it.
    d.at(4.62);
    expect(d.wire.filter((m) => m.t === 'parry')).toHaveLength(1);
  });
});

describe('how early or late messages arrive', () => {
  it('reports each plant, commit and resolve against the local beat it refers to (negative = early)', () => {
    const d = duo(-0.3, 0.05); // the guest's clock 0.3 s behind, 50 ms each way
    const seen: { kind: string; ms: number }[] = [];
    d.guest.onArrival = (kind, lateSec) => seen.push({ kind, ms: lateSec * 1000 });
    d.hostClock.set(0);
    // The host plants slot 0 at 2.0 and slot 3 at 2.75 (true time); each arrives 50 ms later.
    for (const slot of [0, 3]) {
      const t = slotTime(grid, FIRST_PHRASE, slot, d.tun[0]);
      d.at(t);
      d.host.pointerDown(0.2 + 0.1 * slot, 0.5, t, false);
      d.at(t + 0.0501);
    }
    d.at(4.0); // the host commits
    d.at(4.0501);
    const near = (got: number | undefined, want: number) => Math.abs((got ?? 1e9) - want) < 1;
    const plants = seen.filter((s) => s.kind === 'plant');
    expect(plants).toHaveLength(2);
    // 50 ms in flight, and the guest's clock is 300 ms behind: its beat for the slot is still 250 ms away.
    expect(near(plants[0]?.ms, -250)).toBe(true);
    expect(near(plants[1]?.ms, -250)).toBe(true);
    const commit = seen.find((s) => s.kind === 'commit');
    expect(near(commit?.ms, -250)).toBe(true);
    // The guest resolves at its own beat (6.0 on its clock); the host hears it later, against its own 6.0.
    const heardByHost: { kind: string; ms: number }[] = [];
    d.host.onArrival = (kind, lateSec) => heardByHost.push({ kind, ms: lateSec * 1000 });
    for (let t = 4.1; t < 6.6; t += 0.005) d.at(t);
    const resolve = heardByHost.find((s) => s.kind === 'resolve');
    expect(resolve).toBeDefined();
    // Sent at the guest's 6.0 = true 6.3, heard at true 6.35: 350 ms after the host's own beat.
    expect(Math.abs((resolve?.ms ?? 0) - 350)).toBeLessThan(11);
  });

  it('ignores a message that cannot be placed on the beat', () => {
    const d = duo(0);
    const seen: string[] = [];
    d.guest.onArrival = (kind) => seen.push(kind);
    d.host.pointerDown(0.5, 0.5, 2.0, false);
    d.at(2.0);
    d.host.pointerDown(0.5, 0.5, 2.0, false);
    expect(seen).toEqual(['plant']);
  });
});

// ------------------------------------------------------------------ the whole act, clocks disagreeing

interface Frame {
  view: DuelView;
}

/** A scripted player: plants slots 0, 2, 3, 5 each attack phrase; parries per policy. */
function play(session: DuelSession, clock: FakeClock, tun: Tunables, parry: (index: number) => boolean) {
  const done = new Set<string>();
  return (): void => {
    const v = session.view();
    const now = clock.now();
    if (v.phase === 'attack' && v.localActive) {
      [0, 2, 3, 5].forEach((slot, k) => {
        const key = `p${v.clockPhrase}:${slot}`;
        const ts = slotTime(grid, v.clockPhrase, slot, tun);
        if (!done.has(key) && now >= ts) {
          done.add(key);
          session.pointerDown(0.3 + 0.05 * k, 0.5, ts, false);
        }
      });
    } else if (v.phase === 'defend' && v.localActive) {
      for (const target of v.targets) {
        const key = `d${v.clockPhrase}:${target.index}`;
        if (target.result === null && target.timeToHit <= 0 && !done.has(key)) {
          done.add(key);
          if (parry(target.index)) {
            session.pointerDown(target.strike.x, target.strike.y, now + target.timeToHit, false);
          }
        }
      }
    }
  };
}

function checkFrame(
  who: string,
  session: DuelSession,
  prev: Frame | undefined,
  v: DuelView,
  t: number,
): string | null {
  const st = session.state;
  const tag = `${who} at ${t.toFixed(3)} (phase ${v.phase}, state ${st.phase}/${st.phrase})`;
  if (v.phase === 'countIn' || v.phase === 'intermission') {
    const notStarted = v.clockPhrase < st.actFirstPhrase;
    const afterEnd = st.lastActEndPhrase === null || v.clockPhrase > st.lastActEndPhrase;
    if (!notStarted || !afterEnd) return `${tag}: a break view in the middle of an act`;
  }
  if (v.phase === 'defend' && v.strikes.length > 0 && v.targets.length === 0) {
    return `${tag}: strikes but no targets in a defend phase`;
  }
  if (prev && prev.view.clockPhrase === v.clockPhrase && prev.view.phase !== 'matchOver') {
    if (prev.view.strikes.length > 0 && v.strikes.length === 0) return `${tag}: strikes vanished`;
    if (prev.view.targets.length > 0 && v.targets.length === 0) return `${tag}: targets vanished`;
  }
  return null;
}

describe('a full act with clocks that disagree', () => {
  const skews = [0.3, 1, -0.3];
  const latencies = [0, 0.05, 0.3];
  for (const skew of skews) {
    for (const latency of latencies) {
      it(`guest clock ${skew >= 0 ? '+' : ''}${skew} s, ${latency * 1000} ms each way`, () => {
        const d = duo(skew, latency);
        const players = [
          play(d.host, d.hostClock, d.tun[0], () => true),
          play(d.guest, d.guestClock, d.tun[1], (i) => i === 0),
        ];
        const sessions: [DuelSession, DuelSession] = [d.host, d.guest];
        const prev: (Frame | undefined)[] = [undefined, undefined];
        const problems: string[] = [];
        const dt = 1 / 60;
        let settledAt = -1;
        for (let t = -3; t < 70; t += dt) {
          d.at(t);
          players.forEach((p) => p());
          d.at(t);
          for (const i of [0, 1] as const) {
            const view = sessions[i].view();
            const problem = checkFrame(i === 0 ? 'host' : 'guest', sessions[i], prev[i], view, t);
            if (problem !== null && problems.length < 5) problems.push(problem);
            prev[i] = { view };
          }
          if (settledAt < 0 && d.host.state.act >= 1 && d.guest.state.act >= 1) settledAt = t;
          if (settledAt >= 0 && t > settledAt + 1.5) break;
        }
        expect(settledAt, 'the act should end').toBeGreaterThan(0);
        expect(problems).toEqual([]);
        expect(d.host.state).toEqual(d.guest.state);
        expect(d.host.state.lastActWinner).toBe(0);
      });
    }
  }

  it('keeps the legitimate count-in at the start of the match and the intermission after an act', () => {
    const d = duo(0.3);
    d.at(0.5);
    expect(d.host.view().phase).toBe('countIn');
    expect(d.guest.view().phase).toBe('countIn');
    // Sanity on the helper: the guest's clock really is ahead.
    expect(positionAt(grid, d.guestClock.now(), d.tun[1]).phrase).toBe(0);
    expect(phraseStart(grid, FIRST_PHRASE, d.tun[0])).toBe(2);
  });
});
