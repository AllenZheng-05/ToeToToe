/** The input calibration: pure helpers (the scene is in calibration.ts). Times are audio-clock seconds. */

/** Calibration plays a click at this tempo. */
export const CALIBRATION_BPM = 100;
/** Seconds from entering the screen to the first click. */
export const CALIBRATION_LEAD_SEC = 0.8;
/** The running estimate covers this many of the latest taps. */
export const WINDOW_TAPS = 16;
/** The first result is shown after this many taps. */
export const FIRST_RESULT_TAPS = 8;
/** A tap further than this from the nearest click is thrown away (a stray tap, not a late one). */
export const MAX_TAP_ERROR_MS = 200;
/** Fewest kept taps that make an estimate. */
export const MIN_USED_TAPS = 4;
/** Fine adjustment step, and the limits of the stored offset. */
export const NUDGE_MS = 5;
export const MAX_OFFSET_MS = 500;

export interface OffsetEstimate {
  /** Average distance of the taps from the beat, ms. Positive: the player taps late. */
  meanMs: number;
  /** Standard deviation of the kept taps, ms. */
  spreadMs: number;
  /** How many taps were kept. */
  used: number;
}

/** Signed distance in ms from a tap to the nearest beat of the grid, in [-half beat, +half beat). */
export function tapErrorMs(tap: number, grid: { bpm: number; startTime: number }): number {
  const beat = 60 / grid.bpm;
  const d = (tap - grid.startTime) % beat;
  const wrapped = d >= beat / 2 ? d - beat : d < -beat / 2 ? d + beat : d;
  return wrapped * 1000;
}

/**
 * Pure. Average lateness of taps against a beat grid. A tap more than MAX_TAP_ERROR_MS from its beat is
 * dropped (it also covers the wrap-around half a beat away). Null when too few taps are left.
 */
export function estimateOffset(
  taps: readonly number[],
  grid: { bpm: number; startTime: number },
): OffsetEstimate | null {
  if (!(grid.bpm > 0)) return null;
  const errors = taps
    .map((t) => tapErrorMs(t, grid))
    .filter((e) => Number.isFinite(e) && Math.abs(e) <= MAX_TAP_ERROR_MS);
  if (errors.length < MIN_USED_TAPS) return null;
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  const variance = errors.reduce((a, e) => a + (e - mean) ** 2, 0) / errors.length;
  return { meanMs: mean, spreadMs: Math.sqrt(variance), used: errors.length };
}

export function clampOffset(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.min(MAX_OFFSET_MS, Math.max(-MAX_OFFSET_MS, Math.round(ms)));
}

/** "You tap 34 ms late", "You tap 12 ms early", or "You tap right on the beat". */
export function describeOffset(meanMs: number): string {
  const r = Math.round(meanMs);
  if (r === 0) return 'You tap right on the beat';
  return `You tap ${Math.abs(r)} ms ${r > 0 ? 'late' : 'early'}`;
}

/** "Allowing 34 ms" style line for the stored value. */
export function describeStored(ms: number): string {
  return ms === 0 ? 'Allowing no delay' : `Allowing ${ms > 0 ? '+' : '-'}${Math.abs(ms)} ms`;
}
