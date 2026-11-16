import type { joinRoom as TrysteroJoinRoom } from 'trystero';
import type { RawLink } from '../core/types';
import { SONG_LIMITS } from '../data/songFile';
import { toArrayBuffer } from './bytes';
import { DEFAULT_NET_CONFIG, type NetConfig } from './netConfig';

type Handler<A extends unknown[]> = (...args: A) => void;

function listeners<A extends unknown[]>() {
  const set = new Set<Handler<A>>();
  return {
    add(cb: Handler<A>): () => void {
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    },
    emit(...args: A): void {
      for (const cb of [...set]) cb(...args);
    },
  };
}

/** Slack on top of the largest song for the wrapping Trystero adds (metadata, framing). */
const RECEIVE_SLACK_BYTES = 64 * 1024;
/** The most Trystero will accept in one incoming message: the song limit plus slack (its default is 256 MiB). */
export const MAX_RECEIVE_BYTES = SONG_LIMITS.maxBytes + RECEIVE_SLACK_BYTES;

/** Room errors that mean this player will not get connected (as opposed to one peer misbehaving). */
const FATAL_ERRORS: readonly string[] = [
  'relay-failed',
  'peer-connect-failed',
  'handshake-failed',
  'identity-failed',
];

export type JoinRoomFn = typeof TrysteroJoinRoom;

/** Joins the Trystero room for this code. The strategy module is loaded with a dynamic import. */
export async function createTrysteroLink(
  roomCode: string,
  config: NetConfig = DEFAULT_NET_CONFIG,
): Promise<RawLink> {
  // Only 'nostr' ships in the installed Trystero; the trystero package re-exports it.
  const { joinRoom } = await import('trystero');
  return createTrysteroLinkWith(joinRoom, roomCode, config);
}

/** The same with the join function passed in, so tests can stand in for Trystero. */
export async function createTrysteroLinkWith(
  joinRoom: JoinRoomFn,
  roomCode: string,
  config: NetConfig = DEFAULT_NET_CONFIG,
): Promise<RawLink> {
  const turnConfig = config.iceServers?.map((s) => ({
    urls: s.urls,
    ...(s.username !== undefined ? { username: s.username } : {}),
    ...(typeof s.credential === 'string' ? { credential: s.credential } : {}),
  }));

  const room = joinRoom(
    {
      appId: config.appId,
      // The game does not use identities, and nothing bigger than a song is ever sent.
      identity: 'none',
      maxReceiveBytes: MAX_RECEIVE_BYTES,
      ...(config.relayUrls ? { relayConfig: { urls: config.relayUrls } } : {}),
      ...(turnConfig && turnConfig.length > 0 ? { turnConfig } : {}),
    },
    roomCode,
  );

  // Short action names: Trystero limits their byte length.
  const dataAction = room.makeAction<never>('d');
  // Trystero hands binary payloads over as a Uint8Array (never an ArrayBuffer); `toArrayBuffer` copes with either.
  const binAction = room.makeAction<ArrayBuffer | ArrayBufferView>('b');
  const data = listeners<[string, unknown]>();
  const bin = listeners<[string, ArrayBuffer, unknown]>();
  const binRejected = listeners<[string, unknown]>();
  const progress = listeners<[string, number, unknown]>();

  dataAction.onMessage((payload, ctx) => {
    data.emit(ctx.peerId, payload);
  });
  binAction.onMessage((payload: unknown, ctx) => {
    const bytes = toArrayBuffer(payload);
    if (bytes === null) binRejected.emit(ctx.peerId, ctx.metadata);
    else bin.emit(ctx.peerId, bytes, ctx.metadata);
  });
  binAction.onReceiveProgress((fraction, ctx) => {
    progress.emit(ctx.peerId, fraction, ctx.metadata);
  });

  const failedCbs = listeners<[string]>();
  let failure: string | null = null;
  room.onError((err) => {
    if (failure !== null || !FATAL_ERRORS.includes(err.code)) return;
    failure = err.message || err.code;
    failedCbs.emit(failure);
  });

  const self = await room.getSelf();
  const noop = (): void => {};

  return {
    selfId: self.peerId,
    send(to, payload) {
      try {
        return dataAction.send(payload as never, { target: to }).catch(noop);
      } catch {
        // peer just left; ignore
        return undefined;
      }
    },
    async sendBinary(to, buffer, meta, onProgress) {
      try {
        await binAction.send(buffer, {
          target: to,
          metadata: meta as never,
          ...(onProgress ? { onProgress: (f: number) => onProgress(f) } : {}),
        });
      } catch {
        // peer just left; ignore
      }
    },
    onData: data.add,
    onBinary: bin.add,
    onBinaryProgress: progress.add,
    onBinaryRejected: binRejected.add,
    onPeerJoin(cb) {
      // replay: peers already present are reported to this listener.
      return room.onPeerJoin((ctx) => cb(ctx.peerId), { replay: true });
    },
    onPeerLeave(cb) {
      return room.onPeerLeave((ctx) => cb(ctx.peerId));
    },
    leave() {
      room.leave().catch(noop);
    },
    get failed() {
      return failure !== null;
    },
    onFailed(cb) {
      if (failure !== null) {
        cb(failure);
        return () => {};
      }
      return failedCbs.add(cb);
    },
  };
}
