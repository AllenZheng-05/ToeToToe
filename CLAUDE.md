# Toe to Toe

A two-player browser rhythm duel. Each player is a sock puppet with a sword in its mouth; one plants a phrase of strikes on the beat, and a phrase later the other must parry them in the same places and rhythm. Static site, browser to browser, no game server. Deploys to `toetotoe.allenzheng.com`.

Stack: TypeScript (strict), Vite, pnpm, Vitest, ESLint, Prettier, PixiJS v8, Web Audio, Trystero (WebRTC), IndexedDB, optional Supabase, Playwright. Exact versions are pinned; never add `^` or `@latest`.

## Commands

```
pnpm dev          # dev server (http://localhost:5173)
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm test         # vitest run (unit + loopback protocol tests)
pnpm build        # production build to dist/
pnpm e2e          # Playwright two-window check (builds and previews first)
pnpm format       # prettier --write
```

`pnpm typecheck`, `pnpm lint` and `pnpm test` must pass before any commit. Never weaken or delete a test to get there.

## Timing rules (non-negotiable)

1. **All beat timing comes from the `Clock` interface** (`src/core/types.ts`). Production uses `AudioContext.currentTime`. Never time anything on the beat with `setTimeout`, `setInterval`, `Date.now`, `performance.now` or frame counts. Schedule audio ahead on the audio clock; derive beat position from the clock each frame.
2. **Duel rules are pure and deterministic**: `src/core/` has no DOM, no timers, no randomness, no I/O. State in, event in, state out. Tested with a fake clock.
3. **Every tunable number lives in `src/core/tunables.ts`** (type `Tunables`). No magic numbers for timing, damage or stamina anywhere else.
4. **Input**: Pointer Events only, one path for mouse and touch. Each `pointerdown` is stamped in audio-clock time when it arrives, then the input offset setting is applied.
5. **Nothing in a match depends on the database.** The game runs fully with no environment variables.
6. **The game talks to the other player only through `Transport`** (peer, loopback or bot).
7. Positions are fractions of the play area (0..1), never pixels, in state and on the wire.
8. Cutout outlines and shadows are baked into textures once, never applied as per-frame filters.

## Product rules

- Inputs in a match: pointer plus a single click or tap. No keyboard.
- Plain labels: "Health", "Stamina", "Create a room", "Join a room". Grades: "Bravo!", "Good", "Miss". Players choose their own display names.
- Desktop first; phones are landscape only.
- Data from the other player (drawings, songs) is untrusted: check type and size, decode with the browser's decoders.

## How work is organised

The main session (Fable) plans and orchestrates; subagents in `.claude/agents/` write code: `builder` (sonnet) for features, `helper` (haiku) for mechanical work, `reviewer` (opus) for read-only review. Every task gets a written brief naming the files it owns. Builders touch only their files. `src/core/types.ts` is the shared contract and is owned by the orchestrator.

One logical commit per accepted task. Do not push, deploy or log in to anything.

## Where things are

- `docs/ROADMAP.md`: milestone and task status. **Resume from here.**
- `docs/MORNING_REPORT.md`: current state for Allen, how to run and playtest.
- `docs/DECISIONS.md`: every engineering call and why.
- `docs/ARCHITECTURE.md`: modules, the duel timeline, who sends what.
- `docs/GAME.md`, `docs/DESIGN.md`, `docs/NETWORKING.md`, `docs/DATA.md`, `docs/DEPLOY.md`: the brief, split by topic.
- `docs/KICKOFF.md`: the original brief (historical).
- `design/`: reference mocks, screenshots and source art. Read-only; the app's copies live in `src/assets/`.
