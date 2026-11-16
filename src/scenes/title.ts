import { showRoomInAddress } from '../app/address';
import type { App } from '../app/app';
import { awaitAudio } from '../app/audioGate';
import { MAX_NAME_LENGTH } from '../app/profile';
import { createAccountPanel, type AccountPanel } from '../account/panel';
import { generateRoomCode, normaliseRoomCode, roomCodeFromUrl } from '../net/codes';
import { button, letterTiles, textInput, tornNote } from '../ui/kit/kit';
import { menuButton, node, sceneRoot, signContent, tagline } from '../ui/menu';
import { createBotMatch } from './botMatch';
import { CalibrationScene } from './calibration';
import { DuelScene } from './duel';
import { LobbyScene } from './lobby';
import { loadLocalPuppet, loadPartnerPuppet, MenuPuppets } from './menuPuppets';
import type { Scene } from './types';
import { WorkshopScene } from './workshopScene';

const TAGLINE = 'a sock puppet duel for two';

/** The title: the sign, the player's puppet with its sword following the pointer, and the way into a room. */
export class TitleScene implements Scene {
  private root: HTMLElement | null = null;
  private starting = false;
  private cleanup: (() => void)[] = [];
  private puppets: MenuPuppets | null = null;
  private panel: AccountPanel | null = null;
  private exited = false;

  constructor(private readonly app: App) {}

  enter(): void {
    const { app } = this;
    const root = sceneRoot('title', 'title');

    // The sign: the lettering and the two small ways in.
    const sign = signContent(root);
    const heading = node('h1', 'sign-heading', sign);
    heading.setAttribute('aria-label', 'Toe to Toe');
    heading.appendChild(letterTiles('TOE to TOE', { palette: 'title' }));
    sign.appendChild(tagline(TAGLINE));
    const side = node('div', 'sign-row', sign);
    const bot = menuButton(
      'Practise against the bot',
      'play-bot',
      'secondary',
      () => void this.startBotMatch(),
      'sign',
    );
    const workshop = menuButton(
      'Puppet workshop',
      'open-workshop',
      'secondary',
      () => void this.openWorkshop(),
      'sign',
    );
    side.append(bot, workshop);

    // The right curtain: the account panel (once there is one) and, below it, input calibration.
    const corner = node('div', 'title-account', root);
    corner.appendChild(
      menuButton(
        'Calibrate timing',
        'open-calibration',
        'secondary',
        () => void this.openCalibration(),
        'side',
      ),
    );

    // The ledge: name on the left, the room buttons in the middle.
    const name = textInput({
      label: 'YOUR NAME',
      value: app.displayName,
      maxLength: MAX_NAME_LENGTH,
      testId: 'name-input',
    });
    name.root.classList.add('title-name');
    name.input.addEventListener('change', () => {
      name.input.value = app.setDisplayName(name.input.value);
    });
    root.appendChild(name.root);

    const ledge = node('div', 'ledge-row', root);
    // A room code in the address bar (a shared link) makes joining that room the main button.
    const linked = roomCodeFromUrl(location.href);
    if (linked) {
      ledge.appendChild(
        menuButton(
          `Join room ${linked}`,
          'join-linked',
          'primary',
          () => void this.openRoom(linked, 'guest', name.input.value, false),
          'main',
        ),
      );
    }
    ledge.appendChild(
      menuButton(
        'Create a room',
        'create-room',
        linked ? 'pink' : 'primary',
        () => void this.openRoom(generateRoomCode(), 'host', name.input.value, true),
        'main',
      ),
    );

    // "Join a room" reveals the room code field.
    const joinRow = node('div', 'join-row', root, 'join-row');
    joinRow.hidden = true;
    const code = textInput({
      label: 'ROOM CODE',
      placeholder: 'ROW-G-12',
      maxLength: 24,
      testId: 'join-code',
    });
    code.input.setAttribute('aria-label', 'Room code');
    const joinGo = button('Join', { variant: 'small', testId: 'join-go' });
    const joinError = tornNote('', { rotate: -1 });
    joinError.dataset.testid = 'join-error';
    joinError.setAttribute('role', 'alert');
    joinError.hidden = true;
    const submit = (): void => {
      const normalised = normaliseRoomCode(code.input.value);
      if (normalised === null) {
        joinError.textContent = "That doesn't look like a room code.";
        joinError.hidden = false;
        return;
      }
      joinError.hidden = true;
      void this.openRoom(normalised, 'guest', name.input.value, true);
    };
    joinGo.addEventListener('click', submit);
    code.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    const joinLine = node('div', 'join-line', joinRow);
    joinLine.append(code.root, joinGo);
    joinRow.appendChild(joinError);
    if (!linked) {
      ledge.appendChild(
        menuButton(
          'Join a room',
          'join-room',
          'pink',
          () => {
            joinRow.hidden = false;
            code.input.focus();
          },
          'main',
        ),
      );
    }

    if (app.params.bot) {
      // ?bot=1: the first click anywhere is the user gesture that unlocks audio and starts the match.
      const onDown = (): void => void this.startBotMatch();
      document.addEventListener('pointerdown', onDown, { once: true });
      this.cleanup.push(() => document.removeEventListener('pointerdown', onDown));
    }

    app.overlay.appendChild(root);
    this.root = root;

    // The puppets: the player's own and a partner, swords crossed, the player's tip following the pointer.
    const puppets = new MenuPuppets(app);
    this.puppets = puppets;
    puppets.followPointer(0);
    void (async () => {
      const mine = await loadLocalPuppet(app);
      const partner = await loadPartnerPuppet(mine?.presetId ?? null);
      if (this.exited) return;
      if (mine) puppets.setImages(0, mine.images);
      if (partner) puppets.setImages(1, partner);
      // The puppets are drawn from the next frame on (tests and screenshots wait for this).
      root.dataset.puppets = 'ready';
    })();

    // The account panel, once the account service (if any) is ready. Never waited for.
    void app.account.then((account) => {
      if (this.exited || !this.root) return;
      const panel = createAccountPanel({ account, store: app.store, getDisplayName: () => app.displayName });
      corner.prepend(panel.root);
      this.panel = panel;
    });
  }

  exit(): void {
    this.exited = true;
    for (const fn of this.cleanup.splice(0)) fn();
    this.panel?.destroy();
    this.panel = null;
    this.puppets?.destroy();
    this.puppets = null;
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
    const name = this.app.setDisplayName(rawName);
    await awaitAudio(this.app);
    if (changeAddress) showRoomInAddress(code);
    await this.app.go(new LobbyScene(this.app, { code, role, name }));
  }

  private async startBotMatch(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    const name = this.root?.querySelector<HTMLInputElement>('[data-testid="name-input"]');
    if (name) this.app.setDisplayName(name.value);
    // This runs inside a click, which is the user gesture that lets audio start.
    await awaitAudio(this.app);
    await this.app.go(new DuelScene(this.app, await createBotMatch(this.app)));
  }

  private async openCalibration(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    await this.app.go(new CalibrationScene(this.app, { back: () => new TitleScene(this.app) }));
  }

  private async openWorkshop(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    await this.app.go(new WorkshopScene(this.app, { back: () => new TitleScene(this.app) }));
  }
}
