import { createBroadcastLink } from '../net/broadcastLink';
import { netConfigFromEnv } from '../net/netConfig';
import { createPairingTransport } from '../net/pairing';
import { Room } from '../net/room';
import { createTrysteroLink } from '../net/trysteroLink';
import type { RawLink, Transport } from '../core/types';
import { foldBpm } from '../core/beat';
import { CLICK_TRACK } from '../data/tracks';
import type { PartKind } from '../puppet/parts';
import { PARTS } from '../puppet/parts';
import { PRESETS } from '../puppet/presets';
import { Exchange } from '../scenes/exchange';
import { loadPresetImages, type PuppetImages } from '../stage/art/puppetView';
import { loadOfferedSong, loadSelectedTheme, loadTheme, type LoadedTheme } from '../theme/theme';
import { loadSelectedPuppet } from '../workshop/selection';
import type { App } from './app';

/** Everything one room needs while it is open: the link, the two-player transport, the Room and the drawings and songs exchange. */
export interface Connection {
  readonly code: string;
  readonly role: 'host' | 'guest';
  /** The local display name. */
  readonly name: string;
  readonly link: RawLink;
  readonly transport: Transport;
  readonly room: Room;
  readonly exchange: Exchange;
  /** Sends `leave`, closes the transport (which leaves the link), and detaches the connection from the app. Safe to repeat. */
  close(): void;
}

/**
 * The theme the host starts a room with: the generated click track at the tempo from `?bpm=` when that
 * is given (a test hook), otherwise the theme chosen on the battle theme screen.
 */
export async function initialTheme(app: App): Promise<LoadedTheme> {
  const deps = { store: app.store, engine: app.engine, tunables: app.tunables };
  if (app.params.bpm !== null) {
    return loadTheme(
      { ...CLICK_TRACK, id: 'click', title: 'Click track', bpm: foldBpm(app.params.bpm, app.tunables) },
      deps,
    );
  }
  return loadSelectedTheme(deps);
}

const fallbackImages = new Map<PartKind, Promise<PuppetImages>>();

/** A part of the pink preset, rasterised once, for where the friend's own part could not be used. */
function fallbackPart(kind: PartKind): Promise<CanvasImageSource> {
  const preset = PRESETS.find((p) => p.id === 'preset-pink') ?? PRESETS[1] ?? PRESETS[0];
  if (!preset) return Promise.reject(new Error('no preset'));
  let all = fallbackImages.get(kind);
  if (!all) {
    all = loadPresetImages(preset);
    for (const k of ['head', 'sock', 'sword'] as const) fallbackImages.set(k, all);
  }
  return all.then((images) => images[kind]);
}

/** Decode PNG bytes from the friend with the browser's own decoder, drawn at the part's size. */
async function decodePart(data: ArrayBuffer, kind: PartKind): Promise<CanvasImageSource> {
  const { width, height } = PARTS[kind];
  const bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' }));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/**
 * Joins the room `code`. `?net=tab` uses BroadcastChannel (two tabs of one browser, for tests);
 * otherwise WebRTC through Trystero. Rejects if the link cannot be created.
 * Call after the audio engine has been resumed, so the clock exists.
 */
export async function openConnection(
  app: App,
  code: string,
  role: 'host' | 'guest',
  name: string,
): Promise<Connection> {
  const theme = role === 'host' ? await initialTheme(app) : null;
  const link =
    app.params.net === 'tab'
      ? createBroadcastLink(code)
      : await createTrysteroLink(code, netConfigFromEnv(import.meta.env));
  let transport: Transport;
  let room: Room;
  let exchange: Exchange;
  try {
    transport = createPairingTransport({ link, role });
    room = new Room({
      transport,
      clock: app.engine.clock,
      name,
      tunables: app.tunables,
      isClockRunning: () => app.engine.running,
    });
    const deps = { store: app.store, engine: app.engine, tunables: app.tunables };
    exchange = new Exchange({
      transport,
      room,
      role,
      tunables: app.tunables,
      getPuppet: async () => {
        const p = await loadSelectedPuppet(app.store);
        const [head, sock, sword] = await Promise.all([
          p.head.arrayBuffer(),
          p.sock.arrayBuffer(),
          p.sword.arrayBuffer(),
        ]);
        return { name: p.name, head, sock, sword };
      },
      decodePart,
      fallbackPart,
      loadTheme: (info) => loadTheme(info, deps),
      loadSong: (offer, data) => loadOfferedSong(offer, data, deps),
    });
  } catch (err) {
    link.leave();
    throw err;
  }
  // A rematch starts only when the friend has loaded the battle theme and nothing is still arriving;
  // when that becomes true the host looks at a waiting rematch again.
  room.setStartGate(() => exchange.view.canStart && !exchange.busy);
  exchange.onChange(() => room.retryRematch());
  if (theme) exchange.offerTheme(theme);

  let closed = false;
  const connection: Connection = {
    code,
    role,
    name,
    link,
    transport,
    room,
    exchange,
    close() {
      if (closed) return;
      closed = true;
      exchange.dispose();
      room.leave();
      transport.close();
      if (app.connection === connection) app.connection = null;
    },
  };
  app.connection = connection;
  return connection;
}
