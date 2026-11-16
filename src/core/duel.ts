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

// ---------------------------------------------------------------- untrusted input

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function isPlayerId(v: unknown): v is PlayerId {
  return v === 0 || v === 1;
}

function isGradeValue(v: unknown): v is Grade {
  return v === 'bravo' || v === 'good' || v === 'miss';
}

/**
 * Rebuilds a strike list received from the other player, checking each strike the way a plant is checked:
 * integer slot inside the phrase, positions 0..1, no two on one slot, no more than the phrase holds.
 * Returns fresh strikes sorted by slot, or null if anything is wrong.
 */
export function checkedStrikes(input: unknown, t: Tunables): Strike[] | null {
  if (!Array.isArray(input)) return null;
  const spp = slotsPerPhrase(t);
  if (input.length > spp) return null;
  const seen = new Set<number>();
  const out: Strike[] = [];
  for (const raw of input as unknown[]) {
    if (!isRecord(raw)) return null;
    const { slot, x, y } = raw;
    if (typeof slot !== 'number' || typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isInteger(slot) || slot < 0 || slot >= spp || !inUnit(x) || !inUnit(y)) return null;
    if (seen.has(slot)) return null;
    seen.add(slot);
    out.push({ slot, x, y });
  }
  out.sort((a, b) => a.slot - b.slot);
  return out;
}

function checkedPlayer(v: unknown, t: Tunables): PlayerState | null {
  if (!isRecord(v)) return null;
  const { health, stamina, winded, streak } = v;
  if (typeof health !== 'number' || !Number.isFinite(health) || health < -1e6 || health > 1e6) return null;
  if (typeof stamina !== 'number' || !Number.isFinite(stamina) || stamina < 0 || stamina > t.startStamina) {
    return null;
  }
  if (typeof winded !== 'boolean' || !isCount(streak)) return null;
  return { health, stamina, winded, streak };
}

/**
 * Checks a `DuelState` received from the other player and returns a clean copy, or null if it is
 * malformed (wrong types, out-of-range numbers, strikes that could not have been planted).
 */
export function parseDuelState(input: unknown, t: Tunables): DuelState | null {
  if (!isRecord(input)) return null;
  const s = input;
  if (s.phase !== 'attack' && s.phase !== 'defend' && s.phase !== 'matchOver') return null;
  if (!isCount(s.act) || !isCount(s.actFirstPhrase) || !isCount(s.phrase)) return null;
  if (!isPlayerId(s.firstAttacker) || !isPlayerId(s.attacker)) return null;
  if (typeof s.windedTurn !== 'boolean') return null;
  if (s.lastActWinner !== null && !isPlayerId(s.lastActWinner)) return null;
  if (s.matchWinner !== null && !isPlayerId(s.matchWinner)) return null;
  if (s.lastActEndPhrase !== null && !isCount(s.lastActEndPhrase)) return null;

  const wins = s.actWins;
  if (!Array.isArray(wins) || wins.length !== 2 || !isCount(wins[0]) || !isCount(wins[1])) return null;
  const rawPlayers = s.players;
  if (!Array.isArray(rawPlayers) || rawPlayers.length !== 2) return null;
  const p0 = checkedPlayer(rawPlayers[0], t);
  const p1 = checkedPlayer(rawPlayers[1], t);
  if (!p0 || !p1) return null;

  const strikes = checkedStrikes(s.strikes, t);
  if (!strikes) return null;
  const results = s.results;
  if (!Array.isArray(results) || results.length !== strikes.length) return null;
  for (const r of results as unknown[]) if (r !== null && !isGradeValue(r)) return null;

  return {
    phase: s.phase,
    act: s.act,
    actWins: [wins[0], wins[1]],
    actFirstPhrase: s.actFirstPhrase,
    phrase: s.phrase,
    firstAttacker: s.firstAttacker,
    attacker: s.attacker,
    players: [p0, p1],
    strikes,
    results: (results as (Grade | null)[]).slice(),
    windedTurn: s.windedTurn,
    lastActWinner: s.lastActWinner,
    lastActEndPhrase: s.lastActEndPhrase,
    matchWinner: s.matchWinner,
  };
}
