import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  createMemoryStore,
  openStore,
  SETTINGS,
  type Store,
  type StoredPuppet,
  type StoredSong,
} from '../../src/data/store';

function puppet(id: string, updatedAt: number): StoredPuppet {
  return {
    id,
    name: `Puppet ${id}`,
    head: new Blob(['head'], { type: 'image/png' }),
    sock: new Blob(['sock'], { type: 'image/png' }),
    sword: new Blob(['sword'], { type: 'image/png' }),
    createdAt: updatedAt - 10,
    updatedAt,
  };
}

function song(id: string, createdAt: number): StoredSong {
  const data = new Uint8Array([1, 2, 3, 4, 5]).buffer;
  return {
    id,
    title: `Song ${id}`,
    mime: 'audio/mpeg',
    bytes: data.byteLength,
    hash: 'abc',
    data,
    bpm: 120,
    firstBeatOffset: 0.25,
    durationSec: 30,
    createdAt,
  };
}

async function blobText(b: Blob): Promise<string> {
  return new Response(b).text();
}

function behaves(name: string, make: () => Promise<Store>, persistent: boolean): void {
  describe(name, () => {
    it('reports persistence', async () => {
      expect((await make()).persistent).toBe(persistent);
    });

    it('puts, gets, lists newest first and deletes puppets', async () => {
      const store = await make();
      await store.puppets.put(puppet('a', 100));
      await store.puppets.put(puppet('b', 300));
      await store.puppets.put(puppet('c', 200));
      expect((await store.puppets.list()).map((p) => p.id)).toEqual(['b', 'c', 'a']);

      const got = await store.puppets.get('a');
      expect(got?.name).toBe('Puppet a');
      expect(await blobText(got!.head)).toBe('head');
      expect(got?.sword.type).toBe('image/png');

      await store.puppets.put({ ...puppet('a', 500), name: 'Renamed' });
      expect((await store.puppets.list()).map((p) => p.id)).toEqual(['a', 'b', 'c']);
      expect((await store.puppets.get('a'))?.name).toBe('Renamed');

      await store.puppets.delete('b');
      expect(await store.puppets.get('b')).toBeUndefined();
      expect(await store.puppets.list()).toHaveLength(2);
    });

    it('puts, gets, lists and deletes songs with ArrayBuffers', async () => {
      const store = await make();
      await store.songs.put(song('x', 10));
      await store.songs.put(song('y', 20));
      expect((await store.songs.list()).map((s) => s.id)).toEqual(['y', 'x']);
      const got = await store.songs.get('x');
      expect([...new Uint8Array(got!.data)]).toEqual([1, 2, 3, 4, 5]);
      expect(got?.firstBeatOffset).toBe(0.25);
      await store.songs.delete('x');
      expect(await store.songs.get('x')).toBeUndefined();
    });

    it('reads settings with a fallback and writes them', async () => {
      const store = await make();
      expect(await store.settings.get(SETTINGS.displayName, 'Player')).toBe('Player');
      await store.settings.set(SETTINGS.displayName, 'Ada');
      await store.settings.set(SETTINGS.inputOffsetMs, 0);
      expect(await store.settings.get(SETTINGS.displayName, 'Player')).toBe('Ada');
      expect(await store.settings.get(SETTINGS.inputOffsetMs, 25)).toBe(0);
    });
  });
}

behaves('IndexedDB store', () => openStore(new IDBFactory()), true);
behaves('memory store', () => Promise.resolve(createMemoryStore()), false);

describe('openStore', () => {
  it('keeps data when reopened with the same factory', async () => {
    const factory = new IDBFactory();
    const first = await openStore(factory);
    await first.puppets.put(puppet('p', 50));
    await first.songs.put(song('s', 60));
    await first.settings.set(SETTINGS.musicVolume, 0.4);

    const second = await openStore(factory);
    expect(second.persistent).toBe(true);
    expect((await second.puppets.get('p'))?.name).toBe('Puppet p');
    expect((await second.songs.get('s'))?.title).toBe('Song s');
    expect(await second.settings.get(SETTINGS.musicVolume, 1)).toBe(0.4);
  });

  it('falls back to a working memory store when open throws', async () => {
    const broken = {
      open() {
        throw new Error('blocked');
      },
    } as unknown as IDBFactory;
    const store = await openStore(broken);
    expect(store.persistent).toBe(false);
    await store.puppets.put(puppet('m', 1));
    expect((await store.puppets.get('m'))?.id).toBe('m');
  });

  it('falls back when the open request errors', async () => {
    const failing = {
      open() {
        const req: { error: Error; onerror?: () => void } = { error: new Error('nope') };
        queueMicrotask(() => req.onerror?.());
        return req;
      },
    } as unknown as IDBFactory;
    const store = await openStore(failing);
    expect(store.persistent).toBe(false);
  });
});
