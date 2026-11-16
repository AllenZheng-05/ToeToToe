import './kit.css';

export type TilePalette = 'title' | 'banner' | 'win';
export interface TileOptions {
  size?: number;
  seed?: number;
  palette?: TilePalette;
}
export interface TileStyle {
  char: string;
  rotate: number;
  bg: string;
  fg: string;
  font: string;
  dy: number;
}

const BUNGEE = 'Bungee, Impact, sans-serif';
const ELITE = "'Special Elite', 'Courier New', monospace";
const MARKER = "'Permanent Marker', 'Comic Sans MS', cursive";

interface TileKind {
  bg: string;
  fg: string;
  font: string;
  rotate: number;
}

/** The eight-style cycle from DESIGN_SPEC 3.1. */
const CYCLE: TileKind[] = [
  { bg: '#FFE14D', fg: '#1B1210', font: BUNGEE, rotate: -4 },
  { bg: '#1B1210', fg: '#FFFDF5', font: ELITE, rotate: 3 },
  { bg: '#D42A40', fg: '#FFFFFF', font: BUNGEE, rotate: -2 },
  { bg: '#FFFDF5', fg: '#1B1210', font: MARKER, rotate: 5 },
  { bg: '#2456C8', fg: '#FFFFFF', font: ELITE, rotate: -6 },
  { bg: '#F48FB1', fg: '#1B1210', font: BUNGEE, rotate: 3 },
  { bg: '#FFFDF5', fg: '#1B1210', font: ELITE, rotate: -3 },
  { bg: '#1B1210', fg: '#FFE14D', font: BUNGEE, rotate: 4 },
];

/** Where each palette starts in the cycle (the mocks: ATTACK! at 0, the win line at 5). */
const PALETTE_START: Record<TilePalette, number> = { title: 0, banner: 0, win: 5 };

/** Small seeded generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One entry per non-space character. Seed 0 reproduces the mocks' cycle; other seeds shift the start. */
export function tileStyles(text: string, seed: number, palette: TilePalette): TileStyle[] {
  const rand = rng(seed * 7919 + 13);
  const out: TileStyle[] = [];
  let n = 0;
  for (const char of text) {
    const dy = Math.round((rand() - 0.5) * 4); // drawn for every character, spaces included
    if (char === ' ') continue;
    const kind = CYCLE[(PALETTE_START[palette] + Math.floor(Math.abs(seed)) + n) % CYCLE.length] as TileKind;
    out.push({ char, rotate: kind.rotate, bg: kind.bg, fg: kind.fg, font: kind.font, dy });
    n++;
  }
  return out;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function setRotate(node: HTMLElement, deg: number | undefined): void {
  if (deg !== undefined) node.style.setProperty('--rot', `${deg}deg`);
}

const PUNCT = /[^\p{L}\p{N}]/u;

interface TileMetrics {
  w: number;
  hBungee: number;
  hOther: number;
  fBungee: number;
  fElite: number;
  punctW: number;
  gap: number;
  wordGap: number;
}
/** DESIGN_SPEC 3.1 sizes per lettering. */
const METRICS: Record<TilePalette, TileMetrics> = {
  title: { w: 62, hBungee: 86, hOther: 80, fBungee: 58, fElite: 66, punctW: 44, gap: 6, wordGap: 0 },
  banner: { w: 44, hBungee: 54, hOther: 50, fBungee: 38, fElite: 43, punctW: 31, gap: 5, wordGap: 14 },
  win: { w: 46, hBungee: 66, hOther: 62, fBungee: 42, fElite: 47, punctW: 33, gap: 5, wordGap: 18 },
};

export function letterTiles(text: string, o: TileOptions = {}): HTMLElement {
  const palette = o.palette ?? 'banner';
  const m = METRICS[palette];
  const k = (o.size ?? m.w) / m.w;
  const px = (n: number): string => `${Math.round(n * k)}px`;
  const seed = o.seed ?? 0;
  const root = el('div', `tt-tiles tt-tiles-${palette}`, undefined, { role: 'img', 'aria-label': text });
  root.style.gap = px(m.gap);
  const styles = tileStyles(text, seed, palette);
  const chars = Array.from(text);
  let i = 0;
  let wordStart = false;
  chars.forEach((ch, idx) => {
    if (ch === ' ') {
      wordStart = true;
      // A real space between words for text extraction; whitespace inside a flex row is not laid out.
      root.appendChild(document.createTextNode(' '));
      return;
    }
    const st = styles[i++] as TileStyle;
    const tile = el('span', 'tt-tile', ch, { 'aria-hidden': 'true' });
    const bungee = st.font === BUNGEE;
    // In the title the lower-case word ("to") uses small tiles with extra space around the word.
    const small = palette === 'title' && ch !== ch.toUpperCase();
    let w = PUNCT.test(ch) ? m.punctW : m.w;
    let h = bungee ? m.hBungee : m.hOther;
    let f = st.font === ELITE ? m.fElite : m.fBungee;
    if (small) {
      w = 46;
      f = 46;
      h = ch === 'o' ? 58 : 62;
    }
    tile.style.width = px(w);
    tile.style.height = px(h);
    tile.style.fontSize = px(f);
    tile.style.fontFamily = st.font;
    tile.style.background = st.bg;
    tile.style.color = st.fg;
    tile.style.transform = `translateY(${st.dy}px) rotate(${st.rotate}deg)`;
    const next = chars[idx + 1];
    if (small && wordStart) tile.style.marginLeft = px(14);
    else if (wordStart && i > 1 && m.wordGap) tile.style.marginLeft = px(m.wordGap);
    if (small && (next === undefined || next === ' ')) tile.style.marginRight = px(14);
    wordStart = false;
    root.appendChild(tile);
  });
  return root;
}

/** Black strip, white type. */
export function labelStrip(
  text: string,
  o: { tone?: 'ink' | 'red' | 'blue'; rotate?: number } = {},
): HTMLElement {
  const n = el('span', `tt-strip tt-strip-${o.tone ?? 'ink'}`, text);
  setRotate(n, o.rotate);
  return n;
}

/** Marker on masking tape. */
export function tapeNote(text: string, o: { rotate?: number } = {}): HTMLElement {
  const n = el('div', 'tt-tape', text);
  setRotate(n, o.rotate ?? -2);
  return n;
}

/** Typed note on torn paper. */
export function tornNote(text: string, o: { rotate?: number; width?: number } = {}): HTMLElement {
  const n = el('div', 'tt-torn', text);
  setRotate(n, o.rotate ?? -3);
  if (o.width !== undefined) n.style.width = `${o.width}px`;
  return n;
}

/** `pink` is an addition to the brief's list: the mocks use pink for "Join a room", "Leave" and "Tap along". */
export type ButtonVariant = 'primary' | 'secondary' | 'small' | 'danger' | 'pink';

export function button(
  label: string,
  o: { variant?: ButtonVariant; testId?: string; disabled?: boolean; onClick?: () => void } = {},
): HTMLButtonElement {
  const b = el('button', `tt-btn tt-btn-${o.variant ?? 'primary'}`, label, { type: 'button' });
  if (o.testId) b.dataset.testid = o.testId;
  b.disabled = o.disabled ?? false;
  if (o.onClick) b.addEventListener('click', o.onClick);
  return b;
}

export function textInput(o: {
  label: string;
  value?: string;
  placeholder?: string;
  maxLength?: number;
  testId?: string;
  onInput?: (v: string) => void;
}): { root: HTMLElement; input: HTMLInputElement } {
  const root = el('label', 'tt-field');
  const cap = labelStrip(o.label);
  cap.classList.add('tt-field-label');
  const input = el('input', 'tt-input', undefined, {
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  input.value = o.value ?? '';
  if (o.placeholder) input.placeholder = o.placeholder;
  if (o.maxLength !== undefined) input.maxLength = o.maxLength;
  if (o.testId) input.dataset.testid = o.testId;
  if (o.onInput) input.addEventListener('input', () => o.onInput?.(input.value));
  root.append(cap, input);
  return { root, input };
}

export interface BarHandle {
  root: HTMLElement;
  set(value: number, max: number): void;
}

export function bar(
  kind: 'health' | 'stamina',
  o: { align?: 'left' | 'right'; testId?: string } = {},
): BarHandle {
  const name = kind === 'health' ? 'Health' : 'Stamina';
  const root = el('div', `tt-bar tt-bar-${kind}`, undefined, { 'data-align': o.align ?? 'left' });
  if (o.testId) root.dataset.testid = o.testId;
  const label = el('span', 'tt-bar-label', name);
  const track = el('div', 'tt-bar-track', undefined, {
    role: 'progressbar',
    'aria-label': name,
    'aria-valuemin': '0',
  });
  const fill = el('div', 'tt-bar-fill');
  track.appendChild(fill);
  root.append(label, track);
  const handle: BarHandle = {
    root,
    set(value, max) {
      const m = max > 0 ? max : 1;
      const v = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), m);
      root.dataset.value = String(v);
      root.dataset.max = String(m);
      fill.style.width = `${(v / m) * 100}%`;
      track.setAttribute('aria-valuenow', String(Math.round(v)));
      track.setAttribute('aria-valuemax', String(Math.round(m)));
    },
  };
  handle.set(0, 1);
  return handle;
}

export interface PlayerPlateHandle {
  root: HTMLElement;
  setName(n: string): void;
  health: BarHandle;
  stamina: BarHandle;
  setWinded(w: boolean): void;
  /** Extra: show the small "you" tag next to the local player's name. */
  setYou(you: boolean): void;
}

/** Test ids: `panel-`, `name-`, `health-`, `stamina-`, `winded-` plus the suffix. */
export function playerPlate(o: { align: 'left' | 'right'; testIdSuffix: string }): PlayerPlateHandle {
  const s = o.testIdSuffix;
  const root = el('div', 'tt-plate', undefined, { 'data-align': o.align });
  root.dataset.testid = `panel-${s}`;
  const head = el('div', 'tt-plate-head');
  const name = labelStrip('');
  name.dataset.testid = `name-${s}`;
  const you = el('span', 'tt-tag tt-plate-you', 'you');
  you.hidden = true;
  const winded = el('span', 'tt-tag tt-plate-winded', 'Winded');
  winded.dataset.testid = `winded-${s}`;
  winded.hidden = true;
  head.append(name, you, winded);
  const health = bar('health', { align: o.align, testId: `health-${s}` });
  const stamina = bar('stamina', { align: o.align, testId: `stamina-${s}` });
  root.append(head, health.root, stamina.root);
  return {
    root,
    health,
    stamina,
    setName(n) {
      name.textContent = n;
    },
    setWinded(w) {
      winded.hidden = !w;
      root.classList.toggle('tt-winded', w);
    },
    setYou(y) {
      you.hidden = !y;
    },
  };
}

export interface DotsState {
  slots: number;
  current: number;
  filled: boolean[];
  tone: 'attack' | 'defend' | 'idle';
}
export interface DotsHandle {
  root: HTMLElement;
  set(state: DotsState): void;
}

/** The half-beat phrase dots. */
export function phraseDots(): DotsHandle {
  const root = el('div', 'tt-dots', undefined, { role: 'img' });
  const row = el('div', 'tt-dots-row');
  root.appendChild(row);
  let last = '';
  return {
    root,
    set(state) {
      const key = JSON.stringify(state);
      if (key === last) return;
      last = key;
      root.dataset.tone = state.tone;
      while (row.children.length > state.slots) row.lastElementChild?.remove();
      while (row.children.length < state.slots) row.appendChild(el('span', 'tt-dot'));
      let n = 0;
      for (let i = 0; i < state.slots; i++) {
        const d = row.children[i] as HTMLElement;
        const filled = state.filled[i] === true;
        if (filled) n++;
        d.dataset.filled = String(filled);
        d.dataset.current = String(i === state.current);
        d.dataset.testid = `dot-${i}`;
      }
      root.setAttribute('aria-label', `${n} of ${state.slots} half-beats`);
    },
  };
}

/** "Act 2 of 3" with one dot per act (done, current, to come). */
export function actCounter(): {
  root: HTMLElement;
  set(act: number, of: number, wins: [number, number]): void;
} {
  const root = el('div', 'tt-act');
  const label = el('span', 'tt-tag tt-act-label');
  const dots = el('span', 'tt-act-dots', undefined, { 'aria-hidden': 'true' });
  root.append(label, dots);
  return {
    root,
    set(act, of, wins) {
      label.textContent = `Act ${act} of ${of}`;
      root.dataset.act = String(act);
      root.dataset.wins = `${wins[0]}-${wins[1]}`;
      dots.replaceChildren();
      for (let i = 1; i <= of; i++) {
        const d = el('span', 'tt-act-dot');
        d.dataset.state = i < act ? 'done' : i === act ? 'current' : 'next';
        dots.appendChild(d);
      }
    },
  };
}

/** Big banner in letter tiles. `set` re-renders only when the text or palette changes. */
export function banner(): { root: HTMLElement; set(text: string | null, palette?: 'banner' | 'win'): void } {
  const root = el('div', 'tt-banner');
  let key = '';
  return {
    root,
    set(text, palette = 'banner') {
      const next = text === null ? '' : `${palette}|${text}`;
      if (next === key) return;
      key = next;
      root.replaceChildren();
      if (text === null) {
        delete root.dataset.value;
        return;
      }
      root.dataset.value = text;
      root.appendChild(letterTiles(text, { palette }));
    },
  };
}

const GRADE_TEXT = { bravo: 'Bravo!', good: 'Good', miss: 'Miss' } as const;

/** A grade pop-up that animates and removes itself. */
export function gradePop(grade: 'bravo' | 'good' | 'miss'): HTMLElement {
  const n = el('div', `tt-grade tt-grade-${grade}`, GRADE_TEXT[grade], { role: 'status' });
  n.addEventListener('animationend', () => n.remove());
  return n;
}

export function progressBar(o: { label?: string } = {}): {
  root: HTMLElement;
  set(fraction: number, label?: string): void;
} {
  const root = el('div', 'tt-progress');
  const label = el('span', 'tt-progress-label', o.label ?? '');
  const track = el('div', 'tt-progress-track', undefined, {
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
  });
  const fill = el('div', 'tt-progress-fill');
  track.appendChild(fill);
  root.append(label, track);
  const set = (fraction: number, text?: string): void => {
    const f = Math.min(Math.max(Number.isFinite(fraction) ? fraction : 0, 0), 1);
    fill.style.width = `${f * 100}%`;
    track.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    if (text !== undefined) label.textContent = text;
    track.setAttribute('aria-label', label.textContent || 'Progress');
  };
  set(0);
  return { root, set };
}

/** A paper panel for menus and dialogs. */
export function panel(o: { title?: string; rotate?: number } = {}): HTMLElement {
  const n = el('section', 'tt-panel');
  setRotate(n, o.rotate ?? -0.5);
  if (o.title) {
    const t = labelStrip(o.title);
    t.classList.add('tt-panel-title');
    n.appendChild(t);
  }
  return n;
}
