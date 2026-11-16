import { foldBpm } from '../core/beat';
import type { Tunables } from '../core/types';

export interface BeatSetting {
  /** Folded into the tunables' range, rounded to 0.01. */
  bpm: number;
  /** Seconds from the start of the file to a beat, 0 <= offset < one beat. */
  firstBeatOffset: number;
}

const FALLBACK_BPM = 120;
/** Taps used for a tempo estimate. */
const TEMPO_TAP_WINDOW = 8;
const MIN_TAPS = 4;
/** A tap interval this far (as a fraction) from the median counts as uneven. */
const MAX_INTERVAL_DEVIATION = 0.35;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Up to two decimals, no trailing zeros: 222.22, 120.5, 100. */
export function fmtBpm(bpm: number): string {
  return String(Math.round(bpm * 100) / 100);
}

/** Parses typed tempo text ("222.22") into [minBpm, maxBpm] with two decimals; null if it is not a number in range. */
export function parseBpmInput(text: string, min: number, max: number): number | null {
  const s = text.trim().replace(/\s*bpm$/i, '');
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Pure. Normalises any offset into [0, beat). */
export function normaliseOffset(offsetSec: number, bpm: number): number {
  const beat = 60 / bpm;
  if (!Number.isFinite(offsetSec) || !Number.isFinite(beat) || beat <= 0) return 0;
  const r = offsetSec - Math.floor(offsetSec / beat) * beat;
  return r >= beat || r < 0 ? 0 : r;
}

function silent(buffer: AudioBuffer): boolean {
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0) return false;
    }
  }
  return true;
}

/** Runs web-audio-beat-detector's guess() over the tunables' tempo range. Never rejects. */
export async function detectBeat(
  buffer: AudioBuffer,
  t: Tunables,
): Promise<BeatSetting & { detected: boolean }> {
  const failed = { bpm: FALLBACK_BPM, firstBeatOffset: 0, detected: false };
  try {
    if (silent(buffer)) return failed;
    // Loaded on demand: the library spins up a worker when imported.
    const { guess } = await import('web-audio-beat-detector');
    const found = await guess(buffer, {
      minTempo: t.minBpm,
      maxTempo: t.maxBpm,
    });
    const { offset } = found;
    // The library rounds `bpm` to a whole number but also returns the unrounded `tempo`
    // (untyped); keep that for two-decimal precision.
    const exact = (found as { tempo?: unknown }).tempo;
    const guessed = typeof exact === 'number' && Number.isFinite(exact) && exact > 0 ? exact : found.bpm;
    if (!Number.isFinite(guessed) || guessed <= 0) return failed;
    const bpm = round2(foldBpm(guessed, t));
    return {
      bpm,
      firstBeatOffset: normaliseOffset(Number.isFinite(offset) ? offset : 0, bpm),
      detected: true,
    };
  } catch {
    return failed;
  }
}

/** Pure. Change the tempo by `deltaBpm`, keep it inside the tunables' range, re-normalise the offset. */
export function nudgeBpm(s: BeatSetting, deltaBpm: number, t: Tunables): BeatSetting {
  const bpm = round2(Math.min(t.maxBpm, Math.max(t.minBpm, s.bpm + deltaBpm)));
  return { bpm, firstBeatOffset: normaliseOffset(s.firstBeatOffset, bpm) };
}

/** Pure. Shift the first beat by `deltaMs` and normalise. */
export function nudgeOffset(s: BeatSetting, deltaMs: number): BeatSetting {
  return {
    bpm: s.bpm,
    firstBeatOffset: normaliseOffset(s.firstBeatOffset + deltaMs / 1000, s.bpm),
  };
}

/** Pure. Halve or double the tempo if the result stays in range; otherwise unchanged. */
export function halveOrDouble(s: BeatSetting, factor: 0.5 | 2, t: Tunables): BeatSetting {
  const bpm = round2(s.bpm * factor);
  if (bpm < t.minBpm || bpm > t.maxBpm) return s;
  return { bpm, firstBeatOffset: normaliseOffset(s.firstBeatOffset, bpm) };
}

/** Pure. Tempo from tap times (seconds, ascending): slope of the last 8 taps, after rejecting uneven ones by median interval. */
export function tempoFromTaps(taps: readonly number[], t: Tunables): number | null {
  if (taps.length < MIN_TAPS) return null;
  const recent = taps.slice(-TEMPO_TAP_WINDOW);
  const intervals: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const d = (recent[i] as number) - (recent[i - 1] as number);
    if (!Number.isFinite(d) || d <= 0) return null;
    intervals.push(d);
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  if (intervals.some((d) => Math.abs(d - median) > median * MAX_INTERVAL_DEVIATION)) return null;
  // Least-squares slope over the window: the median screens out uneven taps, the
  // slope averages out a few ms of jitter.
  const n = recent.length;
  const meanX = (n - 1) / 2;
  const meanY = recent.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  recent.forEach((y, i) => {
    num += (i - meanX) * (y - meanY);
    den += (i - meanX) ** 2;
  });
  return round2(foldBpm(60 / (num / den), t));
}

/** Pure. The first-beat offset that best fits taps made along to the song (circular mean of phases). */
export function offsetFromTaps(taps: readonly number[], bpm: number): number | null {
  if (taps.length < MIN_TAPS || !(bpm > 0)) return null;
  const beat = 60 / bpm;
  let sx = 0;
  let sy = 0;
  for (const tap of taps) {
    const phase = ((tap % beat) / beat) * 2 * Math.PI;
    sx += Math.cos(phase);
    sy += Math.sin(phase);
  }
  if (sx === 0 && sy === 0) return null;
  const angle = Math.atan2(sy, sx);
  return normaliseOffset((angle / (2 * Math.PI)) * beat, bpm);
}

/** Pure. Mean distance of the taps from the beat grid in ms, signed (positive = taps late). */
export function tapError(taps: readonly number[], s: BeatSetting): number | null {
  if (taps.length === 0 || !(s.bpm > 0)) return null;
  const beat = 60 / s.bpm;
  let sum = 0;
  for (const tap of taps) {
    const d = tap - s.firstBeatOffset;
    sum += d - Math.round(d / beat) * beat;
  }
  return (sum / taps.length) * 1000;
}
