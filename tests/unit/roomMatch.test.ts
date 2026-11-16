import { describe, expect, it } from 'vitest';
import type { App } from '../../src/app/app';
import type { Connection } from '../../src/app/connection';
import { createTunables } from '../../src/core/tunables';
import { createMemoryHub } from '../../src/net/memoryHub';
import { createPairingTransport } from '../../src/net/pairing';
import { Room, type RoomEvent, type StartInfo } from '../../src/net/room';
import { createRoomMatch } from '../../src/scenes/roomMatch';
import type { MatchSetup } from '../../src/scenes/types';
import { FakeClock } from '../helpers/fakeClock';

/** A host and a guest room, each with a room match from a first start, and a count of live room listeners. */
function setup() {
  const hub = createMemoryHub();
  const clock = new FakeClock(0);
  const make = (role: 'host' | 'guest') => {
    const transport = createPairingTransport({ link: hub.join(), role });
    const room = new Room({
      transport,
      clock,
      name: role,
      tunables: createTunables(),
      defer: () => undefined,
    });
    let live = 0;
    const on = room.on.bind(room);
    room.on = (cb: (e: RoomEvent) => void) => {
      live++;
      const off = on(cb);
      let gone = false;
      return () => {
        if (!gone) live--;
        gone = true;
        off();
      };
    };
    const starts: StartInfo[] = [];
    on((e) => {
      if (e.type === 'start') starts.push(e.info);
    });
    const connection = {
      room,
      transport,
      name: role,
      exchange: { theme: { info: { bpm: 120 }, buffer: {} }, view: { peerPuppet: null } },
    } as unknown as Connection;
    return { room, connection, starts, liveListeners: () => live };
  };
  const host = make('host');
  const guest = make('guest');
  const app = {
    engine: { playLoop: () => ({ stop: () => undefined }) },
    store: {},
    tunables: createTunables(),
  } as unknown as App;
  const info: StartInfo = { grid: { bpm: 120, startTime: 5 }, firstAttacker: 0, firstPhrase: 1 };
  return {
    host,
    guest,
    app,
    hostMatch: createRoomMatch(app, host.connection, info),
    guestMatch: createRoomMatch(app, guest.connection, info),
  };
}

const rematch = (m: MatchSetup): Promise<MatchSetup> => {
  if (!m.rematch) throw new Error('no rematch');
  return m.rematch();
};

describe('a room match rematch', () => {
  it('asking twice adds one listener for the start, not two', () => {
    const { host, hostMatch } = setup();
    const base = host.liveListeners();
    const first = rematch(hostMatch);
    const second = rematch(hostMatch);
    expect(second).toBe(first);
    expect(host.liveListeners()).toBe(base + 1);
  });

  it('cancelling removes every listener it had and tells the friend', () => {
    const { host, guest, hostMatch } = setup();
    expect(host.liveListeners()).toBe(1); // the one that tracks the rematch state
    void rematch(hostMatch);
    hostMatch.watchRematch?.(() => undefined);
    expect(host.liveListeners()).toBe(3);
    const heard: RoomEvent[] = [];
    guest.room.on((e) => heard.push(e));
    hostMatch.cancelRematch?.();
    expect(host.liveListeners()).toBe(0);
    expect(heard.some((e) => e.type === 'rematch' && !e.peer && e.peerBack)).toBe(true);
  });

  it('both ask: both get the next match, once', async () => {
    const { host, guest, hostMatch, guestMatch } = setup();
    const a = rematch(hostMatch);
    const b = rematch(guestMatch);
    const [next, nextGuest] = await Promise.all([a, b]);
    expect(host.starts).toHaveLength(1);
    expect(guest.starts).toHaveLength(1);
    expect(next.localPlayer).toBe(0);
    expect(nextGuest.localPlayer).toBe(1);
    expect(host.liveListeners()).toBe(1); // only the next match's own tracker is left
  });

  it('a withdrawn request is not answered by a late one: nothing starts', async () => {
    const { host, guest, hostMatch, guestMatch } = setup();
    void rematch(hostMatch);
    hostMatch.cancelRematch?.(); // back to the room
    void rematch(guestMatch); // the friend, still on the victory screen
    await Promise.resolve();
    expect(host.starts).toHaveLength(0);
    expect(guest.starts).toHaveLength(0);
  });

  it('can ask again after cancelling, with one new listener', async () => {
    const { host, guest, hostMatch, guestMatch } = setup();
    void rematch(hostMatch);
    hostMatch.cancelRematch?.();
    const again = rematch(hostMatch);
    expect(host.liveListeners()).toBe(1);
    void rematch(guestMatch);
    await again;
    expect(host.starts).toHaveLength(1);
    expect(guest.starts).toHaveLength(1);
  });
});
