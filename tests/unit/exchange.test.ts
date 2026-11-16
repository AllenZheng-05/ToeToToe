import { describe, expect, it } from 'vitest';
import { createTunables } from '../../src/core/tunables';
import type { BlobMeta, ThemeOffer } from '../../src/core/types';
import { createLoopbackPair } from '../../src/net/loopback';
import { Room } from '../../src/net/room';
import { PARTS, type PartKind } from '../../src/puppet/parts';
import {
  DrawingCollector,
  Exchange,
  MSG_FRIEND_COULD_NOT_LOAD,
  ThemeGate,
  themeKey,
  type ExchangeDeps,
  type OutgoingPuppet,
} from '../../src/scenes/exchange';
import { ThemeError, type LoadedTheme } from '../../src/theme/theme';
import type { TrackInfo } from '../../src/data/tracks';
import { FakeClock } from '../helpers/fakeClock';

/** The first 24 bytes of a PNG with the part's size: all the check reads. */
function png(kind: PartKind, tag = 0): ArrayBuffer {
  const { width, height } = PARTS[kind];
  const buf = new ArrayBuffer(32);
  const v = new DataView(buf);
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((b, i) => v.setUint8(i, b));
  v.setUint32(8, 13);
  v.setUint32(12, 0x49484452);
  v.setUint32(16, width);
  v.setUint32(20, height);
  v.setUint8(31, tag);
  return buf;
}

const metaOf = (kind: PartKind, name?: string): Pick<BlobMeta, 'kind' | 'name'> => ({
  kind: `puppet-${kind}` as BlobMeta['kind'],
  name,
});

describe('DrawingCollector', () => {
  it('completes when all three parts have been seen', () => {
    const c = new DrawingCollector();
    expect(c.accept(metaOf('head', 'Sir Sock'), png('head'))).toBe('accepted');
    expect(c.complete).toBe(false);
    expect(c.accept(metaOf('sock'), png('sock'))).toBe('accepted');
    expect(c.result()).toBeNull();
    expect(c.accept(metaOf('sword'), png('sword'))).toBe('accepted');
    const r = c.result();
    expect(r?.name).toBe('Sir Sock');
    expect(r?.parts.sword).not.toBeNull();
  });

  it('rejects a part with the wrong size or type and still completes with a null part', () => {
    const c = new DrawingCollector();
    c.accept(metaOf('head', 'X'), png('head'));
    expect(c.accept(metaOf('sock'), png('sword'))).toBe('rejected'); // wrong dimensions
    expect(c.accept(metaOf('sword'), new ArrayBuffer(100))).toBe('rejected'); // not a PNG
    const r = c.result();
    expect(r?.parts.head).not.toBeNull();
    expect(r?.parts.sock).toBeNull();
    expect(r?.parts.sword).toBeNull();
  });

  it('ignores blobs that are not puppet parts', () => {
    const c = new DrawingCollector();
    expect(c.accept({ kind: 'song' }, new ArrayBuffer(8))).toBe('ignored');
    expect(c.complete).toBe(false);
  });

  it('starts a new set at every head and cleans the name', () => {
    const c = new DrawingCollector();
    c.accept(metaOf('head', 'One'), png('head'));
    c.accept(metaOf('sock'), png('sock'));
    c.accept(metaOf('sword'), png('sword'));
    c.accept(metaOf('head', `  ${'n'.repeat(80)}  `), png('head', 2));
    expect(c.complete).toBe(false);
    c.accept(metaOf('sock'), png('sock'));
    c.accept(metaOf('sword'), png('sword'));
    expect(c.result()?.name).toBe('n'.repeat(32));
    c.accept({ kind: 'puppet-head', name: undefined }, png('head'));
    expect(c.complete).toBe(false);
  });
});

describe('ThemeGate', () => {
  const house = { source: 'house' as const, id: 'march', hash: undefined };
  const song = { source: 'upload' as const, id: 'a', hash: 'abc' };

  it('keys songs by hash and the rest by source and id', () => {
    expect(themeKey(song)).toBe('abc');
    expect(themeKey(house)).toBe('house:march');
  });

  it('the guest cannot be ready until the theme is loaded, and a new offer resets that', () => {
    const g = new ThemeGate('guest');
    expect(g.canReady).toBe(false);
    expect(g.offer(house)).toBe(true);
    expect(g.canReady).toBe(false);
    expect(g.loaded('house:march', true)).toBe(true);
    expect(g.canReady).toBe(true);
    expect(g.offer(house)).toBe(false); // the same offer again changes nothing
    expect(g.canReady).toBe(true);
    expect(g.offer(song)).toBe(true);
    expect(g.canReady).toBe(false);
  });

  it('drops a load answer for a theme that is no longer current', () => {
    const g = new ThemeGate('guest');
    g.offer(house);
    g.offer(song);
    expect(g.loaded('house:march', true)).toBe(false);
    expect(g.canReady).toBe(false);
    expect(g.loaded('abc', false)).toBe(true);
    expect(g.localStatus).toBe('failed');
    expect(g.canReady).toBe(false);
  });

  it('the host may start only after the guest reported the current theme loaded', () => {
    const g = new ThemeGate('host');
    expect(g.canReady).toBe(true);
    g.offer(house);
    expect(g.canStart).toBe(false);
    expect(g.peerReport('house:march', true)).toBe(true);
    expect(g.canStart).toBe(true);
    g.offer(song);
    expect(g.canStart).toBe(false);
    expect(g.peerReport('house:march', true)).toBe(false); // stale
    expect(g.canStart).toBe(false);
    expect(g.peerReport('abc', false)).toBe(true);
    expect(g.peerStatus).toBe('failed');
    expect(g.canStart).toBe(false);
    expect(g.peerReport(null, true)).toBe(false);
  });
});

// ---------------------------------------------------------------- over the loopback

function loaded(info: TrackInfo, file?: LoadedTheme['file']): LoadedTheme {
  return { info, buffer: {} as AudioBuffer, loopStart: 0, loopEnd: 1, file: file ?? null };
}

const MARCH: TrackInfo = {
  id: 'march',
  source: 'house',
  title: 'March',
  bpm: 100,
  firstBeatOffset: 0,
};

function songInfo(hash: string): TrackInfo {
  return { id: 'song-1', source: 'upload', title: 'My song', bpm: 110, firstBeatOffset: 0.1, hash, bytes: 6 };
}

function rig(opts: { guestFailsSong?: boolean; badPuppet?: boolean } = {}) {
  const pair = createLoopbackPair();
  const clock = new FakeClock(0);
  const mk = (role: 'host' | 'guest', name: string) => {
    const transport = role === 'host' ? pair.host : pair.guest;
    const tunables = createTunables();
    const room = new Room({ transport, clock, name, tunables, defer: () => undefined });
    const puppet: OutgoingPuppet = {
      name: `${name}'s puppet`,
      head: png('head', role === 'host' ? 1 : 2),
      sock: opts.badPuppet && role === 'guest' ? new ArrayBuffer(40) : png('sock'),
      sword: png('sword'),
    };
    const loads: string[] = [];
    const deps: ExchangeDeps = {
      transport,
      room,
      role,
      tunables,
      getPuppet: () => Promise.resolve(puppet),
      decodePart: (data, kind) => Promise.resolve({ decoded: kind, tag: new Uint8Array(data)[31] } as never),
      fallbackPart: (kind) => Promise.resolve({ fallback: kind } as never),
      loadTheme: (info) => {
        loads.push(info.id);
        return Promise.resolve(loaded(info));
      },
      loadSong: (offer) => {
        loads.push(offer.id);
        if (opts.guestFailsSong)
          return Promise.reject(new ThemeError('That file is not a song we can play.'));
        return Promise.resolve(loaded(songInfoFromOffer(offer)));
      },
    };
    const exchange = new Exchange(deps);
    return { room, exchange, transport, loads };
  };
  const host = mk('host', 'Ada');
  const guest = mk('guest', 'Bo');
  return { host, guest };
}

function songInfoFromOffer(o: ThemeOffer): TrackInfo {
  return {
    id: o.id,
    source: 'upload',
    title: o.title,
    bpm: o.bpm,
    firstBeatOffset: o.firstBeatOffset,
    hash: o.hash,
  };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

describe('Exchange over a loopback', () => {
  it('sends each side its friend puppet and names it', async () => {
    const { host, guest } = rig();
    await settle();
    expect(host.exchange.view.peerPuppet?.name).toBe("Bo's puppet");
    expect(guest.exchange.view.peerPuppet?.name).toBe("Ada's puppet");
    const images = host.exchange.view.peerPuppet?.images as unknown as Record<string, { tag?: number }>;
    expect(images.head?.tag).toBe(2);
    expect(host.exchange.busy).toBe(false);
  });

  it('replaces a rejected part with a preset part', async () => {
    const { host } = rig({ badPuppet: true });
    await settle();
    const images = host.exchange.view.peerPuppet?.images as unknown as Record<
      string,
      Record<string, unknown>
    >;
    expect(images.sock).toEqual({ fallback: 'sock' });
    expect(images.head).toMatchObject({ decoded: 'head' });
  });

  it('shows a new puppet when the friend sends again', async () => {
    const { host, guest } = rig();
    await settle();
    const before = host.exchange.view.peerPuppet?.version ?? 0;
    guest.exchange.sendPuppet();
    await settle();
    expect(host.exchange.view.peerPuppet?.version).toBeGreaterThan(before);
  });

  it('gates the guest on a house track and the host on the answer', async () => {
    const { host, guest } = rig();
    await settle();
    guest.loads.length = 0; // the host's default click track was loaded first
    host.exchange.offerTheme(loaded(MARCH));
    await settle();
    expect(guest.loads).toEqual(['march']);
    expect(guest.exchange.view.canReady).toBe(true);
    expect(guest.exchange.view.theme.status).toBe('ready');
    expect(host.exchange.view.canStart).toBe(true);
  });

  it('sends an upload as a blob, checks it and answers', async () => {
    const { host, guest } = rig();
    await settle();
    guest.loads.length = 0; // the host's default click track was loaded first
    const data = new Uint8Array([1, 2, 3, 4, 5, 6]).buffer;
    host.exchange.offerTheme(loaded(songInfo('h1'), { data, mime: 'audio/wav' }));
    await settle();
    expect(guest.loads).toEqual(['song-1']);
    expect(guest.exchange.theme?.info.hash).toBe('h1');
    expect(guest.exchange.view.canReady).toBe(true);
    expect(host.exchange.view.canStart).toBe(true);
  });

  it('tells the host when the guest cannot load the song', async () => {
    const { host, guest } = rig({ guestFailsSong: true });
    await settle();
    host.exchange.offerTheme(loaded(songInfo('h2'), { data: new ArrayBuffer(6), mime: 'audio/wav' }));
    await settle();
    expect(guest.exchange.view.theme.status).toBe('failed');
    expect(guest.exchange.view.theme.message).toBe('That file is not a song we can play.');
    expect(guest.exchange.view.canReady).toBe(false);
    expect(host.exchange.view.canStart).toBe(false);
    expect(host.exchange.view.theme.message).toBe(MSG_FRIEND_COULD_NOT_LOAD);
    // The host picks another theme and the guest follows.
    host.exchange.offerTheme(loaded(MARCH));
    await settle();
    expect(host.exchange.view.canStart).toBe(true);
    expect(host.exchange.view.theme.message).toBeNull();
    expect(guest.exchange.view.canReady).toBe(true);
  });

  it('resets the guest ready flag when the host changes theme', async () => {
    const { host, guest } = rig();
    await settle();
    host.exchange.offerTheme(loaded(MARCH));
    await settle();
    guest.room.setReady(true);
    expect(guest.room.localReady).toBe(true);
    host.exchange.offerTheme(loaded({ ...MARCH, id: 'gallop', title: 'Gallop', bpm: 152 }));
    await settle();
    expect(guest.room.localReady).toBe(false);
    expect(host.room.peerReady).toBe(false);
  });

  it('ignores a song blob that arrives before the theme and one that does not match', async () => {
    const { host, guest } = rig();
    await settle();
    guest.loads.length = 0; // the host's default click track was loaded first
    // A blob with no offer yet is kept, not loaded.
    await host.transport.sendBlob(new ArrayBuffer(4), {
      kind: 'song',
      mime: 'audio/wav',
      bytes: 4,
      hash: 'zzz',
    });
    await settle();
    expect(guest.loads).toEqual([]);
    host.exchange.offerTheme(loaded(songInfo('h3'), { data: new ArrayBuffer(6), mime: 'audio/wav' }));
    await settle();
    expect(guest.loads).toEqual(['song-1']); // the matching file, not the stray one
    expect(guest.exchange.theme?.info.hash).toBe('h3');
  });
});
