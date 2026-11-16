# Brief C: tempo detection and beat-setting helpers

**Goal.** Find a song's tempo and first-beat offset, and the pure helpers the battle theme screen needs to let a player correct them (nudges, tap-along). No UI.

**Read first:** `CLAUDE.md`, `docs/GAME.md` (Songs: "Setting the beat"), `src/core/beat.ts` (`foldBpm`), and the README and typings of `web-audio-beat-detector` in `node_modules` (version 8.2.39 is installed; follow its actual API).

**Files you own (create):** `src/audio/tempo.ts`, `tests/unit/tempo.test.ts`. Touch nothing else. Add no dependencies.

## Interfaces

```ts
// src/audio/tempo.ts
export interface BeatSetting {
  bpm: number;              // folded into the tunables' range, rounded to 0.1
  firstBeatOffset: number;  // seconds from the start of the file to a beat, 0 <= offset < one beat
}
/** Runs web-audio-beat-detector's guess() (it assumes 90 to 180 BPM by default; pass the tunables' range if the API allows).
 * Never rejects: on failure or a silent buffer it resolves to { bpm: 120, firstBeatOffset: 0, detected: false }. */
export function detectBeat(buffer: AudioBuffer, t: Tunables): Promise<BeatSetting & { detected: boolean }>;
/** Pure. Normalises any offset into [0, beat). */
export function normaliseOffset(offsetSec: number, bpm: number): number;
/** Pure. Change the tempo by `deltaBpm` (e.g. +-0.1, +-1), keep it inside the tunables' range, re-normalise the offset. */
export function nudgeBpm(s: BeatSetting, deltaBpm: number, t: Tunables): BeatSetting;
/** Pure. Shift the first beat by `deltaMs` (e.g. +-5, +-20) and normalise. */
export function nudgeOffset(s: BeatSetting, deltaMs: number): BeatSetting;
/** Pure. Halve or double the tempo if the result stays in range; otherwise unchanged. */
export function halveOrDouble(s: BeatSetting, factor: 0.5 | 2, t: Tunables): BeatSetting;
/** Pure. Tempo from tap times (seconds, ascending): median interval of the last 8 taps; null with fewer than 4 taps or wildly uneven taps. Folded into range. */
export function tempoFromTaps(taps: readonly number[], t: Tunables): number | null;
/** Pure. Given taps made along to the song (song-position seconds) and a tempo, the first-beat offset that best fits them (circular mean of tap phases), normalised. Null with fewer than 4 taps. */
export function offsetFromTaps(taps: readonly number[], bpm: number): number | null;
/** Pure. How far the taps are from the beat grid on average, in ms, signed (positive = taps late). For the "tap-along check" read-out. */
export function tapError(taps: readonly number[], s: BeatSetting): number | null;
```

## Tests (`tests/unit/tempo.test.ts`)

All the pure helpers: normalising negative and large offsets; nudges at the range limits; halve/double in and out of range; taps at a steady 120 BPM give 120 within 0.5; jittered taps (a few ms) still do; 3 taps give null; taps at 60 BPM fold to 120; `offsetFromTaps` recovers a known offset within 2 ms including when the phases straddle the wrap-around; `tapError` sign and size. `detectBeat` needs a real `AudioBuffer`; test only its failure path with a fake object whose data is silent or whose methods throw, and say in your report that real detection is untested here.

## Checks that must pass

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm exec prettier --check src tests`. Other agents are working elsewhere at the same time; ignore failures that come only from their files and say so.

## Report (under 150 words)

What you built, how the library's API differed from the brief, check results, what is unverified.
