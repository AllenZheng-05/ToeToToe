import type { App } from '../app/app';
import { clearRoomFromAddress } from '../app/address';
import type { Connection } from '../app/connection';
import { phraseStart } from '../core/beat';
import type { DuelSession } from '../core/session';
import type { BeatGrid, DuelState, Tunables, Unsubscribe } from '../core/types';
import { CLICK_TRACK } from '../data/tracks';
import type { StartInfo } from '../net/room';
import { loadTheme, playTheme } from '../theme/theme';
import type { MatchSetup } from './types';

/** How far from either end of the break between acts a grid shift must stay clear, on top of its own size (seconds). */
const GRID_SHIFT_MARGIN_SEC = 0.15;

/**
 * Whether the grid may be moved by `shiftSec` right now without anyone seeing it: only in the break between
 * two acts (after the last act's final phrase, before the next act's first one has begun, with an unplanted
 * attack phrase waiting), and with room to spare on both sides for the shift itself, so no phrase boundary
 * crosses `now`. Pure.
 */
export function gridShiftIsSafe(a: {
  state: DuelState;
  grid: BeatGrid;
  tunables: Tunables;
  now: number;
  shiftSec: number;
}): boolean {
  const { state, grid, tunables, now, shiftSec } = a;
  if (state.phase !== 'attack' || state.lastActEndPhrase === null) return false;
  if (state.phrase !== state.actFirstPhrase || state.strikes.length > 0) return false;
  const margin = Math.abs(shiftSec) + GRID_SHIFT_MARGIN_SEC;
  const ended = phraseStart(grid, state.lastActEndPhrase + 1, tunables);
  const next = phraseStart(grid, state.actFirstPhrase, tunables);
  return now - ended >= margin && next - now >= margin;
}

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
  let music = (async () => playTheme(await theme, engine, info.grid.startTime))();
  let session: DuelSession | null = null;
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
    attach(s) {
      session = s;
      // How early or late the friend's plants, commits and resolves arrive: read from the debug overlay.
      s.onArrival = (kind, lateSec) => room.arrivals.record(kind, lateSec, engine.clock.now());
    },
    // The guest follows the clock estimate between acts: its grid is moved (the host's never is), and the music
    // with it, so what it hears stays on its own beat. Never mid-act.
    tick() {
      if (session === null || room.role !== 'guest') return;
      const shiftSec = room.pendingGridShiftSec();
      if (shiftSec === null) return;
      const safe = gridShiftIsSafe({
        state: session.state,
        grid: info.grid,
        tunables: app.tunables,
        now: engine.clock.now(),
        shiftSec,
      });
      if (!safe) return;
      info.grid.startTime += shiftSec;
      room.acceptGridShift();
      const before = music;
      music = (async () => {
        (await before).stop();
        return playTheme(await theme, engine, info.grid.startTime);
      })();
    },
    dispose() {
      session = null;
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
