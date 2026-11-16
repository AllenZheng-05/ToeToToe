import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { DuelView, TargetView, Tunables } from '../../core/types';
import { PLAY_RECT, playToDesign } from '../layout';
import { canvasTexture } from './cutout';
import { dotsAlong, markScale, ringRadius } from './fit';

const INK = '#1B1210';
const YELLOW = '#FFE14D';
const RED = '#D42A40';
const GREEN = '#7BC67B';
const MISS_GREY = '#BDB6A8';
const INK_HEX = 0x1b1210;
const RED_HEX = 0xd42a40;

const RESOLUTION = 2;
/** Radius of the waiting target disc in the mocks (88 px across). Sprites are scaled from this. */
export const TARGET_BAKED_RADIUS = 44;
/** The closing ring starts at this multiple of the disc radius (the far ring in mock 6 is 230 / 88). */
const RING_FAR_FACTOR = 2.6;
const RING_WIDTH = 5;
const FONT_FAMILY = 'Bungee, Impact, sans-serif';

export interface MarkTextures {
  /** Waiting target discs with the numbers 1 to 8 (index 0 is "1"). */
  target: Texture[];
  parried: Texture;
  missed: Texture;
  /** Planted strike discs, numbers 1 to 8. */
  strike: Texture[];
  /** The newest planted strike (yellow, larger), numbers 1 to 8. */
  newest: Texture[];
  destroy(): void;
}

/** Resolves once the display font used on discs is ready, so `createMarkTextures` bakes real glyphs. */
export async function loadMarkFonts(): Promise<void> {
  try {
    await document.fonts.load(`30px ${FONT_FAMILY}`);
  } catch {
    // Fall back to the system font.
  }
}

function discCanvas(radius: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const size = Math.ceil(radius * 2 + 4);
  const c = document.createElement('canvas');
  c.width = size * RESOLUTION;
  c.height = size * RESOLUTION;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.scale(RESOLUTION, RESOLUTION);
  g.translate(size / 2, size / 2);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  return [c, g];
}

function circle(g: CanvasRenderingContext2D, r: number, fill: string): void {
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
}

function numeral(g: CanvasRenderingContext2D, n: number, size: number, fill: string): void {
  g.font = `${size}px ${FONT_FAMILY}`;
  g.fillStyle = fill;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  const text = String(n);
  const m = g.measureText(text);
  // Centre the glyph box on the disc.
  g.fillText(text, 0, (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
}

function bakeTarget(n: number): Texture {
  const [c, g] = discCanvas(TARGET_BAKED_RADIUS);
  // Ink border 5, yellow 4, ink 3, yellow inside: the double ring of the mocks.
  circle(g, 44, INK);
  circle(g, 39, YELLOW);
  circle(g, 35, INK);
  circle(g, 32, YELLOW);
  numeral(g, n, 30, INK);
  return canvasTexture(c, RESOLUTION);
}

function bakeParried(): Texture {
  const [c, g] = discCanvas(TARGET_BAKED_RADIUS);
  circle(g, 44, INK);
  circle(g, 39, GREEN);
  g.save();
  g.translate(-22, -22);
  g.scale(44 / 24, 44 / 24);
  g.beginPath();
  g.moveTo(5, 13);
  g.lineTo(10, 18);
  g.lineTo(19, 7);
  g.lineWidth = 3.5;
  g.strokeStyle = INK;
  g.stroke();
  g.restore();
  return canvasTexture(c, RESOLUTION);
}

function bakeMissed(): Texture {
  const [c, g] = discCanvas(TARGET_BAKED_RADIUS);
  circle(g, 44, INK);
  circle(g, 39, MISS_GREY);
  g.beginPath();
  g.moveTo(-15, -15);
  g.lineTo(15, 15);
  g.moveTo(15, -15);
  g.lineTo(-15, 15);
  g.lineWidth = 8;
  g.strokeStyle = RED;
  g.stroke();
  return canvasTexture(c, RESOLUTION);
}

function bakeStrike(n: number, newest: boolean): Texture {
  // Planted 54 px: white border 4 inside an ink ring 3. Newest 64 px, yellow.
  const inner = newest ? 32 : 27;
  const [c, g] = discCanvas(inner + 3);
  circle(g, inner + 3, INK);
  circle(g, inner, '#FFFFFF');
  circle(g, inner - 4, newest ? YELLOW : RED);
  numeral(g, n, newest ? 26 : 22, newest ? INK : '#FFFFFF');
  return canvasTexture(c, RESOLUTION);
}

/** Pre-rendered textures for every target and strike state (DESIGN_SPEC section 3), numbers 1 to 8, baked once. */
export function createMarkTextures(): MarkTextures {
  const nums = [1, 2, 3, 4, 5, 6, 7, 8];
  const t: MarkTextures = {
    target: nums.map(bakeTarget),
    parried: bakeParried(),
    missed: bakeMissed(),
    strike: nums.map((n) => bakeStrike(n, false)),
    newest: nums.map((n) => bakeStrike(n, true)),
    destroy(): void {
      for (const x of [...t.target, t.parried, t.missed, ...t.strike, ...t.newest]) x.destroy(true);
    },
  };
  return t;
}

const clampNum = (i: number): number => Math.min(7, Math.max(0, i));

/**
 * Draws the attack-phase strikes (red numbered discs joined by a red line, newest yellow) and the
 * defend-phase targets (yellow disc, ink double ring and number; a solid ink ring that closes in and
 * meets the disc edge at timeToHit = 0; green with a tick once parried; grey with a red cross when
 * missed). Takes positions in play-area fractions. A target's radius on screen is
 * `tunables.targetRadius` of the play width, so what is drawn is what is judged. Sprites are pooled;
 * only the closing rings (a few circles) and, when the positions change, the line are redrawn.
 */
export class MarksView {
  readonly container = new Container();
  private readonly textures: MarkTextures;
  private readonly lineGfx = new Graphics();
  private readonly discLayer = new Container();
  private readonly ringGfx = new Graphics();
  private readonly pool: Sprite[] = [];
  private lineKey = '';

  constructor(textures: MarkTextures) {
    this.textures = textures;
    this.container.addChild(this.lineGfx, this.discLayer, this.ringGfx);
  }

  /** ringLeadBeats: how many beats before its time a target's ring starts closing (default: the ringLeadBeats tunable). */
  update(
    view: DuelView,
    tunables: Tunables,
    bpm: number,
    opts: { touch?: boolean; ringLeadBeats?: number } = {},
  ): void {
    const radiusFrac = opts.touch ? tunables.targetRadiusTouch : tunables.targetRadius;
    const scale = markScale(radiusFrac * PLAY_RECT.width, TARGET_BAKED_RADIUS);
    this.ringGfx.clear();

    let used = 0;
    const sprite = (tex: Texture, x: number, y: number, alpha: number): void => {
      let s = this.pool[used];
      if (!s) {
        s = new Sprite(tex);
        s.anchor.set(0.5);
        this.pool.push(s);
        this.discLayer.addChild(s);
      }
      if (s.texture !== tex) s.texture = tex;
      s.position.set(x, y);
      s.scale.set(scale);
      s.alpha = alpha;
      s.visible = true;
      used++;
    };

    if (view.phase === 'attack' && view.strikes.length > 0) {
      const pts = view.strikes.map((s) => playToDesign(s.x, s.y));
      this.drawLine(pts, 'strike', scale);
      pts.forEach((p, i) => {
        const newest = i === pts.length - 1;
        const tex = (newest ? this.textures.newest : this.textures.strike)[clampNum(i)] as Texture;
        sprite(tex, p.x, p.y, 1);
      });
    } else if (view.phase === 'defend' && view.targets.length > 0) {
      const leadSec = (opts.ringLeadBeats ?? tunables.ringLeadBeats) * (60 / bpm);
      const pts = view.targets.map((t) => playToDesign(t.strike.x, t.strike.y));
      this.drawLine(pts, 'order', scale);
      view.targets.forEach((t, i) => {
        const p = pts[i] as { x: number; y: number };
        this.drawTarget(t, p, leadSec, scale, sprite);
      });
    } else if (this.lineKey !== '') {
      this.lineGfx.clear();
      this.lineKey = '';
    }

    for (let i = used; i < this.pool.length; i++) (this.pool[i] as Sprite).visible = false;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.pool.length = 0;
  }

  private drawTarget(
    t: TargetView,
    p: { x: number; y: number },
    leadSec: number,
    scale: number,
    sprite: (tex: Texture, x: number, y: number, alpha: number) => void,
  ): void {
    if (t.result === 'bravo' || t.result === 'good') {
      sprite(this.textures.parried, p.x, p.y, 1);
      return;
    }
    if (t.result === 'miss') {
      sprite(this.textures.missed, p.x, p.y, 0.9);
      return;
    }
    const discR = TARGET_BAKED_RADIUS * scale;
    const f = leadSec > 0 ? t.timeToHit / leadSec : 0;
    // Only the farthest rings are faded (disc 0.8, ring 0.45); the rest are solid.
    const fade = Math.min(1, Math.max(0, (f - 0.6) / 0.4));
    sprite(this.textures.target[clampNum(t.index)] as Texture, p.x, p.y, 1 - 0.2 * fade);
    const outer = ringRadius(t.timeToHit, leadSec, discR, RING_FAR_FACTOR);
    if (outer !== null) {
      const w = RING_WIDTH * scale;
      this.ringGfx
        .circle(p.x, p.y, outer - w / 2)
        .stroke({ width: w, color: INK_HEX, alpha: 1 - 0.55 * fade });
    }
  }

  /** Red joining line for strikes, dotted order line for targets. Redrawn only when the points change. */
  private drawLine(pts: { x: number; y: number }[], kind: 'strike' | 'order', scale: number): void {
    const key = kind + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(';') + scale.toFixed(3);
    if (key === this.lineKey) return;
    this.lineKey = key;
    const g = this.lineGfx;
    g.clear();
    if (pts.length < 2) return;
    if (kind === 'strike') {
      const first = pts[0] as { x: number; y: number };
      g.moveTo(first.x, first.y);
      for (let i = 1; i < pts.length; i++) g.lineTo((pts[i] as { x: number }).x, (pts[i] as { y: number }).y);
      g.stroke({ width: 7, color: RED_HEX, alpha: 0.9, cap: 'round', join: 'round' });
    } else {
      for (const d of dotsAlong(pts, 14)) g.circle(d.x, d.y, 2);
      g.fill({ color: INK_HEX, alpha: 0.6 });
    }
  }
}
