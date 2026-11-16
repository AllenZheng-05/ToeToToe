import { PARTS, type PartKind } from '../puppet/parts';
import { checkDrawingBytes } from '../puppet/validate';
import type { Remote, RemotePuppetRow } from './remote';
import type { Store, StoredPuppet } from './store';

export interface SyncSummary {
  uploaded: number;
  downloaded: number;
  deletedRemote: number;
  failed: number;
}

/** Settings key: remote puppet ids the player deleted locally, to be deleted remotely on the next sync. */
export const DELETED_REMOTE_IDS = 'deletedRemoteIds';

async function readDeleted(store: Store): Promise<string[]> {
  const v = await store.settings.get<unknown>(DELETED_REMOTE_IDS, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Call when the player deletes a saved puppet locally, so the next sync removes the remote copy. */
export async function recordLocalDelete(store: Store, puppet: { remoteId?: string }): Promise<void> {
  if (!puppet.remoteId) return;
  const list = await readDeleted(store);
  if (list.includes(puppet.remoteId)) return;
  await store.settings.set(DELETED_REMOTE_IDS, [...list, puppet.remoteId]);
}

async function upload(
  store: Store,
  remote: Remote,
  p: StoredPuppet,
  remoteId: string | undefined,
): Promise<void> {
  const row = await remote.uploadPuppet({
    id: remoteId,
    name: p.name,
    head: p.head,
    sock: p.sock,
    sword: p.sword,
    updatedAt: p.updatedAt,
  });
  // Adopt the server's timestamp so the next sync sees both sides as equal.
  await store.puppets.put({ ...p, remoteId: row.id, updatedAt: row.updatedAt });
}

/** Returns false when a drawing fails validation (nothing is stored). */
async function download(
  store: Store,
  remote: Remote,
  row: RemotePuppetRow,
  local?: StoredPuppet,
): Promise<boolean> {
  const got = await remote.downloadPuppet(row.id);
  const parts: Record<PartKind, Blob> = { head: got.head, sock: got.sock, sword: got.sword };
  for (const kind of Object.keys(PARTS) as PartKind[]) {
    if (!checkDrawingBytes(await parts[kind].arrayBuffer(), kind).ok) return false;
  }
  const updatedAt = got.row.updatedAt;
  await store.puppets.put({
    id: local?.id ?? crypto.randomUUID(),
    name: got.row.name,
    head: got.head,
    sock: got.sock,
    sword: got.sword,
    createdAt: local?.createdAt ?? updatedAt,
    updatedAt,
    remoteId: got.row.id,
  });
  return true;
}

/**
 * Two-way sync between the local Store and the Remote (last write wins). One failing puppet does
 * not stop the rest. Never rejects.
 */
export async function syncPuppets(store: Store, remote: Remote): Promise<SyncSummary> {
  const sum: SyncSummary = { uploaded: 0, downloaded: 0, deletedRemote: 0, failed: 0 };
  try {
    const rows = await remote.listPuppets();
    const byId = new Map(rows.map((r) => [r.id, r]));

    // 1. Remote deletions the player asked for.
    const deleted = await readDeleted(store);
    const stillDeleted: string[] = [];
    for (const id of deleted) {
      if (!byId.has(id)) continue; // already gone
      try {
        await remote.deletePuppet(id);
        sum.deletedRemote++;
      } catch {
        sum.failed++;
        stillDeleted.push(id);
      }
    }
    if (deleted.length > 0 && stillDeleted.length !== deleted.length) {
      await store.settings.set(DELETED_REMOTE_IDS, stillDeleted);
    }
    const doomed = new Set(deleted);

    // 2. Local puppets.
    const locals = await store.puppets.list();
    const seen = new Set<string>();
    for (const p of locals) {
      try {
        const rid = p.remoteId;
        const row = rid ? byId.get(rid) : undefined;
        if (rid) seen.add(rid);
        if (!rid || !row) {
          // New, or its remote copy is gone: upload as a new remote puppet.
          await upload(store, remote, p, undefined);
          sum.uploaded++;
        } else if (p.updatedAt > row.updatedAt) {
          await upload(store, remote, p, rid);
          sum.uploaded++;
        } else if (p.updatedAt < row.updatedAt) {
          if (await download(store, remote, row, p)) sum.downloaded++;
          else sum.failed++;
        }
      } catch {
        sum.failed++;
      }
    }

    // 3. Remote puppets unknown locally.
    for (const row of rows) {
      if (seen.has(row.id) || doomed.has(row.id)) continue;
      try {
        if (await download(store, remote, row)) sum.downloaded++;
        else sum.failed++;
      } catch {
        sum.failed++;
      }
    }
  } catch {
    sum.failed++;
  }
  return sum;
}
