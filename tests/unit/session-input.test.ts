import { describe, expect, it } from 'vitest';
import { DuelSession, type SessionEvent } from '../../src/core/session';
import { createTunables } from '../../src/core/tunables';
import type { BeatGrid, DuelState, Message } from '../../src/core/types';
import { createLoopbackPair } from '../../src/net/loopback';
import { createMemoryHub } from '../../src/net/memoryHub';
import { createPairingTransport } from '../../src/net/pairing';
import { FakeClock } from '../helpers/fakeClock';

const grid: BeatGrid = { bpm: 120, startTime: 0 };
const FIRST = 1;

/** A guest session with the host's transport free to send it anything. */
function guestRig() {
  const clock = new FakeClock(0);
  const tun = createTunables();
  const pair = createLoopbackPair();
  const session = new DuelSession({
    localPlayer: 1,
    clock,
    grid,
    transport: pair.guest,
    tunables: tun,
    firstAttacker: 0,
    firstPhrase: FIRST,
  });
  const events: SessionEvent[] = [];
  session.on((e) => events.push(e));
  const send = (m: unknown) => pair.host.send(m as Message);
  const desyncs = () => events.filter((e) => e.type === 'desync').length;
  return { session, send, events, desyncs, tun };
}

const plant = (slot: number) => ({ t: 'plant', phrase: FIRST, strike: { slot, x: 0.4, y: 0.6 } });

describe('plant from the other player', () => {
  it('ignores a missing or malformed strike without throwing', () => {
    const r = guestRig();
    const before = r.session.state;
    for (const strike of [
      null,
      undefined,
      5,
      'x',
      [],
      {},
      { slot: 'a', x: 0, y: 0 },
      { slot: 1, x: 9, y: 0 },
    ]) {
      expect(() => r.send({ t: 'plant', phrase: FIRST, strike })).not.toThrow();
    }
    expect(r.session.state.strikes).toEqual([]);
    expect(r.session.state).toEqual(before);
    r.send(plant(2));
    expect(r.session.state.strikes).toHaveLength(1);
  });
});

describe('commit from the other player', () => {
  it('keeps the strikes already planted when the commit has a slot out of range', () => {
    const r = guestRig();
    r.send(plant(1));
    r.send({ t: 'commit', phrase: FIRST, strikes: [{ slot: 99, x: 0.4, y: 0.6 }] });
    expect(r.session.state.phase).toBe('defend');
    expect(r.session.state.strikes).toEqual([{ slot: 1, x: 0.4, y: 0.6 }]);
    expect(r.desyncs()).toBe(1);
  });

  it('keeps them when a position is outside 0..1', () => {
    const r = guestRig();
    r.send(plant(1));
    r.send({ t: 'commit', phrase: FIRST, strikes: [{ slot: 1, x: 3, y: 0.6 }] });
    expect(r.session.state.strikes).toEqual([{ slot: 1, x: 0.4, y: 0.6 }]);
    expect(r.desyncs()).toBe(1);
  });

  it('keeps them when two strikes share a slot', () => {
    const r = guestRig();
    r.send(plant(1));
    r.send({
      t: 'commit',
      phrase: FIRST,
      strikes: [
        { slot: 1, x: 0.4, y: 0.6 },
        { slot: 1, x: 0.1, y: 0.1 },
      ],
    });
    expect(r.session.state.strikes).toHaveLength(1);
    expect(r.desyncs()).toBe(1);
  });

  it('keeps them when there are more strikes than the phrase holds', () => {
    const r = guestRig();
    r.send(plant(1));
    const many = Array.from({ length: 9 }, (_, i) => ({ slot: i % 8, x: 0.1, y: 0.1 }));
    r.send({ t: 'commit', phrase: FIRST, strikes: many });
    expect(r.session.state.strikes).toEqual([{ slot: 1, x: 0.4, y: 0.6 }]);
    expect(r.desyncs()).toBe(1);
  });

  it('keeps them when the strikes are not a list', () => {
    const r = guestRig();
    r.send(plant(1));
    r.send({ t: 'commit', phrase: FIRST, strikes: null });
    expect(r.session.state.strikes).toHaveLength(1);
    expect(r.desyncs()).toBe(1);
  });

  it('adopts a valid commit that differs, sorted and rebuilt', () => {
    const r = guestRig();
    r.send(plant(1));
    r.send({
      t: 'commit',
      phrase: FIRST,
      strikes: [
        { slot: 4, x: 0.2, y: 0.2, extra: 'x' },
        { slot: 1, x: 0.4, y: 0.6 },
      ],
    });
    expect(r.session.state.strikes).toEqual([
      { slot: 1, x: 0.4, y: 0.6 },
      { slot: 4, x: 0.2, y: 0.2 },
    ]);
    expect(r.session.state.results).toEqual([null, null]);
    expect(r.desyncs()).toBe(1);
  });
});

describe('state from the host', () => {
  /** A state the guest could really be sent: the host is one phrase on. */
  function hostState(r: ReturnType<typeof guestRig>): DuelState {
    return { ...r.session.state, phrase: FIRST + 5, strikes: [], results: [] };
  }

  it('adopts a well-formed state that differs, with a desync', () => {
    const r = guestRig();
    const s = hostState(r);
    r.send({ t: 'state', state: s });
    expect(r.session.state).toEqual(s);
    expect(r.desyncs()).toBe(1);
  });

  it('keeps its own state for malformed ones', () => {
    const r = guestRig();
    const before = r.session.state;
    const s = hostState(r);
    const bad: unknown[] = [
      { ...s, players: 'nope' },
      { ...s, players: [s.players[0]] },
      { ...s, players: [s.players[0], null] },
      { ...s, players: [s.players[0], { ...s.players[1], health: 'lots' }] },
      { ...s, phase: 'sideways' },
      { ...s, phrase: 'five' },
      { ...s, strikes: 'x' },
      { ...s, strikes: [{ slot: 50, x: 0, y: 0 }], results: [null] },
      null,
      7,
    ];
    for (const b of bad) r.send({ t: 'state', state: b });
    expect(r.session.state).toBe(before);
    expect(r.desyncs()).toBe(0);
  });
});

describe('a listener that throws', () => {
  it('does not stop the other listeners on a loopback transport', () => {
    const pair = createLoopbackPair();
    const heard: string[] = [];
    pair.guest.onMessage(() => {
      throw new Error('boom');
    });
    pair.guest.onMessage((m) => heard.push(m.t));
    expect(() => pair.host.send({ t: 'ready', ready: true })).not.toThrow();
    expect(heard).toEqual(['ready']);
  });

  it('does not stop the other listeners on a pairing transport, for messages, blobs or states', async () => {
    const hub = createMemoryHub();
    const host = createPairingTransport({ link: hub.join(), role: 'host' });
    const guest = createPairingTransport({ link: hub.join(), role: 'guest' });
    const heard: string[] = [];
    guest.onMessage(() => {
      throw new Error('boom');
    });
    guest.onMessage((m) => heard.push(m.t));
    guest.onBlob(() => {
      throw new Error('boom');
    });
    guest.onBlob((_d, m) => heard.push(m.kind));
    guest.onState(() => {
      throw new Error('boom');
    });
    guest.onState((s) => heard.push(s));
    host.send({ t: 'ready', ready: false });
    await host.sendBlob(new ArrayBuffer(2), { kind: 'song', mime: 'audio/wav', bytes: 2 });
    host.close();
    expect(heard).toEqual(['ready', 'song', 'closed']);
  });
});
