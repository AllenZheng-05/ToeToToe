import ledgeUrl from '../assets/stage/ledge-cardboard.jpg';
import skyUrl from '../assets/stage/sky.jpg';
import { SETTINGS, type Store, type StoredPuppet } from '../data/store';
import { PARTS, type PartKind } from '../puppet/parts';
import { PRESETS, svgDataUrl } from '../puppet/presets';
import { button, labelStrip, letterTiles, tapeNote, textInput, tornNote } from '../ui/kit/kit';
import { createBitmap, floodFill, isBlank, stampCircle, strokeLine, type Bitmap, type Rgba } from './bitmap';
import { History } from './history';
import { BRUSH_SIZES, COLOUR_NAMES, PALETTE, hexToRgba } from './palette';
import { createPreview, PREVIEW_H, PREVIEW_W } from './preview';
import { canvasToBlob, decodeDrawing, KINDS, presetToDrawing } from './selection';
import './workshop.css';

export interface PuppetDrawing {
  id: string | null;
  name: string;
  head: Blob;
  sock: Blob;
  sword: Blob;
  presetId?: string;
}

export interface WorkshopOptions {
  store: Store;
  /** The "Done" button. Receives the puppet the player will take into a match (unsaved edits are saved first). */
  onDone?(selected: PuppetDrawing): void;
  /** After every stroke end, tool action or selection. */
  onChange?(current: PuppetDrawing): void;
}

type Tool = 'brush' | 'eraser' | 'fill';

const DEFAULT_NAME = 'My puppet';
const NAME_MAX = 32;
const CONFIRM_MS = 3000;
/** Largest displayed size of a drawing surface inside the 600 x 440 page. */
const FIT_W = 560;
const FIT_H = 400;
const CLEAR = [0, 0, 0, 0] as Rgba;

const TAB_LABEL: Record<PartKind, string> = { head: 'Head', sock: 'Sock piece', sword: 'Sword' };
const TAB_ID: Record<PartKind, string> = { head: 'tab-head', sock: 'tab-sock', sword: 'tab-sword' };
const PART_WORD: Record<PartKind, string> = { head: 'head', sock: 'sock piece', sword: 'sword' };
const HINTS: Record<PartKind, string> = {
  head: 'draw inside the dashes. the mouth end points right!',
  sock: 'this piece repeats down the body. pins sit at both ends.',
  sword: 'the handle is on the left and the tip points right.',
};

const ICONS = {
  brush:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M14 6l4 4"/></svg>',
  eraser:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15l9-10 7 6-7 8H8z"/><path d="M8 11l7 6"/><path d="M12 19h8"/></svg>',
  fill: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11l7-7 7 7-7 7z"/><path d="M19 15c0 0 2.500 2.500 2.500 4.200a2.500 2.500 0 0 1-5 0C16.500 17.500 19 15 19 15z"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5L4 10l5 5"/><path d="M4 10h10a5 5 0 0 1 0 10h-4"/></svg>',
  redo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l5 5-5 5"/><path d="M20 10H10a5 5 0 0 0 0 10h4"/></svg>',
  clear:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
  arrow: '<svg viewBox="0 0 46 24" aria-hidden="true"><path d="M2 12h38"/><path d="M30 3l10 9-10 9"/></svg>',
};

interface Surface {
  kind: PartKind;
  bitmap: Bitmap;
  history: History;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Encoded PNG of the current bitmap; cleared whenever the bitmap changes. */
  blob: Blob | null;
  scale: number;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (attrs) for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function fitScale(kind: PartKind): number {
  const p = PARTS[kind];
  return Math.min(FIT_W / p.width, FIT_H / p.height);
}

export function createWorkshop(opts: WorkshopOptions): { root: HTMLElement; destroy(): void } {
  const { store } = opts;
  let destroyed = false;
  let raf = 0;

  // ---------- state ----------
  let tool: Tool = 'brush';
  let sizeIndex = 1;
  let colourIndex = 7; // teal, as in the mock
  let active: PartKind = 'head';
  let guidesOn = true;
  let currentId: string | null = null; // the saved puppet being edited, if any
  let presetId: string | undefined; // set while the editor still holds an untouched preset
  let selectedId: string | null = null; // highlighted chip
  let dirty = false;
  let loadToken = 0;
  let changeSeq = 0;
  let confirmTimer = 0;
  let armed: 'clear' | 'delete' | null = null;
  let objectUrls: string[] = [];

  const surfaces = {} as Record<PartKind, Surface>;
  for (const kind of KINDS) {
    const { width, height } = PARTS[kind];
    const canvas = h('canvas', 'ws-canvas');
    canvas.width = width;
    canvas.height = height;
    surfaces[kind] = {
      kind,
      bitmap: createBitmap(width, height),
      history: new History(),
      canvas,
      ctx: canvas.getContext('2d') as CanvasRenderingContext2D,
      blob: null,
      scale: fitScale(kind),
    };
  }

  // ---------- DOM ----------
  const root = h('div', 'ws-root');
  root.dataset.testid = 'workshop';

  // header
  const header = h('div', 'ws-header');
  header.style.backgroundImage = `url(${ledgeUrl})`;
  const headerRow = h('div', 'ws-header-row');
  const title = letterTiles('WORKSHOP', { palette: 'banner', size: 36 });
  const subtitle = h('span', 'ws-subtitle');
  subtitle.textContent = 'draw your own puppet and sword';
  const doneBtn = button('Done', { variant: 'pink', testId: 'done' });
  headerRow.append(title, subtitle, doneBtn);
  header.appendChild(headerRow);

  // tools
  const tools = h('section', 'ws-tools');
  const toolsGrid = h('div', 'ws-grid2');
  function iconButton(label: string, icon: string, testId: string): HTMLButtonElement {
    const b = h('button', 'ws-icon-btn', { type: 'button', 'aria-label': label });
    b.dataset.testid = testId;
    b.innerHTML = icon;
    return b;
  }
  const brushBtn = iconButton('Brush', ICONS.brush, 'tool-brush');
  const eraserBtn = iconButton('Eraser', ICONS.eraser, 'tool-eraser');
  const fillBtn = iconButton('Fill', ICONS.fill, 'tool-fill');
  const undoBtn = iconButton('Undo', ICONS.undo, 'undo');
  const redoBtn = iconButton('Redo', ICONS.redo, 'redo');
  const clearBtn = iconButton('Clear the page', ICONS.clear, 'clear');
  // Order matches the mock: brush, eraser / fill, undo / redo, clear.
  toolsGrid.append(brushBtn, eraserBtn, fillBtn, undoBtn, redoBtn, clearBtn);

  const sizeGrid = h('div', 'ws-grid3');
  const sizeBtns: HTMLButtonElement[] = [];
  const SIZE_NAMES = ['Small brush', 'Medium brush', 'Large brush'];
  const DOT_PX = [8, 14, 22];
  BRUSH_SIZES.forEach((_, i) => {
    const b = h('button', 'ws-icon-btn ws-size-btn', {
      type: 'button',
      'aria-label': SIZE_NAMES[i] as string,
    });
    b.dataset.testid = `size-${i}`;
    const dot = h('span', 'ws-dot');
    dot.style.width = dot.style.height = `${DOT_PX[i]}px`;
    b.appendChild(dot);
    sizeBtns.push(b);
    sizeGrid.appendChild(b);
  });

  const swatchGrid = h('div', 'ws-grid4');
  const swatches: HTMLButtonElement[] = [];
  PALETTE.forEach((hex, i) => {
    const b = h('button', 'ws-swatch', { type: 'button', 'aria-label': COLOUR_NAMES[i] as string });
    b.dataset.testid = `colour-${i}`;
    b.style.background = hex;
    swatches.push(b);
    swatchGrid.appendChild(b);
  });
  tools.append(
    labelStrip('Tools', { rotate: 0 }),
    toolsGrid,
    labelStrip('Brush size', { rotate: 0 }),
    sizeGrid,
    labelStrip('Colours', { rotate: 0 }),
    swatchGrid,
  );
  for (const s of tools.querySelectorAll('.tt-strip')) s.classList.add('ws-strip');

  // tabs
  const tabs = h('div', 'ws-tabs');
  const tabBtns = {} as Record<PartKind, HTMLButtonElement>;
  KINDS.forEach((kind, i) => {
    const b = h('button', 'ws-tab', { type: 'button' });
    b.textContent = TAB_LABEL[kind];
    b.dataset.testid = TAB_ID[kind];
    b.dataset.index = String(i + 1);
    tabBtns[kind] = b;
    tabs.appendChild(b);
  });

  // page
  const page = h('div', 'ws-page');
  const stageBox = h('div', 'ws-stage');
  for (const kind of KINDS) stageBox.appendChild(surfaces[kind].canvas);
  const guides = h('div', 'ws-guides');
  stageBox.appendChild(guides);
  page.append(stageBox, h('div', 'ws-tape'), h('div', 'ws-tape'));
  const tapeA = page.children[1] as HTMLElement;
  const tapeB = page.children[2] as HTMLElement;
  tapeA.style.cssText = 'left:-24px;bottom:-10px';
  tapeB.style.cssText = 'right:-22px;top:-12px';

  const hint = tapeNote(HINTS.head, { rotate: -1 });
  hint.classList.add('ws-hint');
  hint.style.fontSize = '19px';
  const guidesToggle = h('button', 'ws-guides-toggle', { type: 'button', 'aria-pressed': 'true' });
  guidesToggle.textContent = 'Guides';
  guidesToggle.dataset.testid = 'guides';
  guidesToggle.style.cssText = 'left:610px;top:112px;right:auto;bottom:auto';

  // right column
  const right = h('div', 'ws-right');
  const previewStrip = labelStrip('Live preview', { rotate: 0 });
  previewStrip.classList.add('ws-strip');
  const previewBox = h('div', 'ws-preview');
  previewBox.style.backgroundImage = `url(${skyUrl})`;
  const previewCanvas = h('canvas');
  previewCanvas.dataset.testid = 'preview';
  const previewLedge = h('div', 'ws-preview-ledge');
  previewLedge.style.backgroundImage = `url(${ledgeUrl})`;
  previewBox.append(previewCanvas, previewLedge);
  const nameField = textInput({
    label: "Puppet's name",
    value: DEFAULT_NAME,
    maxLength: NAME_MAX,
    testId: 'puppet-name',
    onInput: () => {
      dirty = true;
    },
  });
  nameField.root.querySelector('.tt-strip')?.classList.add('ws-strip');
  const saveBtn = button('Save', { testId: 'save' });
  const newBtn = button('New', { variant: 'secondary', testId: 'new' });
  const deleteBtn = button('Delete', { variant: 'danger', testId: 'delete' });
  const actions = h('div', 'ws-actions');
  actions.append(saveBtn, newBtn, deleteBtn);
  const msg = h('div', 'ws-msg', { 'aria-live': 'polite' });
  msg.dataset.testid = 'message';
  const drawerStrip = labelStrip('My sock drawer', { rotate: 0 });
  drawerStrip.classList.add('ws-strip');
  const drawer = h('div', 'ws-drawer');
  drawer.dataset.testid = 'drawer';
  right.append(previewStrip, previewBox, nameField.root, actions, msg, drawerStrip, drawer);

  root.append(header, tools, tabs, page, hint, guidesToggle, right);
  if (!store.persistent) {
    const note = tornNote("This browser can't save drawings. They will last until you close the tab.", {
      rotate: -1,
      width: 400,
    });
    note.classList.add('ws-persist');
    note.dataset.testid = 'not-persistent';
    root.appendChild(note);
  }

  // ---------- painting ----------
  function paint(kind: PartKind): void {
    const s = surfaces[kind];
    s.ctx.putImageData(
      new ImageData(new Uint8ClampedArray(s.bitmap.data), s.bitmap.width, s.bitmap.height),
      0,
      0,
    );
  }

  const preview = createPreview(previewCanvas);
  function updatePreview(): void {
    preview.update({ head: surfaces.head.canvas, sock: surfaces.sock.canvas, sword: surfaces.sword.canvas });
  }
  function aimFrom(e: PointerEvent): void {
    const r = previewCanvas.getBoundingClientRect();
    if (r.width === 0) return;
    preview.aim({
      x: ((e.clientX - r.left) * PREVIEW_W) / r.width,
      y: ((e.clientY - r.top) * PREVIEW_H) / r.height,
    });
  }
  previewBox.addEventListener('pointermove', aimFrom);
  previewBox.addEventListener('pointerdown', aimFrom);
  previewBox.addEventListener('pointerleave', () => preview.aim(null));
  previewBox.addEventListener('pointercancel', () => preview.aim(null));

  function tick(now: number): void {
    if (destroyed) return;
    preview.frame(now);
    raf = requestAnimationFrame(tick);
  }

  // ---------- guides ----------
  interface GuideSpec {
    x: number;
    y: number;
    label: string;
    side: 'below-right' | 'below-left' | 'below' | 'above';
    arrow?: boolean;
  }
  function guideSpecs(kind: PartKind): GuideSpec[] {
    if (kind === 'head') {
      return [
        { ...PARTS.head.pin, label: 'joins the sock', side: 'below-right' },
        { ...PARTS.head.mouth, label: 'sword goes here', side: 'below-left', arrow: true },
      ];
    }
    if (kind === 'sock') {
      return [
        { ...PARTS.sock.pinA, label: 'pin', side: 'below' },
        { ...PARTS.sock.pinB, label: 'pin', side: 'below' },
      ];
    }
    return [
      { ...PARTS.sword.handle, label: 'handle', side: 'below' },
      { ...PARTS.sword.tip, label: 'tip', side: 'below' },
    ];
  }

  function layoutStage(): void {
    const s = surfaces[active];
    const p = PARTS[active];
    const w = p.width * s.scale;
    const hh = p.height * s.scale;
    stageBox.style.width = `${w}px`;
    stageBox.style.height = `${hh}px`;
    stageBox.style.left = `${(600 - w) / 2}px`;
    stageBox.style.top = `${(440 - hh) / 2}px`;
    guides.replaceChildren();
    const inset = 8 * s.scale;
    const box = h('div', 'ws-guide-box');
    box.style.cssText = `left:${inset}px;top:${inset}px;right:${inset}px;bottom:${inset}px`;
    guides.appendChild(box);
    for (const g of guideSpecs(active)) {
      const x = g.x * s.scale;
      const y = g.y * s.scale;
      const dot = h('div', 'ws-anchor');
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      guides.appendChild(dot);
      const label = h('span', 'ws-anchor-label');
      label.textContent = g.label;
      label.style.top = `${y + 14}px`;
      if (g.side === 'below-right') label.style.left = `${x - 10}px`;
      else if (g.side === 'below-left') {
        label.style.left = `${x + 24}px`;
        label.style.transform = 'translateX(-100%)';
        label.style.top = `${y + 24}px`;
      } else {
        label.style.left = `${x}px`;
        label.style.transform = 'translateX(-50%)';
      }
      guides.appendChild(label);
      if (g.arrow) {
        const wrap = h('div');
        wrap.innerHTML = ICONS.arrow;
        const svg = wrap.firstElementChild as SVGElement;
        svg.setAttribute('class', 'ws-arrow');
        svg.style.left = `${x + 14}px`;
        svg.style.top = `${y}px`;
        guides.appendChild(svg);
      }
    }
    guides.hidden = !guidesOn;
  }

  // ---------- UI state ----------
  function disarm(): void {
    if (armed === null) return;
    armed = null;
    window.clearTimeout(confirmTimer);
    clearBtn.classList.remove('ws-confirm');
    clearBtn.innerHTML = ICONS.clear;
    clearBtn.setAttribute('aria-label', 'Clear the page');
    deleteBtn.textContent = 'Delete';
  }

  function say(text: string): void {
    msg.replaceChildren();
    if (!text) return;
    const s = h('span');
    s.textContent = text;
    msg.appendChild(s);
  }

  function isSavedId(id: string | null): id is string {
    return id !== null && !PRESETS.some((p) => p.id === id);
  }

  function syncUi(): void {
    const surf = surfaces[active];
    brushBtn.setAttribute('aria-pressed', String(tool === 'brush'));
    eraserBtn.setAttribute('aria-pressed', String(tool === 'eraser'));
    fillBtn.setAttribute('aria-pressed', String(tool === 'fill'));
    sizeBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === sizeIndex)));
    swatches.forEach((b, i) => b.setAttribute('aria-pressed', String(i === colourIndex)));
    for (const kind of KINDS) tabBtns[kind].setAttribute('aria-pressed', String(kind === active));
    undoBtn.disabled = !surf.history.canUndo;
    redoBtn.disabled = !surf.history.canRedo;
    deleteBtn.disabled = !isSavedId(currentId);
    guidesToggle.setAttribute('aria-pressed', String(guidesOn));
    for (const kind of KINDS) surfaces[kind].canvas.classList.toggle('ws-active', kind === active);
    for (const kind of KINDS) {
      if (kind === active) surfaces[kind].canvas.dataset.testid = 'canvas';
      else delete surfaces[kind].canvas.dataset.testid;
    }
    hint.textContent = HINTS[active];
  }

  function setActive(kind: PartKind): void {
    active = kind;
    disarm();
    layoutStage();
    syncUi();
  }

  // ---------- current puppet ----------
  async function blobOf(kind: PartKind): Promise<Blob> {
    const s = surfaces[kind];
    if (!s.blob) s.blob = await canvasToBlob(s.canvas);
    return s.blob;
  }

  function currentName(): string {
    const n = nameField.input.value.trim().slice(0, NAME_MAX);
    return n || DEFAULT_NAME;
  }

  async function currentDrawing(): Promise<PuppetDrawing> {
    const [head, sock, sword] = await Promise.all([blobOf('head'), blobOf('sock'), blobOf('sword')]);
    const d: PuppetDrawing = { id: currentId, name: currentName(), head, sock, sword };
    if (presetId) d.presetId = presetId;
    return d;
  }

  function emitChange(): void {
    if (!opts.onChange) return;
    const seq = ++changeSeq;
    currentDrawing().then(
      (d) => {
        if (!destroyed && seq === changeSeq) opts.onChange?.(d);
      },
      () => {
        /* encoding failed; nothing to report */
      },
    );
  }

  function edited(): void {
    dirty = true;
    presetId = undefined;
    for (const kind of KINDS) surfaces[kind].blob = null;
  }

  function strokeEnded(): void {
    edited();
    updatePreview();
    syncUi();
    emitChange();
  }

  async function putSetting(id: string): Promise<void> {
    try {
      await store.settings.set(SETTINGS.selectedPuppetId, id);
    } catch {
      /* the selection just will not be remembered */
    }
  }

  function setBitmaps(d: {
    head: HTMLCanvasElement;
    sock: HTMLCanvasElement;
    sword: HTMLCanvasElement;
  }): void {
    for (const kind of KINDS) {
      const s = surfaces[kind];
      const src = d[kind];
      const ctx = src.getContext('2d') as CanvasRenderingContext2D;
      const img = ctx.getImageData(0, 0, src.width, src.height);
      s.bitmap = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
      s.history.clear();
      s.blob = null;
      paint(kind);
    }
  }

  function setBlank(): void {
    for (const kind of KINDS) {
      const s = surfaces[kind];
      s.bitmap = createBitmap(PARTS[kind].width, PARTS[kind].height);
      s.history.clear();
      s.blob = null;
      paint(kind);
    }
  }

  async function loadInto(d: PuppetDrawing): Promise<boolean> {
    const token = ++loadToken;
    try {
      const decoded = await decodeDrawing(d);
      if (destroyed || token !== loadToken) return false;
      setBitmaps(decoded);
    } catch {
      if (destroyed || token !== loadToken) return false;
      say("Couldn't open that puppet.");
      return false;
    }
    nameField.input.value = d.name.slice(0, NAME_MAX);
    updatePreview();
    return true;
  }

  async function select(id: string, persist = true): Promise<void> {
    disarm();
    say('');
    const preset = PRESETS.find((p) => p.id === id);
    let drawing: PuppetDrawing | undefined;
    try {
      if (preset) drawing = await presetToDrawing(preset);
      else {
        const saved = await store.puppets.get(id);
        if (saved)
          drawing = {
            id: saved.id,
            name: saved.name,
            head: saved.head,
            sock: saved.sock,
            sword: saved.sword,
          };
      }
    } catch {
      drawing = undefined;
    }
    if (destroyed) return;
    if (!drawing) {
      say("Couldn't find that puppet.");
      await refreshDrawer();
      return;
    }
    if (!(await loadInto(drawing))) return;
    selectedId = id;
    currentId = preset ? null : id;
    presetId = preset?.id;
    dirty = false;
    if (persist) await putSetting(id);
    syncUi();
    markSelected();
    emitChange();
  }

  function newPuppet(): void {
    disarm();
    loadToken++;
    setBlank();
    nameField.input.value = DEFAULT_NAME;
    currentId = null;
    presetId = undefined;
    selectedId = null;
    dirty = false;
    say('');
    updatePreview();
    syncUi();
    markSelected();
    emitChange();
  }

  async function save(quiet: boolean): Promise<StoredPuppet | null> {
    disarm();
    try {
      const [head, sock, sword] = await Promise.all([blobOf('head'), blobOf('sock'), blobOf('sword')]);
      const existing = isSavedId(currentId) ? await store.puppets.get(currentId) : undefined;
      const now = Date.now();
      const rec: StoredPuppet = {
        id: existing?.id ?? uuid(),
        name: currentName(),
        head,
        sock,
        sword,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      if (existing?.remoteId) rec.remoteId = existing.remoteId;
      await store.puppets.put(rec);
      currentId = rec.id;
      presetId = undefined;
      selectedId = rec.id;
      dirty = false;
      nameField.input.value = rec.name;
      await putSetting(rec.id);
      if (!quiet) {
        const blanks = KINDS.filter((k) => isBlank(surfaces[k].bitmap)).map(
          (k) => `Your ${PART_WORD[k]} is blank.`,
        );
        say(blanks.length > 0 ? `Saved. ${blanks.join(' ')}` : 'Saved to your sock drawer.');
      }
      await refreshDrawer();
      syncUi();
      emitChange();
      return rec;
    } catch {
      say("Couldn't save. Try again.");
      return null;
    }
  }

  async function remove(): Promise<void> {
    const id = currentId;
    disarm();
    if (!isSavedId(id)) return;
    try {
      await store.puppets.delete(id);
    } catch {
      say("Couldn't delete that puppet.");
      return;
    }
    say('Deleted.');
    currentId = null;
    await refreshDrawer();
    await select((PRESETS[0] as { id: string }).id);
  }

  // ---------- drawer ----------
  function chip(id: string, name: string, src: string): HTMLButtonElement {
    const b = h('button', 'ws-chip', { type: 'button', 'aria-label': name, title: name });
    b.dataset.testid = `saved-${id}`;
    b.dataset.puppetId = id;
    const img = h('img', undefined, { alt: '', draggable: 'false' });
    img.src = src;
    const cap = h('span');
    cap.textContent = name;
    b.append(img, cap);
    b.addEventListener('click', () => void select(id));
    return b;
  }

  function markSelected(): void {
    for (const c of drawer.querySelectorAll<HTMLElement>('.ws-chip')) {
      c.setAttribute('aria-pressed', String(c.dataset.puppetId === selectedId));
    }
  }

  async function refreshDrawer(): Promise<void> {
    let saved: StoredPuppet[];
    try {
      saved = await store.puppets.list();
    } catch {
      saved = [];
    }
    if (destroyed) return;
    for (const u of objectUrls) URL.revokeObjectURL(u);
    objectUrls = [];
    const chips: HTMLElement[] = [];
    for (const p of PRESETS) chips.push(chip(p.id, p.name, svgDataUrl(p.svg.head)));
    for (const s of saved) {
      const url = URL.createObjectURL(s.head);
      objectUrls.push(url);
      chips.push(chip(s.id, s.name, url));
    }
    drawer.replaceChildren(...chips);
    markSelected();
  }

  // ---------- drawing ----------
  function colour(): Rgba {
    return tool === 'eraser' ? CLEAR : hexToRgba(PALETTE[colourIndex] as string);
  }
  function radius(): number {
    return BRUSH_SIZES[sizeIndex] as number;
  }

  for (const kind of KINDS) {
    const s = surfaces[kind];
    const cv = s.canvas;
    let pointerId: number | null = null;
    let last: { x: number; y: number } | null = null;

    const toDrawing = (e: PointerEvent): { x: number; y: number } => {
      const r = cv.getBoundingClientRect();
      const w = r.width || 1;
      const hh = r.height || 1;
      return {
        x: ((e.clientX - r.left) * s.bitmap.width) / w,
        y: ((e.clientY - r.top) * s.bitmap.height) / hh,
      };
    };

    cv.addEventListener('pointerdown', (e) => {
      if (pointerId !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      disarm();
      const p = toDrawing(e);
      s.history.push(s.bitmap);
      if (tool === 'fill') {
        floodFill(s.bitmap, p.x, p.y, colour());
        paint(kind);
        strokeEnded();
        return;
      }
      pointerId = e.pointerId;
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best effort */
      }
      last = p;
      stampCircle(s.bitmap, p.x, p.y, radius(), colour());
      paint(kind);
    });

    cv.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointerId || !last) return;
      e.preventDefault();
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const ev of events.length > 0 ? events : [e]) {
        const p = toDrawing(ev);
        strokeLine(s.bitmap, last.x, last.y, p.x, p.y, radius(), colour());
        last = p;
      }
      paint(kind);
    });

    const finish = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      last = null;
      try {
        cv.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      strokeEnded();
    };
    cv.addEventListener('pointerup', finish);
    cv.addEventListener('pointercancel', finish);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------- wiring ----------
  function pickTool(t: Tool): void {
    tool = t;
    disarm();
    syncUi();
    emitChange();
  }
  brushBtn.addEventListener('click', () => pickTool('brush'));
  eraserBtn.addEventListener('click', () => pickTool('eraser'));
  fillBtn.addEventListener('click', () => pickTool('fill'));
  sizeBtns.forEach((b, i) =>
    b.addEventListener('click', () => {
      sizeIndex = i;
      disarm();
      syncUi();
    }),
  );
  swatches.forEach((b, i) =>
    b.addEventListener('click', () => {
      colourIndex = i;
      if (tool === 'eraser') tool = 'brush';
      disarm();
      syncUi();
    }),
  );
  for (const kind of KINDS) tabBtns[kind].addEventListener('click', () => setActive(kind));
  guidesToggle.addEventListener('click', () => {
    guidesOn = !guidesOn;
    guides.hidden = !guidesOn;
    syncUi();
  });

  undoBtn.addEventListener('click', () => {
    disarm();
    const s = surfaces[active];
    const prev = s.history.undo(s.bitmap);
    if (prev) {
      s.bitmap = prev;
      paint(active);
      strokeEnded();
    }
  });
  redoBtn.addEventListener('click', () => {
    disarm();
    const s = surfaces[active];
    const next = s.history.redo(s.bitmap);
    if (next) {
      s.bitmap = next;
      paint(active);
      strokeEnded();
    }
  });
  clearBtn.addEventListener('click', () => {
    if (armed !== 'clear') {
      disarm();
      armed = 'clear';
      clearBtn.classList.add('ws-confirm');
      clearBtn.textContent = 'Sure?';
      clearBtn.setAttribute('aria-label', 'Sure? Click again to clear the page');
      confirmTimer = window.setTimeout(disarm, CONFIRM_MS);
      return;
    }
    disarm();
    const s = surfaces[active];
    s.history.push(s.bitmap);
    s.bitmap = createBitmap(s.bitmap.width, s.bitmap.height);
    paint(active);
    strokeEnded();
  });
  saveBtn.addEventListener('click', () => void save(false));
  newBtn.addEventListener('click', newPuppet);
  deleteBtn.addEventListener('click', () => {
    if (!isSavedId(currentId)) return;
    if (armed !== 'delete') {
      disarm();
      armed = 'delete';
      deleteBtn.textContent = 'Sure?';
      confirmTimer = window.setTimeout(disarm, CONFIRM_MS);
      return;
    }
    void remove();
  });
  doneBtn.addEventListener('click', () => {
    void (async () => {
      disarm();
      let d: PuppetDrawing | null = null;
      if (dirty) {
        const rec = await save(true);
        if (rec) d = { id: rec.id, name: rec.name, head: rec.head, sock: rec.sock, sword: rec.sword };
      }
      if (!d) d = await currentDrawing();
      if (!destroyed) opts.onDone?.(d);
    })();
  });

  // ---------- start ----------
  layoutStage();
  syncUi();
  for (const kind of KINDS) paint(kind);
  updatePreview();
  raf = requestAnimationFrame(tick);

  void (async () => {
    await refreshDrawer();
    let id = '';
    try {
      id = await store.settings.get<string>(SETTINGS.selectedPuppetId, '');
    } catch {
      id = '';
    }
    if (destroyed) return;
    const known =
      id && (PRESETS.some((p) => p.id === id) || (await store.puppets.get(id).catch(() => undefined)));
    await select(known ? id : (PRESETS[0] as { id: string }).id, false);
  })();

  return {
    root,
    destroy(): void {
      destroyed = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(confirmTimer);
      for (const u of objectUrls) URL.revokeObjectURL(u);
      objectUrls = [];
      root.remove();
    },
  };
}
