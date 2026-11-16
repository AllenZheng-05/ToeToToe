import type { App } from '../app/app';
import type { DuelSession } from '../core/session';
import type { PlayerId, Unsubscribe } from '../core/types';
import { DuelScene } from './duel';
import { TitleScene } from './title';
import type { MatchSetup, Scene } from './types';

/** How long "Your friend left" stays up before returning to the title (UI only, not on the beat). */
const LEFT_NOTICE_MS = 2200;

export class VictoryScene implements Scene {
  private root: HTMLElement | null = null;
  private cleanups: Unsubscribe[] = [];
  private leaveTimer: number | null = null;

  constructor(
    private readonly app: App,
    private readonly setup: MatchSetup,
    private readonly actWins: readonly [number, number],
    private readonly winner: PlayerId,
    /** The finished session, kept readable (e.g. by debug tools) while the victory screen is up. */
    private readonly session: DuelSession | null = null,
  ) {}

  enter(): void {
    const { setup, actWins, winner } = this;
    if (this.session) this.app.session = this.session;
    const root = document.createElement('div');
    root.className = 'scene victory';
    root.dataset.testid = 'victory';

    const card = document.createElement('div');
    card.className = 'card';
    root.appendChild(card);

    const heading = document.createElement('h1');
    heading.dataset.testid = 'winner';
    heading.textContent = `${setup.names[winner].toUpperCase()} WINS!`;
    card.appendChild(heading);

    const score = document.createElement('p');
    score.className = 'score';
    score.dataset.testid = 'score';
    score.textContent = `Acts: ${setup.names[0]} ${actWins[0]}, ${setup.names[1]} ${actWins[1]}`;
    card.appendChild(score);

    const rematchNote = document.createElement('p');
    rematchNote.className = 'hint';
    rematchNote.dataset.testid = 'rematch-status';
    card.appendChild(rematchNote);

    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    card.appendChild(buttons);

    const rematch = document.createElement('button');
    rematch.type = 'button';
    rematch.className = 'btn primary';
    rematch.dataset.testid = 'rematch';
    rematch.textContent = 'Rematch';
    rematch.disabled = !setup.rematch;
    rematch.addEventListener('click', () => {
      const next = setup.rematch;
      if (!next) return;
      rematch.disabled = true;
      if (setup.online) rematchNote.textContent = 'Waiting for your friend…';
      void next().then(
        (match) => this.app.go(new DuelScene(this.app, match)),
        () => {
          rematch.disabled = false;
        },
      );
    });
    buttons.appendChild(rematch);

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn paper';
    back.dataset.testid = 'back-to-title';
    back.textContent = 'Back to title';
    back.addEventListener('click', () => {
      setup.leave?.();
      void this.app.go(new TitleScene(this.app));
    });
    buttons.appendChild(back);

    this.app.overlay.appendChild(root);
    this.root = root;

    if (setup.online) {
      const peer = setup.names[setup.localPlayer === 0 ? 1 : 0];
      if (setup.watchRematch) {
        this.cleanups.push(
          setup.watchRematch((s) => {
            if (s.local) rematchNote.textContent = s.peer ? '' : 'Waiting for your friend…';
            else rematchNote.textContent = s.peer ? `${peer} wants a rematch` : '';
          }),
        );
      }
      this.cleanups.push(
        setup.transport.onState((state) => {
          if (state === 'closed') this.onPeerLeft(card);
        }),
      );
    }
  }

  private onPeerLeft(card: HTMLElement): void {
    if (this.leaveTimer !== null) return;
    const notice = document.createElement('p');
    notice.className = 'hint';
    notice.dataset.testid = 'friend-left';
    notice.textContent = 'Your friend left';
    card.appendChild(notice);
    for (const b of card.querySelectorAll('button')) b.disabled = true;
    this.leaveTimer = window.setTimeout(() => {
      this.setup.leave?.();
      void this.app.go(new TitleScene(this.app));
    }, LEFT_NOTICE_MS);
  }

  exit(): void {
    for (const off of this.cleanups.splice(0)) off();
    if (this.leaveTimer !== null) window.clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
    if (this.session && this.app.session === this.session) this.app.session = null;
    this.root?.remove();
    this.root = null;
  }
}
