import { describe, expect, it } from 'vitest';
import {
  accuracyFor,
  DEFAULT_BOT_SETUP,
  defaultBotPreset,
  parseBotSetup,
  resolveBotPuppet,
  type BotSetup,
} from '../../src/scenes/botSetupModel';

const IDS = ['preset-teal', 'preset-pink', 'preset-yellow', 'preset-blue'];
const setup = (botPuppet: string): BotSetup => ({ version: 1, difficulty: 'medium', botPuppet });

describe('parseBotSetup', () => {
  it('keeps a good record, every level included', () => {
    const good: BotSetup = { version: 1, difficulty: 'hard', botPuppet: 'preset-blue' };
    expect(parseBotSetup(good, IDS)).toEqual(good);
    for (const difficulty of ['easy', 'medium', 'hard', 'expert'] as const) {
      expect(parseBotSetup({ ...good, difficulty }, IDS).difficulty).toBe(difficulty);
    }
    expect(parseBotSetup({ ...good, botPuppet: 'surprise' }, IDS).botPuppet).toBe('surprise');
  });

  it('replaces junk with the defaults', () => {
    for (const junk of [null, undefined, 7, 'hard', [], [1, 2], true]) {
      expect(parseBotSetup(junk, IDS)).toEqual(DEFAULT_BOT_SETUP);
    }
  });

  it('replaces bad values one by one', () => {
    expect(parseBotSetup({ difficulty: 'impossible', botPuppet: 'preset-blue' }, IDS)).toEqual({
      version: 1,
      difficulty: 'medium',
      botPuppet: 'preset-blue',
    });
    // Unknown levels (a later version's, or junk) fall back to Medium; old records keep working.
    for (const junk of ['Expert', 'nightmare', '', 4, null, ['expert']]) {
      expect(parseBotSetup({ difficulty: junk, botPuppet: 'preset-blue' }, IDS).difficulty).toBe('medium');
    }
    expect(parseBotSetup({ difficulty: 'easy', botPuppet: 42 }, IDS)).toEqual({
      version: 1,
      difficulty: 'easy',
      botPuppet: DEFAULT_BOT_SETUP.botPuppet,
    });
  });

  it('treats a preset that no longer exists as the default', () => {
    expect(parseBotSetup({ difficulty: 'hard', botPuppet: 'preset-gone' }, IDS).botPuppet).toBe(
      DEFAULT_BOT_SETUP.botPuppet,
    );
  });

  it('fills in missing fields', () => {
    expect(parseBotSetup({}, IDS)).toEqual(DEFAULT_BOT_SETUP);
    expect(parseBotSetup({ difficulty: 'hard' }, IDS)).toEqual({ ...DEFAULT_BOT_SETUP, difficulty: 'hard' });
  });

  it('drops fields it does not know (a record from a later version)', () => {
    const parsed = parseBotSetup(
      { version: 2, difficulty: 'easy', botPuppet: 'preset-teal', mood: 'grumpy' },
      IDS,
    );
    expect(parsed).toEqual({ version: 1, difficulty: 'easy', botPuppet: 'preset-teal' });
    expect('mood' in parsed).toBe(false);
  });
});

describe('accuracyFor', () => {
  it('has Medium at the bot default and the steps clearly apart', () => {
    expect(accuracyFor('medium')).toBe(0.75);
    expect(accuracyFor('easy')).toBeLessThan(accuracyFor('medium') - 0.15);
    expect(accuracyFor('hard')).toBeGreaterThan(accuracyFor('medium') + 0.1);
    expect(accuracyFor('hard')).toBeLessThanOrEqual(1);
    expect(accuracyFor('expert')).toBeGreaterThan(accuracyFor('hard'));
    expect(accuracyFor('expert')).toBeLessThanOrEqual(1);
  });
});

describe('resolveBotPuppet', () => {
  const never = (): number => {
    throw new Error('random must not be used');
  };

  it('uses an explicit preset as chosen, without randomness', () => {
    expect(resolveBotPuppet(setup('preset-yellow'), IDS, null, never)).toBe('preset-yellow');
    expect(resolveBotPuppet(setup('preset-pink'), IDS, 'preset-pink', never)).toBe('preset-pink');
  });

  it('picks from the presets with the random source for Surprise me', () => {
    expect(resolveBotPuppet(setup('surprise'), IDS, null, () => 0)).toBe('preset-teal');
    expect(resolveBotPuppet(setup('surprise'), IDS, null, () => 0.3)).toBe('preset-pink');
    expect(resolveBotPuppet(setup('surprise'), IDS, null, () => 0.99)).toBe('preset-blue');
  });

  it('stays in range for odd random values', () => {
    expect(resolveBotPuppet(setup('surprise'), IDS, null, () => 1)).toBe('preset-blue');
    expect(resolveBotPuppet(setup('surprise'), IDS, null, () => -1)).toBe('preset-teal');
  });

  it('by default is pink, or teal when the player is pink', () => {
    expect(resolveBotPuppet(DEFAULT_BOT_SETUP, IDS, null, never)).toBe('preset-pink');
    expect(resolveBotPuppet(DEFAULT_BOT_SETUP, IDS, 'preset-teal', never)).toBe('preset-pink');
    expect(resolveBotPuppet(DEFAULT_BOT_SETUP, IDS, 'preset-pink', never)).toBe('preset-teal');
    expect(defaultBotPreset(IDS, 'preset-pink')).toBe('preset-teal');
  });

  it('falls back to the default for an unknown preset', () => {
    expect(resolveBotPuppet(setup('preset-gone'), IDS, null, never)).toBe('preset-pink');
  });
});
