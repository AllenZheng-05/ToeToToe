import { phraseDuration, slotsPerPhrase } from './beat';
import type { DuelEvent, DuelState, Grade, PlayerId, PlayerState, Strike, Tunables } from './types';

type Players = [PlayerState, PlayerState];

export function otherPlayer(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

export function defenderOf(s: DuelState): PlayerId {
  return otherPlayer(s.attacker);
}

function freshPlayer(t: Tunables): PlayerState {
  return { health: t.startHealth, stamina: t.startStamina, winded: false, streak: 0 };
}

export function initialDuelState(t: Tunables, firstAttacker: PlayerId, firstPhrase: number): DuelState {
  return {
    phase: 'attack',
    act: 0,
    actWins: [0, 0],
    actFirstPhrase: firstPhrase,
    phrase: firstPhrase,
    firstAttacker,
    attacker: firstAttacker,
    players: [freshPlayer(t), freshPlayer(t)],
    strikes: [],
    results: [],
    windedTurn: false,
    lastActWinner: null,
    lastActEndPhrase: null,
    matchWinner: null,
  };
}

/** Distance between two play-area points in width units (y differences divided by playAreaAspect). */
export function playDistance(a: { x: number; y: number }, b: { x: number; y: number }, t: Tunables): number {
  return Math.hypot(a.x - b.x, (a.y - b.y) / t.playAreaAspect);
}

/** Cost for the attacker to plant `next`, given the strikes already planted this phrase. */
export function strikeCost(strikes: readonly Strike[], next: Strike, t: Tunables): number {
  let prev: Strike | null = null;
  for (const st of strikes) {
    if (st.slot < next.slot && (prev === null || st.slot > prev.slot)) prev = st;
  }
  if (prev === null) return t.strikeBaseCost;
  const d = playDistance(prev, next, t);
  return t.strikeBaseCost + t.strikeDistanceCostMax * Math.min(1, d / t.strikeDistanceForMaxCost);
}

export type PlantError = 'wrongPhase' | 'badStrike' | 'slotTaken' | 'full' | 'stamina';

function inUnit(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

export function plantError(s: DuelState, phrase: number, strike: Strike, t: Tunables): PlantError | null {
  if (s.phase !== 'attack' || phrase !== s.phrase) return 'wrongPhase';
  const spp = slotsPerPhrase(t);
  if (
    !Number.isInteger(strike.slot) ||
    strike.slot < 0 ||
    strike.slot >= spp ||
    !inUnit(strike.x) ||
    !inUnit(strike.y)
  ) {
    return 'badStrike';
  }
  if (s.strikes.length >= spp) return 'full';
  if (s.strikes.some((st) => st.slot === strike.slot)) return 'slotTaken';
  if (s.players[s.attacker].stamina < strikeCost(s.strikes, strike, t)) return 'stamina';
  return null;
}

/**
 * Grade a click against one strike. offsetMs = click time minus the strike's beat time (negative = early).
 * Returns null when the click is outside the target circle or |offsetMs| > missWindowMs.
 */
export function judgeParry(
  strike: Strike,
  click: { x: number; y: number },
  offsetMs: number,
  touch: boolean,
  t: Tunables,
): Grade | null {
  const radius = touch ? t.targetRadiusTouch : t.targetRadius;
  if (playDistance(strike, click, t) > radius) return null;
  const a = Math.abs(offsetMs);
  if (a <= t.bravoWindowMs) return 'bravo';
  if (a <= t.goodWindowMs) return 'good';
  if (a <= t.missWindowMs) return 'miss';
  return null;
}

// ---------------------------------------------------------------- reducer

function withPlayer(players: Players, id: PlayerId, p: PlayerState): Players {
  return id === 0 ? [p, players[1]] : [players[0], p];
}

/** Clamp stamina into [0, startStamina], health at 0, and set winded when stamina reaches 0. */
function settle(p: PlayerState, t: Tunables): PlayerState {
  const stamina = Math.min(t.startStamina, Math.max(0, p.stamina));
  return { ...p, stamina, health: Math.max(0, p.health), winded: p.winded || stamina === 0 };
}

function applyGrade(
  attacker: PlayerId,
  windedTurn: boolean,
  players: Players,
  grade: Grade,
  t: Tunables,
): Players {
  const def = otherPlayer(attacker);
  if (grade === 'bravo') {
    const a = players[attacker];
    const next = withPlayer(players, attacker, settle({ ...a, stamina: a.stamina - t.bravoStaminaLoss }, t));
    return withPlayer(next, def, { ...next[def], streak: next[def].streak + 1 });
  }
  if (grade === 'good') {
    return withPlayer(players, def, { ...players[def], streak: players[def].streak + 1 });
  }
  const dmg = t.missDamage * (windedTurn ? t.windedDamageMultiplier : 1);
  const d = players[def];
  return withPlayer(
    players,
    def,
    settle({ ...d, health: d.health - dmg, stamina: d.stamina - t.missStaminaLoss, streak: 0 }, t),
  );
}

export function reduceDuel(s: DuelState, e: DuelEvent, t: Tunables, bpm: number): DuelState {
  if (s.phase === 'matchOver') return s;

  switch (e.type) {
    case 'plant': {
      if (plantError(s, e.phrase, e.strike, t) !== null) return s;
      const cost = strikeCost(s.strikes, e.strike, t);
      const strike: Strike = { slot: e.strike.slot, x: e.strike.x, y: e.strike.y };
      let at = s.strikes.findIndex((st) => st.slot > strike.slot);
      if (at < 0) at = s.strikes.length;
      const strikes = [...s.strikes.slice(0, at), strike, ...s.strikes.slice(at)];
      const results = [...s.results.slice(0, at), null, ...s.results.slice(at)];
      const a = s.players[s.attacker];
      const players = withPlayer(s.players, s.attacker, settle({ ...a, stamina: a.stamina - cost }, t));
      return { ...s, players, strikes, results };
    }

    case 'commit': {
      if (s.phase !== 'attack' || e.phrase !== s.phrase) return s;
      return {
        ...s,
        phase: 'defend',
        phrase: s.phrase + 1,
        windedTurn: s.players[defenderOf(s)].winded,
        results: s.strikes.map(() => null),
      };
    }

    case 'parry': {
      if (s.phase !== 'defend' || e.phrase !== s.phrase) return s;
      if (!Number.isInteger(e.index) || e.index < 0 || e.index >= s.results.length) return s;
      if (s.results[e.index] !== null) return s;
      const results = s.results.slice();
      results[e.index] = e.grade;
      return { ...s, results, players: applyGrade(s.attacker, s.windedTurn, s.players, e.grade, t) };
    }

    case 'resolve': {
      if (s.phase !== 'defend' || e.phrase !== s.phrase) return s;
      let players = s.players;
      const results = s.results.slice();
      for (let i = 0; i < results.length; i++) {
        if (results[i] === null) {
          results[i] = 'miss';
          players = applyGrade(s.attacker, s.windedTurn, players, 'miss', t);
        }
      }
      const def = defenderOf(s);
      if (s.windedTurn) {
        players = withPlayer(players, def, { ...players[def], stamina: t.windedResetStamina, winded: false });
      }

      let winner: PlayerId | null = null;
      if (players[0].health <= 0) winner = 1;
      else if (players[1].health <= 0) winner = 0;
      else if (
        (s.phrase + 1 - s.actFirstPhrase) * phraseDuration(bpm, t) >= t.actDurationSec &&
        players[0].health !== players[1].health
      ) {
        winner = players[0].health > players[1].health ? 0 : 1;
      }

      if (winner !== null) {
        const actWins: [number, number] = [s.actWins[0], s.actWins[1]];
        actWins[winner] += 1;
        const ended = { lastActWinner: winner, lastActEndPhrase: s.phrase, actWins };
        if (actWins[winner] >= t.actsToWin) {
          return { ...s, ...ended, players, results, phase: 'matchOver', matchWinner: winner };
        }
        const firstAttacker = otherPlayer(s.firstAttacker);
        const next = s.phrase + 1 + t.intermissionPhrases + t.countInPhrases;
        return {
          ...s,
          ...ended,
          act: s.act + 1,
          firstAttacker,
          attacker: firstAttacker,
          players: [freshPlayer(t), freshPlayer(t)],
          actFirstPhrase: next,
          phrase: next,
          phase: 'attack',
          strikes: [],
          results: [],
          windedTurn: false,
        };
      }

      const a = players[def];
      players = withPlayer(players, def, {
        ...a,
        stamina: Math.min(t.startStamina, a.stamina + t.staminaRegen),
      });
      return {
        ...s,
        players,
        attacker: def,
        phase: 'attack',
        phrase: s.phrase + 1,
        strikes: [],
        results: [],
        windedTurn: false,
      };
    }
  }
}
