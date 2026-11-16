import 'pixi.js/unsafe-eval';
import './style.css';
import './ui/kit/kit.css';
import { App } from './app/app';
import { unlockAudioOnFirstTap } from './app/audioGate';
import { parseParams } from './app/params';
import { createDebugOverlay } from './debug/overlay';
import { TitleScene } from './scenes/title';
import { fontsReady } from './ui/kit/fonts';

async function main(): Promise<void> {
  const host = document.querySelector<HTMLDivElement>('#app');
  if (!host) throw new Error('Missing #app element');
  // A plain note on the cutting mat until the fonts and the theatre's textures are ready.
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.dataset.testid = 'loading';
  loading.textContent = 'Loading…';
  host.appendChild(loading);

  const params = parseParams(window.location.href);
  await fontsReady();
  const app = await App.create(host, params);
  unlockAudioOnFirstTap(app);
  if (params.debug) createDebugOverlay(app);
  loading.remove();
  await app.go(new TitleScene(app));
}

void main();
