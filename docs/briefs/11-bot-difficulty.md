# Brief 11: four bot difficulties, attack patterns, and tiredness

**Goal.** Bot difficulty today only changes the chance of a parry. Allen wants difficulty to change the attacks too, a fourth level "Expert", and bots that tire during an act so long games pay off. Everything below was agreed with him; build it as written.

**Read first:** `CLAUDE.md`, `docs/GAME.md` (stamina, Winded, acts), `src/net/bot.ts`, `src/core/tunables.ts`, `src/core/duel.ts` (strike cost, `plantError`, Winded, regeneration), `src/core/session.ts` (`view()`, what the bot can read), `src/core/beat.ts`, `src/scenes/botSetupModel.ts`, `botSetup.ts`, `botMatch.ts`, `tests/unit/bot*.test.ts`, `tests/unit/botSetupModel.test.ts`, `tests/e2e/bot-match.spec.ts`.

**Files you own:** `src/net/bot.ts` (and new files beside it, e.g. `src/net/botPatterns.ts`, `src/net/botDifficulty.ts`), `src/scenes/botSetupModel.ts`, `botSetup.ts`, `botMatch.ts`, `src/style.css` (set-up screen only), `src/debug/**` (expose what tests need), tests. `src/core` is read-only, except that you may add a pure, tested read-only helper or getter if the bot cannot otherwise learn something both players can see (say what and why). The bot keeps playing through `DuelSession.pointerDown` only, uses no timers, and stays deterministic for a given seed. You are the only agent in the repo.

## Levels

`BotDifficulty` becomes `'easy' | 'medium' | 'hard' | 'expert'`. One table (in `src/net/botDifficulty.ts`, re-exported or used by the set-up model) holds everything per level, so a fifth level is one more row:

| | Easy | Medium | Hard | Expert |
|---|---|---|---|---|
| Attack menu | Steps only | Steps, Stroll, sometimes Syncopated | Any pattern, at random | Any pattern, chosen on purpose |
| Rhythm | On the beat only | Mostly on the beat; half-beats allowed | Anything | Anything |
| Own stamina | Not considered beyond what the pattern costs | Same | Picks only what it can afford; Breather when low | Same, and never ends a phrase Winded |
| Parry chance, fresh → tired | 0.50 → 0.35 | 0.75 → 0.55 | 0.90 → 0.68 | 0.97 → 0.72 |
| Bravo share of parries, fresh → tired | 0.20 → 0.10 | 0.40 → 0.20 | 0.60 → 0.30 | 0.85 → 0.40 |

A saved set-up with an unknown difficulty still parses to the default (Medium); old saved records keep working.

## Attack patterns

Each attack phrase the bot picks one named pattern and turns it into planned clicks. Costs come from the real tunables (compute a pattern's stamina cost with the same formula the rules use, do not hard-code the estimates below), and slot counts adapt to `slotsPerBeat` / `beatsPerPhrase`.

| Pattern | What it is | Rough cost at default tunables |
|---|---|---|
| Steps | 2 to 3 strikes on the beat, short hops (about 0.10 to 0.20 of the width) | 25 to 35 |
| Stroll | 4 strikes on the beat, medium hops (0.15 to 0.35) | 50 |
| Syncopated | 4 to 5 strikes mixing beats and half-beats, medium hops | 55 to 70 |
| Leaps | 4 to 5 strikes far apart across the stage (0.45 to 0.60+) | 75 to 90 |
| Flurry | 6 to 8 consecutive half-beats in a tight cluster (hops under 0.08) | 60 to 75 |
| Zig-zag | 5 to 6 strikes alternating sides of the stage on half-beats | 90 to 100 |
| Breather | 1 to 2 strikes, used when stamina is low | 10 to 20 |

- A pattern generator is a pure function `(rng, tunables, startPoint) => { slot, x, y }[]`, positions inside the existing bounds (`X_MIN`.. etc.), unit tested for slot rules (Easy never produces an off-beat slot), counts, hop ranges and determinism.
- **Easy:** Steps only.
- **Medium:** Steps and Stroll mostly, Syncopated about one phrase in four.
- **Hard:** each phrase, list the patterns whose cost the bot can afford now (variants with fewer strikes count: a Flurry of 6 when 8 is too dear), pick one uniformly at random; if none is affordable, Breather. This is "whatever it feels like": sometimes 8 quick consecutive strikes, sometimes 5 far-apart ones.
- **Expert:** same patterns, chosen by simple readable rules using only what both players can see (both players' health and stamina, Winded, time left in the act):
  - opponent Winded or low on stamina (pick a threshold in the table): the most expensive affordable pattern;
  - a full phrase of misses would end the act (opponent's health at most strikes times `missDamage`, doubled when Winded): the pattern with the most strikes it can afford;
  - otherwise alternate between saving (a cheap pattern) and spending (Zig-zag, Leaps or a full Flurry) so that it can afford a big phrase every second or third turn;
  - never choose a pattern that leaves it at 0 stamina (which would make it Winded), unless the finishing rule applies.
  - Expert does not read the player's pointer or pending inputs.
- Today's bot plants strikes the rules may reject for stamina. After this change a planned pattern must always be affordable (check with the same cost function), so nothing is rejected.

## Tiredness

- Parry chance and Bravo share slide linearly from the fresh value to the tired floor over the first 70% of the act's length (`actDurationSec` from the tunables; put the 0.7 in the difficulty table as `tiredAtActFraction`), then stay at the floor. Time is the audio clock since the current act's first phrase began (derive it from the session's state and the beat grid; no timers, no frame counts).
- **Resets at the start of every act.** No carry-over between acts.
- **Invisible:** no tag, no HUD change. (In debug mode the overlay may show the current parry chance; nothing outside debug.)
- Attacks do not tire.
- A pure function `tiredness(level, secondsIntoAct, actDurationSec) => { accuracy, bravoRate }`, unit tested at 0, the midpoint, 70% and beyond, and after an act change.
- `?botAccuracy=` still overrides the parry chance: when present it is used as a constant (no tiredness on accuracy), as the browser tests rely on it. `BotOptions.accuracy` / `bravoRate` given explicitly by a caller behave the same way (constant), so existing unit tests keep their meaning.

## Set-up screen

- A fourth button "Expert". The difficulty row becomes two rows of two ("Easy", "Medium" / "Hard", "Expert"), like the puppet choices; the panel must still clear the stage and fit at phone size with 44 px buttons.
- `window.__ttt` in debug mode exposes the bot's level, its current pattern name, and its current parry chance and Bravo share, for tests.

## Tests

- Unit (fixed seeds, fake clock): each pattern's rules; Easy only on-beat over many phrases; Medium's mix; Hard never plans beyond its stamina and uses every pattern over a long run; Expert's four rules each trigger in a constructed state and it is never Winded by its own planting; no plant is ever rejected for stamina at any level over several full bot-versus-bot matches; tiredness values and the per-act reset; parsing of saved set-ups including 'expert' and junk.
- Bot versus bot sanity over many seeded matches on the fake clock: report the win rate of each level against the one below (Expert > Hard > Medium > Easy should hold clearly) and the average act length, and include those numbers in your report.
- Browser: the set-up screen shows four levels; choosing Expert starts a match whose bot reports level `expert`; an autoplay match against Easy and one against Expert both reach victory without console errors; phone fit test updated for the new row. Screenshot `test-results/screens/bot-setup.png` and the phone one refreshed and checked by eye.

## Checks that must pass

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm exec prettier --check src tests dev playwright.config.ts`, and the full `pnpm e2e` twice. Report exact pass counts for each run; if a test fails, give its name and assertion and rerun that file alone, reporting both results. Never weaken a test. Leave nothing running, including the preview server on port 4173; a dev server on 5173 belongs to Allen, leave it alone.

## Report (under 300 words)

What you built, any number you had to choose (thresholds, mixes), the bot-versus-bot win rates and act lengths, any core helper added, test changes, check results, and what a person should judge by playing.
