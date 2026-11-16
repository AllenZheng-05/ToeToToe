import type { App, FrameInfo } from '../app/app';
import { watchAudio } from '../app/audioGate';
import { holdWakeLock } from '../app/wakeLock';
import { createSfx } from '../audio/sfx';
import { DuelSession, type SessionEvent } from '../core/session';
import type { PlayerId, Unsubscribe } from '../core/types';
import { attachPointerInput } from '../input/pointer';
import { DuelRenderer } from '../stage/duelRenderer';
import { loadPresetImages } from '../stage/art/puppetView';
import { playRectOnScreen, playToDesign } from '../stage/layout';
import { distinctColours, puppetMarkColour, type PixelImage, type Rgb } from '../puppet/colour';
import { PARTS } from '../puppet/parts';
import { PRESETS } from '../puppet/presets';
import { Hud } from '../ui/hud';
import { decodeDrawing, loadSelectedPuppet } from '../workshop/selection';
import { TitleScene } from './title';
import type { MatchSetup, PuppetImagesSource, Scene } from './types';
import { VictoryScene } from './victory';

/** How long "Your friend left" stays up before returning to the title (UI only, not on the beat). */
const LEFT_NOTICE_MS = 2200;

/** Reads a drawing's pixels once through a canvas (set-up only, never per frame). */
function readPixels(src: CanvasImageSource, width: number, height: number): PixelImage {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  g.drawImage(src, 0, 0, width, height);
  return { pixels: g.getImageData(0, 0, width, height).data, width, height };
}

/** Each puppet's mark colour from its sock and head, the opponent's shifted if too close to the local player's. */
function markColoursOf(
  images: readonly [PuppetImagesSource, PuppetImagesSource],
  local: PlayerId,
): [Rgb, Rgb] {
  const own = (i: PuppetImagesSource): Rgb => {
    try {
      return puppetMarkColour({
        sock: readPixels(i.sock, PARTS.sock.width, PARTS.sock.height),
        head: readPixels(i.head, PARTS.head.width, PARTS.head.height),
      });
    } catch {
      return puppetMarkColour({
        sock: { pixels: new Uint8ClampedArray(0), width: 0, height: 0 },
        head: { pixels: new Uint8ClampedArray(0), width: 0, height: 0 },
      });
    }
  };
  const mine = own(images[local]);
  const [m, theirs] = distinctColours(mine, own(images[local === 0 ? 1 : 0]));
  return local === 0 ? [m, theirs] : [theirs, m];
}

export class DuelScene implements Scene {
  private session: DuelSession | null = null;
  private renderer: DuelRenderer | null = null;
  private hud: Hud | null = null;
  private cleanups: Unsubscribe[] = [];
  private lastTimestamp = 0;
  private left = false;
  private over = false;
  private leaveTimer: number | null = null;
  private notice: HTMLElement | null = null;
  private disposed = false;

  constructor(
    private readonly app: App,
    private readonly setup: MatchSetup,
  ) {}

  enter(): void {
    const { app, setup } = this;
    const engine = app.engine;
    const sfx = createSfx(engine);

    const session = new DuelSession({
      localPlayer: setup.localPlayer,
      clock: engine.clock,
      grid: setup.grid,
      transport: setup.transport,
      tunables: app.tunables,
      firstAttacker: setup.firstAttacker,
      firstPhrase: setup.firstPhrase,
      inputOffsetMs: app.inputOffsetMs,
    });
    this.session = session;
    app.session = session;
    app.match = setup;
    app.judgedOffsets.length = 0;
    setup.attach?.(session);

    app.stage.setLook('duel');
    const renderer = new DuelRenderer(app.stage, app.tunables, setup.grid.bpm);
    const hud = new Hud(app.overlay, app.tunables, setup.names);
    this.renderer = renderer;
    this.hud = hud;
    // A phone shows the touch-sized targets from the start, before the first finger lands.
    if (window.matchMedia('(pointer: coarse)').matches) renderer.setPointer(null, true);

    this.cleanups.push(
      session.on((e) => this.onEvent(e, sfx)),
      attachPointerInput({
        element: app.stage.host,
        clock: engine.clock,
        getPlayRect: () => playRectOnScreen(app.stage.fit),
        // The sword tip follows the pointer; a lifted finger leaves it where it was (no move events then).
        onMove: (s) => renderer.setPointer(playToDesign(s.x, s.y), s.touch),
        onDown: (c) => {
          if (c.touch) renderer.setPointer(playToDesign(c.x, c.y), true);
          if (c.inside) session.pointerDown(c.x, c.y, c.time, c.touch);
        },
      }),
      setup.transport.onState((state) => {
        if (state === 'closed') this.onPeerLeft();
      }),
      app.onFrame((info) => this.frame(info)),
      holdWakeLock(),
      watchAudio(app),
    );
    void this.loadPuppets(renderer);
  }

  exit(): void {
    // Unsubscribe first: disposing the opponent closes the transport.
    for (const off of this.cleanups.splice(0)) off();
    if (this.leaveTimer !== null) window.clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
    this.notice?.remove();
    this.notice = null;
    this.session?.dispose();
    this.disposed = true;
    this.app.stage.setLook('menu');
    this.renderer?.destroy();
    this.hud?.destroy();
    this.setup.dispose?.();
    if (this.app.session === this.session) this.app.session = null;
    if (this.app.match === this.setup) this.app.match = null;
    this.session = null;
    this.renderer = null;
    this.hud = null;
  }

  /** Decodes both puppets' drawings (no beat timing depends on this) and hands them to the renderer. */
  private async loadPuppets(renderer: DuelRenderer): Promise<void> {
    const { app, setup } = this;
    const local = setup.localPlayer;
    const given = setup.puppets;
    let mine: PuppetImagesSource | null = given?.[local] ?? null;
    let theirs: PuppetImagesSource | null = given?.[local === 0 ? 1 : 0] ?? null;
    let chosenPreset = '';
    try {
      if (!mine) {
        const drawing = await loadSelectedPuppet(app.store);
        chosenPreset = drawing.presetId ?? '';
        mine = await decodeDrawing(drawing);
      }
    } catch {
      mine = null;
    }
    try {
      mine ??= await loadPresetImages(PRESETS[0] as (typeof PRESETS)[number]);
      const teal = PRESETS[0] as (typeof PRESETS)[number];
      const pink = PRESETS.find((p) => p.id === 'preset-pink') ?? (PRESETS[1] as (typeof PRESETS)[number]);
      if (!theirs) {
        theirs = await loadPresetImages(chosenPreset === pink.id ? teal : pink);
      } else if (setup.peerPuppetName === teal.name && chosenPreset === teal.id) {
        // Both players kept the default teal sock: show the friend's as the pink one. Display only; nothing is sent.
        theirs = await loadPresetImages(pink);
      }
    } catch {
      return;
    }
    if (this.disposed || this.renderer !== renderer) return;
    const both: [PuppetImagesSource, PuppetImagesSource] = local === 0 ? [mine, theirs] : [theirs, mine];
    renderer.setPuppets(both);
    // Once per match: the colour each player's marks wear.
    const colours = markColoursOf(both, local);
    renderer.setMarkColours(colours);
    this.hud?.setMarkColours(colours);
    // Kept on the setup so the victory screen stands the same puppets on the stage.
    setup.puppets = local === 0 ? [mine, theirs] : [theirs, mine];
  }

  private frame(info: FrameInfo): void {
    const session = this.session;
    if (!session || this.left) return;
    this.setup.tick?.();
    session.update();
    if (info.hidden || !this.renderer || !this.hud || this.session !== session) return;
    const dt = this.lastTimestamp > 0 ? Math.min(0.1, (info.timestamp - this.lastTimestamp) / 1000) : 0;
    this.lastTimestamp = info.timestamp;
    const view = session.view();
    this.renderer.draw(view, dt);
    this.hud.update(view);
  }

  private onEvent(e: SessionEvent, sfx: ReturnType<typeof createSfx>): void {
    const session = this.session;
    if (!session) return;
    this.app.recordEvent(e);
    if (e.type === 'judged') queueMicrotask(() => this.app.recordHealth());
    switch (e.type) {
      case 'planted':
        sfx.play('plant');
        if (e.player !== this.setup.localPlayer) this.renderer?.setOpponentFocus(e.strike);
        break;
      case 'judged': {
        sfx.play(e.grade === 'bravo' ? 'bravo' : e.grade === 'good' ? 'good' : 'miss');
        const strike = session.state.strikes[e.index];
        if (strike) {
          this.hud?.popGrade(e.grade, strike.x, strike.y);
          if (e.player !== this.setup.localPlayer) this.renderer?.setOpponentFocus(strike);
        }
        this.hud?.recordGrade(e.player === this.setup.localPlayer, e.grade);
        if (e.player === this.setup.localPlayer && e.offsetMs !== null)
          this.app.recordJudgedOffset(e.offsetMs);
        break;
      }
      case 'rejected':
        if (e.reason === 'stamina') this.hud?.note('Not enough stamina');
        break;
      case 'actOver':
        sfx.play('actOver');
        this.hud?.aside('act');
        break;
      case 'matchOver':
        this.over = true;
        void this.app.go(new VictoryScene(this.app, this.setup, session.state.actWins, e.winner, session));
        break;
      default:
        break;
    }
  }

  private onPeerLeft(): void {
    if (this.over || this.left) return;
    this.left = true;
    const notice = document.createElement('div');
    notice.className = 'toast';
    notice.dataset.testid = 'friend-left';
    notice.textContent = 'Your friend left';
    this.app.overlay.appendChild(notice);
    this.notice = notice;
    this.leaveTimer = window.setTimeout(() => {
      this.setup.leave?.();
      void this.app.go(new TitleScene(this.app));
    }, LEFT_NOTICE_MS);
  }
}
