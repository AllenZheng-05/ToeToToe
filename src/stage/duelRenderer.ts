import { Container, Graphics, Text } from 'pixi.js';
import type { DuelView, PlayerId, Strike, Tunables } from '../core/types';
import { DESIGN_H, DESIGN_W, PLAY_RECT, playToDesign } from './layout';

const INK = 0x1b1210;
const PAPER = 0xfffdf5;
const YELLOW = 0xffe14d;
const RED = 0xd42a40;
const BLUE = 0x2456c8;
const PINK = 0xf48fb1;
const PARRIED = 0x7bc67b;
const GREY = 0x9a948a;

const BACKDROP = 0xf3ecd2;
const PLAY_FILL = 0xe6dcb8;
const LEDGE = 0xc9a36b;

/** Where each puppet's base sits on the ledge, in design pixels. */
export const PUPPET_BASE: readonly [{ x: number; y: number }, { x: number; y: number }] = [
  { x: 310, y: 640 },
  { x: 970, y: 640 },
];
const PUPPET_COLOURS = [PINK, BLUE] as const;
/** Sword tip when nothing else is going on. */
const REST_TIP: readonly [{ x: number; y: number }, { x: number; y: number }] = [
  { x: 420, y: 500 },
  { x: 860, y: 500 },
];
/** How fast the opponent's tip eases toward its focus, per second. */
const EASE_RATE = 10;
/** Approach ring starts this many beats before the hit and begins at this multiple of the disc radius. */
const APPROACH_BEATS = 1;
const APPROACH_START_SCALE = 3.2;

const FONT = '"Courier New", monospace';

/**
 * Draws a DuelView with plain shapes. Holds no rules: it only reads the view.
 * Graphics and Text objects are created once and reused every frame.
 */
export class DuelRenderer {
  private readonly layer = new Container();
  private readonly backdrop = new Graphics();
  private readonly dynamic = new Graphics();
  private readonly labels: Text[] = [];
  private readonly beatSeconds: number;
  private readonly tun: Tunables;

  private pointer: { x: number; y: number } | null = null;
  private focus: { x: number; y: number } | null = null;
  private tips: [{ x: number; y: number }, { x: number; y: number }] = [
    { ...REST_TIP[0] },
    { ...REST_TIP[1] },
  ];

  constructor(parent: Container, tunables: Tunables, bpm: number) {
    this.tun = tunables;
    this.beatSeconds = 60 / bpm;
    this.drawBackdrop();
    this.layer.addChild(this.backdrop, this.dynamic);
    parent.addChild(this.layer);
  }

  /** Local pointer position in design pixels, or null when unknown. */
  setPointer(p: { x: number; y: number } | null): void {
    this.pointer = p;
  }

  /** The opponent's tip eases toward this play-area point (fractions). */
  setOpponentFocus(strike: Pick<Strike, 'x' | 'y'>): void {
    this.focus = playToDesign(strike.x, strike.y);
  }

  draw(view: DuelView, dtSec: number): void {
    const g = this.dynamic;
    g.clear();
    let used = 0;

    const label = (text: string, x: number, y: number, size: number, fill: number): void => {
      let t = this.labels[used];
      if (!t) {
        t = new Text({ text, style: { fontFamily: FONT, fontSize: size, fontWeight: 'bold', fill } });
        t.anchor.set(0.5);
        this.labels.push(t);
        this.layer.addChild(t);
      }
      if (t.text !== text) t.text = text;
      if (t.style.fontSize !== size) t.style.fontSize = size;
      if (t.style.fill !== fill) t.style.fill = fill;
      t.position.set(x, y);
      t.visible = true;
      used++;
    };

    const radius = this.tun.targetRadius * PLAY_RECT.width;

    if (view.phase === 'defend') {
      for (const target of view.targets) {
        const p = playToDesign(target.strike.x, target.strike.y);
        const label1 = String(target.index + 1);
        if (target.result === 'bravo' || target.result === 'good') {
          g.circle(p.x, p.y, radius).fill(PARRIED).stroke({ width: 3, color: INK });
          g.moveTo(p.x - radius * 0.45, p.y)
            .lineTo(p.x - radius * 0.1, p.y + radius * 0.4)
            .lineTo(p.x + radius * 0.5, p.y - radius * 0.4)
            .stroke({ width: 5, color: INK, cap: 'round', join: 'round' });
        } else if (target.result === 'miss') {
          g.circle(p.x, p.y, radius).fill(GREY).stroke({ width: 3, color: INK });
          const k = radius * 0.5;
          g.moveTo(p.x - k, p.y - k)
            .lineTo(p.x + k, p.y + k)
            .moveTo(p.x + k, p.y - k)
            .lineTo(p.x - k, p.y + k)
            .stroke({ width: 5, color: RED, cap: 'round' });
        } else {
          g.circle(p.x, p.y, radius).fill(YELLOW).stroke({ width: 3, color: INK });
          label(label1, p.x, p.y, Math.round(radius * 0.9), INK);
          const lead = target.timeToHit / (this.beatSeconds * APPROACH_BEATS);
          if (lead > 0 && lead <= 1) {
            const r = radius * (1 + (APPROACH_START_SCALE - 1) * lead);
            g.circle(p.x, p.y, r).stroke({ width: 3, color: INK });
          }
        }
      }
    } else if (view.phase === 'attack' && view.strikes.length > 0) {
      const pts = view.strikes.map((s) => playToDesign(s.x, s.y));
      if (pts.length > 1) {
        const first = pts[0];
        if (first) g.moveTo(first.x, first.y);
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i];
          if (p) g.lineTo(p.x, p.y);
        }
        g.stroke({ width: 4, color: RED });
      }
      pts.forEach((p, i) => {
        const newest = i === pts.length - 1;
        g.circle(p.x, p.y, radius)
          .fill(newest ? YELLOW : RED)
          .stroke({ width: 3, color: INK });
        label(String(i + 1), p.x, p.y, Math.round(radius * 0.9), newest ? INK : PAPER);
      });
    }

    for (let i = used; i < this.labels.length; i++) {
      const t = this.labels[i];
      if (t) t.visible = false;
    }

    this.drawPuppets(g, view.localPlayer, dtSec);
  }

  destroy(): void {
    this.layer.destroy({ children: true });
  }

  private drawPuppets(g: Graphics, local: PlayerId, dtSec: number): void {
    const opp: PlayerId = local === 0 ? 1 : 0;
    const k = 1 - Math.exp(-EASE_RATE * Math.max(0, dtSec));
    const target = this.focus ?? REST_TIP[opp];
    const tipO = this.tips[opp];
    tipO.x += (target.x - tipO.x) * k;
    tipO.y += (target.y - tipO.y) * k;

    const tipL = this.tips[local];
    const pointer = this.pointer;
    if (pointer) {
      tipL.x = Math.min(DESIGN_W, Math.max(0, pointer.x));
      tipL.y = Math.min(DESIGN_H, Math.max(0, pointer.y));
    } else {
      tipL.x = REST_TIP[local].x;
      tipL.y = REST_TIP[local].y;
    }

    for (const id of [0, 1] as const) {
      const base = PUPPET_BASE[id];
      const tip = this.tips[id];
      g.moveTo(base.x, base.y).lineTo(tip.x, tip.y).stroke({ width: 16, color: INK, cap: 'round' });
      g.moveTo(base.x, base.y)
        .lineTo(tip.x, tip.y)
        .stroke({ width: 9, color: PUPPET_COLOURS[id], cap: 'round' });
      g.circle(base.x, base.y, 26).fill(PUPPET_COLOURS[id]).stroke({ width: 4, color: INK });
      g.circle(tip.x, tip.y, 6).fill(PAPER).stroke({ width: 2, color: INK });
    }
  }

  private drawBackdrop(): void {
    const b = this.backdrop;
    b.rect(34, 30, 1212, 665).fill(BACKDROP);
    b.rect(PLAY_RECT.x, PLAY_RECT.y, PLAY_RECT.width, PLAY_RECT.height)
      .fill(PLAY_FILL)
      .stroke({ width: 3, color: INK });
    b.rect(34, 603, 1212, 92).fill(LEDGE);
    b.moveTo(34, 603).lineTo(1246, 603).stroke({ width: 5, color: 0xffffff });
  }
}
