import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BlobMeta, RawLink, RejectedBlob, Transport } from '../../src/core/types';
import { createMemoryHub } from '../../src/net/memoryHub';
import { createPairingTransport } from '../../src/net/pairing';
import { createTrysteroLinkWith, type JoinRoomFn } from '../../src/net/trysteroLink';

type Ctx = { peerId: string; metadata?: unknown };

/** A stand-in for a Trystero room that lets a test deliver payloads exactly as Trystero hands them over. */
function fakeRoom() {
  const handlers = new Map<
    string,
    { message?: (p: unknown, c: Ctx) => void; progress?: (f: number, c: Ctx) => void }
  >();
  const sent: { name: string; payload: unknown; opts: unknown }[] = [];
  const room = {
    makeAction: (name: string) => {
      const h: { message?: (p: unknown, c: Ctx) => void; progress?: (f: number, c: Ctx) => void } = {};
      handlers.set(name, h);
      return {
        send: (payload: unknown, opts: unknown) => {
          sent.push({ name, payload, opts });
          return Promise.resolve();
        },
        onMessage: (cb: (p: unknown, c: Ctx) => void) => {
          h.message = cb;
          return () => undefined;
        },
        onReceiveProgress: (cb: (f: number, c: Ctx) => void) => {
          h.progress = cb;
          return () => undefined;
        },
      };
    },
    getSelf: () => Promise.resolve({ peerId: 'me' }),
    onPeerJoin: () => () => undefined,
    onPeerLeave: () => () => undefined,
    onError: () => () => undefined,
    leave: () => Promise.resolve(),
  };
  return {
    join: (() => room) as unknown as JoinRoomFn,
    sent,
    deliver: (name: string, payload: unknown, ctx: Ctx) => handlers.get(name)?.message?.(payload, ctx),
    progress: (name: string, f: number, ctx: Ctx) => handlers.get(name)?.progress?.(f, ctx),
  };
}

function pattern(n: number): Uint8Array {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (i * 31 + 7) & 0xff;
  return a;
}

const metaOf = (kind: BlobMeta['kind'], bytes: number): BlobMeta => ({ kind, mime: 'image/png', bytes });

async function guestOverFake() {
  const fake = fakeRoom();
  const link = await createTrysteroLinkWith(fake.join, 'ROOM');
  const t = createPairingTransport({ link, role: 'guest' });
  fake.deliver('d', { c: 'accept' }, { peerId: 'host' });
  const blobs: { data: ArrayBuffer; meta: BlobMeta }[] = [];
  const rejected: RejectedBlob[] = [];
  t.onBlob((data, meta) => blobs.push({ data, meta }));
  t.onBlobRejected?.((info) => rejected.push(info));
  return { fake, t, blobs, rejected };
}

describe('binary payloads as Trystero delivers them', () => {
  it('a Uint8Array reaches Transport.onBlob byte for byte (inline size)', async () => {
    const { fake, t, blobs } = await guestOverFake();
    expect(t.state).toBe('open');
    const bytes = pattern(900);
    fake.deliver('b', bytes, { peerId: 'host', metadata: metaOf('puppet-head', 900) });
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.data).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(blobs[0]!.data)).toEqual(bytes);
    expect(blobs[0]!.meta.kind).toBe('puppet-head');
  });

  it('a Uint8Array reaches Transport.onBlob byte for byte (multi-chunk size)', async () => {
    const { fake, blobs } = await guestOverFake();
    const bytes = pattern(300_000);
    fake.deliver('b', bytes, { peerId: 'host', metadata: metaOf('song', 300_000) });
    expect(blobs).toHaveLength(1);
    expect(new Uint8Array(blobs[0]!.data)).toEqual(bytes);
  });

  it('a view with a non-zero byteOffset is copied exactly, not the whole backing buffer', async () => {
    const { fake, blobs } = await guestOverFake();
    const backing = pattern(5000);
    const view = new Uint8Array(backing.buffer, 1234, 777);
    fake.deliver('b', view, { peerId: 'host', metadata: metaOf('puppet-sock', 777) });
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.data.byteLength).toBe(777);
    expect(new Uint8Array(blobs[0]!.data)).toEqual(backing.subarray(1234, 1234 + 777));
  });

  it('still accepts a plain ArrayBuffer and other typed-array views', async () => {
    const { fake, blobs } = await guestOverFake();
    fake.deliver('b', pattern(10).buffer, { peerId: 'host', metadata: metaOf('puppet-head', 10) });
    const dv = new DataView(pattern(20).buffer, 4, 8);
    fake.deliver('b', dv, { peerId: 'host', metadata: metaOf('puppet-head', 8) });
    expect(blobs.map((b) => b.data.byteLength)).toEqual([10, 8]);
  });

  it('tells listeners when the payload is not bytes at all, naming the kind', async () => {
    const { fake, blobs, rejected } = await guestOverFake();
    fake.deliver('b', 'not bytes', { peerId: 'host', metadata: metaOf('puppet-sword', 9) });
    fake.deliver('b', { x: 1 }, { peerId: 'host', metadata: metaOf('song', 9) });
    fake.deliver('b', 'nope', { peerId: 'host', metadata: { junk: true } });
    expect(blobs).toHaveLength(0);
    expect(rejected).toEqual([{ kind: 'puppet-sword' }, { kind: 'song' }, { kind: null }]);
  });
});

describe('a pairing transport that discards a blob says so', () => {
  function pair() {
    const hub = createMemoryHub();
    const host = hub.join();
    const guestLink = hub.join();
    const h = createPairingTransport({ link: host, role: 'host' });
    const g = createPairingTransport({ link: guestLink, role: 'guest' });
    const rejected: RejectedBlob[] = [];
    g.onBlobRejected?.((info) => rejected.push(info));
    const blobs: BlobMeta[] = [];
    g.onBlob((_d, m) => blobs.push(m));
    return { h, g, host, rejected, blobs, guestLink };
  }

  it('reports bad metadata, a wrong byte count and an unknown kind', async () => {
    const { h, rejected, blobs } = pair();
    await h.sendBlob(new ArrayBuffer(5), { kind: 'puppet-head', mime: 'image/png', bytes: 6 });
    await h.sendBlob(new ArrayBuffer(5), { kind: 'nonsense' as never, mime: 'image/png', bytes: 5 });
    await h.sendBlob(new ArrayBuffer(5), { kind: 'puppet-sock', mime: 3 as never, bytes: 5 });
    expect(blobs).toHaveLength(0);
    expect(rejected).toEqual([{ kind: 'puppet-head' }, { kind: null }, { kind: 'puppet-sock' }]);
  });

  it('carries the name from a head so the puppet can still be named', async () => {
    const { h, rejected } = pair();
    await h.sendBlob(new ArrayBuffer(5), { kind: 'puppet-head', mime: 'image/png', bytes: 9, name: 'Mo' });
    expect(rejected).toEqual([{ kind: 'puppet-head', name: 'Mo' }]);
  });

  it('accepts a link that hands over a view (any link implementation)', () => {
    const binaryCbs: ((from: string, data: ArrayBuffer, meta: unknown) => void)[] = [];
    const dataCbs: ((from: string, data: unknown) => void)[] = [];
    const link: RawLink = {
      selfId: 'me',
      send: () => undefined,
      sendBinary: () => Promise.resolve(),
      onData: (cb) => {
        dataCbs.push(cb);
        return () => undefined;
      },
      onBinary: (cb) => {
        binaryCbs.push(cb);
        return () => undefined;
      },
      onBinaryProgress: () => () => undefined,
      onPeerJoin: () => () => undefined,
      onPeerLeave: () => () => undefined,
      leave: () => undefined,
    };
    const g = createPairingTransport({ link, role: 'guest' });
    for (const cb of dataCbs) cb('host', { c: 'accept' });
    const got: ArrayBuffer[] = [];
    g.onBlob((d) => got.push(d));
    const backing = pattern(100);
    const view = new Uint8Array(backing.buffer, 10, 20);
    for (const cb of binaryCbs) cb('host', view as unknown as ArrayBuffer, metaOf('puppet-head', 20));
    expect(got).toHaveLength(1);
    expect(new Uint8Array(got[0]!)).toEqual(backing.subarray(10, 30));
  });
});

// ---------------------------------------------------------------- the real Trystero action code

interface Manager {
  makeAction(name: string): {
    send(p: unknown, o?: unknown): Promise<void>;
    onMessage(cb: (p: unknown, c: Ctx) => void): () => void;
    onReceiveProgress(cb: (f: number, c: Ctx) => void): () => void;
  };
  handleData(peerId: string, data: Uint8Array): void;
}

async function loadActionManager(): Promise<(deps: unknown) => Manager> {
  // Trystero does not export its action code; reach it through its own installed files.
  const here = createRequire(import.meta.url);
  const trystero = here.resolve('trystero');
  const nostr = createRequire(realpathSync(trystero)).resolve('@trystero-p2p/nostr');
  const core = createRequire(realpathSync(nostr)).resolve('@trystero-p2p/core');
  const actions = join(dirname(realpathSync(core)), 'actions.mjs');
  const mod = (await import(pathToFileURL(actions).href)) as {
    createActionManager: (deps: unknown) => Manager;
  };
  return mod.createActionManager;
}

/** Two rooms whose actions are the real Trystero code, joined by a fake data channel. */
async function realWirePair() {
  const createActionManager = await loadActionManager();
  const managers: Record<string, Manager> = {};
  const errors: unknown[] = [];
  const make = (self: string, other: string) => {
    const transport = {
      isOpen: true,
      bufferedAmount: 0,
      waitForDrain: () => true,
      sendFrame: (bytes: Uint8Array) => {
        const copy = bytes.slice();
        queueMicrotask(() => managers[other]?.handleData(self, copy));
      },
    };
    managers[self] = createActionManager({
      getTransport: () => transport,
      getPeerIds: () => [other],
      canReceiveFromPeer: () => true,
      onPeerError: (_id: string, err: unknown) => errors.push(err),
    });
    const room = {
      makeAction: (name: string) => managers[self]!.makeAction(name),
      getSelf: () => Promise.resolve({ peerId: self }),
      onPeerJoin: (cb: (c: { peerId: string }) => void) => {
        cb({ peerId: other });
        return () => undefined;
      },
      onPeerLeave: () => () => undefined,
      onError: () => () => undefined,
      leave: () => Promise.resolve(),
    };
    return (() => room) as unknown as JoinRoomFn;
  };
  const joinA = make('host-id', 'guest-id');
  const joinB = make('guest-id', 'host-id');
  const host = createPairingTransport({ link: await createTrysteroLinkWith(joinA, 'R'), role: 'host' });
  const guest = createPairingTransport({ link: await createTrysteroLinkWith(joinB, 'R'), role: 'guest' });
  return { host, guest, errors };
}

function nextBlob(t: Transport): Promise<{ data: ArrayBuffer; meta: BlobMeta }> {
  return new Promise((resolve) => {
    const off = t.onBlob((data, meta) => {
      off();
      resolve({ data, meta });
    });
  });
}

describe('through the real Trystero action code', () => {
  it('delivers blobs from both sides, small and chunked, byte for byte', async () => {
    const { host, guest, errors } = await realWirePair();
    await new Promise((r) => setTimeout(r, 0));
    expect(host.state).toBe('open');
    expect(guest.state).toBe('open');

    const small = pattern(2000);
    const smallMeta = { ...metaOf('puppet-head', 2000), name: 'Ada' };
    const gotSmall = nextBlob(guest);
    await host.sendBlob(small.slice().buffer, smallMeta);
    const a = await gotSmall;
    expect(new Uint8Array(a.data)).toEqual(small);
    expect(a.meta).toEqual(smallMeta);

    const big = pattern(400_000);
    const gotBig = nextBlob(host);
    const progress: number[] = [];
    await guest.sendBlob(big.slice().buffer, metaOf('song', 400_000), (f) => progress.push(f));
    const b = await gotBig;
    expect(new Uint8Array(b.data)).toEqual(big);
    expect(progress.at(-1)).toBe(1);
    expect(errors).toEqual([]);
  });
});
