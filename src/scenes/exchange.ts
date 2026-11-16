import { cleanText } from '../core/text';
import type {
  BlobKind,
  BlobMeta,
  RejectedBlob,
  ThemeOffer,
  Transport,
  Tunables,
  Unsubscribe,
} from '../core/types';
import { SONG_LIMITS } from '../data/songFile';
import { toThemeOffer, type TrackInfo } from '../data/tracks';
import type { Room } from '../net/room';
import type { PartKind } from '../puppet/parts';
import { checkDrawingBytes } from '../puppet/validate';
import { ThemeError, withBeat, type LoadedTheme } from '../theme/theme';
import type { PuppetImagesSource } from './types';

/** Everything the friend's drawings and songs go through. Whatever arrives is untrusted. */

export const PART_KINDS: readonly PartKind[] = ['head', 'sock', 'sword'];
const BLOB_OF: Record<PartKind, BlobKind> = {
  head: 'puppet-head',
  sock: 'puppet-sock',
  sword: 'puppet-sword',
};
const PART_OF: Partial<Record<BlobKind, PartKind>> = {
  'puppet-head': 'head',
  'puppet-sock': 'sock',
  'puppet-sword': 'sword',
};
const PNG = 'image/png';
/** Longest puppet name taken from the other player. */
export const MAX_PEER_PUPPET_NAME = 32;
const FALLBACK_NAME = 'Friend';
/** Longest theme title taken from an offer. */
export const MAX_THEME_TITLE = 80;
/** A transfer with no progress for this long is given up on, so Start cannot stay locked (UI pacing, not beat timing). */
export const TRANSFER_STALL_MS = 30_000;
/** How long after a failed or stalled drawing send the drawings are sent once more (UI pacing, not beat timing). */
export const PUPPET_RESEND_DELAY_MS = 1500;

// ------------------------------------------------------------------ drawings (pure)

/** What the other player's three parts came to once every part has been seen. */
export interface CollectedDrawing {
  name: string;
  /** Bytes that passed the checks, or null where a part was rejected (use a preset part instead). */
  parts: Record<PartKind, ArrayBuffer | null>;
}

/**
 * Collects the three parts of one puppet. A head always starts a new set (parts are sent head, sock,
 * sword). A part that fails `checkDrawingBytes` counts as seen but is null, so the puppet still
 * completes with a preset part in its place. Pure.
 */
export class DrawingCollector {
  private got: Partial<Record<PartKind, ArrayBuffer | null>> = {};
  private name = FALLBACK_NAME;

  /** Returns what happened to the blob. Blobs that are not puppet parts are 'ignored'. */
  accept(meta: Pick<BlobMeta, 'kind' | 'name'>, data: ArrayBuffer): 'accepted' | 'rejected' | 'ignored' {
    const part = PART_OF[meta.kind];
    if (!part) return 'ignored';
    if (part === 'head') {
      this.got = {};
      this.name = cleanPeerName(meta.name);
    }
    const ok = checkDrawingBytes(data, part).ok;
    this.got[part] = ok ? data : null;
    return ok ? 'accepted' : 'rejected';
  }

  get complete(): boolean {
    return PART_KINDS.every((k) => this.got[k] !== undefined);
  }

  /** The finished set, or null until all three parts have been seen. */
  result(): CollectedDrawing | null {
    if (!this.complete) return null;
    return {
      name: this.name,
      parts: {
        head: this.got.head ?? null,
        sock: this.got.sock ?? null,
        sword: this.got.sword ?? null,
      },
    };
  }
}

export function cleanPeerName(raw: unknown): string {
  return cleanText(raw, MAX_PEER_PUPPET_NAME, FALLBACK_NAME);
}

// ------------------------------------------------------------------ theme gate (pure)

/** What identifies a theme for the `themeReady` answer: the file hash for songs, else the source and id. */
export function themeKey(o: Pick<ThemeOffer, 'source' | 'id' | 'hash'>): string {
  return o.hash ?? `${o.source}:${o.id}`;
}

/**
 * What the `themeReady` answer names: the theme key plus, when known, its tempo and first beat, so an answer
 * for the same file at another tempo does not count.
 */
export function themeGateKey(
  o: Pick<ThemeOffer, 'source' | 'id' | 'hash'> & Partial<Pick<ThemeOffer, 'bpm' | 'firstBeatOffset'>>,
): string {
  const base = themeKey(o);
  return o.bpm === undefined || o.firstBeatOffset === undefined
    ? base
    : `${base}@${o.bpm}/${o.firstBeatOffset}`;
}

export type LocalThemeStatus = 'none' | 'loading' | 'ready' | 'failed';
export type PeerThemeStatus = 'unknown' | 'ok' | 'failed';

/**
 * Who may press Ready and Start. The guest cannot be ready until the offered theme is loaded on its
 * side; the host cannot start until the guest reported the current theme loaded. A new offer resets both.
 * Pure state machine.
 */
export class ThemeGate {
  private key: string | null = null;
  private local: LocalThemeStatus = 'none';
  private peer: PeerThemeStatus = 'unknown';

  constructor(readonly role: 'host' | 'guest') {}

  get currentKey(): string | null {
    return this.key;
  }
  get localStatus(): LocalThemeStatus {
    return this.local;
  }
  get peerStatus(): PeerThemeStatus {
    return this.peer;
  }

  /** Host: the theme changed. Guest: an offer arrived. Returns true when it is a different theme (or the same one at another tempo or first beat). */
  offer(o: Parameters<typeof themeGateKey>[0]): boolean {
    const key = themeGateKey(o);
    if (key === this.key) return false;
    this.key = key;
    this.peer = 'unknown';
    this.local = this.role === 'host' ? 'ready' : 'loading';
    return true;
  }

  /** Guest: loading of `key` finished. Answers for a theme that is no longer current are dropped (false). */
  loaded(key: string, ok: boolean): boolean {
    if (this.role !== 'guest' || key !== this.key) return false;
    this.local = ok ? 'ready' : 'failed';
    return true;
  }

  /** Host: the guest's `themeReady`. Answers for another theme are dropped (false). */
  peerReport(hash: string | null, ok: boolean): boolean {
    if (this.role !== 'host' || hash === null || hash !== this.key) return false;
    this.peer = ok ? 'ok' : 'failed';
    return true;
  }

  /** The local player may press Ready. */
  get canReady(): boolean {
    return this.role === 'host' ? true : this.local === 'ready';
  }

  /** The host may press Start as far as the theme goes. */
  get canStart(): boolean {
    return this.role === 'host' && this.peer === 'ok';
  }
}

// ------------------------------------------------------------------ the exchange

export interface PeerPuppet {
  name: string;
  images: PuppetImagesSource;
  /** Bumped for every new set, so a viewer can tell a change from a repeat. */
  version: number;
}

/** The player's own puppet as bytes ready to send. */
export interface OutgoingPuppet {
  name: string;
  head: ArrayBuffer;
  sock: ArrayBuffer;
  sword: ArrayBuffer;
}

export interface ThemeView {
  offer: ThemeOffer | null;
  status: LocalThemeStatus;
  /** The guest's plain reason when it could not load, or the host's note that the friend could not. */
  message: string | null;
  loaded: LoadedTheme | null;
}

export interface ExchangeView {
  peerPuppet: PeerPuppet | null;
  /** 0..1 while one of these is moving, else null. */
  puppetSend: number | null;
  puppetFetch: number | null;
  songSend: number | null;
  songFetch: number | null;
  theme: ThemeView;
  canReady: boolean;
  canStart: boolean;
}

export interface ExchangeDeps {
  transport: Transport;
  room: Room;
  role: 'host' | 'guest';
  tunables: Tunables;
  /** Runs `fn` after `ms`; returns a cancel function. Defaults to setTimeout. Only for UI pacing, never beat timing. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** The player's selected puppet as PNG bytes. */
  getPuppet(): Promise<OutgoingPuppet>;
  /** Decode PNG bytes with the browser's decoder to an image of the part's size. Rejects when it cannot. */
  decodePart(data: ArrayBuffer, kind: PartKind): Promise<CanvasImageSource>;
  /** A preset part to use where the friend's part was rejected. */
  fallbackPart(kind: PartKind): Promise<CanvasImageSource>;
  /** Load a house track or the click track named by an offer. */
  loadTheme(info: TrackInfo): Promise<LoadedTheme>;
  /** Load a song the friend sent (type, size and length checks, SHA-256 against the offer). */
  loadSong(offer: ThemeOffer, data: ArrayBuffer): Promise<LoadedTheme>;
}

function infoFromOffer(o: ThemeOffer): TrackInfo {
  const info: TrackInfo = {
    id: o.id,
    source: o.source,
    title: cleanText(o.title, MAX_THEME_TITLE, 'Theme'),
    bpm: o.bpm,
    firstBeatOffset: o.firstBeatOffset,
  };
  if (o.hash !== undefined) info.hash = o.hash;
  if (o.bytes !== undefined) info.bytes = o.bytes;
  return info;
}

export const MSG_FRIEND_COULD_NOT_LOAD = 'Your friend could not load that song';

/**
 * Sends this player's puppet and (host) song, and receives the friend's. Runs next to `Room`, which
 * ignores these messages. Everything received is checked before it is used.
 */
export class Exchange {
  private readonly d: ExchangeDeps;
  private readonly gate: ThemeGate;
  private readonly listeners = new Set<() => void>();
  private readonly unsubs: Unsubscribe[] = [];
  private readonly collector = new DrawingCollector();

  private peerPuppet: PeerPuppet | null = null;
  private version = 0;
  private decodeToken = 0;
  private fetchProgress: Partial<Record<PartKind, number>> = {};
  private puppetSend: number | null = null;
  private songSend: number | null = null;
  private songFetch: number | null = null;
  private sending = false;
  private sendAgain = false;
  /** Bumped for every send run and when one is given up on, so a run that was abandoned stops touching state. */
  private sendGen = 0;
  /** Retries left for the current drawing send (one per request; a new request earns a new one). */
  private resendLeft = 0;
  private resendCancel: (() => void) | null = null;
  private peerSeen = false;
  private disposed = false;

  private offer: ThemeOffer | null = null;
  private loaded: LoadedTheme | null = null;
  private message: string | null = null;
  private loadToken = 0;
  /** The most recent song blob received, kept until the matching offer is there to check it against. */
  private pendingSong: { data: ArrayBuffer; meta: BlobMeta } | null = null;
  private sentSongKey: string | null = null;
  /** The file (theme key) a load is under way for, or null. */
  private loadingFile: string | null = null;
  private stallCancel: (() => void) | null = null;
  private readonly schedule: (fn: () => void, ms: number) => () => void;

  constructor(deps: ExchangeDeps) {
    this.d = deps;
    this.schedule =
      deps.schedule ??
      ((fn, ms) => {
        const h = setTimeout(fn, ms);
        return () => clearTimeout(h);
      });
    this.gate = new ThemeGate(deps.role);
    const { transport, room } = deps;
    this.unsubs.push(
      transport.onBlob((data, meta) => this.onBlob(data, meta)),
      transport.onBlobProgress((fraction, meta) => this.onProgress(fraction, meta)),
      ...(transport.onBlobRejected ? [transport.onBlobRejected((info) => this.onRejected(info))] : []),
      transport.onMessage((m) => {
        if (m.t === 'themeReady') this.onThemeReady(m.hash, m.ok);
      }),
      transport.onState((state) => {
        if (state === 'closed') this.dropTransfers();
      }),
      room.on((e) => {
        if (e.type === 'peer') this.onPeer();
        else if (e.type === 'theme') this.onOffer(e.theme);
      }),
    );
    // The guest may already have heard the offer, and the peer may already have said hello.
    if (room.theme && deps.role === 'guest') this.onOffer(room.theme);
    if (room.peerName !== null) this.onPeer();
  }

  get view(): ExchangeView {
    const fetching = Object.values(this.fetchProgress);
    return {
      peerPuppet: this.peerPuppet,
      puppetSend: this.puppetSend,
      puppetFetch: fetching.length === 0 ? null : fetching.reduce((a, b) => a + b, 0) / PART_KINDS.length,
      songSend: this.songSend,
      songFetch: this.songFetch,
      theme: { offer: this.offer, status: this.gate.localStatus, message: this.message, loaded: this.loaded },
      canReady: this.gate.canReady,
      canStart: this.gate.canStart,
    };
  }

  /** The loaded theme this side will play, or null while there is none. */
  get theme(): LoadedTheme | null {
    return this.loaded;
  }

  /** True while any drawing or song is on its way (or about to be: a send has been asked for). */
  get busy(): boolean {
    const v = this.view;
    return (
      this.sending ||
      v.puppetSend !== null ||
      v.puppetFetch !== null ||
      v.songSend !== null ||
      v.songFetch !== null
    );
  }

  onChange(cb: () => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.disposed = true;
    for (const u of this.unsubs.splice(0)) u();
    this.listeners.clear();
    this.decodeToken++;
    this.loadToken++;
    this.stallCancel?.();
    this.stallCancel = null;
    this.resendCancel?.();
    this.resendCancel = null;
  }

  /** Send the selected puppet (again). Safe to call at any time; a call during a send queues one more. */
  sendPuppet(): void {
    this.resendLeft = 1;
    this.resendCancel?.();
    this.resendCancel = null;
    if (this.sending) {
      this.sendAgain = true;
      return;
    }
    void this.runSend();
  }

  /**
   * Host: this is the theme now. Offers it, and sends the file when it is an upload and the friend is here.
   * The host's own copy is already loaded.
   */
  offerTheme(theme: LoadedTheme): void {
    if (this.d.role !== 'host' || this.disposed) return;
    const offer = toThemeOffer(theme.info);
    this.loaded = theme;
    this.offer = offer;
    this.message = null;
    this.gate.offer(offer);
    this.d.room.setTheme(offer);
    // The file is sent once: a new tempo or first beat for the same song goes as the offer alone.
    this.maybeSendSong();
    this.emit();
  }

  // ------------------------------------------------------------ internals

  private emit(): void {
    for (const cb of [...this.listeners]) cb();
  }

  private onPeer(): void {
    if (this.peerSeen) return;
    this.peerSeen = true;
    this.sendPuppet();
    this.maybeSendSong();
  }

  private async runSend(): Promise<void> {
    const gen = ++this.sendGen;
    this.sending = true;
    let failed = false;
    try {
      do {
        this.sendAgain = false;
        if (this.d.transport.state !== 'open') break;
        let p: OutgoingPuppet;
        try {
          p = await this.d.getPuppet();
        } catch {
          break;
        }
        if (gen !== this.sendGen) return;
        const parts: [PartKind, ArrayBuffer][] = [
          ['head', p.head],
          ['sock', p.sock],
          ['sword', p.sword],
        ];
        let done = 0;
        this.puppetSend = 0;
        this.activity();
        this.emit();
        for (const [kind, data] of parts) {
          if (this.disposed || this.d.transport.state !== 'open' || gen !== this.sendGen) break;
          const meta: BlobMeta = { kind: BLOB_OF[kind], mime: PNG, bytes: data.byteLength };
          if (kind === 'head') meta.name = p.name.slice(0, MAX_PEER_PUPPET_NAME);
          try {
            await this.d.transport.sendBlob(data.slice(0), meta, (f) => {
              if (gen !== this.sendGen) return;
              this.puppetSend = (done + f) / PART_KINDS.length;
              this.activity();
              this.emit();
            });
          } catch {
            failed = true;
            break;
          }
          done++;
        }
      } while (this.sendAgain && !this.disposed && !failed && gen === this.sendGen);
    } finally {
      // A run that was given up on (stalled) leaves the state to whoever took over.
      if (gen === this.sendGen) {
        this.sending = false;
        this.puppetSend = null;
        this.activity();
        if (!this.disposed) this.emit();
        if (failed) this.scheduleResend();
      }
    }
  }

  /** The drawings did not go out: try once more shortly (once per request, never a loop). */
  private scheduleResend(): void {
    if (this.resendLeft <= 0 || this.disposed || this.d.transport.state !== 'open') return;
    this.resendLeft--;
    this.resendCancel?.();
    this.resendCancel = this.schedule(() => {
      this.resendCancel = null;
      if (this.disposed || this.d.transport.state !== 'open') return;
      if (this.sending) this.sendAgain = true;
      else void this.runSend();
    }, PUPPET_RESEND_DELAY_MS);
  }

  private onProgress(fraction: number, meta: BlobMeta): void {
    if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return;
    const f = Math.min(1, Math.max(0, fraction));
    const part = PART_OF[meta.kind];
    if (part) {
      this.fetchProgress[part] = f;
      this.activity();
      this.emit();
    } else if (meta.kind === 'song') {
      this.songFetch = f;
      this.activity();
      this.emit();
    }
  }

  private onBlob(data: ArrayBuffer, meta: BlobMeta): void {
    if (this.disposed) return;
    if (meta.kind === 'song') {
      if (this.d.role !== 'guest') return;
      this.songFetch = null;
      this.activity();
      this.pendingSong = { data, meta };
      this.tryLoadSong();
      this.emit();
      return;
    }
    // Not a PNG counts as a rejected part, like bad bytes.
    this.takePart({ kind: meta.kind, name: meta.name }, meta.mime === PNG ? data : new ArrayBuffer(0));
  }

  /** One of the friend's drawing parts has been seen (good bytes, or none for a part that is to fall back). */
  private takePart(meta: Pick<BlobMeta, 'kind' | 'name'>, data: ArrayBuffer): void {
    const part = PART_OF[meta.kind];
    if (!part) return;
    this.collector.accept(meta, data);
    this.fetchProgress[part] = 1;
    const done = this.collector.result();
    if (done) {
      this.fetchProgress = {};
      void this.decode(done);
    }
    this.activity();
    this.emit();
  }

  /** The link threw a blob away: whatever was showing for it ends now, and what it was for falls back. */
  private onRejected(info: RejectedBlob): void {
    if (this.disposed) return;
    if (info.kind === 'song') {
      if (this.d.role !== 'guest') return;
      this.songFetch = null;
      this.activity();
      this.pendingSong = null;
      const offer = this.offer;
      if (offer && offer.source === 'upload' && this.gate.localStatus === 'loading') {
        // The plain "could not load" path: the host is told, and sends the file again with the next offer.
        const token = ++this.loadToken;
        this.finishLoad(token, themeKey(offer), null, 'That song could not be loaded.');
      }
      this.emit();
      return;
    }
    if (info.kind !== null && PART_OF[info.kind]) {
      this.takePart({ kind: info.kind, name: info.name }, new ArrayBuffer(0));
      return;
    }
    // Nothing to say which transfer it was: none of them can be waited for.
    this.fetchProgress = {};
    this.songFetch = null;
    this.activity();
    this.emit();
  }

  private async decode(c: CollectedDrawing): Promise<void> {
    const token = ++this.decodeToken;
    const one = async (kind: PartKind): Promise<CanvasImageSource> => {
      const bytes = c.parts[kind];
      if (bytes) {
        try {
          return await this.d.decodePart(bytes, kind);
        } catch {
          /* a part that will not decode is replaced by a preset part */
        }
      }
      return this.d.fallbackPart(kind);
    };
    try {
      const [head, sock, sword] = await Promise.all([one('head'), one('sock'), one('sword')]);
      if (token !== this.decodeToken || this.disposed) return;
      this.peerPuppet = { name: c.name, images: { head, sock, sword }, version: ++this.version };
    } catch {
      return;
    }
    this.emit();
  }

  // ------------------------------------------------------------ theme

  /** Guest: the host's offer arrived (a new one, or a new tempo for the same file, resets Ready). */
  private onOffer(raw: ThemeOffer): void {
    if (this.d.role !== 'guest' || this.disposed) return;
    const theme: ThemeOffer = { ...raw, title: cleanText(raw.title, MAX_THEME_TITLE, 'Theme') };
    const prev = this.offer;
    const changed = this.gate.offer(theme);
    this.offer = theme;
    if (!changed) return;
    if (this.d.room.localReady) this.d.room.setReady(false);

    // The same file at another tempo or first beat: nothing to fetch again, only the beat to apply.
    const sameFile = prev !== null && themeKey(prev) === themeKey(theme) && theme.source !== 'click';
    if (sameFile && this.loaded) {
      this.loaded = withBeat(this.loaded, theme, this.d.tunables);
      this.message = null;
      this.gate.loaded(themeGateKey(theme), true);
      this.sendThemeReady(theme, true);
      this.emit();
      return;
    }
    if (sameFile && this.loadingFile === themeKey(theme)) {
      // Still loading: finishLoad applies whatever beat is current when it is done.
      this.message = null;
      this.emit();
      return;
    }

    // Anything still coming belongs to the theme that was replaced.
    this.songFetch = null;
    this.fetchProgress = {};
    this.activity();
    this.loaded = null;
    this.message = null;
    this.loadToken++;
    this.loadingFile = null;
    if (theme.source === 'upload') {
      this.tryLoadSong();
    } else {
      void this.loadByName(theme);
    }
    this.emit();
  }

  private async loadByName(theme: ThemeOffer): Promise<void> {
    const token = ++this.loadToken;
    const key = themeKey(theme);
    this.loadingFile = key;
    let loaded: LoadedTheme | null = null;
    let reason: string | null = null;
    try {
      loaded = await this.d.loadTheme(infoFromOffer(theme));
    } catch (e) {
      reason = e instanceof ThemeError ? e.message : 'That song could not be loaded.';
    }
    this.finishLoad(token, key, loaded, reason);
  }

  /** Guest: load the received song if it belongs to the current offer. */
  private tryLoadSong(): void {
    const offer = this.offer;
    const pending = this.pendingSong;
    if (this.d.role !== 'guest' || !offer || offer.source !== 'upload' || !pending) return;
    if (this.gate.localStatus !== 'loading') return;
    if (pending.meta.hash !== undefined && offer.hash !== undefined && pending.meta.hash !== offer.hash) {
      return; // an old song still arriving: wait for the one this offer is about
    }
    this.pendingSong = null;
    void (async () => {
      const token = ++this.loadToken;
      const key = themeKey(offer);
      this.loadingFile = key;
      let loaded: LoadedTheme | null = null;
      let reason: string | null = null;
      if (pending.data.byteLength > SONG_LIMITS.maxBytes) {
        reason = 'That song is too big.';
      } else {
        try {
          loaded = await this.d.loadSong(offer, pending.data);
        } catch (e) {
          reason = e instanceof ThemeError ? e.message : 'That song could not be loaded.';
        }
      }
      this.finishLoad(token, key, loaded, reason);
    })();
  }

  /** `fileKey` names the file the load was for; the answer is about the offer that is current now (it may have a new tempo). */
  private finishLoad(
    token: number,
    fileKey: string,
    loaded: LoadedTheme | null,
    reason: string | null,
  ): void {
    if (this.disposed || token !== this.loadToken) return;
    this.loadingFile = null;
    const offer = this.offer;
    if (!offer || themeKey(offer) !== fileKey) return;
    let result = loaded;
    if (
      result &&
      offer.source !== 'click' &&
      (result.info.bpm !== offer.bpm || result.info.firstBeatOffset !== offer.firstBeatOffset)
    ) {
      result = withBeat(result, offer, this.d.tunables);
    }
    if (!this.gate.loaded(themeGateKey(offer), result !== null)) return;
    this.loaded = result;
    this.message = result ? null : (reason ?? 'That song could not be loaded.');
    this.sendThemeReady(offer, result !== null);
    this.emit();
  }

  private sendThemeReady(offer: ThemeOffer, ok: boolean): void {
    if (this.d.transport.state === 'open') {
      this.d.transport.send({ t: 'themeReady', hash: themeGateKey(offer), ok });
    }
  }

  /** Host: the guest answered for a theme. */
  private onThemeReady(hash: unknown, ok: unknown): void {
    if (this.d.role !== 'host' || this.disposed) return;
    if ((hash !== null && typeof hash !== 'string') || typeof ok !== 'boolean') return;
    if (!this.gate.peerReport(hash, ok)) return;
    this.message = ok ? null : MSG_FRIEND_COULD_NOT_LOAD;
    // A friend that could not load the file needs it sent again with the next offer.
    if (!ok) this.sentSongKey = null;
    this.emit();
  }

  /** Host: send the current upload to the friend, once per theme and friend. */
  private maybeSendSong(): void {
    const t = this.loaded;
    if (this.d.role !== 'host' || !t || !this.peerSeen || this.d.transport.state !== 'open') return;
    if (t.info.source !== 'upload' || !t.file) return;
    const key = themeKey(toThemeOffer(t.info));
    if (this.sentSongKey === key) return;
    this.sentSongKey = key;
    const meta: BlobMeta = {
      kind: 'song',
      mime: t.file.mime,
      bytes: t.file.data.byteLength,
      name: t.info.title,
    };
    if (t.info.hash !== undefined) meta.hash = t.info.hash;
    this.songSend = 0;
    this.activity();
    this.emit();
    this.d.transport
      .sendBlob(t.file.data.slice(0), meta, (f) => {
        this.songSend = f;
        this.activity();
        this.emit();
      })
      .catch(() => {
        // The friend left or the link dropped (the lobby shows that on its own). Send it again on the next offer.
        if (this.sentSongKey === key) this.sentSongKey = null;
      })
      .finally(() => {
        this.songSend = null;
        this.activity();
        if (!this.disposed) this.emit();
      });
  }

  // ------------------------------------------------------------ stuck transfers

  private get transferring(): boolean {
    return (
      this.puppetSend !== null ||
      this.songSend !== null ||
      this.songFetch !== null ||
      Object.keys(this.fetchProgress).length > 0
    );
  }

  /** Something moved (or ended): restart the stall timer while any transfer is still open, stop it otherwise. */
  private activity(): void {
    this.stallCancel?.();
    this.stallCancel = null;
    if (this.disposed || !this.transferring) return;
    this.stallCancel = this.schedule(() => {
      this.stallCancel = null;
      if (this.disposed) return;
      this.dropTransfers();
    }, TRANSFER_STALL_MS);
  }

  /** The friend left, or nothing has moved for a long time: nothing is on its way any more. */
  private dropTransfers(): void {
    const stalledSend = this.puppetSend !== null;
    this.fetchProgress = {};
    this.puppetSend = null;
    this.songSend = null;
    this.songFetch = null;
    this.stallCancel?.();
    this.stallCancel = null;
    if (stalledSend) {
      // A drawing send that nothing moved in: give up on that run and send the drawings once more.
      this.sendGen++;
      this.sending = false;
      this.scheduleResend();
    }
    if (!this.disposed) this.emit();
  }
}
