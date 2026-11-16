import type { App } from '../app/app';
import { slotTime } from '../core/beat';
import type { BeatGrid, Tunables } from '../core/types';

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
 * Plays scripted clicks for tests (debug mode only): each due event is a click on the local session at
 * the event's slot time.
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

  /**
   * Hands the click to the local session stamped with its exact slot time (plus the event's shift),
   * the way the bot driver does, not with the time this code happens to run. A browser without a GPU
   * can block the main thread for a tenth of a second per frame, and a click that is late by that much
   * would be judged a different slot. The pointer path itself is covered by the human-click test.
   */
  private click(e: ScriptEvent): void {
    const { app } = this;
    const session = app.session;
    const match = app.match;
    if (!session || !match) return;
    const time = slotTime(match.grid, e.phrase, e.slot, app.tunables) + (e.offsetMs ?? 0) / 1000;
    session.pointerDown(e.x, e.y, time, false);
  }
}
