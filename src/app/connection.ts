import { createBroadcastLink } from '../net/broadcastLink';
import { netConfigFromEnv } from '../net/netConfig';
import { createPairingTransport } from '../net/pairing';
import { Room } from '../net/room';
import { createTrysteroLink } from '../net/trysteroLink';
import type { RawLink, ThemeOffer, Transport } from '../core/types';
import type { App } from './app';

/** Everything one room needs while it is open: the link, the two-player transport and the Room. */
export interface Connection {
  readonly code: string;
  readonly role: 'host' | 'guest';
  /** The local display name. */
  readonly name: string;
  readonly link: RawLink;
  readonly transport: Transport;
  readonly room: Room;
  /** Sends `leave`, closes the transport (which leaves the link), and detaches the connection from the app. Safe to repeat. */
  close(): void;
}

/** The host's offer: the generated click track at the tempo from `?bpm=` (default 120). */
export function clickThemeOffer(bpm: number | null): ThemeOffer {
  return { source: 'click', id: 'click', title: 'Click track', bpm: bpm ?? 120, firstBeatOffset: 0 };
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
  const link =
    app.params.net === 'tab'
      ? createBroadcastLink(code)
      : await createTrysteroLink(code, netConfigFromEnv(import.meta.env));
  let transport: Transport;
  let room: Room;
  try {
    transport = createPairingTransport({ link, role });
    room = new Room({ transport, clock: app.engine.clock, name, tunables: app.tunables });
  } catch (err) {
    link.leave();
    throw err;
  }
  if (role === 'host') room.setTheme(clickThemeOffer(app.params.bpm));

  let closed = false;
  const connection: Connection = {
    code,
    role,
    name,
    link,
    transport,
    room,
    close() {
      if (closed) return;
      closed = true;
      room.leave();
      transport.close();
      if (app.connection === connection) app.connection = null;
    },
  };
  app.connection = connection;
  return connection;
}
