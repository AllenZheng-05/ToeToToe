import 'pixi.js/unsafe-eval';
import { Application, Container } from 'pixi.js';
import { DESIGN_H, DESIGN_W, fitStage, type StageFit } from './layout';
import { createMarkTextures, loadMarkFonts, type MarkTextures } from './art/marks';
import {
  createTheatre,
  destroyTheatreTextures,
  loadTheatreTextures,
  SUN_DUEL,
  SUN_MENU,
  type SunPlacement,
  type TheatreTextures,
} from './art/theatre';

/** Cutting-mat green, also the page background. */
export const MAT_GREEN = 0x2f6b52;

/** Which arrangement of the theatre a scene wants: the sign and a low-right sun, or an open duel stage. */
export type StageLook = 'menu' | 'duel';

type Theatre = ReturnType<typeof createTheatre>;

/**
 * The Pixi application, the theatre behind every scene, and a DOM overlay that is transformed
 * identically so DOM elements can be placed in 1280x720 design pixels.
 * Layer order: theatre `back`, `middle` (puppets), `front`, then `marks`, then the DOM overlay.
 */
export class Stage {
  readonly app: Application;
  /** Element that receives pointer input (the page host). */
  readonly host: HTMLElement;
  /** Everything drawn by Pixi lives under this container, in design pixels. */
  readonly root = new Container();
  /** DOM overlay, 1280x720 design pixels, scaled and offset like `root`. */
  readonly overlay: HTMLDivElement;
  readonly theatre: Theatre;
  /** Puppets go here (between the theatre's back and front layers). */
  readonly puppets: Container;
  /** Strike discs and targets go here, above the curtains. */
  readonly marks = new Container();
  /** Baked once and shared by every duel's MarksView. */
  readonly markTextures: MarkTextures;
  private readonly theatreTextures: TheatreTextures;
  private currentFit: StageFit = { scale: 1, offsetX: 0, offsetY: 0 };
  private cacheResolution = 0;
  private readonly onResize = (): void => this.resize();

  private constructor(
    app: Application,
    host: HTMLElement,
    overlay: HTMLDivElement,
    textures: TheatreTextures,
    markTextures: MarkTextures,
  ) {
    this.app = app;
    this.host = host;
    this.overlay = overlay;
    this.theatreTextures = textures;
    this.markTextures = markTextures;
    this.theatre = createTheatre(textures, { sign: true, sun: SUN_MENU });
    this.puppets = this.theatre.middle;
    this.root.addChild(this.theatre.back, this.theatre.middle, this.theatre.front, this.marks);
  }

  /** Call after the display fonts are loaded so the baked numerals use them. */
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

    await loadMarkFonts();
    const textures = await loadTheatreTextures();
    const markTextures = createMarkTextures();

    host.appendChild(app.canvas);
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.style.width = `${DESIGN_W}px`;
    overlay.style.height = `${DESIGN_H}px`;
    host.appendChild(overlay);

    const stage = new Stage(app, host, overlay, textures, markTextures);
    app.stage.addChild(stage.root);
    window.addEventListener('resize', stage.onResize);
    stage.resize();
    return stage;
  }

  get fit(): StageFit {
    return this.currentFit;
  }

  /** Pixels drawn per design-scaled CSS pixel (the device pixel ratio unless lowered). */
  get resolution(): number {
    return this.app.renderer.resolution;
  }

  /** Draw at a lower resolution (the canvas keeps its size on the page). */
  setResolution(resolution: number): void {
    this.app.renderer.resolution = resolution;
    this.resize();
  }

  /** Show or hide the hanging sign (menus only). */
  setSign(visible: boolean): void {
    this.theatre.setSign(visible);
    this.refreshBackdrop();
  }

  setSun(sun: SunPlacement): void {
    this.theatre.setSun(sun);
    this.refreshBackdrop();
  }

  /** The sign and sun of a menu screen, or the open duel stage. */
  setLook(look: StageLook): void {
    this.theatre.setSign(look === 'menu');
    this.theatre.setSun(look === 'menu' ? SUN_MENU : SUN_DUEL);
    this.refreshBackdrop();
  }

  /**
   * The theatre behind and in front of the puppets never moves, so each is drawn once into a texture
   * and blitted every frame (several full-screen layers become one; it matters on software renderers).
   */
  private refreshBackdrop(): void {
    if (this.cacheResolution > 0) this.theatre.back.updateCacheTexture();
  }

  private cacheBackdrop(): void {
    const res = Math.min(2, Math.max(1, Math.ceil(this.currentFit.scale * (window.devicePixelRatio || 1))));
    if (res === this.cacheResolution) return;
    this.cacheResolution = res;
    this.theatre.back.cacheAsTexture({ resolution: res });
    this.theatre.front.cacheAsTexture({ resolution: res });
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
    this.cacheBackdrop();
  }

  render(): void {
    this.app.render();
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.theatre.destroy();
    destroyTheatreTextures(this.theatreTextures);
    this.markTextures.destroy();
    this.app.destroy(true);
    this.overlay.remove();
  }
}
