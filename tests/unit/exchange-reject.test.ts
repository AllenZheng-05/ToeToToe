import { describe, expect, it } from 'vitest';
import { createTunables } from '../../src/core/tunables';
import type { BlobMeta, Message, RejectedBlob, Transport } from '../../src/core/types';
import type { TrackInfo } from '../../src/data/tracks';
import { createLoopbackPair } from '../../src/net/loopback';
import { Room } from '../../src/net/room';
import { PARTS, type PartKind } from '../../src/puppet/parts';
import {
  Exchange,
  MSG_FRIEND_COULD_NOT_LOAD,
  PUPPET_RESEND_DELAY_MS,
  TRANSFER_STALL_MS,
  type ExchangeDeps,
} from '../../src/scenes/exchange';
import type { LoadedTheme } from '../../src/theme/theme';
import { FakeClock } from '../helpers/fakeClock';

function png(kind: PartKind): ArrayBuffer {
  const { width, height } = PARTS[kind];
  const buf = new ArrayBuffer(32);
  const v = new DataView(buf);
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((b, i) => v.setUint8(i, b));
  v.setUint32(8, 13);
  v.setUint32(12, 0x49484452);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return buf;
}

/** Loopback transport plus the things a real link can do that it cannot: reject blobs, fail or hang sends. */
function controllable(t: Transport) {
  const progress = new Set<(fraction: number, meta: BlobMeta) => void>();
  const rejected = new Set<(info: RejectedBlob) => void>();
  const wire: Message[] = [];
  const control = {
    puppetSends: 0,
    /** The next n puppet sends reject. */
    failPuppetSends: 0,
    /** The next n puppet sends never settle. */
    hangPuppetSends: 0,
  };
  const wrapped: Transport = {
    get state() {
      return t.state;
    },
    role: t.role,
    get rttMs() {
      return t.rttMs;
    },
    send: (m) => {
      wire.push(m);
      t.send(m);
    },
    sendBlob: (data, meta, onProgress) => {
      if (meta.kind !== 'song') {
        if (meta.kind === 'puppet-head') control.puppetSends++;
        if (control.failPuppetSends > 0) {
          if (meta.kind === 'puppet-head') control.failPuppetSends--;
          return Promise.reject(new Error('link dropped'));
        }
        if (control.hangPuppetSends > 0) {
          if (meta.kind === 'puppet-head') control.hangPuppetSends--;
          return new Promise<void>(() => undefined);
        }
      }
      return t.sendBlob(data, meta, onProgress);
    },
    onMessage: (cb) => t.onMessage(cb),
    onBlob: (cb) => t.onBlob(cb),
    onBlobProgress: (cb) => {
      progress.add(cb);
      const off = t.onBlobProgress(cb);
      return () => {
        progress.delete(cb);
        off();
      };
    },
    onBlobRejected: (cb) => {
      rejected.add(cb);
      return () => rejected.delete(cb);
    },
    onState: (cb) => t.onState(cb),
    close: () => t.close(),
  };
  return {
    transport: wrapped,
    control,
    wire,
    reportProgress(fraction: number, meta: BlobMeta) {
      for (const cb of [...progress]) cb(fraction, meta);
    },
    reject(info: RejectedBlob) {
      for (const cb of [...rejected]) cb(info);
    },
  };
}

function loaded(info: TrackInfo, file?: LoadedTheme['file']): LoadedTheme {
  return {
    info,
    buffer: { duration: 60 } as AudioBuffer,
    loopStart: info.firstBeatOffset,
    loopEnd: 40,
    file: file ?? null,
  };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

function rig() {
  const pair = createLoopbackPair();
  const clock = new FakeClock(0);
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const schedule = (fn: () => void, ms: number) => {
    const t = { fn, ms, live: true };
    timers.push(t);
    return () => {
      t.live = false;
    };
  };
  const mk = (role: 'host' | 'guest') => {
    const c = controllable(role === 'host' ? pair.host : pair.guest);
    const tunables = createTunables();
    const room = new Room({ transport: c.transport, clock, name: role, tunables, defer: () => undefined });
    const decoded: PartKind[] = [];
    const fellBack: PartKind[] = [];
    const deps: ExchangeDeps = {
      transport: c.transport,
      room,
      role,
      tunables,
      schedule,
      getPuppet: () =>
        Promise.resolve({ name: role, head: png('head'), sock: png('sock'), sword: png('sword') }),
      decodePart: (_d, kind) => {
        decoded.push(kind);
        return Promise.resolve({} as never);
      },
      fallbackPart: (kind) => {
        fellBack.push(kind);
        return Promise.resolve({} as never);
      },
      loadTheme: (info) => Promise.resolve(loaded(info)),
      loadSong: (offer) =>
        Promise.resolve(
          loaded({
            id: offer.id,
            source: 'upload',
            title: offer.title,
            bpm: offer.bpm,
            firstBeatOffset: offer.firstBeatOffset,
            hash: offer.hash,
          }),
        ),
    };
    return { room, exchange: new Exchange(deps), decoded, fellBack, ...c };
  };
  const host = mk('host');
  const guest = mk('guest');
  /** Run every live timer that was asked to wait at least `ms`. */
  const fireTimers = (ms: number) => {
    for (const t of timers.splice(0)) if (t.live && t.ms >= ms) t.fn();
  };
  return { host, guest, fireTimers, timers };
}

const head = (name?: string): BlobMeta => ({
  kind: 'puppet-head',
  mime: 'image/png',
  bytes: 32,
  ...(name ? { name } : {}),
});
const sock: BlobMeta = { kind: 'puppet-sock', mime: 'image/png', bytes: 32 };
const sword: BlobMeta = { kind: 'puppet-sword', mime: 'image/png', bytes: 32 };

describe('a drawing part the link threw away', () => {
  it('ends its progress at once and the puppet falls back to a preset part for it', async () => {
    const { guest } = rig();
    await settle();
    const base = guest.exchange.view.peerPuppet?.version ?? 0;
    guest.reportProgress(0.4, head('Bea'));
    expect(guest.exchange.view.puppetFetch).toBeCloseTo(0.4 / 3);
    guest.reject({ kind: 'puppet-head', name: 'Bea' });
    expect(guest.exchange.view.puppetFetch).toBeCloseTo(1 / 3);
    guest.reportProgress(0.4, sock);
    guest.reject({ kind: 'puppet-sock' });
    // The label counts that part as done rather than leaving it stuck.
    expect(guest.exchange.view.puppetFetch).toBeCloseTo(2 / 3);
    guest.reportProgress(0.9, sword);
    guest.reject({ kind: 'puppet-sword' });
    await settle();
    expect(guest.exchange.view.puppetFetch).toBeNull();
    const puppet = guest.exchange.view.peerPuppet;
    expect(puppet).not.toBeNull();
    expect(puppet?.version).toBeGreaterThan(base);
    expect(puppet?.name).toBe('Bea');
    expect(guest.fellBack.sort()).toEqual(['head', 'sock', 'sword']);
  });

  it('with no kind to go on, clears every drawing and song in flight', async () => {
    const { guest } = rig();
    await settle();
    guest.reportProgress(0.5, head());
    guest.reportProgress(0.4, { kind: 'song', mime: 'audio/wav', bytes: 6 });
    expect(guest.exchange.busy).toBe(true);
    guest.reject({ kind: null });
    expect(guest.exchange.view.puppetFetch).toBeNull();
    expect(guest.exchange.view.songFetch).toBeNull();
    expect(guest.exchange.busy).toBe(false);
  });
});

describe('a song the link threw away', () => {
  it('gives the guest the plain could-not-load path, and the host hears of it', async () => {
    const pair = createLoopbackPair();
    const clock = new FakeClock(0);
    const c = controllable(pair.guest);
    const room = new Room({
      transport: c.transport,
      clock,
      name: 'guest',
      tunables: createTunables(),
      defer: () => undefined,
    });
    const exchange = new Exchange({
      transport: c.transport,
      room,
      role: 'guest',
      tunables: createTunables(),
      getPuppet: () =>
        Promise.resolve({ name: 'g', head: png('head'), sock: png('sock'), sword: png('sword') }),
      decodePart: () => Promise.resolve({} as never),
      fallbackPart: () => Promise.resolve({} as never),
      loadTheme: (info) => Promise.resolve(loaded(info)),
      loadSong: () => Promise.reject(new Error('unused')),
    });
    // The host's side, by hand: a hello, then an upload offer.
    const hostRoom = new Room({
      transport: pair.host,
      clock,
      name: 'host',
      tunables: createTunables(),
      defer: () => undefined,
    });
    hostRoom.setTheme({
      source: 'upload',
      id: 'song-1',
      title: 'My song',
      bpm: 110,
      firstBeatOffset: 0.1,
      hash: 'h1',
      bytes: 6,
    });
    await settle();
    expect(exchange.view.theme.status).toBe('loading');
    c.reportProgress(0.3, { kind: 'song', mime: 'audio/wav', bytes: 6, hash: 'h1' });
    expect(exchange.view.songFetch).toBe(0.3);
    c.reject({ kind: 'song' });
    await settle();
    expect(exchange.view.songFetch).toBeNull();
    expect(exchange.view.theme.status).toBe('failed');
    expect(exchange.view.theme.message).toBe('That song could not be loaded.');
    expect(exchange.view.canReady).toBe(false);
    const answers = c.wire.filter((m) => m.t === 'themeReady');
    expect(answers.at(-1)).toMatchObject({ ok: false });
    expect(MSG_FRIEND_COULD_NOT_LOAD).toBeTruthy();
  });
});

describe('what counts as busy', () => {
  it('includes a drawing send that has been asked for but has not begun to move', async () => {
    const { host } = rig();
    await settle();
    expect(host.exchange.busy).toBe(false);
    host.exchange.sendPuppet();
    expect(host.exchange.busy).toBe(true); // the sync must not ping into the files that are about to go
    await settle();
    expect(host.exchange.busy).toBe(false);
  });
});

describe('drawings that did not go out', () => {
  it('are sent again once after a failed send, and not looped', async () => {
    const { host, guest, fireTimers } = rig();
    await settle();
    // The automatic first send happened at construction; start from a known point.
    const first = host.control.puppetSends;
    host.control.failPuppetSends = 2; // the next attempt and its one retry both fail
    host.exchange.sendPuppet();
    await settle();
    expect(host.control.puppetSends).toBe(first + 1);
    fireTimers(PUPPET_RESEND_DELAY_MS);
    await settle();
    expect(host.control.puppetSends).toBe(first + 2); // one retry
    fireTimers(PUPPET_RESEND_DELAY_MS);
    await settle();
    expect(host.control.puppetSends).toBe(first + 2); // and no more
    expect(host.exchange.view.puppetSend).toBeNull();
    void guest;
  });

  it('a retry that goes through gets the puppet to the friend', async () => {
    const { host, guest, fireTimers } = rig();
    await settle();
    const version = guest.exchange.view.peerPuppet?.version ?? 0;
    host.control.failPuppetSends = 1;
    host.exchange.sendPuppet();
    await settle();
    fireTimers(PUPPET_RESEND_DELAY_MS);
    await settle();
    expect(guest.exchange.view.peerPuppet?.version).toBeGreaterThan(version);
  });

  it('are sent again once when a send hangs past the stall timeout', async () => {
    const { host, fireTimers } = rig();
    await settle();
    const first = host.control.puppetSends;
    host.control.hangPuppetSends = 2;
    host.exchange.sendPuppet();
    await settle();
    expect(host.control.puppetSends).toBe(first + 1);
    expect(host.exchange.view.puppetSend).toBe(0);
    fireTimers(TRANSFER_STALL_MS); // nothing moved for the whole stall time
    await settle();
    fireTimers(0);
    await settle();
    expect(host.control.puppetSends).toBe(first + 2);
    fireTimers(TRANSFER_STALL_MS);
    await settle();
    fireTimers(0);
    await settle();
    expect(host.control.puppetSends).toBe(first + 2);
  });
});
