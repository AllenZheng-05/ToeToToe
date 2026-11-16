import { describe, expect, it } from 'vitest';
import { DELETED_REMOTE_IDS, recordLocalDelete, syncPuppets } from '../../src/data/puppetSync';
import type { Remote, RemotePuppetRow } from '../../src/data/remote';
import { createMemoryStore, type StoredPuppet } from '../../src/data/store';
import { PARTS } from '../../src/puppet/parts';

function png(width: number, height: number): Blob {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new Blob([bytes], { type: 'image/png' });
}
const goodHead = (): Blob => png(PARTS.head.width, PARTS.head.height);
const goodSock = (): Blob => png(PARTS.sock.width, PARTS.sock.height);
const goodSword = (): Blob => png(PARTS.sword.width, PARTS.sword.height);

interface Held {
  row: RemotePuppetRow;
  head: Blob;
  sock: Blob;
  sword: Blob;
}

class FakeRemote implements Remote {
  held = new Map<string, Held>();
  clock = 1000;
  nextId = 1;
  failUploadNames = new Set<string>();
  failList = false;
  calls = { upload: 0, download: 0, delete: 0 };

  currentUser = () => Promise.resolve(null);
  signInGuest = () => Promise.reject(new Error('unused'));
  attachEmail = () => Promise.resolve();
  signOut = () => Promise.resolve();
  getProfileName = () => Promise.resolve(null);
  setProfileName = () => Promise.resolve();

  put(id: string, name: string, at: number, blobs?: Partial<Held>): void {
    this.held.set(id, {
      row: { id, name, updatedAt: at },
      head: goodHead(),
      sock: goodSock(),
      sword: goodSword(),
      ...blobs,
    });
  }
  listPuppets(): Promise<RemotePuppetRow[]> {
    if (this.failList) return Promise.reject(new Error('offline'));
    return Promise.resolve([...this.held.values()].map((h) => h.row));
  }
  uploadPuppet(p: Parameters<Remote['uploadPuppet']>[0]): Promise<RemotePuppetRow> {
    this.calls.upload++;
    if (this.failUploadNames.has(p.name)) return Promise.reject(new Error('refused'));
    const id = p.id ?? `r${this.nextId++}`;
    const row = { id, name: p.name, updatedAt: ++this.clock };
    this.held.set(id, { row, head: p.head, sock: p.sock, sword: p.sword });
    return Promise.resolve(row);
  }
  downloadPuppet(id: string): Promise<Held> {
    this.calls.download++;
    const h = this.held.get(id);
    return h ? Promise.resolve(h) : Promise.reject(new Error('missing'));
  }
  deletePuppet(id: string): Promise<void> {
    this.calls.delete++;
    this.held.delete(id);
    return Promise.resolve();
  }
}

function local(id: string, updatedAt: number, extra: Partial<StoredPuppet> = {}): StoredPuppet {
  return {
    id,
    name: `Puppet ${id}`,
    head: goodHead(),
    sock: goodSock(),
    sword: goodSword(),
    createdAt: updatedAt,
    updatedAt,
    ...extra,
  };
}

describe('syncPuppets', () => {
  it('uploads local puppets with no remoteId and saves the remoteId', async () => {
    const store = createMemoryStore();
    const remote = new FakeRemote();
    await store.puppets.put(local('a', 10));
    const sum = await syncPuppets(store, remote);
    expect(sum).toEqual({ uploaded: 1, downloaded: 0, deletedRemote: 0, failed: 0 });
    const a = await store.puppets.get('a');
    expect(a?.remoteId).toBe('r1');
    expect(remote.held.has('r1')).toBe(true);
  });

  it('re-uploads a local puppet that is newer than its remote row', async () => {
    const store = createMemoryStore();
    const remote = new FakeRemote();
    remote.put('r9', 'Old name', 100);
    await store.puppets.put(local('a', 500, { remoteId: 'r9', name: 'New name' }));
    const sum = await syncPuppets(store, remote);
    expect(sum.uploaded).toBe(1);
    expect(remote.held.get('r9')?.row.name).toBe('New name');
    expect((await store.puppets.list()).length).toBe(1);
  });

  it('replaces an older local puppet with the remote copy', async () => {
    const store = createMemoryStore();
    const remote = new FakeRemote();
    remote.put('r9', 'From elsewhere', 900);
    await store.puppets.put(local('a', 500, { remoteId: 'r9', name: 'Stale' }));
    const sum = await syncPuppets(store, remote);
    expect(sum).toEqual({ uploaded: 0, downloaded: 1, deletedRemote: 0, failed: 0 });
    const list = await store.puppets.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'a', name: 'From elsewhere', updatedAt: 900, remoteId: 'r9' });
  });

  it('downloads remote puppets unknown locally', async () => {
    const store = createMemoryStore();
    const remote = new FakeRemote();
    remote.put('r1', 'Far away', 300);
    const sum = await syncPuppets(store, remote);
    expect(sum.downloaded).toBe(1);
    const list = await store.puppets.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Far away', remoteId: 'r1', updatedAt: 300 });
  });

  it('skips and counts remote drawings that fail validation', async () => {
    const store = createMemoryStore();
    const remote = new FakeRemote();
    remote.put('bad', 'Bad', 300, {
      head: new Blob(['not a png at all, just text bytes here'], { type: 'image/png' }),
    });
    remote.put('wrong', 'Wrong size', 300, { sock: png(10, 10) });
    remote.put('ok', 'Fine', 300);
    const sum = await syncPuppets(store, remote);
    expect(sum).toEqual({ uploaded: 0, downloaded: 1, deletedRemote: 0, failed: 2 });
    expect((await store.puppets.list()).map((p) => p.remoteId)).toEqual(['ok']);
  });

  it('deletes remote ids the player deleted locally, and clears the list', async () => {
    const store = createMemoryStore();
    const remote = new FakeRemote();
    remote.put('r1', 'Gone', 300);
    remote.put('r2', 'Stays', 300);
    await recordLocalDelete(store, { remoteId: 'r1' });
    await store.puppets.put(local('b', 300, { remoteId: 'r2' }));
    const sum = await syncPuppets(store, remote);
    expect(sum).toEqual({ uploaded: 0, downloaded: 0, deletedRemote: 1, failed: 0 });
    expect(remote.held.has('r1')).toBe(false);
    expect(await store.settings.get(DELETED_REMOTE_IDS, ['x'])).toEqual([]);
    // Not downloaded again.
    expect(await store.puppets.get('r1')).toBeUndefined();
  });

  it('does not download a remote puppet whose deletion failed, and keeps it listed', async () => {
    const store = createMemoryStore();
    const remote = new FakeRemote();
    remote.put('r1', 'Stubborn', 300);
    remote.deletePuppet = () => Promise.reject(new Error('refused'));
    await recordLocalDelete(store, { remoteId: 'r1' });
    const sum = await syncPuppets(store, remote);
    expect(sum).toEqual({ uploaded: 0, downloaded: 0, deletedRemote: 0, failed: 1 });
    expect(await store.puppets.list()).toHaveLength(0);
    expect(await store.settings.get(DELETED_REMOTE_IDS, [])).toEqual(['r1']);
  });

  it('keeps a local puppet whose remote copy vanished and uploads it again', async () => {
    const store = createMemoryStore();
    const remote = new FakeRemote();
    await store.puppets.put(local('a', 500, { remoteId: 'vanished' }));
    const sum = await syncPuppets(store, remote);
    expect(sum.uploaded).toBe(1);
    const a = await store.puppets.get('a');
    expect(a?.remoteId).toBe('r1');
    expect(a?.name).toBe('Puppet a');
  });

  it('keeps going when one upload fails, and counts it', async () => {
    const store = createMemoryStore();
    const remote = new FakeRemote();
    remote.failUploadNames.add('Puppet b');
    await store.puppets.put(local('a', 30));
    await store.puppets.put(local('b', 20));
    await store.puppets.put(local('c', 10));
    const sum = await syncPuppets(store, remote);
    expect(sum).toEqual({ uploaded: 2, downloaded: 0, deletedRemote: 0, failed: 1 });
    expect((await store.puppets.get('b'))?.remoteId).toBeUndefined();
    expect((await store.puppets.get('c'))?.remoteId).toBeDefined();
  });

  it('never rejects when the remote cannot be listed', async () => {
    const store = createMemoryStore();
    const remote = new FakeRemote();
    remote.failList = true;
    await store.puppets.put(local('a', 1));
    await expect(syncPuppets(store, remote)).resolves.toEqual({
      uploaded: 0,
      downloaded: 0,
      deletedRemote: 0,
      failed: 1,
    });
  });

  it('is idempotent: a second sync does nothing', async () => {
    const store = createMemoryStore();
    const remote = new FakeRemote();
    remote.put('r7', 'Remote one', 400);
    await store.puppets.put(local('a', 10));
    await store.puppets.put(local('b', 500, { remoteId: 'r7', name: 'Newer local' }));
    const first = await syncPuppets(store, remote);
    expect(first.failed).toBe(0);
    const before = { ...remote.calls };
    const second = await syncPuppets(store, remote);
    expect(second).toEqual({ uploaded: 0, downloaded: 0, deletedRemote: 0, failed: 0 });
    expect(remote.calls).toEqual(before);
  });
});

describe('recordLocalDelete', () => {
  it('records remote ids once and ignores puppets that were never synced', async () => {
    const store = createMemoryStore();
    await recordLocalDelete(store, {});
    await recordLocalDelete(store, { remoteId: 'r1' });
    await recordLocalDelete(store, { remoteId: 'r1' });
    await recordLocalDelete(store, { remoteId: 'r2' });
    expect(await store.settings.get(DELETED_REMOTE_IDS, [])).toEqual(['r1', 'r2']);
  });
});
