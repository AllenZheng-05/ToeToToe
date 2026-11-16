import { describe, expect, it } from 'vitest';
import {
  controls,
  MSG_CONNECTING,
  MSG_FAILED,
  MSG_FULL,
  MSG_VERSION,
  MSG_WAITING_FRIEND,
  MSG_WAITING_HOST,
  playerRows,
  statusText,
  type LobbyModel,
} from '../../src/scenes/lobbyModel';

function model(over: Partial<LobbyModel> = {}): LobbyModel {
  return {
    role: 'host',
    linkReady: true,
    failed: false,
    transport: 'waiting',
    versionMismatch: false,
    localName: 'Ada',
    peerName: null,
    localReady: false,
    peerReady: false,
    synced: true,
    rttMs: null,
    ...over,
  };
}

describe('statusText', () => {
  it('shows Connecting until the link exists', () => {
    expect(statusText(model({ linkReady: false }))).toBe(MSG_CONNECTING);
  });
  it('covers the host waiting and a friend joining', () => {
    expect(statusText(model())).toBe(MSG_WAITING_FRIEND);
    expect(statusText(model({ transport: 'open', peerName: 'Bo' }))).toBe('Bo joined');
  });
  it('covers the guest waiting for the host', () => {
    expect(statusText(model({ role: 'guest', transport: 'connecting' }))).toBe(MSG_WAITING_HOST);
  });
  it('covers full, version mismatch, failure and a friend leaving', () => {
    expect(statusText(model({ transport: 'full' }))).toBe(MSG_FULL);
    expect(statusText(model({ versionMismatch: true }))).toBe(MSG_VERSION);
    expect(statusText(model({ failed: true }))).toBe(MSG_FAILED);
    expect(statusText(model({ transport: 'closed' }))).toBe('Your friend left');
  });
});

describe('playerRows', () => {
  it('puts the host first whoever is local', () => {
    const host = playerRows(model({ transport: 'open', peerName: 'Bo' }));
    expect(host[0].name).toBe('Ada');
    expect(host[1].name).toBe('Bo');
    const guest = playerRows(model({ role: 'guest', localName: 'Bo', peerName: 'Ada', transport: 'open' }));
    expect(guest[0].name).toBe('Ada');
    expect(guest[1].name).toBe('Bo');
  });
});

describe('controls', () => {
  it('lets the host start only when both are ready and synced', () => {
    const open = model({ transport: 'open', peerName: 'Bo' });
    expect(controls(open).canReady).toBe(true);
    expect(controls(open).canStart).toBe(false);
    expect(controls({ ...open, localReady: true }).canStart).toBe(false);
    expect(controls({ ...open, localReady: true, peerReady: true }).canStart).toBe(true);
    expect(controls({ ...open, localReady: true, peerReady: true, synced: false }).canStart).toBe(false);
  });
  it('never lets a guest start, and shows the round trip once synced', () => {
    const g = model({
      role: 'guest',
      transport: 'open',
      peerName: 'Ada',
      localReady: true,
      peerReady: true,
      rttMs: 12.4,
    });
    expect(controls(g).canStart).toBe(false);
    expect(controls(g).rttText).toBe('Round trip: 12 ms');
  });
  it('offers Back to title when full and Try again when failed', () => {
    expect(controls(model({ transport: 'full' })).showBackToTitle).toBe(true);
    expect(controls(model({ failed: true })).showRetry).toBe(true);
    expect(controls(model({ transport: 'full' })).canReady).toBe(false);
  });
});
