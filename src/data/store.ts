export interface StoredPuppet {
  id: string; // uuid
  name: string;
  head: Blob; // image/png 320x240
  sock: Blob; // image/png 160x120
  sword: Blob; // image/png 320x80
  createdAt: number; // epoch ms
  updatedAt: number;
  /** Set once synced to Supabase. */
  remoteId?: string;
}

export interface StoredSong {
  id: string;
  title: string;
  mime: string;
  bytes: number;
  hash: string; // sha-256 hex
  data: ArrayBuffer;
  bpm: number;
  firstBeatOffset: number; // seconds
  durationSec: number;
  createdAt: number;
}

export interface Table<T extends { id: string }> {
  list(): Promise<T[]>; // newest first (by updatedAt or createdAt)
  get(id: string): Promise<T | undefined>;
  put(value: T): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface Store {
  readonly persistent: boolean; // false when running on the in-memory fallback
  puppets: Table<StoredPuppet>;
  songs: Table<StoredSong>;
  settings: {
    get<T>(key: string, fallback: T): Promise<T>;
    set<T>(key: string, value: T): Promise<void>;
  };
}

/** Known settings keys, so callers do not scatter strings. */
export const SETTINGS = {
  displayName: 'displayName',
  inputOffsetMs: 'inputOffsetMs',
  selectedPuppetId: 'selectedPuppetId',
  selectedThemeId: 'selectedThemeId',
  musicVolume: 'musicVolume',
  sfxVolume: 'sfxVolume',
  /** The bot match set-up (difficulty, the bot's puppet); parsed with `parseBotSetup`. */
  botSetup: 'botSetup',
} as const;

const DB_NAME = 'toetotoe';
const DB_VERSION = 1;

interface Timestamped {
  id: string;
  updatedAt?: number;
  createdAt?: number;
}

function sortNewestFirst<T extends Timestamped>(items: T[]): T[] {
  const stamp = (x: T): number => x.updatedAt ?? x.createdAt ?? 0;
  return items.sort((a, b) => stamp(b) - stamp(a));
}

function memoryTable<T extends { id: string }>(): Table<T> {
  const map = new Map<string, T>();
  return {
    list: () => Promise.resolve(sortNewestFirst([...map.values()] as (T & Timestamped)[])),
    get: (id) => Promise.resolve(map.get(id)),
    put: (value) => {
      map.set(value.id, value);
      return Promise.resolve();
    },
    delete: (id) => {
      map.delete(id);
      return Promise.resolve();
    },
  };
}

function memorySettings(): Store['settings'] {
  const map = new Map<string, unknown>();
  return {
    get: <T>(key: string, fallback: T): Promise<T> =>
      Promise.resolve(map.has(key) ? (map.get(key) as T) : fallback),
    set: <T>(key: string, value: T): Promise<void> => {
      map.set(key, value);
      return Promise.resolve();
    },
  };
}

export function createMemoryStore(): Store {
  return {
    persistent: false,
    puppets: memoryTable<StoredPuppet>(),
    songs: memoryTable<StoredSong>(),
    settings: memorySettings(),
  };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function idbTable<T extends { id: string }>(db: IDBDatabase, name: string): Table<T> {
  return {
    async list() {
      const all = await request(
        db.transaction(name, 'readonly').objectStore(name).getAll() as IDBRequest<T[]>,
      );
      return sortNewestFirst(all as (T & Timestamped)[]);
    },
    async get(id) {
      return (await request(db.transaction(name, 'readonly').objectStore(name).get(id))) as T | undefined;
    },
    async put(value) {
      const tx = db.transaction(name, 'readwrite');
      tx.objectStore(name).put(value);
      await txDone(tx);
    },
    async delete(id) {
      const tx = db.transaction(name, 'readwrite');
      tx.objectStore(name).delete(id);
      await txDone(tx);
    },
  };
}

function idbSettings(db: IDBDatabase): Store['settings'] {
  return {
    async get<T>(key: string, fallback: T): Promise<T> {
      const store = db.transaction('settings', 'readonly').objectStore('settings');
      const count = await request(store.count(key));
      if (count === 0) return fallback;
      return (await request(store.get(key))) as T;
    },
    async set<T>(key: string, value: T): Promise<void> {
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put(value, key);
      await txDone(tx);
    },
  };
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('puppets')) db.createObjectStore('puppets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB open was blocked'));
  });
}

/** Never rejects: falls back to an in-memory store when IndexedDB is missing or fails to open. */
export async function openStore(factory?: IDBFactory): Promise<Store> {
  try {
    const f = factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
    if (!f) return createMemoryStore();
    const db = await openDb(f);
    return {
      persistent: true,
      puppets: idbTable<StoredPuppet>(db, 'puppets'),
      songs: idbTable<StoredSong>(db, 'songs'),
      settings: idbSettings(db),
    };
  } catch {
    return createMemoryStore();
  }
}
