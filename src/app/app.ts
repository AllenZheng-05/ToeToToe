import { AudioEngine } from '../audio/engine';
import { createTunables } from '../core/tunables';
import type { DuelSession } from '../core/session';
import type { Tunables, Unsubscribe } from '../core/types';
import type { MatchSetup, Scene } from '../scenes/types';
import { Stage } from '../stage/stage';
import type { AppParams } from './params';

export interface FrameInfo {
  /** True when the page is hidden: update the rules, skip drawing. */
  hidden: boolean;
  /** Milliseconds, only for frame-rate display and easing. Never used for beat timing. */
  timestamp: number;
}

/** How often a hidden tab is polled. */
const HIDDEN_POLL_MS = 100;
const JUDGED_HISTORY = 20;

export class App {
  readonly params: AppParams;
  readonly tunables: Tunables;
  readonly stage: Stage;
  /** The match being played, if any (read by the debug overlay). */
  match: MatchSetup | null = null;
  /** The local session of the current duel, if any. */
  session: DuelSession | null = null;
  /** Last judged input offsets of the local player, in milliseconds, oldest first. */
  readonly judgedOffsets: number[] = [];

  private audio: AudioEngine | null = null;
  private scene: Scene | null = null;
  private readonly frameCallbacks = new Set<(info: FrameInfo) => void>();
  private hiddenTimer: number | null = null;
  private rafId = 0;

  private constructor(params: AppParams, stage: Stage) {
    this.params = params;
    this.tunables = createTunables(params.tunables);
    this.stage = stage;
  }

  static async create(host: HTMLElement, params: AppParams): Promise<App> {
    const stage = await Stage.create(host);
    const app = new App(params, stage);
    app.start();
    return app;
  }

  /** The audio engine, created on first use so no AudioContext exists before a user gesture. */
  get engine(): AudioEngine {
    this.audio ??= new AudioEngine();
    return this.audio;
  }

  get hasEngine(): boolean {
    return this.audio !== null;
  }

  /** Overlay root in 1280x720 design pixels. */
  get overlay(): HTMLElement {
    return this.stage.overlay;
  }

  recordJudgedOffset(ms: number): void {
    this.judgedOffsets.push(ms);
    if (this.judgedOffsets.length > JUDGED_HISTORY) this.judgedOffsets.shift();
  }

  onFrame(cb: (info: FrameInfo) => void): Unsubscribe {
    this.frameCallbacks.add(cb);
    return () => this.frameCallbacks.delete(cb);
  }

  /** Leave the current scene and enter the next. */
  async go(next: Scene): Promise<void> {
    const previous = this.scene;
    this.scene = next;
    previous?.exit();
    // If another go() starts while this one is entering, it exits `next` itself.
    await next.enter();
  }

  private start(): void {
    const frame = (timestamp: number): void => {
      this.rafId = requestAnimationFrame(frame);
      this.tick({ hidden: false, timestamp });
      this.stage.render();
    };
    this.rafId = requestAnimationFrame(frame);

    // Browsers stop requestAnimationFrame in a hidden tab. This interval only polls the audio
    // clock so a background tab still commits and resolves its phrases; it times nothing.
    this.hiddenTimer = window.setInterval(() => {
      if (document.hidden) this.tick({ hidden: true, timestamp: performance.now() });
    }, HIDDEN_POLL_MS);
  }

  private tick(info: FrameInfo): void {
    for (const cb of [...this.frameCallbacks]) cb(info);
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    if (this.hiddenTimer !== null) window.clearInterval(this.hiddenTimer);
    this.scene?.exit();
    this.scene = null;
    this.stage.destroy();
  }
}
