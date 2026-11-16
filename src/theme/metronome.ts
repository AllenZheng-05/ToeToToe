import { createSfx } from '../audio/sfx';
import type { AudioEngine } from '../audio/engine';

/** How often the scheduler wakes. The audio clock, not this interval, times the ticks. */
const WAKE_INTERVAL_MS = 25;
/** Every beat falling inside this window ahead of now is scheduled on each wake. */
const LOOK_AHEAD_SEC = 0.12;

/**
 * Pure. Beat times (clock seconds) in [fromTime, toTime) that fall after `alreadyScheduledThrough`.
 * Beats are `startTime + k * 60 / bpm` for whole k >= 0, so a fractional tempo never drifts.
 */
export function beatsToSchedule(
  fromTime: number,
  toTime: number,
  grid: { bpm: number; startTime: number },
  alreadyScheduledThrough: number,
): number[] {
  const beat = 60 / grid.bpm;
  if (!(beat > 0) || !Number.isFinite(beat) || !(toTime > fromTime)) return [];
  const first = Math.max(0, Math.ceil((fromTime - grid.startTime) / beat) - 1);
  const out: number[] = [];
  for (let k = first; ; k++) {
    const t = grid.startTime + k * beat;
    if (t >= toTime) break;
    if (t >= fromTime && t > alreadyScheduledThrough) out.push(t);
  }
  return out;
}

/** A look-ahead metronome: `tick` sound effects on the beat, scheduled ahead on the audio clock. */
export function startMetronome(
  engine: AudioEngine,
  grid: { bpm: number; startTime: number },
): { stop(): void } {
  const sfx = createSfx(engine);
  let through = Number.NEGATIVE_INFINITY;
  const wake = (): void => {
    const now = engine.clock.now();
    for (const t of beatsToSchedule(now, now + LOOK_AHEAD_SEC, grid, through)) {
      sfx.play('tick', t);
      through = t;
    }
  };
  wake();
  const id = setInterval(wake, WAKE_INTERVAL_MS);
  return {
    stop() {
      clearInterval(id);
    },
  };
}
