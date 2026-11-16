import type { BlobMeta, Clock, Message, Transport, TransportState, Unsubscribe } from '../core/types';
import { dispatch } from './dispatch';

export interface LoopbackPair {
  host: Transport; // role 'host'
  guest: Transport; // role 'guest'
  /** Deliver every queued message whose due time has come. Only needed when latencySec > 0. */
  pump(): void;
}

type Delivery =
  | { due: number; target: Endpoint; kind: 'msg'; msg: Message }
  | { due: number; target: Endpoint; kind: 'blob'; data: ArrayBuffer; meta: BlobMeta };

interface Link {
  latencySec: number;
  clock: Clock | null;
  queue: Delivery[];
  ends: Endpoint[];
}

class Endpoint implements Transport {
  state: TransportState = 'open';
  readonly rttMs: number | null;
  peer!: Endpoint;

  private msgCbs = new Set<(msg: Message) => void>();
  private blobCbs = new Set<(data: ArrayBuffer, meta: BlobMeta) => void>();
  private progressCbs = new Set<(fraction: number, meta: BlobMeta) => void>();
  private stateCbs = new Set<(state: TransportState) => void>();

  constructor(
    readonly role: 'host' | 'guest',
    private link: Link,
  ) {
    this.rttMs = link.latencySec > 0 ? link.latencySec * 2000 : 0;
  }

  send(msg: Message): void {
    if (this.state !== 'open') return;
    this.enqueue({ kind: 'msg', msg: structuredClone(msg) });
  }

  sendBlob(data: ArrayBuffer, meta: BlobMeta, onProgress?: (fraction: number) => void): Promise<void> {
    if (this.state !== 'open') return Promise.reject(new Error('transport closed'));
    this.enqueue({ kind: 'blob', data: data.slice(0), meta: structuredClone(meta) });
    onProgress?.(1);
    return Promise.resolve();
  }

  onMessage(cb: (msg: Message) => void): Unsubscribe {
    this.msgCbs.add(cb);
    return () => this.msgCbs.delete(cb);
  }

  onBlob(cb: (data: ArrayBuffer, meta: BlobMeta) => void): Unsubscribe {
    this.blobCbs.add(cb);
    return () => this.blobCbs.delete(cb);
  }

  onBlobProgress(cb: (fraction: number, meta: BlobMeta) => void): Unsubscribe {
    this.progressCbs.add(cb);
    return () => this.progressCbs.delete(cb);
  }

  onState(cb: (state: TransportState) => void): Unsubscribe {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }

  close(): void {
    if (this.state === 'closed') return;
    this.link.queue.length = 0;
    for (const e of this.link.ends) e.setClosed();
  }

  private setClosed(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    dispatch(this.stateCbs, 'closed');
  }

  private enqueue(
    item: { kind: 'msg'; msg: Message } | { kind: 'blob'; data: ArrayBuffer; meta: BlobMeta },
  ): void {
    const { latencySec, clock } = this.link;
    if (latencySec > 0 && clock) {
      this.link.queue.push({ ...item, due: clock.now() + latencySec, target: this.peer });
    } else {
      this.peer.deliver({ ...item, due: 0, target: this.peer });
    }
  }

  deliver(d: Delivery): void {
    if (this.state !== 'open') return;
    if (d.kind === 'msg') {
      dispatch(this.msgCbs, d.msg);
    } else {
      dispatch(this.progressCbs, 1, d.meta);
      dispatch(this.blobCbs, d.data, d.meta);
    }
  }
}

/**
 * Two joined in-memory transports, both `open` from the start.
 * With no options delivery is synchronous inside `send`. With `latencySec` and `clock`, messages are queued
 * and delivered in order by `pump()` once `clock.now()` has passed send time + latency.
 * Messages and blobs are deep-copied (structuredClone) on the way through, as a real wire would.
 * `close()` on either end sets both to `closed` and notifies `onState` listeners.
 */
export function createLoopbackPair(opts?: { latencySec?: number; clock?: Clock }): LoopbackPair {
  const latencySec = opts?.latencySec ?? 0;
  const clock = opts?.clock ?? null;
  if (latencySec > 0 && !clock) throw new Error('createLoopbackPair: latencySec needs a clock');
  const link: Link = { latencySec, clock, queue: [], ends: [] };
  const host = new Endpoint('host', link);
  const guest = new Endpoint('guest', link);
  host.peer = guest;
  guest.peer = host;
  link.ends.push(host, guest);

  return {
    host,
    guest,
    pump() {
      if (!clock) return;
      const now = clock.now();
      for (let d = link.queue[0]; d && d.due <= now; d = link.queue[0]) {
        link.queue.shift();
        d.target.deliver(d);
      }
    },
  };
}
