import { describe, expect, it } from 'vitest';
import type { Point } from '../../src/puppet/parts';
import { DEFAULT_RIG, solveRig, type Placement, type RigPose } from '../../src/puppet/rig';

const BASE: Point = { x: 330, y: 660 };
const CFG = DEFAULT_RIG;
const REACH = CFG.headLength + CFG.swordLength;
const BODY_CAP = CFG.maxSegments * CFG.segmentLength * CFG.maxStretch;
/** Shortest body that still has to respect minStretch (below this the body folds, compressed). */
const FOLD_ARC = CFG.minSegments * CFG.segmentLength * CFG.minStretch;

function grid(facing: 1 | -1): Point[] {
  const pts: Point[] = [];
  for (let x = 60; x <= 1240; x += 100) {
    for (let y = 40; y <= 700; y += 80) pts.push({ x: BASE.x + facing * (x - 330), y });
  }
  return pts;
}

function placementValues(p: Placement): number[] {
  return [p.x, p.y, p.rotation, p.scaleX];
}

function allValues(pose: RigPose): number[] {
  return [
    ...pose.segments.flatMap(placementValues),
    ...pose.pins.flatMap((p) => [p.x, p.y]),
    ...placementValues(pose.head),
    ...placementValues(pose.sword),
    pose.tip.x,
    pose.tip.y,
    pose.segmentCount,
  ];
}

function segmentEnd(s: Placement): Point {
  const len = Math.abs(s.scaleX) * CFG.segmentLength;
  // A negative scaleX flips the part's local x axis, so the world direction is the negated
  // rotation vector (this is the mirror image of the facing 1 pose).
  const sign = s.scaleX < 0 ? -1 : 1;
  return {
    x: s.x + sign * Math.cos(s.rotation) * len,
    y: s.y + sign * Math.sin(s.rotation) * len,
  };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Tips where the head pin is far enough from the base that the body does not fold. */
function bodyChord(tip: Point, facing: 1 | -1): number {
  return Math.hypot((tip.x - BASE.x) * facing, tip.y - BASE.y) - REACH;
}

describe('solveRig', () => {
  for (const facing of [1, -1] as const) {
    describe(`facing ${facing}`, () => {
      const tips = grid(facing);

      it('returns only finite values', () => {
        for (const tip of tips) {
          for (const v of allValues(solveRig(BASE, tip, facing))) {
            expect(Number.isFinite(v)).toBe(true);
          }
        }
      });

      it('puts the sword tip on the requested tip when reachable', () => {
        for (const tip of tips) {
          if (dist(tip, BASE) > BODY_CAP + REACH) continue;
          const pose = solveRig(BASE, tip, facing);
          expect(dist(pose.tip, tip)).toBeLessThan(0.01);
          // The sword's far end, from its placement: handle + swordLength along its direction.
          const sg = pose.sword.scaleX < 0 ? -1 : 1;
          const far = {
            x: pose.sword.x + sg * Math.cos(pose.sword.rotation) * CFG.swordLength,
            y: pose.sword.y + sg * Math.sin(pose.sword.rotation) * CFG.swordLength,
          };
          expect(dist(far, pose.tip)).toBeLessThan(0.01);
        }
      });

      it('keeps the chain continuous up to the head pin, and the mouth on the handle', () => {
        for (const tip of tips) {
          const pose = solveRig(BASE, tip, facing);
          expect(pose.segments.length).toBe(pose.segmentCount);
          expect(pose.pins.length).toBe(pose.segmentCount);
          expect(dist(pose.segments[0] as Placement, BASE)).toBeLessThan(0.01);
          pose.segments.forEach((s, i) => {
            const end = segmentEnd(s);
            expect(dist(end, pose.pins[i] as Point)).toBeLessThan(0.01);
            const next = pose.segments[i + 1];
            if (next) expect(dist(end, next)).toBeLessThan(0.01);
          });
          expect(dist(pose.pins[pose.pins.length - 1] as Point, pose.head)).toBeLessThan(0.01);
          // Head mouth: head pin plus headLength along the head's pin-to-mouth direction, which
          // is the sword direction.
          const dirSign = pose.sword.scaleX < 0 ? -1 : 1;
          const dir = {
            x: dirSign * Math.cos(pose.sword.rotation),
            y: dirSign * Math.sin(pose.sword.rotation),
          };
          const mouth = {
            x: pose.head.x + dir.x * CFG.headLength,
            y: pose.head.y + dir.y * CFG.headLength,
          };
          expect(dist(mouth, pose.sword)).toBeLessThan(0.01);
        }
      });

      it('keeps stretch within limits when reachable and not folded', () => {
        let checked = 0;
        for (const tip of tips) {
          if (dist(tip, BASE) > BODY_CAP + REACH) continue;
          if (bodyChord(tip, facing) < FOLD_ARC) continue;
          const pose = solveRig(BASE, tip, facing);
          for (const s of pose.segments) {
            const stretch = Math.abs(s.scaleX);
            // The limits apply to the arc; a segment's chord is a hair shorter on a curve.
            expect(stretch).toBeGreaterThan(CFG.minStretch * 0.95);
            expect(stretch).toBeLessThan(CFG.maxStretch + 1e-6);
          }
          checked++;
        }
        expect(checked).toBeGreaterThan(20);
      });

      it('folds with the minimum segments when the head pin lands on the base', () => {
        // Head and sword are one rigid line; a tip exactly that far out leaves no body to span.
        const pose = solveRig(BASE, { x: BASE.x + facing * REACH, y: BASE.y }, facing);
        expect(pose.segmentCount).toBe(CFG.minSegments);
        for (const v of allValues(pose)) expect(Number.isFinite(v)).toBe(true);
        expect(dist(pose.tip, { x: BASE.x + facing * REACH, y: BASE.y })).toBeLessThan(0.01);
      });

      it('grows the segment count with distance', () => {
        let last = 0;
        for (let d = REACH + 100; d <= BODY_CAP + REACH; d += 20) {
          const pose = solveRig(BASE, { x: BASE.x + facing * d, y: BASE.y }, facing);
          expect(pose.segmentCount).toBeGreaterThanOrEqual(last);
          last = pose.segmentCount;
        }
        expect(last).toBe(CFG.maxSegments);
        const near = solveRig(BASE, { x: BASE.x + facing * (REACH + 120), y: BASE.y }, facing);
        expect(near.segmentCount).toBeLessThan(last);
      });

      it('clamps to the nearest reachable point when out of reach', () => {
        const maxReach = BODY_CAP + REACH;
        const far = { x: BASE.x + facing * 5000, y: BASE.y - 2000 };
        const pose = solveRig(BASE, far, facing);
        const d = Math.hypot(far.x - BASE.x, far.y - BASE.y);
        const expected = {
          x: BASE.x + ((far.x - BASE.x) * maxReach) / d,
          y: BASE.y + ((far.y - BASE.y) * maxReach) / d,
        };
        expect(dist(pose.tip, expected)).toBeLessThan(0.01);
        expect(pose.segmentCount).toBe(CFG.maxSegments);
        for (const s of pose.segments) expect(Math.abs(s.scaleX)).toBeLessThan(CFG.maxStretch + 1e-6);
      });

      it('is finite when the tip equals the base', () => {
        const pose = solveRig(BASE, { ...BASE }, facing);
        for (const v of allValues(pose)) expect(Number.isFinite(v)).toBe(true);
        expect(dist(pose.tip, BASE)).toBeLessThan(0.01);
      });
    });
  }

  it('keeps the previous segment count while its stretch stays within limits', () => {
    // Sweep out and back across the threshold between two counts, feeding the count back in.
    let count: number | undefined;
    const counts: number[] = [];
    const sweep = (from: number, to: number, step: number): void => {
      for (let d = from; step > 0 ? d <= to : d >= to; d += step) {
        const pose = solveRig(BASE, { x: BASE.x + d, y: BASE.y - 100 }, 1, count);
        count = pose.segmentCount;
        counts.push(count);
      }
    };
    sweep(REACH + 300, REACH + 420, 1);
    sweep(REACH + 420, REACH + 300, -1);
    let changes = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i] !== counts[i - 1]) changes++;
    // Up and back across the range: each count change happens once going out and once coming back
    // at a different distance, never flickering.
    const outPart = counts.slice(0, 121);
    const backPart = counts.slice(121);
    for (const part of [outPart, backPart]) {
      for (let i = 2; i < part.length; i++) {
        // Monotone within a sweep: no flip-flop.
        const a = part[i - 2] as number;
        const b = part[i - 1] as number;
        const c = part[i] as number;
        expect(!(a !== b && b !== c && a === c)).toBe(true);
      }
    }
    expect(changes).toBeLessThanOrEqual(4);

    // With hysteresis the count differs from a memoryless solve at the same distance.
    const d = REACH + 360;
    const fresh = solveRig(BASE, { x: BASE.x + d, y: BASE.y - 100 }, 1);
    const held = solveRig(BASE, { x: BASE.x + d, y: BASE.y - 100 }, 1, fresh.segmentCount + 1);
    const heldStretch = held.segments.map((s) => Math.abs(s.scaleX));
    expect(held.segmentCount).toBe(fresh.segmentCount + 1);
    expect(Math.min(...heldStretch)).toBeGreaterThan(CFG.minStretch * 0.95);
  });

  it('moves every pin only a few px for a 1 px tip move with the same count', () => {
    const tips = grid(1);
    let checked = 0;
    for (const tip of tips) {
      if (dist(tip, BASE) > BODY_CAP + REACH - 5) continue;
      if (bodyChord(tip, 1) < FOLD_ARC) continue;
      const a = solveRig(BASE, tip, 1);
      const b = solveRig(BASE, { x: tip.x + 0.7, y: tip.y + 0.7 }, 1, a.segmentCount);
      if (b.segmentCount !== a.segmentCount) continue;
      a.pins.forEach((p, i) => {
        expect(dist(p, b.pins[i] as Point)).toBeLessThan(4);
      });
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('mirrors the pose when facing flips', () => {
    const axis = 640;
    const tips = grid(1);
    const base2 = { x: 2 * axis - BASE.x, y: BASE.y };
    for (const tip of tips) {
      const a = solveRig(BASE, tip, 1);
      const b = solveRig(base2, { x: 2 * axis - tip.x, y: tip.y }, -1);
      expect(b.segmentCount).toBe(a.segmentCount);
      const mirrored = (p: Placement, q: Placement): void => {
        expect(q.x).toBeCloseTo(2 * axis - p.x, 6);
        expect(q.y).toBeCloseTo(p.y, 6);
        expect(q.rotation).toBeCloseTo(-p.rotation, 9);
        expect(q.scaleX).toBeCloseTo(-p.scaleX, 9);
      };
      a.segments.forEach((s, i) => mirrored(s, b.segments[i] as Placement));
      mirrored(a.head, b.head);
      mirrored(a.sword, b.sword);
      a.pins.forEach((p, i) => {
        expect((b.pins[i] as Point).x).toBeCloseTo(2 * axis - p.x, 6);
        expect((b.pins[i] as Point).y).toBeCloseTo(p.y, 6);
      });
      expect(b.tip.x).toBeCloseTo(2 * axis - a.tip.x, 6);
    }
  });

  it('never points the sword back into its own body', () => {
    for (const tip of grid(1)) {
      const pose = solveRig(BASE, tip, 1);
      expect(Math.cos(pose.sword.rotation)).toBeGreaterThan(0);
    }
  });
});
