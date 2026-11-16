# Brief 8: fixes from the whole-codebase review

**Goal.** Fix every finding below from the opus reviewer's pass, each with a test that fails before the fix and passes after. No new features.

**Read first:** `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/NETWORKING.md`, then the files named in each item.

**Files you own:** all of `src/` and `tests/`, except that `src/core/types.ts` may only gain what an item below needs (say what you added). Keep changes minimal and local to each finding. You are the only agent in the repo.

## Blockers

1. **Guest ignores a tempo or first-beat change to an already-loaded theme** (`src/scenes/exchange.ts` around lines 86 and 456; `src/theme/picker.ts` `withBeat`). The theme key is the hash or `source:id`, so a re-offer with a new `bpm` or `firstBeatOffset` is treated as unchanged: the guest keeps the old loaded theme, the host's gate stays ok, and the match starts with the guest's music off the grid. Fix: on a re-offer of the same file with different beat values, apply the new values to the already-loaded theme (no second transfer), reset the guest's Ready, and send `themeReady` again; the host's gate must go back to waiting until that arrives. Include the beat values in whatever the gate compares.

2. **Clock offset never recovers from a jump in either audio clock, and never re-syncs** (`src/net/room.ts` around lines 368 to 416). The offset is replaced only by a sample with a lower round trip than the all-time best, and pinging stops at the first start. Fix:
   - Estimate from the lowest-round-trip sample within a recent window (the last 8 samples), not the all-time best.
   - A side whose audio clock is not running does not answer pings (needs a way for `Room` to ask; inject a `isClockRunning(): boolean` dependency, default always true), and samples taken while the local clock is not running are discarded.
   - Detect a jump: if a new sample's offset differs from the current estimate by more than a tunable threshold (put `clockJumpMs` in `src/core/tunables.ts`, default 50) on two consecutive samples, clear the window and start again.
   - Keep pinging at a slow rate during the lobby after the first match, and take a fresh burst of samples before every start, including rematches; the host does not send `start` until a sync newer than the last clock-state change exists (bounded wait, then start anyway with the best estimate so a match is never blocked for good).
   - Ping scheduling is not on the beat, so ordinary timers are fine there (they already are).

## Should fix

3. **Peer name not cleaned** (`src/net/room.ts` near line 298): apply `cleanName` (20 characters) on receipt and strip control and bidirectional-override characters. Cap the theme title shown from an offer to 80 characters at the point the offer is accepted (`exchange.ts` near 457 stores the raw offer).

4. **Host-sent values only checked for finiteness** (`room.ts` near 314, 65, 403): add `validateTunables(input: unknown): Tunables | null` in `src/core/tunables.ts` with a sensible range per field (integers where they must be; `slotsPerBeat`, `beatsPerPhrase` and similar small positive integers with tight upper bounds), and use it for the `tunables` message and the `?tunables=` URL parameter. Give `isThemeOffer` the same BPM and first-beat bounds as `validOffer` in `src/theme/theme.ts`. `start.firstPhrase` must be a non-negative safe integer and `bpm` in range; reject the message otherwise.

5. **Session input checks** (`src/core/session.ts` near 77 and 446): a received `commit` is rebuilt by checking each strike the same way a `plant` is checked (slot range, 0..1 positions, no duplicate slots, count limit); a received `state` goes through a `DuelState` shape validator (put it in `src/core/duel.ts`; reject anything malformed and keep the local state); `plant` with a missing or malformed `strike` is ignored without throwing. Also make the transport's dispatch loop survive a throwing listener (catch, log in debug, continue to the other listeners).

6. **Trystero receive cap** (`src/net/trysteroLink.ts`): check the installed `trystero` 0.27.0 source in `node_modules` for the receive size option (the reviewer names `maxReceiveBytes`, default 256 MiB) and set it to the song limit plus 64 KiB. Also pass `identity: 'none'` if the installed version supports it (the game does not use identity). Follow the installed typings, not memory.

7. **Song length checked only after decoding** (`src/theme/theme.ts` near 96): before `decodeAudioData`, read the duration from an `HTMLAudioElement` with `preload = 'metadata'` on a Blob URL (revoke it afterwards; bounded wait of a few seconds; injected so tests can fake it) and reject over-long files before decoding. If the metadata cannot be read, fall through to the existing decode-then-check path. Confirm the CSP in `public/_headers` allows it (`media-src 'self' blob:` is there) and extend `tests/e2e/csp.spec.ts` only if a new violation could occur.

8. **Rematch bypasses Ready and the theme gate; listeners leak** (`room.ts` near 426, `src/scenes/roomMatch.ts` near 67, `src/scenes/victory.ts` near 107 and 145): add `Room.cancelRematch()` (sends nothing new unless the protocol already has a fitting message; if the peer must know, reuse `ready` false or add the smallest possible message and say so) and call it when leaving the victory screen; unsubscribe pending listeners in the victory scene's exit; the host starts a rematch only if the theme gate allows; if the friend has gone back to the room, the "Waiting for your friend…" note changes to say so with a "Back to the room" action.

9. **Invisible connection failures and stuck transfers** (`trysteroLink.ts`, `exchange.ts`, `lobby.ts` near 432): subscribe to Trystero's error callback if the installed version has one and surface a failed connection as the link's `failed` state; add a connect timeout for the guest ("Could not connect" with retry, after a tunable-free UI constant of about 20 s; this is not beat timing). In `exchange.ts` clear fetch progress on a new offer, on the peer leaving and after a stall timeout with no progress (about 30 s), so Start cannot stay locked; reset `sentSongKey` when a send rejects so it is retried on the next offer.

## Minor

10. `src/net/pairing.ts` near 102: give `bye` a moment to go out before `leave()` (await the send where the link returns a promise, with a short cap).
11. Move `DEFAULT_LEAD_SEC` (`room.ts` near 51) and the approach-ring lead in beats (`src/stage/art/marks.ts` near 207) into `src/core/tunables.ts` (`startLeadSec`, `ringLeadBeats`), included in `validateTunables` and the debug overlay.

## Tests to add (unit, with the fake clock, memory hub and loopback)

One or more per item: same song re-offered with a new BPM/offset (guest reapplies, gate resets); offset re-converges after a host clock jump and a rematch re-syncs; a long or control-character name is cleaned; out-of-range tunables, theme BPM/offset and bad `firstPhrase` rejected; commit with out-of-range slot or position, duplicate slots, too many strikes; `state` with malformed `players`; `plant` with `strike: null`; a throwing listener does not stop others; rematch requested, back to the room, theme changed, peer's rematch arrives: no start and no double start handler; a stalled transfer does not lock Start; a failed song send is retried; pairing closure still detected when `bye` is lost; the Trystero link reaches `failed` on a connect error (stub the join function; restructure for injection if needed).

## Checks that must pass

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm e2e` (all 25 tests, two green runs in a row; about 5.5 minutes each), `pnpm exec prettier --check src tests dev playwright.config.ts`. Never weaken an existing test. Leave nothing running.

## Report (under 350 words)

Per item: fixed (with the test's name), partly fixed, or not fixed and why. Anything you found that the review got wrong. Check results.
