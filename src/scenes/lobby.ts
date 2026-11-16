import type { App } from '../app/app';
import { openConnection, type Connection } from '../app/connection';
import type { Unsubscribe } from '../core/types';
import { roomLink } from '../net/codes';
import { DuelScene } from './duel';
import { controls, playerRows, statusText, type LobbyModel } from './lobbyModel';
import { createRoomMatch, leaveRoom } from './roomMatch';
import { TitleScene } from './title';
import type { Scene } from './types';

/** How long "Your friend left" stays up before returning to the title (UI only, not on the beat). */
const LEFT_NOTICE_MS = 2200;

export interface LobbyOptions {
  code: string;
  role: 'host' | 'guest';
  /** Already cleaned display name. */
  name: string;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  testId: string | null,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (testId) node.dataset.testid = testId;
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(testId: string, text: string, cls: string): HTMLButtonElement {
  const b = el('button', testId, `btn ${cls}`, text);
  b.type = 'button';
  return b;
}

/** The waiting room. Wiring (link, transport, Room) lives in `app/connection.ts`; this scene shows it. */
export class LobbyScene implements Scene {
  private root: HTMLElement | null = null;
  private connection: Connection | null = null;
  private subs: Unsubscribe[] = [];
  private exited = false;
  private handedOff = false;
  private leaveTimer: number | null = null;
  private model: LobbyModel;
  private draw: () => void = () => {};

  constructor(
    private readonly app: App,
    private readonly opts: LobbyOptions,
  ) {
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
    const root = el('div', 'lobby', 'scene lobby');
    const card = el('div', null, 'card');
    root.appendChild(card);
    card.appendChild(el('h1', null, undefined, 'Room'));
    card.appendChild(el('p', 'room-code', 'score', code));

    const shareRow = el('label', null, 'field');
    shareRow.appendChild(document.createTextNode('Share this link'));
    const shareInput = el('input', 'share-link');
    shareInput.type = 'text';
    shareInput.readOnly = true;
    shareInput.value = roomLink(location.origin, code);
    shareRow.appendChild(shareInput);
    const copy = button('copy-link', 'Copy link', 'paper');
    copy.addEventListener('click', () => void this.copyLink(shareInput, copy));
    card.append(shareRow, copy);

    const players = el('div', 'players', 'hint');
    const rows = [0, 1].map((i) => {
      const row = el('p', `player-${i}`);
      const name = el('span', `player-${i}-name`);
      const state = el('span', `player-${i}-ready`);
      row.append(name, document.createTextNode(': '), state);
      players.appendChild(row);
      return { name, state };
    });
    card.appendChild(players);

    const status = el('p', 'status', 'hint');
    status.setAttribute('role', 'status');
    const rtt = el('p', 'rtt', 'hint');
    const guestWait = el('p', 'guest-wait', 'hint', 'Waiting for the host to start');
    card.append(status, rtt, guestWait);

    const buttons = el('div', null, 'buttons');
    const ready = button('ready-toggle', 'Ready', 'primary');
    ready.addEventListener('click', () => {
      const room = this.connection?.room;
      if (room) room.setReady(!room.localReady);
      this.sync();
    });
    const start = button('start', 'Start', 'pink');
    start.addEventListener('click', () => {
      this.connection?.room.start();
    });
    const back = button('back-to-title', 'Back to title', 'paper');
    back.addEventListener('click', () => this.toTitle());
    const retry = button('retry', 'Try again', 'primary');
    retry.addEventListener('click', () => void this.connect());
    const leave = button('leave', 'Leave', 'paper');
    leave.addEventListener('click', () => this.toTitle());
    buttons.append(ready, start, retry, back, leave);
    card.appendChild(buttons);

    this.draw = () => {
      const m = this.model;
      const c = controls(m);
      playerRows(m).forEach((p, i) => {
        const r = rows[i];
        if (!r) return;
        r.name.textContent = `${p.name} (${p.tag})`;
        r.state.textContent = p.ready ? 'Ready' : 'Not ready';
        r.state.dataset.ready = String(p.ready);
      });
      status.textContent = statusText(m);
      rtt.textContent = c.rttText ?? '';
      rtt.hidden = c.rttText === null;
      guestWait.hidden = !(role === 'guest' && c.canReady);
      ready.disabled = !c.canReady;
      ready.setAttribute('aria-pressed', String(m.localReady));
      ready.classList.toggle('on', m.localReady);
      start.hidden = role !== 'host';
      start.disabled = !c.canStart;
      retry.hidden = !c.showRetry;
      back.hidden = !c.showBackToTitle;
    };

    this.app.overlay.appendChild(root);
    this.root = root;
    this.draw();
    void this.connect();
  }

  exit(): void {
    this.exited = true;
    if (this.leaveTimer !== null) window.clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
    this.detach();
    // Unless the match took over the room, leaving the scene leaves the room.
    if (!this.handedOff && this.connection) leaveRoom(this.connection);
    this.connection = null;
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
    this.connection = connection;
    this.subs.push(
      connection.transport.onState((state) => {
        this.sync();
        if (state === 'closed') this.onFriendLeft();
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
    this.sync();
  }

  /** Copy what the room knows into the model and redraw. */
  private sync(): void {
    const c = this.connection;
    if (c) {
      this.model = {
        ...this.model,
        transport: c.transport.state,
        peerName: c.room.peerName,
        localReady: c.room.localReady,
        peerReady: c.room.peerReady,
        synced: c.room.synced,
        rttMs: c.room.rttMs,
      };
    }
    this.draw();
  }

  private onFriendLeft(): void {
    if (this.leaveTimer !== null || this.exited) return;
    this.leaveTimer = window.setTimeout(() => this.toTitle(), LEFT_NOTICE_MS);
  }
}
