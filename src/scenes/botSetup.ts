import type { App } from '../app/app';
import { awaitAudio } from '../app/audioGate';
import { initialTheme } from '../app/connection';
import { PRESETS } from '../puppet/presets';
import { loadPresetImages } from '../stage/art/puppetView';
import type { LoadedTheme } from '../theme/theme';
import { button, labelStrip, letterTiles } from '../ui/kit/kit';
import { menuButton, node, sceneRoot, signContent, tagline } from '../ui/menu';
import { createBotMatch, type BotMatchOptions } from './botMatch';
import { DIFFICULTIES, resolveBotPuppet, SURPRISE, type BotDifficulty } from './botSetupModel';
import { DuelScene } from './duel';
import { themeText } from './lobbyModel';
import { loadLocalPuppet, MenuPuppets } from './menuPuppets';
import { ThemeScene } from './themeScene';
import { TitleScene } from './title';
import type { Scene } from './types';
import { WorkshopScene } from './workshopScene';

const TAGLINE = 'pick your fight';
const DIFFICULTY_LABEL: Record<BotDifficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
/** The swatch colour of each preset on its button (the sock's own body colour). */
const PRESET_COLOUR: Record<string, string> = {
  'preset-teal': '#3fb8af',
  'preset-pink': '#f48fb1',
  'preset-yellow': '#ffe14d',
  'preset-blue': '#2456c8',
};

/** Starts a bot match from the saved set-up (the set-up screen's Start, and the `?bot=1` shortcut). Audio must be running. */
export async function startBotMatch(app: App, o: Partial<BotMatchOptions> = {}): Promise<void> {
  const match = await createBotMatch(app, { rematchScene: () => new BotSetupScene(app), ...o });
  await app.go(new DuelScene(app, match));
}

export interface BotSetupOptions {
  /** Random numbers in [0, 1) for Surprise me (default Math.random). */
  random?: () => number;
}

const PRESET_IDS = PRESETS.map((p) => p.id);

/** "Play against the bot": the battle theme, both puppets and the bot's difficulty, then Start. */
export class BotSetupScene implements Scene {
  private root: HTMLElement | null = null;
  private puppets: MenuPuppets | null = null;
  private exited = false;
  private starting = false;
  private theme: LoadedTheme | null = null;
  private themeFailed = false;
  private playerPresetId: string | null = null;
  /** Surprise me is rolled once per visit, so the stage shows the puppet that will play. */
  private readonly roll: number;
  private botToken = 0;
  private draw: () => void = () => {};

  constructor(
    private readonly app: App,
    private readonly opts: BotSetupOptions = {},
  ) {
    this.roll = (opts.random ?? Math.random)();
  }

  enter(): void {
    const { app } = this;
    const root = sceneRoot('bot-setup', 'bot-setup');

    // The sign: the heading and a line of paper.
    const sign = signContent(root, 'sign-bot-setup');
    const heading = node('h1', 'sign-heading bs-heading', sign);
    heading.setAttribute('aria-label', 'Play against the bot');
    heading.append(
      letterTiles('PLAY AGAINST', { palette: 'banner', size: 44 }),
      letterTiles('THE BOT', { palette: 'banner', size: 44, seed: 3 }),
    );
    sign.appendChild(tagline(TAGLINE));

    // Left curtain: the player's side. Right curtain: the bot's side.
    const left = node('div', 'bs-side bs-left', root);
    const right = node('div', 'bs-side bs-right', root);

    // Battle theme.
    const themeRow = node('div', 'bs-row', left, 'bot-row-theme');
    themeRow.appendChild(labelStrip('BATTLE THEME'));
    const themeName = node('span', 'bs-value', themeRow, 'bot-theme-title');
    const themeChange = button('Change', {
      variant: 'small',
      testId: 'bot-theme-change',
      onClick: () => void this.openTheme(),
    });
    themeChange.setAttribute('aria-label', 'Change the battle theme');
    themeRow.appendChild(themeChange);

    // Your puppet.
    const mineRow = node('div', 'bs-row', left, 'bot-row-my-puppet');
    mineRow.appendChild(labelStrip('YOUR PUPPET'));
    const mineName = node('span', 'bs-value', mineRow, 'bot-my-puppet', '…');
    const mineEdit = button('Edit', {
      variant: 'small',
      testId: 'bot-puppet-edit',
      onClick: () => void this.openWorkshop(),
    });
    mineEdit.setAttribute('aria-label', 'Edit your puppet');
    mineRow.appendChild(mineEdit);

    // The bot's puppet: the four presets and Surprise me.
    const botRow = node('div', 'bs-row', right, 'bot-row-bot-puppet');
    botRow.appendChild(labelStrip("BOT'S PUPPET"));
    const grid = node('div', 'bs-grid', botRow);
    const choices = new Map<string, HTMLButtonElement>();
    for (const preset of PRESETS) {
      const b = button(preset.name.split(' ')[0] ?? preset.name, {
        variant: 'small',
        testId: `bot-puppet-${preset.id.replace(/^preset-/, '')}`,
        onClick: () => this.chooseBot(preset.id),
      });
      b.classList.add('bs-choice');
      b.setAttribute('aria-label', preset.name);
      const dot = node('span', 'bs-dot');
      const colour = PRESET_COLOUR[preset.id];
      if (colour) dot.style.background = colour;
      b.prepend(dot);
      grid.appendChild(b);
      choices.set(preset.id, b);
    }
    const surprise = button('Surprise me', {
      variant: 'small',
      testId: 'bot-puppet-surprise',
      onClick: () => this.chooseBot(SURPRISE),
    });
    surprise.classList.add('bs-choice', 'bs-wide');
    botRow.appendChild(surprise);

    // Bot difficulty.
    const hardRow = node('div', 'bs-row', right, 'bot-row-difficulty');
    hardRow.appendChild(labelStrip('BOT DIFFICULTY'));
    const steps = node('div', 'bs-steps', hardRow);
    const levels = new Map<BotDifficulty, HTMLButtonElement>();
    for (const d of DIFFICULTIES) {
      const b = button(DIFFICULTY_LABEL[d], {
        variant: 'small',
        testId: `bot-difficulty-${d}`,
        onClick: () => {
          app.setBotSetup({ difficulty: d });
          this.draw();
        },
      });
      b.classList.add('bs-choice');
      steps.appendChild(b);
      levels.set(d, b);
    }

    // The ledge.
    const row = node('div', 'ledge-row ledge-bot-setup', root);
    const start = menuButton('Start', 'bot-start', 'primary', () => void this.start(), 'main');
    const back = menuButton('Back to title', 'back-to-title', 'secondary', () => void this.toTitle(), 'side');
    row.append(start, back);

    const mark = (b: HTMLButtonElement, on: boolean): void => {
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    };
    this.draw = () => {
      const setup = app.botSetup;
      themeName.textContent = this.theme
        ? themeText({ title: this.theme.info.title, bpm: this.theme.info.bpm })
        : this.themeFailed
          ? 'Click track'
          : 'Loading…';
      start.disabled = this.theme === null && !this.themeFailed;
      // The marked swatch is the preset the bot will wear; with Surprise me, only that button is marked.
      const resolved = this.resolve();
      for (const [id, b] of choices) mark(b, setup.botPuppet !== SURPRISE && id === resolved);
      mark(surprise, setup.botPuppet === SURPRISE);
      for (const [d, b] of levels) mark(b, d === setup.difficulty);
      root.dataset.difficulty = setup.difficulty;
      root.dataset.botPuppet = resolved;
    };
    this.draw();

    app.overlay.appendChild(root);
    this.root = root;

    // The stage: the player's puppet on the left, the bot's on the right.
    const puppets = new MenuPuppets(app);
    this.puppets = puppets;
    puppets.followPointer(0);
    void (async () => {
      const mine = await loadLocalPuppet(app);
      if (this.exited) return;
      this.playerPresetId = mine?.presetId ?? null;
      if (mine) puppets.setImages(0, mine.images);
      mineName.textContent = mine?.name ?? 'My puppet';
      this.draw();
      await this.showBot();
      if (!this.exited) root.dataset.puppets = 'ready';
    })();

    // The theme (its tempo is on the row). Never rejects.
    void (async () => {
      try {
        const theme = await initialTheme(app);
        if (!this.exited) this.theme = theme;
      } catch {
        this.themeFailed = true;
      }
      if (!this.exited) this.draw();
    })();
  }

  exit(): void {
    this.exited = true;
    this.puppets?.destroy();
    this.puppets = null;
    this.root?.remove();
    this.root = null;
  }

  /** The preset the bot wears now: the setting, with Surprise me settled by this visit's roll. */
  private resolve(): string {
    return resolveBotPuppet(this.app.botSetup, PRESET_IDS, this.playerPresetId, () => this.roll);
  }

  private chooseBot(choice: string): void {
    this.app.setBotSetup({ botPuppet: choice });
    this.draw();
    void this.showBot();
  }

  private async showBot(): Promise<void> {
    const token = ++this.botToken;
    const preset = PRESETS.find((p) => p.id === this.resolve());
    if (!preset) return;
    try {
      const images = await loadPresetImages(preset);
      if (this.exited || token !== this.botToken) return;
      this.puppets?.setImages(1, images);
    } catch {
      /* the stage keeps whatever it showed */
    }
  }

  private async start(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    // This runs inside a click, which is the user gesture that lets audio start.
    await awaitAudio(this.app);
    await startBotMatch(this.app, {
      theme: this.theme ?? undefined,
      botPuppetId: this.resolve(),
      random: this.opts.random,
    });
  }

  private async toTitle(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    await this.app.go(new TitleScene(this.app));
  }

  private async openTheme(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    await this.app.go(
      new ThemeScene(this.app, {
        back: () => new BotSetupScene(this.app, this.opts),
        onChosen: () => undefined,
        backLabel: 'Back to the set-up',
      }),
    );
  }

  private async openWorkshop(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    await this.app.go(new WorkshopScene(this.app, { back: () => new BotSetupScene(this.app, this.opts) }));
  }
}
