import type { RawLink } from '../core/types';
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

/** Joins the Trystero room for this code. The strategy module is loaded with a dynamic import. */
export async function createTrysteroLink(
  roomCode: string,
  config: NetConfig = DEFAULT_NET_CONFIG,
): Promise<RawLink> {
  // Only 'nostr' ships in the installed Trystero; `trystero` re-exports it.
  const { joinRoom } = await import('trystero');

  const turnConfig = config.iceServers?.map((s) => ({
    urls: s.urls,
    ...(s.username !== undefined ? { username: s.username } : {}),
    ...(typeof s.credential === 'string' ? { credential: s.credential } : {}),
  }));

  const room = joinRoom(
    {
      appId: config.appId,
      ...(config.relayUrls ? { relayConfig: { urls: config.relayUrls } } : {}),
      ...(turnConfig && turnConfig.length > 0 ? { turnConfig } : {}),
    },
    roomCode,
  );

  // Short action names: Trystero limits their byte length.
  const dataAction = room.makeAction<never>('d');
  const binAction = room.makeAction<ArrayBuffer>('b');
  const data = listeners<[string, unknown]>();
  const bin = listeners<[string, ArrayBuffer, unknown]>();
  const progress = listeners<[string, number, unknown]>();

  dataAction.onMessage((payload, ctx) => {
    data.emit(ctx.peerId, payload);
  });
  binAction.onMessage((payload, ctx) => {
    bin.emit(ctx.peerId, payload, ctx.metadata);
  });
  binAction.onReceiveProgress((fraction, ctx) => {
    progress.emit(ctx.peerId, fraction, ctx.metadata);
  });

  const self = await room.getSelf();
  const noop = (): void => {};

  return {
    selfId: self.peerId,
    send(to, payload) {
      try {
        dataAction.send(payload as never, { target: to }).catch(noop);
      } catch {
        // peer just left; ignore
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
  };
}
