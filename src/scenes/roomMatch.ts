import type { App } from '../app/app';
import { clearRoomFromAddress } from '../app/address';
import type { Connection } from '../app/connection';
import type { Unsubscribe } from '../core/types';
import { CLICK_TRACK } from '../data/tracks';
import type { StartInfo } from '../net/room';
import { loadTheme, playTheme } from '../theme/theme';
import type { MatchSetup } from './types';

/** Leave the room for good and put the address bar back to the title. */
export function leaveRoom(connection: Connection): void {
  connection.close();
  clearRoomFromAddress();
}

/**
 * A MatchSetup for two people. `info` comes from the room's `start` event (grid in this browser's clock).
 * Music is this player's own loaded copy of the room's battle theme (the host's pick, fetched or loaded
 * by the guest before it could be ready), scheduled at the grid's start; the generated click track at the
 * grid's tempo if somehow none is loaded. The friend's puppet is the one their drawings made.
 * `dispose` stops the music but leaves the room open for a rematch.
 */
export function createRoomMatch(app: App, connection: Connection, info: StartInfo): MatchSetup {
  const { room, transport } = connection;
  const { engine } = app;
  const peerName = room.peerName ?? 'Player';
  const localName = connection.name;
  const names: [string, string] = room.localPlayer === 0 ? [localName, peerName] : [peerName, localName];

  const theme =
    connection.exchange.theme ??
    loadTheme(
      { ...CLICK_TRACK, id: 'click', title: 'Click track', bpm: info.grid.bpm },
      { store: app.store, engine, tunables: app.tunables },
    );
  const music = (async () => playTheme(await theme, engine, info.grid.startTime))();
  const peerImages = connection.exchange.view.peerPuppet?.images ?? null;
  const peerPuppetName = connection.exchange.view.peerPuppet?.name ?? null;

  let rematchState: { local: boolean; peer: boolean; peerBack: boolean } = {
    local: false,
    peer: false,
    peerBack: false,
  };
  const offRematch = room.on((e) => {
    if (e.type === 'rematch') rematchState = { local: e.local, peer: e.peer, peerBack: e.peerBack };
  });
  const pending: Unsubscribe[] = [];
  /** The one rematch in progress: asking again returns it instead of adding a second `start` listener. */
  let rematching: Promise<MatchSetup> | null = null;
  let offStart: Unsubscribe | null = null;

  return {
    localPlayer: room.localPlayer,
    names,
    transport,
    grid: info.grid,
    firstAttacker: info.firstAttacker,
    firstPhrase: info.firstPhrase,
    online: true,
    peerPuppetName,
    puppets: room.localPlayer === 0 ? [null, peerImages] : [peerImages, null],
    dispose() {
      void music.then((m) => m.stop());
    },
    watchRematch(cb) {
      cb(rematchState);
      const off = room.on((e) => {
        if (e.type === 'rematch') cb({ local: e.local, peer: e.peer, peerBack: e.peerBack });
      });
      pending.push(off);
      return off;
    },
    rematch() {
      if (rematching) return rematching;
      rematching = new Promise((resolve) => {
        const off = room.on((e) => {
          if (e.type !== 'start') return;
          off();
          offStart = null;
          offRematch();
          resolve(createRoomMatch(app, connection, e.info));
        });
        offStart = off;
        pending.push(off);
        room.requestRematch();
      });
      return rematching;
    },
    cancelRematch() {
      offStart?.();
      offStart = null;
      rematching = null;
      for (const off of pending.splice(0)) off();
      offRematch();
      room.cancelRematch();
    },
    leave() {
      for (const off of pending.splice(0)) off();
      offRematch();
      leaveRoom(connection);
    },
  };
}
