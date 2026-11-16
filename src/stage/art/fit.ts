/** Pure geometry helpers for baking stage images. No DOM. */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a source image lands inside a box when it is scaled to cover it (CSS `object-fit: cover`).
 * `alignY` is 0 for top, 0.5 for centre (the default), 1 for bottom (`object-position: center bottom`).
 * The returned rect is relative to the box's top-left and may extend past the box; the excess is cropped.
 */
export function coverRect(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number,
  alignX = 0.5,
  alignY = 0.5,
): Rect {
  const scale = Math.max(boxW / srcW, boxH / srcH);
  const width = srcW * scale;
  const height = srcH * scale;
  return { x: (boxW - width) * alignX, y: (boxH - height) * alignY, width, height };
}

/** Corner tape or any rect rotated about its centre: centre point for a CSS-style left/top box. */
export function boxCentre(
  left: number,
  top: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return { x: left + width / 2, y: top + height / 2 };
}

/**
 * The size at which to draw a mark on screen so that its disc radius is `radiusPx`, given the radius the
 * texture was baked with. Returns the sprite scale.
 */
export function markScale(radiusPx: number, bakedRadius: number): number {
  return bakedRadius > 0 ? radiusPx / bakedRadius : 1;
}

/**
 * Ring closing in on a target: outer radius of the ring for `timeToHit` seconds before the hit.
 * At or after the hit (f <= 0) the ring's outer edge meets the disc edge (`discRadius`); `farFactor` times
 * the disc radius at the start of the lead (`leadSec` before the hit). Null when it has not started yet.
 */
export function ringRadius(
  timeToHit: number,
  leadSec: number,
  discRadius: number,
  farFactor: number,
): number | null {
  if (!(leadSec > 0)) return discRadius;
  const f = timeToHit / leadSec;
  if (f > 1) return null;
  const k = Math.max(0, f);
  return discRadius * (1 + (farFactor - 1) * k);
}

/** Points spaced `spacing` apart along a polyline, starting at its first point. */
export function dotsAlong(
  points: readonly { x: number; y: number }[],
  spacing: number,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const first = points[0];
  if (!first || !(spacing > 0)) return out;
  out.push({ x: first.x, y: first.y });
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as { x: number; y: number };
    const b = points[i] as { x: number; y: number };
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    let d = spacing - carry;
    while (d <= len) {
      const t = d / len;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += spacing;
    }
    carry = len - (d - spacing);
  }
  return out;
}
