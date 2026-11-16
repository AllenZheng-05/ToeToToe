import { foldBpm } from '../core/beat';
import type {
  BeatGrid,
  Clock,
  Message,
  PlayerId,
  ThemeOffer,
  Transport,
  TransportState,
  Tunables,
  Unsubscribe,
} from '../core/types';

export interface StartInfo {
  /** In THIS browser's clock. */
  grid: BeatGrid;
  firstAttacker: PlayerId;
  firstPhrase: number;
}

export type RoomEvent =
  | { type: 'peer'; name: string }
  | { type: 'ready'; local: boolean; peer: boolean }
  | { type: 'synced'; offsetSec: number; rttMs: number }
  | { type: 'theme'; theme: ThemeOffer }
  | { type: 'start'; info: StartInfo }
  | { type: 'rematch'; local: boolean; peer: boolean }
  | { type: 'state'; state: TransportState }
  | { type: 'versionMismatch' };

export const PROTOCOL_VERSION = 1;

export interface RoomOptions {
  transport: Transport;
  clock: Clock;
  name: string;
  /** Host: sent to the guest. Guest: overwritten in place with the host's values. */
  tunables: Tunables;
  /** Schedules a callback; defaults to setTimeout. Used only for ping pacing, never for beat timing. */
  defer?: (fn: () => void, ms: number) => void;
}

/** Pings in the first burst, and the gap between them. */
const SYNC_PINGS = 8;
const SYNC_GAP_MS = 120;
/** Give up waiting for the rest of the burst after this long (with at least one sample). */
const SYNC_TIMEOUT_MS = 3000;
/** Lobby re-ping interval after the burst. */
const SYNC_REPEAT_MS = 5000;
/** Default seconds between `start` and the first beat. */
const DEFAULT_LEAD_SEC = 3;

const DEFAULT_THEME: ThemeOffer = {
  source: 'click',
  id: 'click',
  title: 'Click track',
  bpm: 120,
  firstBeatOffset: 0,
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isThemeOffer(v: unknown): v is ThemeOffer {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    (t.source === 'house' || t.source === 'upload' || t.source === 'click') &&
    typeof t.id === 'string' &&
    typeof t.title === 'string' &&
    isFiniteNumber(t.bpm) &&
    isFiniteNumber(t.firstBeatOffset)
  );
}

export class Room {
  readonly role: 'host' | 'guest';
  readonly localPlayer: PlayerId;

  private readonly transport: Transport;
  private readonly clock: Clock;
  private readonly tunables: Tunables;
  private readonly defer: (fn: () => void, ms: number) => void;
  private name: string;
  private listeners = new Set<(e: RoomEvent) => void>();
  private unsubs: Unsubscribe[] = [];

  private _peerName: string | null = null;
  private _localReady = false;
  private _peerReady = false;
  private _localRematch = false;
  private _peerRematch = false;
  private _synced: boolean;
  private _offsetSec = 0;
  private _rttMs: number | null = null;
  private _theme: ThemeOffer | null;

  private helloSent = false;
  private mismatch = false;
  private closedEmitted = false;
  private done = false;
  private matchCount = 0;

  // guest clock sync
  private syncStarted = false;
  private syncTimedOut = false;
  private lobbyPinging = true;
  private nextPingId = 0;
  private pingsSent = new Map<number, number>();
  private pongsGot = 0;
  private bestRtt = Infinity;

  constructor(opts: RoomOptions) {
    this.transport = opts.transport;
    this.clock = opts.clock;
    this.tunables = opts.tunables;
    this.name = opts.name;
    this.defer = opts.defer ?? ((fn, ms) => void setTimeout(fn, ms));
    this.role = opts.transport.role;
    this.localPlayer = this.role === 'host' ? 0 : 1;
    this._synced = this.role === 'host';
    this._theme = this.role === 'host' ? { ...DEFAULT_THEME } : null;

    this.unsubs.push(
      this.transport.onMessage((m) => this.onMessage(m)),
      this.transport.onState((s) => this.onTransportState(s)),
    );
    if (this.transport.state === 'open') this.onOpen();
  }

  get peerName(): string | null {
    return this._peerName;
  }
  get localReady(): boolean {
    return this._localReady;
  }
  get peerReady(): boolean {
    return this._peerReady;
  }
  get synced(): boolean {
    return this._synced;
  }
  /** Host clock minus this clock, seconds (0 on the host). */
  get clockOffsetSec(): number {
    return this._offsetSec;
  }
  get rttMs(): number | null {
    return this._rttMs;
  }
  get theme(): ThemeOffer | null {
    return this._theme;
  }

  on(cb: (e: RoomEvent) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  setName(name: string): void {
    this.name = name;
    if (this.helloSent) this.sendHello();
  }

  setReady(ready: boolean): void {
    if (this.done || this.mismatch) return;
    this._localReady = ready;
    // A guest's true is only sent once its clock is synced; until then the wish is remembered.
    if (!ready || this._synced) this.transport.send({ t: 'ready', ready });
    this.emitReady();
  }

  setTheme(theme: ThemeOffer): void {
    if (this.role !== 'host') return;
    this._theme = { ...theme };
    this.transport.send({ t: 'theme', theme: this._theme });
  }

  /** Host only; no-op unless both are ready and the guest is synced. */
  start(leadSec: number = DEFAULT_LEAD_SEC): boolean {
    if (this.role !== 'host' || this.done || this.mismatch) return false;
    if (this.transport.state !== 'open') return false;
    if (!this._localReady || !this._peerReady) return false;
    this.startMatch(leadSec);
    return true;
  }

  requestRematch(): void {
    if (this.done || this.mismatch) return;
    this._localRematch = true;
    this.transport.send({ t: 'rematch' });
    this.emitRematch();
    this.maybeRematchStart();
  }

  leave(): void {
    if (this.done) return;
    this.transport.send({ t: 'leave' });
    this.finish();
    this.transport.close();
  }

  // ------------------------------------------------------------ internals

  private emit(e: RoomEvent): void {
    for (const cb of [...this.listeners]) cb(e);
  }

  private emitReady(): void {
    this.emit({ type: 'ready', local: this._localReady, peer: this._peerReady });
  }

  private emitRematch(): void {
    this.emit({ type: 'rematch', local: this._localRematch, peer: this._peerRematch });
  }

  /** Stop all pacing and listening. */
  private finish(): void {
    this.done = true;
    for (const u of this.unsubs.splice(0)) u();
  }

  private onTransportState(state: TransportState): void {
    if (this.done) return;
    if (state === 'closed') {
      this.emitClosed();
      this.finish();
      return;
    }
    this.emit({ type: 'state', state });
    if (state === 'open') this.onOpen();
  }

  private emitClosed(): void {
    if (this.closedEmitted) return;
    this.closedEmitted = true;
    this.emit({ type: 'state', state: 'closed' });
  }

  private onOpen(): void {
    if (this.helloSent) return;
    this.sendHello();
    if (this._localReady && this._synced) this.transport.send({ t: 'ready', ready: true });
  }

  private sendHello(): void {
    this.helloSent = true;
    this.transport.send({ t: 'hello', name: this.name, v: PROTOCOL_VERSION });
    if (this.role === 'host') {
      if (this._theme) this.transport.send({ t: 'theme', theme: this._theme });
      this.transport.send({ t: 'tunables', tunables: { ...this.tunables } });
    }
  }

  private onMessage(msg: Message): void {
    if (this.done || this.mismatch) return;
    switch (msg.t) {
      case 'hello':
        return this.onHello(msg.name, msg.v);
      case 'theme':
        return this.onTheme(msg.theme);
      case 'tunables':
        return this.onTunables(msg.tunables);
      case 'ready':
        if (typeof msg.ready !== 'boolean') return;
        this._peerReady = msg.ready;
        this.emitReady();
        return;
      case 'ping':
        if (this.role === 'host' && isFiniteNumber(msg.id) && isFiniteNumber(msg.t0)) {
          this.transport.send({ t: 'pong', id: msg.id, t0: msg.t0, t1: this.clock.now() });
        }
        return;
      case 'pong':
        if (this.role === 'guest') this.onPong(msg.id, msg.t1);
        return;
      case 'start':
        return this.onStart(msg);
      case 'rematch':
        this._peerRematch = true;
        this.emitRematch();
        this.maybeRematchStart();
        return;
      case 'leave':
        this.emitClosed();
        return;
      default:
        return; // duel messages belong to DuelSession
    }
  }

  private onHello(name: unknown, v: unknown): void {
    if (v !== PROTOCOL_VERSION) {
      this.mismatch = true;
      this.emit({ type: 'versionMismatch' });
      return;
    }
    if (typeof name !== 'string') return;
    const first = this._peerName === null;
    this._peerName = name;
    this.emit({ type: 'peer', name });
    // The other side may have said hello before we were listening: answer a first hello once.
    if (first) this.sendHello();
    if (this.role === 'guest' && !this.syncStarted) this.startSync();
  }

  private onTheme(theme: unknown): void {
    if (this.role !== 'guest' || !isThemeOffer(theme)) return;
    if (this._theme && JSON.stringify(this._theme) === JSON.stringify(theme)) return;
    this._theme = { ...theme };
    this.emit({ type: 'theme', theme: this._theme });
  }

  private onTunables(tunables: unknown): void {
    if (this.role !== 'guest' || typeof tunables !== 'object' || tunables === null) return;
    const src = tunables as Record<string, unknown>;
    for (const key of Object.keys(this.tunables) as (keyof Tunables)[]) {
      const v = src[key];
      if (isFiniteNumber(v)) this.tunables[key] = v;
    }
  }

  // ------------------------------------------------------------ clock sync (guest drives)

  private startSync(): void {
    this.syncStarted = true;
    this.sendBurstPing(0);
    this.defer(() => {
      this.syncTimedOut = true;
      this.maybeFinishSync(false);
    }, SYNC_TIMEOUT_MS);
  }

  private sendPing(): void {
    const id = this.nextPingId++;
    const t0 = this.clock.now();
    this.pingsSent.set(id, t0);
    this.transport.send({ t: 'ping', id, t0 });
  }

  private sendBurstPing(i: number): void {
    if (this.done || !this.lobbyPinging) return;
    this.sendPing();
    if (i + 1 < SYNC_PINGS) {
      this.defer(() => this.sendBurstPing(i + 1), SYNC_GAP_MS);
    } else {
      this.scheduleRepeat();
    }
  }

  private scheduleRepeat(): void {
    this.defer(() => {
      if (this.done || !this.lobbyPinging) return;
      this.sendPing();
      this.scheduleRepeat();
    }, SYNC_REPEAT_MS);
  }

  private onPong(id: unknown, t1: unknown): void {
    if (!isFiniteNumber(id) || !isFiniteNumber(t1)) return;
    const t0 = this.pingsSent.get(id);
    if (t0 === undefined) return;
    this.pingsSent.delete(id);
    const t3 = this.clock.now();
    const rtt = t3 - t0;
    this.pongsGot++;
    let improved = false;
    if (rtt < this.bestRtt) {
      this.bestRtt = rtt;
      this._offsetSec = t1 - (t0 + t3) / 2;
      this._rttMs = rtt * 1000;
      improved = true;
    }
    this.maybeFinishSync(improved);
  }

  /** Emit `synced` after the burst (or timeout), and again whenever a later sample improves the estimate. */
  private maybeFinishSync(improved: boolean): void {
    if (this.bestRtt === Infinity) return;
    if (!this._synced) {
      if (this.pongsGot < SYNC_PINGS && !this.syncTimedOut) return;
      this._synced = true;
      this.emit({ type: 'synced', offsetSec: this._offsetSec, rttMs: this._rttMs ?? 0 });
      if (this._localReady) this.transport.send({ t: 'ready', ready: true });
    } else if (improved) {
      this.emit({ type: 'synced', offsetSec: this._offsetSec, rttMs: this._rttMs ?? 0 });
    }
  }

  // ------------------------------------------------------------ start and rematch

  private startMatch(leadSec: number): void {
    const startTime = this.clock.now() + leadSec;
    const bpm = foldBpm(this._theme?.bpm ?? DEFAULT_THEME.bpm, this.tunables);
    const firstPhrase = this.tunables.countInPhrases;
    const firstAttacker: PlayerId = this.matchCount % 2 === 0 ? 0 : 1;
    this.matchCount++;
    this.transport.send({ t: 'tunables', tunables: { ...this.tunables } });
    this.transport.send({ t: 'start', startTime, bpm, firstAttacker, firstPhrase });
    this.beginMatch({ grid: { bpm, startTime }, firstAttacker, firstPhrase });
  }

  private onStart(msg: Extract<Message, { t: 'start' }>): void {
    if (this.role !== 'guest') return;
    if (!isFiniteNumber(msg.startTime) || !isFiniteNumber(msg.bpm) || msg.bpm <= 0) return;
    if (!isFiniteNumber(msg.firstPhrase)) return;
    if (msg.firstAttacker !== 0 && msg.firstAttacker !== 1) return;
    this.beginMatch({
      grid: { bpm: msg.bpm, startTime: msg.startTime - this._offsetSec },
      firstAttacker: msg.firstAttacker,
      firstPhrase: msg.firstPhrase,
    });
  }

  private beginMatch(info: StartInfo): void {
    this.lobbyPinging = false;
    this._localReady = false;
    this._peerReady = false;
    this._localRematch = false;
    this._peerRematch = false;
    this.emit({ type: 'start', info });
    this.emitReady();
    this.emitRematch();
  }

  private maybeRematchStart(): void {
    if (this.role === 'host' && this._localRematch && this._peerRematch && !this.done) {
      this.startMatch(DEFAULT_LEAD_SEC);
    }
  }
}
