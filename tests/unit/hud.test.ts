import { describe, expect, it } from 'vitest';
import type { DuelView } from '../../src/core/types';
import { bannerText, underBanner } from '../../src/ui/hud';

function view(partial: Partial<DuelView>): DuelView {
  const player = { health: 100, stamina: 100, winded: false, streak: 0 };
  return {
    phase: 'attack',
    localPlayer: 0,
    localActive: true,
    attacker: 0,
    act: 0,
    actWins: [0, 0],
    players: [player, player],
    clockPhrase: 1,
    slotPosition: 0,
    beatPosition: 0,
    strikes: [],
    targets: [],
    countInBeatsLeft: 0,
    lastActWinner: null,
    matchWinner: null,
    ...partial,
  };
}

describe('bannerText', () => {
  const names: [string, string] = ['Ada', 'Bo'];
  it('says what the local player does in each phase', () => {
    expect(bannerText(view({ phase: 'attack', localActive: true }), names)).toBe('ATTACK!');
    expect(bannerText(view({ phase: 'attack', localActive: false }), names)).toBe('WATCH');
    expect(bannerText(view({ phase: 'defend', localActive: true }), names)).toBe('PARRY!');
    expect(bannerText(view({ phase: 'defend', localActive: false }), names)).toBe('WATCH');
    expect(bannerText(view({ phase: 'countIn', countInBeatsLeft: 3 }), names)).toBe('3');
    expect(bannerText(view({ phase: 'intermission', lastActWinner: 1 }), names)).toBe('Bo takes the act');
    expect(bannerText(view({ phase: 'matchOver' }), names)).toBe('');
  });
});

describe('underBanner', () => {
  it('is true for a mark near the banner strip and false elsewhere', () => {
    expect(underBanner(640, 200, 190)).toBe(true);
    expect(underBanner(640 + 190 + 40, 230, 190)).toBe(true);
    expect(underBanner(640 + 190 + 60, 230, 190)).toBe(false);
    expect(underBanner(640, 400, 190)).toBe(false);
    expect(underBanner(300, 200, 190)).toBe(false);
  });
});
