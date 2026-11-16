# Brief A: local storage, tracks and song files

**Goal.** The data layer under the workshop and the battle theme screen: an IndexedDB store for drawings, songs and settings; the house-track manifest with generated placeholder loops; and safe handling of song files (limits, type sniffing, hashing). No UI. Everything must work with no network and no environment variables.

**Read first:** `CLAUDE.md`, `docs/GAME.md` (Songs; Puppets and the workshop), `docs/DATA.md`, `src/core/types.ts` (`ThemeOffer`), `src/audio/click.ts`.

**Files you own (create):** `src/data/store.ts`, `src/data/tracks.ts`, `src/data/songFile.ts`, `scripts/generate-tracks.ts`, `public/tracks/tracks.json`, `public/tracks/*.wav` (generated), the `"tracks"` script line in `package.json`, `tests/unit/store.test.ts`, `tests/unit/tracks.test.ts`, `tests/unit/songFile.test.ts`. Touch nothing else. Dependencies are already installed (`fake-indexeddb` for tests); add none.

## Interfaces

```ts
// src/data/store.ts
export interface StoredPuppet {
  id: string;            // uuid
  name: string;
  head: Blob;            // image/png 320x240
  sock: Blob;            // image/png 160x120
  sword: Blob;           // image/png 320x80
  createdAt: number;     // epoch ms
  updatedAt: number;
  /** Set once synced to Supabase. */
  remoteId?: string;
}
export interface StoredSong {
  id: string;
  title: string;
  mime: string;
  bytes: number;
  hash: string;          // sha-256 hex
  data: ArrayBuffer;
  bpm: number;
  firstBeatOffset: number; // seconds
  durationSec: number;
  createdAt: number;
}
export interface Table<T extends { id: string }> {
  list(): Promise<T[]>;                 // newest first (by updatedAt or createdAt)
  get(id: string): Promise<T | undefined>;
  put(value: T): Promise<void>;
  delete(id: string): Promise<void>;
}
export interface Store {
  readonly persistent: boolean;         // false when running on the in-memory fallback
  puppets: Table<StoredPuppet>;
  songs: Table<StoredSong>;
  settings: {
    get<T>(key: string, fallback: T): Promise<T>;
    set<T>(key: string, value: T): Promise<void>;
  };
}
/** Opens IndexedDB database "toetotoe" (version 1; object stores `puppets`, `songs`, `settings`).
 * If IndexedDB is missing or opening fails (private mode, blocked), resolves to an in-memory Store with the same behaviour. Never rejects. */
export function openStore(factory?: IDBFactory): Promise<Store>;
export function createMemoryStore(): Store;
/** Known settings keys, so callers do not scatter strings. */
export const SETTINGS = {
  displayName: 'displayName',
  inputOffsetMs: 'inputOffsetMs',
  selectedPuppetId: 'selectedPuppetId',
  selectedThemeId: 'selectedThemeId',
  musicVolume: 'musicVolume',
  sfxVolume: 'sfxVolume',
} as const;
```

```ts
// src/data/songFile.ts
export const SONG_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxSeconds: 6 * 60,
  /** Accepted container types. */
  types: ['mp3', 'ogg', 'wav', 'm4a'] as const,
};
export type SongType = (typeof SONG_LIMITS.types)[number];
/** Looks at the first bytes only (ID3 / MPEG frame sync, "OggS", "RIFF....WAVE", ISO-BMFF "ftyp" with an audio-capable brand). Returns null when unrecognised. */
export function sniffSongType(bytes: Uint8Array): SongType | null;
export function mimeForSongType(t: SongType): string;
export type SongRejection = 'type' | 'size' | 'length' | 'decode';
/** Plain messages for players, e.g. "That file is not an MP3, OGG, WAV or M4A.", "That song is over 10 MB.", "That song is longer than six minutes.", "That file could not be read as audio." */
export function songRejectionMessage(r: SongRejection): string;
/** Size and sniffed type. Used for the player's own upload and for a song received from the other player (untrusted). Does not decode. */
export function checkSongBytes(data: ArrayBuffer): { ok: true; type: SongType } | { ok: false; reason: 'type' | 'size' };
export function checkSongDuration(durationSec: number): { ok: true } | { ok: false; reason: 'length' };
/** SHA-256 hex with crypto.subtle. */
export function sha256Hex(data: ArrayBuffer): Promise<string>;
```

```ts
// src/data/tracks.ts
export interface TrackInfo {
  id: string;
  source: 'house' | 'upload' | 'click';
  title: string;
  bpm: number;
  firstBeatOffset: number;
  credit?: string;
  licence?: string;
  /** House tracks: file name inside public/tracks/. */
  file?: string;
  hash?: string;
  bytes?: number;
}
export interface TrackSource {
  list(): Promise<TrackInfo[]>;
  /** The encoded audio file. Rejects if the id is unknown or the fetch fails. */
  load(id: string): Promise<ArrayBuffer>;
}
/** Reads `${baseUrl}tracks/tracks.json` (baseUrl defaults to import.meta.env.BASE_URL) with an injectable fetch; validates each entry and drops bad ones. */
export function createHouseTrackSource(opts?: { baseUrl?: string; fetch?: typeof fetch }): TrackSource;
/** Uploaded songs kept in the Store. */
export function createLocalTrackSource(store: Store): TrackSource;
/** The always-available generated click track (source 'click', id 'click-120' style). Not a TrackSource: it is synthesised, not loaded. */
export const CLICK_TRACK: TrackInfo;
export function toThemeOffer(info: TrackInfo): ThemeOffer;
/** Loop region (seconds in the buffer) covering the largest whole number of phrases that fits after the first beat; at least one phrase. Pure. */
export function loopRegion(durationSec: number, bpm: number, firstBeatOffset: number, beatsPerPhrase: number): { loopStart: number; loopEnd: number };
```

## Placeholder tracks

`scripts/generate-tracks.ts`, run with `pnpm tracks` (use `node --experimental-strip-types` on Node 22, or another way that needs no new dependency and works on Windows), writes three short loops into `public/tracks/` as 16-bit mono 22.05 kHz WAV files, each 16 bars of 4/4, clearly named as placeholders: `placeholder-march-100.wav` (100 BPM), `placeholder-waltz-off-126.wav` (126 BPM), `placeholder-gallop-152.wav` (152 BPM). Each should sound different (different bass notes, hat patterns, a simple melody line) and have its first beat at 0 s. You may reuse `renderClickTrack` as a base or write a small synth in the script; it must be deterministic (no `Math.random`). Then it writes `public/tracks/tracks.json`: an array of `{ id, title: "Placeholder: March (100)", file, bpm, firstBeatOffset: 0, credit: "Generated placeholder", licence: "Generated by scripts/generate-tracks.ts; no third-party rights" }`. Run the script and leave the generated files in place (they are committed). Keep each file under 1.5 MB.

## Tests

`store.test.ts` (use `fake-indexeddb`: pass `new IDBFactory()` from it into `openStore`): put/get/list/delete for puppets with Blobs and songs with ArrayBuffers; list order; settings get with fallback and set; data survives reopening with the same factory; `openStore` with a factory whose `open` throws resolves to a working memory store with `persistent === false`; `createMemoryStore` behaves the same.

`songFile.test.ts`: sniffing each type from minimal headers (ID3 tag; bare MPEG frame sync `FF FB`; `OggS`; `RIFF....WAVE`; `....ftypM4A `; and `....ftypisom`/`mp42` accepted as m4a), rejects PNG, text and empty input, rejects a RIFF that is not WAVE (e.g. AVI); size limit exactly at and over 10 MB; duration limit; messages are plain sentences; `sha256Hex` of a known input.

`tracks.test.ts`: the committed `public/tracks/tracks.json` parses, has three entries, and every `file` exists in `public/tracks/` with a valid WAV header; house source with a fake fetch lists them, drops malformed entries, `load` rejects for an unknown id; local source over a memory store; `loopRegion` cases (exact fit, remainder dropped, offset applied, song shorter than a phrase still returns one phrase); `toThemeOffer`.

## Out of scope

UI, tempo detection, decoding audio, sending songs to the other player, Supabase.

## Checks that must pass

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm exec prettier --check src tests scripts`. Other agents are working elsewhere in `src/` at the same time; ignore failures that come only from their files and say so.

## Report (under 200 words)

What you built, files changed, sizes of the generated tracks, check results, and decisions the brief did not cover.
