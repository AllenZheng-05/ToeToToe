import { describe, expect, it } from 'vitest';
import type { BlobMeta, Message, TransportState } from '../../src/core/types';
import { createLoopbackPair } from '../../src/net/loopback';
import { FakeClock } from '../helpers/fakeClock';

describe('createLoopbackPair', () => {
  it('starts open with the right roles', () => {
    const p = createLoopbackPair();
    expect(p.host.role).toBe('host');
    expect(p.guest.role).toBe('guest');
    expect(p.host.state).toBe('open');
    expect(p.guest.state).toBe('open');
  });

  it('delivers synchronously, in order, in both directions', () => {
    const p = createLoopbackPair();
    const atGuest: Message[] = [];
    const atHost: Message[] = [];
    p.guest.onMessage((m) => atGuest.push(m));
    p.host.onMessage((m) => atHost.push(m));
    p.host.send({ t: 'ready', ready: true });
    expect(atGuest).toEqual([{ t: 'ready', ready: true }]);
    p.host.send({ t: 'rematch' });
    p.host.send({ t: 'leave' });
    p.guest.send({ t: 'hello', name: 'g', v: 1 });
    expect(atGuest.map((m) => m.t)).toEqual(['ready', 'rematch', 'leave']);
    expect(atHost.map((m) => m.t)).toEqual(['hello']);
  });

  it('deep-copies messages', () => {
    const p = createLoopbackPair();
    const got: Message[] = [];
    p.guest.onMessage((m) => got.push(m));
    const msg: Message = { t: 'commit', phrase: 1, strikes: [{ slot: 0, x: 0.1, y: 0.2 }] };
    p.host.send(msg);
    if (msg.t === 'commit') msg.strikes[0]!.x = 0.9;
    const received = got[0];
    expect(received).not.toBe(msg);
    expect(received?.t === 'commit' && received.strikes[0]?.x).toBe(0.1);
  });

  it('delivers blobs with meta and a final progress of 1, as copies', async () => {
    const p = createLoopbackPair();
    const progress: number[] = [];
    const sent: number[] = [];
    const blobs: { data: ArrayBuffer; meta: BlobMeta }[] = [];
    p.guest.onBlobProgress((f) => progress.push(f));
    p.guest.onBlob((data, meta) => blobs.push({ data, meta }));
    const bytes = new Uint8Array([1, 2, 3]);
    const meta: BlobMeta = { kind: 'song', mime: 'audio/mpeg', bytes: 3, name: 'a' };
    await p.host.sendBlob(bytes.buffer, meta, (f) => sent.push(f));
    bytes[0] = 99;
    meta.name = 'changed';
    expect(sent[sent.length - 1]).toBe(1);
    expect(progress[progress.length - 1]).toBe(1);
    expect(blobs).toHaveLength(1);
    expect(Array.from(new Uint8Array(blobs[0]!.data))).toEqual([1, 2, 3]);
    expect(blobs[0]?.meta).toEqual({ kind: 'song', mime: 'audio/mpeg', bytes: 3, name: 'a' });
  });

  it('with latency, delivers only after pump() once the time has come', () => {
    const clock = new FakeClock(10);
    const p = createLoopbackPair({ latencySec: 0.2, clock });
    const got: string[] = [];
    p.guest.onMessage((m) => got.push(m.t));
    p.host.send({ t: 'ready', ready: true });
    expect(got).toEqual([]);
    p.pump();
    expect(got).toEqual([]);
    clock.set(10.19);
    p.pump();
    expect(got).toEqual([]);
    clock.set(10.2);
    p.host.send({ t: 'rematch' });
    p.pump();
    expect(got).toEqual(['ready']);
    clock.set(10.4);
    p.pump();
    expect(got).toEqual(['ready', 'rematch']);
  });

  it('with latency, keeps order and delivers blobs late too', () => {
    const clock = new FakeClock(0);
    const p = createLoopbackPair({ latencySec: 0.1, clock });
    const log: string[] = [];
    p.guest.onMessage((m) => log.push(m.t));
    p.guest.onBlob(() => log.push('blob'));
    p.host.send({ t: 'ready', ready: false });
    void p.host.sendBlob(new ArrayBuffer(2), { kind: 'song', mime: 'x', bytes: 2 });
    p.host.send({ t: 'leave' });
    clock.set(1);
    p.pump();
    expect(log).toEqual(['ready', 'blob', 'leave']);
  });

  it('close propagates to both ends and notifies listeners', () => {
    const p = createLoopbackPair();
    const hostStates: TransportState[] = [];
    const guestStates: TransportState[] = [];
    p.host.onState((s) => hostStates.push(s));
    p.guest.onState((s) => guestStates.push(s));
    const got: Message[] = [];
    p.host.onMessage((m) => got.push(m));
    p.guest.close();
    expect(p.host.state).toBe('closed');
    expect(p.guest.state).toBe('closed');
    expect(hostStates).toEqual(['closed']);
    expect(guestStates).toEqual(['closed']);
    p.guest.send({ t: 'leave' });
    expect(got).toEqual([]);
    p.host.close();
    expect(hostStates).toEqual(['closed']);
  });

  it('unsubscribe stops delivery', () => {
    const p = createLoopbackPair();
    const got: string[] = [];
    const off = p.guest.onMessage((m) => got.push(m.t));
    p.host.send({ t: 'rematch' });
    off();
    p.host.send({ t: 'leave' });
    expect(got).toEqual(['rematch']);
  });

  it('refuses latency without a clock', () => {
    expect(() => createLoopbackPair({ latencySec: 0.1 })).toThrow();
  });
});
