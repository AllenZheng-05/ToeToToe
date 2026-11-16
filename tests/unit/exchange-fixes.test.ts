import { describe, expect, it } from 'vitest';
import { createTunables } from '../../src/core/tunables';
import type { BlobMeta, Message, ThemeOffer, Transport } from '../../src/core/types';
import type { TrackInfo } from '../../src/data/tracks';
import { createLoopbackPair } from '../../src/net/loopback';
import { Room } from '../../src/net/room';
import { PARTS, type PartKind } from '../../src/puppet/parts';
import {
  Exchange,
  MAX_THEME_TITLE,
  ThemeGate,
  TRANSFER_STALL_MS,
  themeGateKey,
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

/** What loopback transports cannot do on their own: report partial progress, and fail a song send. */
function controllable(t: Transport) {
  const progress = new Set<(fraction: number, meta: BlobMeta) => void>();
  const wire: Message[] = [];
  const control = { songSends: 0, failSongSends: 0 };
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
      if (meta.kind === 'song') {
        control.songSends++;
        if (control.failSongSends > 0) {
          control.failSongSends--;
          return Promise.reject(new Error('link dropped'));
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

const MARCH: TrackInfo = { id: 'march', source: 'house', title: 'March', bpm: 100, firstBeatOffset: 0.2 };
const song = (hash: string, bpm = 110, firstBeatOffset = 0.1): TrackInfo => ({
  id: 'song-1',
  source: 'upload',
  title: 'My song',
  bpm,
  firstBeatOffset,
  hash,
  bytes: 6,
});

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
  const mk = (role: 'host' | 'guest', name: string) => {
    const c = controllable(role === 'host' ? pair.host : pair.guest);
    const tunables = createTunables();
    const room = new Room({ transport: c.transport, clock, name, tunables, defer: () => undefined });
    const loads: string[] = [];
    const deps: ExchangeDeps = {
      transport: c.transport,
      room,
      role,
      tunables,
      schedule,
      getPuppet: () =>
        Promise.resolve({ name: name, head: png('head'), sock: png('sock'), sword: png('sword') }),
      decodePart: () => Promise.resolve({} as never),
      fallbackPart: () => Promise.resolve({} as never),
      loadTheme: (info) => {
        loads.push(`${info.id}@${info.bpm}`);
        return Promise.resolve(loaded(info));
      },
      loadSong: (offer) => {
        loads.push(`${offer.id}@${offer.bpm}`);
        return Promise.resolve(
          loaded({
            id: offer.id,
            source: 'upload',
            title: offer.title,
            bpm: offer.bpm,
            firstBeatOffset: offer.firstBeatOffset,
            hash: offer.hash,
          }),
        );
      },
    };
    return { room, exchange: new Exchange(deps), loads, ...c };
  };
  const host = mk('host', 'Ada');
  const guest = mk('guest', 'Bo');
  /** Run every live timer that was asked to wait at least `ms`. */
  const fireTimers = (ms: number) => {
    for (const t of timers.splice(0)) if (t.live && t.ms >= ms) t.fn();
  };
  return { host, guest, fireTimers, timers };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

describe('the same song offered again at another tempo or first beat', () => {
  it('is applied to the loaded copy, with no second transfer, the guest unready and the host waiting', async () => {
    const { host, guest } = rig();
    await settle();
    const data = new Uint8Array([1, 2, 3, 4, 5, 6]).buffer;
    host.exchange.offerTheme(loaded(song('h1', 110, 0.1), { data, mime: 'audio/wav' }));
    await settle();
    expect(guest.exchange.view.canReady).toBe(true);
    expect(host.exchange.view.canStart).toBe(true);
    expect(host.control.songSends).toBe(1);
    const loadsBefore = guest.loads.length;
    const first = guest.exchange.theme;

    guest.room.setReady(true);
    expect(guest.room.localReady).toBe(true);

    // The host retunes the same file.
    host.exchange.offerTheme(loaded(song('h1', 126, 0.35), { data, mime: 'audio/wav' }));
    await settle();

    expect(host.control.songSends).toBe(1); // the file was not sent again
    expect(guest.loads.length).toBe(loadsBefore); // nor loaded again
    expect(guest.exchange.theme?.info.bpm).toBe(126);
    expect(guest.exchange.theme?.info.firstBeatOffset).toBe(0.35);
    expect(guest.exchange.theme?.loopStart).toBeCloseTo(0.35);
    expect(guest.exchange.theme?.buffer).toBe(first?.buffer); // the same decoded audio
    expect(guest.exchange.view.theme.offer?.bpm).toBe(126);
    expect(guest.room.localReady).toBe(false); // Ready was reset
    // The guest answered for the new values (the gate itself is checked below) and the host may start.
    expect(host.exchange.view.canStart).toBe(true);
    const ready = guest.wire.filter((m) => m.t === 'themeReady');
    expect(ready.at(-1)).toMatchObject({ ok: true, hash: expect.stringContaining('@126/0.35') });
  });

  it('the gate does not take an answer for the old tempo as one for the new', () => {
    const g = new ThemeGate('host');
    const at = (bpm: number) => ({ ...MARCH, hash: undefined, bpm });
    g.offer(at(100));
    expect(g.peerReport(themeGateKey(at(100)), true)).toBe(true);
    expect(g.canStart).toBe(true);
    expect(g.offer(at(100))).toBe(false); // the same values again change nothing
    expect(g.offer(at(90))).toBe(true); // a new tempo is a new offer
    expect(g.canStart).toBe(false);
    expect(g.peerReport(themeGateKey(at(100)), true)).toBe(false); // the late answer for the old one
    expect(g.canStart).toBe(false);
    expect(g.peerReport(themeGateKey(at(90)), true)).toBe(true);
    expect(g.canStart).toBe(true);
    // A first beat counts the same way.
    expect(g.offer({ ...at(90), firstBeatOffset: 0.9 })).toBe(true);
    expect(g.canStart).toBe(false);
  });

  it('applies a new tempo to a house track too, without loading it again', async () => {
    const { host, guest } = rig();
    await settle();
    host.exchange.offerTheme(loaded(MARCH));
    await settle();
    const loadsBefore = guest.loads.length;
    host.exchange.offerTheme(loaded({ ...MARCH, bpm: 140, firstBeatOffset: 0.5 }));
    await settle();
    expect(guest.loads.length).toBe(loadsBefore);
    expect(guest.exchange.theme?.info.bpm).toBe(140);
    expect(host.exchange.view.canStart).toBe(true);
  });

  it('a new tempo that arrives while the file is still loading is applied when it finishes', async () => {
    const pair = createLoopbackPair();
    const clock = new FakeClock(0);
    let finish: (t: LoadedTheme) => void = () => undefined;
    const tunables = createTunables();
    const make = (role: 'host' | 'guest') => {
      const transport = role === 'host' ? pair.host : pair.guest;
      const room = new Room({
        transport,
        clock,
        name: role,
        tunables: createTunables(),
        defer: () => undefined,
      });
      const exchange = new Exchange({
        transport,
        room,
        role,
        tunables,
        getPuppet: () =>
          Promise.resolve({ name: 'x', head: png('head'), sock: png('sock'), sword: png('sword') }),
        decodePart: () => Promise.resolve({} as never),
        fallbackPart: () => Promise.resolve({} as never),
        loadTheme: (info) =>
          role === 'guest' && info.id === 'march'
            ? new Promise<LoadedTheme>((resolve) => (finish = resolve))
            : Promise.resolve(loaded(info)),
        loadSong: () => Promise.reject(new Error('unused')),
      });
      return { exchange, room };
    };
    const host = make('host');
    const guest = make('guest');
    await settle();
    host.exchange.offerTheme(loaded(MARCH));
    host.exchange.offerTheme(loaded({ ...MARCH, bpm: 150, firstBeatOffset: 0.6 }));
    finish(loaded(MARCH)); // the load that began for the first values completes
    await settle();
    expect(guest.exchange.theme?.info.bpm).toBe(150);
    expect(guest.exchange.view.canReady).toBe(true);
    expect(host.exchange.view.canStart).toBe(true);
  });

  it('reloads a click track at a new tempo (its audio is made for the tempo)', async () => {
    const { host, guest } = rig();
    await settle();
    const click = (bpm: number): TrackInfo => ({
      id: 'click',
      source: 'click',
      title: 'Click track',
      bpm,
      firstBeatOffset: 0,
    });
    host.exchange.offerTheme(loaded(click(120)));
    await settle();
    host.exchange.offerTheme(loaded(click(150)));
    await settle();
    expect(guest.loads.at(-1)).toBe('click@150');
    expect(host.exchange.view.canStart).toBe(true);
  });
});

describe('titles from an offer', () => {
  it('are capped at 80 characters where the offer is accepted', async () => {
    const { host, guest } = rig();
    await settle();
    const long = { ...MARCH, title: 'M'.repeat(500) };
    host.exchange.offerTheme(loaded(long));
    await settle();
    expect(guest.exchange.view.theme.offer?.title).toBe('M'.repeat(MAX_THEME_TITLE));
    expect(guest.loads.at(-1)).toBe('march@100');
  });
});

describe('transfers that never finish', () => {
  const songMeta: BlobMeta = { kind: 'song', mime: 'audio/wav', bytes: 6 };

  it('are given up after a stall, so Start is not locked', async () => {
    const { host, guest, fireTimers } = rig();
    await settle();
    host.exchange.offerTheme(loaded(MARCH));
    await settle();
    expect(host.exchange.view.canStart).toBe(true);
    guest.reportProgress(0.3, songMeta);
    expect(guest.exchange.view.songFetch).toBe(0.3);
    expect(guest.exchange.busy).toBe(true);
    fireTimers(TRANSFER_STALL_MS);
    expect(guest.exchange.view.songFetch).toBeNull();
    expect(guest.exchange.busy).toBe(false);
  });

  it('are given up when the friend leaves', async () => {
    const { host, guest } = rig();
    await settle();
    guest.reportProgress(0.5, { kind: 'puppet-head', mime: 'image/png', bytes: 32 });
    guest.reportProgress(0.4, songMeta);
    expect(guest.exchange.busy).toBe(true);
    host.transport.close();
    expect(guest.exchange.busy).toBe(false);
    expect(guest.exchange.view.puppetFetch).toBeNull();
  });

  it('are cleared by a new offer', async () => {
    const { host, guest } = rig();
    await settle();
    host.exchange.offerTheme(loaded(MARCH));
    await settle();
    guest.reportProgress(0.4, songMeta);
    expect(guest.exchange.view.songFetch).toBe(0.4);
    host.exchange.offerTheme(loaded({ ...MARCH, id: 'gallop', title: 'Gallop' }));
    await settle();
    expect(guest.exchange.view.songFetch).toBeNull();
    expect(guest.exchange.busy).toBe(false);
  });

  it('keep the stall timer going while progress arrives', async () => {
    const { guest, fireTimers, timers } = rig();
    await settle();
    guest.reportProgress(0.1, songMeta);
    guest.reportProgress(0.2, songMeta);
    const live = timers.filter((t) => t.live && t.ms === TRANSFER_STALL_MS);
    expect(live).toHaveLength(1); // each report replaced the one before
    fireTimers(0);
    expect(guest.exchange.view.songFetch).toBeNull();
  });
});

describe('a song send that fails', () => {
  it('is sent again with the next offer', async () => {
    const { host, guest } = rig();
    await settle();
    host.control.failSongSends = 1;
    const data = new Uint8Array([1, 2, 3, 4, 5, 6]).buffer;
    host.exchange.offerTheme(loaded(song('h9'), { data, mime: 'audio/wav' }));
    await settle();
    expect(host.control.songSends).toBe(1);
    expect(guest.exchange.theme).toBeNull();
    expect(host.exchange.view.songSend).toBeNull();
    // Offered again: this time it goes through.
    host.exchange.offerTheme(loaded(song('h9'), { data, mime: 'audio/wav' }));
    await settle();
    expect(host.control.songSends).toBe(2);
    expect(guest.exchange.theme?.info.hash).toBe('h9');
    expect(host.exchange.view.canStart).toBe(true);
  });

  it('is sent again when the friend could not load it', async () => {
    const { host, guest } = rig();
    await settle();
    const data = new Uint8Array([1, 2, 3, 4, 5, 6]).buffer;
    host.exchange.offerTheme(loaded(song('h8'), { data, mime: 'audio/wav' }));
    await settle();
    expect(host.control.songSends).toBe(1);
    // The guest says it could not use it (for example a decoder hiccup).
    guest.transport.send({ t: 'themeReady', hash: themeGateKey(song('h8') as ThemeOffer), ok: false });
    await settle();
    host.exchange.offerTheme(loaded(song('h8', 120, 0.2), { data, mime: 'audio/wav' }));
    await settle();
    expect(host.control.songSends).toBe(2);
  });
});
