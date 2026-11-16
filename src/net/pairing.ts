import type {
  BlobKind,
  BlobMeta,
  Message,
  RawLink,
  Transport,
  TransportState,
  Unsubscribe,
} from '../core/types';

export interface PairingOptions {
  link: RawLink;
  role: 'host' | 'guest';
}

type Control = 'offer' | 'accept' | 'full' | 'bye' | 'here';

const CONTROLS: readonly string[] = ['offer', 'accept', 'full', 'bye', 'here'];
const BLOB_KINDS: readonly BlobKind[] = ['puppet-head', 'puppet-sock', 'puppet-sword', 'song'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function validMessage(v: unknown): v is Message {
  return isRecord(v) && typeof v.t === 'string';
}

function validBlobMeta(meta: unknown, data: unknown): meta is BlobMeta {
  return (
    isRecord(meta) &&
    typeof meta.kind === 'string' &&
    (BLOB_KINDS as readonly string[]).includes(meta.kind) &&
    typeof meta.mime === 'string' &&
    typeof meta.bytes === 'number' &&
    data instanceof ArrayBuffer &&
    meta.bytes === data.byteLength
  );
}

class PairingTransport implements Transport {
  state: TransportState;
  readonly rttMs: number | null = null;

  private partner: string | null = null;
  private left = false;
  private readonly msgCbs = new Set<(msg: Message) => void>();
  private readonly blobCbs = new Set<(data: ArrayBuffer, meta: BlobMeta) => void>();
  private readonly progressCbs = new Set<(fraction: number, meta: BlobMeta) => void>();
  private readonly stateCbs = new Set<(state: TransportState) => void>();
  private readonly unsubs: Unsubscribe[] = [];

  constructor(
    private readonly link: RawLink,
    readonly role: 'host' | 'guest',
  ) {
    this.state = role === 'host' ? 'waiting' : 'connecting';
    this.unsubs.push(
      link.onData((from, data) => this.onData(from, data)),
      link.onBinary((from, data, meta) => this.onBinary(from, data, meta)),
      link.onBinaryProgress((from, fraction, meta) => this.onProgress(from, fraction, meta)),
      link.onPeerLeave((id) => this.onPeerLeave(id)),
      // Last: a hub may replay already present peers synchronously on registration.
      link.onPeerJoin((id) => this.onPeerJoin(id)),
    );
    if (!this.live) for (const u of this.unsubs.splice(0)) u();
    // A guest that joined before this host existed has no join event to react to: tell it we are here.
    if (role === 'host') link.send(null, { c: 'here' });
  }

  send(msg: Message): void {
    if (this.state !== 'open' || this.partner === null) return;
    this.link.send(this.partner, { m: msg });
  }

  sendBlob(data: ArrayBuffer, meta: BlobMeta, onProgress?: (fraction: number) => void): Promise<void> {
    if (this.state !== 'open' || this.partner === null)
      return Promise.reject(new Error('transport not open'));
    return this.link.sendBinary(this.partner, data, meta, onProgress);
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
    if (this.partner !== null && this.state === 'open') this.control(this.partner, 'bye');
    this.shutdown('closed');
  }

  // ------------------------------------------------------------ internals

  private control(to: string, c: Control): void {
    this.link.send(to, { c });
  }

  private setState(next: TransportState): void {
    if (this.state === next) return;
    this.state = next;
    for (const cb of [...this.stateCbs]) cb(next);
  }

  /** Leave the link, stop listening, and move to a terminal state. */
  private shutdown(next: 'closed' | 'full'): void {
    for (const u of this.unsubs.splice(0)) u();
    if (!this.left) {
      this.left = true;
      this.link.leave();
    }
    this.setState(next);
  }

  private get live(): boolean {
    return this.state !== 'closed' && this.state !== 'full';
  }

  private onPeerJoin(id: string): void {
    if (this.role === 'guest' && this.state === 'connecting') this.control(id, 'offer');
  }

  private onPeerLeave(id: string): void {
    if (this.partner !== null && id === this.partner && this.live) this.shutdown('closed');
  }

  private onData(from: string, data: unknown): void {
    if (!this.live || !isRecord(data)) return;
    if (typeof data.c === 'string' && CONTROLS.includes(data.c)) {
      this.onControl(from, data.c as Control);
      return;
    }
    if (from !== this.partner || this.state !== 'open') return;
    if (!validMessage(data.m)) return;
    for (const cb of [...this.msgCbs]) cb(data.m);
  }

  private onControl(from: string, c: Control): void {
    switch (c) {
      case 'offer':
        if (this.role !== 'host') return;
        if (this.state === 'waiting' && this.partner === null) {
          this.partner = from;
          this.setState('open');
          this.control(from, 'accept');
        } else if (from === this.partner) {
          this.control(from, 'accept');
        } else {
          this.control(from, 'full');
        }
        return;
      case 'accept':
        if (this.role === 'guest' && this.state === 'connecting' && this.partner === null) {
          this.partner = from;
          this.setState('open');
        }
        return;
      case 'full':
        if (this.role === 'guest' && this.state === 'connecting') this.shutdown('full');
        return;
      case 'here':
        if (this.role === 'guest' && this.state === 'connecting') this.control(from, 'offer');
        return;
      case 'bye':
        if (from === this.partner) this.shutdown('closed');
        return;
    }
  }

  private onBinary(from: string, data: ArrayBuffer, meta: unknown): void {
    if (this.state !== 'open' || from !== this.partner) return;
    if (!validBlobMeta(meta, data)) return;
    for (const cb of [...this.blobCbs]) cb(data, meta);
  }

  private onProgress(from: string, fraction: number, meta: unknown): void {
    if (this.state !== 'open' || from !== this.partner) return;
    if (typeof fraction !== 'number' || !isRecord(meta)) return;
    if (typeof meta.kind !== 'string' || !(BLOB_KINDS as readonly string[]).includes(meta.kind)) return;
    if (typeof meta.mime !== 'string' || typeof meta.bytes !== 'number') return;
    for (const cb of [...this.progressCbs]) cb(fraction, meta as unknown as BlobMeta);
  }
}

/** A two-player Transport over a RawLink. */
export function createPairingTransport(opts: PairingOptions): Transport {
  return new PairingTransport(opts.link, opts.role);
}
