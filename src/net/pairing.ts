import type {
  BlobKind,
  BlobMeta,
  Message,
  RawLink,
  RejectedBlob,
  Transport,
  TransportState,
  Unsubscribe,
} from '../core/types';
import { toArrayBuffer } from './bytes';
import { dispatch } from './dispatch';

export interface PairingOptions {
  link: RawLink;
  role: 'host' | 'guest';
}

/** How long `bye` may take to go out before the link is left anyway (UI pacing, not beat timing). */
const BYE_GRACE_MS = 300;

type Control = 'offer' | 'accept' | 'full' | 'bye' | 'here';

const CONTROLS: readonly string[] = ['offer', 'accept', 'full', 'bye', 'here'];
const BLOB_KINDS: readonly BlobKind[] = ['puppet-head', 'puppet-sock', 'puppet-sword', 'song'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function validMessage(v: unknown): v is Message {
  return isRecord(v) && typeof v.t === 'string';
}

function validBlobMeta(meta: unknown, data: ArrayBuffer | null): meta is BlobMeta {
  return (
    isRecord(meta) &&
    typeof meta.kind === 'string' &&
    (BLOB_KINDS as readonly string[]).includes(meta.kind) &&
    typeof meta.mime === 'string' &&
    typeof meta.bytes === 'number' &&
    data !== null &&
    meta.bytes === data.byteLength
  );
}

/** Longest name carried along with a rejected blob (the receiver cleans it again). */
const REJECTED_NAME_CHARS = 200;

/** What can be said about a discarded blob from its (untrusted) metadata. */
function describeRejected(meta: unknown): RejectedBlob {
  if (!isRecord(meta)) return { kind: null };
  const kind =
    typeof meta.kind === 'string' && (BLOB_KINDS as readonly string[]).includes(meta.kind)
      ? (meta.kind as BlobKind)
      : null;
  if (kind !== null && typeof meta.name === 'string') {
    return { kind, name: meta.name.slice(0, REJECTED_NAME_CHARS) };
  }
  return { kind };
}

class PairingTransport implements Transport {
  state: TransportState;
  readonly rttMs: number | null = null;

  private partner: string | null = null;
  private left = false;
  private readonly msgCbs = new Set<(msg: Message) => void>();
  private readonly blobCbs = new Set<(data: ArrayBuffer, meta: BlobMeta) => void>();
  private readonly progressCbs = new Set<(fraction: number, meta: BlobMeta) => void>();
  private readonly rejectedCbs = new Set<(info: RejectedBlob) => void>();
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
      ...(link.onBinaryRejected ? [link.onBinaryRejected((from, meta) => this.onRejected(from, meta))] : []),
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

  onBlobRejected(cb: (info: RejectedBlob) => void): Unsubscribe {
    this.rejectedCbs.add(cb);
    return () => this.rejectedCbs.delete(cb);
  }

  onState(cb: (state: TransportState) => void): Unsubscribe {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }

  close(): void {
    if (this.state === 'closed') return;
    // Stop listening first: the friend's answer to the bye (it leaves too) must not cut this short.
    const partner = this.partner;
    const wasOpen = this.state === 'open';
    for (const u of this.unsubs.splice(0)) u();
    const sent = partner !== null && wasOpen ? this.control(partner, 'bye') : undefined;
    this.shutdown('closed', sent);
  }

  // ------------------------------------------------------------ internals

  private control(to: string, c: Control): void | Promise<void> {
    return this.link.send(to, { c });
  }

  private setState(next: TransportState): void {
    if (this.state === next) return;
    this.state = next;
    dispatch(this.stateCbs, next);
  }

  /** Leave the link, stop listening, and move to a terminal state. */
  private shutdown(next: 'closed' | 'full', pendingSend?: void | Promise<void>): void {
    for (const u of this.unsubs.splice(0)) u();
    if (!this.left) {
      this.left = true;
      this.leaveLink(pendingSend);
    }
    this.setState(next);
  }

  /** Leaves the link; when a send is still going out (the bye), gives it a moment first, then leaves regardless. */
  private leaveLink(pendingSend?: void | Promise<void>): void {
    if (!(pendingSend instanceof Promise)) {
      this.link.leave();
      return;
    }
    let done = false;
    const go = (): void => {
      if (done) return;
      done = true;
      this.link.leave();
    };
    pendingSend.then(go, go);
    setTimeout(go, BYE_GRACE_MS);
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
    dispatch(this.msgCbs, data.m);
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

  private onBinary(from: string, raw: unknown, meta: unknown): void {
    if (this.state !== 'open' || from !== this.partner) return;
    // Links differ in what they hand over (an ArrayBuffer or a view of one): take either.
    const data = toArrayBuffer(raw);
    if (data === null || !validBlobMeta(meta, data)) {
      // Never leave the receiver waiting for something that was thrown away.
      this.onRejected(from, meta);
      return;
    }
    dispatch(this.blobCbs, data, meta);
  }

  private onRejected(from: string, meta: unknown): void {
    if (this.state !== 'open' || from !== this.partner) return;
    dispatch(this.rejectedCbs, describeRejected(meta));
  }

  private onProgress(from: string, fraction: number, meta: unknown): void {
    if (this.state !== 'open' || from !== this.partner) return;
    if (typeof fraction !== 'number' || !isRecord(meta)) return;
    if (typeof meta.kind !== 'string' || !(BLOB_KINDS as readonly string[]).includes(meta.kind)) return;
    if (typeof meta.mime !== 'string' || typeof meta.bytes !== 'number') return;
    dispatch(this.progressCbs, fraction, meta as unknown as BlobMeta);
  }
}

/** A two-player Transport over a RawLink. */
export function createPairingTransport(opts: PairingOptions): Transport {
  return new PairingTransport(opts.link, opts.role);
}
