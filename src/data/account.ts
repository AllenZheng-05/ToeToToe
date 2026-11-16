import type { Unsubscribe } from '../core/types';
import { syncPuppets, type SyncSummary } from './puppetSync';
import type { Remote, RemoteUser } from './remote';
import { SETTINGS, type Store } from './store';

export type AccountStatus = 'off' | 'signedOut' | 'guest' | 'member' | 'unreachable';

export interface Account {
  readonly status: AccountStatus;
  readonly user: RemoteUser | null;
  /** Restores a session if there is one. Never rejects; sets 'unreachable' on failure. */
  init(): Promise<void>;
  /** Guest sign-in, then push the display name. Resolves false (status 'unreachable') on failure. */
  saveAcrossDevices(displayName: string): Promise<boolean>;
  attachEmail(email: string): Promise<{ ok: true } | { ok: false; message: string }>;
  signOut(): Promise<void>;
  /** Runs syncPuppets when signed in. Resolves a summary; never rejects. */
  sync(): Promise<SyncSummary | null>;
  onChange(cb: () => void): Unsubscribe;
}

export const DEFAULT_REMOTE_TIMEOUT_MS = 6000;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class TimeoutError extends Error {
  constructor() {
    super('The saving service did not answer in time');
  }
}

/**
 * `remote` is null when not configured (status stays 'off' and every method is a harmless no-op).
 * Every remote call is raced against `timeoutMs` (default 6000) using the injected `defer`.
 */
export function createAccount(deps: {
  remote: Remote | null;
  store: Store;
  timeoutMs?: number;
  defer?: (fn: () => void, ms: number) => void;
}): Account {
  const { remote, store } = deps;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS;
  const defer = deps.defer ?? ((fn: () => void, ms: number): void => void setTimeout(fn, ms));
  const listeners = new Set<() => void>();
  let status: AccountStatus = remote ? 'signedOut' : 'off';
  let user: RemoteUser | null = null;

  function set(nextStatus: AccountStatus, nextUser: RemoteUser | null): void {
    if (nextStatus === status && nextUser === user) return;
    status = nextStatus;
    user = nextUser;
    for (const cb of [...listeners]) cb();
  }

  const statusFor = (u: RemoteUser | null): AccountStatus =>
    u === null ? 'signedOut' : u.isGuest ? 'guest' : 'member';

  function race<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let done = false;
      defer(() => {
        if (done) return;
        done = true;
        reject(new TimeoutError());
      }, timeoutMs);
      p.then(
        (v) => {
          if (done) return;
          done = true;
          resolve(v);
        },
        (e: unknown) => {
          if (done) return;
          done = true;
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  }

  /** Marks the connection as lost when the service stops answering (not for ordinary refusals). */
  let lost = false;
  function timed(r: Remote): Remote {
    const wrap = <A extends unknown[], T>(fn: (...a: A) => Promise<T>, probe: boolean) => {
      return async (...a: A): Promise<T> => {
        try {
          return await race(fn(...a));
        } catch (e) {
          if (probe || e instanceof TimeoutError) lost = true;
          throw e;
        }
      };
    };
    return {
      currentUser: wrap(() => r.currentUser(), true),
      signInGuest: wrap(() => r.signInGuest(), true),
      attachEmail: wrap((e: string) => r.attachEmail(e), false),
      signOut: wrap(() => r.signOut(), false),
      getProfileName: wrap(() => r.getProfileName(), false),
      setProfileName: wrap((n: string) => r.setProfileName(n), true),
      listPuppets: wrap(() => r.listPuppets(), true),
      uploadPuppet: wrap((p: Parameters<Remote['uploadPuppet']>[0]) => r.uploadPuppet(p), false),
      downloadPuppet: wrap((id: string) => r.downloadPuppet(id), false),
      deletePuppet: wrap((id: string) => r.deletePuppet(id), false),
    };
  }
  const guarded = remote ? timed(remote) : null;

  async function init(): Promise<void> {
    if (!guarded) return;
    try {
      const u = await guarded.currentUser();
      set(statusFor(u), u);
    } catch {
      set('unreachable', null);
    }
  }

  async function saveAcrossDevices(displayName: string): Promise<boolean> {
    if (!guarded) return false;
    try {
      const u = (await guarded.currentUser()) ?? (await guarded.signInGuest());
      set(statusFor(u), u);
      const name = displayName.trim() || (await store.settings.get<string>(SETTINGS.displayName, '')).trim();
      if (name) await guarded.setProfileName(name);
      return true;
    } catch {
      set('unreachable', user);
      return false;
    }
  }

  async function attachEmail(email: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const address = email.trim();
    if (!EMAIL_SHAPE.test(address)) {
      return { ok: false, message: 'That does not look like an email address.' };
    }
    if (!guarded || status === 'off')
      return { ok: false, message: 'Saving across devices is not available.' };
    if (status !== 'guest') return { ok: false, message: 'Save across devices first.' };
    try {
      await guarded.attachEmail(address);
      return { ok: true };
    } catch (e) {
      if (e instanceof TimeoutError) {
        set('unreachable', user);
        return { ok: false, message: "Can't reach the saving service right now." };
      }
      return { ok: false, message: 'That email could not be added. Try a different one.' };
    }
  }

  async function signOut(): Promise<void> {
    if (!guarded) return;
    try {
      await guarded.signOut();
      set('signedOut', null);
    } catch {
      set('unreachable', user);
    }
  }

  async function sync(): Promise<SyncSummary | null> {
    if (!guarded || user === null) return null;
    lost = false;
    const summary = await syncPuppets(store, guarded);
    if (lost) set('unreachable', user);
    return summary;
  }

  return {
    get status() {
      return status;
    },
    get user() {
      return user;
    },
    init,
    saveAcrossDevices,
    attachEmail,
    signOut,
    sync,
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
