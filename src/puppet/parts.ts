export type PartKind = 'head' | 'sock' | 'sword';
export interface Point {
  x: number;
  y: number;
}

/**
 * Canvas sizes and fixed anchor points in each drawing's own pixels.
 * Puppets are drawn facing RIGHT; the right-hand player's puppet is mirrored at render time.
 *
 * Anchors are taken from docs/DESIGN_SPEC.md section 4 (teal head pin (58,150), mouth end
 * (292,122); sword handle (38,40)) so the teal preset needs no re-fitting. The sock piece is the
 * mock's 120 x 82 segment scaled by 1.25 to fill the 160 x 120 canvas, with the brass pins 18 px
 * inside each end. The sword tip is pulled in to x = 312 so the round stroke stays on the canvas.
 */
export const PARTS: {
  head: { width: 320; height: 240; pin: Point; mouth: Point };
  sock: { width: 160; height: 120; pinA: Point; pinB: Point };
  sword: { width: 320; height: 80; handle: Point; tip: Point };
} = {
  head: { width: 320, height: 240, pin: { x: 58, y: 150 }, mouth: { x: 292, y: 122 } },
  sock: { width: 160, height: 120, pinA: { x: 18, y: 60 }, pinB: { x: 142, y: 60 } },
  sword: { width: 320, height: 80, handle: { x: 38, y: 40 }, tip: { x: 312, y: 40 } },
};

/**
 * Scale from drawing pixels to stage design pixels. The mocks draw the head at 0.62 (idle) or
 * 0.58 (stretched), the sword at 0.5 or 0.4, and sock segments 120 design px wide (160 * 0.75).
 * Head and sword use the midpoints so one value serves every pose.
 */
export const PART_SCALE: { head: number; sock: number; sword: number } = {
  head: 0.6,
  sock: 0.75,
  sword: 0.45,
};

export const MAX_PART_BYTES = 512 * 1024;
