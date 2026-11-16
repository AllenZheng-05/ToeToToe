import { describe, expect, it } from 'vitest';
import { parseParams } from '../../src/app/params';
import { cleanName } from '../../src/app/profile';
import { checkedStrikes, initialDuelState, parseDuelState } from '../../src/core/duel';
import { cleanText } from '../../src/core/text';
import {
  DEFAULT_TUNABLES,
  createTunables,
  themeBeatOk,
  tunableInRange,
  validateTunables,
} from '../../src/core/tunables';

describe('validateTunables', () => {
  it('accepts the defaults and returns a fresh copy', () => {
    const t = validateTunables({ ...DEFAULT_TUNABLES });
    expect(t).toEqual({ ...DEFAULT_TUNABLES });
    expect(t).not.toBe(DEFAULT_TUNABLES);
  });

  it('rejects anything that is not a plain object', () => {
    for (const v of [null, undefined, 5, 'x', [], [1, 2]]) expect(validateTunables(v)).toBeNull();
  });

  it('rejects a missing field, a non-number and a non-finite number', () => {
    const missing: Record<string, unknown> = { ...DEFAULT_TUNABLES };
    delete missing.startHealth;
    expect(validateTunables(missing)).toBeNull();
    expect(validateTunables({ ...DEFAULT_TUNABLES, startHealth: '100' })).toBeNull();
    expect(validateTunables({ ...DEFAULT_TUNABLES, startHealth: Number.NaN })).toBeNull();
    expect(validateTunables({ ...DEFAULT_TUNABLES, startHealth: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('rejects out-of-range values', () => {
    const bad: Record<string, number> = {
      startHealth: 1e12,
      startStamina: 0,
      missDamage: -1,
      goodWindowMs: 5000,
      targetRadius: 0,
      targetRadiusTouch: 3,
      playAreaAspect: 0,
      actDurationSec: 1e9,
      clockJumpMs: 0,
      startLeadSec: 600,
      ringLeadBeats: 100,
      minBpm: 5,
      maxBpm: 9000,
    };
    for (const [key, value] of Object.entries(bad)) {
      expect(validateTunables({ ...DEFAULT_TUNABLES, [key]: value }), key).toBeNull();
    }
  });

  it('wants whole numbers where they must be, with tight bounds on the small ones', () => {
    const bad: Record<string, number> = {
      slotsPerBeat: 2.5,
      beatsPerPhrase: 1e9,
      countInPhrases: -1,
      intermissionPhrases: 1.5,
      actsToWin: 0,
    };
    for (const [key, value] of Object.entries(bad)) {
      expect(validateTunables({ ...DEFAULT_TUNABLES, [key]: value }), key).toBeNull();
    }
    expect(validateTunables({ ...DEFAULT_TUNABLES, slotsPerBeat: 4, beatsPerPhrase: 8 })).not.toBeNull();
    expect(validateTunables({ ...DEFAULT_TUNABLES, slotsPerBeat: 5 })).toBeNull();
  });

  it('rejects a minimum tempo above the maximum', () => {
    expect(validateTunables({ ...DEFAULT_TUNABLES, minBpm: 150, maxBpm: 100 })).toBeNull();
  });

  it('ignores unknown keys', () => {
    expect(validateTunables({ ...DEFAULT_TUNABLES, bogus: 1 })).toEqual({ ...DEFAULT_TUNABLES });
  });

  it('tunableInRange only knows real tunables', () => {
    expect(tunableInRange('startHealth', 50)).toBe(true);
    expect(tunableInRange('toString', 50)).toBe(false);
    expect(tunableInRange('startHealth', 0)).toBe(false);
  });
});

describe('the ?tunables= parameter', () => {
  const base = 'http://localhost/';
  const q = (o: unknown) => `${base}?tunables=${encodeURIComponent(JSON.stringify(o))}`;

  it('drops out-of-range values and keeps the good ones', () => {
    expect(parseParams(q({ startHealth: 30, missDamage: -5, slotsPerBeat: 99 })).tunables).toEqual({
      startHealth: 30,
    });
  });

  it('drops everything when the set is not consistent', () => {
    expect(parseParams(q({ startHealth: 30, minBpm: 150, maxBpm: 100 })).tunables).toEqual({});
  });
});

describe('theme offer bounds', () => {
  const t = createTunables();
  it('holds an upload to the tempo range and a first beat inside the song', () => {
    expect(themeBeatOk('upload', 120, 0.5, t)).toBe(true);
    expect(themeBeatOk('upload', 79, 0.5, t)).toBe(false);
    expect(themeBeatOk('upload', 241, 0.5, t)).toBe(false);
    expect(themeBeatOk('upload', 222.22, 0.5, t)).toBe(true);
    expect(themeBeatOk('upload', 240, 0.5, t)).toBe(true);
    expect(themeBeatOk('upload', 120, -0.1, t)).toBe(false);
    expect(themeBeatOk('upload', 120, 361, t)).toBe(false);
    expect(themeBeatOk('upload', Number.NaN, 0, t)).toBe(false);
    expect(themeBeatOk('upload', 120, Number.POSITIVE_INFINITY, t)).toBe(false);
  });

  it('lets house and click themes use any tempo a manifest allows', () => {
    expect(themeBeatOk('house', 280, 0, t)).toBe(true);
    expect(themeBeatOk('house', 29, 0, t)).toBe(false);
    expect(themeBeatOk('click', 120, 0, t)).toBe(true);
    expect(themeBeatOk('click', 100000, 0, t)).toBe(false);
  });
});

describe('cleanText and cleanName', () => {
  it('removes control, zero-width and direction-override characters', () => {
    expect(cleanText('a\u0000b\u0007c‮d⁦e​f﻿g\u007Fh', 20, 'x')).toBe('abcdefgh');
  });

  it('caps the length in characters and trims', () => {
    expect(cleanText(`  ${'n'.repeat(50)}  `, 20, 'x')).toBe('n'.repeat(20));
    expect(Array.from(cleanText('😀'.repeat(30), 5, 'x'))).toHaveLength(5);
  });

  it('falls back when nothing is left or the input is not text', () => {
    expect(cleanText('‮\u0000', 20, 'Player')).toBe('Player');
    expect(cleanText(42, 20, 'Player')).toBe('Player');
    expect(cleanText('   ', 20, 'Player')).toBe('Player');
  });

  it('cleanName is the same 20-character clean', () => {
    expect(cleanName(`‮${'z'.repeat(40)}`)).toBe('z'.repeat(20));
    expect(cleanName('')).toBe('Player');
  });
});

describe('checkedStrikes', () => {
  const t = createTunables();
  const ok = { slot: 3, x: 0.5, y: 0.25 };

  it('returns fresh strikes sorted by slot', () => {
    const out = checkedStrikes([{ slot: 5, x: 1, y: 0 }, ok, { ...ok, slot: 0, extra: 1 }], t);
    expect(out?.map((s) => s.slot)).toEqual([0, 3, 5]);
    expect(out?.[0]).toEqual({ slot: 0, x: 0.5, y: 0.25 });
  });

  it('rejects a slot outside the phrase, a position outside 0..1, duplicates and too many', () => {
    expect(checkedStrikes([{ ...ok, slot: 8 }], t)).toBeNull();
    expect(checkedStrikes([{ ...ok, slot: -1 }], t)).toBeNull();
    expect(checkedStrikes([{ ...ok, slot: 1.5 }], t)).toBeNull();
    expect(checkedStrikes([{ ...ok, x: 1.2 }], t)).toBeNull();
    expect(checkedStrikes([{ ...ok, y: -0.1 }], t)).toBeNull();
    expect(checkedStrikes([{ ...ok, x: Number.NaN }], t)).toBeNull();
    expect(checkedStrikes([ok, { ...ok }], t)).toBeNull();
    const nine = Array.from({ length: 9 }, (_, i) => ({ slot: i % 8, x: 0, y: 0 }));
    expect(checkedStrikes(nine, t)).toBeNull();
    expect(checkedStrikes([null], t)).toBeNull();
    expect(checkedStrikes('x', t)).toBeNull();
  });
});

describe('parseDuelState', () => {
  const t = createTunables();
  const good = () => initialDuelState(t, 0, 1);

  it('accepts a real state and returns a copy', () => {
    const s = good();
    const parsed = parseDuelState(JSON.parse(JSON.stringify(s)), t);
    expect(parsed).toEqual(s);
  });

  it('rejects anything malformed', () => {
    const bad: unknown[] = [
      null,
      5,
      [],
      { ...good(), phase: 'nope' },
      { ...good(), players: 'x' },
      { ...good(), players: [good().players[0]] },
      { ...good(), players: [good().players[0], { health: 'a', stamina: 1, winded: false, streak: 0 }] },
      { ...good(), players: [good().players[0], { health: 1, stamina: -5, winded: false, streak: 0 }] },
      { ...good(), phrase: Number.NaN },
      { ...good(), phrase: -1 },
      { ...good(), phrase: 1.5 },
      { ...good(), attacker: 2 },
      { ...good(), actWins: [1] },
      { ...good(), strikes: [{ slot: 99, x: 0, y: 0 }], results: [null] },
      { ...good(), strikes: [{ slot: 1, x: 0, y: 0 }], results: [] },
      { ...good(), strikes: [{ slot: 1, x: 0, y: 0 }], results: ['perfect'] },
      { ...good(), windedTurn: 'no' },
      { ...good(), matchWinner: 3 },
      { ...good(), lastActEndPhrase: 'x' },
    ];
    for (const b of bad) expect(parseDuelState(b, t)).toBeNull();
  });
});
