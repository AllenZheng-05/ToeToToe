# Brief B: puppet parts, rig maths, presets, drawing validation

**Goal.** The pure geometry and data behind the sock puppets, with no rendering: where the anchor points are on each drawing, how a chain of sock segments bends and stretches so the sword tip lands on the pointer, four preset puppets as SVG, and validation of drawings received from the other player. A later task draws this with PixiJS; another builds the drawing editor on the same part sizes and anchors.

**Read first:** `CLAUDE.md`, `docs/GAME.md` (Puppets and the workshop), `docs/DESIGN_SPEC.md` section 4 (Puppets: the SVG of the two example puppets, sizes, pins, transforms) and the duel mocks `design/mocks/5-duel-attacking.html` and `6-duel-defending.html` to see how the segments, pins, head and sword are posed.

**Files you own (create):** `src/puppet/parts.ts`, `src/puppet/rig.ts`, `src/puppet/presets.ts`, `src/puppet/validate.ts`, `tests/unit/rig.test.ts`, `tests/unit/presets.test.ts`, `tests/unit/puppetValidate.test.ts`. Touch nothing else. Add no dependencies.

## Interfaces

```ts
// src/puppet/parts.ts
export type PartKind = 'head' | 'sock' | 'sword';
export interface Point { x: number; y: number; }
/** Canvas sizes and fixed anchor points in each drawing's own pixels. Puppets are drawn facing RIGHT; the right-hand player's puppet is mirrored at render time. */
export const PARTS: {
  head: { width: 320; height: 240; pin: Point; mouth: Point };   // pin: where the head joins the sock (left side); mouth: where the sword handle sits (right side)
  sock: { width: 160; height: 120; pinA: Point; pinB: Point };   // the two brass pins a segment hangs between (left and right ends, with overlap margin)
  sword: { width: 320; height: 80; handle: Point; tip: Point };
};
/** Scale from drawing pixels to stage design pixels (the mocks draw the head at about 0.62 and segments at about 0.75; choose values that reproduce the mocks and document them). */
export const PART_SCALE: { head: number; sock: number; sword: number };
export const MAX_PART_BYTES = 512 * 1024;
```

```ts
// src/puppet/rig.ts  (pure; all coordinates in stage design pixels, y down)
export interface RigConfig {
  /** Rest length between a segment's two pins, design px. */
  segmentLength: number;
  /** A segment may stretch between these factors before one is added or removed. */
  minStretch: number;    // e.g. 0.8
  maxStretch: number;    // e.g. 1.25
  minSegments: number;   // e.g. 2
  maxSegments: number;   // e.g. 9
  /** Distance from head pin to mouth, and from sword handle to tip, design px (derived from PARTS and PART_SCALE). */
  headLength: number;
  swordLength: number;
  /** How much the body bows sideways, as a fraction of its length. */
  bend: number;
}
export const DEFAULT_RIG: RigConfig;
export interface Placement { x: number; y: number; rotation: number; scaleX: number; } // position of the part's first anchor (pinA / pin / handle); rotation in radians; scaleX is the stretch along its length
export interface RigPose {
  segments: Placement[];   // from the base upward
  pins: Point[];           // brass pins: one at each joint between segments and one at the head joint
  head: Placement;
  sword: Placement;
  /** Where the sword tip ends up. Equals the requested tip unless it was out of reach. */
  tip: Point;
  segmentCount: number;
}
/**
 * Pose a puppet whose base is fixed at `base` (behind the ledge) so its sword tip is at `tip`.
 * `facing` is 1 for the left-hand puppet (faces right) and -1 for the right-hand one.
 * `previousCount` gives hysteresis: keep the same number of segments while their stretch stays within [minStretch, maxStretch].
 * Deterministic and continuous in `tip` for a fixed segment count. Never returns NaN, including when tip equals base.
 */
export function solveRig(base: Point, tip: Point, facing: 1 | -1, previousCount?: number, config?: RigConfig): RigPose;
```

Rig requirements:

- The sword points from the head toward the tip; the head sits behind the sword handle; the body is a smooth bowed curve (for example a quadratic Bezier or circular arc) from the base to the head pin, bowing away from the opponent, sampled into `segmentCount` equal segments whose rotation follows the curve. Consecutive segments share pin points exactly.
- The sword's direction should look natural: mostly along the line from the base to the tip, but never pointing back into the puppet's own body; when the tip is close to the base the body folds (minimum segments, compressed) rather than exploding.
- Reach: if the tip is farther than the maximum reach (`maxSegments * segmentLength * maxStretch + headLength + swordLength`) the pose is fully stretched toward it and `tip` reports the nearest reachable point.
- Every placement value is finite.

```ts
// src/puppet/presets.ts
export interface PuppetPreset {
  id: string;                 // 'preset-teal', 'preset-pink', and two more
  name: string;               // plain descriptive names: "Teal sock", "Pink sock", ...
  /** Complete standalone SVG documents sized exactly to the part canvas, transparent background, drawn facing right, anchors at the PARTS positions. */
  svg: { head: string; sock: string; sword: string };
}
export const PRESETS: PuppetPreset[]; // four
/** `data:image/svg+xml` URL for use as an image source. */
export function svgDataUrl(svg: string): string;
```

Build the teal and pink presets from the SVG in `docs/DESIGN_SPEC.md` section 4 (re-fit to the part canvases so the anchors land on `PARTS`; keep colours, stroke widths and details). Add two more in the same hand-cut style with different palettes from the design colours (for example a yellow one with red stripes and a blue one with pink spots), each with its own head details and sword shape. No external references, no scripts, no `<image>` or `<foreignObject>` in the SVG.

```ts
// src/puppet/validate.ts
export type DrawingRejection = 'size' | 'type' | 'dimensions';
/** For drawings from the other player (untrusted): at most MAX_PART_BYTES, PNG signature, IHDR present, width and height exactly the part's canvas size. Reads headers only; decoding is left to the browser. */
export function checkDrawingBytes(data: ArrayBuffer, kind: PartKind): { ok: true } | { ok: false; reason: DrawingRejection };
```

## Tests

`rig.test.ts`: for a grid of tips across the stage (both facings): all values finite; `pose.tip` equals the requested tip within 0.01 px when reachable; chain continuity (each segment's end pin equals the next segment's start within 0.01 px; the last equals the head pin); the head's mouth point equals the sword's handle point; the sword's far end equals `pose.tip`; stretch factors within limits when reachable; segment count grows with distance; hysteresis (moving the tip slightly across a threshold with `previousCount` does not flip the count back and forth); continuity (a 1 px tip move with the same count moves every pin less than a few px); out-of-reach clamps; tip equal to base gives finite output; mirrored facing gives a mirrored pose.

`presets.test.ts`: four presets with unique ids; every SVG string starts with `<svg`, declares the exact width, height and viewBox of its part, and contains no `<script`, `<image`, `<foreignObject`, `href=` or `url(` to external resources.

`puppetValidate.test.ts`: a valid minimal PNG header for each kind passes; wrong dimensions, non-PNG bytes, truncated data and oversize data are rejected with the right reason.

## Out of scope

Rendering, textures, the drawing editor, storage, networking.

## Checks that must pass

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm exec prettier --check src tests`. Other agents are working elsewhere in `src/` at the same time; ignore failures that come only from their files and say so.

## Report (under 200 words)

What you built, the anchor positions and scales you chose and why, check results, and decisions the brief did not cover.
