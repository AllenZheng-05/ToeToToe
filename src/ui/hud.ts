import { slotsPerPhrase } from '../core/beat';
import type { DuelView, Grade, PlayerId, Tunables } from '../core/types';
import { rgbCss, type Rgb } from '../puppet/colour';
import { playToDesign } from '../stage/layout';
import {
  actCounter,
  gradePop,
  labelStrip,
  letterTiles,
  phraseDots,
  playerPlate,
  tapeNote,
  tornNote,
  type PlateRole,
  type PlayerPlateHandle,
} from './kit/kit';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent?: HTMLElement,
  testId?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (testId) node.dataset.testid = testId;
  parent?.appendChild(node);
  return node;
}

/** Text for the big banner, or '' for none. Reads only the view. */
export function bannerText(view: DuelView, names: readonly [string, string]): string {
  switch (view.phase) {
    case 'countIn':
      return String(view.countInBeatsLeft);
    case 'attack':
      return view.localActive ? 'ATTACK!' : 'WATCH';
    case 'defend':
      return view.localActive ? 'PARRY!' : 'WATCH';
    case 'intermission':
      return view.lastActWinner === null ? '' : `${names[view.lastActWinner]} takes the act`;
    default:
      return '';
  }
}

export type TurnRole = PlateRole;

const ROLE_TEXT: Record<TurnRole, string> = {
  attacking: 'Attacking',
  parrying: 'Parrying',
  watching: 'Watching',
  waiting: 'Up next',
};

/**
 * What each player is doing now, index = PlayerId: the acting one attacks or parries, the other watches;
 * before a round (count-in, intermission) both are waiting; null once the match is over.
 */
export function turnRoles(view: DuelView): [TurnRole, TurnRole] | null {
  const make = (attackerRole: TurnRole, otherRole: TurnRole): [TurnRole, TurnRole] =>
    view.attacker === 0 ? [attackerRole, otherRole] : [otherRole, attackerRole];
  switch (view.phase) {
    case 'attack':
      return make('attacking', 'watching');
    case 'defend':
      return make('watching', 'parrying');
    case 'countIn':
    case 'intermission':
      return ['waiting', 'waiting'];
    default:
      return null;
  }
}

/** The plate tag text for a role. Before a round the one who attacks first says so. */
export function turnTagText(view: DuelView, id: PlayerId, role: TurnRole): string {
  if (role === 'waiting') return view.attacker === id ? 'Attacks first' : 'Parries second';
  return ROLE_TEXT[role];
}

/** The line under the count-in number or the intermission banner: who attacks first. '' at other times. */
export function turnLine(view: DuelView, names: readonly [string, string]): string {
  if (view.phase !== 'countIn' && view.phase !== 'intermission') return '';
  return view.attacker === view.localPlayer ? 'You attack first' : `${names[view.attacker]} attacks first`;
}

/** The phrase-dots caption: what is happening now, for the local player. '' outside the two phrases. */
export function phraseCaption(view: DuelView, names: readonly [string, string]): string {
  const mine = view.attacker === view.localPlayer;
  const defender: PlayerId = view.attacker === 0 ? 1 : 0;
  if (view.phase === 'attack')
    return (mine ? 'Your attack' : `${names[view.attacker]}'s attack: watch`).toUpperCase();
  if (view.phase === 'defend') return (mine ? `${names[defender]} parries` : 'Your parry').toUpperCase();
  return '';
}

/** What comes next for the local player, shown in the last beat of a phrase. '' at other times. */
export function nextUpNote(view: DuelView, names: readonly [string, string], tunables: Tunables): string {
  if (view.phase !== 'attack' && view.phase !== 'defend') return '';
  if (view.slotPosition < slotsPerPhrase(tunables) - tunables.slotsPerBeat) return '';
  const local = view.localPlayer;
  const opp: PlayerId = local === 0 ? 1 : 0;
  if (view.phase === 'attack')
    return view.attacker === local ? `${names[opp]} parries next` : 'Get ready to parry';
  // After a defend phrase the roles swap: the parrier plants next.
  return view.attacker === local ? `${names[opp]} attacks next` : 'Your attack next';
}

/** Where in the tile cycle a banner starts, so ATTACK! and PARRY! look as they do in the mocks. */
function bannerSeed(text: string): number {
  if (text === 'ATTACK!') return 0;
  if (text === 'PARRY!') return 2;
  if (text === 'WATCH') return 4;
  return /^\d+$/.test(text) ? Number(text) : 0;
}

/** Widest a banner may be, design px. Long names shrink the tiles to fit. */
const BANNER_MAX_WIDTH = 980;
const BANNER_TILE = 44;
const BANNER_TILE_GAP = 5;

/** Heckles from the audience, by what just happened. Mild on purpose. */
const HECKLES = {
  act: [
    'that act was mostly socks.',
    'are we there yet?',
    'my dad could do that. my dad is a dog.',
    'intermission snacks, anyone?',
  ],
  streak: ['show-off.', 'is that even allowed?', 'they have done this before.'],
  misses: [
    'that one is just a sock.',
    'the pointy end goes in the other person!',
    'have you tried clicking?',
  ],
} as const;
export type HeckleKind = keyof typeof HECKLES;

/** Misses in a row that earn a heckle, and the streak that earns one. */
const MISSES_FOR_HECKLE = 3;
const STREAK_FOR_NOTE = 3;
const STREAK_FOR_HECKLE = 5;

/** How far above a target its grade pop-up floats (below it when that would hide behind the banner), design px. */
const POP_LIFT = 78;
const POP_MIN_Y = 200;

/** The banner strip: where the act counter and banner sit, and how far a mark must be from it to stay clear. */
const BANNER_TOP = 146;
const BANNER_BOTTOM = 238;
const BANNER_MARGIN = 46;
const COUNTER_HALF_WIDTH = 190;

/** True when a mark at (x, y) design px (a disc and its ring) would sit under a banner of the given half width. Pure. */
export function underBanner(x: number, y: number, halfWidth: number): boolean {
  return (
    Math.abs(x - 640) <= halfWidth + BANNER_MARGIN &&
    y >= BANNER_TOP - BANNER_MARGIN &&
    y <= BANNER_BOTTOM + BANNER_MARGIN
  );
}

interface Plate {
  handle: PlayerPlateHandle;
  health: string;
  stamina: string;
}

/** Heads-up display built from the UI kit inside the design-pixel overlay. Reads the view; holds no rules. */
export class Hud {
  readonly root: HTMLElement;
  private readonly plates: [Plate, Plate];
  private readonly banner: HTMLElement;
  private bannerKey = '';
  private actKey = '';
  private readonly act = actCounter();
  private readonly actWins: HTMLElement;
  private readonly dotsCaption: HTMLElement;
  private readonly dots = phraseDots();
  private actBox: HTMLElement;
  private bannerHalf = COUNTER_HALF_WIDTH;
  private dimmed = false;
  private heckle: HTMLElement | null = null;
  private streakNote: HTMLElement | null = null;
  private lastStreak = 0;
  private missRun = 0;
  private heckleCount: Record<HeckleKind, number> = { act: 0, streak: 0, misses: 0 };
  private you: PlayerId | null = null;
  private readonly turnNote: HTMLElement;
  private readonly nextNote: HTMLElement;
  private turnKey = '';

  constructor(
    parent: HTMLElement,
    private readonly tunables: Tunables,
    private readonly names: readonly [string, string],
  ) {
    this.root = el('div', 'hud', parent);

    this.plates = [this.makePlate(0), this.makePlate(1)];

    const actBox = el('div', 'hud-act-box', this.root);
    this.actBox = actBox;
    const actRow = el('div', 'hud-act-row', actBox);
    this.act.root.dataset.testid = 'act-counter';
    this.actWins = el('span', 'tt-tag hud-act-wins', undefined, 'act-wins');
    actRow.append(this.act.root, this.actWins);
    this.banner = el('div', 'hud-banner', actBox, 'banner');
    // Who attacks first, under the count-in number and the intermission banner.
    this.turnNote = tapeNote('', { rotate: -1 });
    this.turnNote.classList.add('hud-turn-line');
    this.turnNote.dataset.testid = 'turn-line';
    this.turnNote.hidden = true;
    actBox.appendChild(this.turnNote);

    const dotsBox = el('div', 'hud-dots', this.root);
    this.dotsCaption = labelStrip('');
    this.dotsCaption.classList.add('hud-dots-caption');
    this.nextNote = el('span', 'tt-tag hud-next-up', dotsBox, 'next-up');
    this.nextNote.style.visibility = 'hidden';
    dotsBox.append(this.dotsCaption, this.dots.root, this.nextNote);
  }

  /** Each player's mark colour (index = PlayerId): a swatch by the name and the tape edge of the lit plate. */
  setMarkColours(colours: readonly [Rgb, Rgb]): void {
    this.plates[0].handle.setMarkColour(rgbCss(colours[0]));
    this.plates[1].handle.setMarkColour(rgbCss(colours[1]));
  }

  update(view: DuelView): void {
    const local = view.localPlayer;
    for (const id of [0, 1] as const) {
      const p = view.players[id];
      const plate = this.plates[id];
      const health = Math.max(0, Math.round(p.health));
      const stamina = Math.max(0, Math.round(p.stamina));
      if (plate.health !== String(health)) {
        plate.health = String(health);
        plate.handle.health.set(health, this.tunables.startHealth);
      }
      if (plate.stamina !== String(stamina)) {
        plate.stamina = String(stamina);
        plate.handle.stamina.set(stamina, this.tunables.startStamina);
      }
      plate.handle.setWinded(p.winded);
    }
    if (this.you !== local) {
      this.you = local;
      this.plates[0].handle.setYou(local === 0);
      this.plates[1].handle.setYou(local === 1);
    }

    const total = this.tunables.actsToWin * 2 - 1;
    const actKey = `${view.act}|${total}|${view.actWins[0]}|${view.actWins[1]}`;
    if (actKey !== this.actKey) {
      this.actKey = actKey;
      this.act.set(view.act + 1, total, view.actWins);
      this.act.root.dataset.value = String(view.act + 1);
      this.actWins.textContent = `Won ${view.actWins[0]} - ${view.actWins[1]}`;
      this.actWins.dataset.value = `${view.actWins[0]}-${view.actWins[1]}`;
    }

    const text = bannerText(view, this.names);
    this.setBanner(text);
    this.banner.dataset.value = text;
    this.banner.dataset.phase = view.phase;

    this.updateTurn(view);
    this.updateDim(view);
    this.updateDots(view);
    this.updateStreak(view);
  }

  /** A grade pop-up above a target (play-area fractions). */
  popGrade(grade: Grade, x: number, y: number): void {
    const p = playToDesign(x, y);
    const slot = el('div', 'hud-grade-slot', this.root);
    slot.style.left = `${p.x}px`;
    slot.style.top = `${p.y - POP_LIFT < POP_MIN_Y ? p.y + POP_LIFT : p.y - POP_LIFT}px`;
    const pop = gradePop(grade);
    slot.appendChild(pop);
    // The kit's pop removes itself when its animation ends; take the slot with it.
    pop.addEventListener('animationend', () => slot.remove());
  }

  /** Counts the local player's parries for the "three misses in a row" heckle. */
  recordGrade(isLocalParry: boolean, grade: Grade): void {
    if (!isLocalParry) return;
    this.missRun = grade === 'miss' ? this.missRun + 1 : 0;
    if (grade === 'miss' && this.missRun === MISSES_FOR_HECKLE) this.aside('misses');
  }

  /** A brief note under the banner, e.g. "Not enough stamina". */
  note(text: string): void {
    const slot = el('div', 'hud-note-slot', this.root);
    const n = tapeNote(text, { rotate: -2 });
    n.dataset.testid = 'note';
    slot.appendChild(n);
    slot.addEventListener('animationend', () => slot.remove());
  }

  /** A typed heckle from the audience, if none is showing. Lines cycle so a match does not repeat itself soon. */
  aside(kind: HeckleKind): void {
    if (this.heckle?.isConnected) return;
    const lines = HECKLES[kind];
    const line = lines[this.heckleCount[kind]++ % lines.length] as string;
    const note = tornNote(`"${line}"`, { rotate: -3, width: 176 });
    note.dataset.testid = 'heckle';
    const slot = el('div', 'hud-heckle-slot', this.root);
    slot.appendChild(note);
    slot.addEventListener('animationend', () => slot.remove());
    this.heckle = slot;
  }

  playerName(id: PlayerId): string {
    return this.names[id];
  }

  destroy(): void {
    this.root.remove();
  }

  private makePlate(id: PlayerId): Plate {
    const handle = playerPlate({ align: id === 0 ? 'left' : 'right', testIdSuffix: String(id) });
    handle.setName(this.names[id]);
    handle.root.classList.add('hud-plate', id === 0 ? 'hud-plate-left' : 'hud-plate-right');
    this.root.appendChild(handle.root);
    return { handle, health: '', stamina: '' };
  }

  private setBanner(text: string): void {
    if (text === this.bannerKey) return;
    this.bannerKey = text;
    this.banner.replaceChildren();
    this.bannerHalf = COUNTER_HALF_WIDTH;
    if (text === '') return;
    const letters = Array.from(text).filter((c) => c !== ' ').length;
    const fit = Math.floor(BANNER_MAX_WIDTH / Math.max(1, letters)) - BANNER_TILE_GAP;
    const size = Math.min(BANNER_TILE, fit);
    const tiles = letterTiles(text, { size, seed: bannerSeed(text) });
    this.bannerHalf = Math.max(COUNTER_HALF_WIDTH, (letters * (size + BANNER_TILE_GAP)) / 2);
    this.banner.appendChild(tiles);
  }

  /** Fades the act counter and banner while a strike or target sits under them, so nothing to parry is hidden. */
  private updateDim(view: DuelView): void {
    let hit = false;
    const marks =
      view.phase === 'attack'
        ? view.strikes
        : view.phase === 'defend'
          ? view.targets.filter((t) => t.result === null).map((t) => t.strike)
          : [];
    for (const m of marks) {
      const p = playToDesign(m.x, m.y);
      if (underBanner(p.x, p.y, this.bannerHalf)) {
        hit = true;
        break;
      }
    }
    if (hit !== this.dimmed) {
      this.dimmed = hit;
      this.actBox.classList.toggle('dim', hit);
    }
  }

  /** Role tags on the plates and the "who attacks first" line. Reads only the view. */
  private updateTurn(view: DuelView): void {
    const roles = turnRoles(view);
    const line = turnLine(view, this.names);
    const key = `${roles?.join(',') ?? ''}|${view.attacker}|${line}`;
    if (key === this.turnKey) return;
    this.turnKey = key;
    for (const id of [0, 1] as const) {
      const role = roles?.[id] ?? null;
      this.plates[id].handle.setTurn(role, role === null ? '' : turnTagText(view, id, role));
    }
    this.turnNote.hidden = line === '';
    this.setText(this.turnNote, line);
    this.turnNote.dataset.value = line;
  }

  private updateDots(view: DuelView): void {
    const slots = slotsPerPhrase(this.tunables);
    const attacking = view.phase === 'attack';
    const defending = view.phase === 'defend';
    const filled = new Array<boolean>(slots).fill(false);
    if (attacking) for (const s of view.strikes) if (s.slot >= 0 && s.slot < slots) filled[s.slot] = true;
    if (defending)
      for (const t of view.targets)
        if (t.strike.slot >= 0 && t.strike.slot < slots) filled[t.strike.slot] = true;
    const live = attacking || defending;
    const current = live ? Math.min(slots - 1, Math.max(0, Math.floor(view.slotPosition))) : -1;
    this.dots.set({ slots, current, filled, tone: attacking ? 'attack' : defending ? 'defend' : 'idle' });

    this.setText(this.dotsCaption, phraseCaption(view, this.names));
    this.dotsCaption.style.visibility = live ? 'visible' : 'hidden';
    const next = nextUpNote(view, this.names, this.tunables);
    this.setText(this.nextNote, next);
    this.nextNote.style.visibility = next === '' ? 'hidden' : 'visible';
  }

  private updateStreak(view: DuelView): void {
    const streak = view.players[view.localPlayer].streak;
    if (streak > this.lastStreak && streak >= STREAK_FOR_NOTE) {
      this.showStreak(streak);
      if (streak === STREAK_FOR_HECKLE) this.aside('streak');
    }
    this.lastStreak = streak;
  }

  private showStreak(streak: number): void {
    this.streakNote?.remove();
    const slot = el('div', 'hud-streak-slot', this.root);
    const n = tapeNote('', { rotate: 4 });
    n.classList.add('hud-streak');
    n.dataset.testid = 'streak-note';
    const num = el('span', 'hud-streak-num', n);
    num.textContent = String(streak);
    n.append(document.createElement('br'), 'in a row!');
    slot.appendChild(n);
    slot.addEventListener('animationend', () => slot.remove());
    this.streakNote = slot;
  }

  private setText(node: HTMLElement, text: string): void {
    if (node.textContent !== text) node.textContent = text;
  }
}
