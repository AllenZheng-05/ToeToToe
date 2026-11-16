import { nearestSlot, phraseDuration, phraseStart, positionAt, slotTime } from './beat';
import {
  checkedStrikes,
  defenderOf,
  initialDuelState,
  judgeParry,
  otherPlayer,
  parseDuelState,
  plantError,
  reduceDuel,
} from './duel';
import type {
  BeatGrid,
  Clock,
  DuelEvent,
  DuelState,
  DuelView,
  Grade,
  Message,
  PlayerId,
  Strike,
  TargetView,
  Transport,
  Tunables,
  Unsubscribe,
  ViewPhase,
} from './types';

export interface DuelSessionOptions {
  localPlayer: PlayerId;
  clock: Clock;
  grid: BeatGrid;
  transport: Transport;
  /** Held by reference and read on every call, so live edits take effect. */
  tunables: Tunables;
  firstAttacker: PlayerId;
  /** Absolute phrase index of the first attack phrase (count-in phrases come before it). */
  firstPhrase: number;
  /** Milliseconds subtracted from click times before judging. Settable later via the property. */
  inputOffsetMs?: number;
}

/** The messages whose arrival is measured against the local beat they refer to. */
export type ArrivalMessage = 'plant' | 'commit' | 'resolve';

export type SessionEvent =
  | { type: 'planted'; player: PlayerId; strike: Strike; index: number }
  | { type: 'judged'; player: PlayerId; index: number; grade: Grade; offsetMs: number | null }
  | { type: 'rejected'; reason: 'stamina' | 'slotTaken' | 'full' | 'notYourTurn' | 'offBeat' }
  | { type: 'phrase'; phase: 'attack' | 'defend'; attacker: PlayerId; phrase: number }
  | { type: 'actOver'; winner: PlayerId; act: number }
  | { type: 'matchOver'; winner: PlayerId }
  | { type: 'desync' };

/** The last defend phrase that was resolved, kept so a resolve that arrives ahead of the local beat can still be drawn. */
interface ResolvedDefend {
  /** The defend phrase's absolute index. */
  phrase: number;
  attacker: PlayerId;
  strikes: Strike[];
  /** Final grades (an unjudged strike is a miss, as the resolve made it). */
  results: Grade[];
}

interface PendingParry {
  phrase: number;
  index: number;
  grade: Grade;
}

/** Upper bound on boundaries handled in one update() call (a tab asleep for a very long time). */
const MAX_STEPS = 512;
/** How many post-resolve snapshots the guest keeps for comparing with the host's `state`. */
const MAX_SNAPSHOTS = 8;
const EPS = 1e-9;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

function isGrade(v: unknown): v is Grade {
  return v === 'bravo' || v === 'good' || v === 'miss';
}

/** One player's side of a match. No timers: the owner calls update() every frame. */
export class DuelSession {
  inputOffsetMs: number;
  /**
   * Called for every `plant`, `commit` and `resolve` that arrives, with how late it came against the local beat
   * it refers to, in seconds (negative = early): a plant against its slot, a commit or resolve against the end
   * of its phrase, which is when its sender sends it. For measuring sync quality; it does not affect play.
   */
  onArrival: ((kind: ArrivalMessage, lateSec: number) => void) | null = null;

  private readonly local: PlayerId;
  private readonly clock: Clock;
  private readonly grid: BeatGrid;
  private readonly transport: Transport;
  private readonly tun: Tunables;
  private _state: DuelState;
  /** Defender-side parries judged before the commit arrived; applied and sent when it does. */
  private pending: PendingParry[] = [];
  /** Guest only: state right after each locally applied resolve, keyed by the phrase it left the duel in. */
  private snapshots = new Map<number, DuelState>();
  private listeners = new Set<(e: SessionEvent) => void>();
  private unsubscribe: Unsubscribe;
  private disposed = false;
  /** An attacker-to-be's click that landed just before the attack phrase, planted once the defend phrase resolves. */
  private held: { phrase: number; x: number; y: number; time: number } | null = null;
  private lastDefend: ResolvedDefend | null = null;

  constructor(opts: DuelSessionOptions) {
    this.local = opts.localPlayer;
    this.clock = opts.clock;
    this.grid = opts.grid;
    this.transport = opts.transport;
    this.tun = opts.tunables;
    this.inputOffsetMs = opts.inputOffsetMs ?? 0;
    this._state = initialDuelState(opts.tunables, opts.firstAttacker, opts.firstPhrase);
    this.unsubscribe = this.transport.onMessage((m) => this.onMessage(m));
  }

  get state(): DuelState {
    return this._state;
  }

  on(cb: (e: SessionEvent) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.listeners.clear();
  }

  // ------------------------------------------------------------ helpers

  private emit(e: SessionEvent): void {
    for (const cb of [...this.listeners]) cb(e);
  }

  private reduce(e: DuelEvent): DuelState {
    return reduceDuel(this._state, e, this.tun, this.grid.bpm);
  }

  /** The defend phrase belonging to the current turn. */
  private defendPhrase(s: DuelState = this._state): number {
    return s.phase === 'attack' ? s.phrase + 1 : s.phrase;
  }

  private isJudged(index: number): boolean {
    return this._state.results[index] != null || this.pending.some((p) => p.index === index);
  }

  private pendingGrade(index: number): Grade | null {
    return this.pending.find((p) => p.index === index)?.grade ?? null;
  }

  // ------------------------------------------------------------ frame update

  update(): void {
    if (this.disposed) return;
    for (let i = 0; i < MAX_STEPS; i++) {
      if (!this.step()) break;
    }
  }

  /** Handle one due boundary. Returns true when something happened (so another may be due). */
  private step(): boolean {
    const s = this._state;
    if (s.phase === 'matchOver') return false;
    const now = this.clock.now();
    const t = this.tun;

    if (s.attacker === this.local) {
      if (s.phase === 'attack' && now >= phraseStart(this.grid, s.phrase + 1, t)) {
        this.localCommit();
        return true;
      }
      return false;
    }

    // Local player defends this turn.
    const d = this.defendPhrase(s);
    const goodSec = (t.goodWindowMs + t.inputGraceMs) / 1000;
    let progressed = false;
    for (let i = 0; i < s.strikes.length; i++) {
      const strike = this._state.strikes[i];
      if (!strike || this.isJudged(i)) continue;
      if (now > slotTime(this.grid, d, strike.slot, t) + goodSec) {
        this.judgeLocal(i, 'miss', null, d);
        progressed = true;
      }
    }
    const cur = this._state;
    if (
      cur.phase === 'defend' &&
      cur.attacker !== this.local &&
      now >= phraseStart(this.grid, cur.phrase + 1, t)
    ) {
      this.localResolve();
      return true;
    }
    return progressed;
  }

  private localCommit(): void {
    const prev = this._state;
    const next = this.reduce({ type: 'commit', phrase: prev.phrase });
    if (next === prev) return;
    this._state = next;
    this.transport.send({ t: 'commit', phrase: prev.phrase, strikes: prev.strikes });
    this.emit({ type: 'phrase', phase: 'defend', attacker: next.attacker, phrase: next.phrase });
  }

  private localResolve(): void {
    const prev = this._state;
    const next = this.reduce({ type: 'resolve', phrase: prev.phrase });
    if (next === prev) return;
    const results = prev.results.map((r): Grade => r ?? 'miss');
    this._state = next;
    this.afterResolve(prev, next);
    this.transport.send({ t: 'resolve', phrase: prev.phrase, results });
    if (this.local === 0) this.transport.send({ t: 'state', state: next });
    const held = this.held;
    this.held = null;
    if (held && next.phase === 'attack' && next.attacker === this.local && next.phrase === held.phrase) {
      this.localPlant(held.x, held.y, held.time);
    }
  }

  /** Bookkeeping shared by local and remote resolves. */
  private afterResolve(prev: DuelState, next: DuelState): void {
    this.pending = [];
    this.lastDefend = {
      phrase: prev.phrase,
      attacker: prev.attacker,
      strikes: prev.strikes,
      results: prev.results.map((r): Grade => r ?? 'miss'),
    };
    this.snapshots.set(next.phrase, next);
    if (this.snapshots.size > MAX_SNAPSHOTS) {
      const oldest = this.snapshots.keys().next().value;
      if (oldest !== undefined) this.snapshots.delete(oldest);
    }
    if (next.lastActEndPhrase !== prev.lastActEndPhrase && next.lastActWinner !== null) {
      this.emit({ type: 'actOver', winner: next.lastActWinner, act: prev.act });
    }
    if (next.phase === 'matchOver') {
      if (next.matchWinner !== null) this.emit({ type: 'matchOver', winner: next.matchWinner });
    } else {
      this.emit({ type: 'phrase', phase: next.phase, attacker: next.attacker, phrase: next.phrase });
    }
  }

  /** Record a local defender judgement: apply and send it, or hold it until the commit arrives. */
  private judgeLocal(index: number, grade: Grade, offsetMs: number | null, phrase: number): void {
    this.emit({ type: 'judged', player: this.local, index, grade, offsetMs });
    const s = this._state;
    if (s.phase === 'defend' && s.phrase === phrase) {
      const next = this.reduce({ type: 'parry', phrase, index, grade });
      if (next !== s) {
        this._state = next;
        this.transport.send({ t: 'parry', phrase, index, grade });
      }
    } else {
      this.pending.push({ phrase, index, grade });
    }
  }

  private flushPending(): void {
    const queue = this.pending;
    this.pending = [];
    for (const p of queue) {
      const s = this._state;
      if (s.phase !== 'defend') break;
      const next = this.reduce({ type: 'parry', phrase: p.phrase, index: p.index, grade: p.grade });
      if (next !== s) {
        this._state = next;
        this.transport.send({ t: 'parry', phrase: p.phrase, index: p.index, grade: p.grade });
      }
    }
  }

  // ------------------------------------------------------------ input

  pointerDown(x: number, y: number, time: number, touch: boolean): void {
    if (this.disposed) return;
    this.update();
    const s = this._state;
    if (s.phase === 'attack' && s.attacker === this.local) {
      this.localPlant(x, y, time);
    } else if (s.phase !== 'matchOver' && s.attacker !== this.local) {
      const parried = this.localParry(x, y, time, touch);
      if (!parried && s.phase === 'defend' && this.held === null) {
        const adjusted = time - this.inputOffsetMs / 1000;
        const ns = nearestSlot(this.grid, adjusted, this.tun);
        if (ns.phrase === s.phrase + 1 && ns.slot === 0) {
          this.held = { phrase: ns.phrase, x, y, time };
        }
      }
    } else {
      this.emit({ type: 'rejected', reason: 'notYourTurn' });
    }
  }

  private localPlant(x: number, y: number, time: number): void {
    const s = this._state;
    const t = this.tun;
    const adjusted = time - this.inputOffsetMs / 1000;
    const ns = nearestSlot(this.grid, adjusted, t);
    if (ns.phrase !== s.phrase) {
      this.emit({ type: 'rejected', reason: 'notYourTurn' });
      return;
    }
    const strike: Strike = { slot: ns.slot, x: clamp01(x), y: clamp01(y) };
    const err = plantError(s, s.phrase, strike, t);
    if (err !== null) {
      const reason = err === 'stamina' || err === 'slotTaken' || err === 'full' ? err : 'notYourTurn';
      this.emit({ type: 'rejected', reason });
      return;
    }
    const next = this.reduce({ type: 'plant', phrase: s.phrase, strike });
    if (next === s) return;
    this._state = next;
    this.transport.send({ t: 'plant', phrase: s.phrase, strike });
    const index = next.strikes.findIndex((st) => st.slot === strike.slot);
    this.emit({ type: 'planted', player: this.local, strike: { ...strike }, index });
  }

  /** Returns true when the click was judged as a parry. */
  private localParry(x: number, y: number, time: number, touch: boolean): boolean {
    const s = this._state;
    const t = this.tun;
    const adjusted = time - this.inputOffsetMs / 1000;
    const d = this.defendPhrase(s);
    if (adjusted < phraseStart(this.grid, d, t) - t.missWindowMs / 1000) return false;
    if (adjusted >= phraseStart(this.grid, d + 1, t)) return false;

    let bestIndex = -1;
    let bestGrade: Grade | null = null;
    let bestOffset = 0;
    for (let i = 0; i < s.strikes.length; i++) {
      if (this.isJudged(i)) continue;
      const strike = s.strikes[i];
      if (!strike) continue;
      const offsetMs = (adjusted - slotTime(this.grid, d, strike.slot, t)) * 1000;
      const grade = judgeParry(strike, { x, y }, offsetMs, touch, t);
      if (grade === null) continue;
      if (bestIndex < 0 || Math.abs(offsetMs) < Math.abs(bestOffset)) {
        bestIndex = i;
        bestGrade = grade;
        bestOffset = offsetMs;
      }
    }
    if (bestIndex < 0 || bestGrade === null) return false;
    this.judgeLocal(bestIndex, bestGrade, bestOffset, d);
    return true;
  }

  // ------------------------------------------------------------ incoming

  private onMessage(msg: Message): void {
    if (this.disposed) return;
    if (this.onArrival !== null) this.measureArrival(msg);
    switch (msg.t) {
      case 'plant':
        return this.onPlant(msg.phrase, msg.strike);
      case 'commit':
        return this.onCommit(msg.phrase, msg.strikes);
      case 'parry':
        return this.onParry(msg.phrase, msg.index, msg.grade);
      case 'resolve':
        return this.onResolve(msg.phrase, msg.results);
      case 'state':
        return this.onState(msg.state);
      default:
        return;
    }
  }

  private measureArrival(msg: Message): void {
    const notify = this.onArrival;
    if (notify === null) return;
    const now = this.clock.now();
    if (msg.t === 'plant') {
      if (!Number.isFinite(msg.phrase) || typeof msg.strike !== 'object' || msg.strike === null) return;
      if (!Number.isFinite(msg.strike.slot)) return;
      notify('plant', now - slotTime(this.grid, msg.phrase, msg.strike.slot, this.tun));
    } else if ((msg.t === 'commit' || msg.t === 'resolve') && Number.isFinite(msg.phrase)) {
      notify(msg.t, now - phraseStart(this.grid, msg.phrase + 1, this.tun));
    }
  }

  private onPlant(phrase: number, strike: Strike): void {
    const s = this._state;
    if (s.attacker === this.local) return;
    if (typeof strike !== 'object' || strike === null) return;
    const next = this.reduce({ type: 'plant', phrase, strike });
    if (next === s) return;
    this._state = next;
    const index = next.strikes.findIndex((st) => st.slot === strike.slot);
    this.emit({
      type: 'planted',
      player: s.attacker,
      strike: { slot: strike.slot, x: strike.x, y: strike.y },
      index,
    });
  }

  private onCommit(phrase: number, strikes: Strike[]): void {
    const s = this._state;
    if (s.attacker === this.local || s.phase !== 'attack' || phrase !== s.phrase) return;
    const checked = checkedStrikes(strikes, this.tun);
    if (checked === null) {
      // Keep the strikes already known from plant messages so the match does not stall.
      this.emit({ type: 'desync' });
    } else if (!deepEqual(checked, s.strikes)) {
      this._state = { ...s, strikes: checked, results: checked.map(() => null) };
      this.emit({ type: 'desync' });
    }
    const prev = this._state;
    const next = this.reduce({ type: 'commit', phrase });
    if (next === prev) return;
    this._state = next;
    this.emit({ type: 'phrase', phase: 'defend', attacker: next.attacker, phrase: next.phrase });
    this.flushPending();
  }

  private onParry(phrase: number, index: number, grade: Grade): void {
    const s = this._state;
    if (s.attacker !== this.local) return;
    if (!isGrade(grade)) return;
    const next = this.reduce({ type: 'parry', phrase, index, grade });
    if (next === s) return;
    this._state = next;
    this.emit({ type: 'judged', player: defenderOf(s), index, grade, offsetMs: null });
  }

  private onResolve(phrase: number, results: Grade[]): void {
    const s0 = this._state;
    if (s0.attacker !== this.local || s0.phase !== 'defend' || phrase !== s0.phrase) return;
    if (Array.isArray(results)) {
      for (let i = 0; i < results.length; i++) {
        const grade = results[i];
        if (isGrade(grade)) this.onParry(phrase, i, grade);
      }
    }
    const prev = this._state;
    const next = this.reduce({ type: 'resolve', phrase });
    if (next === prev) return;
    this._state = next;
    this.afterResolve(prev, next);
    if (this.local === 0) this.transport.send({ t: 'state', state: next });
  }

  private onState(state: DuelState): void {
    if (this.local === 0) return;
    const clean = parseDuelState(state, this.tun);
    if (clean === null) return;
    const snap = this.snapshots.get(clean.phrase);
    if (snap && deepEqual(snap, clean)) return;
    this._state = clean;
    this.pending = [];
    this.held = null;
    this.emit({ type: 'desync' });
  }

  // ------------------------------------------------------------ view

  view(): DuelView {
    const s = this._state;
    const t = this.tun;
    const now = this.clock.now();
    const pos = positionAt(this.grid, now, t);
    const beatSec = 60 / this.grid.bpm;

    const view: DuelView = {
      phase: 'intermission',
      localPlayer: this.local,
      localActive: false,
      attacker: s.attacker,
      act: s.act,
      actWins: [s.actWins[0], s.actWins[1]],
      players: [{ ...s.players[0] }, { ...s.players[1] }],
      clockPhrase: pos.phrase,
      slotPosition: pos.slotPosition,
      beatPosition: pos.beatPosition,
      strikes: [],
      targets: [],
      countInBeatsLeft: 0,
      lastActWinner: s.lastActWinner,
      matchWinner: s.matchWinner,
    };

    if (s.phase === 'matchOver') {
      view.phase = 'matchOver';
      return view;
    }

    const start = phraseStart(this.grid, s.phrase, t);
    if (now < start) {
      // A message arrived ahead of the local beat. Show the phase the local clock is still in; a count-in
      // or intermission is only for a real act start (or the start of the match).
      if (s.phase === 'defend') {
        // The commit came early: the attack phrase before it is still running here, now with its final strikes.
        return this.fill(view, 'attack', s.attacker, s.strikes, null, 0, now);
      }
      const done = this.lastDefend;
      if (done !== null && now < phraseStart(this.grid, done.phrase + 1, t)) {
        // The resolve came early: that defend phrase is still running here, with its final results.
        return this.fill(view, 'defend', done.attacker, done.strikes, done.results, done.phrase, now);
      }
      if (s.phrase !== s.actFirstPhrase) {
        // Mid-act with nothing recorded to show (a state that was replaced): the other player's phrase, bare.
        return this.fill(view, 'defend', otherPlayer(s.attacker), [], null, 0, now);
      }
      const left = start - now;
      view.phase =
        left <= t.countInPhrases * phraseDuration(this.grid.bpm, t) + EPS ? 'countIn' : 'intermission';
      view.countInBeatsLeft = Math.max(1, Math.ceil(left / beatSec - EPS));
      return view;
    }

    const over = now >= phraseStart(this.grid, s.phrase + 1, t);
    if (s.phase === 'attack') {
      return over
        ? this.fill(view, 'defend', s.attacker, s.strikes, s.results, this.defendPhrase(s), now, true)
        : this.fill(view, 'attack', s.attacker, s.strikes, null, 0, now);
    }
    if (over) return this.fill(view, 'attack', otherPlayer(s.attacker), [], null, 0, now);
    return this.fill(view, 'defend', s.attacker, s.strikes, s.results, s.phrase, now, true);
  }

  /**
   * Completes a view for `phase`. A defend phase turns the strikes into targets for defend phrase `defendPhrase`,
   * graded from `results` (and, when `pendingToo`, from parries judged here but not yet applied).
   */
  private fill(
    view: DuelView,
    phase: ViewPhase,
    attacker: PlayerId,
    strikes: readonly Strike[],
    results: readonly (Grade | null)[] | null,
    defendPhrase: number,
    now: number,
    pendingToo = false,
  ): DuelView {
    view.phase = phase;
    view.attacker = attacker;
    view.localActive = phase === 'attack' ? attacker === this.local : attacker !== this.local;
    view.strikes = strikes.map((st) => ({ ...st }));
    if (phase === 'defend' && results !== null) {
      view.targets = strikes.map((strike, index): TargetView => ({
        index,
        strike: { ...strike },
        timeToHit: slotTime(this.grid, defendPhrase, strike.slot, this.tun) - now,
        result: results[index] ?? (pendingToo ? this.pendingGrade(index) : null),
      }));
    }
    return view;
  }
}
