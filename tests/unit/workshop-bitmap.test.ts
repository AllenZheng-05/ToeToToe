import { describe, expect, it } from 'vitest';
import {
  cloneBitmap,
  createBitmap,
  floodFill,
  isBlank,
  stampCircle,
  strokeLine,
  type Bitmap,
  type Rgba,
} from '../../src/workshop/bitmap';

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

function px(b: Bitmap, x: number, y: number): number[] {
  const i = (y * b.width + x) * 4;
  return [b.data[i] as number, b.data[i + 1] as number, b.data[i + 2] as number, b.data[i + 3] as number];
}
/** Fill exactly pixel (x, y): its centre is at +0.5. */
function dot(b: Bitmap, x: number, y: number): void {
  stampCircle(b, x + 0.5, y + 0.5, 0.5, RED);
}
function alpha(b: Bitmap, x: number, y: number): number {
  return px(b, x, y)[3] as number;
}

describe('createBitmap / cloneBitmap / isBlank', () => {
  it('starts transparent and clones independently', () => {
    const b = createBitmap(10, 8);
    expect(b.data.length).toBe(320);
    expect(isBlank(b)).toBe(true);
    const c = cloneBitmap(b);
    stampCircle(c, 5, 4, 2, RED);
    expect(isBlank(c)).toBe(false);
    expect(isBlank(b)).toBe(true);
  });
});

describe('stampCircle', () => {
  it('fills a hard-edged disc with only the given colour or transparency', () => {
    const b = createBitmap(40, 40);
    stampCircle(b, 20, 20, 8, RED);
    expect(px(b, 20, 20)).toEqual([255, 0, 0, 255]);
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        const a = alpha(b, x, y);
        expect(a === 0 || a === 255).toBe(true);
        const inside = (x + 0.5 - 20) ** 2 + (y + 0.5 - 20) ** 2 <= 64;
        expect(a === 255).toBe(inside);
      }
    }
  });

  it('stays inside the bitmap when stamped over an edge or off-canvas', () => {
    const b = createBitmap(20, 20);
    stampCircle(b, 0, 0, 6, RED);
    stampCircle(b, 19, 19, 6, RED);
    stampCircle(b, -50, 5, 6, RED);
    stampCircle(b, 5, 500, 6, RED);
    expect(alpha(b, 0, 0)).toBe(255);
    expect(alpha(b, 19, 19)).toBe(255);
    expect(alpha(b, 10, 10)).toBe(0);
    expect(b.data.length).toBe(1600);
  });

  it('ignores non-finite input', () => {
    const b = createBitmap(10, 10);
    stampCircle(b, NaN, 3, 3, RED);
    expect(isBlank(b)).toBe(true);
  });
});

describe('strokeLine', () => {
  function connected(b: Bitmap): boolean {
    const seen = new Set<number>();
    let total = 0;
    let first = -1;
    for (let i = 0; i < b.width * b.height; i++) {
      if (b.data[i * 4 + 3] !== 0) {
        total++;
        if (first < 0) first = i;
      }
    }
    const stack = [first];
    while (stack.length) {
      const i = stack.pop() as number;
      if (seen.has(i) || b.data[i * 4 + 3] === 0) continue;
      seen.add(i);
      const x = i % b.width;
      const y = Math.floor(i / b.width);
      if (x > 0) stack.push(i - 1);
      if (x < b.width - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - b.width);
      if (y < b.height - 1) stack.push(i + b.width);
    }
    return seen.size === total;
  }

  it('leaves no gaps on a diagonal with a tiny brush', () => {
    const b = createBitmap(100, 100);
    strokeLine(b, 3, 3, 95, 90, 1, RED);
    expect(connected(b)).toBe(true);
    expect(alpha(b, 3, 3)).toBe(255);
    expect(alpha(b, 95, 90)).toBe(255);
  });

  it('leaves no gaps on a long line', () => {
    const b = createBitmap(320, 240);
    strokeLine(b, 2, 120, 317, 121, 2, RED);
    expect(connected(b)).toBe(true);
    for (let x = 2; x <= 317; x++) expect(alpha(b, x, 120)).toBe(255);
  });

  it('draws a dot for a zero-length segment', () => {
    const b = createBitmap(20, 20);
    strokeLine(b, 10, 10, 10, 10, 3, RED);
    expect(alpha(b, 10, 10)).toBe(255);
  });

  it('erases to fully transparent pixels', () => {
    const b = createBitmap(60, 40);
    strokeLine(b, 5, 20, 55, 20, 6, BLUE);
    strokeLine(b, 30, 5, 30, 35, 4, CLEAR);
    expect(px(b, 30, 20)).toEqual([0, 0, 0, 0]);
    expect(px(b, 10, 20)).toEqual([0, 0, 255, 255]);
  });
});

describe('floodFill', () => {
  function box(b: Bitmap, x0: number, y0: number, x1: number, y1: number): void {
    for (let x = x0; x <= x1; x++) {
      dot(b, x, y0);
      dot(b, x, y1);
    }
    for (let y = y0; y <= y1; y++) {
      dot(b, x0, y);
      dot(b, x1, y);
    }
  }

  it('fills an enclosed region without leaking', () => {
    const b = createBitmap(40, 40);
    box(b, 10, 10, 30, 30);
    floodFill(b, 20, 20, BLUE);
    expect(px(b, 20, 20)).toEqual([0, 0, 255, 255]);
    expect(px(b, 11, 11)).toEqual([0, 0, 255, 255]);
    expect(px(b, 29, 29)).toEqual([0, 0, 255, 255]);
    expect(px(b, 10, 10)).toEqual([255, 0, 0, 255]);
    expect(px(b, 5, 5)).toEqual([0, 0, 0, 0]);
    expect(px(b, 35, 20)).toEqual([0, 0, 0, 0]);
  });

  it('fills the outside of a closed shape and leaves the inside alone', () => {
    const b = createBitmap(40, 40);
    box(b, 10, 10, 30, 30);
    floodFill(b, 2, 2, BLUE);
    expect(px(b, 39, 39)).toEqual([0, 0, 255, 255]);
    expect(px(b, 20, 20)).toEqual([0, 0, 0, 0]);
  });

  it('fills the whole canvas when nothing blocks it', () => {
    const b = createBitmap(30, 20);
    floodFill(b, 0, 0, BLUE);
    for (let i = 0; i < 600; i++) expect(b.data[i * 4 + 2]).toBe(255);
    expect(isBlank(b)).toBe(false);
  });

  it('does not cross a diagonal wall', () => {
    const b = createBitmap(20, 20);
    for (let i = 0; i < 20; i++) dot(b, i, i);
    floodFill(b, 15, 2, BLUE);
    expect(px(b, 15, 2)).toEqual([0, 0, 255, 255]);
    expect(px(b, 2, 15)).toEqual([0, 0, 0, 0]);
  });

  it('respects exact colour match', () => {
    const b = createBitmap(20, 20);
    floodFill(b, 0, 0, [10, 10, 10, 255]);
    stampCircle(b, 10, 10, 3, [11, 10, 10, 255]);
    floodFill(b, 0, 0, BLUE);
    expect(px(b, 10, 10)).toEqual([11, 10, 10, 255]);
    expect(px(b, 1, 1)).toEqual([0, 0, 255, 255]);
  });

  it('is a no-op on the same colour and out of bounds', () => {
    const b = createBitmap(10, 10);
    const before = new Uint8ClampedArray(b.data);
    floodFill(b, 3, 3, CLEAR);
    floodFill(b, -1, 3, BLUE);
    floodFill(b, 3, 10, BLUE);
    floodFill(b, 10, 3, BLUE);
    floodFill(b, NaN, 3, BLUE);
    expect(b.data).toEqual(before);
  });

  it('fills a full 320x240 canvas quickly without recursion', () => {
    const b = createBitmap(320, 240);
    const t = Date.now();
    floodFill(b, 100, 100, BLUE);
    expect(Date.now() - t).toBeLessThan(500);
    expect(b.data[(239 * 320 + 319) * 4 + 3]).toBe(255);
  });

  it('handles a serpentine region', () => {
    const b = createBitmap(100, 100);
    for (let y = 2; y < 100; y += 4) {
      for (let x = 0; x < 100; x++) {
        const gap = (y - 2) % 8 === 0 ? x > 95 : x < 4;
        if (!gap) dot(b, x, y);
      }
    }
    floodFill(b, 0, 0, BLUE);
    expect(px(b, 50, 99)).toEqual([0, 0, 255, 255]);
  });
});
