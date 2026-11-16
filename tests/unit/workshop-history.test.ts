import { describe, expect, it } from 'vitest';
import { createBitmap, type Bitmap } from '../../src/workshop/bitmap';
import { History } from '../../src/workshop/history';
import { BRUSH_SIZES, PALETTE } from '../../src/workshop/palette';

function mark(v: number): Bitmap {
  const b = createBitmap(2, 2);
  b.data[0] = v;
  return b;
}
const v = (b: Bitmap | null): number | undefined => b?.data[0];

describe('History', () => {
  it('undoes and redoes in order', () => {
    const h = new History();
    let cur = mark(0);
    h.push(cur);
    cur = mark(1);
    h.push(cur);
    cur = mark(2);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
    cur = h.undo(cur) as Bitmap;
    expect(v(cur)).toBe(1);
    cur = h.undo(cur) as Bitmap;
    expect(v(cur)).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.undo(cur)).toBeNull();
    cur = h.redo(cur) as Bitmap;
    expect(v(cur)).toBe(1);
    cur = h.redo(cur) as Bitmap;
    expect(v(cur)).toBe(2);
    expect(h.redo(cur)).toBeNull();
    expect(h.canRedo).toBe(false);
  });

  it('clears redo on a new push', () => {
    const h = new History();
    h.push(mark(0));
    const back = h.undo(mark(1)) as Bitmap;
    expect(h.canRedo).toBe(true);
    h.push(back);
    expect(h.canRedo).toBe(false);
    expect(h.redo(mark(5))).toBeNull();
  });

  it('caps the number of steps', () => {
    const h = new History(3);
    for (let i = 0; i < 10; i++) h.push(mark(i));
    let cur = mark(99);
    const seen: number[] = [];
    for (;;) {
      const prev = h.undo(cur);
      if (!prev) break;
      seen.push(v(prev) as number);
      cur = prev;
    }
    expect(seen).toEqual([9, 8, 7]);
  });

  it('defaults to thirty steps', () => {
    const h = new History();
    for (let i = 0; i < 40; i++) h.push(mark(i));
    let n = 0;
    let cur = mark(0);
    while (h.canUndo) {
      cur = h.undo(cur) as Bitmap;
      n++;
    }
    expect(n).toBe(30);
  });

  it('stores independent copies', () => {
    const h = new History();
    const b = mark(7);
    h.push(b);
    b.data[0] = 200;
    const cur = mark(1);
    const prev = h.undo(cur) as Bitmap;
    expect(v(prev)).toBe(7);
    cur.data[0] = 123;
    expect(v(h.redo(prev))).toBe(1);
  });

  it('clear empties both stacks', () => {
    const h = new History();
    h.push(mark(1));
    h.undo(mark(2));
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});

describe('palette', () => {
  it('has twelve distinct valid colours', () => {
    expect(PALETTE).toHaveLength(12);
    for (const c of PALETTE) expect(c).toMatch(/^#[0-9A-F]{6}$/);
    expect(new Set(PALETTE).size).toBe(12);
  });
  it('has three increasing brush sizes', () => {
    expect(BRUSH_SIZES[0]).toBeLessThan(BRUSH_SIZES[1]);
    expect(BRUSH_SIZES[1]).toBeLessThan(BRUSH_SIZES[2]);
  });
});
