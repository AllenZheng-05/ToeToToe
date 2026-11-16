import { clickLoopSeconds, createClickBuffer } from '../audio/click';
import type { App } from '../app/app';
import { clearRoomFromAddress } from '../app/address';
import type { Connection } from '../app/connection';
import type { Unsubscribe } from '../core/types';
import type { StartInfo } from '../net/room';
import type { MatchSetup } from './types';

const CLICK_LOOP_BEATS = 16;

/** Leave the room for good and put the address bar back to the title. */
export function leaveRoom(connection: Connection): void {
  connection.close();
  clearRoomFromAddress();
}

/**
 * A MatchSetup for two people. `info` comes from the room's `start` event (grid in this browser's clock).
 * Music for now is the generated click track at the grid's tempo, scheduled at the grid's start.
 * `dispose` stops the music but leaves the room open for a rematch.
 */
export function createRoomMatch(app: App, connection: Connection, info: StartInfo): MatchSetup {
  const { room, transport } = connection;
  const { engine } = app;
  const peerName = room.peerName ?? 'Player';
  const localName = connection.name;
  const names: [string, string] = room.localPlayer === 0 ? [localName, peerName] : [peerName, localName];

  const bpm = info.grid.bpm;
  const music = engine.playLoop(createClickBuffer(engine.context, bpm, CLICK_LOOP_BEATS), {
    startTime: info.grid.startTime,
    loopEnd: clickLoopSeconds({ bpm, beats: CLICK_LOOP_BEATS }),
  });

  let rematchState = { local: false, peer: false };
  const offRematch = room.on((e) => {
    if (e.type === 'rematch') rematchState = { local: e.local, peer: e.peer };
  });
  const pending: Unsubscribe[] = [];

  return {
    localPlayer: room.localPlayer,
    names,
    transport,
    grid: info.grid,
    firstAttacker: info.firstAttacker,
    firstPhrase: info.firstPhrase,
    online: true,
    dispose() {
      music.stop();
    },
    watchRematch(cb) {
      cb(rematchState);
      const off = room.on((e) => {
        if (e.type === 'rematch') cb({ local: e.local, peer: e.peer });
      });
      pending.push(off);
      return off;
    },
    rematch() {
      return new Promise((resolve) => {
        const off = room.on((e) => {
          if (e.type !== 'start') return;
          off();
          offRematch();
          resolve(createRoomMatch(app, connection, e.info));
        });
        pending.push(off);
        room.requestRematch();
      });
    },
    leave() {
      for (const off of pending.splice(0)) off();
      offRematch();
      leaveRoom(connection);
    },
  };
}
