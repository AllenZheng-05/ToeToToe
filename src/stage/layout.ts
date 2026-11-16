export const DESIGN_W = 1280;
export const DESIGN_H = 720;

/** Play area in design pixels: the stage between the curtains and above the ledge. Aspect 2. */
export const PLAY_RECT = { x: 200, y: 163, width: 880, height: 440 };

export interface StageFit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Scale and offset that fit the 1280x720 design into a window, keeping the aspect (letterboxed, centred). */
export function fitStage(windowW: number, windowH: number): StageFit {
  const w = Math.max(1, windowW);
  const h = Math.max(1, windowH);
  const scale = Math.min(w / DESIGN_W, h / DESIGN_H);
  return { scale, offsetX: (w - DESIGN_W * scale) / 2, offsetY: (h - DESIGN_H * scale) / 2 };
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
