/**
 * Numbers for reading sync quality on two real devices: what the clock estimate is built on, and how early or
 * late each `plant`, `commit` and `resolve` arrived against the local beat it refers to. Plain data, updated in
 * place, so recording never allocates.
 */

export type ArrivalKind = 'plant' | 'commit' | 'resolve';

export const ARRIVAL_KINDS: readonly ArrivalKind[] = ['plant', 'commit', 'resolve'];

/** How many arrivals the ring keeps. */
export const ARRIVAL_RING_SIZE = 64;

function kindIndex(kind: ArrivalKind): number {
  return kind === 'plant' ? 0 : kind === 'commit' ? 1 : 2;
}

export interface Arrival {
  kind: ArrivalKind;
  /** Milliseconds against the local beat the message refers to: negative = it came early, positive = late. */
  lateMs: number;
  /** Local clock time (seconds) when it arrived. */
  at: number;
}

/**
 * Arrivals of one match: latest and worst per kind, and a ring of the most recent ones.
 * `lateMs`: arrival time minus the beat it refers to (a plant: its slot; a commit or resolve: the end of its
 * phrase, which is when the sender sends it). Negative means it arrived before the local beat did.
 */
export class ArrivalLog {
  /** Latest lateness per kind (plant, commit, resolve); NaN until one has been seen. */
  readonly latestMs = new Float64Array(3).fill(Number.NaN);
  /** The most late (largest) and most early (smallest) per kind; NaN until one has been seen. */
  readonly worstLateMs = new Float64Array(3).fill(Number.NaN);
  readonly worstEarlyMs = new Float64Array(3).fill(Number.NaN);
  readonly counts = new Uint32Array(3);

  private readonly ringKind = new Uint8Array(ARRIVAL_RING_SIZE);
  private readonly ringMs = new Float64Array(ARRIVAL_RING_SIZE);
  private readonly ringAt = new Float64Array(ARRIVAL_RING_SIZE);
  private next = 0;
  private filled = 0;

  record(kind: ArrivalKind, lateSec: number, at: number): void {
    if (!Number.isFinite(lateSec)) return;
    const k = kindIndex(kind);
    const ms = lateSec * 1000;
    this.latestMs[k] = ms;
    // Number.isNaN comparisons: the first value of a kind sets both worsts.
    if (!(ms <= (this.worstLateMs[k] as number))) this.worstLateMs[k] = ms;
    if (!(ms >= (this.worstEarlyMs[k] as number))) this.worstEarlyMs[k] = ms;
    this.counts[k] = (this.counts[k] as number) + 1;
    this.ringKind[this.next] = k;
    this.ringMs[this.next] = ms;
    this.ringAt[this.next] = at;
    this.next = (this.next + 1) % ARRIVAL_RING_SIZE;
    if (this.filled < ARRIVAL_RING_SIZE) this.filled++;
  }

  /** The recorded arrivals, oldest first. Allocates: for reading, not for the frame loop. */
  recent(): Arrival[] {
    const out: Arrival[] = [];
    const start = this.filled < ARRIVAL_RING_SIZE ? 0 : this.next;
    for (let i = 0; i < this.filled; i++) {
      const at = (start + i) % ARRIVAL_RING_SIZE;
      out.push({
        kind: ARRIVAL_KINDS[this.ringKind[at] as number] as ArrivalKind,
        lateMs: this.ringMs[at] as number,
        at: this.ringAt[at] as number,
      });
    }
    return out;
  }

  /** Latest per kind, as a plain object (allocates: for reading). */
  latest(): Record<ArrivalKind, number | null> {
    const get = (k: number): number | null => {
      const v = this.latestMs[k] as number;
      return Number.isNaN(v) ? null : v;
    };
    return { plant: get(0), commit: get(1), resolve: get(2) };
  }

  /** The most late and most early per kind, as plain objects (allocates: for reading). */
  worst(): { late: Record<ArrivalKind, number | null>; early: Record<ArrivalKind, number | null> } {
    const get = (a: Float64Array, k: number): number | null => {
      const v = a[k] as number;
      return Number.isNaN(v) ? null : v;
    };
    return {
      late: {
        plant: get(this.worstLateMs, 0),
        commit: get(this.worstLateMs, 1),
        resolve: get(this.worstLateMs, 2),
      },
      early: {
        plant: get(this.worstEarlyMs, 0),
        commit: get(this.worstEarlyMs, 1),
        resolve: get(this.worstEarlyMs, 2),
      },
    };
  }

  reset(): void {
    this.latestMs.fill(Number.NaN);
    this.worstLateMs.fill(Number.NaN);
    this.worstEarlyMs.fill(Number.NaN);
    this.counts.fill(0);
    this.next = 0;
    this.filled = 0;
  }
}

/** What the guest's clock estimate stands on. Updated in place by `Room`; the host's stay at their start values. */
export interface SyncStats {
  /** Host clock minus this clock, ms. */
  offsetMs: number;
  /** This side's clock time (s) of the sample the estimate stands on; NaN before there is one. */
  estimateAt: number;
  /** Round trip of the sample the estimate stands on, and the latest sample's, ms; NaN until measured. */
  bestRttMs: number;
  lastRttMs: number;
  /** Samples in the window the estimate is taken from. */
  samples: number;
  /** Samples thrown away because files were moving, or because they were slow outliers or not trusted. */
  discarded: number;
  /** Jumps in the clock confirmed so far. */
  jumps: number;
  /** In a match: the estimate now minus the estimate the grid was built on, ms; null outside a match. */
  driftMs: number | null;
  /** Times the grid was moved to follow a changed estimate. */
  gridShifts: number;
}

export function newSyncStats(): SyncStats {
  return {
    offsetMs: 0,
    estimateAt: Number.NaN,
    bestRttMs: Number.NaN,
    lastRttMs: Number.NaN,
    samples: 0,
    discarded: 0,
    jumps: 0,
    driftMs: null,
    gridShifts: 0,
  };
}
