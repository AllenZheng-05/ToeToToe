import type { Clock, RawLink, Unsubscribe } from '../core/types';

export interface MemoryHub {
  /** A new peer joins the room; existing peers get onPeerJoin, and the newcomer gets onPeerJoin for each of them. */
  join(): RawLink;
  /** Deliver queued traffic that is due. Only needed when latencySec > 0. */
  pump(): void;
}

type Item =
  | { kind: 'data'; from: Peer; to: string | null; data: unknown }
  | { kind: 'binary'; from: Peer; to: string; data: ArrayBuffer; meta: unknown }
  | { kind: 'leave'; from: Peer };

interface Queued {
  due: number;
  item: Item;
}

class Peer implements RawLink {
  present = true;
  readonly dataCbs = new Set<(from: string, data: unknown) => void>();
  readonly binaryCbs = new Set<(from: string, data: ArrayBuffer, meta: unknown) => void>();
  readonly progressCbs = new Set<(from: string, fraction: number, meta: unknown) => void>();
  readonly joinCbs = new Set<(peerId: string) => void>();
  readonly leaveCbs = new Set<(peerId: string) => void>();

  constructor(
    readonly selfId: string,
    private readonly hub: HubImpl,
  ) {}

  send(to: string | null, data: unknown): void {
    if (!this.present) return;
    this.hub.enqueue({ kind: 'data', from: this, to, data: structuredClone(data) });
  }

  sendBinary(
    to: string,
    data: ArrayBuffer,
    meta: unknown,
    onProgress?: (fraction: number) => void,
  ): Promise<void> {
    if (!this.present) return Promise.reject(new Error('link left'));
    this.hub.enqueue({ kind: 'binary', from: this, to, data: data.slice(0), meta: structuredClone(meta) });
    onProgress?.(1);
    return Promise.resolve();
  }

  onData(cb: (from: string, data: unknown) => void): Unsubscribe {
    this.dataCbs.add(cb);
    return () => this.dataCbs.delete(cb);
  }

  onBinary(cb: (from: string, data: ArrayBuffer, meta: unknown) => void): Unsubscribe {
    this.binaryCbs.add(cb);
    return () => this.binaryCbs.delete(cb);
  }

  onBinaryProgress(cb: (from: string, fraction: number, meta: unknown) => void): Unsubscribe {
    this.progressCbs.add(cb);
    return () => this.progressCbs.delete(cb);
  }

  /** Callbacks registered after peers joined are told about the peers already present. */
  onPeerJoin(cb: (peerId: string) => void): Unsubscribe {
    this.joinCbs.add(cb);
    for (const other of this.hub.peers) {
      if (other !== this && other.present) cb(other.selfId);
    }
    return () => this.joinCbs.delete(cb);
  }

  onPeerLeave(cb: (peerId: string) => void): Unsubscribe {
    this.leaveCbs.add(cb);
    return () => this.leaveCbs.delete(cb);
  }

  leave(): void {
    if (!this.present) return;
    this.hub.enqueue({ kind: 'leave', from: this });
    this.present = false;
  }
}

class HubImpl implements MemoryHub {
  readonly peers: Peer[] = [];
  private queue: Queued[] = [];
  private nextId = 1;

  constructor(
    private readonly latencySec: number,
    private readonly clock: Clock | null,
  ) {}

  join(): RawLink {
    const peer = new Peer(`peer-${this.nextId++}`, this);
    const existing = this.peers.filter((p) => p.present);
    this.peers.push(peer);
    for (const other of existing) {
      for (const cb of [...other.joinCbs]) cb(peer.selfId);
    }
    return peer;
  }

  enqueue(item: Item): void {
    if (this.latencySec > 0 && this.clock) {
      this.queue.push({ due: this.clock.now() + this.latencySec, item });
    } else {
      this.deliver(item);
    }
  }

  pump(): void {
    if (!this.clock) return;
    for (let q = this.queue[0]; q && q.due <= this.clock.now(); q = this.queue[0]) {
      this.queue.shift();
      this.deliver(q.item);
    }
  }

  private targets(item: Item): Peer[] {
    const others = this.peers.filter((p) => p.present && p !== item.from);
    if (item.kind === 'leave') return others;
    if (item.to === null) return others;
    return others.filter((p) => p.selfId === item.to);
  }

  private deliver(item: Item): void {
    const from = item.from.selfId;
    for (const target of this.targets(item)) {
      if (item.kind === 'data') {
        for (const cb of [...target.dataCbs]) cb(from, structuredClone(item.data));
      } else if (item.kind === 'binary') {
        for (const cb of [...target.progressCbs]) cb(from, 1, structuredClone(item.meta));
        for (const cb of [...target.binaryCbs]) cb(from, item.data.slice(0), structuredClone(item.meta));
      } else {
        for (const cb of [...target.leaveCbs]) cb(from);
      }
    }
  }
}

/** Delivery is synchronous unless latencySec and clock are given (then ordered, delayed, delivered by pump()). Deep-copies payloads. */
export function createMemoryHub(opts?: { latencySec?: number; clock?: Clock }): MemoryHub {
  const latencySec = opts?.latencySec ?? 0;
  const clock = opts?.clock ?? null;
  if (latencySec > 0 && !clock) throw new Error('createMemoryHub: latencySec needs a clock');
  return new HubImpl(latencySec, clock);
}
