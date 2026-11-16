import { describe, expect, it } from 'vitest';
import { DEFAULT_NET_CONFIG, netConfigFromEnv } from '../../src/net/netConfig';

describe('netConfigFromEnv', () => {
  it('returns defaults for an empty env', () => {
    expect(netConfigFromEnv({})).toEqual(DEFAULT_NET_CONFIG);
    expect(DEFAULT_NET_CONFIG.appId).toBe('toetotoe.allenzheng.com');
    expect(DEFAULT_NET_CONFIG.strategy).toBe('nostr');
  });

  it('accepts a valid strategy', () => {
    expect(netConfigFromEnv({ VITE_NET_STRATEGY: 'nostr' }).strategy).toBe('nostr');
  });

  it('falls back to the default on a bad strategy', () => {
    expect(netConfigFromEnv({ VITE_NET_STRATEGY: 'carrier-pigeon' }).strategy).toBe(
      DEFAULT_NET_CONFIG.strategy,
    );
  });

  it('parses comma-separated relays, trimming blanks', () => {
    const c = netConfigFromEnv({ VITE_NET_RELAYS: ' wss://a.example , ,wss://b.example' });
    expect(c.relayUrls).toEqual(['wss://a.example', 'wss://b.example']);
    expect(netConfigFromEnv({ VITE_NET_RELAYS: ' , ' }).relayUrls).toBeUndefined();
  });

  it('adds a TURN server only when a URL is present', () => {
    expect(
      netConfigFromEnv({ VITE_TURN_USERNAME: 'u', VITE_TURN_CREDENTIAL: 'p' }).iceServers,
    ).toBeUndefined();
    const c = netConfigFromEnv({
      VITE_TURN_URL: 'turn:turn.example:3478',
      VITE_TURN_USERNAME: 'u',
      VITE_TURN_CREDENTIAL: 'p',
    });
    expect(c.iceServers).toEqual([{ urls: 'turn:turn.example:3478', username: 'u', credential: 'p' }]);
  });
});
