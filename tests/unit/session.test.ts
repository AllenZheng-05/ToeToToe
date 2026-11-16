import { describe, expect, it } from 'vitest';
import { phraseStart, slotTime } from '../../src/core/beat';
import { DuelSession, type SessionEvent } from '../../src/core/session';
import { createTunables } from '../../src/core/tunables';
import type { BeatGrid, DuelState, Message, PlayerId, Strike } from '../../src/core/types';
import { createLoopbackPair } from '../../src/net/loopback';
import { FakeClock } from '../helpers/fakeClock';

const grid: BeatGrid = { bpm: 120, startTime: 0 }; // slot 0.25 s, phrase 2 s
const FIRST_PHRASE = 1; // phrase 0 is the count-in
const FRAME = 1 / 60;

interface Rig {
  clock: FakeClock;
  s0: DuelSession;
  s1: DuelSession;
  e0: SessionEvent[];
  e1: SessionEvent[];
  /** Every message crossing the link, in either direction. */
  wire: Message[];
  pump: () => void;
  /** Move the clock to `t` and update both sessions (and deliver due messages). */
  at: (t: number) => void;
  tun: ReturnType<typeof createTunables>;
  host: ReturnType<typeof createLoopbackPair>['host'];
  guest: ReturnType<typeof createLoopbackPair>['guest'];
}

function rig(latencySec = 0, tweak: Partial<ReturnType<typeof createTunables>> = {}): Rig {
  const clock = new FakeClock(0);
  const tun = createTunables(tweak);
  const pair = latencySec > 0 ? createLoopbackPair({ latencySec, clock }) : createLoopbackPair();
  const s0 = new DuelSession({
    localPlayer: 0,
    clock,
    grid,
    transport: pair.host,
    tunables: tun,
    firstAttacker: 0,
    firstPhrase: FIRST_PHRASE,
  });
  const s1 = new DuelSession({
    localPlayer: 1,
    clock,
    grid,
    transport: pair.guest,
    tunables: tun,
    firstAttacker: 0,
    firstPhrase: FIRST_PHRASE,
  });
  const e0: SessionEvent[] = [];
  const e1: SessionEvent[] = [];
  s0.on((e) => e0.push(e));
  s1.on((e) => e1.push(e));
  const wire: Message[] = [];
  pair.host.onMessage((m) => wire.push(m));
  pair.guest.onMessage((m) => wire.push(m));
  const at = (t: number) => {
    clock.set(t);
    pair.pump();
    s0.update();
    s1.update();
    pair.pump();
  };
  return {
    clock,
    s0,
    s1,
    e0,
    e1,
    wire,
    pump: () => pair.pump(),
    at,
    tun,
    host: pair.host,
    guest: pair.guest,
  };
}

/** Click at an absolute time: moves the clock there first. */
function click(r: Rig, s: DuelSession, t: number, x = 0.5, y = 0.5): void {
  r.at(t);
  s.pointerDown(x, y, t, false);
}

// ------------------------------------------------------------------ scripted players

interface Policy {
  parry: (index: number) => boolean;
  /** Timing error in ms for the parry of strike `index`. */
  errMs: (index: number) => number;
}

/** A tiny deterministic stand-in for a human: plants a fixed rhythm and parries by policy. */
class ScriptedPlayer {
  private plans = new Map<number, { slot: number; x: number; y: number; fired: boolean }[]>();
  private defended = new Set<string>();

  constructor(
    private s: DuelSession,
    private clock: FakeClock,
    private policy: Policy,
  ) {}

  update(): void {
    const v = this.s.view();
    const now = this.clock.now();
    const tun = createTunables();
    if (v.phase === 'attack' && v.localActive) {
      let plan = this.plans.get(v.clockPhrase);
      if (!plan) {
        // Always includes slot 0 so the first target is due the moment the defend phrase starts.
        plan = [0, 2, 3, 5].map((slot, k) => ({ slot, x: 0.3 + 0.05 * k, y: 0.5, fired: false }));
        this.plans.set(v.clockPhrase, plan);
      }
      for (const p of plan) {
        const ts = slotTime(grid, v.clockPhrase, p.slot, tun);
        if (!p.fired && now >= ts) {
          p.fired = true;
          this.s.pointerDown(p.x, p.y, ts, false);
        }
      }
    } else if (v.phase === 'defend' && v.localActive) {
      for (const target of v.targets) {
        const key = `${v.clockPhrase}:${target.index}`;
        if (this.defended.has(key)) continue;
        if (!this.policy.parry(target.index)) {
          this.defended.add(key);
          continue;
        }
        const ts =
          slotTime(grid, v.clockPhrase, target.strike.slot, tun) + this.policy.errMs(target.index) / 1000;
        if (now >= ts) {
          this.defended.add(key);
          this.s.pointerDown(target.strike.x, target.strike.y, ts, false);
        }
      }
    }
  }
}

const P0_POLICY: Policy = { parry: () => true, errMs: (i) => [0, 30, -20, 60, -35][i % 5]! };
const P1_POLICY: Policy = { parry: (i) => i % 2 === 0, errMs: (i) => [10, -70, 25][i % 3]! };
const NEVER: Policy = { parry: () => false, errMs: () => 0 };

function playMatch(r: Rig, p0: Policy, p1: Policy, maxSeconds = 600) {
  const a = new ScriptedPlayer(r.s0, r.clock, p0);
  const b = new ScriptedPlayer(r.s1, r.clock, p1);
  const frames = Math.ceil(maxSeconds / FRAME);
  for (let f = 0; f < frames; f++) {
    r.clock.advance(FRAME);
    r.pump();
    r.s0.update();
    r.s1.update();
    a.update();
    b.update();
    r.pump();
    if (r.s0.state.phase === 'matchOver' && r.s1.state.phase === 'matchOver') return;
  }
}

// ------------------------------------------------------------------ tests

describe('planting', () => {
  it('plants on the nearest slots and the other side sees them', () => {
    const r = rig();
    click(r, r.s0, 2.0, 0.2, 0.3); // slot 0
    click(r, r.s0, 2.5 + 0.1, 0.8, 0.6); // 0.1 late of slot 2
    click(r, r.s0, 3.5 - 0.05, 0.4, 0.4); // 0.05 early of slot 6
    for (const s of [r.s0, r.s1]) {
      expect(s.state.strikes.map((k) => k.slot)).toEqual([0, 2, 6]);
      expect(s.state.strikes[1]).toEqual({ slot: 2, x: 0.8, y: 0.6 });
    }
    expect(r.s0.state).toEqual(r.s1.state);
    expect(r.e0.filter((e) => e.type === 'planted')).toHaveLength(3);
    expect(r.e1.filter((e) => e.type === 'planted')).toEqual([
      { type: 'planted', player: 0, strike: { slot: 0, x: 0.2, y: 0.3 }, index: 0 },
      { type: 'planted', player: 0, strike: { slot: 2, x: 0.8, y: 0.6 }, index: 1 },
      { type: 'planted', player: 0, strike: { slot: 6, x: 0.4, y: 0.4 }, index: 2 },
    ]);
  });

  it('clamps positions into the play area', () => {
    const r = rig();
    click(r, r.s0, 2.0, -3, 7);
    expect(r.s0.state.strikes[0]).toEqual({ slot: 0, x: 0, y: 1 });
  });

  it('rejects with the right reasons', () => {
    const r = rig();
    click(r, r.s0, 2.0);
    click(r, r.s0, 2.0); // same slot again
    expect(r.e0.filter((e) => e.type === 'rejected')).toEqual([{ type: 'rejected', reason: 'slotTaken' }]);

    // A click that rounds into another phrase.
    click(r, r.s0, 1.0);
    expect(r.e0.at(-1)).toEqual({ type: 'rejected', reason: 'notYourTurn' });

    // The guest is not attacking: a click in the attack phrase is a stray, not a rejection... after the commit
    // the host is neither attacker nor defender of an open phrase.
    r.at(4.0);
    r.s0.pointerDown(0.5, 0.5, 4.5, false);
    expect(r.e0.at(-1)).toEqual({ type: 'rejected', reason: 'notYourTurn' });
  });

  it('rejects when stamina runs out', () => {
    const r = rig();
    const corners: [number, number][] = [
      [0.1, 0.1],
      [0.9, 0.9],
    ];
    for (let slot = 0; slot < 8; slot++) {
      const [x, y] = corners[slot % 2]!;
      click(r, r.s0, 2.0 + slot * 0.25, x, y);
    }
    const rejected = r.e0.filter((e) => e.type === 'rejected');
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.every((e) => e.type === 'rejected' && e.reason === 'stamina')).toBe(true);
    expect(r.s0.state.players[0].stamina).toBeGreaterThanOrEqual(0);
  });

  it('rejects with "full" when every slot holds a strike', () => {
    const r = rig();
    for (let slot = 0; slot < 8; slot++) click(r, r.s0, 2.0 + slot * 0.25);
    expect(r.s0.state.strikes).toHaveLength(8);
    click(r, r.s0, 2.25);
    expect(r.e0.at(-1)).toEqual({ type: 'rejected', reason: 'full' });
  });

  it('inputOffsetMs shifts planting', () => {
    const r = rig();
    r.s0.inputOffsetMs = 30;
    click(r, r.s0, 2.14); // 0.14 s late of slot 0; minus 30 ms it is 0.11, still slot 0 (slot 1 starts at 0.125)
    expect(r.s0.state.strikes[0]!.slot).toBe(0);
    r.s0.inputOffsetMs = 0;
    click(r, r.s0, 2.64); // 0.14 late of slot 2 -> rounds to slot 3? 0.64/0.25 = 2.56 -> slot 3
    expect(r.s0.state.strikes[1]!.slot).toBe(3);
  });
});

describe('a turn', () => {
  it('perfect parries leave health untouched and cost the attacker Bravo stamina', () => {
    const r = rig();
    click(r, r.s0, 2.0);
    click(r, r.s0, 2.5);
    expect(r.s0.state.players[0].stamina).toBe(100 - 8 - 8);
    r.at(4.0); // commit
    expect(r.s0.state.phase).toBe('defend');
    expect(r.s1.state.phase).toBe('defend');
    click(r, r.s1, 4.0);
    click(r, r.s1, 4.5);
    expect(r.s1.state.results).toEqual(['bravo', 'bravo']);
    r.at(6.0); // resolve
    for (const s of [r.s0, r.s1]) {
      expect(s.state.players[0].health).toBe(100);
      expect(s.state.players[1].health).toBe(100);
      expect(s.state.players[0].stamina).toBe(100 - 16 - 12);
      expect(s.state.attacker).toBe(1);
      expect(s.state.phase).toBe('attack');
      expect(s.state.phrase).toBe(3);
      expect(s.state.strikes).toEqual([]);
    }
    expect(r.s0.state).toEqual(r.s1.state);
  });

  it('unparried strikes auto-miss and cost health; roles swap and stamina regenerates', () => {
    const r = rig();
    for (let slot = 0; slot < 5; slot++) click(r, r.s0, 2.0 + slot * 0.25);
    r.at(4.0);
    r.at(4.0 + 0.1); // exactly on the Good edge: not yet a miss
    expect(r.s1.state.results[0]).toBeNull();
    r.at(4.0 + 0.16); // exactly on the grace edge: not yet a miss
    expect(r.s1.state.results[0]).toBeNull();
    r.at(4.17);
    expect(r.s1.state.results).toEqual(['miss', null, null, null, null]);
    expect(r.s1.state.players[1].health).toBe(90);
    expect(r.s0.state.results[0]).toBe('miss'); // the attacker heard about it
    r.at(5.9);
    expect(r.s1.state.players[1].health).toBe(50);
    r.at(6.0);
    for (const s of [r.s0, r.s1]) {
      expect(s.state.attacker).toBe(1);
      expect(s.state.players[1].health).toBe(50);
      expect(s.state.players[1].stamina).toBe(Math.min(100, 100 - 5 * 8 + 35));
      expect(s.state.players[0].stamina).toBe(100 - 5 * 8);
    }
    const misses = r.e1.filter((e) => e.type === 'judged');
    expect(misses).toHaveLength(5);
    expect(
      misses.every((e) => e.type === 'judged' && e.grade === 'miss' && e.offsetMs === null && e.player === 1),
    ).toBe(true);
    expect(r.s0.state).toEqual(r.s1.state);
  });

  it('a strike is never judged twice and stray clicks do nothing', () => {
    const r = rig();
    click(r, r.s0, 2.0, 0.5, 0.5);
    r.at(4.0);
    click(r, r.s1, 3.9, 0.1, 0.1); // far from any target, before the window anyway
    click(r, r.s1, 4.02, 0.9, 0.9); // wrong place
    expect(r.e1.filter((e) => e.type === 'judged')).toHaveLength(0);
    click(r, r.s1, 4.02, 0.5, 0.5);
    click(r, r.s1, 4.03, 0.5, 0.5);
    expect(r.e1.filter((e) => e.type === 'judged')).toHaveLength(1);
    expect(r.s1.state.results).toEqual(['bravo']);
  });

  it('inputOffsetMs shifts parry judging', () => {
    const r = rig();
    click(r, r.s0, 2.0);
    r.at(4.0);
    r.s1.inputOffsetMs = 40;
    click(r, r.s1, 4.08); // +80 ms raw would be Good; minus 40 ms it is Bravo
    expect(r.s1.state.results).toEqual(['bravo']);
    const j = r.e1.find((e) => e.type === 'judged');
    expect(j && j.type === 'judged' && Math.round(j.offsetMs ?? 0)).toBe(40);
  });

  it('the miss window grades a late click as a Miss', () => {
    const r = rig();
    click(r, r.s0, 2.0);
    r.at(4.0);
    click(r, r.s1, 4.15);
    expect(r.s1.state.results).toEqual(['miss']);
    expect(r.s1.state.players[1].health).toBe(90);
  });
});

describe('defending through lag', () => {
  it('judges before the commit arrives and flushes when it does', () => {
    const r = rig(0.3);
    click(r, r.s0, 2.0, 0.4, 0.4);
    r.at(2.31); // plant delivered
    expect(r.s1.state.strikes).toHaveLength(1);
    r.at(4.0); // s0 commits; the message is in flight
    expect(r.s0.state.phase).toBe('defend');
    expect(r.s1.state.phase).toBe('attack');
    expect(r.s1.view().phase).toBe('defend');
    expect(r.s1.view().targets).toHaveLength(1);

    click(r, r.s1, 4.0, 0.4, 0.4); // due before the commit arrives
    expect(r.s1.state.results).toEqual([null]);
    expect(r.s1.view().targets[0]!.result).toBe('bravo');
    expect(r.e1.filter((e) => e.type === 'judged')).toHaveLength(1);

    r.at(4.31); // commit arrives, queue flushes (parry is sent)
    expect(r.s1.state.phase).toBe('defend');
    expect(r.s1.state.results).toEqual(['bravo']);
    expect(r.s0.state.results).toEqual([null]);
    r.at(4.62); // parry arrives
    expect(r.s0.state.results).toEqual(['bravo']);
    expect(r.e1.filter((e) => e.type === 'judged')).toHaveLength(1); // not announced twice
  });

  it('holds auto-misses as pending too, and the view shows them', () => {
    const r = rig(0.3);
    click(r, r.s0, 2.0);
    r.at(2.31);
    r.at(4.0);
    r.at(4.2); // window long closed, commit still in flight
    expect(r.s1.state.phase).toBe('attack');
    expect(r.s1.view().targets[0]!.result).toBe('miss');
    expect(r.s1.state.players[1].health).toBe(100);
    r.at(4.31);
    expect(r.s1.state.players[1].health).toBe(90);
  });

  it('a former attacker sees the next phase from the clock before the resolve arrives', () => {
    const r = rig(0.3);
    click(r, r.s0, 2.0);
    r.at(2.31);
    r.at(4.0);
    r.at(4.31);
    r.at(6.0);
    expect(r.s0.state.phase).toBe('defend');
    const v = r.s0.view();
    expect(v.phase).toBe('attack');
    expect(v.attacker).toBe(1);
    expect(v.localActive).toBe(false);
    expect(v.targets).toEqual([]);
    expect(r.s1.view().localActive).toBe(true);
  });
});

describe('full matches', () => {
  it('a side that never parries loses the act; intermission; the other side attacks first next act', () => {
    const r = rig();
    const over: { winner: PlayerId; act: number; view: ReturnType<DuelSession['view']> }[] = [];
    r.s0.on((e) => {
      if (e.type === 'actOver') over.push({ winner: e.winner, act: e.act, view: r.s0.view() });
    });
    const a = new ScriptedPlayer(r.s0, r.clock, P0_POLICY);
    const b = new ScriptedPlayer(r.s1, r.clock, NEVER);
    let sawIntermission = false;
    let sawCountIn = false;
    for (let f = 0; f < 60 * 400 && over.length === 0; f++) {
      r.clock.advance(FRAME);
      r.s0.update();
      r.s1.update();
      a.update();
      b.update();
    }
    expect(over).toHaveLength(1);
    expect(over[0]!.winner).toBe(0);
    expect(over[0]!.act).toBe(0);
    expect(over[0]!.view.phase).toBe('intermission');
    expect(over[0]!.view.countInBeatsLeft).toBeGreaterThan(8);
    expect(r.s0.state.actWins).toEqual([1, 0]);
    expect(r.s0.state.lastActWinner).toBe(0);
    expect(r.s0.state.attacker).toBe(1);
    expect(r.s0.state.act).toBe(1);
    expect(r.s0.state.players[0].health).toBe(100);
    expect(r.s0.state.players[1].health).toBe(100);
    expect(r.s0.state).toEqual(r.s1.state);
    expect(r.e1.some((e) => e.type === 'actOver' && e.winner === 0)).toBe(true);

    const target = phraseStart(grid, r.s0.state.phrase, r.tun);
    while (r.clock.now() < target) {
      r.clock.advance(FRAME);
      const v = r.s0.view();
      if (v.phase === 'intermission') sawIntermission = true;
      if (v.phase === 'countIn') sawCountIn = true;
    }
    expect(sawIntermission && sawCountIn).toBe(true);
    r.clock.advance(FRAME);
    const v = r.s1.view();
    expect(v.phase).toBe('attack');
    expect(v.attacker).toBe(1);
    expect(v.localActive).toBe(true);
  });

  it('a whole match reaches matchOver on both sides with equal states, the host sends state, no desync', () => {
    const r = rig();
    playMatch(r, P0_POLICY, P1_POLICY);
    expect(r.s0.state.phase).toBe('matchOver');
    expect(r.s1.state.phase).toBe('matchOver');
    expect(r.s0.state).toEqual(r.s1.state);
    expect(r.s0.state.matchWinner).not.toBeNull();
    expect(Math.max(...r.s0.state.actWins)).toBe(2);
    expect(r.e0.some((e) => e.type === 'matchOver')).toBe(true);
    expect(r.e1.some((e) => e.type === 'matchOver')).toBe(true);
    const resolves = r.wire.filter((m) => m.t === 'resolve').length;
    const states = r.wire.filter((m) => m.t === 'state').length;
    expect(resolves).toBeGreaterThan(4);
    expect(states).toBe(resolves);
    expect(r.e1.some((e) => e.type === 'desync')).toBe(false);
    expect(r.e0.some((e) => e.type === 'desync')).toBe(false);
    const v = r.s1.view();
    expect(v.phase).toBe('matchOver');
    expect(v.localActive).toBe(false);
    expect(v.matchWinner).toBe(r.s0.state.matchWinner);
  });

  it.each([0.15, 0.35])('ends in the same state with %s s of latency each way as with none', (lat) => {
    const base = rig();
    playMatch(base, P0_POLICY, P1_POLICY);
    const lagged = rig(lat);
    playMatch(lagged, P0_POLICY, P1_POLICY);

    expect(base.s0.state.phase).toBe('matchOver');
    expect(lagged.s0.state.phase).toBe('matchOver');
    expect(lagged.s1.state.phase).toBe('matchOver');
    const expected: DuelState = base.s0.state;
    expect(lagged.s0.state).toEqual(expected);
    expect(lagged.s1.state).toEqual(expected);
    expect(lagged.e0.some((e) => e.type === 'desync')).toBe(false);
    expect(lagged.e1.some((e) => e.type === 'desync')).toBe(false);
    // Let the last messages land: every resolve was followed by exactly one state message.
    lagged.at(lagged.clock.now() + lat + 0.01);
    expect(lagged.wire.filter((m) => m.t === 'state').length).toBe(
      lagged.wire.filter((m) => m.t === 'resolve').length,
    );
  });

  it('keeps matching when one side never parries, under lag', () => {
    const base = rig();
    playMatch(base, P0_POLICY, NEVER);
    const lagged = rig(0.35);
    playMatch(lagged, P0_POLICY, NEVER);
    expect(lagged.s0.state).toEqual(base.s0.state);
    expect(lagged.s1.state).toEqual(base.s0.state);
  });
});

describe('state and desync', () => {
  it('a forged differing state makes the guest adopt it and emit desync', () => {
    const r = rig();
    click(r, r.s0, 2.0);
    r.at(4.0);
    r.at(6.0);
    expect(r.s1.state.phrase).toBe(3);
    expect(r.e1.some((e) => e.type === 'desync')).toBe(false);
    const forged: DuelState = structuredClone(r.s0.state);
    forged.players[1].health = 1;
    r.host.send({ t: 'state', state: forged });
    expect(r.s1.state).toEqual(forged);
    expect(r.e1.filter((e) => e.type === 'desync')).toHaveLength(1);
  });

  it('an equal state is not adopted blindly: the guest keeps strikes it planted since', () => {
    const r = rig(0.3);
    click(r, r.s0, 2.0);
    r.at(2.31);
    r.at(4.0);
    r.at(4.31);
    r.at(6.0); // s1 resolves locally, sends resolve (in flight)
    click(r, r.s1, 6.0, 0.3, 0.3); // plants before the host's state can possibly come back
    r.at(6.31); // host applies resolve and the plant is still in flight / arrives
    r.at(6.62); // state arrives at the guest
    expect(r.e1.some((e) => e.type === 'desync')).toBe(false);
    expect(r.s1.state.strikes).toHaveLength(1);
    expect(r.s0.state.strikes).toHaveLength(1);
  });

  it('a commit that disagrees with the planted strikes replaces them and reports desync', () => {
    const r = rig();
    click(r, r.s0, 2.0);
    r.at(2.1);
    const forged: Strike[] = [{ slot: 5, x: 0.1, y: 0.1 }];
    r.host.send({ t: 'commit', phrase: 1, strikes: forged });
    expect(r.s1.state.phase).toBe('defend');
    expect(r.s1.state.strikes).toEqual(forged);
    expect(r.s1.state.results).toEqual([null]);
    expect(r.e1.filter((e) => e.type === 'desync')).toHaveLength(1);
  });
});

describe('view', () => {
  it('walks through count-in, attack, defend, intermission', () => {
    const r = rig();
    let v = r.s0.view();
    expect(v.phase).toBe('countIn');
    expect(v.countInBeatsLeft).toBe(4);
    expect(v.localActive).toBe(false);
    expect(v.clockPhrase).toBe(0);
    r.at(0.6);
    v = r.s0.view();
    expect(v.countInBeatsLeft).toBe(3);
    expect(v.beatPosition).toBeCloseTo(1.2);
    expect(v.slotPosition).toBeCloseTo(2.4);
    r.at(1.99);
    expect(r.s0.view().countInBeatsLeft).toBe(1);

    r.at(2.0);
    v = r.s0.view();
    expect(v.phase).toBe('attack');
    expect(v.attacker).toBe(0);
    expect(v.localActive).toBe(true);
    expect(v.countInBeatsLeft).toBe(0);
    expect(r.s1.view().localActive).toBe(false);
    expect(r.s1.view().phase).toBe('attack');

    click(r, r.s0, 2.5);
    click(r, r.s0, 3.0);
    v = r.s1.view();
    expect(v.strikes.map((s) => s.slot)).toEqual([2, 4]);
    expect(v.targets).toEqual([]);

    r.at(4.0);
    v = r.s1.view();
    expect(v.phase).toBe('defend');
    expect(v.localActive).toBe(true);
    expect(r.s0.view().localActive).toBe(false);
    expect(v.targets.map((t) => t.index)).toEqual([0, 1]);
    expect(v.targets[0]!.timeToHit).toBeCloseTo(0.5);
    expect(v.targets[1]!.timeToHit).toBeCloseTo(1.0);
    expect(v.targets[0]!.result).toBeNull();
    r.at(4.75);
    v = r.s1.view();
    expect(v.targets[0]!.timeToHit).toBeCloseTo(-0.25);
    expect(v.targets[0]!.result).toBe('miss');
    expect(v.strikes).toHaveLength(2);
  });

  it('shows intermission with beats left, then count-in, then matchOver', () => {
    const r = rig();
    playMatch(r, P0_POLICY, NEVER);
    expect(r.s0.view().phase).toBe('matchOver');

    const r2 = rig();
    const a = new ScriptedPlayer(r2.s0, r2.clock, P0_POLICY);
    const b = new ScriptedPlayer(r2.s1, r2.clock, NEVER);
    for (let f = 0; f < 60 * 400 && r2.s0.state.actWins[0] === 0; f++) {
      r2.clock.advance(FRAME);
      r2.s0.update();
      r2.s1.update();
      a.update();
      b.update();
    }
    const start = phraseStart(grid, r2.s0.state.phrase, r2.tun);
    const sixSecondsBefore = start - 6;
    const v1 = r2.s0.view();
    expect(v1.phase).toBe('intermission');
    expect(Math.abs(r2.clock.now() - sixSecondsBefore)).toBeLessThan(0.1);
    r2.clock.set(start - 3.9);
    expect(r2.s0.view().phase).toBe('intermission');
    r2.clock.set(start - 1.9);
    const c = r2.s0.view();
    expect(c.phase).toBe('countIn');
    expect(c.countInBeatsLeft).toBe(4);
    expect(c.attacker).toBe(1);
    expect(c.targets).toEqual([]);
  });

  it('returns a fresh object each time', () => {
    const r = rig();
    const a = r.s0.view();
    a.players[0].health = -5;
    expect(r.s0.view().players[0].health).toBe(100);
    expect(r.s0.state.players[0].health).toBe(100);
  });
});

describe('catch-up and dispose', () => {
  it('commits and resolves overdue phrases after the clock jumps', () => {
    const r = rig();
    click(r, r.s0, 2.0);
    click(r, r.s0, 2.5);
    r.clock.set(14.0); // phrase 7: three whole turns' worth of boundaries overdue
    for (let i = 0; i < 6; i++) {
      r.s0.update();
      r.s1.update();
    }
    expect(r.s0.state).toEqual(r.s1.state);
    expect(r.s0.state.phase).toBe('attack');
    expect(r.s0.state.phrase).toBe(7);
    expect(r.s0.state.attacker).toBe(1);
    expect(r.s1.state.players[1].health).toBe(80); // both strikes missed
    expect(r.s0.state.players[0].health).toBe(100);
  });

  it('a single update() call handles a long sleep on its own', () => {
    const solo = rig();
    solo.clock.set(2.0);
    solo.s0.update();
    solo.clock.set(40);
    for (let i = 0; i < 30; i++) {
      solo.s0.update();
      solo.s1.update();
    }
    expect(solo.s0.state).toEqual(solo.s1.state);
    expect(solo.s0.state.phrase).toBe(20);
  });

  it('dispose stops reacting', () => {
    const r = rig();
    r.s1.dispose();
    const before = r.s1.state;
    click(r, r.s0, 2.0);
    expect(r.s0.state.strikes).toHaveLength(1);
    expect(r.s1.state).toBe(before);
    const n = r.e1.length;
    r.s1.pointerDown(0.5, 0.5, 2.0, false);
    r.s1.update();
    expect(r.e1.length).toBe(n);
    r.s1.dispose(); // idempotent
  });
});

describe('input grace', () => {
  it('a click stamped +90 ms but handled at +130 ms is a Good', () => {
    const r = rig();
    click(r, r.s0, 2.0);
    r.at(4.0);
    r.at(4.13);
    expect(r.s1.state.results).toEqual([null]);
    r.s1.pointerDown(0.5, 0.5, 4.09, false);
    expect(r.s1.state.results).toEqual(['good']);
    expect(r.s1.state.players[1].health).toBe(100);
  });

  it('a click stamped +130 ms is a Miss grade, and nothing is judged after the grace has passed', () => {
    const r = rig();
    click(r, r.s0, 2.0);
    r.at(4.0);
    r.at(4.13);
    r.s1.pointerDown(0.5, 0.5, 4.13, false);
    expect(r.s1.state.results).toEqual(['miss']);

    const q = rig();
    click(q, q.s0, 2.0);
    q.at(4.0);
    q.at(4.17); // grace over: auto-missed
    q.s1.pointerDown(0.5, 0.5, 4.09, false);
    expect(q.e1.filter((e) => e.type === 'judged')).toHaveLength(1);
    expect(q.s1.state.results).toEqual(['miss']);
  });
});

describe('a click just before the attack phrase', () => {
  // s0 plants in phrase 1; s1 defends phrase 2 (4..6 s) and attacks phrase 3 from 6 s.
  it('is held and planted in slot 0 once the defend phrase resolves, and the other side sees it', () => {
    const r = rig();
    click(r, r.s0, 2.0);
    r.at(4.0);
    click(r, r.s1, 5.96, 0.3, 0.3); // 40 ms early of phrase 3
    expect(r.s1.state.strikes).toHaveLength(1);
    expect(r.s1.state.phase).toBe('defend');
    r.at(6.0);
    for (const s of [r.s0, r.s1]) {
      expect(s.state.phase).toBe('attack');
      expect(s.state.phrase).toBe(3);
      expect(s.state.strikes).toEqual([{ slot: 0, x: 0.3, y: 0.3 }]);
    }
    expect(r.e0.some((e) => e.type === 'planted' && e.player === 1 && e.strike.slot === 0)).toBe(true);
    const iResolve = r.wire.findIndex((m) => m.t === 'resolve');
    const iPlant = r.wire.findIndex((m) => m.t === 'plant' && m.phrase === 3);
    expect(iResolve).toBeGreaterThanOrEqual(0);
    expect(iPlant).toBeGreaterThan(iResolve);
  });

  it('is dropped without error when the act ends at that resolve', () => {
    const r = rig(0, { startHealth: 10 });
    click(r, r.s0, 2.0);
    r.at(4.0);
    click(r, r.s1, 5.96, 0.3, 0.3);
    r.at(6.0);
    expect(r.e1.some((e) => e.type === 'actOver')).toBe(true);
    expect(r.e1.some((e) => e.type === 'planted' && e.player === 1)).toBe(false);
    expect(r.s1.state.strikes).toEqual([]);
    expect(r.s0.state.strikes).toEqual([]);
  });

  it('stays a parry when it is a Good parry of a slot-7 target', () => {
    const r = rig(0, { goodWindowMs: 140 });
    click(r, r.s0, 3.75); // slot 7 of phrase 1
    r.at(4.0);
    click(r, r.s1, 5.88); // +130 ms of the slot-7 target, but the nearest slot is slot 0 of phrase 3
    expect(r.s1.state.results).toEqual(['good']);
    r.at(6.0);
    expect(r.s1.state.strikes).toEqual([]);
    expect(r.s0.state.strikes).toEqual([]);
    expect(r.e1.some((e) => e.type === 'planted' && e.player === 1)).toBe(false);
  });
});

describe('untrusted input', () => {
  it('ignores a parry with an unknown grade', () => {
    const r = rig();
    click(r, r.s0, 2.0);
    r.at(4.0);
    r.guest.send({ t: 'parry', phrase: 2, index: 0, grade: 'bogus' as never });
    r.pump();
    expect(r.s0.state.results).toEqual([null]);
    expect(r.e0.some((e) => e.type === 'judged')).toBe(false);
  });

  it('treats unknown grades in a resolve as absent', () => {
    const r = rig();
    click(r, r.s0, 2.0);
    r.at(2.1);
    r.at(4.0);
    r.guest.send({ t: 'resolve', phrase: 2, results: ['bogus', 7, null] as never });
    r.pump();
    expect(r.e0.some((e) => e.type === 'judged')).toBe(false);
    expect(r.s0.state.phase).toBe('attack');
    expect(r.s0.state.phrase).toBe(3);
    expect(r.s0.state.players[1].health).toBe(90); // unjudged strike resolved as a miss
  });

  it('a commit with invalid strikes still starts the defend phrase with the known strikes and reports desync', () => {
    const r = rig();
    click(r, r.s0, 2.0, 0.2, 0.2);
    r.at(2.1);
    r.host.send({ t: 'commit', phrase: 1, strikes: [{ slot: 'x', x: 0, y: 0 }] as never });
    expect(r.s1.state.phase).toBe('defend');
    expect(r.s1.state.strikes).toEqual([{ slot: 0, x: 0.2, y: 0.2 }]);
    expect(r.e1.filter((e) => e.type === 'desync')).toHaveLength(1);
  });
});
