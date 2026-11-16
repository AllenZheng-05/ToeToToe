import type { App } from '../app/app';
import { cleanName, loadName, MAX_NAME_LENGTH, saveName } from '../app/profile';
import { showRoomInAddress } from '../app/address';
import { generateRoomCode, normaliseRoomCode, roomCodeFromUrl } from '../net/codes';
import { createBotMatch } from './botMatch';
import { DuelScene } from './duel';
import { LobbyScene } from './lobby';
import type { Scene } from './types';

export class TitleScene implements Scene {
  private root: HTMLElement | null = null;
  private starting = false;
  private cleanup: (() => void)[] = [];

  constructor(private readonly app: App) {}

  enter(): void {
    const root = document.createElement('div');
    root.className = 'scene title';
    root.dataset.testid = 'title';

    const card = document.createElement('div');
    card.className = 'card';
    root.appendChild(card);

    const heading = document.createElement('h1');
    heading.textContent = 'Toe to Toe';
    card.appendChild(heading);

    const label = document.createElement('label');
    label.className = 'field';
    label.textContent = 'Your name';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = MAX_NAME_LENGTH;
    input.value = loadName();
    input.dataset.testid = 'name-input';
    input.autocomplete = 'off';
    input.addEventListener('change', () => {
      saveName(input.value);
      input.value = cleanName(input.value);
    });
    label.appendChild(input);
    card.appendChild(label);

    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    card.appendChild(buttons);

    const makeButton = (text: string, cls: string, testId: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn ${cls}`;
      b.dataset.testid = testId;
      b.textContent = text;
      buttons.appendChild(b);
      return b;
    };

    // A room code in the address bar (a shared link) makes joining that room the main button.
    const linked = roomCodeFromUrl(location.href);
    if (linked) {
      const joinLinked = makeButton(`Join room ${linked}`, 'primary', 'join-linked');
      joinLinked.addEventListener('click', () => void this.openRoom(linked, 'guest', input.value, false));
    }
    const create = makeButton('Create a room', linked ? 'pink' : 'primary', 'create-room');
    create.addEventListener('click', () => void this.openRoom(generateRoomCode(), 'host', input.value, true));
    const join = makeButton('Join a room', 'pink', 'join-room');

    const joinRow = document.createElement('div');
    joinRow.className = 'field';
    joinRow.dataset.testid = 'join-row';
    joinRow.hidden = true;
    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.placeholder = 'ROW-G-12';
    codeInput.maxLength = 24;
    codeInput.autocomplete = 'off';
    codeInput.dataset.testid = 'join-code';
    codeInput.setAttribute('aria-label', 'Room code');
    const joinError = document.createElement('p');
    joinError.className = 'hint';
    joinError.dataset.testid = 'join-error';
    joinError.setAttribute('role', 'alert');
    joinError.hidden = true;
    const joinGo = document.createElement('button');
    joinGo.type = 'button';
    joinGo.className = 'btn primary';
    joinGo.dataset.testid = 'join-go';
    joinGo.textContent = 'Join';
    const submitCode = (): void => {
      const code = normaliseRoomCode(codeInput.value);
      if (code === null) {
        joinError.textContent = "That doesn't look like a room code.";
        joinError.hidden = false;
        return;
      }
      joinError.hidden = true;
      void this.openRoom(code, 'guest', input.value, true);
    };
    joinGo.addEventListener('click', submitCode);
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitCode();
    });
    joinRow.append(codeInput, joinGo, joinError);
    join.addEventListener('click', () => {
      joinRow.hidden = false;
      codeInput.focus();
    });
    card.appendChild(joinRow);

    const bot = makeButton('Practise against the bot', 'paper', 'play-bot');
    bot.addEventListener('click', () => void this.startBotMatch(input.value));

    if (this.app.params.bot) {
      // ?bot=1: the first click anywhere is the user gesture that unlocks audio and starts the match.
      const onDown = (): void => void this.startBotMatch(input.value);
      document.addEventListener('pointerdown', onDown, { once: true });
      this.cleanup.push(() => document.removeEventListener('pointerdown', onDown));
    }

    this.app.overlay.appendChild(root);
    this.root = root;
  }

  exit(): void {
    for (const fn of this.cleanup.splice(0)) fn();
    this.root?.remove();
    this.root = null;
  }

  /** Both room buttons are user gestures: they resume audio, then open the lobby. */
  private async openRoom(
    code: string,
    role: 'host' | 'guest',
    rawName: string,
    changeAddress: boolean,
  ): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    const name = cleanName(rawName);
    saveName(name);
    await this.app.engine.resume();
    if (changeAddress) showRoomInAddress(code);
    await this.app.go(new LobbyScene(this.app, { code, role, name }));
  }

  private async startBotMatch(rawName: string): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    saveName(rawName);
    // This runs inside a click, which is the user gesture that lets audio start.
    await this.app.engine.resume();
    await this.app.go(new DuelScene(this.app, createBotMatch(this.app)));
  }
}
