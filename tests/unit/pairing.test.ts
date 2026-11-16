import { describe, expect, it } from 'vitest';
import type { BlobMeta, Message, TransportState } from '../../src/core/types';
import { createMemoryHub } from '../../src/net/memoryHub';
import { createPairingTransport } from '../../src/net/pairing';

function mk(hub: ReturnType<typeof createMemoryHub>, role: 'host' | 'guest') {
  const link = hub.join();
  const t = createPairingTransport({ link, role });
  const msgs: Message[] = [];
  const blobs: { data: ArrayBuffer; meta: BlobMeta }[] = [];
  const states: TransportState[] = [];
  t.onMessage((m) => msgs.push(m));
  t.onBlob((data, meta) => blobs.push({ data, meta }));
  t.onState((s) => states.push(s));
  return { link, t, msgs, blobs, states };
}

const meta = (bytes: number): BlobMeta => ({ kind: 'song', mime: 'audio/mpeg', bytes });
const bytes = (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => i)).buffer;

describe('pairing transport', () => {
  it('pairs host then guest', () => {
    const hub = createMemoryHub();
    const h = mk(hub, 'host');
    expect(h.t.state).toBe('waiting');
    const g = mk(hub, 'guest');
    expect(h.t.state).toBe('open');
    expect(g.t.state).toBe('open');
    expect(h.states).toEqual(['open']);
    expect(g.t.role).toBe('guest');
    expect(h.t.rttMs).toBeNull();
  });

  it('pairs guest then host, the guest staying connecting meanwhile', () => {
    const hub = createMemoryHub();
    const g = mk(hub, 'guest');
    expect(g.t.state).toBe('connecting');
    const h = mk(hub, 'host');
    expect(h.t.state).toBe('open');
    expect(g.t.state).toBe('open');
  });

  it('carries messages and blobs between partners', async () => {
    const hub = createMemoryHub();
    const h = mk(hub, 'host');
    const g = mk(hub, 'guest');
    h.t.send({ t: 'ready', ready: true });
    g.t.send({ t: 'hello', name: 'Ann', v: 1 });
    expect(g.msgs).toEqual([{ t: 'ready', ready: true }]);
    expect(h.msgs).toEqual([{ t: 'hello', name: 'Ann', v: 1 }]);
    const progress: number[] = [];
    await h.t.sendBlob(bytes(5), meta(5), (f) => progress.push(f));
    expect(progress).toEqual([1]);
    expect(g.blobs).toHaveLength(1);
    expect(new Uint8Array(g.blobs[0]!.data)).toEqual(new Uint8Array([0, 1, 2, 3, 4]));
    expect(g.blobs[0]!.meta).toEqual(meta(5));
  });

  it('gives a third peer "full" and leaves the pair undisturbed', () => {
    const hub = createMemoryHub();
    const h = mk(hub, 'host');
    const g = mk(hub, 'guest');
    const third = mk(hub, 'guest');
    expect(third.t.state).toBe('full');
    expect(h.t.state).toBe('open');
    expect(g.t.state).toBe('open');
    h.t.send({ t: 'rematch' });
    expect(g.msgs).toEqual([{ t: 'rematch' }]);
    expect(third.msgs).toEqual([]);
    third.t.send({ t: 'rematch' });
    expect(h.msgs).toEqual([]);
    // the pair survives the third one's departure
    expect(h.t.state).toBe('open');
    expect(g.t.state).toBe('open');
  });

  it('gives full to a guest arriving before the host sees it and to one arriving after', () => {
    const hub = createMemoryHub();
    const g1 = mk(hub, 'guest');
    const g2 = mk(hub, 'guest');
    const h = mk(hub, 'host');
    expect(g1.t.state).toBe('open');
    expect(g2.t.state).toBe('full');
    expect(h.t.state).toBe('open');
  });

  it('never pairs two hosts, nor two guests', () => {
    const hub = createMemoryHub();
    const a = mk(hub, 'host');
    const b = mk(hub, 'host');
    expect(a.t.state).toBe('waiting');
    expect(b.t.state).toBe('waiting');
    const hub2 = createMemoryHub();
    const c = mk(hub2, 'guest');
    const d = mk(hub2, 'guest');
    expect(c.t.state).toBe('connecting');
    expect(d.t.state).toBe('connecting');
  });

  it('closes when the partner leaves the link', () => {
    const hub = createMemoryHub();
    const h = mk(hub, 'host');
    const g = mk(hub, 'guest');
    g.link.leave();
    expect(h.t.state).toBe('closed');
    expect(h.states).toEqual(['open', 'closed']);
  });

  it('close() closes both and delivers nothing afterwards', () => {
    const hub = createMemoryHub();
    const h = mk(hub, 'host');
    const g = mk(hub, 'guest');
    h.t.close();
    expect(h.t.state).toBe('closed');
    expect(g.t.state).toBe('closed');
    h.t.send({ t: 'ready', ready: true });
    g.t.send({ t: 'ready', ready: true });
    expect(g.msgs).toEqual([]);
    expect(h.msgs).toEqual([]);
    h.t.close();
  });

  it('drops traffic from strangers, malformed data and bad blobs', async () => {
    const hub = createMemoryHub();
    const h = mk(hub, 'host');
    const g = mk(hub, 'guest');
    const stranger = hub.join();
    const hostId = h.link.selfId;
    stranger.send(hostId, { m: { t: 'ready', ready: true } });
    stranger.send(hostId, { c: 'bye' });
    void stranger.sendBinary(hostId, bytes(2), meta(2));
    expect(h.msgs).toEqual([]);
    expect(h.blobs).toEqual([]);
    expect(h.t.state).toBe('open');

    const raw = g.link;
    for (const bad of [null, 5, 'x', [], {}, { m: null }, { m: 3 }, { m: {} }, { m: { t: 4 } }, { c: 7 }]) {
      raw.send(hostId, bad);
    }
    expect(h.msgs).toEqual([]);

    const badMetas: unknown[] = [
      null,
      {},
      { kind: 'virus', mime: 'x', bytes: 3 },
      { kind: 'song', mime: 5, bytes: 3 },
      { kind: 'song', mime: 'x', bytes: '3' },
      { kind: 'song', mime: 'x', bytes: 4 },
    ];
    for (const m of badMetas) await raw.sendBinary(hostId, bytes(3), m);
    expect(h.blobs).toEqual([]);
    await raw.sendBinary(hostId, bytes(3), meta(3));
    expect(h.blobs).toHaveLength(1);
  });

  it('drops send before open and rejects sendBlob', async () => {
    const hub = createMemoryHub();
    const h = mk(hub, 'host');
    h.t.send({ t: 'ready', ready: true });
    await expect(h.t.sendBlob(bytes(1), meta(1))).rejects.toBeTruthy();
    const g = mk(hub, 'guest');
    expect(g.msgs).toEqual([]);
  });

  it('works with latency, ordered, once pumped', () => {
    const clockRef = { t: 0 };
    const clock = { now: () => clockRef.t };
    const hub = createMemoryHub({ latencySec: 0.04, clock });
    const h = mk(hub, 'host');
    const g = mk(hub, 'guest');
    const advance = (s: number) => {
      clockRef.t += s;
      hub.pump();
    };
    expect(h.t.state).toBe('waiting');
    advance(0.04);
    advance(0.04);
    expect(h.t.state).toBe('open');
    expect(g.t.state).toBe('open');
    h.t.send({ t: 'rematch' });
    expect(g.msgs).toEqual([]);
    advance(0.04);
    expect(g.msgs).toEqual([{ t: 'rematch' }]);
  });
});
