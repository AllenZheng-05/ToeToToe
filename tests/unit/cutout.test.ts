import { describe, expect, it } from 'vitest';
import { cutoutPadding, outlineOffsets } from '../../src/stage/art/cutout';
import { boxCentre, coverRect, dotsAlong, markScale, ringRadius } from '../../src/stage/art/fit';

describe('cutoutPadding', () => {
  it('uses the spec defaults: 3 px outline, shadow 5 right and 6 down', () => {
    expect(cutoutPadding()).toEqual({ left: 3, top: 3, right: 8, bottom: 9 });
  });

  it('grows by outline plus shadow on the shadow side only', () => {
    expect(cutoutPadding({ outline: 2, shadowX: 4, shadowY: 5 })).toEqual({
      left: 2,
      top: 2,
      right: 6,
      bottom: 7,
    });
  });

  it('moves the shadow room to the left or top for negative offsets', () => {
    expect(cutoutPadding({ outline: 3, shadowX: -5, shadowY: -2 })).toEqual({
      left: 8,
      top: 5,
      right: 3,
      bottom: 3,
    });
  });

  it('has no padding without outline or shadow', () => {
    expect(cutoutPadding({ outline: 0, shadowX: 0, shadowY: 0 })).toEqual({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    });
  });

  it('skips the outline on disabled sides (curtains: no top; valance: bottom only)', () => {
    expect(cutoutPadding({ sides: { top: false } })).toEqual({ left: 3, top: 0, right: 8, bottom: 9 });
    expect(
      cutoutPadding({ shadowX: 0, shadowY: 6, sides: { top: false, left: false, right: false } }),
    ).toEqual({ left: 0, top: 0, right: 0, bottom: 9 });
  });

  it('does not depend on scale or resolution (padding is in design px)', () => {
    expect(cutoutPadding({ scale: 0.4, resolution: 2 })).toEqual(cutoutPadding());
  });
});

describe('outlineOffsets', () => {
  it('stays within the radius and includes the origin', () => {
    const all = { top: true, right: true, bottom: true, left: true };
    const offs = outlineOffsets(3, all, 2);
    expect(offs[0]).toEqual({ x: 0, y: 0 });
    for (const o of offs) expect(Math.hypot(o.x, o.y)).toBeLessThanOrEqual(3 + 1e-9);
    expect(Math.max(...offs.map((o) => o.y))).toBeCloseTo(3, 6);
    expect(Math.min(...offs.map((o) => o.x))).toBeCloseTo(-3, 6);
  });

  it('only extends below when only the bottom side is enabled, for any resolution', () => {
    for (const res of [1, 1.5, 2, 3]) {
      const offs = outlineOffsets(3, { top: false, right: false, bottom: true, left: false }, res);
      expect(Math.max(...offs.map((o) => o.y))).toBeCloseTo(3, 6);
      expect(Math.min(...offs.map((o) => o.y))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...offs.map((o) => Math.abs(o.x)))).toBeLessThan(1e-6);
    }
  });

  it('is just the origin for a zero radius', () => {
    expect(outlineOffsets(0, { top: true, right: true, bottom: true, left: true })).toEqual([{ x: 0, y: 0 }]);
  });
});

describe('coverRect', () => {
  it('scales the sky like object-fit cover and centres it', () => {
    const r = coverRect(1600, 914, 1201, 651);
    expect(r.width).toBeCloseTo(1201, 6);
    expect(r.height).toBeCloseTo(914 * (1201 / 1600), 6);
    expect(r.y).toBeCloseTo((651 - r.height) / 2, 6);
    expect(r.y).toBeCloseTo(-17.5, 0);
  });

  it('bottom-aligns the valance (only its bottom 112 px shows)', () => {
    const r = coverRect(1611, 236, 1216, 112, 0.5, 1);
    expect(r.height).toBeCloseTo(236 * (1216 / 1611), 6);
    expect(r.y + r.height).toBeCloseTo(112, 6);
  });
});

describe('helpers', () => {
  it('boxCentre', () => {
    expect(boxCentre(6, 26, 96, 30)).toEqual({ x: 54, y: 41 });
  });

  it('markScale maps a radius to a sprite scale', () => {
    expect(markScale(52.8, 44)).toBeCloseTo(1.2, 6);
    expect(markScale(10, 0)).toBe(1);
  });

  it('ringRadius: closed at the hit, far at the start of the lead, none before it', () => {
    expect(ringRadius(0, 1, 50, 2.6)).toBe(50);
    expect(ringRadius(-0.3, 1, 50, 2.6)).toBe(50);
    expect(ringRadius(1, 1, 50, 2.6)).toBeCloseTo(130, 6);
    expect(ringRadius(0.5, 1, 50, 2.6)).toBeCloseTo(90, 6);
    expect(ringRadius(1.01, 1, 50, 2.6)).toBeNull();
  });

  it('dotsAlong spaces dots evenly across segments', () => {
    const dots = dotsAlong(
      [
        { x: 0, y: 0 },
        { x: 25, y: 0 },
        { x: 25, y: 25 },
      ],
      10,
    );
    expect(dots.map((d) => [d.x, d.y])).toEqual([
      [0, 0],
      [10, 0],
      [20, 0],
      [25, 5],
      [25, 15],
      [25, 25],
    ]);
    expect(dotsAlong([], 10)).toEqual([]);
    expect(dotsAlong([{ x: 1, y: 1 }], 0)).toEqual([]);
  });
});
