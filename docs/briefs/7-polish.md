# Brief 7: launch polish (calibration, phones, CSP check)

**Goal.** The last pieces before a playtest: the input calibration screen, phone support in landscape with a "turn your phone sideways" prompt, and proof that the built site works under its strict Content-Security-Policy.

**Read first:** `CLAUDE.md`, `docs/DESIGN.md` (Phones; states with no mock), `docs/DEPLOY.md` (the CSP section) and `public/_headers`, `src/app/*`, `src/scenes/*`, `src/ui/*`, `src/stage/stage.ts`, `src/stage/layout.ts`, `src/input/pointer.ts`, `src/audio/engine.ts`, `src/audio/sfx.ts`, `src/audio/tempo.ts` (`tapError`-style helpers), `src/theme/metronome.ts`, `src/core/session.ts` (`inputOffsetMs`), `src/data/store.ts` (`SETTINGS.inputOffsetMs`), `tests/e2e/*`, `playwright.config.ts`.

**Files you own:** `src/scenes/**`, `src/app/**`, `src/ui/*.ts` (top level), `src/style.css`, `src/main.ts`, `index.html`, `tests/e2e/**`, `playwright.config.ts`, `public/_headers` (only if the CSP check proves a directive must change; explain why), `docs/DEPLOY.md` (only the lines describing such a change), unit tests for pure helpers. Small fixes elsewhere in `src/` (not `src/core`, `src/net`) are allowed when a check requires them; list each.

## 1. Input calibration

- A scene reachable from the title ("Calibrate timing") and from the lobby: a metronome click plays at 100 BPM on the audio clock (look-ahead scheduling as in `src/theme/metronome.ts`), a pulsing ring shows the beat, and the player taps or clicks a big target along with it. Clicks are stamped with `clock.timeOfEvent`. After 8 taps show the average offset ("You tap 34 ms late") and its spread; keep a running estimate over the last 16 taps, discarding taps more than 200 ms from a beat. Buttons: "Use this" (stores the rounded mean in `SETTINGS.inputOffsetMs`), "Reset to 0", fine adjust −5 / +5 ms, "Done". Explain in one typed note why: "Speakers, Bluetooth and screens add delay. Tap along so the game can allow for it."
- The stored offset is loaded at start-up and passed to every `DuelSession` (`inputOffsetMs`), for bot and room matches. Show the current value in the debug overlay next to the measured offset.
- Pure helper `estimateOffset(taps: number[], grid): { meanMs: number; spreadMs: number; used: number } | null` with unit tests (steady late taps, early taps, outliers dropped, wrap-around near half a beat, too few taps).

## 2. Phones and touch

- Landscape only. In portrait on a touch device show a full-screen prompt in the design vocabulary: "Turn your phone sideways" (with a simple rotating-phone drawing in CSS or SVG); the game continues underneath and the prompt goes away on rotation. Do not use the Screen Orientation lock API.
- The same 1280x720 layout scaled to fit; respect safe-area insets (`env(safe-area-inset-*)`); `touch-action: none` on the stage; no page scroll, pinch-zoom or pull-to-refresh during a match (`overscroll-behavior: none`, viewport meta); no text selection or long-press callout on the stage.
- Tap targets: every button at least 44 CSS px high **after scaling**. On small screens the overlay scale is below 1, so add a "compact" mode: when the scale would make a 44 px control smaller than 44 CSS px, enlarge the controls' design size (a root CSS variable such as `--tt-ui-scale` applied to the kit's buttons, inputs and tabs) and check the title, lobby, victory and calibration screens still fit. The workshop and theme screens may scroll inside their panels in compact mode.
- No hover-only affordances anywhere: anything shown on hover must also be visible or reachable by tap.
- Parry radius on touch is already larger (`targetRadiusTouch`); make sure the duel passes `touch: true` for touch pointers end to end and the drawn target matches.
- On touch the puppet's tip follows the finger while down and stays put when lifted (verify; fix if not).
- Audio unlock: the first tap on any screen resumes the audio context (iOS requires a gesture); if the context is `suspended` when a match is about to start, show "Tap to turn the sound on" and wait.
- A wake lock (`navigator.wakeLock`) during a match where available, released afterwards; failures ignored silently.

## 3. CSP check

Add an e2e spec `tests/e2e/csp.spec.ts` that serves the built site with the exact headers from `public/_headers`: parse the file in the test and apply the `Content-Security-Policy` (and the other headers) to every response with `page.route('**/*', route => route.fetch().then(r => route.fulfill({ response: r, headers: {...} })))` or an equivalent that really enforces the policy in Chromium. Under that policy: the title loads with fonts and the stage; a bot match runs to victory; the workshop opens, a stroke is drawn and saved; the theme screen opens and an uploaded WAV gets its tempo detected (this exercises the `blob:` worker); a two-tab room connects and starts. Fail on any `securitypolicyviolation` event (collect them with an init script) and on console errors. Fix violations in app code where possible (for example replace inline `style="…"` attributes in markup strings with classes or CSSOM `element.style` assignments, and confirm `pixi.js/unsafe-eval` is imported); only loosen `public/_headers` when there is no reasonable code fix, and then with the narrowest directive (for example `style-src-attr 'unsafe-inline'`), updating the matching explanation in `docs/DEPLOY.md`.

## 4. Phone-sized run

Add `tests/e2e/phone.spec.ts` using a landscape phone viewport with touch (for example 844x390, `hasTouch: true`, `isMobile: true`): the title fits with no scrollbars; measured button heights are at least 44 px; a bot match can be started by tap, a tap plants a strike, and the match autoplays to victory; in a portrait viewport the rotate prompt is shown. Save `test-results/screens/phone-title.png`, `phone-duel.png`, `phone-rotate.png` and look at them.

## Checks that must pass

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm e2e` (all specs, three green runs in a row), `pnpm exec prettier --check src tests dev playwright.config.ts`. Leave nothing running. You are the only agent in the repo.

## Report (under 300 words)

What you built, CSP violations found and how each was resolved (and the final CSP if it changed), phone screenshots described, check results, and what needs a real phone or a person.
