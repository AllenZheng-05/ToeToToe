import type { App } from '../app/app';
import { createWorkshop } from '../workshop/workshop';
import type { Scene } from './types';

export interface WorkshopSceneOptions {
  /** The scene to return to when the player is done. */
  back(): Scene;
  /** Called after Done, once the puppet is saved and selected (the lobby sends it to the friend again). */
  onSaved?(): void;
}

/** The puppet workshop as a scene. It fills the screen; the stage is not redrawn while it is up. */
export class WorkshopScene implements Scene {
  private host: HTMLElement | null = null;
  private workshop: { destroy(): void } | null = null;

  constructor(
    private readonly app: App,
    private readonly opts: WorkshopSceneOptions,
  ) {}

  enter(): void {
    const { app, opts } = this;
    app.rendering = false;
    const host = document.createElement('div');
    host.className = 'scene full-scene';
    host.dataset.testid = 'workshop-scene';
    const workshop = createWorkshop({
      store: app.store,
      onDone: () => {
        opts.onSaved?.();
        // Saved puppets go to the account in the background, when the player is signed in.
        void app.account.then((account) => account.sync());
        void app.go(opts.back());
      },
    });
    host.appendChild(workshop.root);
    app.overlay.appendChild(host);
    this.host = host;
    this.workshop = workshop;
  }

  exit(): void {
    this.workshop?.destroy();
    this.workshop = null;
    this.host?.remove();
    this.host = null;
    this.app.rendering = true;
  }
}
