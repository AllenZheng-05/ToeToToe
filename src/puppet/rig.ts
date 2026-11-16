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
  /** Where the head pin rests when nothing pulls it: this far behind the base (negative: in front), and this high. */
  restBack: number;
  restHeight: number;
  /** The rest point rises by up to this much as the tip gets farther from the base ... */
  stretchLift: number;
  /** ... reaching the full rise this far beyond the head-and-sword length. */
  stretchLiftDist: number;
  /** How far the body's last stretch turns from the chord toward forward, degrees. */
  neckForward: number;
  /** The head pin is never lower than this above the base (the ledge line). */
  minHeadHeight: number;
  /** Largest angle between the sword line and forward, degrees. */
  maxSwordAngle: number;
  /** Lean of the body's first segment away from the opponent, degrees from straight up. */
  baseLean: number;
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
  restBack: -100,
  restHeight: 190,
  stretchLift: 260,
  stretchLiftDist: 500,
  neckForward: 25,
  minHeadHeight: 120,
  maxSwordAngle: 100,
  baseLean: 6,
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

/** Cubic Bezier through p0..p3, sampled into a table of points and cumulative arc lengths. */
function sampleCurve(p0: Point, p1: Point, p2: Point, p3: Point, table: Point[], cum: number[]): number {
  table.length = 0;
  cum.length = 0;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    table.push({
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    });
    if (i === 0) cum.push(0);
    else {
      const q = table[i - 1] as Point;
      const r = table[i] as Point;
      cum.push((cum[i - 1] as number) + Math.hypot(r.x - q.x, r.y - q.y));
    }
  }
  return cum[SAMPLES] as number;
}

/**
 * Pose a puppet whose base is fixed at `base` (behind the ledge) so its sword tip is at `tip`.
 * `facing` is 1 for the left-hand puppet (faces right) and -1 for the right-hand one.
 * `previousCount` gives hysteresis: keep the same number of segments while their stretch stays
 * within [minStretch, maxStretch].
 *
 * The solve happens in the left-hand puppet's frame (base at the origin, opponent to the +x side)
 * and is mirrored for facing -1. Head and sword are one rigid line of length headLength +
 * swordLength ending at the tip. The head pin sits on the circle of that radius around the tip, at
 * the point nearest a rest point above the base, so the sword is level when the tip is out in
 * front at head height, tilts as the tip rises or falls, and the head leans back when the tip
 * comes near. The head pin is then kept above the ledge, inside the body's reach, and the sword
 * line within maxSwordAngle of forward. The body is a cubic Bezier from the base (leaving upward,
 * leaning away from the opponent) to the head pin, bowing more when the pin is close so the
 * segments never compress; it is cut into equal-arc segments. Deterministic and continuous in
 * `tip` for a fixed segment count.
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

  // Head pin: on the circle of radius `reach` around the tip, nearest the rest point.
  const liftT = clamp((Math.hypot(tx, ty) - reach) / cfg.stretchLiftDist, 0, 1);
  const lift = cfg.stretchLift * liftT * liftT;
  const rest = { x: -cfg.restBack, y: -cfg.restHeight - lift };
  const toRest = unit(rest.x - tx, rest.y - ty, { x: -1, y: 0 });
  let hx = tx + reach * toRest.x;
  let hy = ty + reach * toRest.y;

  // Limits on the pin: above the ledge line, the sword line no more than maxSwordAngle from
  // forward, the body neither folded up (chord at least minChord) nor beyond its reach.
  const backLimit = -Math.cos((cfg.maxSwordAngle * Math.PI) / 180) * reach;
  const topY = -cfg.minHeadHeight;
  const minChord = cfg.minSegments * cfg.segmentLength * cfg.minStretch * 1.1;
  const allowed = (x: number, y: number): boolean => {
    const c = Math.hypot(x, y);
    return y <= topY + 1e-6 && x <= tx + backLimit + 1e-6 && c >= minChord - 1e-6 && c <= bodyCap + 1e-6;
  };
  if (!allowed(hx, hy)) {
    // Swing the sword line around the tip, as little as possible, to an allowed pin.
    const theta0 = Math.atan2(ty - hy, tx - hx);
    const step = Math.PI / 720;
    let found = false;
    for (let i = 1; i <= 1440 && !found; i++) {
      for (const sign of [1, -1]) {
        const a = theta0 + sign * i * step;
        const x = tx - reach * Math.cos(a);
        const y = ty - reach * Math.sin(a);
        if (allowed(x, y)) {
          hx = x;
          hy = y;
          found = true;
          break;
        }
      }
    }
    if (!found) {
      // Nothing satisfies every limit (the tip is at the edge of reach): keep the pin within reach.
      const d = Math.hypot(tx, ty);
      if (d > 1e-9 && Math.hypot(hx, hy) > bodyCap) {
        const ux = tx / d;
        const uy = ty / d;
        const along = (bodyCap * bodyCap - reach * reach + d * d) / (2 * d);
        const off = Math.sqrt(Math.max(0, bodyCap * bodyCap - along * along));
        const c1 = { x: along * ux - off * uy, y: along * uy + off * ux };
        const c2 = { x: along * ux + off * uy, y: along * uy - off * ux };
        const near = Math.hypot(c1.x - hx, c1.y - hy) <= Math.hypot(c2.x - hx, c2.y - hy) ? c1 : c2;
        hx = near.x;
        hy = near.y;
      }
    }
  }

  const dir = unit(tx - hx, ty - hy, { x: 1, y: 0 });
  const theta = Math.atan2(dir.y, dir.x);
  const pin: Point = { x: hx, y: hy };

  // Body: cubic Bezier from the origin, leaving upward (leaning back), arriving along the line
  // from the base to the pin. Longer handles bow it more; raise them until it is long enough.
  const chord = Math.hypot(pin.x, pin.y);
  const lean = (cfg.baseLean * Math.PI) / 180;
  const chordDir = unit(pin.x, pin.y, { x: 0, y: -1 });
  const fwd = ((cfg.neckForward * Math.PI) / 180) * clamp((bodyCap - chord) / (0.15 * bodyCap), 0, 1);
  // The body arrives turned toward forward (down, for a head to the right), like a neck bowing.
  const t1 = unit(
    chordDir.x * Math.cos(fwd) - chordDir.y * Math.sin(fwd),
    chordDir.x * Math.sin(fwd) + chordDir.y * Math.cos(fwd),
    { x: 1, y: 0 },
  );
  const minArc = cfg.minSegments * cfg.segmentLength * cfg.minStretch;
  // At full stretch the body straightens along the chord instead of bowing.
  const ramp = clamp((bodyCap - chord) / (0.15 * bodyCap), 0, 1);
  const t0 = unit(ramp * -Math.sin(lean) + (1 - ramp) * t1.x, ramp * -Math.cos(lean) + (1 - ramp) * t1.y, {
    x: 0,
    y: -1,
  });
  const table: Point[] = [];
  const cum: number[] = [];
  const origin: Point = { x: 0, y: 0 };
  const build = (k: number): number =>
    sampleCurve(
      origin,
      { x: t0.x * 1.8 * k * chord, y: t0.y * 1.8 * k * chord },
      { x: pin.x - t1.x * 0.6 * k * chord, y: pin.y - t1.y * 0.6 * k * chord },
      pin,
      table,
      cum,
    );
  // Cut the current curve into n equal-arc pieces: the joints, from the origin to the pin.
  const cutJoints = (count: number): Point[] => {
    const arcLen = cum[SAMPLES] as number;
    const out: Point[] = [origin];
    let j = 0;
    for (let i = 1; i < count; i++) {
      const target = (arcLen * i) / count;
      while (j < SAMPLES - 1 && (cum[j + 1] as number) < target) j++;
      const c0 = cum[j] as number;
      const c1 = cum[j + 1] as number;
      const f = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
      const p0 = table[j] as Point;
      const p1 = table[j + 1] as Point;
      out.push({ x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f });
    }
    out.push(pin);
    return out;
  };
  // The shortest piece's chord, over the rest length, for the count the curve would get.
  const shortestPiece = (arcLen: number): number => {
    const count = clamp(Math.round(arcLen / cfg.segmentLength), cfg.minSegments, cfg.maxSegments);
    const js = cutJoints(count);
    let m = Infinity;
    for (let i = 1; i < js.length; i++) {
      const a = js[i - 1] as Point;
      const b = js[i] as Point;
      m = Math.min(m, Math.hypot(b.x - a.x, b.y - a.y));
    }
    return m / cfg.segmentLength;
  };
  const enough = (k: number): boolean => {
    const len = build(k);
    return len >= minArc && shortestPiece(len) >= cfg.minStretch * 0.96;
  };
  const k0 = 0.1 + 0.3 * ramp;
  if (!enough(k0)) {
    // Bow more until the pieces are long enough (they shorten as the curve curls up).
    let lo = k0;
    let hi = k0 + 1.5;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (enough(mid)) hi = mid;
      else lo = mid;
    }
    build(hi);
  } else {
    build(k0);
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

  const joints = cutJoints(n);

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
