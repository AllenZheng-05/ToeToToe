/** Trystero 0.27.0 ships only the Nostr strategy in its main entry; others are separate packages we do not install. */
export type LinkStrategy = 'nostr';

const STRATEGIES: readonly LinkStrategy[] = ['nostr'];

export interface NetConfig {
  /** Namespaces our rooms on the public handshake networks. */
  appId: string;
  strategy: LinkStrategy;
  /** Optional relay/tracker URL overrides passed through to Trystero. */
  relayUrls?: string[];
  /** Optional extra ICE servers (a TURN relay can be added here later). */
  iceServers?: RTCIceServer[];
}

export const DEFAULT_NET_CONFIG: NetConfig = {
  appId: 'toetotoe.allenzheng.com',
  strategy: 'nostr',
};

function isStrategy(value: string): value is LinkStrategy {
  return (STRATEGIES as readonly string[]).includes(value);
}

/** Reads optional overrides from a Vite-style env object. Pure, so it can be unit tested. */
export function netConfigFromEnv(env: Record<string, string | undefined>): NetConfig {
  const config: NetConfig = { ...DEFAULT_NET_CONFIG };

  const strategy = env.VITE_NET_STRATEGY?.trim().toLowerCase();
  if (strategy && isStrategy(strategy)) config.strategy = strategy;

  const relays = (env.VITE_NET_RELAYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (relays.length > 0) config.relayUrls = relays;

  const turnUrl = env.VITE_TURN_URL?.trim();
  if (turnUrl) {
    const server: RTCIceServer = { urls: turnUrl };
    const username = env.VITE_TURN_USERNAME?.trim();
    const credential = env.VITE_TURN_CREDENTIAL?.trim();
    if (username) server.username = username;
    if (credential) server.credential = credential;
    config.iceServers = [server];
  }

  return config;
}
