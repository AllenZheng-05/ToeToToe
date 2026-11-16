import { foldBpm } from '../core/beat';
import { DEFAULT_NAME, MAX_NAME_LENGTH, cleanText } from '../core/text';
import { themeBeatOk, validateTunables } from '../core/tunables';
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
import { ArrivalLog, newSyncStats, type SyncStats } from './syncStats';

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
  /** `peerBack`: the friend left the victory screen for the room (they withdrew or never asked). */
  | { type: 'rematch'; local: boolean; peer: boolean; peerBack: boolean }
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
  /** Whether this side's audio clock is running (a suspended AudioContext is not). Default: always. */
  isClockRunning?: () => boolean;
  /**
   * Whether drawings or songs are moving over the link. Pings sent or answered behind a file queue come
   * back late, so nothing is measured while this is true. Tell the room when it changes with `transfersChanged`.
   */
  transfersActive?: () => boolean;
}

/** Pings in a burst, and the gap between them. */
const SYNC_PINGS = 8;
const SYNC_GAP_MS = 120;
/** Give up waiting for the rest of a burst after this long (with at least one sample). */
const SYNC_TIMEOUT_MS = 3000;
/** Lobby re-ping interval once synced, and while still waiting for a first estimate. */
const SYNC_REPEAT_MS = 5000;
const SYNC_REPEAT_UNSYNCED_MS = 1000;
/** Pings sent at once to check a suspected clock jump. */
const SYNC_RECHECK_PINGS = 3;
/** How many of the latest samples the estimate is taken from. */
const SYNC_WINDOW = 8;
/** During a match: one ping this often (ordinary timers; this is not beat timing). */
const MATCH_PING_MS = 4000;
/** A sample is only evidence of a clock jump if its round trip is within this factor of the best recent one... */
const COMPARABLE_RTT_FACTOR = 1.5;
/** ...plus this many seconds. */
const COMPARABLE_RTT_SLACK_SEC = 0.005;
/** Pings that were sent but never answered are forgotten beyond this many. */
const MAX_PINGS_OUT = 32;
/** While the local audio clock is not running, look again this often. */
const NOT_RUNNING_RETRY_MS = 250;
/** Pings the host must have answered since its clock restarted for the guest's next ready/rematch to count as measured again. */
const FRESH_PONGS = 3;
/** How often the host looks at whether its own audio clock is still running. */
const CLOCK_WATCH_MS = 250;
/**
 * The host's longest wait for a fresh sync after its own clock stopped and restarted, before starting anyway.
 * Longer than SYNC_TIMEOUT_MS: a burst has finished (with whatever it measured) by then.
 */
const START_WAIT_MS = 3500;

const MAX_THEME_TITLE = 80;
const MAX_FIELD_CHARS = 200;

const DEFAULT_THEME: ThemeOffer = {
  source: 'click',
  id: 'click',
  title: 'Click track',
  bpm: 120,
  firstBeatOffset: 0,
};

interface Sample {
  /** Host clock minus this clock, seconds, assuming the same delay each way. */
  offset: number;
  /** Seconds. The true offset lies within `offset` plus or minus half of this, whatever the delays were. */
  rtt: number;
  /** This side's clock when the pong arrived. */
  at: number;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isThemeOffer(v: unknown, tunables: Tunables): v is ThemeOffer {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  if (t.source !== 'house' && t.source !== 'upload' && t.source !== 'click') return false;
  if (typeof t.id !== 'string' || t.id.length > MAX_FIELD_CHARS) return false;
  if (typeof t.title !== 'string') return false;
  if (t.hash !== undefined && (typeof t.hash !== 'string' || t.hash.length > MAX_FIELD_CHARS)) return false;
  if (t.bytes !== undefined && (!isFiniteNumber(t.bytes) || t.bytes < 0)) return false;
  return themeBeatOk(t.source, t.bpm, t.firstBeatOffset, tunables);
}

export class Room {
  readonly role: 'host' | 'guest';
  readonly localPlayer: PlayerId;

  private readonly transport: Transport;
  private readonly clock: Clock;
  private readonly tunables: Tunables;
  private readonly defer: (fn: () => void, ms: number) => void;
  private readonly isClockRunning: () => boolean;
  private name: string;
  private listeners = new Set<(e: RoomEvent) => void>();
  private unsubs: Unsubscribe[] = [];

  private _peerName: string | null = null;
  private _localReady = false;
  private _peerReady = false;
  private _localRematch = false;
  private _peerRematch = false;
  private _peerBack = false;
  private _synced: boolean;
  private _offsetSec = 0;
  private _rttMs: number | null = null;
  private _theme: ThemeOffer | null;
  private readonly stats: SyncStats = newSyncStats();
  private readonly arrivalLog = new ArrivalLog();

  private helloSent = false;
  private mismatch = false;
  private closedEmitted = false;
  private done = false;
  private matchCount = 0;

  // this side's own audio clock
  private clockWasRunning = true;
  private clockEpoch = 0;

  // guest clock sync
  private syncStarted = false;
  private syncGen = 0;
  private nextPingId = 0;
  private pingsSent = new Map<number, { t0: number; epoch: number; transferGen: number }>();
  private samples: Sample[] = [];
  private jumpSuspect: Sample | null = null;
  private hasEstimate = false;
  /** Pings go out (lobby rate, or the slow match rate while `matchSync`). */
  private pinging = true;
  /** In a match: ping slowly and only record what is learned; Ready and `synced` are not touched. */
  private matchSync = false;
  private readonly transfersActive: () => boolean;
  /** Bumped whenever transfers are seen to be active, so a sample that spanned one can be told. */
  private transferGen = 0;
  private wasTransferring = false;
  /** Guest: the offset the match's grid was built on, and the one the grid follows now. */
  private offsetAtStart = 0;
  private gridOffsetSec = 0;
  private burstPongs = 0;
  private burstTarget = SYNC_PINGS;
  private burstTimedOut = false;
  /** Guest: after the next burst, say again that it is ready / wants a rematch (the host may be waiting for that). */
  private ackPending = false;

  // host start gating
  private startGate: () => boolean = () => true;
  private hostClockDirty = false;
  private pongsSinceDirty = 0;
  private pendingStart: { leadSec: number; stillWanted: () => boolean } | null = null;

  constructor(opts: RoomOptions) {
    this.transport = opts.transport;
    this.clock = opts.clock;
    this.tunables = opts.tunables;
    this.name = opts.name;
    this.defer = opts.defer ?? ((fn, ms) => void setTimeout(fn, ms));
    this.isClockRunning = opts.isClockRunning ?? (() => true);
    this.transfersActive = opts.transfersActive ?? (() => false);
    this.role = opts.transport.role;
    this.localPlayer = this.role === 'host' ? 0 : 1;
    this._synced = this.role === 'host';
    this._theme = this.role === 'host' ? { ...DEFAULT_THEME } : null;
    this.clockWasRunning = this.isClockRunning();

    this.unsubs.push(
      this.transport.onMessage((m) => this.onMessage(m)),
      this.transport.onState((s) => this.onTransportState(s)),
    );
    if (this.role === 'host') this.watchClock();
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
  /** What the clock estimate stands on (guest) and how the match drifted since it started; updated in place. */
  get syncStats(): SyncStats {
    return this.stats;
  }
  /** How early or late the friend's plants, commits and resolves arrived against the local beat (this match). */
  get arrivals(): ArrivalLog {
    return this.arrivalLog;
  }
  /**
   * Guest, in a match: the shift (seconds) to add to this side's grid start so that it follows the best clock
   * estimate now, or null when the estimate has not moved by more than `clockJumpMs` since the grid was set.
   * The room never moves a grid itself; the match applies it between acts and then calls `acceptGridShift`.
   */
  pendingGridShiftSec(): number | null {
    if (this.role !== 'guest' || !this.matchSync || !this.hasEstimate) return null;
    const moved = this._offsetSec - this.gridOffsetSec;
    return Math.abs(moved) * 1000 > this.tunables.clockJumpMs ? -moved : null;
  }
  /** The match moved its grid to follow the estimate: it is the new reference. */
  acceptGridShift(): void {
    this.gridOffsetSec = this._offsetSec;
    this.stats.gridShifts++;
  }
  /** Drawings or songs started or stopped moving (see `transfersActive`): measure again once they stop. */
  transfersChanged(): void {
    if (this.transfersActive()) {
      this.transferGen++;
      this.wasTransferring = true;
      return;
    }
    if (!this.wasTransferring) return;
    this.wasTransferring = false;
    this.transferGen++;
    // The clocks may have moved while files were in the way; what was measured before them is not to be trusted.
    if (this.role === 'guest' && this.syncStarted && !this.matchSync && !this.done) {
      this.startBurst(SYNC_PINGS);
    }
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
    // A fresh burst of samples while the player decides, so the estimate at the start is current.
    if (ready && this.role === 'guest' && this._synced) this.resumeSync();
    this.emitReady();
  }

  setTheme(theme: ThemeOffer): void {
    if (this.role !== 'host') return;
    this._theme = { ...theme };
    this.transport.send({ t: 'theme', theme: this._theme });
  }

  /**
   * Host only: whether the match may start as far as the rest of the room goes (the friend has loaded the
   * battle theme). Asked before a start from the lobby and before a rematch starts.
   */
  setStartGate(gate: () => boolean): void {
    this.startGate = gate;
  }

  /** Host only: look again at a waiting rematch (the start gate may have opened). */
  retryRematch(): void {
    this.maybeRematchStart();
  }

  /** Host only; no-op unless both are ready and the guest is synced. */
  start(leadSec: number = this.tunables.startLeadSec): boolean {
    if (this.role !== 'host' || this.done || this.mismatch) return false;
    if (this.transport.state !== 'open') return false;
    if (!this._localReady || !this._peerReady) return false;
    if (!this.startGate()) return false;
    return this.requestStart(leadSec, () => this._localReady && this._peerReady);
  }

  requestRematch(): void {
    if (this.done || this.mismatch || this._localRematch) return;
    this._localRematch = true;
    this.transport.send({ t: 'rematch' });
    // A fresh burst of samples while both decide.
    if (this.role === 'guest') {
      this.ackPending = true;
      this.resumeSync();
    }
    this.emitRematch();
    this.maybeRematchStart();
  }

  /** Withdraws this side's rematch request, and tells the friend this side has left the victory screen. */
  cancelRematch(): void {
    if (this.done || this.mismatch) return;
    this._localRematch = false;
    this.transport.send({ t: 'rematch', want: false });
    this.emitRematch();
  }

  /** The lobby is showing again (after a match): ping at the slow rate and take a fresh burst now. */
  resumeLobby(): void {
    if (this.done) return;
    this.resumeSync();
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
    this.emit({
      type: 'rematch',
      local: this._localRematch,
      peer: this._peerRematch,
      peerBack: this._peerBack,
    });
  }

  /** Stop all pacing and listening. */
  private finish(): void {
    this.done = true;
    this.pendingStart = null;
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
        if (msg.ready) this.onFreshAck();
        return;
      case 'ping':
        if (this.role === 'host' && isFiniteNumber(msg.id) && isFiniteNumber(msg.t0)) {
          // A side whose audio clock is not running does not answer: its time would mean nothing.
          if (!this.checkClock()) return;
          this.pongsSinceDirty++;
          this.transport.send({ t: 'pong', id: msg.id, t0: msg.t0, t1: this.clock.now() });
        }
        return;
      case 'pong':
        if (this.role === 'guest') this.onPong(msg.id, msg.t1);
        return;
      case 'resync':
        if (this.role === 'guest') this.onResync();
        return;
      case 'start':
        return this.onStart(msg);
      case 'rematch': {
        const want = msg.want !== false;
        this._peerRematch = want;
        this._peerBack = !want;
        this.emitRematch();
        if (want) {
          this.onFreshAck();
          this.maybeRematchStart();
        }
        return;
      }
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
    const clean = cleanText(name, MAX_NAME_LENGTH, DEFAULT_NAME);
    const first = this._peerName === null;
    this._peerName = clean;
    this.emit({ type: 'peer', name: clean });
    // The other side may have said hello before we were listening: answer a first hello once.
    if (first) this.sendHello();
    if (this.role === 'guest' && !this.syncStarted) this.startSync();
  }

  private onTheme(theme: unknown): void {
    if (this.role !== 'guest' || !isThemeOffer(theme, this.tunables)) return;
    const clean: ThemeOffer = { ...theme, title: cleanText(theme.title, MAX_THEME_TITLE, 'Theme') };
    if (this._theme && JSON.stringify(this._theme) === JSON.stringify(clean)) return;
    this._theme = clean;
    this.emit({ type: 'theme', theme: this._theme });
  }

  private onTunables(tunables: unknown): void {
    if (this.role !== 'guest') return;
    const valid = validateTunables(tunables);
    if (valid === null) return;
    for (const key of Object.keys(this.tunables) as (keyof Tunables)[]) {
      this.tunables[key] = valid[key];
    }
  }

  // ------------------------------------------------------------ own clock

  /** True while this side's audio clock runs. Notices a stop followed by a restart: nothing measured before it holds. */
  private checkClock(): boolean {
    if (!this.isClockRunning()) {
      this.clockWasRunning = false;
      return false;
    }
    if (!this.clockWasRunning) {
      this.clockWasRunning = true;
      this.onClockRestarted();
    }
    return true;
  }

  private onClockRestarted(): void {
    this.clockEpoch++;
    if (this.role === 'host') {
      // The guest's offset to this clock is stale until it has measured again.
      this.hostClockDirty = true;
      this.pongsSinceDirty = 0;
      this.transport.send({ t: 'resync' });
      return;
    }
    this.samples = [];
    this.jumpSuspect = null;
    this.hasEstimate = false;
    this.stats.samples = 0;
    this.pingsSent.clear();
    if (!this.matchSync) this.markUnsynced();
    if (this.syncStarted && this.pinging) this.startBurst(SYNC_PINGS);
  }

  /** Host: notice a stopped and restarted audio clock even when nothing else is going on. */
  private watchClock(): void {
    this.defer(() => {
      if (this.done) return;
      this.checkClock();
      this.watchClock();
    }, CLOCK_WATCH_MS);
  }

  // ------------------------------------------------------------ clock sync (guest drives)

  private startSync(): void {
    this.syncStarted = true;
    this.pinging = true;
    this.startBurst(SYNC_PINGS);
  }

  /** Back to the lobby rate (lobby, victory screen): a fresh burst now, then the slow rate. */
  private resumeSync(): void {
    if (this.role !== 'guest') return;
    this.matchSync = false;
    this.pinging = true;
    this.stats.driftMs = null;
    if (this.syncStarted) this.startBurst(SYNC_PINGS);
  }

  /** The host's clock restarted: what was measured against it is out of date. Measure again, and say so when done. */
  private onResync(): void {
    this.ackPending = true;
    this.markUnsynced();
    // In a match the slow pings find the new offset (a confirmed jump takes a fresh burst); a rematch measures again.
    if (this.syncStarted && this.pinging && !this.matchSync) this.startBurst(SYNC_PINGS);
  }

  private markUnsynced(): void {
    if (!this._synced) return;
    this._synced = false;
    this.burstTimedOut = false;
    // The friend must not start on an estimate that may be wrong.
    if (this._localReady) this.transport.send({ t: 'ready', ready: false });
  }

  private sendPing(): void {
    // A ping behind a file comes back late: wait until nothing is moving.
    if (this.transfersActive()) {
      this.transferGen++;
      this.wasTransferring = true;
      return;
    }
    const id = this.nextPingId++;
    const t0 = this.clock.now();
    this.pingsSent.set(id, { t0, epoch: this.clockEpoch, transferGen: this.transferGen });
    if (this.pingsSent.size > MAX_PINGS_OUT) {
      const oldest = this.pingsSent.keys().next().value;
      if (oldest !== undefined) this.pingsSent.delete(oldest);
    }
    this.transport.send({ t: 'ping', id, t0 });
  }

  /** Begins a burst of `count` pings; it replaces any burst or repeat loop already running. */
  private startBurst(count: number): void {
    const gen = ++this.syncGen;
    this.burstPongs = 0;
    this.burstTarget = count;
    this.burstTimedOut = false;
    this.pingStep(gen, 0, count);
    this.defer(() => {
      if (gen !== this.syncGen || this.done) return;
      this.burstTimedOut = true;
      this.maybeFinishSync();
    }, SYNC_TIMEOUT_MS);
  }

  private pingStep(gen: number, i: number, n: number): void {
    if (gen !== this.syncGen || this.done || !this.pinging) return;
    if (!this.checkClock()) {
      this.defer(() => this.pingStep(gen, i, n), NOT_RUNNING_RETRY_MS);
      return;
    }
    if (gen !== this.syncGen) return; // the clock had restarted and began a burst of its own
    this.sendPing();
    if (i + 1 < n) this.defer(() => this.pingStep(gen, i + 1, n), SYNC_GAP_MS);
    else this.scheduleRepeat(gen);
  }

  private scheduleRepeat(gen: number): void {
    this.defer(
      () => {
        if (gen !== this.syncGen || this.done || !this.pinging) return;
        if (this.checkClock() && gen === this.syncGen) this.sendPing();
        if (gen === this.syncGen) this.scheduleRepeat(gen);
      },
      this.matchSync ? MATCH_PING_MS : this._synced ? SYNC_REPEAT_MS : SYNC_REPEAT_UNSYNCED_MS,
    );
  }

  private onPong(id: unknown, t1: unknown): void {
    if (!isFiniteNumber(id) || !isFiniteNumber(t1)) return;
    const sent = this.pingsSent.get(id);
    if (sent === undefined) return;
    this.pingsSent.delete(id);
    // Samples taken while the local clock was not running say nothing about the offset.
    if (!this.checkClock() || sent.epoch !== this.clockEpoch) return;
    const t3 = this.clock.now();
    const rtt = t3 - sent.t0;
    if (rtt < 0) return;
    this.stats.lastRttMs = rtt * 1000;
    // Files were moving while this was out (or are now): the pong queued behind them, so its time means little.
    if (sent.transferGen !== this.transferGen || this.transfersActive()) {
      this.stats.discarded++;
      return;
    }
    this.burstPongs++;
    this.addSample({ offset: t1 - (sent.t0 + t3) / 2, rtt, at: t3 });
    this.maybeFinishSync();
  }

  /** Whether this round trip is close to the best recent one, so its offset is as good a witness as the estimate. */
  private comparable(s: Sample): boolean {
    let best = Number.POSITIVE_INFINITY;
    for (const x of this.samples) if (x.rtt < best) best = x.rtt;
    return s.rtt <= best * COMPARABLE_RTT_FACTOR + COMPARABLE_RTT_SLACK_SEC;
  }

  /**
   * Evidence that the clock jumped: a comparable sample whose offset is more than `clockJumpMs` from the
   * estimate AND whose possible range (its offset plus or minus half its round trip) does not meet the
   * estimate's. Slow samples and plain asymmetric delays always meet it, so they are never taken for a jump.
   */
  private isJumpEvidence(s: Sample): boolean {
    const jumpSec = this.tunables.clockJumpMs / 1000;
    const apart = Math.abs(s.offset - this._offsetSec);
    if (apart <= jumpSec) return false;
    const estimateRtt = (this._rttMs ?? 0) / 1000;
    return this.comparable(s) && apart > (s.rtt + estimateRtt) / 2;
  }

  private addSample(s: Sample): void {
    const jumpSec = this.tunables.clockJumpMs / 1000;
    if (this.hasEstimate && this.isJumpEvidence(s)) {
      const prev = this.jumpSuspect;
      if (prev !== null && Math.abs(prev.offset - s.offset) <= jumpSec) {
        this.confirmJump();
        return;
      }
      // One odd sample: do not believe it yet. Check it with a few more pings; Ready is left alone.
      this.jumpSuspect = s;
      this.startBurst(SYNC_RECHECK_PINGS);
      return;
    }
    // A good sample that agrees with the estimate clears any suspicion.
    if (this.hasEstimate && this.comparable(s)) this.jumpSuspect = null;
    this.samples.push(s);
    if (this.samples.length > SYNC_WINDOW) this.samples.splice(0, this.samples.length - SYNC_WINDOW);
    if (this.recompute() && this._synced) this.emitSynced();
  }

  /**
   * Two comparable samples in a row agree on a new offset: a clock jumped. What was measured before is stale,
   * so it is dropped and the estimate is taken again from a fresh burst's best round trip (not from the two
   * samples that raised the alarm). The friend's start is held meanwhile, except in a match, where nothing waits.
   */
  private confirmJump(): void {
    this.stats.jumps++;
    this.samples = [];
    this.jumpSuspect = null;
    this.hasEstimate = false;
    this.stats.samples = 0;
    if (!this.matchSync) this.markUnsynced();
    this.startBurst(SYNC_PINGS);
  }

  /** The estimate is the sample with the lowest round trip in the window. True when it changed. */
  private recompute(): boolean {
    let best = this.samples[0];
    if (best === undefined) return false;
    // The newest of equal round trips wins, so a steady drift is followed.
    for (const s of this.samples) if (s.rtt <= best.rtt) best = s;
    const changed = !this.hasEstimate || best.offset !== this._offsetSec || best.rtt * 1000 !== this._rttMs;
    this.hasEstimate = true;
    this._offsetSec = best.offset;
    this._rttMs = best.rtt * 1000;
    this.stats.offsetMs = best.offset * 1000;
    this.stats.estimateAt = best.at;
    this.stats.bestRttMs = best.rtt * 1000;
    this.stats.samples = this.samples.length;
    if (this.matchSync) this.stats.driftMs = (this._offsetSec - this.offsetAtStart) * 1000;
    return changed;
  }

  private emitSynced(): void {
    this.emit({ type: 'synced', offsetSec: this._offsetSec, rttMs: this._rttMs ?? 0 });
  }

  /** Synced once a burst has come back (or timed out with at least one sample); then re-send what was held back. */
  private maybeFinishSync(): void {
    if (!this.hasEstimate) return;
    if (this.burstPongs < this.burstTarget && !this.burstTimedOut) return;
    const wasSynced = this._synced;
    if (!wasSynced) {
      this._synced = true;
      this.emitSynced();
    }
    if (!wasSynced || this.ackPending) {
      this.ackPending = false;
      if (this._localReady) this.transport.send({ t: 'ready', ready: true });
      if (this._localRematch) this.transport.send({ t: 'rematch' });
    }
  }

  // ------------------------------------------------------------ start and rematch

  /**
   * Host: start now, or, when this clock stopped and restarted since the guest last measured it, wait for
   * the guest to measure again (it answers with ready or rematch) for a bounded time, then start anyway.
   */
  private requestStart(leadSec: number, stillWanted: () => boolean): boolean {
    if (!this.checkClock()) return false;
    if (this.hostClockDirty) {
      if (this.pendingStart === null) {
        this.pendingStart = { leadSec, stillWanted };
        this.defer(() => this.flushStart(), START_WAIT_MS);
      }
      return true;
    }
    this.startMatch(leadSec);
    return true;
  }

  private flushStart(): void {
    const pending = this.pendingStart;
    if (pending === null) return;
    this.pendingStart = null;
    this.hostClockDirty = false;
    if (this.done || this.mismatch || this.transport.state !== 'open') return;
    if (!pending.stillWanted()) return;
    this.startMatch(pending.leadSec);
  }

  /**
   * The guest has said it is ready or wants a rematch: if the host has answered a burst since its clock
   * restarted, the guest has measured it again, so the wait is over.
   */
  private onFreshAck(): void {
    if (this.role !== 'host' || !this.hostClockDirty || this.pongsSinceDirty < FRESH_PONGS) return;
    if (this.pendingStart !== null) this.flushStart();
    else this.hostClockDirty = false;
  }

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
    if (!isFiniteNumber(msg.startTime) || !isFiniteNumber(msg.bpm)) return;
    if (msg.bpm < this.tunables.minBpm || msg.bpm > this.tunables.maxBpm) return;
    if (!Number.isSafeInteger(msg.firstPhrase) || msg.firstPhrase < 0) return;
    if (msg.firstAttacker !== 0 && msg.firstAttacker !== 1) return;
    this.beginMatch({
      grid: { bpm: msg.bpm, startTime: msg.startTime - this._offsetSec },
      firstAttacker: msg.firstAttacker,
      firstPhrase: msg.firstPhrase,
    });
  }

  private beginMatch(info: StartInfo): void {
    const gen = ++this.syncGen;
    this.ackPending = false;
    this.pendingStart = null;
    this.hostClockDirty = false;
    this._localReady = false;
    this._peerReady = false;
    this._localRematch = false;
    this._peerRematch = false;
    this._peerBack = false;
    this.arrivalLog.reset();
    if (this.role === 'guest') {
      // Keep measuring through the match, slowly. What is learned is recorded; the grid only follows it between acts.
      this.matchSync = true;
      this.pinging = true;
      this.offsetAtStart = this._offsetSec;
      this.gridOffsetSec = this._offsetSec;
      this.jumpSuspect = null;
      this.stats.driftMs = 0;
      this.stats.gridShifts = 0;
      if (this.syncStarted) this.scheduleRepeat(gen);
    }
    this.emit({ type: 'start', info });
    this.emitReady();
    this.emitRematch();
  }

  private maybeRematchStart(): void {
    if (this.role !== 'host' || !this._localRematch || !this._peerRematch || this.done) return;
    if (!this.startGate()) return;
    this.requestStart(this.tunables.startLeadSec, () => this._localRematch && this._peerRematch);
  }
}
