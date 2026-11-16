# Brief 9: whose turn it is, and whose marks are whose

**Goal.** Two pieces of playtest feedback from Allen:

1. "There needs to be something that indicates whose turn it will be before the round starts and whose turn it currently is."
2. "We need something to differentiate between the buttons placed by you and placed by your opponent. Maybe taking the most used color from your sock puppet characters and then also giving them a slightly different outline as well."

("Buttons" are the numbered strike and target discs.) Display only: no rule, protocol or `src/core` change.

**Read first:** `CLAUDE.md`, `docs/DESIGN.md`, `docs/DESIGN_SPEC.md` (the duel screens), `src/stage/art/marks.ts` (note the recent change that turns a strike into a ringed target for the defender-to-be during the attack phase), `src/stage/art/fit.ts`, `src/stage/duelRenderer.ts`, `src/ui/hud.ts`, `src/ui/kit/kit.ts` (`playerPlate`, `banner`, tags), `src/scenes/duel.ts`, `src/scenes/types.ts`, `src/core/types.ts` (`DuelView`), `dev/artkit.ts`, `tests/unit/hud.test.ts`, `tests/e2e/bot-match.spec.ts`.

**Files you own:** `src/stage/art/marks.ts`, `src/stage/art/fit.ts`, `src/stage/duelRenderer.ts`, `src/ui/hud.ts`, `src/ui/kit/kit.ts` and `kit.css` (small additions only), `src/style.css`, `src/scenes/duel.ts`, `src/scenes/types.ts`, a new pure module `src/puppet/colour.ts`, `dev/artkit.ts`, unit tests, `tests/e2e/bot-match.spec.ts` (additions only). Nothing in `src/core` or `src/net`. You are the only agent in the repo.

## 1. Whose turn

Everything derives from `DuelView` each frame (`phase`, `attacker`, `localPlayer`, `localActive`, `countInBeatsLeft`, `slotPosition`); the HUD holds no rules.

- **Before the round (count-in and intermission):** alongside the count-in number, a line in the banner area says who attacks first: "You attack first" or "NAME attacks first". During an intermission, after the "NAME takes the act" banner, the same line for the next act.
- **During play, on the plates:** the plate of the player acting now carries a clear role tag, "Attacking" or "Parrying", and is visibly lit (for example lifted, with a coloured tape edge in that player's mark colour, see part 2); the other plate is dimmed slightly and tagged "Watching". Use the kit's tag vocabulary; keep the existing "you" and "Winded" tags and every existing `data-testid`. Add `data-testid="turn-0"` / `turn-1` on the role tags with `data-value` of `attacking`, `parrying`, `watching` or `waiting` (count-in, intermission).
- **On the stage:** a simple pointer to the acting puppet, for example a small cardboard arrow or a spotlight pool above it, baked once and only moved or shown per frame (no per-frame filters or texture creation).
- **Next up:** in the last beat of a phrase, the phrase-dots label (now "YOUR ATTACK, IN HALF-BEATS") or a small note announces what comes next for the local player: "Get ready to parry", "Your attack next", "NAME parries next". Keep it short and out of the way of the marks. The label itself should always say plainly what is happening now for the local player: "Your attack", "NAME's attack: watch", "Your parry", "NAME parries".
- Keep the banner words ("ATTACK!", "PARRY!", "WATCH") as they are.

## 2. Whose marks

- **Colour.** New pure function in `src/puppet/colour.ts`: `dominantColour(pixels: Uint8ClampedArray, width: number, height: number): { r: number; g: number; b: number } | null`, the most used colour of a drawing: ignore transparent pixels (alpha below 128), near-black and near-white pixels (outlines, eyes) and very unsaturated greys; bucket the rest coarsely (for example 4 bits per channel, or by hue), take the fullest bucket and return the mean colour of its pixels; null if nothing qualifies. Plus `puppetMarkColour(parts)`: run it over the sock and head pixels together (sock first in weight), fall back to the brief's yellow when null. Plus `distinctColours(a, b)`: if the two players' colours are too close to tell apart (pick a simple distance in a perceptual-ish space and a threshold, unit tested), shift the **opponent's** hue (the local player keeps their own) far enough to differ. Plus a helper that picks ink or white for the numeral by contrast with the disc colour. All pure, unit tested with synthetic pixel arrays (single colour, two colours with a majority, mostly outline, fully transparent, greys only, near-identical pair).
- **Where it is computed.** Once per match in `src/scenes/duel.ts` (or the renderer's set-up) from the two puppets' decoded drawings (read the pixels once through a canvas), giving `markColours: [colour0, colour1]`. Never per frame.
- **Textures.** `marks.ts` bakes its disc textures per player at set-up: strike, newest strike and target discs in that player's colour, with the numeral in the contrasting colour. A mark always carries the colour of the player who planted it, both as a strike during the attack and as a target during the parry (the planter is `view.attacker` in both phases). Parried and missed discs stay as they are (green tick, grey cross).
- **Outline.** Besides colour, the outline differs by whose it is from the viewer's side, so the difference survives similar colours and colour blindness: marks the local player planted keep the current outline; marks the opponent planted get a visibly different one in the same cut-paper vocabulary (for example a dashed or scalloped ink edge, or a double white-and-ink ring). Choose what reads best at 44 px and at phone size; bake it.
- The joining line between strikes and the dotted order line take the planter's colour too (they are redrawn only when points change; keep that).
- The acting plate's tape edge (part 1) and a small swatch on each plate use the same colours, so a player learns "that colour is me".
- `MarksView.update` needs to know the planter and the viewer: pass what it needs in `opts` (for example `{ planter: PlayerId, local: PlayerId }`) or read them from the view. Update `dev/artkit.ts` to show both players' sets side by side.

## Checks and verification

- Unit tests for `src/puppet/colour.ts` and for the HUD's turn tags and labels in each phase (extend `tests/unit/hud.test.ts`).
- In `tests/e2e/bot-match.spec.ts` add (do not change existing assertions): the `turn-*` values are right during count-in, the local attack and the local parry; screenshots `test-results/screens/turns-countin.png`, `turns-attack.png`, `turns-parry.png` taken with `?res=1`. Open them with your image-reading tool and check: it is obvious at a glance whose turn it is; the two players' marks are clearly different in colour and outline; numerals are legible on both colours; nothing overlaps the plates or banner badly. Iterate until they read well, and also look at one phone-sized capture (844x390).
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm e2e` (all tests, two green runs in a row; about 6 minutes each), `pnpm exec prettier --check src tests dev playwright.config.ts`. Never weaken a test. Leave nothing running.

## Report (under 300 words)

What you built, the outline style and colour rules you chose and why, what the screenshots show, check results, and what a person should judge.
