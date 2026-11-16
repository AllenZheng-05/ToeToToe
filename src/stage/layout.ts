export const DESIGN_W = 1280;
export const DESIGN_H = 720;

/** Play area in design pixels: the stage between the curtains and above the ledge. Aspect 2. */
export const PLAY_RECT = { x: 200, y: 163, width: 880, height: 440 };

export interface StageFit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Space the device keeps for notches and rounded corners (CSS px), as in env(safe-area-inset-*). */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Scale and offset that fit the 1280x720 design into a window, keeping the aspect (letterboxed, centred).
 * With `insets` the design fits the window minus the safe-area insets.
 */
export function fitStage(windowW: number, windowH: number, insets?: Insets): StageFit {
  const left = Math.max(0, insets?.left ?? 0);
  const top = Math.max(0, insets?.top ?? 0);
  const w = Math.max(1, windowW - left - Math.max(0, insets?.right ?? 0));
  const h = Math.max(1, windowH - top - Math.max(0, insets?.bottom ?? 0));
  const scale = Math.min(w / DESIGN_W, h / DESIGN_H);
  return { scale, offsetX: left + (w - DESIGN_W * scale) / 2, offsetY: top + (h - DESIGN_H * scale) / 2 };
}

/** The most the interface grows (type and padding) when the stage is scaled down, as a factor. */
export const MAX_UI_SCALE = 1.35;
/** Smallest comfortable tap target, CSS px. */
export const MIN_TAP_PX = 44;

/** Overlay sizes for a given stage scale: a 44 CSS px tap target in design px, and how much type grows. */
export function touchSizes(scale: number): { tap: number; uiScale: number } {
  const s = scale > 0 ? scale : 1;
  const tap = Math.max(MIN_TAP_PX, MIN_TAP_PX / s);
  return { tap, uiScale: Math.min(MAX_UI_SCALE, tap / MIN_TAP_PX) };
}

/** The play rect in client pixels for a given fit. */
export function playRectOnScreen(fit: StageFit): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  return {
    left: fit.offsetX + PLAY_RECT.x * fit.scale,
    top: fit.offsetY + PLAY_RECT.y * fit.scale,
    width: PLAY_RECT.width * fit.scale,
    height: PLAY_RECT.height * fit.scale,
  };
}

/** Play-area fractions to design pixels. */
export function playToDesign(x: number, y: number): { x: number; y: number } {
  return { x: PLAY_RECT.x + x * PLAY_RECT.width, y: PLAY_RECT.y + y * PLAY_RECT.height };
}
