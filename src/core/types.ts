/**
 * Shared contracts for Toe to Toe. Types only: no runtime code in this file.
 * Owned by the orchestrator. Builders consume these and must not change them
 * without saying so in their report. See docs/ARCHITECTURE.md.
 */

// ---------------------------------------------------------------- clock

/** The master clock. Production: AudioContext.currentTime. Tests: a fake stepped by hand. */
export interface Clock {
  /** Seconds. Monotonic. */
  now(): number;
}

/**
 * Maps clock time to beats. Phrase 0 slot 0 is at `startTime`.
 * Phrases are numbered absolutely from the start of the match and never reset.
 */
export interface BeatGrid {
  /** Already folded into [minBpm, maxBpm]. */
  bpm: number;
  /** Local clock time (seconds) of slot 0 of phrase 0. */
  startTime: number;
}

// ---------------------------------------------------------------- tunables

/** Every number in the duel. One object, editable live from the debug overlay. */
export interface Tunables {
  minBpm: number;
  maxBpm: number;
  beatsPerPhrase: number;
  slotsPerBeat: number;
  /** Phrases of count-in before the first attack phrase of an act. */
  countInPhrases: number;
  /** Phrases between the end of one act and the count-in of the next. */
  intermissionPhrases: number;

  bravoWindowMs: number;
  goodWindowMs: number;
  /** A click on a target outside the good window but inside this one is a Miss; outside it the click is ignored. */
  missWindowMs: number;
  /** How long after the Good window closes a strike waits before it is auto-missed, so a click stamped in time but handled a little late still counts. */
  inputGraceMs: number;
  /** Target radius as a fraction of play-area width. */
  targetRadius: number;
  targetRadiusTouch: number;
  /** Play-area width divided by height. Distances are measured in width units. */
  playAreaAspect: number;

  startHealth: number;
  startStamina: number;
  missDamage: number;
  missStaminaLoss: number;
  bravoStaminaLoss: number;
  strikeBaseCost: number;
  strikeDistanceCostMax: number;
  /** Distance (width units) from the previous strike at which the full distance cost applies. */
  strikeDistanceForMaxCost: number;
  staminaRegen: number;
  windedDamageMultiplier: number;
  windedResetStamina: number;

  actDurationSec: number;
  /** Act wins needed to take the match (2 = best of three). */
  actsToWin: number;

  /** A clock-sync sample whose offset differs from the estimate by more than this (ms), twice in a row, restarts the estimate. */
  clockJumpMs: number;
  /** Seconds between the host's `start` and the first beat. */
  startLeadSec: number;
  /** How many beats before its time a target's approach ring starts closing. */
  ringLeadBeats: number;
}

// ---------------------------------------------------------------- duel

/** 0 is the room creator (the referee). 1 is the guest. */
export type PlayerId = 0 | 1;

export interface Strike {
  /** Half-beat slot in the phrase: 0 .. beatsPerPhrase*slotsPerBeat-1. */
  slot: number;
  /** Fractions of the play area, 0..1. */
  x: number;
  y: number;
}

export type Grade = 'bravo' | 'good' | 'miss';

export interface PlayerState {
  health: number;
  stamina: number;
  /** Set when stamina reaches 0; makes the next phrase this player defends deal double damage. */
  winded: boolean;
  /** Consecutive successful parries. */
  streak: number;
}

export type DuelPhase = 'attack' | 'defend' | 'matchOver';

/**
 * The whole referee state. Plain JSON, sent over the wire after every resolved phrase.
 * Count-in and intermission are not phases here: they are simply the time before
 * `phrase` starts on the clock (see DuelView).
 */
export interface DuelState {
  phase: DuelPhase;
  /** 0-based act number. */
  act: number;
  actWins: [number, number];
  /** Absolute phrase index of this act's first attack phrase. */
  actFirstPhrase: number;
  /** Absolute phrase index the duel is in: the attack phrase awaiting `commit` or the defend phrase awaiting `resolve`. */
  phrase: number;
  firstAttacker: PlayerId;
  attacker: PlayerId;
  players: [PlayerState, PlayerState];
  /** Strikes of the current turn, sorted by slot. Planted in the attack phrase, replayed in the defend phrase. */
  strikes: Strike[];
  /** One entry per strike; null until judged. */
  results: (Grade | null)[];
  /** True when the current turn's defend phrase deals winded (double) damage. Fixed at `commit`. */
  windedTurn: boolean;
  lastActWinner: PlayerId | null;
  /** Absolute phrase index of the defend phrase that ended the previous act, or null. */
  lastActEndPhrase: number | null;
  matchWinner: PlayerId | null;
}

/**
 * Events are generated only by the active player of a phrase (attacker in an attack
 * phrase, defender in a defend phrase), so both browsers apply them in the same order.
 */
export type DuelEvent =
  | { type: 'plant'; phrase: number; strike: Strike }
  /** The attack phrase is over; strikes are final. */
  | { type: 'commit'; phrase: number }
  | { type: 'parry'; phrase: number; index: number; grade: Grade }
  /** The defend phrase is over; unjudged strikes become misses; act and match scoring run. */
  | { type: 'resolve'; phrase: number };

// ---------------------------------------------------------------- view

export type ViewPhase = 'countIn' | 'attack' | 'defend' | 'intermission' | 'matchOver';

export interface TargetView {
  index: number;
  strike: Strike;
  /** Seconds until this target's beat (negative once passed). */
  timeToHit: number;
  result: Grade | null;
}

/** What the renderer draws each frame. Derived from DuelState and the clock; no rules in the renderer. */
export interface DuelView {
  phase: ViewPhase;
  localPlayer: PlayerId;
  /** True when the local player is the one acting in this phase (planting or parrying). */
  localActive: boolean;
  attacker: PlayerId;
  act: number;
  actWins: [number, number];
  players: [PlayerState, PlayerState];
  /** Absolute phrase the clock is in, and position inside it. */
  clockPhrase: number;
  /** 0..slotsPerPhrase, fractional. */
  slotPosition: number;
  /** 0..beatsPerPhrase, fractional. */
  beatPosition: number;
  strikes: Strike[];
  targets: TargetView[];
  /** Whole beats left in the count-in or intermission, else 0. */
  countInBeatsLeft: number;
  lastActWinner: PlayerId | null;
  matchWinner: PlayerId | null;
}

// ---------------------------------------------------------------- net

export interface PuppetMeta {
  name: string;
}

export interface ThemeOffer {
  /** 'house' tracks are fetched by id from the manifest; 'upload' is sent as a blob. */
  source: 'house' | 'upload' | 'click';
  id: string;
  title: string;
  bpm: number;
  /** Seconds from the start of the file to the first beat. */
  firstBeatOffset: number;
  /** SHA-256 hex of the file, for uploads. */
  hash?: string;
  bytes?: number;
}

/** Small typed JSON messages. `v` on hello is the protocol version. */
export type Message =
  | { t: 'hello'; name: string; v: number }
  | { t: 'theme'; theme: ThemeOffer }
  | { t: 'themeReady'; hash: string | null; ok: boolean }
  | { t: 'ready'; ready: boolean }
  /** Host to guest before `start`, and again whenever the host edits a tunable. The guest adopts them. */
  | { t: 'tunables'; tunables: Tunables }
  | { t: 'ping'; id: number; t0: number }
  | { t: 'pong'; id: number; t0: number; t1: number }
  /** Host to guest: the host's audio clock stopped and restarted, so measure the offset again. */
  | { t: 'resync' }
  /** `startTime` is on the sender's (host's) clock; the guest converts with its measured offset. */
  | { t: 'start'; startTime: number; bpm: number; firstAttacker: PlayerId; firstPhrase: number }
  | { t: 'plant'; phrase: number; strike: Strike }
  | { t: 'commit'; phrase: number; strikes: Strike[] }
  | { t: 'parry'; phrase: number; index: number; grade: Grade }
  | { t: 'resolve'; phrase: number; results: Grade[] }
  | { t: 'state'; state: DuelState }
  /** `want: false` (the default is true) withdraws a rematch request: the sender has left the victory screen. */
  | { t: 'rematch'; want?: boolean }
  | { t: 'leave' };

export type BlobKind = 'puppet-head' | 'puppet-sock' | 'puppet-sword' | 'song';

export interface BlobMeta {
  kind: BlobKind;
  mime: string;
  bytes: number;
  name?: string;
  hash?: string;
}

/**
 * connecting: joining the room. waiting: in the room alone. open: paired with the other player.
 * full: the room already has two players. closed: left, or the other player left.
 */
export type TransportState = 'connecting' | 'waiting' | 'open' | 'full' | 'closed';

export type Unsubscribe = () => void;

/**
 * A raw many-peer room underneath a Transport: Trystero in production, BroadcastChannel across tabs,
 * an in-memory hub in tests. `src/net/pairing.ts` turns a RawLink into a two-player Transport.
 * Payloads are JSON values; binary goes separately so it can be chunked with progress.
 */
export interface RawLink {
  readonly selfId: string;
  /** `to: null` broadcasts to everyone currently in the room. */
  /** May return a promise that settles when the message has gone out (used to let `bye` leave before the link does). */
  send(to: string | null, data: unknown): void | Promise<void>;
  sendBinary(
    to: string,
    data: ArrayBuffer,
    meta: unknown,
    onProgress?: (fraction: number) => void,
  ): Promise<void>;
  onData(cb: (from: string, data: unknown) => void): Unsubscribe;
  onBinary(cb: (from: string, data: ArrayBuffer, meta: unknown) => void): Unsubscribe;
  onBinaryProgress(cb: (from: string, fraction: number, meta: unknown) => void): Unsubscribe;
  onPeerJoin(cb: (peerId: string) => void): Unsubscribe;
  onPeerLeave(cb: (peerId: string) => void): Unsubscribe;
  leave(): void;
  /** Optional. True once the link can no longer connect (every relay or the peer connection failed). */
  readonly failed?: boolean;
  /** Optional. Called once when the link fails (at once if it already has). */
  onFailed?(cb: (reason: string) => void): Unsubscribe;
}

/** The only way the game talks to the other player. Implementations: peer (Trystero), loopback, bot. */
export interface Transport {
  readonly state: TransportState;
  readonly role: 'host' | 'guest';
  /** Last measured round trip in milliseconds, or null. */
  readonly rttMs: number | null;
  send(msg: Message): void;
  sendBlob(data: ArrayBuffer, meta: BlobMeta, onProgress?: (fraction: number) => void): Promise<void>;
  onMessage(cb: (msg: Message) => void): Unsubscribe;
  onBlob(cb: (data: ArrayBuffer, meta: BlobMeta) => void): Unsubscribe;
  onBlobProgress(cb: (fraction: number, meta: BlobMeta) => void): Unsubscribe;
  onState(cb: (state: TransportState) => void): Unsubscribe;
  close(): void;
}
