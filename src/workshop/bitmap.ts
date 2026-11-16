/** Pure RGBA bitmap operations for the workshop. No DOM: works on anything shaped like ImageData. */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type Rgba = [number, number, number, number];

export function createBitmap(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneBitmap(b: Bitmap): Bitmap {
  return { width: b.width, height: b.height, data: new Uint8ClampedArray(b.data) };
}

function setPixel(b: Bitmap, x: number, y: number, c: Rgba): void {
  const i = (y * b.width + x) * 4;
  b.data[i] = c[0];
  b.data[i + 1] = c[1];
  b.data[i + 2] = c[2];
  b.data[i + 3] = c[3];
}

/** Stamp a filled, hard-edged circle (no anti-aliasing, so fill works cleanly). */
export function stampCircle(b: Bitmap, cx: number, cy: number, radius: number, color: Rgba): void {
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(radius)) return;
  const r = Math.max(0.5, radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(b.width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(b.height - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= r2) setPixel(b, x, y, color);
    }
  }
}

/** A brush stroke segment: circles stamped along the line so there are no gaps. color [0,0,0,0] erases. */
export function strokeLine(
  b: Bitmap,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  color: Rgba,
): void {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  if (!Number.isFinite(dist)) return;
  const step = Math.max(0.5, Math.min(1, radius / 2));
  const n = Math.max(1, Math.ceil(dist / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    stampCircle(b, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, color);
  }
}

/** Scanline flood fill from (x, y) over the contiguous region of the exact same RGBA as the start pixel. */
export function floodFill(b: Bitmap, x: number, y: number, color: Rgba): void {
  x = Math.floor(x);
  y = Math.floor(y);
  if (!(x >= 0 && y >= 0 && x < b.width && y < b.height)) return;
  const { width, height, data } = b;
  const start = (y * width + x) * 4;
  const tr = data[start] as number;
  const tg = data[start + 1] as number;
  const tb = data[start + 2] as number;
  const ta = data[start + 3] as number;
  if (tr === color[0] && tg === color[1] && tb === color[2] && ta === color[3]) return;
  const matches = (i: number): boolean =>
    data[i] === tr && data[i + 1] === tg && data[i + 2] === tb && data[i + 3] === ta;
  const stack: number[] = [x, y];
  while (stack.length > 0) {
    const sy = stack.pop() as number;
    const sx = stack.pop() as number;
    if (!matches((sy * width + sx) * 4)) continue;
    let left = sx;
    while (left > 0 && matches((sy * width + left - 1) * 4)) left--;
    let right = sx;
    while (right < width - 1 && matches((sy * width + right + 1) * 4)) right++;
    for (let px = left; px <= right; px++) setPixel(b, px, sy, color);
    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= height) continue;
      let inRun = false;
      for (let px = left; px <= right; px++) {
        const m = matches((ny * width + px) * 4);
        if (m && !inRun) stack.push(px, ny);
        inRun = m;
      }
    }
  }
}

export function isBlank(b: Bitmap): boolean {
  for (let i = 3; i < b.data.length; i += 4) if (b.data[i] !== 0) return false;
  return true;
}
