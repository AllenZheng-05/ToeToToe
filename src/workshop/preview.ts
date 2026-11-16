import { PARTS, PART_SCALE, type PartKind, type Point } from '../puppet/parts';
import { solveRig, type Placement } from '../puppet/rig';

/** Preview canvas size in CSS px (inside the 5px white border of the 376 x 226 frame). */
export const PREVIEW_W = 366;
export const PREVIEW_H = 216;
const SUPERSAMPLE = 2;
/** Preview px per stage design px (the mock draws the preview puppet a little smaller). */
const K = 0.78;
const BASE: Point = { x: 22, y: 246 };
const SWEEP_CENTRE: Point = { x: 326, y: 56 };
const PAD = 8;

interface Baked {
  canvas: HTMLCanvasElement;
  /** Anchor inside the baked canvas. */
  ax: number;
  ay: number;
}

type Anchor = Point;
const ANCHOR: Record<PartKind, Anchor> = {
  head: PARTS.head.pin,
  sock: PARTS.sock.pinA,
  sword: PARTS.sword.handle,
};

function make(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tint(src: HTMLCanvasElement, colour: string): HTMLCanvasElement {
  const c = make(src.width, src.height);
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = colour;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Scale a part to preview size once and bake the white edge and shadow into it (no per-frame filters). */
function bake(src: HTMLCanvasElement, kind: PartKind): Baked {
  const s = PART_SCALE[kind] * K * SUPERSAMPLE;
  const pad = PAD * SUPERSAMPLE;
  const w = Math.ceil(src.width * s) + pad * 2;
  const h = Math.ceil(src.height * s) + pad * 2;
  const scaled = make(w, h);
  const sg = scaled.getContext('2d') as CanvasRenderingContext2D;
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(src, pad, pad, src.width * s, src.height * s);
  const white = tint(scaled, '#ffffff');
  const shadow = tint(scaled, 'rgba(0,0,0,0.28)');
  const out = make(w, h);
  const g = out.getContext('2d') as CanvasRenderingContext2D;
  const edge = 2 * SUPERSAMPLE;
  g.drawImage(shadow, 3 * SUPERSAMPLE, 4 * SUPERSAMPLE);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.drawImage(white, Math.cos(a) * edge, Math.sin(a) * edge);
  }
  g.drawImage(scaled, 0, 0);
  const anchor = ANCHOR[kind];
  return { canvas: out, ax: anchor.x * s + pad, ay: anchor.y * s + pad };
}

export interface PreviewHandle {
  /** Re-bake from the current drawings (call when a stroke ends). */
  update(parts: Record<PartKind, HTMLCanvasElement>): void;
  /** Draw one frame; `now` is a rAF timestamp in ms. */
  frame(now: number): void;
  /** Aim the sword tip at a point in preview px, or null to go back to sweeping. */
  aim(p: Point | null): void;
}

export function createPreview(canvas: HTMLCanvasElement): PreviewHandle {
  canvas.width = PREVIEW_W * SUPERSAMPLE;
  canvas.height = PREVIEW_H * SUPERSAMPLE;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  let baked: Record<PartKind, Baked> | null = null;
  let aimAt: Point | null = null;
  let count: number | undefined;

  function drawPart(b: Baked, p: Placement): void {
    ctx.save();
    ctx.translate(p.x * K * SUPERSAMPLE, p.y * K * SUPERSAMPLE);
    ctx.rotate(p.rotation);
    ctx.scale(p.scaleX, 1);
    ctx.drawImage(b.canvas, -b.ax, -b.ay);
    ctx.restore();
  }

  return {
    update(parts) {
      baked = {
        head: bake(parts.head, 'head'),
        sock: bake(parts.sock, 'sock'),
        sword: bake(parts.sword, 'sword'),
      };
    },
    aim(p) {
      aimAt = p;
    },
    frame(now) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!baked) return;
      const t = now / 1000;
      const tipPx: Point = aimAt ?? {
        x: SWEEP_CENTRE.x + 16 * Math.cos(t * 0.9),
        y: SWEEP_CENTRE.y + 18 * Math.sin(t * 1.35),
      };
      const pose = solveRig({ x: BASE.x / K, y: BASE.y / K }, { x: tipPx.x / K, y: tipPx.y / K }, 1, count);
      count = pose.segmentCount;
      for (const seg of pose.segments) drawPart(baked.sock, seg);
      drawPart(baked.sword, pose.sword);
      drawPart(baked.head, pose.head);
    },
  };
}
