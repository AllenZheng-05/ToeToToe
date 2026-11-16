# Roadmap

Status of every milestone and task. A fresh session resumes from here: read `CLAUDE.md`, this file, `docs/MORNING_REPORT.md`, then continue with the first task not marked done.

Status key: `[ ]` not started, `[~]` in progress, `[x]` done and verified, `[!]` parked (see morning report).

Agents: **B** builder (sonnet), **H** helper (haiku), **R** reviewer (opus), **O** orchestrator.

## Milestone 0: repo setup

- [x] 0.1 O: agents, `CLAUDE.md`, `src/core/types.ts`, `ARCHITECTURE.md`, `ROADMAP.md`, `DECISIONS.md`
- [x] 0.2 H: split the brief into `GAME.md`, `DESIGN.md`, `NETWORKING.md`, `DATA.md`, `DEPLOY.md` (parallel with 0.3)
- [x] 0.3 H: scaffold Vite, strict TS, ESLint, Prettier, Vitest, `.gitignore`, README, CI (parallel with 0.2)
- [x] 0.4 O: verify checks, first commit including `design/` and the brief

## Milestone 1: the duel against a bot

- [x] 1.1 B: `src/core/` tunables, beat maths, duel reducer, judging, unit tests (parallel with 1.2)
- [x] 1.2 B: `src/audio/` engine, audio clock, generated click track; `src/input/pointer.ts` (parallel with 1.1)
- [~] 1.3 B: `DuelSession`, in-memory loopback, bot, two-session tests on a fake clock (after 1.1)
- [ ] 1.4 B: app shell, plain-shapes Pixi stage drawing a `DuelView`, bars, debug overlay, bot match end to end (after 1.2, 1.3)
- [ ] 1.5 R: review of core and session; fixes
- [ ] 1.6 B: Playwright smoke: a bot match runs to a victory with no console errors

## Milestone 2: two players

- [ ] 2.1 B: BroadcastChannel loopback transport, room codes, `room.ts` handshake and clock sync, protocol tests
- [ ] 2.2 B: Trystero peer transport (strategy as config), room full, leaving
- [ ] 2.3 B: lobby flow (create, join, waiting, ready, start, rematch, friend left)
- [ ] 2.4 B: Playwright two-window check playing a full act
- [ ] 2.5 R: review

## Milestone 3: the final design

- [ ] 3.1 B: asset pipeline, baked cutout textures, stage layers, scaling
- [ ] 3.2 B: puppet rig (segments, pins, sword tip at pointer), preset puppets as bitmaps
- [ ] 3.3 B: targets, strikes, banners, bars, phrase dots, asides
- [ ] 3.4 B: title, lobby and victory screens from the mocks; self-hosted fonts
- [ ] 3.5 O/R: screenshots compared with `design/screenshots/`

## Milestone 4: the workshop

- [ ] 4.1 B: drawing editor (tools, undo, guides, preview), four presets
- [ ] 4.2 B: IndexedDB saving, saved-puppet row, sending drawings to the other player with validation

## Milestone 5: songs

- [ ] 5.1 B: placeholder loop generator script, `public/tracks/tracks.json`, `TrackSource`
- [ ] 5.2 B: battle theme screen, upload limits, tempo detection, nudges, tap-along, preview with click
- [ ] 5.3 B: local saving, sending the song peer to peer with progress and hash check

## Milestone 6: accounts

- [ ] 6.1 B: Supabase migrations, guest sign-in, puppet sync, sleeping-database fallback, `docs/SUPABASE.md`

## Milestone 7: launch polish

- [ ] 7.1 B: phone layout, touch, rotate prompt
- [ ] 7.2 B: input calibration screen
- [ ] 7.3 B: remaining unmocked states
- [ ] 7.4 H: deployment config, CSP, `docs/DEPLOY.md`, `docs/ASSETS.md`

## After everything

- [ ] Reviewer pass over the whole codebase against the timing rules
- [ ] Extra test coverage for duel rules and protocol
- [ ] Final morning report
