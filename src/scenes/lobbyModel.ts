import type { TransportState } from '../core/types';

/** Everything the lobby shows is derived from this snapshot. No DOM here, so it can be unit tested. */
export interface LobbyModel {
  role: 'host' | 'guest';
  /** False until the link exists (Trystero loads and joins asynchronously). */
  linkReady: boolean;
  /** True when creating the link failed. */
  failed: boolean;
  transport: TransportState;
  versionMismatch: boolean;
  localName: string;
  peerName: string | null;
  localReady: boolean;
  peerReady: boolean;
  synced: boolean;
  rttMs: number | null;
}

export const MSG_CONNECTING = 'Connecting…';
export const MSG_WAITING_FRIEND = 'Waiting for a friend to join';
export const MSG_WAITING_HOST = 'Waiting for the host';
export const MSG_FULL = 'This room is full';
export const MSG_VERSION = 'Your friend is using a different version. Both of you should reload the page.';
export const MSG_FAILED = 'Could not connect. Check your internet connection and try again.';
export const MSG_LEFT = 'Your friend left';

export function statusText(m: LobbyModel): string {
  if (m.failed) return MSG_FAILED;
  if (m.versionMismatch) return MSG_VERSION;
  if (!m.linkReady) return MSG_CONNECTING;
  switch (m.transport) {
    case 'full':
      return MSG_FULL;
    case 'closed':
      return MSG_LEFT;
    case 'connecting':
      return m.role === 'guest' ? MSG_WAITING_HOST : MSG_CONNECTING;
    case 'waiting':
      return MSG_WAITING_FRIEND;
    case 'open':
      if (m.peerName === null) return MSG_CONNECTING;
      return m.role === 'host' ? `${m.peerName} joined` : `Joined ${m.peerName}'s room`;
  }
}

export interface PlayerRow {
  name: string;
  ready: boolean;
  /** Short note next to the name: "you", "host", "waiting…". */
  tag: string;
}

/** Index = PlayerId: the host is always 0. */
export function playerRows(m: LobbyModel): [PlayerRow, PlayerRow] {
  const local: PlayerRow = { name: m.localName, ready: m.localReady, tag: 'you' };
  const peer: PlayerRow = {
    name: m.peerName ?? '…',
    ready: m.peerReady,
    tag: m.peerName === null ? 'waiting' : 'friend',
  };
  return m.role === 'host' ? [local, peer] : [peer, local];
}

export interface LobbyControls {
  canReady: boolean;
  /** Host only. */
  canStart: boolean;
  showBackToTitle: boolean;
  showRetry: boolean;
  rttText: string | null;
}

export function controls(m: LobbyModel): LobbyControls {
  const paired =
    m.linkReady && !m.failed && !m.versionMismatch && m.transport === 'open' && m.peerName !== null;
  return {
    canReady: paired,
    canStart: paired && m.role === 'host' && m.localReady && m.peerReady && m.synced,
    showBackToTitle: m.transport === 'full' && !m.failed,
    showRetry: m.failed,
    rttText:
      m.synced && m.rttMs !== null && m.role === 'guest' ? `Round trip: ${m.rttMs.toFixed(0)} ms` : null,
  };
}
