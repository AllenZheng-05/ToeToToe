import { AudioEngine } from '../audio/engine';
import { createTunables } from '../core/tunables';
import type { DuelSession, SessionEvent } from '../core/session';
import { createAccount, type Account } from '../data/account';
import { supabaseConfigFromEnv, type Remote } from '../data/remote';
import { openStore, SETTINGS, type Store } from '../data/store';
import { PRESETS } from '../puppet/presets';
import { DEFAULT_BOT_SETUP, parseBotSetup, type BotSetup } from '../scenes/botSetupModel';
import { clampOffset } from '../scenes/calibrationModel';
import { cleanName, loadName, saveName } from './profile';
import type { Tunables, Unsubscribe } from '../core/types';
import type { MatchSetup, Scene } from '../scenes/types';
import { Stage } from '../stage/stage';
import type { Connection } from './connection';
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
/** How many session events are kept for the debug hooks. */
const EVENT_HISTORY = 500;
/**
 * Adaptive resolution. A machine that cannot fill the screen quickly (no GPU, software GL) draws
 * frames a tenth of a second apart and blocks the page between them, which makes clicks late.
 * After this many slow frames the stage draws at half resolution. ?res=1 keeps full resolution.
 */
const SLOW_FRAME_MS = 50;
const SLOW_FRAMES_TO_DOWNSCALE = 20;
const LOW_RESOLUTION = 0.5;

/** The account: Supabase only when the build has its settings (a separate chunk, loaded on demand). */
async function createAppAccount(store: Store): Promise<Account> {
  let remote: Remote | null = null;
  const config = supabaseConfigFromEnv(import.meta.env);
  if (config) {
    try {
      const { createSupabaseRemote } = await import('../data/supabaseRemote');
      remote = await createSupabaseRemote(config);
    } catch {
      remote = null;
    }
  }
  return createAccount({ remote, store });
}

async function loadInputOffset(store: Store): Promise<number> {
  try {
    return clampOffset(await store.settings.get<number>(SETTINGS.inputOffsetMs, 0));
  } catch {
    return 0;
  }
}

const PRESET_IDS = PRESETS.map((p) => p.id);

async function loadBotSetup(store: Store): Promise<BotSetup> {
  try {
    return parseBotSetup(await store.settings.get<unknown>(SETTINGS.botSetup, null), PRESET_IDS);
  } catch {
    return { ...DEFAULT_BOT_SETUP };
  }
}

export class App {
  readonly params: AppParams;
  readonly tunables: Tunables;
  readonly stage: Stage;
  /** Settings, puppets and songs on this device (IndexedDB, or memory when that is unavailable). */
  readonly store: Store;
  /** The match being played, if any (read by the debug overlay). */
  match: MatchSetup | null = null;
  /** The local session of the current duel, if any. */
  session: DuelSession | null = null;
  /** Last judged input offsets of the local player, in milliseconds, oldest first. */
  readonly judgedOffsets: number[] = [];

  /** The player's display name (also kept in the store's settings). */
  displayName = '';
  /** Input calibration: milliseconds this player's taps are late (negative: early). Applied to every duel session. */
  inputOffsetMs = 0;
  /** The bot match set-up chosen on the "Play against the bot" screen (kept in the store's settings). */
  botSetup: BotSetup = { ...DEFAULT_BOT_SETUP };
  /** Saving across devices. Resolves once the (optional) Supabase client is ready; never rejects. */
  readonly account: Promise<Account>;
  /** False while a full-screen DOM scene (the workshop) hides the stage: the canvas is not redrawn. */
  rendering = true;

  /** The open room, if any (lobby, duel or victory screen of a two-player match). */
  connection: Connection | null = null;
  /** Session events seen, oldest first, capped. Read by the debug hooks. */
  readonly events: SessionEvent[] = [];
  /** Player healths after each judged strike, oldest first, capped. Debug hooks only. */
  readonly healthLog: { phrase: number; health: [number, number] }[] = [];

  private audio: AudioEngine | null = null;
  private scene: Scene | null = null;
  private readonly frameCallbacks = new Set<(info: FrameInfo) => void>();
  private hiddenTimer: number | null = null;
  private rafId = 0;
  private lastFrameStamp = 0;
  private slowFrames = 0;
  private readonly pinResolution = new URLSearchParams(window.location.search).get('res') === '1';

  private constructor(params: AppParams, stage: Stage, store: Store) {
    this.params = params;
    this.tunables = createTunables(params.tunables);
    this.stage = stage;
    this.store = store;
    this.account = createAppAccount(store);
  }

  static async create(host: HTMLElement, params: AppParams): Promise<App> {
    const [stage, store] = await Promise.all([Stage.create(host), openStore()]);
    const app = new App(params, stage, store);
    app.displayName = await loadName(store);
    app.inputOffsetMs = await loadInputOffset(store);
    app.botSetup = await loadBotSetup(store);
    app.start();
    // Never blocks the game: restores a saved session in the background, if there is an account service.
    void app.account.then((a) => a.init());
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

  /** Remember the calibrated offset (whole milliseconds) and use it from the next duel on. */
  setInputOffset(ms: number): number {
    this.inputOffsetMs = clampOffset(ms);
    void this.store.settings.set(SETTINGS.inputOffsetMs, this.inputOffsetMs).catch(() => undefined);
    return this.inputOffsetMs;
  }

  /** Change part of the bot set-up and remember it. Returns the new set-up. */
  setBotSetup(change: Partial<Pick<BotSetup, 'difficulty' | 'botPuppet'>>): BotSetup {
    this.botSetup = parseBotSetup({ ...this.botSetup, ...change }, PRESET_IDS);
    void this.store.settings.set(SETTINGS.botSetup, this.botSetup).catch(() => undefined);
    return this.botSetup;
  }

  /** Clean, remember and return the display name. */
  setDisplayName(raw: string): string {
    this.displayName = cleanName(raw);
    void saveName(this.store, this.displayName);
    return this.displayName;
  }

  recordJudgedOffset(ms: number): void {
    this.judgedOffsets.push(ms);
    if (this.judgedOffsets.length > JUDGED_HISTORY) this.judgedOffsets.shift();
  }

  recordEvent(e: SessionEvent): void {
    this.events.push(e);
    if (this.events.length > EVENT_HISTORY) this.events.shift();
  }

  recordHealth(): void {
    const s = this.session?.state;
    if (!s) return;
    this.healthLog.push({ phrase: s.phrase, health: [s.players[0].health, s.players[1].health] });
    if (this.healthLog.length > EVENT_HISTORY) this.healthLog.shift();
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
      if (this.rendering) this.stage.render();
      this.watchFrameRate(timestamp);
    };
    this.rafId = requestAnimationFrame(frame);

    // Browsers stop requestAnimationFrame in a hidden tab. This interval only polls the audio
    // clock so a background tab still commits and resolves its phrases; it times nothing.
    this.hiddenTimer = window.setInterval(() => {
      if (document.hidden) this.tick({ hidden: true, timestamp: performance.now() });
    }, HIDDEN_POLL_MS);
  }

  private watchFrameRate(timestamp: number): void {
    const gap = this.lastFrameStamp > 0 ? timestamp - this.lastFrameStamp : 0;
    this.lastFrameStamp = timestamp;
    if (this.pinResolution || this.stage.resolution <= LOW_RESOLUTION) return;
    this.slowFrames = gap > SLOW_FRAME_MS ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames >= SLOW_FRAMES_TO_DOWNSCALE) this.stage.setResolution(LOW_RESOLUTION);
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
