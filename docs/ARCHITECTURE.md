# Architecture

The contract is `src/core/types.ts`. This document explains how the pieces use it.

```
[Pointer Events] -> [Input: pointer position, clicks stamped in audio time]
        |
[Clock: AudioContext time -> beat, slot, phrase]        [Transport: peer | loopback | bot]
        |                                                        |
[DuelSession: local player's side of the match] <----------------+
        |  (pure reducer in src/core/duel.ts)
[Scenes: title, lobby, workshop, theme, duel, victory]
        |
[Stage renderer (PixiJS)]   [DOM overlay: labels, buttons, bars]
[Storage: IndexedDB | Supabase sync]   [Songs: house manifest | local uploads]
```

## Layout

| Path | Holds | Rules |
|---|---|---|
| `src/core/` | `types.ts`, `tunables.ts`, `beat.ts` (grid maths), `duel.ts` (reducer, judging, costs), `session.ts` (DuelSession) | Pure. No DOM, timers, randomness or I/O |
| `src/net/` | `loopback.ts`, `peer.ts` (Trystero), `bot.ts`, `room.ts` (pre-match handshake, clock sync), `codes.ts` | Only place that knows about the network |
| `src/audio/` | `engine.ts` (AudioContext, AudioClock, looped playback), `click.ts` (generated click track), `tempo.ts`, `sfx.ts` | Only place that touches Web Audio |
| `src/input/` | `pointer.ts` | Pointer Events to play-area fractions plus audio time |
| `src/stage/` | Pixi renderer, baked textures, puppet rig, targets | Draws a `DuelView`; contains no rules |
| `src/ui/` | DOM screens and components, CSS | Plain DOM |
| `src/scenes/` | Scene manager and one module per screen | |
| `src/workshop/` | Drawing editor, presets | |
| `src/data/` | IndexedDB stores, Supabase sync, tracks | |
| `src/debug/` | `?debug=1` overlay | |
| `tests/` | `unit/` (Vitest), `e2e/` (Playwright) | |

## The duel timeline

Time is divided into phrases of `beatsPerPhrase * slotsPerBeat` slots (8). Phrases are numbered absolutely from `BeatGrid.startTime` and never reset.

- An act has `countInPhrases` of count-in, then alternating **attack** and **defend** phrases. A *turn* is one attack phrase plus the defend phrase after it. The attacker swaps every turn.
- Strikes planted in slot `s` of the attack phrase replay as targets in slot `s` of the defend phrase, so every strike has one whole phrase to cross the network.
- An act can only end at the end of a defend phrase (`resolve`): when a player's health is 0 or less, or when `actDurationSec` has elapsed since the act's first attack phrase and health differs (a tie on time plays further turns until it doesn't).
- After an act ends, the next act's first attack phrase is `endPhrase + 1 + intermissionPhrases + countInPhrases`. The music never stops between acts.
- The attacker who did not attack first in the previous act attacks first in the next.

`DuelState.phase` is only `attack`, `defend` or `matchOver`. Count-in and intermission are just "the clock has not reached `state.phrase` yet" and exist only in `DuelView`.

## Events and who is authoritative

`DuelEvent`s are generated **only by the active player of a phrase**: the attacker's browser emits `plant` and, when its clock passes the end of the attack phrase, `commit`; the defender's browser judges its own clicks, emits `parry`, and when the last good window has closed, `resolve`. Each browser applies its own events to its reducer at once and sends them; the other applies them on receipt. Because one browser produces all events of a phrase, both reducers see the same events in the same order and reach the same state.

The room creator (player 0) is the referee: after each `resolve` it sends its full `DuelState`; the guest replaces its own state with it (and logs a desync warning in debug if they differed).

Late events are harmless by construction: the phase shown on screen comes from the clock, the health and stamina from the reducer.

## DuelSession (`src/core/session.ts`)

One per player per match. No timers inside: the owner calls `update()` every frame (or a test steps a fake clock and calls it).

```ts
interface DuelSessionOptions {
  localPlayer: PlayerId;
  clock: Clock;
  grid: BeatGrid;
  transport: Transport;
  tunables: Tunables;       // read live on every call, so the debug overlay can edit it
  firstAttacker: PlayerId;
  firstPhrase: number;      // absolute phrase index of the first attack phrase
  inputOffsetMs?: number;   // subtracted from click times before judging
}
type SessionEvent =
  | { type: 'planted'; player: PlayerId; strike: Strike; index: number }
  | { type: 'judged'; player: PlayerId; index: number; grade: Grade; offsetMs: number | null }
  | { type: 'rejected'; reason: 'stamina' | 'slotTaken' | 'notYourTurn' | 'full' }
  | { type: 'actOver'; winner: PlayerId; act: number }
  | { type: 'matchOver'; winner: PlayerId }
  | { type: 'desync' };
class DuelSession {
  constructor(opts: DuelSessionOptions);
  readonly state: DuelState;
  update(): void;                 // emit commit/resolve/auto-miss when the clock passes boundaries
  pointerDown(x: number, y: number, time: number, touch: boolean): void; // plant or parry
  view(): DuelView;
  on(cb: (e: SessionEvent) => void): Unsubscribe;
  rematch(firstPhrase: number): void;
  dispose(): void;
}
```

## The bot

The bot is a second `DuelSession` (as the guest) joined to the player's session by an in-memory loopback pair, plus a driver that calls the bot session's `pointerDown` with generated strikes and parries of configurable accuracy. It therefore exercises exactly the code a remote player does.

## Clocks across two browsers

Each browser has its own audio clock. When the room fills, the guest pings the host several times and keeps the offset from the lowest round trip. The host sends `start` with a time on its own clock; the guest converts it to its clock and builds its own `BeatGrid`. Messages during a match carry phrase and slot numbers, never clock times.

## Scenes

A small scene manager owns the Pixi stage and a DOM overlay root. Each scene mounts DOM and stage content and cleans up on exit. The stage is designed at 1280 by 720 and scaled to fit the window; the cutting mat fills the rest.
