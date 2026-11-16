import { describe, expect, it } from 'vitest';
import {
  detectBeat,
  fmtBpm,
  parseBpmInput,
  halveOrDouble,
  nudgeBpm,
  nudgeOffset,
  normaliseOffset,
  offsetFromTaps,
  tapError,
  tempoFromTaps,
} from '../../src/audio/tempo';
import { createTunables } from '../../src/core/tunables';

const t = createTunables(); // 80..240
const s120 = { bpm: 120, firstBeatOffset: 0.1 }; // beat 0.5 s

function taps(bpm: number, n: number, start = 0, jitter: readonly number[] = [0]): number[] {
  const beat = 60 / bpm;
  return Array.from({ length: n }, (_, i) => start + i * beat + (jitter[i % jitter.length] as number));
}

describe('normaliseOffset', () => {
  it('handles negative, large and in-range offsets', () => {
    expect(normaliseOffset(-0.1, 120)).toBeCloseTo(0.4, 9);
    expect(normaliseOffset(3.2, 120)).toBeCloseTo(0.2, 9);
    expect(normaliseOffset(0.3, 120)).toBeCloseTo(0.3, 9);
    expect(normaliseOffset(0.5, 120)).toBeCloseTo(0, 9);
    expect(normaliseOffset(NaN, 120)).toBe(0);
  });
});

describe('nudgeBpm', () => {
  it('nudges and rounds to 0.01', () => {
    expect(nudgeBpm(s120, 0.1, t).bpm).toBe(120.1);
    expect(nudgeBpm(s120, -1, t).bpm).toBe(119);
    expect(nudgeBpm({ bpm: 222.22, firstBeatOffset: 0 }, 0.01, t).bpm).toBe(222.23);
    expect(nudgeBpm({ bpm: 222.22, firstBeatOffset: 0 }, -0.01, t).bpm).toBe(222.21);
  });
  it('clamps at the range limits', () => {
    expect(nudgeBpm({ bpm: 240, firstBeatOffset: 0 }, 1, t).bpm).toBe(240);
    expect(nudgeBpm({ bpm: 80, firstBeatOffset: 0 }, -1, t).bpm).toBe(80);
  });
  it('keeps the offset inside the new beat', () => {
    const r = nudgeBpm({ bpm: 80, firstBeatOffset: 0.7 }, 100, t);
    expect(r.firstBeatOffset).toBeGreaterThanOrEqual(0);
    expect(r.firstBeatOffset).toBeLessThan(60 / r.bpm);
  });
});

describe('nudgeOffset', () => {
  it('shifts and wraps', () => {
    expect(nudgeOffset(s120, 20).firstBeatOffset).toBeCloseTo(0.12, 9);
    expect(nudgeOffset(s120, -5).firstBeatOffset).toBeCloseTo(0.095, 9);
    expect(nudgeOffset(s120, -150).firstBeatOffset).toBeCloseTo(0.45, 9);
    expect(nudgeOffset({ bpm: 120, firstBeatOffset: 0.49 }, 20).firstBeatOffset).toBeCloseTo(0.01, 9);
  });
});

describe('halveOrDouble', () => {
  it('changes tempo when it stays in range', () => {
    expect(halveOrDouble({ bpm: 90, firstBeatOffset: 0.1 }, 2, t).bpm).toBe(180);
    expect(halveOrDouble({ bpm: 160, firstBeatOffset: 0.1 }, 0.5, t).bpm).toBe(80);
    expect(halveOrDouble({ bpm: 111.11, firstBeatOffset: 0.1 }, 2, t).bpm).toBe(222.22);
    expect(halveOrDouble({ bpm: 120, firstBeatOffset: 0.1 }, 2, t).bpm).toBe(240);
  });
  it('is unchanged when out of range', () => {
    const a = { bpm: 130, firstBeatOffset: 0.1 };
    expect(halveOrDouble(a, 2, t)).toEqual(a);
    expect(halveOrDouble(a, 0.5, t)).toEqual(a);
  });
  it('re-normalises the offset', () => {
    const r = halveOrDouble({ bpm: 90, firstBeatOffset: 0.6 }, 2, t);
    expect(r.firstBeatOffset).toBeLessThan(60 / 180);
  });
});

describe('tempoFromTaps', () => {
  it('reads steady 120 BPM', () => {
    expect(tempoFromTaps(taps(120, 6, 1.3), t)).toBeCloseTo(120, 0);
  });
  it('tolerates a few ms of jitter', () => {
    const r = tempoFromTaps(taps(120, 8, 0, [0.004, -0.003, 0.002, -0.004]), t);
    expect(Math.abs((r as number) - 120)).toBeLessThan(0.5);
  });
  it('needs 4 taps', () => {
    expect(tempoFromTaps(taps(120, 3), t)).toBeNull();
    expect(tempoFromTaps([], t)).toBeNull();
  });
  it('folds 60 BPM to 120', () => {
    expect(tempoFromTaps(taps(60, 6), t)).toBeCloseTo(120, 0);
  });
  it('rejects wildly uneven taps', () => {
    expect(tempoFromTaps([0, 0.5, 0.6, 2.5, 2.6], t)).toBeNull();
  });
  it('uses only the last 8 taps', () => {
    const early = [0, 0.1, 0.9]; // sloppy start
    const steady = taps(120, 8, 10);
    expect(tempoFromTaps([...early, ...steady], t)).toBeCloseTo(120, 0);
  });
});

describe('offsetFromTaps', () => {
  it('recovers a known offset', () => {
    const r = offsetFromTaps(taps(120, 8, 4.137), 120) as number;
    expect(Math.abs(r - 0.137)).toBeLessThan(0.002);
  });
  it('recovers it when phases straddle the wrap-around', () => {
    // Offset 0.001 with jitter pushes some taps just before the beat line.
    const r = offsetFromTaps(taps(120, 8, 3.001, [0.004, -0.004, 0.003, -0.003]), 120) as number;
    const diff = Math.min(Math.abs(r - 0.001), Math.abs(r - 0.001 - 0.5), Math.abs(r - 0.001 + 0.5));
    expect(diff).toBeLessThan(0.002);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(0.5);
  });
  it('recovers an offset just below one beat', () => {
    const r = offsetFromTaps(taps(120, 8, 2.499, [0.003, -0.003]), 120) as number;
    const diff = Math.min(Math.abs(r - 0.499), Math.abs(r - 0.499 + 0.5), Math.abs(r - 0.499 - 0.5));
    expect(diff).toBeLessThan(0.002);
  });
  it('needs 4 taps', () => {
    expect(offsetFromTaps(taps(120, 3), 120)).toBeNull();
  });
});

describe('tapError', () => {
  it('is positive when taps are late and negative when early', () => {
    const late = tapError(taps(120, 6, 0.1 + 0.02), s120) as number;
    const early = tapError(taps(120, 6, 0.1 - 0.015), s120) as number;
    expect(late).toBeCloseTo(20, 3);
    expect(early).toBeCloseTo(-15, 3);
  });
  it('is zero on the grid and null with no taps', () => {
    expect(tapError(taps(120, 6, 0.1), s120) as number).toBeCloseTo(0, 6);
    expect(tapError([], s120)).toBeNull();
  });
});

describe('detectBeat failure path', () => {
  const fake = (data: Float32Array): AudioBuffer =>
    ({
      numberOfChannels: 1,
      length: data.length,
      sampleRate: 44100,
      duration: data.length / 44100,
      getChannelData: () => data,
    }) as unknown as AudioBuffer;

  it('resolves to the fallback for a silent buffer', async () => {
    const r = await detectBeat(fake(new Float32Array(44100)), t);
    expect(r).toEqual({ bpm: 120, firstBeatOffset: 0, detected: false });
  });
  it('resolves to the fallback when the buffer throws', async () => {
    const bad = {
      numberOfChannels: 1,
      getChannelData: () => {
        throw new Error('boom');
      },
    } as unknown as AudioBuffer;
    const r = await detectBeat(bad, t);
    expect(r).toEqual({ bpm: 120, firstBeatOffset: 0, detected: false });
  });
  it('resolves to the fallback when detection cannot run on a fake buffer', async () => {
    const noise = new Float32Array(1000).fill(0.5);
    const r = await detectBeat(fake(noise), t);
    expect(r.detected).toBe(false);
  });
});

describe('two-decimal tempos', () => {
  it('formats up to two decimals without trailing zeros', () => {
    expect(fmtBpm(222.22)).toBe('222.22');
    expect(fmtBpm(120)).toBe('120');
    expect(fmtBpm(120.5)).toBe('120.5');
    expect(fmtBpm(99.999)).toBe('100');
  });
  it('parses a typed tempo and validates the range', () => {
    expect(parseBpmInput('222.22', 80, 240)).toBe(222.22);
    expect(parseBpmInput(' 100 BPM ', 80, 240)).toBe(100);
    expect(parseBpmInput('240', 80, 240)).toBe(240);
    expect(parseBpmInput('240.01', 80, 240)).toBeNull();
    expect(parseBpmInput('79.99', 80, 240)).toBeNull();
    expect(parseBpmInput('1e2', 80, 240)).toBeNull();
    expect(parseBpmInput('12.345', 80, 240)).toBeNull();
    expect(parseBpmInput('', 80, 240)).toBeNull();
  });
});
