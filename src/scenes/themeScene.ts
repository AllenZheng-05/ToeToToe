import type { App } from '../app/app';
import { createThemePicker } from '../theme/picker';
import type { LoadedTheme } from '../theme/theme';
import type { Scene } from './types';

export interface ThemeSceneOptions {
  /** The scene to return to when the host is done. */
  back(): Scene;
  /** Called with the chosen theme just before returning (the lobby offers it to the friend). */
  onChosen(theme: LoadedTheme): void;
}

/** The battle theme screen as a scene (the host only). It fills the screen; the stage is not redrawn while it is up. */
export class ThemeScene implements Scene {
  private host: HTMLElement | null = null;
  private picker: { destroy(): void } | null = null;

  constructor(
    private readonly app: App,
    private readonly opts: ThemeSceneOptions,
  ) {}

  enter(): void {
    const { app, opts } = this;
    app.rendering = false;
    const host = document.createElement('div');
    host.className = 'scene full-scene';
    host.dataset.testid = 'theme-scene';
    const picker = createThemePicker({
      store: app.store,
      engine: app.engine,
      tunables: app.tunables,
      onDone: (theme) => {
        opts.onChosen(theme);
        void app.go(opts.back());
      },
      onBack: () => void app.go(opts.back()),
    });
    host.appendChild(picker.root);
    app.overlay.appendChild(host);
    this.host = host;
    this.picker = picker;
  }

  exit(): void {
    this.picker?.destroy();
    this.picker = null;
    this.host?.remove();
    this.host = null;
    this.app.rendering = true;
  }
}
