import { openStore } from '../src/data/store';
import { fontsReady } from '../src/ui/kit/fonts';
import { createWorkshop } from '../src/workshop/workshop';

async function main(): Promise<void> {
  await fontsReady();
  const store = await openStore();
  const app = document.getElementById('app') as HTMLElement;
  const workshop = createWorkshop({
    store,
    onDone: (d) => console.info('workshop done', d.id, d.name, d.head.size, d.sock.size, d.sword.size),
    onChange: (d) => console.info('workshop change', d.id, d.name),
  });
  app.appendChild(workshop.root);
  (window as unknown as { __workshop: unknown }).__workshop = workshop;
}

void main();
