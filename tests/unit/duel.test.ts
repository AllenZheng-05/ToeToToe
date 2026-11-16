import { describe, expect, it } from 'vitest';
import {
  defenderOf,
  initialDuelState,
  judgeParry,
  otherPlayer,
  plantError,
  playDistance,
  reduceDuel,
  strikeCost,
} from '../../src/core/duel';
import { createTunables } from '../../src/core/tunables';
import type { DuelEvent, DuelState, Grade, Strike } from '../../src/core/types';

const t = createTunables();
const BPM = 120; // phrase = 2 s

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

function run(s: DuelState, events: DuelEvent[], tun = t): DuelState {
  return events.reduce((acc, e) => reduceDuel(acc, e, tun, BPM), s);
}

const st = (slot: number, x = 0.5, y = 0.5): Strike => ({ slot, x, y });
const plant = (phrase: number, strike: Strike): DuelEvent => ({ type: 'plant', phrase, strike });

/** One full turn: attacker plants the given slots (same spot), commits; defender parries with `grade` for all, resolves. */
function turn(s: DuelState, slots: number[], grade: Grade | null, tun = t): DuelState {
  const p = s.phrase;
  let r = run(s, [...slots.map((sl) => plant(p, st(sl))), { type: 'commit', phrase: p }], tun);
  if (grade) {
    r = run(
      r,
      slots.map((_, index) => ({ type: 'parry', phrase: p + 1, index, grade })),
      tun,
    );
  }
  return run(r, [{ type: 'resolve', phrase: p + 1 }], tun);
}

describe('helpers', () => {
  it('otherPlayer and defenderOf', () => {
    expect(otherPlayer(0)).toBe(1);
    expect(otherPlayer(1)).toBe(0);
    expect(defenderOf(initialDuelState(t, 1, 3))).toBe(0);
  });

  it('initialDuelState', () => {
    const s = initialDuelState(t, 1, 4);
    expect(s).toEqual({
      phase: 'attack',
      act: 0,
      actWins: [0, 0],
      actFirstPhrase: 4,
      phrase: 4,
      firstAttacker: 1,
      attacker: 1,
      players: [
        { health: 100, stamina: 100, winded: false, streak: 0 },
        { health: 100, stamina: 100, winded: false, streak: 0 },
      ],
      strikes: [],
      results: [],
      windedTurn: false,
      lastActWinner: null,
      lastActEndPhrase: null,
      matchWinner: null,
    });
  });

  it('playDistance applies the aspect to y', () => {
    expect(playDistance({ x: 0, y: 0 }, { x: 0.3, y: 0 }, t)).toBeCloseTo(0.3, 12);
    expect(playDistance({ x: 0, y: 0 }, { x: 0, y: 0.6 }, t)).toBeCloseTo(0.3, 12);
    expect(playDistance({ x: 0, y: 0 }, { x: 0.3, y: 0.8 }, t)).toBeCloseTo(0.5, 12);
  });
});

describe('strikeCost', () => {
  it('first strike pays the base cost', () => {
    expect(strikeCost([], st(3), t)).toBe(8);
  });

  it('later strikes pay by distance from the nearest earlier slot', () => {
    // distance 0.3 -> half of the max
    expect(strikeCost([st(0, 0.1, 0.5)], st(2, 0.4, 0.5), t)).toBeCloseTo(8 + 12 * 0.5, 12);
    // zero distance
    expect(strikeCost([st(0)], st(1), t)).toBe(8);
  });

  it('is capped at the max distance', () => {
    expect(strikeCost([st(0, 0, 0)], st(1, 1, 1), t)).toBeCloseTo(20, 12);
  });

  it('uses the highest slot below the new one, not the latest planted', () => {
    const planted = [st(1, 0, 0.5), st(6, 1, 0.5)];
    // slot 3: previous is slot 1 (distance 0.3 -> half)
    expect(strikeCost(planted, st(3, 0.3, 0.5), t)).toBeCloseTo(14, 12);
    // slot 7: previous is slot 6
    expect(strikeCost(planted, st(7, 1, 0.5), t)).toBe(8);
    // slot 0: nothing below
    expect(strikeCost(planted, st(0, 1, 1), t)).toBe(8);
  });

  it('applies the aspect to y differences', () => {
    // dy 0.6 / aspect 2 = 0.3 width units -> half
    expect(strikeCost([st(0, 0.5, 0.2)], st(1, 0.5, 0.8), t)).toBeCloseTo(14, 12);
  });
});

describe('plantError', () => {
  const s0 = initialDuelState(t, 0, 2);

  it('wrongPhase', () => {
    expect(plantError(s0, 3, st(0), t)).toBe('wrongPhase');
    const defend = run(s0, [{ type: 'commit', phrase: 2 }]);
    expect(plantError(defend, defend.phrase, st(0), t)).toBe('wrongPhase');
  });

  it('badStrike', () => {
    expect(plantError(s0, 2, st(-1), t)).toBe('badStrike');
    expect(plantError(s0, 2, st(8), t)).toBe('badStrike');
    expect(plantError(s0, 2, st(1.5), t)).toBe('badStrike');
    expect(plantError(s0, 2, st(0, -0.1, 0.5), t)).toBe('badStrike');
    expect(plantError(s0, 2, st(0, 0.5, 1.1), t)).toBe('badStrike');
    expect(plantError(s0, 2, st(0, NaN, 0.5), t)).toBe('badStrike');
    expect(plantError(s0, 2, st(0, 0.5, Infinity), t)).toBe('badStrike');
  });

  it('slotTaken', () => {
    const s = run(s0, [plant(2, st(3))]);
    expect(plantError(s, 2, st(3, 0.1, 0.1), t)).toBe('slotTaken');
  });

  it('full', () => {
    const tun = createTunables({ startStamina: 1000 });
    const s = run(
      initialDuelState(tun, 0, 2),
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => plant(2, st(i))),
      tun,
    );
    expect(s.strikes).toHaveLength(8);
    expect(plantError(s, 2, st(0), tun)).toBe('full');
  });

  it('stamina', () => {
    const s: DuelState = {
      ...s0,
      players: [{ health: 100, stamina: 7.9, winded: false, streak: 0 }, s0.players[1]],
    };
    expect(plantError(s, 2, st(0), t)).toBe('stamina');
    const exact: DuelState = { ...s, players: [{ ...s.players[0], stamina: 8 }, s.players[1]] };
    expect(plantError(exact, 2, st(0), t)).toBeNull();
  });

  it('valid plant is null', () => {
    expect(plantError(s0, 2, st(0), t)).toBeNull();
  });
});

describe('judgeParry', () => {
  const target = st(0, 0.5, 0.5);

  it('grades by offset', () => {
    expect(judgeParry(target, { x: 0.5, y: 0.5 }, 0, false, t)).toBe('bravo');
    expect(judgeParry(target, { x: 0.5, y: 0.5 }, -45, false, t)).toBe('bravo');
    expect(judgeParry(target, { x: 0.5, y: 0.5 }, 45.1, false, t)).toBe('good');
    expect(judgeParry(target, { x: 0.5, y: 0.5 }, -100, false, t)).toBe('good');
    expect(judgeParry(target, { x: 0.5, y: 0.5 }, 100.1, false, t)).toBe('miss');
    expect(judgeParry(target, { x: 0.5, y: 0.5 }, -200, false, t)).toBe('miss');
    expect(judgeParry(target, { x: 0.5, y: 0.5 }, 200.1, false, t)).toBeNull();
    expect(judgeParry(target, { x: 0.5, y: 0.5 }, -500, false, t)).toBeNull();
  });

  it('checks the radius, larger for touch', () => {
    expect(judgeParry(target, { x: 0.549, y: 0.5 }, 0, false, t)).toBe('bravo');
    expect(judgeParry(target, { x: 0.56, y: 0.5 }, 0, false, t)).toBeNull();
    expect(judgeParry(target, { x: 0.56, y: 0.5 }, 0, true, t)).toBe('bravo');
    expect(judgeParry(target, { x: 0.6, y: 0.5 }, 0, true, t)).toBeNull();
  });

  it('applies the aspect to y for the radius', () => {
    // dy 0.09 -> 0.045 width units, inside 0.05
    expect(judgeParry(target, { x: 0.5, y: 0.59 }, 0, false, t)).toBe('bravo');
    expect(judgeParry(target, { x: 0.5, y: 0.65 }, 0, false, t)).toBeNull();
  });
});

describe('reduceDuel: plant', () => {
  const s0 = initialDuelState(t, 0, 2);

  it('deducts stamina and keeps strikes sorted with matching null results', () => {
    const s = run(s0, [plant(2, st(5, 0.2, 0.5)), plant(2, st(1, 0.9, 0.9)), plant(2, st(3, 0.3, 0.5))]);
    expect(s.strikes.map((x) => x.slot)).toEqual([1, 3, 5]);
    expect(s.results).toEqual([null, null, null]);
    // slot 5 first: 8. slot 1 (nothing below): 8. slot 3 (prev slot 1 at 0.9,0.9): dx .6, dy .4/2=.2 -> d>.6 -> max 20
    const d = Math.hypot(0.6, 0.2);
    const c3 = 8 + 12 * Math.min(1, d / 0.6);
    expect(s.players[0].stamina).toBeCloseTo(100 - 8 - 8 - c3, 9);
    expect(s.players[1].stamina).toBe(100);
  });

  it('returns the same reference for invalid or unaffordable plants', () => {
    expect(reduceDuel(s0, plant(3, st(0)), t, BPM)).toBe(s0);
    expect(reduceDuel(s0, plant(2, st(9)), t, BPM)).toBe(s0);
    const poor: DuelState = {
      ...s0,
      players: [{ health: 100, stamina: 5, winded: false, streak: 0 }, s0.players[1]],
    };
    expect(reduceDuel(poor, plant(2, st(0)), t, BPM)).toBe(poor);
    const once = run(s0, [plant(2, st(0))]);
    expect(reduceDuel(once, plant(2, st(0)), t, BPM)).toBe(once);
  });

  it('planting down to 0 stamina sets winded', () => {
    const tun = createTunables({ startStamina: 16 });
    const s = run(initialDuelState(tun, 0, 0), [plant(0, st(0)), plant(0, st(1))], tun);
    expect(s.players[0].stamina).toBe(0);
    expect(s.players[0].winded).toBe(true);
  });
});

describe('reduceDuel: commit, parry, resolve', () => {
  it('commit moves to defend, next phrase, nulls results', () => {
    const s = run(initialDuelState(t, 0, 2), [
      plant(2, st(0)),
      plant(2, st(4)),
      { type: 'commit', phrase: 2 },
    ]);
    expect(s.phase).toBe('defend');
    expect(s.phrase).toBe(3);
    expect(s.results).toEqual([null, null]);
    expect(s.windedTurn).toBe(false);
    expect(s.attacker).toBe(0);
  });

  it('commit with wrong phrase or phase returns the same reference', () => {
    const s0 = initialDuelState(t, 0, 2);
    expect(reduceDuel(s0, { type: 'commit', phrase: 3 }, t, BPM)).toBe(s0);
    const d = run(s0, [{ type: 'commit', phrase: 2 }]);
    expect(reduceDuel(d, { type: 'commit', phrase: 3 }, t, BPM)).toBe(d);
    expect(reduceDuel(s0, { type: 'resolve', phrase: 2 }, t, BPM)).toBe(s0);
    expect(reduceDuel(s0, { type: 'parry', phrase: 2, index: 0, grade: 'good' }, t, BPM)).toBe(s0);
  });

  const defending = () =>
    run(initialDuelState(t, 0, 2), [
      plant(2, st(0)),
      plant(2, st(2)),
      plant(2, st(4)),
      { type: 'commit', phrase: 2 },
    ]);

  it('bravo costs the attacker stamina and raises the defender streak', () => {
    const d = defending();
    const s = run(d, [{ type: 'parry', phrase: 3, index: 0, grade: 'bravo' }]);
    expect(s.results).toEqual(['bravo', null, null]);
    expect(s.players[0].stamina).toBe(d.players[0].stamina - 6);
    expect(s.players[1].streak).toBe(1);
    expect(s.players[1].health).toBe(100);
  });

  it('good raises the streak only', () => {
    const d = defending();
    const s = run(d, [{ type: 'parry', phrase: 3, index: 1, grade: 'good' }]);
    expect(s.results).toEqual([null, 'good', null]);
    expect(s.players[0].stamina).toBe(d.players[0].stamina);
    expect(s.players[1]).toEqual({ ...d.players[1], streak: 1 });
  });

  it('miss damages, drains stamina and resets the streak', () => {
    const s = run(defending(), [
      { type: 'parry', phrase: 3, index: 0, grade: 'good' },
      { type: 'parry', phrase: 3, index: 1, grade: 'miss' },
    ]);
    expect(s.players[1].health).toBe(90);
    expect(s.players[1].stamina).toBe(92);
    expect(s.players[1].streak).toBe(0);
  });

  it('rejects bad index, repeated index and wrong phrase', () => {
    const d = run(defending(), [{ type: 'parry', phrase: 3, index: 0, grade: 'good' }]);
    expect(reduceDuel(d, { type: 'parry', phrase: 3, index: 0, grade: 'miss' }, t, BPM)).toBe(d);
    expect(reduceDuel(d, { type: 'parry', phrase: 3, index: 3, grade: 'miss' }, t, BPM)).toBe(d);
    expect(reduceDuel(d, { type: 'parry', phrase: 3, index: -1, grade: 'miss' }, t, BPM)).toBe(d);
    expect(reduceDuel(d, { type: 'parry', phrase: 2, index: 1, grade: 'miss' }, t, BPM)).toBe(d);
  });

  it('resolve turns unjudged strikes into misses, then flips roles and regenerates stamina', () => {
    const d = run(defending(), [{ type: 'parry', phrase: 3, index: 0, grade: 'good' }]);
    const s = run(d, [{ type: 'resolve', phrase: 3 }]);
    expect(s.phase).toBe('attack');
    expect(s.phrase).toBe(4);
    expect(s.attacker).toBe(1);
    expect(s.strikes).toEqual([]);
    expect(s.results).toEqual([]);
    expect(s.windedTurn).toBe(false);
    expect(s.players[1].health).toBe(80);
    // 100 - 2 misses * 8 = 84, +35 capped at 100
    expect(s.players[1].stamina).toBe(100);
    expect(s.players[1].streak).toBe(0);
    expect(s.actWins).toEqual([0, 0]);
  });

  it('regeneration adds staminaRegen for the new attacker and caps at startStamina', () => {
    const s0 = initialDuelState(t, 0, 0);
    // player 1 loses stamina by 3 misses = 24 -> 76, +35 -> 100 capped
    const a = turn(s0, [0, 2, 4], null);
    expect(a.players[1].stamina).toBe(100);
    // make player 1 low first
    const low: DuelState = {
      ...s0,
      players: [s0.players[0], { health: 100, stamina: 20, winded: false, streak: 0 }],
    };
    const b = turn(low, [0], null);
    // 20 - 8 = 12, + 35 = 47
    expect(b.players[1].stamina).toBe(47);
    // the old attacker does not regenerate this turn
    expect(b.players[0].stamina).toBe(92);
  });

  it('an empty phrase resolves cleanly', () => {
    const s = turn(initialDuelState(t, 0, 0), [], null);
    expect(s.phase).toBe('attack');
    expect(s.attacker).toBe(1);
    expect(s.phrase).toBe(2);
  });
});

describe('winded', () => {
  it('is set when stamina hits 0, doubles the next defended phrase only, and resets to 50', () => {
    // player 1 will defend with 8 stamina: one miss takes it to 0 mid-phrase
    const s0 = initialDuelState(t, 0, 0);
    const start: DuelState = {
      ...s0,
      players: [s0.players[0], { health: 100, stamina: 8, winded: false, streak: 0 }],
    };
    // Phrase 1 (defend): two misses. First sets winded; the phrase is NOT doubled.
    let s = run(start, [plant(0, st(0)), plant(0, st(2)), { type: 'commit', phrase: 0 }]);
    expect(s.windedTurn).toBe(false);
    s = run(s, [{ type: 'parry', phrase: 1, index: 0, grade: 'miss' }]);
    expect(s.players[1].stamina).toBe(0);
    expect(s.players[1].winded).toBe(true);
    expect(s.players[1].health).toBe(90);
    s = run(s, [
      { type: 'parry', phrase: 1, index: 1, grade: 'miss' },
      { type: 'resolve', phrase: 1 },
    ]);
    expect(s.players[1].health).toBe(80);
    expect(s.players[1].winded).toBe(true);
    // new attacker regenerates 35 but stays winded
    expect(s.attacker).toBe(1);
    expect(s.players[1].stamina).toBe(35);
    expect(s.players[1].winded).toBe(true);

    // Phrase 2: player 1 attacks, player 0 defends. Normal damage for player 0.
    s = turn(s, [0], 'miss');
    expect(s.players[0].health).toBe(90);

    // Phrase 4: player 0 attacks again, player 1 defends the winded phrase: doubled.
    expect(s.attacker).toBe(0);
    s = run(s, [plant(4, st(0)), plant(4, st(2)), { type: 'commit', phrase: 4 }]);
    expect(s.windedTurn).toBe(true);
    s = run(s, [
      { type: 'parry', phrase: 5, index: 0, grade: 'miss' },
      { type: 'resolve', phrase: 5 },
    ]);
    // index 0 miss: -20; index 1 unjudged -> miss: -20
    expect(s.players[1].health).toBe(80 - 40);
    expect(s.players[1].winded).toBe(false);
    // reset to 50, then +35 as new attacker
    expect(s.players[1].stamina).toBe(85);

    // The following defended phrase is normal again.
    s = turn(s, [0], null); // player 1 attacks, player 0 defends
    s = turn(s, [0], 'miss'); // player 0 attacks, player 1 defends: normal damage
    expect(s.players[1].health).toBe(30);
  });

  it('winded reset to 50 happens after the misses of the doubled phrase', () => {
    const s0 = initialDuelState(t, 0, 0);
    const w: DuelState = {
      ...s0,
      players: [s0.players[0], { health: 100, stamina: 0, winded: true, streak: 0 }],
    };
    let s = run(w, [plant(0, st(0)), { type: 'commit', phrase: 0 }]);
    expect(s.windedTurn).toBe(true);
    s = run(s, [{ type: 'resolve', phrase: 1 }]);
    expect(s.players[1].health).toBe(80);
    expect(s.players[1].winded).toBe(false);
    expect(s.players[1].stamina).toBe(50 + 35);
  });

  it('bravo can wind the attacker', () => {
    const s0 = initialDuelState(t, 0, 0);
    const w: DuelState = {
      ...s0,
      players: [{ health: 100, stamina: 14, winded: false, streak: 0 }, s0.players[1]],
    };
    let s = run(w, [plant(0, st(0)), { type: 'commit', phrase: 0 }]);
    expect(s.players[0].stamina).toBe(6);
    s = run(s, [{ type: 'parry', phrase: 1, index: 0, grade: 'bravo' }]);
    expect(s.players[0].stamina).toBe(0);
    expect(s.players[0].winded).toBe(true);
  });
});

describe('acts and match', () => {
  it('act ends when health hits 0, the other player wins; the next act is set up', () => {
    const tun = createTunables({ startHealth: 20 });
    let s = initialDuelState(tun, 0, 0);
    s = turn(s, [0, 2], 'miss', tun); // player 1 health 20 -> 0
    expect(s.actWins).toEqual([1, 0]);
    expect(s.lastActWinner).toBe(0);
    expect(s.lastActEndPhrase).toBe(1);
    expect(s.phase).toBe('attack');
    expect(s.act).toBe(1);
    expect(s.firstAttacker).toBe(1);
    expect(s.attacker).toBe(1);
    expect(s.actFirstPhrase).toBe(1 + 1 + 2 + 1);
    expect(s.phrase).toBe(5);
    expect(s.players).toEqual([
      { health: 20, stamina: 100, winded: false, streak: 0 },
      { health: 20, stamina: 100, winded: false, streak: 0 },
    ]);
    expect(s.strikes).toEqual([]);
    expect(s.results).toEqual([]);
    expect(s.windedTurn).toBe(false);
    expect(s.matchWinner).toBeNull();
  });

  it('health never goes below 0', () => {
    const tun = createTunables({ startHealth: 5 });
    const s = run(
      initialDuelState(tun, 0, 0),
      [plant(0, st(0)), { type: 'commit', phrase: 0 }, { type: 'parry', phrase: 1, index: 0, grade: 'miss' }],
      tun,
    );
    expect(s.players[1].health).toBe(0);
  });

  it('act ends on time with the higher health winning', () => {
    const tun = createTunables({ actDurationSec: 6 }); // 3 phrases at 120 BPM
    let s = initialDuelState(tun, 0, 0);
    s = turn(s, [0], 'miss', tun); // phrase 0/1: p1 health 90. (1+1-0)*2 = 4 < 6
    expect(s.actWins).toEqual([0, 0]);
    expect(s.phrase).toBe(2);
    // phrase 2/3: p1 attacks, p0 defends and parries well. (3+1-0)*2 = 8 >= 6
    s = turn(s, [0], 'good', tun);
    expect(s.actWins).toEqual([1, 0]);
    expect(s.lastActWinner).toBe(0);
    expect(s.lastActEndPhrase).toBe(3);
    expect(s.act).toBe(1);
    expect(s.actFirstPhrase).toBe(3 + 1 + 2 + 1);
  });

  it('time check uses the act first phrase', () => {
    const tun = createTunables({ actDurationSec: 4 }); // 2 phrases
    let s = initialDuelState(tun, 0, 10);
    s = turn(s, [0], 'miss', tun); // (11+1-10)*2 = 4 >= 4, health differs
    expect(s.actWins).toEqual([1, 0]);
    expect(s.actFirstPhrase).toBe(11 + 1 + 2 + 1);
  });

  it('a tie on time plays on', () => {
    const tun = createTunables({ actDurationSec: 4 });
    let s = initialDuelState(tun, 0, 0);
    s = turn(s, [0], 'good', tun);
    expect(s.actWins).toEqual([0, 0]);
    expect(s.phase).toBe('attack');
    expect(s.phrase).toBe(2);
    expect(s.act).toBe(0);
    // next turn differs: p0 defends and misses -> p0 lower -> p1 wins
    s = turn(s, [0], 'miss', tun);
    expect(s.actWins).toEqual([0, 1]);
    expect(s.lastActWinner).toBe(1);
  });

  it('best of three ends in matchOver and ignores further events', () => {
    const tun = createTunables({ startHealth: 10 });
    let s = initialDuelState(tun, 0, 0);
    // Act 0: p0 attacks, p1 misses once -> dead. p0 wins.
    s = turn(s, [0], 'miss', tun);
    expect(s.actWins).toEqual([1, 0]);
    expect(s.attacker).toBe(1);
    // Act 1: p1 attacks first; p0 dies. p1 wins.
    s = turn(s, [0], 'miss', tun);
    expect(s.actWins).toEqual([1, 1]);
    expect(s.firstAttacker).toBe(0);
    expect(s.act).toBe(2);
    // Act 2: p0 first again; p1 dies. p0 takes the match.
    const before = s;
    s = turn(s, [3], 'miss', tun);
    expect(s).not.toBe(before);
    expect(s.phase).toBe('matchOver');
    expect(s.matchWinner).toBe(0);
    expect(s.actWins).toEqual([2, 1]);
    expect(s.lastActWinner).toBe(0);
    expect(s.strikes).toHaveLength(1);
    expect(s.results).toEqual(['miss']);
    expect(s.players[1].health).toBe(0);

    const events: DuelEvent[] = [
      plant(s.phrase, st(0)),
      { type: 'commit', phrase: s.phrase },
      { type: 'parry', phrase: s.phrase, index: 0, grade: 'good' },
      { type: 'resolve', phrase: s.phrase },
    ];
    for (const e of events) expect(reduceDuel(s, e, t, BPM)).toBe(s);
  });

  it('match winner with actsToWin 1 after a single act', () => {
    const tun = createTunables({ startHealth: 10, actsToWin: 1 });
    const s = turn(initialDuelState(tun, 1, 0), [0], 'miss', tun);
    expect(s.phase).toBe('matchOver');
    expect(s.matchWinner).toBe(1);
  });
});

describe('purity', () => {
  it('never mutates its inputs', () => {
    const events: DuelEvent[] = [
      plant(0, st(4, 0.2, 0.2)),
      plant(0, st(1, 0.8, 0.8)),
      { type: 'commit', phrase: 0 },
      { type: 'parry', phrase: 1, index: 0, grade: 'bravo' },
      { type: 'parry', phrase: 1, index: 1, grade: 'miss' },
      { type: 'resolve', phrase: 1 },
    ];
    let s = deepFreeze(initialDuelState(t, 0, 0));
    for (const e of events) {
      s = deepFreeze(reduceDuel(s, deepFreeze({ ...e }), t, BPM));
    }
    expect(s.phrase).toBe(2);
  });

  it('is deterministic', () => {
    const events: DuelEvent[] = [
      plant(0, st(4, 0.2, 0.2)),
      plant(0, st(1, 0.8, 0.8)),
      { type: 'commit', phrase: 0 },
      { type: 'parry', phrase: 1, index: 0, grade: 'bravo' },
      { type: 'resolve', phrase: 1 },
      { type: 'resolve', phrase: 1 },
    ];
    const a = run(initialDuelState(t, 0, 0), events);
    const b = run(initialDuelState(t, 0, 0), events);
    expect(a).toEqual(b);
  });

  it('wrong-phrase events return the same reference in every phase', () => {
    const s0 = initialDuelState(t, 0, 0);
    expect(reduceDuel(s0, plant(1, st(0)), t, BPM)).toBe(s0);
    expect(reduceDuel(s0, { type: 'commit', phrase: 1 }, t, BPM)).toBe(s0);
    const d = run(s0, [plant(0, st(0)), { type: 'commit', phrase: 0 }]);
    expect(reduceDuel(d, { type: 'parry', phrase: 0, index: 0, grade: 'good' }, t, BPM)).toBe(d);
    expect(reduceDuel(d, { type: 'resolve', phrase: 0 }, t, BPM)).toBe(d);
  });
});
