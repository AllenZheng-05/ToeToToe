import { describe, expect, it } from 'vitest';
import { DESIGN_H, DESIGN_W, fitStage, MAX_UI_SCALE, touchSizes } from '../../src/stage/layout';

describe('fitStage with safe-area insets', () => {
  it('is unchanged without insets', () => {
    expect(fitStage(1280, 720)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });

  it('fits the stage inside a notch on the sides of a landscape phone', () => {
    const f = fitStage(844, 390, { top: 0, right: 47, bottom: 21, left: 47 });
    // 750 x 369 usable: the height limits it.
    expect(f.scale).toBeCloseTo(369 / DESIGN_H, 6);
    expect(f.offsetX).toBeGreaterThanOrEqual(47);
    expect(f.offsetX + DESIGN_W * f.scale).toBeLessThanOrEqual(844 - 47 + 1e-6);
    expect(f.offsetY + DESIGN_H * f.scale).toBeLessThanOrEqual(390 - 21 + 1e-6);
  });

  it('ignores nonsense insets', () => {
    expect(fitStage(1280, 720, { top: -5, right: -1, bottom: -9, left: -2 })).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  });
});

describe('touchSizes', () => {
  it('keeps a 44 px tap target at full size or larger', () => {
    expect(touchSizes(1)).toEqual({ tap: 44, uiScale: 1 });
    expect(touchSizes(1.5)).toEqual({ tap: 44, uiScale: 1 });
  });

  it('grows the target in design pixels as the stage shrinks, so it stays 44 CSS px', () => {
    for (const scale of [0.9, 0.6, 0.5, 0.4]) {
      const { tap } = touchSizes(scale);
      expect(tap * scale).toBeCloseTo(44, 6);
    }
  });

  it('caps how much the type grows', () => {
    expect(touchSizes(0.3).uiScale).toBe(MAX_UI_SCALE);
    expect(touchSizes(0.8).uiScale).toBeCloseTo(1.25, 6);
    expect(touchSizes(0).tap).toBe(44);
  });
});
