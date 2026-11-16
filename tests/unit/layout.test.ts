import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNABLES } from '../../src/core/tunables';
import {
  DESIGN_H,
  DESIGN_W,
  PLAY_RECT,
  fitStage,
  playRectOnScreen,
  playToDesign,
} from '../../src/stage/layout';

describe('fitStage', () => {
  it('fits an exact window with no offset', () => {
    expect(fitStage(1280, 720)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
    expect(fitStage(640, 360)).toEqual({ scale: 0.5, offsetX: 0, offsetY: 0 });
  });

  it('letterboxes a wide window sideways', () => {
    const f = fitStage(2000, 720);
    expect(f.scale).toBe(1);
    expect(f.offsetX).toBe(360);
    expect(f.offsetY).toBe(0);
  });

  it('letterboxes a tall window top and bottom', () => {
    const f = fitStage(1280, 1000);
    expect(f.scale).toBe(1);
    expect(f.offsetX).toBe(0);
    expect(f.offsetY).toBe(140);
  });

  it('keeps the design centred inside the window', () => {
    for (const [w, h] of [
      [1920, 1080],
      [800, 600],
      [3000, 500],
      [500, 3000],
    ] as const) {
      const f = fitStage(w, h);
      expect(f.offsetX).toBeGreaterThanOrEqual(0);
      expect(f.offsetY).toBeGreaterThanOrEqual(0);
      expect(f.offsetX * 2 + DESIGN_W * f.scale).toBeCloseTo(w);
      expect(f.offsetY * 2 + DESIGN_H * f.scale).toBeCloseTo(h);
    }
  });

  it('survives a zero-sized window', () => {
    const f = fitStage(0, 0);
    expect(Number.isFinite(f.scale)).toBe(true);
    expect(f.scale).toBeGreaterThan(0);
  });
});

describe('playRectOnScreen', () => {
  it('equals the design rect at scale 1', () => {
    expect(playRectOnScreen({ scale: 1, offsetX: 0, offsetY: 0 })).toEqual({
      left: PLAY_RECT.x,
      top: PLAY_RECT.y,
      width: PLAY_RECT.width,
      height: PLAY_RECT.height,
    });
  });

  it('applies scale and offset', () => {
    const r = playRectOnScreen({ scale: 0.5, offsetX: 10, offsetY: 20 });
    expect(r).toEqual({ left: 110, top: 101.5, width: 440, height: 220 });
  });
});

describe('PLAY_RECT', () => {
  it('has the tunable aspect', () => {
    expect(PLAY_RECT.width / PLAY_RECT.height).toBe(DEFAULT_TUNABLES.playAreaAspect);
  });

  it('lies inside the design', () => {
    expect(PLAY_RECT.x + PLAY_RECT.width).toBeLessThanOrEqual(DESIGN_W);
    expect(PLAY_RECT.y + PLAY_RECT.height).toBeLessThanOrEqual(DESIGN_H);
  });
});

describe('playToDesign', () => {
  it('maps corners and centre', () => {
    expect(playToDesign(0, 0)).toEqual({ x: 200, y: 163 });
    expect(playToDesign(1, 1)).toEqual({ x: 1080, y: 603 });
    expect(playToDesign(0.5, 0.5)).toEqual({ x: 640, y: 383 });
  });
});
