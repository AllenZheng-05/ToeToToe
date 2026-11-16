import type { App } from '../app/app';
import { slotTime } from '../core/beat';
import type { BeatGrid, Tunables } from '../core/types';
import { playRectOnScreen } from '../stage/layout';

/** One scripted click: a slot of an absolute phrase, a point in the play area, and an optional shift in ms. */
export interface ScriptEvent {
  phrase: number;
  slot: number;
  /** Play-area fractions. */
  x: number;
  y: number;
  offsetMs?: number;
}

/** True once the clock has reached the event's time. Pure. */
export function isDue(ev: ScriptEvent, grid: BeatGrid, tunables: Tunables, now: number): boolean {
  return now >= slotTime(grid, ev.phrase, ev.slot, tunables) + (ev.offsetMs ?? 0) / 1000;
}

/**
 * Plays scripted clicks for tests (debug mode only). Each due event becomes a real `pointerdown` and
 * `pointerup` PointerEvent on the stage element, so the click takes the same path as a person's.
 * Events belong to the match that was running when they were added; a new match drops what is left.
 */
export class ScriptRunner {
  private pending: ScriptEvent[] = [];
  private match: object | null = null;

  constructor(private readonly app: App) {}

  add(events: readonly ScriptEvent[]): void {
    this.match = this.app.match;
    this.pending.push(...events.map((e) => ({ ...e })));
  }

  get remaining(): number {
    return this.pending.length;
  }

  update(): void {
    const { app } = this;
    if (this.pending.length === 0 || !app.hasEngine || !app.match) return;
    if (this.match === null) this.match = app.match;
    if (this.match !== app.match) {
      this.pending = [];
      this.match = null;
      return;
    }
    const now = app.engine.clock.now();
    const due = this.pending.filter((e) => isDue(e, app.match!.grid, app.tunables, now));
    if (due.length === 0) return;
    this.pending = this.pending.filter((e) => !due.includes(e));
    for (const e of due) this.click(e);
  }

  private click(e: ScriptEvent): void {
    const rect = playRectOnScreen(this.app.stage.fit);
    const init: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + e.x * rect.width,
      clientY: rect.top + e.y * rect.height,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
    };
    const host = this.app.stage.host;
    host.dispatchEvent(new PointerEvent('pointerdown', { ...init, buttons: 1 }));
    host.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
  }
}
