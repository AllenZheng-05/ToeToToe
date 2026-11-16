import type { App } from '../app/app';
import { cleanName, loadName, MAX_NAME_LENGTH, saveName } from '../app/profile';
import { createBotMatch } from './botMatch';
import { DuelScene } from './duel';
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

    const create = makeButton('Create a room', 'primary', 'create-room');
    const join = makeButton('Join a room', 'pink', 'join-room');
    create.disabled = true;
    join.disabled = true;
    const soon = document.createElement('p');
    soon.className = 'hint';
    soon.textContent = 'Rooms: coming in the next milestone';
    card.appendChild(soon);

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

  private async startBotMatch(rawName: string): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    saveName(rawName);
    // This runs inside a click, which is the user gesture that lets audio start.
    await this.app.engine.resume();
    await this.app.go(new DuelScene(this.app, createBotMatch(this.app)));
  }
}
