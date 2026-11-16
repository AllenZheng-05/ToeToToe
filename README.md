# Toe to Toe

A two-player browser rhythm duel. Each player is a sock puppet with a sword in its mouth; one plants a phrase of strikes on the beat, and a phrase later the other must parry them in the same places and rhythm.

## Getting started

```
pnpm install
pnpm dev
```

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

See `docs/` and `CLAUDE.md` for the design, architecture and working rules.
