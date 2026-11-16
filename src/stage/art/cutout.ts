import { CanvasSource, Texture } from 'pixi.js';

/** Which edges get the white scissor outline. All true by default. */
export interface CutoutSides {
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
}

export interface CutoutOptions {
  /** White scissor edge, px. Default 3. */
  outline?: number;
  /** Default 5. */
  shadowX?: number;
  /** Default 6. */
  shadowY?: number;
  /** Default 0.28. */
  shadowAlpha?: number;
  /**
   * Resample the source by this factor before baking: the box on screen is `width * scale` by
   * `height * scale` design px. Default 1.
   */
  scale?: number;
  /** Texture pixels per design pixel (sharpness on large screens). Default 1. */
  resolution?: number;
  /** Edges that get an outline. The curtains have none on top, the valance only below. */
  sides?: CutoutSides;
}

export interface Padding {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Resolved {
  outline: number;
  shadowX: number;
  shadowY: number;
  shadowAlpha: number;
  scale: number;
  resolution: number;
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

function resolve(o: CutoutOptions = {}): Resolved {
  const s = o.sides ?? {};
  return {
    outline: Math.max(0, o.outline ?? 3),
    shadowX: o.shadowX ?? 5,
    shadowY: o.shadowY ?? 6,
    shadowAlpha: o.shadowAlpha ?? 0.28,
    scale: o.scale ?? 1,
    resolution: o.resolution ?? 1,
    top: s.top ?? true,
    right: s.right ?? true,
    bottom: s.bottom ?? true,
    left: s.left ?? true,
  };
}

/**
 * Pure geometry: how much the baked canvas grows on each side, in design px (not multiplied by
 * `resolution`), so sprites can be positioned by the original image's box: place the sprite at
 * (boxLeft - left, boxTop - top).
 */
export function cutoutPadding(o?: CutoutOptions): Padding {
  const r = resolve(o);
  return {
    left: (r.left ? r.outline : 0) + Math.max(0, -r.shadowX),
    top: (r.top ? r.outline : 0) + Math.max(0, -r.shadowY),
    right: (r.right ? r.outline : 0) + Math.max(0, r.shadowX),
    bottom: (r.bottom ? r.outline : 0) + Math.max(0, r.shadowY),
  };
}

/** Offsets (design px) around the origin that, stamped together, dilate a shape by `radius`. */
export function outlineOffsets(
  radius: number,
  sides: { top: boolean; right: boolean; bottom: boolean; left: boolean },
  resolution = 1,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  if (!(radius > 0)) return out;
  const eps = 1e-6;
  const rings = Math.max(1, Math.ceil((radius * resolution) / 1.5));
  for (let k = 1; k <= rings; k++) {
    const r = (radius * k) / rings;
    // A multiple of 4 so the axis directions (straight down, left, ...) are always sampled.
    const steps = Math.ceil(Math.max(16, 2 * Math.PI * r * resolution) / 4) * 4;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (x > eps && !sides.right) continue;
      if (x < -eps && !sides.left) continue;
      if (y > eps && !sides.bottom) continue;
      if (y < -eps && !sides.top) continue;
      out.push({ x, y });
    }
  }
  return out;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** A copy of `src` with every opaque pixel replaced by `colour`, keeping the alpha. */
function silhouette(src: HTMLCanvasElement, colour: string): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = colour;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/**
 * Bakes the cutout treatment once on an offscreen canvas: hard shadow (no blur), solid white outline
 * following the alpha edge, then the image. `width` and `height` are the source's size; the image is
 * resampled by `scale`. The canvas is `(width * scale + padding) * resolution` pixels. For opaque
 * rectangles (JPEG) the outline is a white border.
 */
export function bakeCutout(
  source: CanvasImageSource,
  width: number,
  height: number,
  o?: CutoutOptions,
): HTMLCanvasElement {
  const r = resolve(o);
  const pad = cutoutPadding(o);
  const res = r.resolution;
  const boxW = width * r.scale;
  const boxH = height * r.scale;
  const cw = Math.ceil((boxW + pad.left + pad.right) * res);
  const ch = Math.ceil((boxH + pad.top + pad.bottom) * res);

  const sil = makeCanvas(cw, ch);
  const sg = sil.getContext('2d') as CanvasRenderingContext2D;
  sg.imageSmoothingEnabled = true;
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(source, pad.left * res, pad.top * res, boxW * res, boxH * res);

  const white = silhouette(sil, '#ffffff');
  const dilated = makeCanvas(cw, ch);
  const dg = dilated.getContext('2d') as CanvasRenderingContext2D;
  for (const off of outlineOffsets(r.outline, r, res)) {
    dg.drawImage(white, off.x * res, off.y * res);
  }

  const out = makeCanvas(cw, ch);
  const g = out.getContext('2d') as CanvasRenderingContext2D;
  if (r.shadowAlpha > 0 && (r.shadowX !== 0 || r.shadowY !== 0 || r.outline > 0)) {
    g.globalAlpha = r.shadowAlpha;
    g.drawImage(silhouette(dilated, '#000000'), r.shadowX * res, r.shadowY * res);
    g.globalAlpha = 1;
  }
  g.drawImage(dilated, 0, 0);
  g.drawImage(sil, 0, 0);
  return out;
}

/** Wraps a canvas as a Pixi texture that appears `1 / resolution` times its pixel size. */
export function canvasTexture(canvas: HTMLCanvasElement, resolution = 1): Texture {
  return new Texture({ source: new CanvasSource({ resource: canvas, resolution }) });
}

/** Convenience: bake and wrap in a Pixi Texture. Its logical size is the baked canvas over `resolution`. */
export function cutoutTexture(
  source: CanvasImageSource,
  width: number,
  height: number,
  o?: CutoutOptions,
): Texture {
  return canvasTexture(bakeCutout(source, width, height, o), o?.resolution ?? 1);
}
