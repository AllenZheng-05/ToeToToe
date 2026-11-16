import { Application, Container } from 'pixi.js';
import { DESIGN_H, DESIGN_W, fitStage, type StageFit } from './layout';

/** Cutting-mat green, also the page background. */
export const MAT_GREEN = 0x2f6b52;

/**
 * The Pixi application, a root container scaled to the window, and a DOM overlay
 * that is transformed identically so DOM elements can be placed in 1280x720 design pixels.
 */
export class Stage {
  readonly app: Application;
  /** Element that receives pointer input (the page host). */
  readonly host: HTMLElement;
  /** Everything drawn by Pixi lives under this container, in design pixels. */
  readonly root = new Container();
  /** DOM overlay, 1280x720 design pixels, scaled and offset like `root`. */
  readonly overlay: HTMLDivElement;
  private currentFit: StageFit = { scale: 1, offsetX: 0, offsetY: 0 };
  private readonly onResize = (): void => this.resize();

  private constructor(app: Application, host: HTMLElement, overlay: HTMLDivElement) {
    this.app = app;
    this.host = host;
    this.overlay = overlay;
  }

  static async create(host: HTMLElement): Promise<Stage> {
    const app = new Application();
    await app.init({
      width: window.innerWidth,
      height: window.innerHeight,
      background: MAT_GREEN,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    // We render by hand from our own frame loop.
    app.ticker.stop();
    app.canvas.classList.add('stage-canvas');
    host.appendChild(app.canvas);

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.style.width = `${DESIGN_W}px`;
    overlay.style.height = `${DESIGN_H}px`;
    host.appendChild(overlay);

    const stage = new Stage(app, host, overlay);
    app.stage.addChild(stage.root);
    window.addEventListener('resize', stage.onResize);
    stage.resize();
    return stage;
  }

  get fit(): StageFit {
    return this.currentFit;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.app.renderer.resize(w, h);
    const f = fitStage(w, h);
    this.currentFit = f;
    this.root.scale.set(f.scale);
    this.root.position.set(f.offsetX, f.offsetY);
    this.overlay.style.transform = `translate(${f.offsetX}px, ${f.offsetY}px) scale(${f.scale})`;
  }

  render(): void {
    this.app.render();
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.app.destroy(true);
    this.overlay.remove();
  }
}
