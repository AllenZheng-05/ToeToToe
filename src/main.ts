import './style.css';
import { App } from './app/app';
import { parseParams } from './app/params';
import { createDebugOverlay } from './debug/overlay';
import { TitleScene } from './scenes/title';

async function main(): Promise<void> {
  const host = document.querySelector<HTMLDivElement>('#app');
  if (!host) throw new Error('Missing #app element');
  const params = parseParams(window.location.href);
  const app = await App.create(host, params);
  if (params.debug) createDebugOverlay(app);
  await app.go(new TitleScene(app));
}

void main();
