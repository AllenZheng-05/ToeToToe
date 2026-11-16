import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { DuelView, PlayerId, TargetView, Tunables } from '../../core/types';
import { inkOrWhite, lighten, rgbCss, rgbHex, type Rgb } from '../../puppet/colour';
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

/** Discs one player's marks use: their colour, with the outline of their side (own, or the opponent's). */
export interface PlayerMarkTextures {
  target: Texture[];
  strike: Texture[];
  newest: Texture[];
  destroy(): void;
}

/** Bumps around a scalloped (opponent) edge. */
const SCALLOPS = 14;

/** A scalloped disc: the radius swings between `rIn` and `rOut` in rounded bumps with notches between them. */
function scalloped(g: CanvasRenderingContext2D, rIn: number, rOut: number, fill: string): void {
  const steps = 240;
  g.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = rIn + (rOut - rIn) * Math.abs(Math.cos((SCALLOPS * a) / 2));
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

function ring(g: CanvasRenderingContext2D, r: number, width: number, stroke: string): void {
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.lineWidth = width;
  g.strokeStyle = stroke;
  g.stroke();
}

function bakePlayerTarget(n: number, colour: Rgb, own: boolean): Texture {
  const [c, g] = discCanvas(TARGET_BAKED_RADIUS);
  const fill = rgbCss(colour);
  const text = rgbCss(inkOrWhite(colour));
  if (own) {
    // The same double ring as the neutral target, in the player's colour.
    circle(g, 44, INK);
    circle(g, 39, fill);
    circle(g, 35, INK);
    circle(g, 32, fill);
    numeral(g, n, 30, text);
  } else {
    // The opponent's: a scalloped ink edge and a single thin inner ring.
    scalloped(g, 38, 44, INK);
    circle(g, 37, fill);
    ring(g, 33, 2.5, INK);
    numeral(g, n, 30, text);
  }
  return canvasTexture(c, RESOLUTION);
}

function bakePlayerStrike(n: number, colour: Rgb, own: boolean, newest: boolean): Texture {
  const inner = newest ? 32 : 27;
  const [c, g] = discCanvas(inner + 3);
  // The newest strike is a lighter shade of the player's colour, and larger.
  const disc = newest ? lighten(colour, 0.35) : colour;
  if (own) {
    circle(g, inner + 3, INK);
    circle(g, inner, '#FFFFFF');
    circle(g, inner - 4, rgbCss(disc));
  } else {
    scalloped(g, inner - 2, inner + 3, INK);
    circle(g, inner - 2, '#FFFFFF');
    circle(g, inner - 6, rgbCss(disc));
  }
  numeral(g, n, newest ? 26 : 22, rgbCss(inkOrWhite(disc)));
  return canvasTexture(c, RESOLUTION);
}

/** Bakes one player's disc textures once, at set-up. `own` is true for the local player's marks. */
export function createPlayerMarkTextures(colour: Rgb, own: boolean): PlayerMarkTextures {
  const nums = [1, 2, 3, 4, 5, 6, 7, 8];
  const t: PlayerMarkTextures = {
    target: nums.map((n) => bakePlayerTarget(n, colour, own)),
    strike: nums.map((n) => bakePlayerStrike(n, colour, own, false)),
    newest: nums.map((n) => bakePlayerStrike(n, colour, own, true)),
    destroy(): void {
      for (const x of [...t.target, ...t.strike, ...t.newest]) x.destroy(true);
    },
  };
  return t;
}

/** Size of the baked spotlight, design px. */
export const SPOTLIGHT = { width: 420, height: 440 } as const;

/**
 * A soft white beam widening toward the ledge with a pool of light at its foot, baked once; tinted per player
 * on a sprite whose anchor is its bottom centre.
 */
export function bakeSpotlight(): Texture {
  const { width: w, height: h } = SPOTLIGHT;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const beam = g.createLinearGradient(0, 0, 0, h);
  beam.addColorStop(0, 'rgba(255,255,255,0)');
  beam.addColorStop(1, 'rgba(255,255,255,0.8)');
  g.fillStyle = beam;
  g.beginPath();
  g.moveTo(w / 2 - 90, 0);
  g.lineTo(w / 2 + 90, 0);
  g.lineTo(w - 10, h - 24);
  g.lineTo(10, h - 24);
  g.closePath();
  g.fill();
  // The pool on the ledge.
  g.save();
  g.translate(w / 2, h - 24);
  g.scale(1, 0.16);
  const pool = g.createRadialGradient(0, 0, 0, 0, 0, w / 2 - 4);
  pool.addColorStop(0, 'rgba(255,255,255,0.95)');
  pool.addColorStop(0.7, 'rgba(255,255,255,0.55)');
  pool.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = pool;
  g.beginPath();
  g.arc(0, 0, w / 2 - 4, 0, Math.PI * 2);
  g.fill();
  g.restore();
  return canvasTexture(c, 1);
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
  private players: [PlayerMarkTextures, PlayerMarkTextures] | null = null;
  private colours: [Rgb, Rgb] | null = null;

  constructor(textures: MarkTextures) {
    this.textures = textures;
    this.container.addChild(this.lineGfx, this.discLayer, this.ringGfx);
  }

  /**
   * Gives each player's marks their own colour and outline (index = PlayerId). The textures are owned by the
   * caller. A mark always wears the colour of the player who planted it, i.e. `view.attacker`.
   */
  setPlayers(sets: [PlayerMarkTextures, PlayerMarkTextures], colours: [Rgb, Rgb]): void {
    this.players = sets;
    this.colours = colours;
    this.lineKey = '';
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
    const planter: PlayerId = view.attacker;
    const set = this.players?.[planter] ?? null;
    const targetTex = set?.target ?? this.textures.target;
    const strikeTex = set?.strike ?? this.textures.strike;
    const newestTex = set?.newest ?? this.textures.newest;
    const colour = this.colours?.[planter] ?? null;

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
      this.drawLine(pts, 'strike', scale, colour);
      // The defender-to-be sees a strike turn into a target, ring closing, as soon as its beat in the
      // coming phrase is within the ring lead, so early slots get the same warning as late ones.
      const slotSec = 60 / bpm / tunables.slotsPerBeat;
      const slotsPerPhrase = tunables.beatsPerPhrase * tunables.slotsPerBeat;
      const leadSec = (opts.ringLeadBeats ?? tunables.ringLeadBeats) * (60 / bpm);
      pts.forEach((p, i) => {
        const strike = view.strikes[i] as DuelView['strikes'][number];
        const timeToHit = (slotsPerPhrase - view.slotPosition + strike.slot) * slotSec;
        if (!view.localActive && timeToHit <= leadSec) {
          this.drawTarget(
            { index: i, strike, timeToHit, result: null },
            p,
            leadSec,
            scale,
            sprite,
            targetTex,
          );
          return;
        }
        const newest = i === pts.length - 1;
        const tex = (newest ? newestTex : strikeTex)[clampNum(i)] as Texture;
        sprite(tex, p.x, p.y, 1);
      });
    } else if (view.phase === 'defend' && view.targets.length > 0) {
      const leadSec = (opts.ringLeadBeats ?? tunables.ringLeadBeats) * (60 / bpm);
      const pts = view.targets.map((t) => playToDesign(t.strike.x, t.strike.y));
      this.drawLine(pts, 'order', scale, colour);
      view.targets.forEach((t, i) => {
        const p = pts[i] as { x: number; y: number };
        this.drawTarget(t, p, leadSec, scale, sprite, targetTex);
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
    targets: Texture[],
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
    sprite(targets[clampNum(t.index)] as Texture, p.x, p.y, 1 - 0.2 * fade);
    const outer = ringRadius(t.timeToHit, leadSec, discR, RING_FAR_FACTOR);
    if (outer !== null) {
      const w = RING_WIDTH * scale;
      this.ringGfx
        .circle(p.x, p.y, outer - w / 2)
        .stroke({ width: w, color: INK_HEX, alpha: 1 - 0.55 * fade });
    }
  }

  /** Joining line for strikes, dotted order line for targets, in the planter's colour. Redrawn only when the points or colour change. */
  private drawLine(
    pts: { x: number; y: number }[],
    kind: 'strike' | 'order',
    scale: number,
    colour: Rgb | null,
  ): void {
    const key =
      kind +
      (colour ? rgbCss(colour) : '') +
      pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(';') +
      scale.toFixed(3);
    if (key === this.lineKey) return;
    this.lineKey = key;
    const g = this.lineGfx;
    g.clear();
    if (pts.length < 2) return;
    const hex = colour ? rgbHex(colour) : kind === 'strike' ? RED_HEX : INK_HEX;
    if (kind === 'strike') {
      const first = pts[0] as { x: number; y: number };
      const trace = (): void => {
        g.moveTo(first.x, first.y);
        for (let i = 1; i < pts.length; i++)
          g.lineTo((pts[i] as { x: number }).x, (pts[i] as { y: number }).y);
      };
      // An ink edge under the colour keeps the line readable on sky and curtain.
      trace();
      g.stroke({ width: 11, color: INK_HEX, alpha: 0.55, cap: 'round', join: 'round' });
      trace();
      g.stroke({ width: 7, color: hex, alpha: 0.95, cap: 'round', join: 'round' });
    } else {
      const dots = dotsAlong(pts, 14);
      for (const d of dots) g.circle(d.x, d.y, 4);
      g.fill({ color: INK_HEX, alpha: 0.5 });
      for (const d of dots) g.circle(d.x, d.y, 2.6);
      g.fill({ color: hex, alpha: 1 });
    }
  }
}
