// Generates the placeholder house tracks into public/tracks/.
// Run with `pnpm tracks`. Deterministic: no Math.random, same bytes every run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 22050;
const TWO_PI = Math.PI * 2;
const STEPS_PER_BAR = 16; // sixteenth notes in 4/4

type Wave = 'square' | 'tri' | 'saw' | 'sine';

interface TrackSpec {
  id: string;
  title: string;
  file: string;
  bpm: number;
  bars: number;
  /** Kick, snare, hat: one character per sixteenth over one bar; 'x' hit, '.' rest. 'a' is an accented hat. */
  kick: string;
  snare: string;
  hat: string;
  /** MIDI note of the bass root for each bar of a repeating progression. */
  bassRoots: number[];
  /** Bass: one character per sixteenth over one bar. 'r' root, 'f' fifth, 'o' octave, '.' rest. */
  bass: string;
  bassWave: Wave;
  /** Melody over two bars (32 sixteenths): scale degree digits 0-7 (index into `scale`), '.' rest, '-' hold. */
  melody: string;
  scale: number[];
  melodyWave: Wave;
  melodyGain: number;
}

const MAJOR = [60, 62, 64, 65, 67, 69, 71, 72];
const MINOR = [57, 59, 60, 62, 64, 65, 67, 69];

const TRACKS: TrackSpec[] = [
  {
    id: 'placeholder-march-100',
    title: 'Placeholder: March (100)',
    file: 'placeholder-march-100.wav',
    bpm: 100,
    // 12 bars keeps the file under 1.5 MB at this tempo (16 bars would be 1.69 MB).
    bars: 12,
    kick: 'x...x...x...x...',
    snare: '....x.......x.x.',
    hat: '................',
    bassRoots: [43, 43, 48, 43],
    bass: 'r...f...r...f...',
    bassWave: 'tri',
    melody: '4-.4-.5-.4-.2-.2-.-.-.4-.4-.5-.7-.5-.4-.2-.-.-.',
    scale: MAJOR,
    melodyWave: 'square',
    melodyGain: 0.1,
  },
  {
    id: 'placeholder-waltz-off-126',
    title: 'Placeholder: Waltz Off (126)',
    file: 'placeholder-waltz-off-126.wav',
    bpm: 126,
    bars: 16,
    kick: 'x.......x.......',
    snare: '........x.......',
    hat: '..a...a...a...a.',
    bassRoots: [45, 45, 41, 43],
    bass: 'r.....o.r.....f.',
    bassWave: 'sine',
    melody: '0.2.4.-.7.-.4.2.5.-.4.-.2.0.-.',
    scale: MINOR,
    melodyWave: 'tri',
    melodyGain: 0.2,
  },
  {
    id: 'placeholder-gallop-152',
    title: 'Placeholder: Gallop (152)',
    file: 'placeholder-gallop-152.wav',
    bpm: 152,
    bars: 16,
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: 'xaxaxaxaxaxaxaxa',
    bassRoots: [40, 40, 43, 38],
    bass: 'r.rrr.rrr.rrr.rr',
    bassWave: 'saw',
    melody: '7.5.7.-.5.-.4.5.7.-.9.7.5.4.2.-.',
    scale: MAJOR.concat([74, 76]),
    melodyWave: 'saw',
    melodyGain: 0.07,
  },
];

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

const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

function osc(wave: Wave, phase: number): number {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 'sine':
      return Math.sin(TWO_PI * p);
    case 'square':
      return p < 0.5 ? 1 : -1;
    case 'saw':
      return 2 * p - 1;
    case 'tri':
      return 4 * Math.abs(p - 0.5) - 1;
  }
}

function render(spec: TrackSpec): Float32Array {
  const beatSamples = (60 / spec.bpm) * SAMPLE_RATE;
  const stepSamples = beatSamples / 4;
  const totalSteps = spec.bars * STEPS_PER_BAR;
  const len = Math.round(totalSteps * stepSamples);
  const mix = new Float32Array(len);
  const rand = mulberry32(0x70e70e ^ spec.bpm);

  /** Add a sound at a sample onset; the tail wraps to the loop start so the loop is seamless. */
  const add = (onset: number, seconds: number, fn: (t: number) => number): void => {
    const n = Math.floor(seconds * SAMPLE_RATE);
    for (let k = 0; k < n; k++) {
      const idx = (onset + k) % len;
      mix[idx] = (mix[idx] ?? 0) + fn(k / SAMPLE_RATE);
    }
  };

  const tone = (
    onset: number,
    seconds: number,
    hz: number,
    wave: Wave,
    gain: number,
    decay: number,
  ): void => {
    add(onset, seconds, (t) => {
      const attack = Math.min(1, t / 0.004);
      const release = Math.min(1, (seconds - t) / 0.01);
      return gain * attack * Math.max(0, release) * Math.exp(-t / decay) * osc(wave, hz * t);
    });
  };

  const melodyLen = spec.melody.length;
  for (let s = 0; s < totalSteps; s++) {
    const onset = Math.round(s * stepSamples);
    const inBar = s % STEPS_PER_BAR;
    const bar = Math.floor(s / STEPS_PER_BAR);

    if (spec.kick[inBar] === 'x') {
      add(onset, 0.22, (t) => {
        const phase = TWO_PI * (48 * t + 70 * 0.04 * (1 - Math.exp(-t / 0.04)));
        return 0.5 * Math.sin(phase) * Math.exp(-t / 0.07);
      });
    }
    if (spec.snare[inBar] === 'x') {
      add(
        onset,
        0.16,
        (t) => (0.25 * (rand() * 2 - 1) + 0.15 * Math.sin(TWO_PI * 190 * t)) * Math.exp(-t / 0.045),
      );
    }
    const h = spec.hat[inBar];
    if (h === 'x' || h === 'a') {
      const amp = h === 'a' ? 0.16 : 0.09;
      let prev = 0;
      add(onset, 0.05, (t) => {
        const n = rand() * 2 - 1;
        const hp = n - prev;
        prev = n;
        return amp * hp * Math.exp(-t / 0.012);
      });
    }

    const b = spec.bass[inBar];
    if (b && b !== '.') {
      const root = spec.bassRoots[bar % spec.bassRoots.length] ?? 40;
      const note = b === 'f' ? root + 7 : b === 'o' ? root + 12 : root;
      tone(onset, (stepSamples * 1.8) / SAMPLE_RATE, midiHz(note), spec.bassWave, 0.3, 0.15);
    }

    // Melody covers two bars and repeats; a '-' extends the previous note.
    const m = spec.melody[s % melodyLen];
    if (m && m !== '.' && m !== '-') {
      let held = 1;
      while (spec.melody[(s + held) % melodyLen] === '-' && held < melodyLen) held++;
      const degree = spec.scale[Number(m)] ?? 60;
      tone(
        onset,
        (stepSamples * held * 0.92) / SAMPLE_RATE,
        midiHz(degree + 12),
        spec.melodyWave,
        spec.melodyGain,
        0.4,
      );
    }
  }

  let peak = 0;
  for (const v of mix) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) {
    const scale = 0.85 / peak;
    for (let i = 0; i < mix.length; i++) mix[i] = (mix[i] ?? 0) * scale;
  }
  return mix;
}

function encodeWav(samples: Float32Array): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'tracks');
mkdirSync(outDir, { recursive: true });

const manifest = TRACKS.map((spec) => {
  const wav = encodeWav(render(spec));
  writeFileSync(join(outDir, spec.file), wav);
  console.log(`${spec.file}: ${wav.length} bytes`);
  return {
    id: spec.id,
    title: spec.title,
    file: spec.file,
    bpm: spec.bpm,
    firstBeatOffset: 0,
    credit: 'Generated placeholder',
    licence: 'Generated by scripts/generate-tracks.ts; no third-party rights',
  };
});
writeFileSync(join(outDir, 'tracks.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('tracks.json written');
