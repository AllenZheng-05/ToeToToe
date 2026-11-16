import type { App } from '../app/app';
import { watchAudio } from '../app/audioGate';
import { openConnection, type Connection } from '../app/connection';
import type { PlayerId, Unsubscribe } from '../core/types';
import { roomLink } from '../net/codes';
import { button, labelStrip, letterTiles, progressBar, tornNote } from '../ui/kit/kit';
import { captioned, menuButton, node, sceneRoot, signContent } from '../ui/menu';
import { CalibrationScene } from './calibration';
import { DuelScene } from './duel';
import {
  controls,
  playerRows,
  statusText,
  themeText,
  transferBars,
  type LobbyModel,
  type TransferBar,
} from './lobbyModel';
import { loadLocalPuppet, MenuPuppets, peerPuppetForDisplay } from './menuPuppets';
import { createRoomMatch, leaveRoom } from './roomMatch';
import { ThemeScene } from './themeScene';
import { TitleScene } from './title';
import type { Scene } from './types';
import { WorkshopScene } from './workshopScene';

/** How long "Your friend left" stays up before returning to the title (UI only, not on the beat). */
const LEFT_NOTICE_MS = 2200;

export interface LobbyOptions {
  code: string;
  role: 'host' | 'guest';
  /** Already cleaned display name. */
  name: string;
  /** An open room to come back to (from the workshop or the theme screen), instead of joining anew. */
  connection?: Connection;
}

interface PlayerBlock {
  root: HTMLElement;
  name: HTMLElement;
  ready: HTMLElement;
}

/** The waiting room. Wiring (link, transport, Room, exchange) lives in `app/connection.ts`; this scene shows it. */
export class LobbyScene implements Scene {
  private root: HTMLElement | null = null;
  private connection: Connection | null = null;
  private subs: Unsubscribe[] = [];
  private exited = false;
  /** The room goes on without this scene (a duel, the workshop or the theme screen has it). */
  private handedOff = false;
  private leaveTimer: number | null = null;
  private model: LobbyModel;
  private draw: () => void = () => {};
  private puppets: MenuPuppets | null = null;
  private peerVersion = 0;
  private localPresetId: string | null = null;
  private readonly localPlayer: PlayerId;
  private stopWatchingAudio: (() => void) | null = null;

  constructor(
    private readonly app: App,
    private readonly opts: LobbyOptions,
  ) {
    this.localPlayer = opts.role === 'host' ? 0 : 1;
    this.model = {
      role: opts.role,
      linkReady: false,
      failed: false,
      transport: this.initialTransport(),
      versionMismatch: false,
      localName: opts.name,
      peerName: null,
      localReady: false,
      peerReady: false,
      synced: opts.role === 'host',
      rttMs: null,
    };
  }

  enter(): void {
    const { code, role } = this.opts;
    const root = sceneRoot('lobby', 'lobby');

    // Leave: a torn note on the curtain.
    const leave = node('button', 'note-leave', root, 'leave', 'leave the room');
    leave.type = 'button';
    leave.addEventListener('click', () => this.toTitle());

    // The sign: room code, link, and what is happening.
    const sign = signContent(root, 'sign-lobby');
    const codeRow = node('div', 'code-row', sign);
    codeRow.appendChild(labelStrip('ROOM CODE'));
    const tiles = letterTiles(code, { palette: 'title', size: 44 });
    const codeBox = node('div', 'code-tiles', codeRow, 'room-code');
    codeBox.appendChild(tiles);

    const linkRow = node('div', 'link-row', sign);
    const shareInput = node('input', 'link-box', linkRow, 'share-link');
    shareInput.type = 'text';
    shareInput.readOnly = true;
    shareInput.value = roomLink(location.origin, code);
    shareInput.setAttribute('aria-label', 'Share this link');
    const copy = button('Copy link', {
      variant: 'small',
      testId: 'copy-link',
      onClick: () => void this.copyLink(shareInput, copy),
    });
    linkRow.appendChild(copy);

    const status = node('div', 'sign-status', sign, 'status');
    status.setAttribute('role', 'status');
    const guestWait = node('p', 'sign-wait', sign, 'guest-wait', 'Waiting for the host to start');
    const failNote = tornNote('', { rotate: 1 });
    failNote.dataset.testid = 'theme-note';
    failNote.classList.add('sign-fail');
    failNote.hidden = true;
    sign.appendChild(failNote);

    // Right curtain: round trip and the progress of drawings and songs on their way.
    const side = node('div', 'lobby-side', root);
    const rtt = node('div', 'rtt-tag tt-tag', side, 'rtt');
    const xfer = node('div', 'xfer', side, 'transfers');
    const calibrate = menuButton(
      'Calibrate timing',
      'open-calibration',
      'secondary',
      () => void this.openCalibration(),
      'side',
    );
    side.appendChild(calibrate);

    // The battle theme.
    const themeRow = node('div', 'theme-row', root);
    themeRow.appendChild(labelStrip('BATTLE THEME'));
    const themeName = node('span', 'theme-name', themeRow, 'theme-title');
    const change = node('button', 'theme-change', themeRow, 'theme-change', 'change');
    change.type = 'button';
    change.setAttribute('aria-label', 'Battle theme');
    change.addEventListener('click', () => void this.openTheme());
    change.hidden = role !== 'host';

    // The ledge: player 0 on the left, player 1 on the right, buttons between.
    const blocks = [0, 1].map((i): PlayerBlock => {
      const own = i === this.localPlayer;
      const cap = captioned(own ? 'YOUR NAME' : 'YOUR FRIEND', i === 0 ? 'left' : 'right');
      cap.root.classList.add(i === 0 ? 'ledge-left' : 'ledge-right');
      const name = node('span', 'name-box', undefined, `player-${i}-name`);
      const ready = node('span', 'ready-tag', undefined, `player-${i}-ready`);
      if (i === 0) cap.row.append(name, ready);
      else cap.row.append(ready, name);
      root.appendChild(cap.root);
      return { root: cap.root, name, ready };
    });

    const mid = node('div', 'ledge-row ledge-lobby', root);
    const edit = menuButton('Edit my puppet', 'edit-puppet', 'pink', () => void this.openWorkshop(), 'side');
    const ready = menuButton(
      "I'm ready",
      'ready-toggle',
      'primary',
      () => {
        // A tap: the moment the browser lets audio start.
        void this.app.engine.resume().catch(() => undefined);
        const room = this.connection?.room;
        if (room) room.setReady(!room.localReady);
        this.sync();
      },
      'main',
    );
    const start = menuButton(
      'Start',
      'start',
      'pink',
      () => {
        if (this.model.role === 'host' && controls(this.model).canStart) this.connection?.room.start();
      },
      'main',
    );
    const retry = menuButton('Try again', 'retry', 'primary', () => void this.connect(), 'main');
    const back = menuButton('Back to title', 'back-to-title', 'secondary', () => this.toTitle(), 'side');
    mid.append(edit, ready, start, retry, back);

    const bars = new Map<TransferBar['id'], ReturnType<typeof progressBar>>();

    this.draw = () => {
      const m = this.model;
      const c = controls(m);
      const view = this.connection?.exchange.view ?? null;
      playerRows(m).forEach((p, i) => {
        const b = blocks[i];
        if (!b) return;
        b.name.textContent = p.name;
        b.ready.textContent = p.ready ? 'Ready' : 'Not ready';
        b.ready.dataset.ready = String(p.ready);
        b.root.dataset.present = String(m.peerName !== null || i === this.localPlayer);
      });
      status.textContent = statusText(m);
      status.dataset.state = m.failed ? 'failed' : m.transport;
      rtt.textContent = c.rttText ?? '';
      rtt.hidden = c.rttText === null;
      guestWait.hidden = !(role === 'guest' && c.canReady && m.localReady);

      themeName.textContent = themeText(view?.theme.offer ?? null);
      const note = view?.theme.message ?? null;
      failNote.textContent = note ?? '';
      failNote.hidden = note === null;

      const wanted = view ? transferBars(view, m.peerName) : [];
      for (const [id, bar] of bars) {
        if (!wanted.some((w) => w.id === id)) {
          bar.root.remove();
          bars.delete(id);
        }
      }
      for (const w of wanted) {
        let bar = bars.get(w.id);
        if (!bar) {
          bar = progressBar({ label: w.label });
          bar.root.dataset.testid = `transfer-${w.id}`;
          bars.set(w.id, bar);
          xfer.appendChild(bar.root);
        }
        bar.set(w.fraction, w.label);
      }

      ready.disabled = !c.canReady;
      ready.textContent = m.localReady ? 'Ready!' : "I'm ready";
      ready.setAttribute('aria-pressed', String(m.localReady));
      ready.classList.toggle('on', m.localReady);
      start.hidden = role !== 'host';
      start.disabled = !c.canStart;
      retry.hidden = !c.showRetry;
      back.hidden = !c.showBackToTitle;
      calibrate.disabled = m.failed || m.transport === 'full' || m.transport === 'closed';
      edit.disabled = m.failed || m.transport === 'full' || m.transport === 'closed';
      ready.hidden = c.showRetry || m.transport === 'full';
    };

    this.app.overlay.appendChild(root);
    this.root = root;

    const puppets = new MenuPuppets(this.app);
    this.puppets = puppets;
    void (async () => {
      const mine = await loadLocalPuppet(this.app);
      if (this.exited || !mine) return;
      this.localPresetId = mine.presetId;
      puppets.setImages(this.localPlayer, mine.images);
      this.peerVersion = 0;
      this.showPeerPuppet();
    })();

    this.stopWatchingAudio = watchAudio(this.app);
    this.draw();
    if (this.opts.connection) this.resume(this.opts.connection);
    else void this.connect();
  }

  exit(): void {
    this.exited = true;
    this.stopWatchingAudio?.();
    this.stopWatchingAudio = null;
    if (this.leaveTimer !== null) window.clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
    this.detach();
    // Unless a duel, the workshop or the theme screen took over the room, leaving the scene leaves the room.
    if (!this.handedOff && this.connection) leaveRoom(this.connection);
    this.connection = null;
    this.puppets?.destroy();
    this.puppets = null;
    this.root?.remove();
    this.root = null;
  }

  private initialTransport(): LobbyModel['transport'] {
    return this.opts.role === 'host' ? 'waiting' : 'connecting';
  }

  private detach(): void {
    for (const off of this.subs.splice(0)) off();
  }

  private toTitle(): void {
    void this.app.go(new TitleScene(this.app));
  }

  /** Leaves the room open for another screen, and not ready (the friend sees a change coming). */
  private keepRoom(): Connection | null {
    const c = this.connection;
    if (!c || c.transport.state === 'closed') return null;
    if (c.room.localReady) c.room.setReady(false);
    this.handedOff = true;
    return c;
  }

  private async openWorkshop(): Promise<void> {
    const connection = this.keepRoom();
    if (!connection) return;
    const { code, role, name } = this.opts;
    await this.app.go(
      new WorkshopScene(this.app, {
        back: () => new LobbyScene(this.app, { code, role, name, connection }),
        onSaved: () => connection.exchange.sendPuppet(),
      }),
    );
  }

  private async openCalibration(): Promise<void> {
    const connection = this.keepRoom();
    if (!connection) return;
    const { code, role, name } = this.opts;
    await this.app.go(
      new CalibrationScene(this.app, {
        back: () => new LobbyScene(this.app, { code, role, name, connection }),
      }),
    );
  }

  private async openTheme(): Promise<void> {
    if (this.opts.role !== 'host') return;
    const connection = this.keepRoom();
    if (!connection) return;
    const { code, role, name } = this.opts;
    await this.app.go(
      new ThemeScene(this.app, {
        back: () => new LobbyScene(this.app, { code, role, name, connection }),
        onChosen: (theme) => connection.exchange.offerTheme(theme),
      }),
    );
  }

  /** Copies the link, or selects it so the player can press Ctrl+C. */
  private async copyLink(input: HTMLInputElement, btn: HTMLButtonElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(input.value);
      btn.textContent = 'Copied';
    } catch {
      input.focus();
      input.select();
      btn.textContent = 'Press Ctrl+C to copy';
    }
  }

  private async connect(): Promise<void> {
    this.detach();
    if (this.connection) {
      leaveRoom(this.connection);
      this.connection = null;
    }
    this.model = { ...this.model, linkReady: false, failed: false, transport: this.initialTransport() };
    this.draw();

    let connection: Connection;
    try {
      connection = await openConnection(this.app, this.opts.code, this.opts.role, this.opts.name);
    } catch {
      if (this.exited) return;
      this.model = { ...this.model, failed: true };
      this.draw();
      return;
    }
    if (this.exited) {
      leaveRoom(connection);
      return;
    }
    this.attach(connection);
  }

  /** Coming back from the workshop or the theme screen: the same room, already connected. */
  private resume(connection: Connection): void {
    this.attach(connection);
    // The workshop may have changed the puppet: send it again. The friend may have gone meanwhile.
    connection.exchange.sendPuppet();
    if (connection.transport.state === 'closed') this.onFriendLeft();
  }

  private attach(connection: Connection): void {
    this.connection = connection;
    this.subs.push(
      connection.transport.onState((state) => {
        this.sync();
        if (state === 'closed') this.onFriendLeft();
      }),
      connection.exchange.onChange(() => {
        this.showPeerPuppet();
        this.sync();
      }),
      connection.room.on((e) => {
        if (e.type === 'start') {
          this.handedOff = true;
          this.detach();
          void this.app.go(new DuelScene(this.app, createRoomMatch(this.app, connection, e.info)));
          return;
        }
        if (e.type === 'versionMismatch') this.model = { ...this.model, versionMismatch: true };
        this.sync();
      }),
    );
    this.model = { ...this.model, linkReady: true };
    this.showPeerPuppet();
    this.sync();
  }

  /** The friend's puppet stands on the stage once their drawings have arrived. */
  private showPeerPuppet(): void {
    const peer = this.connection?.exchange.view.peerPuppet;
    if (!peer || !this.puppets || peer.version === this.peerVersion) return;
    this.peerVersion = peer.version;
    const slot = this.localPlayer === 0 ? 1 : 0;
    const puppets = this.puppets;
    void peerPuppetForDisplay(peer, this.localPresetId).then((images) => {
      // A newer set of drawings, or leaving the scene, makes this one stale.
      if (!this.exited && this.peerVersion === peer.version) puppets.setImages(slot, images);
    });
  }

  /** Copy what the room knows into the model and redraw. */
  private sync(): void {
    const c = this.connection;
    if (c) {
      const view = c.exchange.view;
      this.model = {
        ...this.model,
        transport: c.transport.state,
        peerName: c.room.peerName,
        localReady: c.room.localReady,
        peerReady: c.room.peerReady,
        synced: c.room.synced,
        rttMs: c.room.rttMs,
        themeOk: view.canReady,
        startOk: view.canStart && !c.exchange.busy,
      };
    }
    this.draw();
  }

  private onFriendLeft(): void {
    if (this.leaveTimer !== null || this.exited) return;
    this.leaveTimer = window.setTimeout(() => this.toTitle(), LEFT_NOTICE_MS);
  }
}
