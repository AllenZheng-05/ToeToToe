import { AudioEngine } from '../src/audio/engine';
import { createTunables } from '../src/core/tunables';
import { openStore } from '../src/data/store';
import { createThemePicker } from '../src/theme/picker';
import { fontsReady } from '../src/ui/kit/fonts';

async function main(): Promise<void> {
  await fontsReady();
  const store = await openStore();
  const engine = new AudioEngine();
  window.addEventListener('pointerdown', () => void engine.resume(), { capture: true });
  const picker = createThemePicker({
    store,
    engine,
    tunables: createTunables(),
    onDone: (theme) => {
      document.title = `Done: ${theme.info.title} ${theme.info.bpm} BPM`;
      (window as unknown as { __done?: unknown }).__done = {
        id: theme.info.id,
        bpm: theme.info.bpm,
        firstBeatOffset: theme.info.firstBeatOffset,
        loopStart: theme.loopStart,
        loopEnd: theme.loopEnd,
        file: theme.file ? theme.file.data.byteLength : null,
      };
    },
  });
  (document.getElementById('app') as HTMLElement).appendChild(picker.root);
}

void main();
