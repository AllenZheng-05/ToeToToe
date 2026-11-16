import { slotsPerPhrase } from '../core/beat';
import type { DuelView, Grade, PlayerId, Tunables } from '../core/types';
import { playToDesign } from '../stage/layout';

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

interface Bar {
  fill: HTMLElement;
  text: HTMLElement;
  root: HTMLElement;
}

interface PlayerPanel {
  root: HTMLElement;
  name: HTMLElement;
  health: Bar;
  stamina: Bar;
  winded: HTMLElement;
}

const GRADE_TEXT: Record<Grade, string> = { bravo: 'Bravo!', good: 'Good', miss: 'Miss' };

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

/** Heads-up display built from DOM elements inside the design-pixel overlay. Reads the view; holds no rules. */
export class Hud {
  readonly root: HTMLElement;
  private readonly panels: [PlayerPanel, PlayerPanel];
  private readonly banner: HTMLElement;
  private readonly actCounter: HTMLElement;
  private readonly actWins: HTMLElement;
  private readonly dotsBox: HTMLElement;
  private dots: HTMLElement[] = [];
  private lit = -1;
  private readonly lastValues = new Map<string, string>();

  constructor(
    parent: HTMLElement,
    private readonly tunables: Tunables,
    private readonly names: readonly [string, string],
  ) {
    this.root = el('div', 'hud', parent);
    this.panels = [this.makePanel(0), this.makePanel(1)];
    this.banner = el('div', 'banner', this.root, 'banner');
    const act = el('div', 'act-box', this.root);
    this.actCounter = el('div', 'act-counter', act, 'act-counter');
    this.actWins = el('div', 'act-wins', act, 'act-wins');
    this.dotsBox = el('div', 'phrase-dots', this.root);
    this.buildDots();
  }

  update(view: DuelView): void {
    for (const id of [0, 1] as const) {
      const p = view.players[id];
      const panel = this.panels[id];
      this.setBar(panel.health, p.health, this.tunables.startHealth);
      this.setBar(panel.stamina, p.stamina, this.tunables.startStamina);
      panel.winded.hidden = !p.winded;
      panel.root.classList.toggle('local', id === view.localPlayer);
    }

    const total = this.tunables.actsToWin * 2 - 1;
    this.setText(this.actCounter, `Act ${view.act + 1} of ${total}`);
    this.actCounter.dataset.value = String(view.act + 1);
    this.setText(this.actWins, `${view.actWins[0]} - ${view.actWins[1]}`);
    this.actWins.dataset.value = `${view.actWins[0]}-${view.actWins[1]}`;

    const text = bannerText(view, this.names);
    this.setText(this.banner, text);
    this.banner.dataset.value = text;
    this.banner.dataset.phase = view.phase;
    this.banner.classList.toggle('attack', text === 'ATTACK!');
    this.banner.classList.toggle('parry', text === 'PARRY!');
    this.banner.classList.toggle('watch', text === 'WATCH');

    if (this.dots.length !== slotsPerPhrase(this.tunables)) this.buildDots();
    const lit =
      view.phase === 'matchOver' ? -1 : Math.min(this.dots.length - 1, Math.floor(view.slotPosition));
    if (lit !== this.lit) {
      this.dots[this.lit]?.classList.remove('lit');
      this.dots[lit]?.classList.add('lit');
      this.lit = lit;
    }
  }

  /** A short grade pop-up at a play-area position (fractions). */
  popGrade(grade: Grade, x: number, y: number): void {
    const p = playToDesign(x, y);
    const pop = el('div', `grade-pop ${grade}`, this.root);
    pop.textContent = GRADE_TEXT[grade];
    pop.style.left = `${p.x}px`;
    pop.style.top = `${p.y}px`;
    pop.addEventListener('animationend', () => pop.remove());
  }

  /** A brief note near the top of the play area, e.g. "Not enough stamina". */
  note(text: string): void {
    const n = el('div', 'hud-note', this.root, 'note');
    n.textContent = text;
    n.addEventListener('animationend', () => n.remove());
  }

  playerName(id: PlayerId): string {
    return this.names[id];
  }

  destroy(): void {
    this.root.remove();
  }

  private makePanel(id: PlayerId): PlayerPanel {
    const root = el('div', `player-panel p${id}`, this.root, `panel-${id}`);
    const name = el('div', 'player-name', root, `name-${id}`);
    name.textContent = this.names[id];
    const winded = el('div', 'winded-tag', root, `winded-${id}`);
    winded.textContent = 'Winded';
    winded.hidden = true;
    return {
      root,
      name,
      winded,
      health: this.makeBar(root, 'health', 'Health', id),
      stamina: this.makeBar(root, 'stamina', 'Stamina', id),
    };
  }

  private makeBar(parent: HTMLElement, kind: 'health' | 'stamina', label: string, id: PlayerId): Bar {
    const root = el('div', `bar ${kind}`, parent, `${kind}-${id}`);
    const fill = el('div', 'bar-fill', root);
    const text = el('div', 'bar-text', root);
    text.textContent = label;
    root.setAttribute('role', 'progressbar');
    root.setAttribute('aria-label', label);
    return { root, fill, text };
  }

  private setBar(bar: Bar, value: number, max: number): void {
    const shown = Math.max(0, Math.round(value));
    const key = `${bar.root.dataset.testid}`;
    const next = String(shown);
    if (this.lastValues.get(key) === next) return;
    this.lastValues.set(key, next);
    bar.root.dataset.value = next;
    bar.fill.style.width = `${max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0}%`;
    bar.text.textContent = `${bar.root.getAttribute('aria-label')} ${shown}`;
    bar.root.setAttribute('aria-valuenow', next);
  }

  private setText(node: HTMLElement, text: string): void {
    if (node.textContent !== text) node.textContent = text;
  }

  private buildDots(): void {
    this.dotsBox.replaceChildren();
    this.dots = [];
    this.lit = -1;
    for (let i = 0; i < slotsPerPhrase(this.tunables); i++) {
      const dot = el('div', i % this.tunables.slotsPerBeat === 0 ? 'dot beat' : 'dot', this.dotsBox);
      dot.dataset.testid = `dot-${i}`;
      this.dots.push(dot);
    }
  }
}
