import type { BeatGrid, Tunables } from './types';

/** Halve or double until within [minBpm, maxBpm]. Non-finite or non-positive input gives 120. */
export function foldBpm(bpm: number, t: Tunables): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return 120;
  let b = bpm;
  for (let i = 0; i < 64 && b > t.maxBpm; i++) b /= 2;
  for (let i = 0; i < 64 && b < t.minBpm; i++) b *= 2;
  return b;
}

export function slotsPerPhrase(t: Tunables): number {
  return t.beatsPerPhrase * t.slotsPerBeat;
}

/** Seconds. */
export function slotDuration(bpm: number, t: Tunables): number {
  return 60 / bpm / t.slotsPerBeat;
}

/** Seconds. */
export function phraseDuration(bpm: number, t: Tunables): number {
  return slotDuration(bpm, t) * slotsPerPhrase(t);
}

export function phraseStart(grid: BeatGrid, phrase: number, t: Tunables): number {
  return grid.startTime + phrase * phraseDuration(grid.bpm, t);
}

export function slotTime(grid: BeatGrid, phrase: number, slot: number, t: Tunables): number {
  return phraseStart(grid, phrase, t) + slot * slotDuration(grid.bpm, t);
}

/** Floor; negative before startTime. */
export function phraseAt(grid: BeatGrid, time: number, t: Tunables): number {
  return Math.floor((time - grid.startTime) / phraseDuration(grid.bpm, t));
}

/** Positions are fractional and within the phrase. */
export function positionAt(
  grid: BeatGrid,
  time: number,
  t: Tunables,
): { phrase: number; slotPosition: number; beatPosition: number } {
  const phrase = phraseAt(grid, time, t);
  const spp = slotsPerPhrase(t);
  const raw = (time - phraseStart(grid, phrase, t)) / slotDuration(grid.bpm, t);
  const slotPosition = Math.min(spp, Math.max(0, raw));
  return { phrase, slotPosition, beatPosition: slotPosition / t.slotsPerBeat };
}

/** Rounds to the nearest slot, possibly into slot 0 of the next phrase. offsetSec = time - slotTime (negative = early). */
export function nearestSlot(
  grid: BeatGrid,
  time: number,
  t: Tunables,
): { phrase: number; slot: number; offsetSec: number } {
  const spp = slotsPerPhrase(t);
  // `+ 0` normalises -0 to 0.
  const total = Math.round((time - grid.startTime) / slotDuration(grid.bpm, t)) + 0;
  const phrase = Math.floor(total / spp) + 0;
  const slot = total - phrase * spp;
  return { phrase, slot, offsetSec: time - slotTime(grid, phrase, slot, t) };
}
