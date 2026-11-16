import type { App, FrameInfo } from '../app/app';
import { createSfx } from '../audio/sfx';
import { DuelSession, type SessionEvent } from '../core/session';
import type { Unsubscribe } from '../core/types';
import { attachPointerInput } from '../input/pointer';
import { DuelRenderer } from '../stage/duelRenderer';
import { playRectOnScreen, playToDesign } from '../stage/layout';
import { Hud } from '../ui/hud';
import { TitleScene } from './title';
import type { MatchSetup, Scene } from './types';
import { VictoryScene } from './victory';

/** How long "Your friend left" stays up before returning to the title (UI only, not on the beat). */
const LEFT_NOTICE_MS = 2200;

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
      inputOffsetMs: 0,
    });
    this.session = session;
    app.session = session;
    app.match = setup;
    app.judgedOffsets.length = 0;
    setup.attach?.(session);

    const renderer = new DuelRenderer(app.stage.root, app.tunables, setup.grid.bpm);
    const hud = new Hud(app.overlay, app.tunables, setup.names);
    this.renderer = renderer;
    this.hud = hud;

    this.cleanups.push(
      session.on((e) => this.onEvent(e, sfx)),
      attachPointerInput({
        element: app.stage.host,
        clock: engine.clock,
        getPlayRect: () => playRectOnScreen(app.stage.fit),
        onMove: (s) => {
          const p = playToDesign(s.x, s.y);
          renderer.setPointer(p);
        },
        onDown: (c) => {
          if (c.inside) session.pointerDown(c.x, c.y, c.time, c.touch);
        },
      }),
      setup.transport.onState((state) => {
        if (state === 'closed') this.onPeerLeft();
      }),
      app.onFrame((info) => this.frame(info)),
    );
  }

  exit(): void {
    // Unsubscribe first: disposing the opponent closes the transport.
    for (const off of this.cleanups.splice(0)) off();
    if (this.leaveTimer !== null) window.clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
    this.notice?.remove();
    this.notice = null;
    this.session?.dispose();
    this.renderer?.destroy();
    this.hud?.destroy();
    this.setup.dispose?.();
    if (this.app.session === this.session) this.app.session = null;
    if (this.app.match === this.setup) this.app.match = null;
    this.session = null;
    this.renderer = null;
    this.hud = null;
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
        if (e.player === this.setup.localPlayer && e.offsetMs !== null)
          this.app.recordJudgedOffset(e.offsetMs);
        break;
      }
      case 'rejected':
        if (e.reason === 'stamina') this.hud?.note('Not enough stamina');
        break;
      case 'actOver':
        sfx.play('actOver');
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
      void this.app.go(new TitleScene(this.app));
    }, LEFT_NOTICE_MS);
  }
}
