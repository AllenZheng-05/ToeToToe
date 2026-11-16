import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, DIFFICULTY_TABLE, type BotDifficulty } from '../../src/net/botDifficulty';
import { playBotDuel } from '../helpers/botDuel';

describe('bot against bot, whole matches on a fake clock', () => {
  it('never has a plant rejected for stamina, at any level', () => {
    let matches = 0;
    for (const a of DIFFICULTIES) {
      for (const b of DIFFICULTIES) {
        for (let k = 0; k < 2; k++) {
          const r = playBotDuel({
            host: { difficulty: a, seed: 10 + k },
            bot: { difficulty: b, seed: 50 + k },
          });
          expect(r.host.state.phase).toBe('matchOver');
          expect(r.staminaRejections).toBe(0);
          expect(r.hostEvents.some((e) => e.type === 'rejected')).toBe(false);
          expect(r.botEvents.some((e) => e.type === 'rejected')).toBe(false);
          expect(r.hostEvents.some((e) => e.type === 'desync')).toBe(false);
          expect(r.host.state).toEqual(r.bot.session.state);
          matches++;
        }
      }
    }
    expect(matches).toBe(32);
  });

  it('is deterministic for a given seed', () => {
    const run = () =>
      playBotDuel({ host: { difficulty: 'expert', seed: 4 }, bot: { difficulty: 'hard', seed: 5 } });
    const a = run();
    const b = run();
    expect(a.frames).toBe(b.frames);
    expect(a.host.state).toEqual(b.host.state);
    expect(a.hostEvents).toEqual(b.hostEvents);
  });

  it('an Expert is never Winded by its own planting, unless it is finishing', () => {
    let phrases = 0;
    for (let seed = 1; seed <= 12; seed++) {
      let phraseSeen = -1;
      let windedBefore = false;
      let oppHealth = 0;
      let oppWinded = false;
      const t = { missDamage: 10, windedDamageMultiplier: 2, slots: 8 };
      playBotDuel({
        host: { difficulty: seed % 2 ? 'hard' : 'medium', seed },
        bot: { difficulty: 'expert', seed: seed + 100 },
        onFrame: ({ bot }) => {
          const s = bot.session.state;
          if (s.phase === 'attack' && s.attacker === 1) {
            if (s.phrase !== phraseSeen) {
              phraseSeen = s.phrase;
              windedBefore = s.players[1].winded;
              oppHealth = s.players[0].health;
              oppWinded = s.players[0].winded;
              phrases++;
            } else if (!windedBefore && s.players[1].winded) {
              // It planted itself to 0: only allowed with a kill in reach.
              const reach = t.slots * t.missDamage * (oppWinded ? t.windedDamageMultiplier : 1);
              expect(oppHealth).toBeLessThanOrEqual(reach);
              windedBefore = true;
            }
          }
        },
      });
    }
    expect(phrases).toBeGreaterThan(100);
  });

  it('shows its pattern and live parry chance for the debug hook', () => {
    const seen = new Set<string>();
    playBotDuel({
      host: { difficulty: 'easy', seed: 1 },
      bot: { difficulty: 'hard', seed: 2 },
      onFrame: ({ bot }) => {
        const p = bot.driver.pattern;
        if (p) seen.add(p);
        expect(bot.driver.options.difficulty).toBe('hard');
        expect(bot.driver.parryChance()).toBeLessThanOrEqual(0.9);
        expect(bot.driver.parryChance()).toBeGreaterThanOrEqual(0.68);
      },
    });
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe('tiredness inside a match', () => {
  const tunables = { actDurationSec: 20 };

  it('slides down within an act and starts fresh again in the next', () => {
    for (const level of ['easy', 'expert'] as BotDifficulty[]) {
      const row = DIFFICULTY_TABLE[level];
      let act = 0;
      let last = row.parry.fresh;
      let reachedFloor = false;
      let resets = 0;
      let floorActs = 0;
      playBotDuel({
        host: { difficulty: 'hard', seed: 3 },
        bot: { difficulty: level, seed: 8 },
        tunables,
        onFrame: ({ bot }) => {
          const p = bot.driver.parryChance();
          if (bot.session.state.act !== act) {
            // A new act: fresh, whatever the last one ended on.
            expect(p).toBe(row.parry.fresh);
            if (last < row.parry.fresh) resets++;
            if (reachedFloor) floorActs++;
            act = bot.session.state.act;
            reachedFloor = false;
          } else {
            expect(p).toBeLessThanOrEqual(last + 1e-12);
          }
          last = p;
          if (Math.abs(p - row.parry.tired) < 1e-9) reachedFloor = true;
        },
      });
      expect(resets, level).toBeGreaterThan(0);
      expect(floorActs + (reachedFloor ? 1 : 0), level).toBeGreaterThan(0);
    }
  });

  it('is constant when the caller fixes the accuracy or the Bravo share', () => {
    const accuracies = new Set<number>();
    const bravos = new Set<number>();
    playBotDuel({
      host: { difficulty: 'hard', seed: 3 },
      bot: { difficulty: 'expert', seed: 8, accuracy: 0.6, bravoRate: 0.25 },
      tunables,
      onFrame: ({ bot }) => {
        accuracies.add(bot.driver.options.accuracy);
        bravos.add(bot.driver.options.bravoRate);
      },
    });
    expect([...accuracies]).toEqual([0.6]);
    expect([...bravos]).toEqual([0.25]);
  });

  it('can be fixed live through the options, as the debug panel does', () => {
    const seen: number[] = [];
    playBotDuel({
      host: { difficulty: 'hard', seed: 3 },
      bot: { difficulty: 'medium', seed: 8 },
      maxSeconds: 30,
      onFrame: ({ bot }) => {
        if (seen.length === 600) bot.driver.options.accuracy = 0.1;
        seen.push(bot.driver.options.accuracy);
      },
    });
    expect(seen[599]).not.toBe(0.1);
    expect(new Set(seen.slice(600))).toEqual(new Set([0.1]));
  });
});

describe('the levels in order', () => {
  // Alternate who starts so the first attacker's edge cancels.
  function winRate(stronger: BotDifficulty, weaker: BotDifficulty, n: number): { rate: number; act: number } {
    let wins = 0;
    const acts: number[] = [];
    for (let i = 0; i < n; i++) {
      const swap = i % 2 === 1;
      const r = playBotDuel({
        host: { difficulty: swap ? weaker : stronger, seed: 200 + 2 * i },
        bot: { difficulty: swap ? stronger : weaker, seed: 201 + 2 * i },
      });
      if ((r.winner === 0) === !swap) wins++;
      acts.push(...r.actSeconds);
    }
    return { rate: wins / n, act: acts.reduce((a, b) => a + b, 0) / acts.length };
  }

  it('Expert beats Hard beats Medium beats Easy, clearly', () => {
    const pairs: [BotDifficulty, BotDifficulty][] = [
      ['expert', 'hard'],
      ['hard', 'medium'],
      ['medium', 'easy'],
      ['expert', 'easy'],
    ];
    for (const [a, b] of pairs) {
      const { rate, act } = winRate(a, b, 60);
      expect(rate, `${a} against ${b}`).toBeGreaterThan(0.75);
      expect(act).toBeGreaterThan(5);
      expect(act).toBeLessThan(90 + 5);
    }
  });
});
