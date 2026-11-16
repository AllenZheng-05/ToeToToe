import type { App } from '../app/app';
import type { DuelSession } from '../core/session';
import type { PlayerId, Unsubscribe } from '../core/types';
import { button, labelStrip, letterTiles, tornNote } from '../ui/kit/kit';
import { menuButton, node, quip, sceneRoot, signContent, tagline } from '../ui/menu';
import { DuelScene } from './duel';
import { LobbyScene } from './lobby';
import { loadLocalPuppet, loadPartnerPuppet, MenuPuppets } from './menuPuppets';
import { TitleScene } from './title';
import type { MatchSetup, PuppetImagesSource, Scene } from './types';

/** How long "Your friend left" stays up before returning to the title (UI only, not on the beat). */
const LEFT_NOTICE_MS = 2200;
/** The win line's tiles are 46 px wide with 5 px gaps (kit metrics); longer lines shrink to fit the sign. */
const TILE_W = 46;
const TILE_GAP = 5;
const WORD_GAP = 18;
const WIN_LINE_MAX_W = 560;
const WIN_AUDIENCE = '"again! again!"';

/** "2 acts to 1". Pure. */
export function scoreLine(actWins: readonly [number, number], winner: PlayerId): string {
  const mine = actWins[winner];
  const theirs = actWins[winner === 0 ? 1 : 0];
  return `${mine} ${mine === 1 ? 'act' : 'acts'} to ${theirs}`;
}

/** Tile width that makes `text` fit the sign: the full size for short names, smaller for long ones. Pure. */
export function winTileSize(text: string): number {
  const letters = Array.from(text).filter((c) => c !== ' ').length;
  const words = Math.max(0, text.split(' ').length - 1);
  const natural = letters * (TILE_W + TILE_GAP) + words * WORD_GAP;
  return natural <= WIN_LINE_MAX_W ? TILE_W : Math.max(24, Math.floor((TILE_W * WIN_LINE_MAX_W) / natural));
}

export class VictoryScene implements Scene {
  private root: HTMLElement | null = null;
  private cleanups: Unsubscribe[] = [];
  private leaveTimer: number | null = null;
  private puppets: MenuPuppets | null = null;
  private exited = false;
  /** The rematch began, so the room is not left behind with a request still open. */
  private rematchStarted = false;

  constructor(
    private readonly app: App,
    private readonly setup: MatchSetup,
    private readonly actWins: readonly [number, number],
    private readonly winner: PlayerId,
    /** The finished session, kept readable (e.g. by debug tools) while the victory screen is up. */
    private readonly session: DuelSession | null = null,
  ) {}

  enter(): void {
    const { setup, actWins, winner, app } = this;
    if (this.session) app.session = this.session;
    const root = sceneRoot('victory', 'victory');

    const sign = signContent(root, 'sign-victory');
    const line = `${setup.names[winner].toUpperCase()} WINS!`;
    const heading = node('h1', 'sign-heading', sign, 'winner');
    heading.setAttribute('aria-label', line);
    heading.appendChild(letterTiles(line, { palette: 'win', size: winTileSize(line) }));
    const score = tagline(scoreLine(actWins, winner), 'score');
    sign.appendChild(score);
    const note = node('div', 'sign-note', sign);
    const audience = quip(WIN_AUDIENCE, 2);
    const rematchNote = tornNote('', { rotate: -1 });
    rematchNote.dataset.testid = 'rematch-status';
    rematchNote.hidden = true;
    note.append(audience, rematchNote);
    // Shown with the note when the friend has gone back to the room.
    const noteBack = button('Back to the room', {
      variant: 'small',
      testId: 'note-back-to-room',
      onClick: () => goToRoom(),
    });
    noteBack.hidden = true;
    note.appendChild(noteBack);
    const setNote = (text: string): void => {
      rematchNote.textContent = text;
      rematchNote.hidden = text === '';
      audience.hidden = text !== '';
    };

    // The ledge: each name under its puppet, and the buttons between.
    for (const id of [0, 1] as const) {
      const block = node('div', `victory-name victory-name-${id === 0 ? 'left' : 'right'}`, root);
      block.appendChild(labelStrip(setup.names[id].toUpperCase()));
      if (id === winner) {
        const tag = node('span', 'winner-tag', block, 'winner-tag', 'winner');
        tag.setAttribute('aria-label', `${setup.names[id]} won`);
      }
    }

    const row = node('div', 'ledge-row ledge-victory', root);
    const rematch = menuButton(
      'Rematch',
      'rematch',
      'primary',
      () => {
        const next = setup.rematch;
        if (!next) return;
        rematch.disabled = true;
        if (setup.online) setNote('Waiting for your friend…');
        void next().then(
          (match) => {
            this.rematchStarted = true;
            return this.app.go(new DuelScene(this.app, match));
          },
          () => {
            rematch.disabled = false;
          },
        );
      },
      'main',
    );
    rematch.disabled = !setup.rematch;
    const room = this.app.connection;
    const goToRoom = (): void => {
      if (!room) return;
      void this.app.go(
        new LobbyScene(this.app, { code: room.code, role: room.role, name: room.name, connection: room }),
      );
    };
    const backToRoom = menuButton('Back to the room', 'back-to-room', 'secondary', goToRoom, 'side');
    backToRoom.hidden = !(setup.online && room);
    const back = menuButton(
      'Back to title',
      'back-to-title',
      'pink',
      () => {
        setup.leave?.();
        void this.app.go(new TitleScene(this.app));
      },
      'side',
    );
    row.append(rematch, backToRoom, back);

    app.overlay.appendChild(root);
    this.root = root;

    // The winner raises the sword; the other puppet drops theirs.
    const puppets = new MenuPuppets(app);
    this.puppets = puppets;
    void this.showPuppets(puppets);

    if (setup.online) {
      const peer = setup.names[setup.localPlayer === 0 ? 1 : 0];
      if (setup.watchRematch) {
        this.cleanups.push(
          setup.watchRematch((s) => {
            // The friend left for the room: a rematch cannot start from here, so say so and offer the way back.
            const gone = s.peerBack === true && !s.peer;
            noteBack.hidden = !gone;
            rematch.disabled = !setup.rematch || gone || s.local;
            if (gone) setNote('Your friend went back to the room');
            else if (s.local) setNote(s.peer ? '' : 'Waiting for your friend…');
            else setNote(s.peer ? `${peer} wants a rematch` : '');
          }),
        );
      }
      this.cleanups.push(
        setup.transport.onState((state) => {
          if (state === 'closed') this.onPeerLeft(root, note, setNote);
        }),
      );
    }
  }

  /** Both puppets, from the match if the duel kept them, else loaded again. */
  private async showPuppets(puppets: MenuPuppets): Promise<void> {
    const { setup, winner } = this;
    const local = setup.localPlayer;
    const other: PlayerId = local === 0 ? 1 : 0;
    const given: [PuppetImagesSource | null, PuppetImagesSource | null] = setup.puppets ?? [null, null];
    let mine = given[local];
    let theirs = given[other];
    if (!mine) mine = (await loadLocalPuppet(this.app))?.images ?? null;
    theirs ??= await loadPartnerPuppet(null);
    if (this.exited) return;
    puppets.setImages(local, mine);
    puppets.setImages(other, theirs);
    puppets.setMood(winner, 'win');
    puppets.setMood(winner === 0 ? 1 : 0, 'lose');
  }

  private onPeerLeft(root: HTMLElement, note: HTMLElement, setNote: (text: string) => void): void {
    if (this.leaveTimer !== null) return;
    setNote('');
    const left = tornNote('Your friend left', { rotate: -1 });
    left.dataset.testid = 'friend-left';
    note.appendChild(left);
    for (const b of root.querySelectorAll('button')) b.disabled = true;
    this.leaveTimer = window.setTimeout(() => {
      this.setup.leave?.();
      void this.app.go(new TitleScene(this.app));
    }, LEFT_NOTICE_MS);
  }

  exit(): void {
    this.exited = true;
    for (const off of this.cleanups.splice(0)) off();
    // Leaving for anywhere but a rematch: withdraw the request and drop the listeners waiting for the start.
    if (!this.rematchStarted) this.setup.cancelRematch?.();
    if (this.leaveTimer !== null) window.clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
    if (this.session && this.app.session === this.session) this.app.session = null;
    this.puppets?.destroy();
    this.puppets = null;
    this.root?.remove();
    this.root = null;
  }
}
