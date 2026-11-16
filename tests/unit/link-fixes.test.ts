import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RawLink } from '../../src/core/types';
import { createMemoryHub } from '../../src/net/memoryHub';
import { createPairingTransport } from '../../src/net/pairing';
import { createTrysteroLinkWith, MAX_RECEIVE_BYTES, type JoinRoomFn } from '../../src/net/trysteroLink';

afterEach(() => {
  vi.useRealTimers();
});

describe('closing a pairing transport', () => {
  it('still tells the friend the room is closed when the bye is lost', () => {
    const hub = createMemoryHub();
    const hostLink = hub.join();
    const lossy: RawLink = {
      ...hostLink,
      selfId: hostLink.selfId,
      send: (to, data) => {
        if (typeof data === 'object' && data !== null && (data as { c?: string }).c === 'bye') return;
        hostLink.send(to, data);
      },
      sendBinary: (...a) => hostLink.sendBinary(...a),
      onData: (cb) => hostLink.onData(cb),
      onBinary: (cb) => hostLink.onBinary(cb),
      onBinaryProgress: (cb) => hostLink.onBinaryProgress(cb),
      onPeerJoin: (cb) => hostLink.onPeerJoin(cb),
      onPeerLeave: (cb) => hostLink.onPeerLeave(cb),
      leave: () => hostLink.leave(),
    };
    const host = createPairingTransport({ link: lossy, role: 'host' });
    const guest = createPairingTransport({ link: hub.join(), role: 'guest' });
    expect(guest.state).toBe('open');
    host.close();
    expect(guest.state).toBe('closed'); // by the link going away
  });

  /** A link whose sends are promises that the test settles by hand. */
  function slowLink() {
    const hub = createMemoryHub();
    const real = hub.join();
    const settle: (() => void)[] = [];
    let left = 0;
    const link: RawLink = {
      selfId: real.selfId,
      send: (to, data) => {
        real.send(to, data);
        return new Promise<void>((resolve) => settle.push(resolve));
      },
      sendBinary: (...a) => real.sendBinary(...a),
      onData: (cb) => real.onData(cb),
      onBinary: (cb) => real.onBinary(cb),
      onBinaryProgress: (cb) => real.onBinaryProgress(cb),
      onPeerJoin: (cb) => real.onPeerJoin(cb),
      onPeerLeave: (cb) => real.onPeerLeave(cb),
      leave: () => {
        left++;
        real.leave();
      },
    };
    const guestLink = hub.join();
    return { link, guestLink, settle, left: () => left };
  }

  it('gives the bye a moment to go out before the link is left', async () => {
    const { link, guestLink, settle, left } = slowLink();
    const guest = createPairingTransport({ link: guestLink, role: 'guest' });
    const host = createPairingTransport({ link, role: 'host' });
    expect(host.state).toBe('open');
    host.close();
    expect(host.state).toBe('closed');
    expect(guest.state).toBe('closed'); // the bye itself got through
    expect(left()).toBe(0); // the link is still there while it goes out
    for (const s of settle) s();
    await Promise.resolve();
    await Promise.resolve();
    expect(left()).toBe(1);
  });

  it('leaves anyway after a short wait if the send never settles, and only once', () => {
    vi.useFakeTimers();
    const { link, guestLink, left } = slowLink();
    createPairingTransport({ link: guestLink, role: 'guest' });
    const host = createPairingTransport({ link, role: 'host' });
    host.close();
    expect(left()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(left()).toBe(1);
    host.close();
    vi.advanceTimersByTime(1000);
    expect(left()).toBe(1);
  });

  it('leaves at once when the link has nothing to wait for', () => {
    const hub = createMemoryHub();
    const host = createPairingTransport({ link: hub.join(), role: 'host' });
    host.close();
    expect(host.state).toBe('closed');
  });
});

/** A stand-in for Trystero's room, with the parts the link uses. */
function stubJoin() {
  const errors = new Set<(e: { code: string; message: string }) => void>();
  const configs: unknown[] = [];
  const room = {
    makeAction: () => ({
      send: () => Promise.resolve(),
      onMessage: () => () => undefined,
      onReceiveProgress: () => () => undefined,
    }),
    getSelf: () => Promise.resolve({ peerId: 'me' }),
    onPeerJoin: () => () => undefined,
    onPeerLeave: () => () => undefined,
    onError: (cb: (e: { code: string; message: string }) => void) => {
      errors.add(cb);
      return () => errors.delete(cb);
    },
    leave: () => Promise.resolve(),
  };
  const join = ((config: unknown) => {
    configs.push(config);
    return room;
  }) as unknown as JoinRoomFn;
  const fail = (code: string, message = code) => {
    for (const cb of [...errors]) cb({ code, message });
  };
  return { join, fail, configs };
}

describe('the Trystero link', () => {
  it('reaches failed when every relay fails, and tells listeners once', async () => {
    const { join, fail } = stubJoin();
    const link = await createTrysteroLinkWith(join, 'ROW-G-1');
    expect(link.failed).toBe(false);
    const heard: string[] = [];
    link.onFailed?.((why) => heard.push(why));
    fail('relay-failed', 'all signaling relays failed');
    fail('relay-failed', 'again');
    expect(link.failed).toBe(true);
    expect(heard).toEqual(['all signaling relays failed']);
    // A listener added after the failure hears about it at once.
    const late: string[] = [];
    link.onFailed?.((why) => late.push(why));
    expect(late).toEqual(['all signaling relays failed']);
  });

  it('also fails when the peer connection or handshake fails', async () => {
    for (const code of ['peer-connect-failed', 'handshake-failed']) {
      const { join, fail } = stubJoin();
      const link = await createTrysteroLinkWith(join, 'X');
      fail(code);
      expect(link.failed, code).toBe(true);
    }
  });

  it('does not fail for errors that are about one peer or a full room', async () => {
    const { join, fail } = stubJoin();
    const link = await createTrysteroLinkWith(join, 'X');
    fail('room-full');
    fail('peer-error');
    fail('decrypt-failed');
    expect(link.failed).toBe(false);
  });

  it('caps what it will receive at the song limit plus slack, and uses no identity', async () => {
    const { join, configs } = stubJoin();
    await createTrysteroLinkWith(join, 'X');
    expect(configs[0]).toMatchObject({ identity: 'none', maxReceiveBytes: MAX_RECEIVE_BYTES });
    expect(MAX_RECEIVE_BYTES).toBe(10 * 1024 * 1024 + 64 * 1024);
  });
});
