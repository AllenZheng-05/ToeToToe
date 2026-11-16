import { describe, expect, it } from 'vitest';
import { createAccount } from '../../src/data/account';
import { supabaseConfigFromEnv, type Remote, type RemoteUser } from '../../src/data/remote';
import { createMemoryStore, SETTINGS } from '../../src/data/store';

const GUEST: RemoteUser = { id: 'u1', email: null, isGuest: true };
const MEMBER: RemoteUser = { id: 'u1', email: 'a@b.co', isGuest: false };

type Mode = 'ok' | 'throws' | 'never';

function fake(opts: { user?: RemoteUser | null; mode?: Mode } = {}) {
  const state = {
    user: opts.user ?? null,
    mode: opts.mode ?? 'ok',
    names: [] as string[],
    emails: [] as string[],
  };
  const gate = <T>(value: () => T): Promise<T> => {
    if (state.mode === 'throws') return Promise.reject(new Error('offline'));
    if (state.mode === 'never') return new Promise<T>(() => undefined);
    return Promise.resolve(value());
  };
  const remote: Remote = {
    currentUser: () => gate(() => state.user),
    signInGuest: () => gate(() => (state.user = GUEST)),
    attachEmail: (e) => gate(() => void state.emails.push(e)),
    signOut: () => gate(() => void (state.user = null)),
    getProfileName: () => gate(() => null),
    setProfileName: (n) => gate(() => void state.names.push(n)),
    listPuppets: () => gate(() => []),
    uploadPuppet: () => Promise.reject(new Error('unused')),
    downloadPuppet: () => Promise.reject(new Error('unused')),
    deletePuppet: () => gate(() => undefined),
  };
  return { remote, state };
}

/** A defer that never fires on its own: the test fires the oldest pending timer. */
function manualDefer() {
  const timers: { fn: () => void; ms: number }[] = [];
  return {
    defer: (fn: () => void, ms: number) => void timers.push({ fn, ms }),
    timers,
    fireAll: () => {
      for (const t of timers.splice(0)) t.fn();
    },
  };
}

describe('supabaseConfigFromEnv', () => {
  it('accepts a url and key', () => {
    expect(
      supabaseConfigFromEnv({
        VITE_SUPABASE_URL: 'https://abc.supabase.co/',
        VITE_SUPABASE_ANON_KEY: ' key ',
      }),
    ).toEqual({ url: 'https://abc.supabase.co', anonKey: 'key' });
  });
  it('accepts http only for localhost', () => {
    expect(
      supabaseConfigFromEnv({ VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_ANON_KEY: 'k' }),
    ).toEqual({
      url: 'http://localhost:54321',
      anonKey: 'k',
    });
    expect(
      supabaseConfigFromEnv({ VITE_SUPABASE_URL: 'http://abc.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' }),
    ).toBeNull();
  });
  it('is null when missing, empty or malformed', () => {
    expect(supabaseConfigFromEnv({})).toBeNull();
    expect(supabaseConfigFromEnv({ VITE_SUPABASE_URL: 'https://a.co' })).toBeNull();
    expect(supabaseConfigFromEnv({ VITE_SUPABASE_ANON_KEY: 'k' })).toBeNull();
    expect(supabaseConfigFromEnv({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' })).toBeNull();
    expect(supabaseConfigFromEnv({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_ANON_KEY: 'k' })).toBeNull();
    expect(
      supabaseConfigFromEnv({ VITE_SUPABASE_URL: 'https://a.co', VITE_SUPABASE_ANON_KEY: 'two words' }),
    ).toBeNull();
  });
});

describe('account without a remote', () => {
  it('stays off and every method resolves harmlessly', async () => {
    const account = createAccount({ remote: null, store: createMemoryStore() });
    expect(account.status).toBe('off');
    await account.init();
    expect(await account.saveAcrossDevices('Allen')).toBe(false);
    expect((await account.attachEmail('a@b.co')).ok).toBe(false);
    await account.signOut();
    expect(await account.sync()).toBeNull();
    expect(account.status).toBe('off');
    expect(account.user).toBeNull();
  });
});

describe('account init', () => {
  it('is signedOut without a persisted session', async () => {
    const account = createAccount({ remote: fake().remote, store: createMemoryStore() });
    await account.init();
    expect(account.status).toBe('signedOut');
    expect(account.user).toBeNull();
  });
  it('restores a guest or a member session', async () => {
    const g = createAccount({ remote: fake({ user: GUEST }).remote, store: createMemoryStore() });
    await g.init();
    expect(g.status).toBe('guest');
    const m = createAccount({ remote: fake({ user: MEMBER }).remote, store: createMemoryStore() });
    await m.init();
    expect(m.status).toBe('member');
    expect(m.user?.email).toBe('a@b.co');
  });
  it('becomes unreachable when the remote throws', async () => {
    const account = createAccount({ remote: fake({ mode: 'throws' }).remote, store: createMemoryStore() });
    await expect(account.init()).resolves.toBeUndefined();
    expect(account.status).toBe('unreachable');
  });
  it('becomes unreachable after the timeout when the remote never answers', async () => {
    const t = manualDefer();
    const account = createAccount({
      remote: fake({ mode: 'never' }).remote,
      store: createMemoryStore(),
      timeoutMs: 1234,
      defer: t.defer,
    });
    const p = account.init();
    expect(t.timers.map((x) => x.ms)).toEqual([1234]);
    expect(account.status).toBe('signedOut');
    t.fireAll();
    await expect(p).resolves.toBeUndefined();
    expect(account.status).toBe('unreachable');
  });
});

describe('saveAcrossDevices', () => {
  it('signs in as a guest and pushes the display name', async () => {
    const f = fake();
    const account = createAccount({ remote: f.remote, store: createMemoryStore() });
    await account.init();
    expect(await account.saveAcrossDevices('Allen')).toBe(true);
    expect(account.status).toBe('guest');
    expect(f.state.names).toEqual(['Allen']);
  });
  it('falls back to the stored display name', async () => {
    const f = fake();
    const store = createMemoryStore();
    await store.settings.set(SETTINGS.displayName, 'Stored');
    const account = createAccount({ remote: f.remote, store });
    await account.saveAcrossDevices('  ');
    expect(f.state.names).toEqual(['Stored']);
  });
  it('resolves false and goes unreachable on failure, without rejecting', async () => {
    const account = createAccount({ remote: fake({ mode: 'throws' }).remote, store: createMemoryStore() });
    expect(await account.saveAcrossDevices('Allen')).toBe(false);
    expect(account.status).toBe('unreachable');
  });
  it('resolves false after a timeout', async () => {
    const t = manualDefer();
    const account = createAccount({
      remote: fake({ mode: 'never' }).remote,
      store: createMemoryStore(),
      defer: t.defer,
    });
    const p = account.saveAcrossDevices('Allen');
    t.fireAll();
    expect(await p).toBe(false);
    expect(account.status).toBe('unreachable');
  });
});

describe('attachEmail', () => {
  it('rejects badly shaped addresses with a plain message', async () => {
    const f = fake({ user: GUEST });
    const account = createAccount({ remote: f.remote, store: createMemoryStore() });
    await account.init();
    for (const bad of ['', 'nope', 'a@b', 'a b@c.co', '@c.co']) {
      const r = await account.attachEmail(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message.length).toBeGreaterThan(5);
    }
    expect(f.state.emails).toEqual([]);
  });
  it('links a good address for a guest', async () => {
    const f = fake({ user: GUEST });
    const account = createAccount({ remote: f.remote, store: createMemoryStore() });
    await account.init();
    expect(await account.attachEmail(' me@example.com ')).toEqual({ ok: true });
    expect(f.state.emails).toEqual(['me@example.com']);
    expect(account.status).toBe('guest');
  });
  it('asks a signed-out player to save first', async () => {
    const account = createAccount({ remote: fake().remote, store: createMemoryStore() });
    await account.init();
    const r = await account.attachEmail('me@example.com');
    expect(r.ok).toBe(false);
  });
  it('turns a refusal into a plain message', async () => {
    const f = fake({ user: GUEST });
    f.remote.attachEmail = () => Promise.reject(new Error('422 email_exists'));
    const account = createAccount({ remote: f.remote, store: createMemoryStore() });
    await account.init();
    const r = await account.attachEmail('me@example.com');
    expect(r).toEqual({ ok: false, message: expect.not.stringContaining('422') as unknown as string });
    expect(account.status).toBe('guest');
  });
});

describe('signOut and sync', () => {
  it('signs out to signedOut', async () => {
    const account = createAccount({ remote: fake({ user: MEMBER }).remote, store: createMemoryStore() });
    await account.init();
    await account.signOut();
    expect(account.status).toBe('signedOut');
    expect(account.user).toBeNull();
  });
  it('sync is null when signed out and a summary when signed in', async () => {
    const account = createAccount({ remote: fake({ user: GUEST }).remote, store: createMemoryStore() });
    expect(await account.sync()).toBeNull();
    await account.init();
    expect(await account.sync()).toEqual({ uploaded: 0, downloaded: 0, deletedRemote: 0, failed: 0 });
    expect(account.status).toBe('guest');
  });
  it('sync marks unreachable when the service stops answering', async () => {
    const f = fake({ user: GUEST });
    const account = createAccount({ remote: f.remote, store: createMemoryStore() });
    await account.init();
    f.state.mode = 'throws';
    const s = await account.sync();
    expect(s?.failed).toBe(1);
    expect(account.status).toBe('unreachable');
  });
});

describe('onChange', () => {
  it('fires on status changes and stops after unsubscribe', async () => {
    const account = createAccount({ remote: fake({ user: GUEST }).remote, store: createMemoryStore() });
    let n = 0;
    const off = account.onChange(() => n++);
    await account.init();
    expect(n).toBe(1);
    await account.signOut();
    expect(n).toBe(2);
    off();
    await account.saveAcrossDevices('Allen');
    expect(n).toBe(2);
  });
});
