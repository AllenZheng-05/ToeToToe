export interface ClickTrackSpec {
  bpm: number;
  beats: number; // loop length in beats
  sampleRate: number;
  beatsPerBar?: number; // accent every N beats; default 4
}

/** Samples of silence after the loop body so the loop end can be set exactly. */
const TAIL_SAMPLES = 64;
const TWO_PI = Math.PI * 2;

/** Deterministic noise source. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exact loop length in seconds: beats * 60 / bpm. */
export function clickLoopSeconds(spec: Pick<ClickTrackSpec, 'bpm' | 'beats'>): number {
  return (spec.beats * 60) / spec.bpm;
}

/** Pure sample generator (mono), usable in Node tests. */
export function renderClickTrack(spec: ClickTrackSpec): Float32Array {
  const { bpm, beats, sampleRate } = spec;
  const beatsPerBar = spec.beatsPerBar ?? 4;
  const beatSec = 60 / bpm;
  const bodyLen = Math.ceil(clickLoopSeconds(spec) * sampleRate);
  const mix = new Float32Array(bodyLen + TAIL_SAMPLES);
  const rand = mulberry32(0x70e70e);

  /** Add a sound starting at `onset`; samples past the loop end wrap to the start. */
  const add = (onset: number, seconds: number, fn: (t: number) => number): void => {
    const n = Math.floor(seconds * sampleRate);
    for (let k = 0; k < n; k++) {
      const idx = (onset + k) % bodyLen;
      mix[idx] = (mix[idx] ?? 0) + fn(k / sampleRate);
    }
  };

  const bassNotes = [55, 73.42];
  const halfBar = Math.max(1, Math.floor(beatsPerBar / 2));
  for (let b = 0; b < beats; b++) {
    const onset = Math.round(b * beatSec * sampleRate);
    const halfOnset = Math.round((b + 0.5) * beatSec * sampleRate);
    const accent = b % beatsPerBar === 0;

    // Kick: pitch-swept sine with exponential decay.
    const kickAmp = accent ? 0.5 : 0.4;
    add(onset, 0.22, (t) => {
      const phase = TWO_PI * (50 * t + 70 * 0.04 * (1 - Math.exp(-t / 0.04)));
      return kickAmp * Math.sin(phase) * Math.exp(-t / 0.06);
    });

    // Accent: bright two-sine ping on the first beat of each bar.
    if (accent) {
      add(
        onset,
        0.12,
        (t) =>
          0.22 * (Math.sin(TWO_PI * 1760 * t) + 0.5 * Math.sin(TWO_PI * 2640 * t)) * Math.exp(-t / 0.025),
      );
    }

    // Closed hat on the half beat: differenced noise burst.
    let prev = 0;
    add(halfOnset, 0.05, (t) => {
      const n = rand() * 2 - 1;
      const hp = n - prev;
      prev = n;
      return 0.12 * hp * Math.exp(-t / 0.012);
    });

    // Two-note bass pulse: one note on each half bar.
    if (b % halfBar === 0) {
      const f = bassNotes[(b / halfBar) % 2] ?? 55;
      add(onset, 0.3, (t) => 0.3 * Math.sin(TWO_PI * f * t) * Math.exp(-t / 0.1));
    }
  }

  let peak = 0;
  for (let i = 0; i < mix.length; i++) peak = Math.max(peak, Math.abs(mix[i] ?? 0));
  if (peak > 0.9) {
    const scale = 0.9 / peak;
    for (let i = 0; i < mix.length; i++) mix[i] = (mix[i] ?? 0) * scale;
  }
  return mix;
}

/** `beats` defaults to 16. */
export function createClickBuffer(ctx: BaseAudioContext, bpm: number, beats = 16): AudioBuffer {
  const data = renderClickTrack({ bpm, beats, sampleRate: ctx.sampleRate });
  const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buffer.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
  return buffer;
}
