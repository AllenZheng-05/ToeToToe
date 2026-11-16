# Brief 10: the bot match set-up screen

**Goal.** Allen's request: changing the battle theme for a bot match currently means creating a room, changing it there and leaving. Instead, "Play against the bot" opens a set-up screen where the player chooses the battle theme, their puppet, the bot's puppet and the bot's difficulty, then starts. The screen is built so more bot and practice settings can be added later as new rows.

Decisions already made with Allen (do not revisit):

- The title button "Practise against the bot" is renamed **"Play against the bot"** (everywhere: UI, tests, docs other than `docs/KICKOFF.md` and `docs/briefs/`).
- It opens the set-up screen; it no longer starts a match directly.
- There is still **one selected theme**, shared with rooms (the store's existing selected theme). Changing it here changes the default for a new room too.
- **Rematch** on the victory screen after a bot match reopens the set-up screen with every setting as it was. No theme button on the victory screen.
- Bot difficulty and bot puppet are in this version.
- The `?bot=1` URL parameter stays as a shortcut: the first click starts a bot match straight away with the saved set-up, skipping the screen (the browser tests rely on it). `?botAccuracy=` still overrides the difficulty when present.

**Read first:** `CLAUDE.md`, `docs/DESIGN.md`, `docs/DESIGN_SPEC.md` (lobby screen), `src/scenes/title.ts`, `lobby.ts`, `botMatch.ts`, `duel.ts`, `victory.ts`, `themeScene.ts`, `workshopScene.ts`, `menuPuppets.ts`, `types.ts`, `src/ui/menu.ts`, `src/ui/kit/kit.ts`, `src/app/app.ts`, `src/app/params.ts`, `src/net/bot.ts` (how accuracy is used), `src/puppet/presets.ts`, `src/workshop/selection.ts`, `src/theme/theme.ts` and `picker.ts`, `src/data/store.ts` (settings), `tests/e2e/bot-match.spec.ts`, `phone.spec.ts`, `csp.spec.ts`.

**Files you own:** `src/scenes/**` (new `botSetup.ts` and a pure `botSetupModel.ts`), `src/app/**`, `src/ui/*.ts`, `src/style.css`, `src/ui/kit/*` (small additions only), `src/theme/picker.ts` and `src/scenes/themeScene.ts` / `workshopScene.ts` (only to allow a third place to return to and wording that fits, e.g. the back button must not say "Back to the room" when opened from here), `src/data/store.ts` (only a new settings key), `src/net/bot.ts` (only if a difficulty needs more than the accuracy number; say why), `src/debug/**`, tests, and the non-historical docs that name the button. Nothing in `src/core`. You are the only agent in the repo.

## The screen

Same vocabulary and layout approach as the lobby: the sign carries the heading ("Play against the bot"), rows are taped strips, the two puppets stand on the stage (yours on the left, the bot's on the right, updating as choices change), the main action is on the ledge. It must fit and stay tappable (44 px) at phone size in compact mode like the other menus.

Rows:

1. **Battle theme:** the current theme's title and tempo (same text as the lobby's theme row), and "Change", which opens the existing theme screen and returns here on Done or Back. The host-only restriction of that scene does not apply here; there is no room.
2. **Your puppet:** the puppet's name, and "Edit", which opens the workshop and returns here.
3. **Bot's puppet:** a choice among the four presets (a row of small swatches or names, the current one marked), plus "Surprise me" (a random preset each match; use an injected random source, not in `src/core`). Default: the current behaviour (pink, or teal if the player's own is pink).
4. **Bot difficulty:** three labelled steps, "Easy", "Medium", "Hard", one marked. Map them to bot accuracy values in one place in `botSetupModel.ts` (look at what the default `botAccuracy` is today and make "Medium" equal to it; choose Easy and Hard so the difference is clearly felt, and say what you chose). If the bot has other knobs worth tying to difficulty (for example how many strikes it plants, how far apart), you may map those too, but only through parameters `BotDriver` already has or a minimal, tested addition.

Actions: **"Start"** (ledge, primary) and **"Back to title"**. "Calibrate timing" does not need to be here.

If the audio context is suspended the existing "Tap to turn the sound on" gate applies before the match starts, as elsewhere.

## The model

`src/scenes/botSetupModel.ts`, pure and unit tested:

```ts
export type BotDifficulty = 'easy' | 'medium' | 'hard';
export interface BotSetup {
  version: 1;
  difficulty: BotDifficulty;
  /** A preset id, or 'surprise'. */
  botPuppet: string;
}
export const DEFAULT_BOT_SETUP: BotSetup;
/** Anything stored is untrusted: unknown fields dropped, bad values replaced by defaults. */
export function parseBotSetup(raw: unknown, presetIds: readonly string[]): BotSetup;
export function accuracyFor(d: BotDifficulty): number;
export function resolveBotPuppet(setup: BotSetup, presetIds: readonly string[], playerPresetId: string | null, random: () => number): string;
```

Saved under one new settings key in the store whenever a row changes, loaded when the screen opens, so it survives rematches and reloads. The theme and the player's puppet are not duplicated into it; they stay where they are saved now. Design it so a later setting is one more optional field with a default (old saved records must still parse).

## Flow changes

- Title: the renamed button opens the set-up scene.
- Bot match: built from the set-up (accuracy, bot puppet through `MatchSetup.puppets`, the selected theme, the selected player puppet). `?botAccuracy`, `?bpm`, `?seed`, `?autoplay` keep working as overrides.
- Victory after a bot match: "Rematch" goes to the set-up scene (settings intact); "Back to title" unchanged. Room matches are unchanged.
- `window.__ttt` in debug mode exposes the current bot set-up for tests.

## Tests

- Unit: `parseBotSetup` (good record, junk, unknown preset, missing fields, future extra field), `accuracyFor`, `resolveBotPuppet` (explicit, surprise with a fixed random, the default not matching the player's preset).
- Browser (`tests/e2e/bot-match.spec.ts`; update existing tests only where the button name or the extra screen requires it, never to check less): title → "Play against the bot" → the set-up screen shows the four rows; choose Hard and a different bot puppet; Change theme → pick a house track → back on the set-up screen with the new theme text; Start → the match runs with that theme's tempo, that accuracy and that bot puppet (read from `window.__ttt`); play to victory with autoplay; Rematch → the set-up screen again with Hard, the same bot puppet and theme; reload the page → open set-up → still the same. `?bot=1` still starts directly.
- Add the set-up screen to `tests/e2e/phone.spec.ts` (fits, buttons at least 44 px) and one pass through it under the CSP spec if that is cheap.
- Screenshots `test-results/screens/bot-setup.png` and `phone-bot-setup.png` (with `?res=1`); open them with your image-reading tool and iterate until the layout is tidy: nothing overlapping the puppets' heads or the sign, rows aligned, the marked choices obvious.

## Checks that must pass

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm exec prettier --check src tests dev playwright.config.ts`, `pnpm e2e` (all tests, two green runs in a row; about 6 minutes each). Never weaken a test. Leave nothing running; a dev server on port 5173 belongs to Allen, leave it alone.

## Report (under 300 words)

What you built, the difficulty mapping you chose, what the screenshots show, changes to existing tests, check results, and what a person should judge.
