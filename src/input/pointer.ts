import type { Clock } from '../core/types';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface PointerSample {
  x: number;
  y: number;
  inside: boolean;
  touch: boolean;
  down: boolean;
}
export interface PointerClick extends PointerSample {
  time: number; // clock seconds
}

/** Pure: client pixels to play-area fractions. x and y are NOT clamped. */
export function toPlayArea(
  clientX: number,
  clientY: number,
  rect: Rect,
): { x: number; y: number; inside: boolean } {
  if (!(rect.width > 0) || !(rect.height > 0)) return { x: 0, y: 0, inside: false };
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  return { x, y, inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
}

export interface PointerInputOptions {
  element: HTMLElement;
  /** AudioClock satisfies this. */
  clock: Clock & { timeOfEvent?(timeStampMs: number): number };
  /** Play area in client pixels, read on every event (it changes on resize). */
  getPlayRect(): Rect;
  onMove?(s: PointerSample): void;
  onDown?(c: PointerClick): void;
  onUp?(s: PointerSample): void;
}

/** Attaches pointerdown, pointermove, pointerup and pointercancel listeners. Returns a detach function. */
export function attachPointerInput(opts: PointerInputOptions): () => void {
  const { element, clock } = opts;
  let down = false;
  const oldTouchAction = element.style.touchAction;
  element.style.touchAction = 'none';

  const sample = (e: PointerEvent, isDown: boolean): PointerSample => ({
    ...toPlayArea(e.clientX, e.clientY, opts.getPlayRect()),
    touch: e.pointerType === 'touch',
    down: isDown,
  });

  const onPointerDown = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Stamp the arrival time first, before any other work.
    const time = clock.timeOfEvent ? clock.timeOfEvent(e.timeStamp) : clock.now();
    if (e.pointerType === 'touch') e.preventDefault();
    down = true;
    opts.onDown?.({ ...sample(e, true), time });
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    opts.onMove?.(sample(e, down));
  };
  const end = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    down = false;
    opts.onUp?.(sample(e, false));
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', end);
  element.addEventListener('pointercancel', end);
  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', end);
    element.removeEventListener('pointercancel', end);
    element.style.touchAction = oldTouchAction;
  };
}
