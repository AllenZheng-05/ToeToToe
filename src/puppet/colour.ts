/** Pure colour helpers: which colour a puppet's marks wear. No DOM. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** RGBA pixels as `ImageData.data` lays them out. */
export interface PixelImage {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

/** The brief's yellow, used when a drawing has no usable colour. */
export const FALLBACK_MARK_COLOUR: Rgb = { r: 255, g: 225, b: 77 };
/** Ink and white for numerals (the design's ink and paper-white). */
export const INK_RGB: Rgb = { r: 27, g: 18, b: 16 };
export const WHITE_RGB: Rgb = { r: 255, g: 255, b: 255 };

/** Pixels more transparent than this are ignored. */
const MIN_ALPHA = 128;
/** Outlines and eyes: the brightest channel below this is near-black. */
const NEAR_BLACK = 60;
/** Highlights and paper: the dimmest channel above this is near-white. */
const NEAR_WHITE = 225;
/** Greys: (max - min) / max below this is too unsaturated to be "the colour". */
const MIN_SATURATION = 0.2;
/** Coarse buckets: 4 bits per channel. */
const BUCKET_SHIFT = 4;

/** Two mark colours closer than this in Lab (CIE76 delta E) are hard to tell apart. */
export const MIN_COLOUR_DISTANCE = 40;
/** Hue turns tried, in order, when the opponent's colour has to move away from the local one. */
const HUE_TURNS = [150, -150, 180, 120, -120, 90, -90];
/** Marks that are darker than this (relative luminance) read badly against their ink edge; they are lightened. */
const MIN_LUMINANCE = 0.1;

interface Tally {
  weight: number;
  r: number;
  g: number;
  b: number;
}

function qualifies(r: number, g: number, b: number, a: number): boolean {
  if (a < MIN_ALPHA) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < NEAR_BLACK) return false;
  if (min > NEAR_WHITE) return false;
  if ((max - min) / max < MIN_SATURATION) return false;
  return true;
}

function tallyInto(buckets: Map<number, Tally>, img: PixelImage, weight: number): void {
  const count = Math.min(img.width * img.height, Math.floor(img.pixels.length / 4));
  const p = img.pixels;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const r = p[o] as number;
    const g = p[o + 1] as number;
    const b = p[o + 2] as number;
    if (!qualifies(r, g, b, p[o + 3] as number)) continue;
    const key = ((r >> BUCKET_SHIFT) << 8) | ((g >> BUCKET_SHIFT) << 4) | (b >> BUCKET_SHIFT);
    const t = buckets.get(key);
    if (t) {
      t.weight += weight;
      t.r += r * weight;
      t.g += g * weight;
      t.b += b * weight;
    } else buckets.set(key, { weight, r: r * weight, g: g * weight, b: b * weight });
  }
}

function fullest(buckets: Map<number, Tally>): Rgb | null {
  let best: Tally | null = null;
  for (const t of buckets.values()) if (!best || t.weight > best.weight) best = t;
  if (!best) return null;
  return {
    r: Math.round(best.r / best.weight),
    g: Math.round(best.g / best.weight),
    b: Math.round(best.b / best.weight),
  };
}

/**
 * The most used colour of a drawing (RGBA pixels): transparent, near-black, near-white and grey pixels are
 * ignored, the rest are bucketed coarsely and the mean colour of the fullest bucket is returned.
 * Null when nothing qualifies.
 */
export function dominantColour(pixels: Uint8ClampedArray, width: number, height: number): Rgb | null {
  const buckets = new Map<number, Tally>();
  tallyInto(buckets, { pixels, width, height }, 1);
  return fullest(buckets);
}

/** Weight of the sock's pixels against the head's when finding a puppet's colour. */
const SOCK_WEIGHT = 2;

/** The colour a puppet's marks wear: the dominant colour of its sock and head together (sock first in weight). */
export function puppetMarkColour(parts: { sock: PixelImage; head: PixelImage }): Rgb {
  const buckets = new Map<number, Tally>();
  tallyInto(buckets, parts.sock, SOCK_WEIGHT);
  tallyInto(buckets, parts.head, 1);
  return readable(fullest(buckets) ?? FALLBACK_MARK_COLOUR);
}

// ---------------------------------------------------------------- spaces

function toLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0..1. */
export function luminance(c: Rgb): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
}

/** CIE Lab (D65) of an sRGB colour. */
export function toLab(c: Rgb): { l: number; a: number; b: number } {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const x = labF((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = labF(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = labF((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

/** Perceptual distance (CIE76 delta E) between two colours. About 2 is just noticeable, 40 is clearly different. */
export function colourDistance(a: Rgb, b: Rgb): number {
  const p = toLab(a);
  const q = toLab(b);
  return Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b);
}

function toHsl(c: Rgb): { h: number; s: number; l: number } {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const hh = ((h % 360) + 360) % 360;
  const k = (n: number): number => (n + hh / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

/** Lightens a colour that is too dark to read against an ink edge. */
function readable(c: Rgb): Rgb {
  if (luminance(c) >= MIN_LUMINANCE) return c;
  const mix = (v: number): number => Math.round(v + (255 - v) * 0.4);
  return { r: mix(c.r), g: mix(c.g), b: mix(c.b) };
}

/**
 * The two players' mark colours, adjusted so they can be told apart: if they are closer than
 * MIN_COLOUR_DISTANCE the opponent's hue is turned (the local player keeps their own colour).
 * Returns [local, opponent].
 */
export function distinctColours(local: Rgb, opponent: Rgb): [Rgb, Rgb] {
  if (colourDistance(local, opponent) >= MIN_COLOUR_DISTANCE) return [local, opponent];
  const hsl = toHsl(opponent);
  // A grey-ish colour has no hue worth turning: give it some.
  const s = Math.max(hsl.s, 0.6);
  const l = Math.min(0.62, Math.max(0.42, hsl.l));
  let best = opponent;
  let bestDistance = -1;
  for (const turn of HUE_TURNS) {
    const candidate = fromHsl(hsl.h + turn, s, l);
    const d = colourDistance(local, candidate);
    if (d >= MIN_COLOUR_DISTANCE) return [local, candidate];
    if (d > bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return [local, best];
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Ink or white, whichever reads better as a numeral on a disc of this colour. */
export function inkOrWhite(disc: Rgb): Rgb {
  return contrast(disc, INK_RGB) >= contrast(disc, WHITE_RGB) ? INK_RGB : WHITE_RGB;
}

export function rgbCss(c: Rgb): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

export function rgbHex(c: Rgb): number {
  return (c.r << 16) | (c.g << 8) | c.b;
}

/** Mixes a colour toward white by `amount` (0..1). */
export function lighten(c: Rgb, amount: number): Rgb {
  const mix = (v: number): number => Math.round(v + (255 - v) * amount);
  return { r: mix(c.r), g: mix(c.g), b: mix(c.b) };
}
