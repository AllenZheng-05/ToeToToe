// The brief asks for the jsdom environment pragma. On Node older than 22.15 (this machine: 22.13)
// jsdom's dependency undici fails to load because `zlib.createZstdDecompress` is missing, so the
// DOM is created by hand here after stubbing that one function. On a current Node this is a no-op.
import zlib from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';

type Kit = typeof import('../../src/ui/kit/kit');
let kit: Kit;

beforeAll(async () => {
  const z = zlib as unknown as Record<string, unknown>;
  if (typeof z.createZstdDecompress !== 'function') z.createZstdDecompress = () => undefined;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom ships no types here
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  kit = await import('../../src/ui/kit/kit');
});
describe('tileStyles', () => {
  it('is deterministic for a seed', () => {
    expect(kit.tileStyles('ATTACK!', 4, 'banner')).toEqual(kit.tileStyles('ATTACK!', 4, 'banner'));
  });

  it('differs across seeds', () => {
    expect(kit.tileStyles('ATTACK!', 1, 'banner')).not.toEqual(kit.tileStyles('ATTACK!', 2, 'banner'));
  });

  it('skips spaces and follows the mock cycle for seed 0', () => {
    const s = kit.tileStyles('A T', 0, 'banner');
    expect(s.map((t) => t.char)).toEqual(['A', 'T']);
    expect(s[0]?.bg).toBe('#FFE14D');
    expect(s[1]?.bg).toBe('#1B1210');
  });
});

describe('letterTiles', () => {
  it('labels the whole text and makes one hidden tile per non-space character', () => {
    const root = kit.letterTiles('ALLEN WINS!', { palette: 'win' });
    expect(root.getAttribute('aria-label')).toBe('ALLEN WINS!');
    const tiles = root.querySelectorAll('.tt-tile');
    expect(tiles).toHaveLength(10);
    tiles.forEach((t) => expect(t.getAttribute('aria-hidden')).toBe('true'));
  });
});

describe('bar', () => {
  it('sets data-value, clamps, and keeps the plain label', () => {
    const h = kit.bar('health');
    h.set(20, 30);
    expect(h.root.dataset.value).toBe('20');
    h.set(99, 30);
    expect(h.root.dataset.value).toBe('30');
    h.set(-4, 30);
    expect(h.root.dataset.value).toBe('0');
    expect(h.root.textContent).toBe('Health');
    const s = kit.bar('stamina', { testId: 'st' });
    expect(s.root.textContent).toBe('Stamina');
    expect(s.root.dataset.testid).toBe('st');
    expect(s.root.querySelector('[role="progressbar"]')).not.toBeNull();
  });
});

describe('button', () => {
  it('sets label, test id and disabled, and fires onClick', () => {
    let clicks = 0;
    const b = kit.button('Create a room', { testId: 'create', disabled: true, onClick: () => clicks++ });
    expect(b.textContent).toBe('Create a room');
    expect(b.dataset.testid).toBe('create');
    expect(b.disabled).toBe(true);
    const c = kit.button('Join a room', { onClick: () => clicks++ });
    expect(c.disabled).toBe(false);
    c.click();
    expect(clicks).toBe(1);
  });
});

describe('banner', () => {
  it('does not rebuild for the same text', () => {
    const b = kit.banner();
    b.set('ATTACK!');
    const first = b.root.firstElementChild;
    b.set('ATTACK!');
    expect(b.root.firstElementChild).toBe(first);
    b.set('PARRY!');
    expect(b.root.firstElementChild).not.toBe(first);
    b.set(null);
    expect(b.root.childElementCount).toBe(0);
  });
});

describe('phraseDots', () => {
  it('renders the requested number of dots', () => {
    const d = kit.phraseDots();
    d.set({ slots: 8, current: 2, filled: [true, false, true], tone: 'attack' });
    expect(d.root.querySelectorAll('.tt-dot')).toHaveLength(8);
    d.set({ slots: 4, current: 0, filled: [], tone: 'idle' });
    expect(d.root.querySelectorAll('.tt-dot')).toHaveLength(4);
  });
});
