import { createAccountPanel } from '../src/account/panel';
import { createAccount } from '../src/data/account';
import type { Remote, RemotePuppetRow, RemoteUser } from '../src/data/remote';
import { createMemoryStore } from '../src/data/store';
import { fontsReady } from '../src/ui/kit/fonts';

/** ?state=off | signedOut | guest | member | unreachable | timeout */
const state = new URLSearchParams(location.search).get('state') ?? 'signedOut';

const GUEST: RemoteUser = { id: 'guest-1', email: null, isGuest: true };
const MEMBER: RemoteUser = { id: 'member-1', email: 'allen@example.com', isGuest: false };

/** In-memory Remote for looking at the panel. `mode` picks how it misbehaves. */
function fakeRemote(initial: RemoteUser | null, mode: 'ok' | 'throws' | 'never'): Remote {
  let user = initial;
  const rows = new Map<string, RemotePuppetRow>();
  const gate = async <T>(value: () => T): Promise<T> => {
    if (mode === 'throws') throw new Error('offline');
    if (mode === 'never') return new Promise<T>(() => undefined);
    await Promise.resolve();
    return value();
  };
  return {
    currentUser: () => gate(() => user),
    signInGuest: () => gate(() => (user = GUEST)),
    attachEmail: () => gate(() => undefined),
    signOut: () => gate(() => void (user = null)),
    getProfileName: () => gate(() => null),
    setProfileName: () => gate(() => undefined),
    listPuppets: () => gate(() => [...rows.values()]),
    uploadPuppet: (p) =>
      gate(() => {
        const row = { id: p.id ?? `r${rows.size + 1}`, name: p.name, updatedAt: Date.now() };
        rows.set(row.id, row);
        return row;
      }),
    downloadPuppet: () =>
      gate((): never => {
        throw new Error('not in the demo');
      }),
    deletePuppet: (id) => gate(() => void rows.delete(id)),
  };
}

async function main(): Promise<void> {
  const store = createMemoryStore();
  const png = (): Blob => new Blob(['x'], { type: 'image/png' });
  await store.puppets.put({
    id: 'p1',
    name: 'Sir Sockalot',
    head: png(),
    sock: png(),
    sword: png(),
    createdAt: 1,
    updatedAt: 1,
  });
  const remote =
    state === 'off'
      ? null
      : state === 'guest'
        ? fakeRemote(GUEST, 'ok')
        : state === 'member'
          ? fakeRemote(MEMBER, 'ok')
          : state === 'unreachable'
            ? fakeRemote(null, 'throws')
            : state === 'timeout'
              ? fakeRemote(null, 'never')
              : fakeRemote(null, 'ok');
  const account = createAccount({ remote, store, timeoutMs: 800 });
  const app = document.getElementById('app') as HTMLElement;
  const ui = createAccountPanel({ account, store, getDisplayName: () => 'Allen' });
  app.appendChild(ui.root);
  await account.init();
}

void main();
void fontsReady().then(() => {
  document.body.dataset.fonts = 'ready';
});
