import { describe, expect, it } from 'vitest';
import { toPlayArea } from '../../src/input/pointer';

const rect = { left: 100, top: 50, width: 400, height: 200 };

describe('toPlayArea', () => {
  it('maps the centre', () => {
    expect(toPlayArea(300, 150, rect)).toEqual({ x: 0.5, y: 0.5, inside: true });
  });
  it('maps the corners as inside', () => {
    expect(toPlayArea(100, 50, rect)).toEqual({ x: 0, y: 0, inside: true });
    expect(toPlayArea(500, 250, rect)).toEqual({ x: 1, y: 1, inside: true });
  });
  it('does not clamp outside points', () => {
    const r = toPlayArea(0, 350, rect);
    expect(r.inside).toBe(false);
    expect(r.x).toBeCloseTo(-0.25);
    expect(r.y).toBeCloseTo(1.5);
  });
  it('handles a zero-size rect without NaN', () => {
    const r = toPlayArea(10, 10, { left: 0, top: 0, width: 0, height: 0 });
    expect(r.inside).toBe(false);
    expect(Number.isNaN(r.x) || Number.isNaN(r.y)).toBe(false);
  });
});
