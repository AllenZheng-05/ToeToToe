# Decisions

Engineering calls made during the build, newest last. Each has its reason. Items Allen may want to revisit are also listed in `docs/MORNING_REPORT.md`.

## Milestone 0

1. **pnpm 10.34.6 was already installed**, so no corepack step or npm fallback was needed. Node is 22.13.1.
2. **Versions pinned from npm on 16 Nov 2026**, newer than the brief's figures: Vite 8.3.8, TypeScript 6.0.3 (7.0.2 is current, but typescript-eslint 8.72.2 only accepts TypeScript below 6.1), Vitest 5.1.0, ESLint 10.15.0, PixiJS 8.23.0, Trystero 0.27.0, Playwright 1.65.1. Where current docs differ from the brief, the docs win.
3. **DNS is on Cloudflare** (Allen said so when starting the run), so `docs/DEPLOY.md` leads with Cloudflare Pages and keeps the other case short.
4. **The orchestrator wrote `src/core/types.ts`.** It is types only (the interfaces every brief depends on). Writing it once centrally was cheaper and safer than having a subagent transcribe it. All runtime code is written by builders.
5. **Count-in and intermission are not reducer phases.** `DuelState.phase` is `attack`, `defend` or `matchOver`; the count-in is the clock not having reached `state.phrase` yet. Fewer states to keep in sync across two browsers.
6. **Only the active player of a phrase generates duel events** (attacker: plant, commit; defender: parry, resolve). Both browsers therefore apply identical event sequences without a lockstep protocol. The host still sends full state after each resolve as the authority.
7. **Acts end only at the end of a defend phrase.** Health can reach 0 mid-phrase; the phrase plays out. Keeps act scoring on a clean boundary both browsers agree on.
8. **A tie on time plays on.** The brief says the higher health wins after 90 seconds and does not cover equal health. Further turns are played until health differs.
9. **Winded applies to the next whole defend phrase.** If stamina hits 0 in the middle of a defend phrase, that phrase is not doubled; the next one the player defends is, and afterwards stamina resets to 50.
10. **Early clicks.** A click on a target more than `missWindowMs` (200 ms) early is ignored; inside that but outside the Good window is a Miss. The brief says only "later, earlier, or not clicked".
11. **Distance cost of a strike** scales linearly up to `strikeDistanceForMaxCost` (0.6 of the play-area width) from the previous strike of the same phrase; the first strike of a phrase pays only the base cost.
12. **The bot is a second `DuelSession` on an in-memory loopback**, not a special code path, so bot matches exercise the real protocol.
13. **Between acts there is a 2-phrase intermission and then the count-in**; the music keeps playing so the beat grid never restarts.
14. **Custom subagent types were not loadable mid-session**, so every subagent is a general-purpose agent with the model set (`sonnet`, `haiku`, `opus`) and the role text pasted into its brief, as the kickoff brief allows. The definitions in `.claude/agents/` are in place for future sessions.
15. **Task briefs are kept in `docs/briefs/`** so a resumed session can see exactly what each task was asked to do.
16. **Play area is x 200, y 163, 880 by 440 design pixels** (2:1, bottom edge on the ledge top). `docs/DESIGN_SPEC.md` found that the fully open stage between the tapering curtains is only about 740 by 370, but the mocks place strikes and targets well outside that, and targets are interface elements drawn in front of the curtains, so the larger rect matches the mocks. Its top corners overlap the curtains.
17. **Input grace (`inputGraceMs`, 60 ms).** A strike is auto-missed only 60 ms after its Good window closes, so a click stamped in time but handled a frame or two late still counts. Found by the reviewer.
18. **Early click on slot 0 is held.** A click that rounds to slot 0 of the player's coming attack phrase, made just before the phrase starts, is held and planted when the phrase begins instead of being dropped.
19. **Trystero 0.27 ships only the Nostr strategy in its main package**; other strategies are separate packages. `LinkStrategy` is therefore `'nostr'` only for now, still a config value.
20. **Placeholder "March" track is 12 bars, not 16**, to stay under 1.5 MB as an uncompressed WAV.
21. **Target radius default is 0.05 of the play width** (0.075 on touch), down from the brief's "about 6%", because the mocks draw targets at 44 px on an 880 px play area and what is drawn must equal what is judged. Tunable.
22. **Puppet pose model.** The head pin sits on a circle around the sword tip, nearest a rest point above the base, so an idle puppet has an upright neck and a near-horizontal sword as in the mocks; the body is a cubic curve that bows rather than compresses. The white edge and shadow wrap the whole puppet (three layers: shadows, edges, faces), all baked.
23. **Standalone components first, scenes second.** The workshop, theme picker, account panel, art kit and UI kit were each built and browser-checked on their own dev page (`/dev/*.html` under `pnpm dev`), in parallel, then wired into scenes one task at a time. The dev pages stay in the repo as a visual test bench; they are not part of the production build.
24. **The opponent's pointer is not sent over the network.** The opponent's sword tip eases toward its latest strike or parry instead. A low-rate cursor message could be added later if the puppets feel lifeless.
25. **Content-Security-Policy has no `unsafe-eval`**; the app imports PixiJS's `pixi.js/unsafe-eval` polyfill instead. `worker-src` allows `blob:` because the beat detector starts its worker from a blob URL.
26. **Render resolution drops by half on slow machines.** After about 20 slow frames in a row the stage renders at half resolution so input stays on time (found on headless software rendering, where a full-screen layer cost 35 ms). `?res=1` pins full resolution. The static back and front of the theatre are baked into two cached textures.
27. **Scripted test clicks call the session directly at the exact slot time**, as the bot does, instead of going through DOM pointer events, because headless rendering delayed the events past the timing window. A separate browser test still clicks through the real pointer path.
28. **The HUD banner and act counter fade when a strike or target sits under them**, since positions are free across the play area.
29. **Theme gating lives in the lobby screen, not in `Room`.** The guest cannot be Ready until the host's theme has loaded on its side, and Start needs the guest's confirmation; a modified client could skip this, which only hurts its own match.
30. **Title differences from the mock.** The tape quip is dropped and there is no "Themes" button on the title (the theme is chosen by the host in the lobby). "Practise against the bot" and "Puppet workshop" sit on the sign.
31. **Account sync runs when the workshop closes**, not on each Save, because the workshop has no save event.
