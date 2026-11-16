# Morning report

_Kept current during the run. If the session was cut off, `docs/ROADMAP.md` shows the exact task it stopped on._

## State

- **Milestone 0 (repo setup): done.**
- **Milestone 1 (duel against a bot): code complete and unit tested; browser smoke test in progress (task 1.6).**
- **Milestone 2 (two players): transport, pairing, room handshake, clock sync and the Trystero link are built and unit tested; the lobby screens and the two-window browser check are next (task 2.3).**
- **Milestones 3 to 6:** groundwork built ahead in parallel (design spec, puppet rig and presets, local store, placeholder tracks, song checks, tempo helpers, Supabase migration and guide). Stage art kit and UI kit in progress.
- Nothing has been pushed or deployed.

## Finished and verified

| What | How it was verified |
|---|---|
| Duel rules (`src/core/duel.ts`), beat maths, tunables | Unit tests on every rule; independent review by the opus reviewer found the rules match the brief line by line |
| `DuelSession`, in-memory loopback, bot | Full best-of-three matches on a fake clock with 0, 150 and 350 ms of simulated lag end in identical states on both sides; bot against bot |
| Audio clock, click track, pointer mapping | Unit tests of the pure parts. The parts that need a browser and speakers are covered only by the browser smoke test |
| Pairing transport, room codes, room handshake, clock sync | Unit tests with an in-memory hub, including a full match between two sessions whose clocks differ by 1234.5 s over a 40 ms link |
| Local store, placeholder tracks, song file checks, tempo helpers | Unit tests (IndexedDB through `fake-indexeddb`) |
| Puppet rig maths, four presets, drawing validation | Unit tests |

## Not verified (needs you)

- The Trystero (WebRTC) connection has never been run: it needs two browsers on the public network.
- Real tempo detection on a real song.
- Everything about feel: timing windows, how the click track sounds, latency on your hardware.
- The Supabase migration has not been run against a database.

## Parked

Nothing yet.

## Decisions you might disagree with

See `docs/DECISIONS.md` for all of them with reasons. The ones most worth a look: 7 to 11 (rule clarifications), 16 (play area size), 17 and 18 (input grace and early clicks).

## Blocked by permissions or network

- Custom subagent types in `.claude/agents/` could not be loaded mid-session; general-purpose agents with the model set were used instead (allowed by the brief).

## Models used

- Orchestrator: Fable (this session).
- Builders: `sonnet` (general-purpose agents with the builder role text).
- Helpers: `haiku` (docs split, scaffold).
- Reviewer: `opus`.

## How to run

```
pnpm install
pnpm dev            # http://localhost:5173
```

- Bot match: open `http://localhost:5173/?debug=1` and press "Practise against the bot".
- Debug overlay: add `?debug=1` to any URL. It has every tunable as a live number input.
- Useful parameters: `bot=1` (first click starts a bot match), `autoplay=1` (a bot plays your side too), `bpm=140`, `seed=7`, `botAccuracy=0.5`, `tunables={"startHealth":30}`.
- Two windows playing each other: to be filled in when task 2.3 lands.

## Playtest checklists

To be written per milestone once each is browser-verified.
