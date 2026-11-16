import { PARTS, PART_SCALE, type Point } from './parts';

export interface RigConfig {
  /** Rest length between a segment's two pins, design px. */
  segmentLength: number;
  /** A segment may stretch between these factors before one is added or removed. */
  minStretch: number;
  maxStretch: number;
  minSegments: number;
  maxSegments: number;
  /** Distance from head pin to mouth, and from sword handle to tip, design px. */
  headLength: number;
  swordLength: number;
  /** How much the body bows sideways: the bulge at mid-body, as a fraction of the body's chord. */
  bend: number;
}

const HEAD_VEC = {
  x: PARTS.head.mouth.x - PARTS.head.pin.x,
  y: PARTS.head.mouth.y - PARTS.head.pin.y,
};
const SWORD_VEC = {
  x: PARTS.sword.tip.x - PARTS.sword.handle.x,
  y: PARTS.sword.tip.y - PARTS.sword.handle.y,
};

export const DEFAULT_RIG: RigConfig = {
  segmentLength: (PARTS.sock.pinB.x - PARTS.sock.pinA.x) * PART_SCALE.sock,
  minStretch: 0.8,
  maxStretch: 1.25,
  minSegments: 2,
  maxSegments: 9,
  headLength: Math.hypot(HEAD_VEC.x, HEAD_VEC.y) * PART_SCALE.head,
  swordLength: Math.hypot(SWORD_VEC.x, SWORD_VEC.y) * PART_SCALE.sword,
  bend: 0.15,
};

/**
 * Position of the part's first anchor (pinA / pin / handle) in stage design px. `rotation` is in
 * radians. `scaleX` is the stretch along the part's length on top of PART_SCALE; it is negative
 * for the right-hand puppet (facing -1), which is the mirror image of the left-hand one: the
 * renderer sets `scale.x = PART_SCALE[kind] * scaleX`, `scale.y = PART_SCALE[kind]`, with the
 * pivot at the first anchor.
 */
export interface Placement {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
}

export interface RigPose {
  /** From the base upward. */
  segments: Placement[];
  /** Brass pins: one at each joint between segments and one at the head joint. */
  pins: Point[];
  head: Placement;
  sword: Placement;
  /** Where the sword tip ends up. Equals the requested tip unless it was out of reach. */
  tip: Point;
  segmentCount: number;
}

const SAMPLES = 48;
/** Direction the sword drifts to when the tip is very close to the base (up and forward). */
const REST_DIR = { x: 1, y: -0.35 };
/** Smallest forward component of the sword direction, so it never points back into the body. */
const MIN_FORWARD = 0.1;
/** Chord length over which the bow direction eases from "away from opponent" to the normal. */
const BOW_EASE = 60;

const HEAD_ANGLE = Math.atan2(HEAD_VEC.y, HEAD_VEC.x);
const SWORD_ANGLE = Math.atan2(SWORD_VEC.y, SWORD_VEC.x);

function unit(x: number, y: number, fallback: Point): Point {
  const len = Math.hypot(x, y);
  if (!(len > 1e-9)) return unit(fallback.x, fallback.y, { x: 1, y: 0 });
  return { x: x / len, y: y / len };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Pose a puppet whose base is fixed at `base` (behind the ledge) so its sword tip is at `tip`.
 * `facing` is 1 for the left-hand puppet (faces right) and -1 for the right-hand one.
 * `previousCount` gives hysteresis: keep the same number of segments while their stretch stays
 * within [minStretch, maxStretch].
 *
 * The solve happens in the left-hand puppet's frame (base at the origin, opponent to the +x side)
 * and is mirrored for facing -1. The head and sword form one rigid line (head pin to tip) of
 * length headLength + swordLength; the body is a quadratic Bezier from the base to the head pin,
 * bowed away from the opponent and cut into equal-length segments. When the tip is nearer the
 * base than that rigid line the head pin lands behind the base and the body folds (minimum
 * segments, compressed). Deterministic and continuous in `tip` for a fixed segment count.
 */
export function solveRig(
  base: Point,
  tip: Point,
  facing: 1 | -1,
  previousCount?: number,
  config: RigConfig = DEFAULT_RIG,
): RigPose {
  const cfg = config;
  const reach = cfg.headLength + cfg.swordLength;
  const bodyCap = cfg.maxSegments * cfg.segmentLength * cfg.maxStretch;
  const maxReach = bodyCap + reach;

  // Tip relative to base, in the left-hand frame, clamped to reach.
  let tx = Number.isFinite(tip.x) ? (tip.x - base.x) * facing : 0;
  let ty = Number.isFinite(tip.y) ? tip.y - base.y : 0;
  const dist = Math.hypot(tx, ty);
  if (dist > maxReach) {
    tx *= maxReach / dist;
    ty *= maxReach / dist;
  }
  const d = Math.min(dist, maxReach);

  // Sword direction: along base -> tip, easing to a forward rest direction near the base.
  const toTip = unit(tx, ty, REST_DIR);
  const w = clamp(d / reach, 0, 1);
  const rest = unit(REST_DIR.x, REST_DIR.y, { x: 1, y: 0 });
  const dir = unit(
    Math.max(w * toTip.x + (1 - w) * rest.x, MIN_FORWARD),
    w * toTip.y + (1 - w) * rest.y,
    rest,
  );
  const theta = Math.atan2(dir.y, dir.x);

  const pin: Point = { x: tx - reach * dir.x, y: ty - reach * dir.y };

  // Body curve: quadratic Bezier from the origin to the head pin.
  const chord = Math.hypot(pin.x, pin.y);
  const minArc = cfg.minSegments * cfg.segmentLength * cfg.minStretch;
  const ramp = clamp((bodyCap - chord) / (0.15 * bodyCap), 0, 1);
  const offset = 2 * cfg.bend * chord * ramp + minArc * Math.max(0, 1 - chord / minArc);
  // Bow direction: perpendicular to the chord (up when the chord points right, left when it
  // points up), easing to straight "away from the opponent" for very short chords.
  const e = clamp(chord / BOW_EASE, 0, 1);
  const away = { x: -1, y: 0 };
  const perp = chord > 1e-9 ? { x: pin.y / chord, y: -pin.x / chord } : away;
  const bow = unit(e * perp.x + (1 - e) * away.x, e * perp.y + (1 - e) * away.y, away);
  const ctrl = { x: pin.x / 2 + bow.x * offset, y: pin.y / 2 + bow.y * offset };

  const table: Point[] = [];
  const cum: number[] = [0];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const b = 2 * t * (1 - t);
    const c = t * t;
    table.push({ x: b * ctrl.x + c * pin.x, y: b * ctrl.y + c * pin.y });
  }
  for (let i = 1; i <= SAMPLES; i++) {
    const p0 = table[i - 1] as Point;
    const p1 = table[i] as Point;
    cum.push((cum[i - 1] as number) + Math.hypot(p1.x - p0.x, p1.y - p0.y));
  }
  const arc = cum[SAMPLES] as number;

  // Segment count with hysteresis.
  const stretchFor = (n: number): number => arc / n / cfg.segmentLength;
  let n: number;
  if (
    previousCount !== undefined &&
    Number.isInteger(previousCount) &&
    previousCount >= cfg.minSegments &&
    previousCount <= cfg.maxSegments &&
    stretchFor(previousCount) >= cfg.minStretch &&
    stretchFor(previousCount) <= cfg.maxStretch
  ) {
    n = previousCount;
  } else {
    n = clamp(Math.round(arc / cfg.segmentLength), cfg.minSegments, cfg.maxSegments);
  }

  // Cut the curve into n equal-arc pieces.
  const joints: Point[] = [{ x: 0, y: 0 }];
  let k = 0;
  for (let i = 1; i < n; i++) {
    const target = (arc * i) / n;
    while (k < SAMPLES - 1 && (cum[k + 1] as number) < target) k++;
    const c0 = cum[k] as number;
    const c1 = cum[k + 1] as number;
    const f = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
    const p0 = table[k] as Point;
    const p1 = table[k + 1] as Point;
    joints.push({ x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f });
  }
  joints.push(pin);

  // Convert from the left-hand frame to the world.
  const wx = (x: number): number => base.x + facing * x;
  const wy = (y: number): number => base.y + y;
  const rot = (r: number): number => (facing === 1 ? r : -r);

  const segments: Placement[] = [];
  const pins: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = joints[i] as Point;
    const b = joints[i + 1] as Point;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segments.push({
      x: wx(a.x),
      y: wy(a.y),
      rotation: rot(Math.atan2(b.y - a.y, b.x - a.x)),
      scaleX: (facing * len) / cfg.segmentLength,
    });
    pins.push({ x: wx(b.x), y: wy(b.y) });
  }

  const mouth = { x: pin.x + cfg.headLength * dir.x, y: pin.y + cfg.headLength * dir.y };
  const head: Placement = {
    x: wx(pin.x),
    y: wy(pin.y),
    rotation: rot(theta - HEAD_ANGLE),
    scaleX: facing,
  };
  const sword: Placement = {
    x: wx(mouth.x),
    y: wy(mouth.y),
    rotation: rot(theta - SWORD_ANGLE),
    scaleX: facing,
  };

  return {
    segments,
    pins,
    head,
    sword,
    tip: { x: wx(tx), y: wy(ty) },
    segmentCount: n,
  };
}
