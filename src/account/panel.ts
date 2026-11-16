import type { Account } from '../data/account';
import type { SyncSummary } from '../data/puppetSync';
import type { Store } from '../data/store';
import { button, panel, textInput, tornNote } from '../ui/kit/kit';
import './panel.css';

export interface AccountPanel {
  root: HTMLElement;
  destroy(): void;
}

/** "2 sent, 1 fetched" in words. */
export function summaryText(s: SyncSummary): string {
  const parts: string[] = [];
  if (s.uploaded) parts.push(`${s.uploaded} sent`);
  if (s.downloaded) parts.push(`${s.downloaded} fetched`);
  if (s.deletedRemote) parts.push(`${s.deletedRemote} removed`);
  if (s.failed) parts.push(`${s.failed} could not be saved`);
  return parts.length ? parts.join(', ') : 'Everything is up to date';
}

const LOCAL_NOTE = 'Drawings are saved in this browser.';

export function createAccountPanel(o: {
  account: Account;
  store: Store;
  getDisplayName: () => string;
}): AccountPanel {
  const { account } = o;
  const root = panel({ title: 'Saving', rotate: -0.5 });
  root.classList.add('tt-account');
  root.dataset.testid = 'account-panel';
  const body = document.createElement('div');
  body.className = 'tt-account-body';
  root.appendChild(body);

  let busy = false;
  let lastSummary: string | null = null;
  let emailMessage: string | null = null;
  let emailValue = '';

  const email = textInput({
    label: 'Email',
    placeholder: 'you@example.com',
    maxLength: 120,
    testId: 'account-email',
    onInput: (v) => {
      emailValue = v;
    },
  });
  email.input.type = 'email';
  email.input.autocomplete = 'email';

  function note(text: string, testId?: string): HTMLElement {
    const n = tornNote(text, { rotate: -0.5 });
    n.classList.add('tt-account-note');
    if (testId) n.dataset.testid = testId;
    return n;
  }

  async function run(task: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    render();
    try {
      await task();
    } finally {
      busy = false;
      render();
    }
  }

  const doSync = async (): Promise<void> => {
    const s = await account.sync();
    if (s) lastSummary = summaryText(s);
  };

  function btn(label: string, testId: string, onClick: () => void, variant: 'primary' | 'small' = 'small') {
    return button(label, { variant, testId, disabled: busy, onClick });
  }

  function render(): void {
    const kids: HTMLElement[] = [];
    switch (account.status) {
      case 'off':
        kids.push(note(LOCAL_NOTE, 'account-note'));
        break;
      case 'signedOut':
        kids.push(
          note(LOCAL_NOTE, 'account-note'),
          btn('Save across devices', 'account-save', () => {
            void run(async () => {
              if (await account.saveAcrossDevices(o.getDisplayName())) await doSync();
            });
          }),
        );
        break;
      case 'guest': {
        kids.push(note('Saving across devices as a guest.', 'account-note'));
        const row = document.createElement('div');
        row.className = 'tt-account-row';
        row.append(
          email.root,
          btn('Add an email', 'account-attach', () => {
            void run(async () => {
              const r = await account.attachEmail(emailValue);
              emailMessage = r.ok ? 'Check your inbox to confirm.' : r.message;
              if (r.ok) {
                emailValue = '';
                email.input.value = '';
              }
            });
          }),
        );
        kids.push(row);
        const privacy = document.createElement('p');
        privacy.className = 'tt-account-fine';
        privacy.textContent = 'Only your display name and drawings are stored.';
        kids.push(privacy);
        if (emailMessage) {
          const m = document.createElement('p');
          m.className = 'tt-account-msg';
          m.dataset.testid = 'account-email-message';
          m.setAttribute('role', 'status');
          m.textContent = emailMessage;
          kids.push(m);
        }
        kids.push(btn('Sync now', 'account-sync', () => void run(doSync)));
        if (lastSummary) kids.push(summaryLine(lastSummary));
        break;
      }
      case 'member': {
        const who = document.createElement('p');
        who.className = 'tt-account-who';
        who.dataset.testid = 'account-email-shown';
        who.textContent = account.user?.email ?? 'Signed in';
        const row = document.createElement('div');
        row.className = 'tt-account-row';
        row.append(
          btn('Sync now', 'account-sync', () => void run(doSync)),
          btn('Sign out', 'account-signout', () => void run(() => account.signOut())),
        );
        kids.push(who, row);
        if (lastSummary) kids.push(summaryLine(lastSummary));
        break;
      }
      case 'unreachable':
        kids.push(
          note(
            "Can't reach the saving service right now. Your drawings are still saved in this browser.",
            'account-note',
          ),
          btn('Try again', 'account-retry', () => {
            void run(async () => {
              await account.init();
              if (account.status === 'guest' || account.status === 'member') await doSync();
            });
          }),
        );
        break;
    }
    body.replaceChildren(...kids);
    root.dataset.status = account.status;
    root.dataset.busy = String(busy);
  }

  function summaryLine(text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'tt-account-fine';
    p.dataset.testid = 'account-summary';
    p.textContent = text;
    return p;
  }

  const off = account.onChange(render);
  render();
  return {
    root,
    destroy() {
      off();
      root.remove();
    },
  };
}
