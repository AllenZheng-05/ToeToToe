import type { RawLink, Unsubscribe } from '../core/types';

type Wire =
  | { k: 'hello'; from: string; reply: boolean }
  | { k: 'bye'; from: string }
  | { k: 'data'; from: string; to: string | null; data: unknown }
  | { k: 'bin'; from: string; to: string; data: ArrayBuffer; meta: unknown };

function randomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * RawLink over BroadcastChannel named `toetotoe:<roomCode>`. Peers announce themselves on join, answer announcements,
 * and say goodbye on leave() and on `pagehide`. Binary is posted whole (progress goes straight to 1).
 * Callbacks registered after peers were seen are told about the peers already present.
 */
export function createBroadcastLink(roomCode: string): RawLink {
  const selfId = randomId();
  const channel = new BroadcastChannel(`toetotoe:${roomCode}`);
  const peers = new Set<string>();
  let left = false;

  const dataCbs = new Set<(from: string, data: unknown) => void>();
  const binaryCbs = new Set<(from: string, data: ArrayBuffer, meta: unknown) => void>();
  const progressCbs = new Set<(from: string, fraction: number, meta: unknown) => void>();
  const joinCbs = new Set<(peerId: string) => void>();
  const leaveCbs = new Set<(peerId: string) => void>();

  const post = (w: Wire): void => {
    if (!left) channel.postMessage(w);
  };

  const addPeer = (id: string): void => {
    if (peers.has(id)) return;
    peers.add(id);
    for (const cb of [...joinCbs]) cb(id);
  };

  channel.onmessage = (ev: MessageEvent<unknown>): void => {
    const w = ev.data as Partial<Wire> | null;
    if (typeof w !== 'object' || w === null || typeof w.from !== 'string' || w.from === selfId) return;
    const from = w.from;
    switch (w.k) {
      case 'hello':
        addPeer(from);
        if (!w.reply) post({ k: 'hello', from: selfId, reply: true });
        return;
      case 'bye':
        if (peers.delete(from)) for (const cb of [...leaveCbs]) cb(from);
        return;
      case 'data':
        if (w.to !== null && w.to !== selfId) return;
        addPeer(from);
        for (const cb of [...dataCbs]) cb(from, w.data);
        return;
      case 'bin':
        if (w.to !== selfId) return;
        addPeer(from);
        for (const cb of [...progressCbs]) cb(from, 1, w.meta);
        for (const cb of [...binaryCbs]) cb(from, w.data as ArrayBuffer, w.meta);
        return;
    }
  };

  const leave = (): void => {
    if (left) return;
    post({ k: 'bye', from: selfId });
    left = true;
    channel.close();
    if (typeof removeEventListener === 'function') removeEventListener('pagehide', leave);
  };
  if (typeof addEventListener === 'function') addEventListener('pagehide', leave);

  post({ k: 'hello', from: selfId, reply: false });

  const subscribe = <T>(set: Set<T>, cb: T): Unsubscribe => {
    set.add(cb);
    return () => set.delete(cb);
  };

  return {
    selfId,
    send(to, data) {
      post({ k: 'data', from: selfId, to, data });
    },
    sendBinary(to, data, meta, onProgress) {
      if (left) return Promise.reject(new Error('link left'));
      post({ k: 'bin', from: selfId, to, data, meta });
      onProgress?.(1);
      return Promise.resolve();
    },
    onData: (cb) => subscribe(dataCbs, cb),
    onBinary: (cb) => subscribe(binaryCbs, cb),
    onBinaryProgress: (cb) => subscribe(progressCbs, cb),
    onPeerJoin(cb) {
      const unsub = subscribe(joinCbs, cb);
      for (const id of [...peers]) cb(id);
      return unsub;
    },
    onPeerLeave: (cb) => subscribe(leaveCbs, cb),
    leave,
  };
}
