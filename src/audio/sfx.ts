import type { AudioEngine } from './engine';

export type SfxName = 'plant' | 'bravo' | 'good' | 'miss' | 'tick' | 'actOver';

const TWO_PI = Math.PI * 2;

interface Note {
  at: number; // seconds from start
  freq: number;
  dur: number;
  amp: number;
  /** Frequency factor reached at the end of the note (1 = no slide). */
  slide?: number;
  noise?: boolean;
}

const RECIPES: Record<SfxName, Note[]> = {
  plant: [{ at: 0, freq: 220, dur: 0.12, amp: 0.5, slide: 0.5 }],
  bravo: [
    { at: 0, freq: 880, dur: 0.12, amp: 0.4 },
    { at: 0.07, freq: 1320, dur: 0.2, amp: 0.4 },
  ],
  good: [{ at: 0, freq: 660, dur: 0.14, amp: 0.4 }],
  miss: [
    { at: 0, freq: 160, dur: 0.22, amp: 0.4, slide: 0.5 },
    { at: 0, freq: 0, dur: 0.12, amp: 0.2, noise: true },
  ],
  tick: [{ at: 0, freq: 1500, dur: 0.03, amp: 0.4 }],
  actOver: [
    { at: 0, freq: 784, dur: 0.18, amp: 0.4 },
    { at: 0.16, freq: 523, dur: 0.18, amp: 0.4 },
    { at: 0.32, freq: 392, dur: 0.4, amp: 0.4 },
  ],
};

function synth(name: SfxName, sampleRate: number): Float32Array {
  const notes = RECIPES[name];
  const total = Math.max(...notes.map((n) => n.at + n.dur));
  const out = new Float32Array(Math.ceil(total * sampleRate));
  let seed = 12345;
  for (const n of notes) {
    const start = Math.floor(n.at * sampleRate);
    const len = Math.floor(n.dur * sampleRate);
    let phase = 0;
    for (let k = 0; k < len && start + k < out.length; k++) {
      const t = k / sampleRate;
      const env = Math.exp(-t / (n.dur / 4));
      let v: number;
      if (n.noise) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        v = (seed / 4294967296) * 2 - 1;
      } else {
        const f = n.freq * (1 + ((n.slide ?? 1) - 1) * (t / n.dur));
        phase += (TWO_PI * f) / sampleRate;
        v = Math.sin(phase);
      }
      const idx = start + k;
      out[idx] = (out[idx] ?? 0) + n.amp * env * v;
    }
  }
  return out;
}

/** Short synthesised effects, built once per engine and cached. `when` is clock time; default: now. */
export function createSfx(engine: AudioEngine): { play(name: SfxName, when?: number): void } {
  const cache = new Map<SfxName, AudioBuffer>();
  return {
    play(name, when) {
      let buf = cache.get(name);
      if (!buf) {
        const ctx = engine.context;
        const data = synth(name, ctx.sampleRate);
        buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
        buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
        cache.set(name, buf);
      }
      engine.playOnce(buf, when);
    },
  };
}
