import type { Clock } from '../core/types';

/** One Web Audio render quantum: 128 frames at 44.1 kHz is about 2.9 ms. */
const DEFAULT_QUANTUM_SEC = 128 / 44100;

/**
 * Pure, testable core of the clock. `readContextTime` and `readPerfMs` are injected.
 * The clock reports heard time: context time minus the output latency.
 */
export class AudioClock implements Clock {
  /** Output latency in seconds, fixed when playback is armed. */
  latencySec = 0;

  private lastContextTime = Number.NaN;
  private perfAtContextChange = 0;
  private lastReturned = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly readContextTime: () => number,
    private readonly readPerfMs: () => number,
    private readonly quantumSec: number = DEFAULT_QUANTUM_SEC,
  ) {}

  /** Heard time in seconds, monotonic. */
  now(): number {
    const ctx = this.readContextTime();
    // performance.now() is permitted here only to interpolate inside one render quantum.
    const perf = this.readPerfMs();
    if (ctx !== this.lastContextTime) {
      this.lastContextTime = ctx;
      this.perfAtContextChange = perf;
    }
    const elapsed = Math.min(Math.max((perf - this.perfAtContextChange) / 1000, 0), this.quantumSec);
    const heard = ctx + elapsed - this.latencySec;
    if (heard > this.lastReturned) this.lastReturned = heard;
    return this.lastReturned;
  }

  /** Clock time at which a DOM event with this `event.timeStamp` (performance ms) happened. */
  timeOfEvent(timeStampMs: number): number {
    // performance.now() is permitted here only to age an event timestamp onto the audio clock.
    const ageSec = (this.readPerfMs() - timeStampMs) / 1000;
    return this.now() - ageSec;
  }

  /** Context time at which to schedule audio so it is heard at clock time `t`. */
  toContextTime(t: number): number {
    return t + this.latencySec;
  }
}

export interface PlayHandle {
  stop(atClockTime?: number): void;
}

export interface LoopOptions {
  /** Clock time at which buffer position `offset` should be heard. */
  startTime: number;
  /** Seconds into the buffer that correspond to `startTime` (the first beat). Default 0. */
  offset?: number;
  /** Loop region in buffer seconds. Default: offset .. buffer.duration. */
  loopStart?: number;
  loopEnd?: number;
  gain?: number;
}

export class AudioEngine {
  readonly context: AudioContext;
  readonly clock: AudioClock;
  private readonly musicBus: GainNode;
  private readonly sfxBus: GainNode;
  private readonly active = new Set<AudioBufferSourceNode>();

  constructor() {
    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.clock = new AudioClock(
      () => this.context.currentTime,
      () => performance.now(),
    );
    this.musicBus = this.context.createGain();
    this.sfxBus = this.context.createGain();
    this.musicBus.connect(this.context.destination);
    this.sfxBus.connect(this.context.destination);
  }

  get running(): boolean {
    return this.context.state === 'running';
  }

  /** Call from a user gesture. Resumes the context and fixes the latency value. */
  async resume(): Promise<void> {
    if (this.context.state !== 'running') await this.context.resume();
    const ctx = this.context;
    this.clock.latencySec = ctx.outputLatency || ctx.baseLatency || 0;
  }

  decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.context.decodeAudioData(data);
  }

  /** Start a looping buffer. If `startTime` is already in the past, start now at the matching position inside the loop. */
  playLoop(buffer: AudioBuffer, opts: LoopOptions): PlayHandle {
    const offset = opts.offset ?? 0;
    const loopStart = opts.loopStart ?? offset;
    const loopEnd = opts.loopEnd ?? buffer.duration;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = loopStart;
    source.loopEnd = loopEnd;
    const gain = this.context.createGain();
    gain.gain.value = opts.gain ?? 1;
    source.connect(gain).connect(this.musicBus);

    const ctxStart = this.clock.toContextTime(opts.startTime);
    const nowCtx = this.context.currentTime;
    if (ctxStart >= nowCtx) {
      source.start(ctxStart, offset);
    } else {
      let pos = offset + (nowCtx - ctxStart);
      const loopLen = loopEnd - loopStart;
      if (loopLen > 0 && pos >= loopEnd) pos = loopStart + ((pos - loopStart) % loopLen);
      source.start(0, pos);
    }
    return this.track(source, gain);
  }

  /** One-shot, heard at clock time `when` (default: as soon as possible). */
  playOnce(buffer: AudioBuffer, when?: number, gain = 1): PlayHandle {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const g = this.context.createGain();
    g.gain.value = gain;
    source.connect(g).connect(this.sfxBus);
    source.start(when === undefined ? 0 : Math.max(0, this.clock.toContextTime(when)));
    return this.track(source, g);
  }

  setMusicVolume(v: number): void {
    this.musicBus.gain.value = Math.min(1, Math.max(0, v));
  }

  setSfxVolume(v: number): void {
    this.sfxBus.gain.value = Math.min(1, Math.max(0, v));
  }

  stopAll(): void {
    for (const s of [...this.active]) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.active.clear();
  }

  private track(source: AudioBufferSourceNode, gain: GainNode): PlayHandle {
    this.active.add(source);
    source.onended = () => {
      this.active.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    return {
      stop: (atClockTime?: number) => {
        try {
          source.stop(atClockTime === undefined ? 0 : Math.max(0, this.clock.toContextTime(atClockTime)));
        } catch {
          // not started or already stopped
        }
      },
    };
  }
}
