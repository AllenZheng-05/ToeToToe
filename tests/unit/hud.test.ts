import { describe, expect, it } from 'vitest';
import type { DuelView } from '../../src/core/types';
import { DEFAULT_TUNABLES } from '../../src/core/tunables';
import {
  bannerText,
  nextUpNote,
  phraseCaption,
  turnLine,
  turnRoles,
  turnTagText,
  underBanner,
} from '../../src/ui/hud';

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

describe('whose turn', () => {
  const names: [string, string] = ['Ada', 'Bo'];
  const t = DEFAULT_TUNABLES;
  const lastBeat = t.beatsPerPhrase * t.slotsPerBeat - t.slotsPerBeat;

  it('gives the acting player the role and the other "watching"', () => {
    expect(turnRoles(view({ phase: 'attack', attacker: 0 }))).toEqual(['attacking', 'watching']);
    expect(turnRoles(view({ phase: 'attack', attacker: 1 }))).toEqual(['watching', 'attacking']);
    expect(turnRoles(view({ phase: 'defend', attacker: 0 }))).toEqual(['watching', 'parrying']);
    expect(turnRoles(view({ phase: 'defend', attacker: 1 }))).toEqual(['parrying', 'watching']);
  });

  it('has both waiting before a round and nobody after the match', () => {
    expect(turnRoles(view({ phase: 'countIn' }))).toEqual(['waiting', 'waiting']);
    expect(turnRoles(view({ phase: 'intermission' }))).toEqual(['waiting', 'waiting']);
    expect(turnRoles(view({ phase: 'matchOver' }))).toBeNull();
  });

  it('words the plate tags', () => {
    const v = view({ phase: 'attack', attacker: 0 });
    expect(turnTagText(v, 0, 'attacking')).toBe('Attacking');
    expect(turnTagText(v, 1, 'watching')).toBe('Watching');
    expect(turnTagText(view({ phase: 'defend' }), 1, 'parrying')).toBe('Parrying');
    const wait = view({ phase: 'countIn', attacker: 1 });
    expect(turnTagText(wait, 1, 'waiting')).toBe('Attacks first');
    expect(turnTagText(wait, 0, 'waiting')).toBe('Parries second');
  });

  it('says who attacks first before a round', () => {
    expect(turnLine(view({ phase: 'countIn', attacker: 0, localPlayer: 0 }), names)).toBe('You attack first');
    expect(turnLine(view({ phase: 'countIn', attacker: 1, localPlayer: 0 }), names)).toBe('Bo attacks first');
    expect(turnLine(view({ phase: 'intermission', attacker: 0, localPlayer: 1 }), names)).toBe(
      'Ada attacks first',
    );
    expect(turnLine(view({ phase: 'attack' }), names)).toBe('');
    expect(turnLine(view({ phase: 'defend' }), names)).toBe('');
  });

  it('captions the phrase from the local side', () => {
    expect(phraseCaption(view({ phase: 'attack', attacker: 0, localPlayer: 0 }), names)).toBe('YOUR ATTACK');
    expect(phraseCaption(view({ phase: 'attack', attacker: 1, localPlayer: 0 }), names)).toBe(
      "BO'S ATTACK: WATCH",
    );
    expect(phraseCaption(view({ phase: 'defend', attacker: 1, localPlayer: 0 }), names)).toBe('YOUR PARRY');
    expect(phraseCaption(view({ phase: 'defend', attacker: 0, localPlayer: 0 }), names)).toBe('BO PARRIES');
    expect(phraseCaption(view({ phase: 'countIn' }), names)).toBe('');
  });

  it('announces what is next only in the last beat of a phrase', () => {
    const at = (partial: Partial<DuelView>): string =>
      nextUpNote(view({ slotPosition: lastBeat, ...partial }), names, t);
    expect(at({ phase: 'attack', attacker: 0, localPlayer: 0 })).toBe('Bo parries next');
    expect(at({ phase: 'attack', attacker: 1, localPlayer: 0 })).toBe('Get ready to parry');
    expect(at({ phase: 'defend', attacker: 1, localPlayer: 0 })).toBe('Your attack next');
    expect(at({ phase: 'defend', attacker: 0, localPlayer: 0 })).toBe('Bo attacks next');
    expect(nextUpNote(view({ phase: 'attack', slotPosition: lastBeat - 0.5 }), names, t)).toBe('');
    expect(at({ phase: 'countIn' })).toBe('');
  });
});
