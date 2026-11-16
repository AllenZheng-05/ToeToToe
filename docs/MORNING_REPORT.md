# Morning report

_Written 16 November 2026 at the end of the unattended run. `docs/ROADMAP.md` has the task-by-task status._

## State

All seven milestones are built and committed on `main`. Nothing has been pushed, deployed or logged in to.

The game runs end to end in a real browser (headless Chromium): a bot match, and two pages playing each other through a same-browser link that stands in for the network. The checks pass: typecheck, lint, 530 unit tests, the production build and 25 browser tests.

Three things have never run, because each needs something the run was not allowed to touch:

- **The real peer-to-peer connection.** The Trystero (WebRTC) link is written and reviewed against the installed library, but two browsers have never connected over the internet. This is the first thing to try.
- **Supabase.** The migration and the client are written; no project exists to run them against. The game does not need it.
- **How it feels.** Timing windows, the sound, latency on real speakers, drawing on a phone: nobody has played it.

A final review by the opus reviewer found 2 blockers and 7 should-fix items in the networking and lobby code. All were fixed and tested afterwards (see "Review findings"); the fixes themselves have not had a second review.

## How to run

```
pnpm install
pnpm dev            # http://localhost:5173
```

- **Bot match:** open `http://localhost:5173/` and press "Play against the bot", choose the battle theme, the puppets and the difficulty, then Start.
- **Two windows, no network:** open `http://localhost:5173/?net=tab`, press "Create a room", copy the link, and open it in a second window of the same browser, keeping `net=tab` in the query (`http://localhost:5173/CODE?net=tab`). Both windows must be visible: browsers slow down hidden tabs.
- **Two browsers over the real network:** the same without `net=tab`. Use two different browsers or two machines.
- **Debug overlay:** add `debug=1` to the query. A small "debug +" tab appears at the top left; it opens a panel with every tunable as a live number input, the clock, the measured input offset and the round-trip time.
- **Other parameters:** `bot=1` (first click starts a bot match from the saved set-up, skipping the set-up screen), `autoplay=1` (a bot plays your side too), `bpm=140`, `seed=7`, `botAccuracy=0.5`, `tunables={"startHealth":30}`, `res=1` (never drop the render resolution).
- **Component test benches** (dev server only): `/dev/artkit.html`, `/dev/uikit.html`, `/dev/workshop.html`, `/dev/theme.html`, `/dev/account.html`.
- **Browser checks:** `pnpm e2e` builds, previews on port 4173 and runs Chromium headless (about 6 minutes). Screenshots of every screen land in `test-results/screens/`.

## Finished and how it was verified

| What | How it was verified |
|---|---|
| Duel rules, beat maths, tunables (`src/core`) | Unit tests on every rule; opus review found the rules match the brief line by line |
| Session, loopback, bot | Whole matches on a fake clock with 0, 150 and 350 ms of simulated lag end in identical states on both sides |
| Pairing, room codes, handshake, clock sync | Unit tests on an in-memory hub, including a match between sessions whose clocks differ by 1234.5 s over a 40 ms link |
| Bot match in the browser | Browser test: plays to the victory screen, by script and by real clicks |
| Two players in the browser | Browser tests over the tab link: create and join by link, a third page is turned away, a scripted act and a whole match end the same on both pages, rematch flips the first attacker, "Your friend left" in the lobby and mid-duel |
| Final design: stage, puppets, marks, HUD, title, lobby, victory | Screenshots compared with the mocks by the builders and spot-checked by me (title, lobby, duel, phone duel) |
| Puppet workshop | Unit tests of the bitmap, undo and palette code; browser test draws a stroke, saves, and the drawing reaches the other player |
| Battle theme | Unit tests of file checks and tempo helpers; browser test uploads a 100 BPM WAV, the tempo is detected, the guest receives it with a hash check and both pages play at 100 BPM |
| Accounts and puppet sync | Unit tests against a fake backend only |
| Calibration | Unit tests of the estimate; browser test taps along and stores the offset |
| Phone layout | Browser test at 844x390 with touch: buttons at least 44 px, tap plants a strike, rotate prompt in portrait |
| Content-Security-Policy | Browser test serves the build with the exact `public/_headers` and runs the main flows with no violations |

## Review findings

The final opus review covered everything not reviewed earlier. Every finding was fixed by a builder (brief `docs/briefs/8-review-fixes.md`), each with a unit test, and all checks pass afterwards. The fixes have not been reviewed a second time, and the clock-sync rewrite in particular deserves a real two-machine test.

- **Blocker, fixed: tempo change on a loaded theme.** If the host nudged the tempo or first beat of a song the guest had already loaded, the guest kept the old values and its music ran off the beat. The guest now retunes its copy and confirms again before Start is allowed.
- **Blocker, fixed: clock sync never recovered.** A paused audio clock (phone switching apps, sound not yet unlocked) left the two clocks misaligned for the rest of the session, and rematches never re-synced. The sync now uses the best of the last 8 samples, restarts after a jump, ignores a stopped clock, and re-measures before every start and rematch (waiting at most 3.5 s).
- **Fixed: unchecked values from the other player.** Names, tunables, theme values, strikes and host state are now range-checked; a bad message is dropped.
- **Fixed: file limits.** The receive limit is 10 MiB plus a margin instead of the library's 256 MiB; a song's length is read before decoding.
- **Fixed: rematch.** It can no longer skip the Ready and theme checks, and the victory screen says when the friend has gone back to the room.
- **Fixed: silent failures.** A failed connection shows "Could not connect" with a retry (also after 20 s of no answer); a stalled transfer is dropped after 30 s so Start cannot stay locked.

Three new tunables came out of this: `startLeadSec` (3), `ringLeadBeats` (2), `clockJumpMs` (50). One new message, `resync`, lets the host ask the guest to re-measure the clocks.

## Not verified (needs you)

- Trystero over the real network: connecting, sending a song with progress, behaviour behind strict NAT (there is no TURN server, so some pairs of networks cannot connect).
- Supabase: the migration, guest sign-in, adding an email, puppet sync. `docs/SUPABASE.md` has the steps.
- Tempo detection on real songs. On the generated test tracks it reports the first beat 4 to 23 ms late; the nudge buttons and tap-along exist for this.
- iOS: audio unlock, wake lock, notch insets. Only simulated.
- Everything about feel.

## Parked

Nothing was parked after three attempts. Known rough edges left as they are:

- The puppet's body bends awkwardly when the sword tip is behind or directly above its base.
- Progress bars jump straight to done over the tab link (it sends in one piece); real transfers report progress.
- The heckle, streak and aside notes exist but did not appear in any screenshot, so nobody has seen them.
- On the defend screen every due slot shows green in the phrase dots; there is no separate "parried" colour.
- The loser on the victory screen droops but has no crossed-out eye as in the mock.
- The workshop is cramped on a phone.

## Decisions you might disagree with

All 37 are in `docs/DECISIONS.md` with reasons. The ones most worth a look:

**Rules the brief left open**

- 7: an act ends only at the end of a defend phrase, even if health hits 0 mid-phrase.
- 8: a tie on time plays on until health differs.
- 9: Winded doubles the next whole defend phrase, then stamina resets to 50.
- 10: a click more than 200 ms early is ignored; closer than that but outside Good is a Miss.
- 17, 18: a 60 ms grace after a slot for the attacker's click; a click just before slot 0 is held and counted.
- 21: target radius is 5% of the play width (7.5% on touch), not "about 6%", to match the mocks' drawn size.

**Design and behaviour**

- 16: the play area is 880x440 inside the 1280x720 stage.
- 24: the opponent's pointer is not sent; their sword eases toward their latest strike or parry.
- 26: on a slow machine the stage drops to half resolution to keep input on time.
- 28: the banner fades when a strike or target is under it.
- 30: the title has no "Themes" button (the host picks the theme in the lobby) and no tape quip.
- 33: if both players use the teal preset, each sees the friend as pink.

**Open items from the brief, with the default taken**

| Item | Default taken |
|---|---|
| Default tracks | None licensed. Three generated placeholder loops (`scripts/generate-tracks.ts`, `public/tracks/`) plus a click track |
| Song storage | In the browser (IndexedDB) and sent peer to peer; never uploaded to a server |
| Upload limits | 10 MB, 6 minutes, 80 to 180 BPM; MP3, OGG, WAV, M4A by content sniffing |
| DNS | Cloudflare, so `docs/DEPLOY.md` leads with Cloudflare Pages. Not touched |
| Licence | No licence file added |
| Asset licences | Not checked. `docs/ASSETS.md` lists every file in `design/` and `src/assets/` with what is known; fonts are the open-licence Fontsource packages |
| Grade words | "Bravo!", "Good", "Miss" as written |
| Library conflicts | TypeScript pinned at 6.0.3 because typescript-eslint does not yet accept 7; Trystero uses only the Nostr strategy |

## Blocked by permissions or network

- Custom subagent types in `.claude/agents/` could not be loaded mid-session; general-purpose agents with the model set and the role text pasted were used instead.
- No command was denied. Nothing outside the repo was changed.

## Models used

| Role | Model | Used for |
|---|---|---|
| Orchestrator | Fable (this session) | Plans, briefs, docs, `src/core/types.ts`, accepting work, commits |
| Builder | sonnet | All production code and tests |
| Helper | haiku | Scaffold, docs split, deploy and asset docs |
| Reviewer | opus | Two read-only reviews (core after milestone 1; the whole codebase at the end) |

## Before deploying

`docs/DEPLOY.md` is the full guide (Cloudflare Pages, custom domain `toetotoe.allenzheng.com`, the headers and what each CSP directive is for). In short: push the repo, create a Pages project with build command `pnpm build` and output `dist`, add the custom domain. Optional: create a Supabase project, run the migration, and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (`.env.example`).

## Playtest checklists

Open the debug overlay (`?debug=1`) to change any tunable live. Names below are the fields in `src/core/tunables.ts`.

### Milestone 1: the duel against the bot

- [ ] The click track is steady and the count-in (4, 3, 2, 1) lands on the beat.
- [ ] Planting: clicks on the half-beat register; clicks between half-beats do not. Does the 60 ms grace feel right? (`inputGraceMs`)
- [ ] Parrying: "Bravo!" feels earned and "Good" feels fair. (`bravoWindowMs` 45, `goodWindowMs` 100, `missWindowMs` 200)
- [ ] Targets are easy enough to hit but not trivial. (`targetRadius` 0.05)
- [ ] Stamina makes you choose: far-apart strikes cost more, and you cannot fill all eight slots every phrase. (`strikeBaseCost` 8, `strikeDistanceCostMax` 12, `staminaRegen` 35)
- [ ] Winded is noticeable and recoverable. (`windedDamageMultiplier` 2, `windedResetStamina` 50)
- [ ] An act lasts a sensible time; a match is best of three. (`startHealth` 100, `missDamage` 10, `actDurationSec` 90)
- [ ] The bot is beatable. (`?botAccuracy=0.5`)
- [ ] Try `?bpm=90` and `?bpm=170`: still playable at both ends?

### Milestone 2: two players

- [ ] Two windows with `?net=tab`: create, join by link, both ready, start, play a match, rematch, leave.
- [ ] **Two different browsers or machines without `net=tab`:** does the room connect at all? How long does it take?
- [ ] The beat sounds aligned on both machines (listen side by side). The overlay shows the round-trip time.
- [ ] Strikes you plant appear for your friend a phrase later in the same places and rhythm.
- [ ] Both screens agree on health, stamina and who won each act.
- [ ] Close one window mid-match: the other says "Your friend left".
- [ ] A third person opening the link is told the room is full.

### Milestone 3: the final design

- [ ] Title, lobby, duel (attacking and defending) and victory look like `design/screenshots/`.
- [ ] Puppets: the sword tip follows your pointer; the body bends believably. Note where it looks wrong.
- [ ] The HUD is readable at a glance mid-phrase; the banner does not hide targets you need.
- [ ] Heckles from "a child in row G", the streak note and "Not enough stamina" appear and are not annoying.
- [ ] No stutter on your machine. If the picture goes soft, the half-resolution fallback has kicked in.

### Milestone 4: the puppet workshop

- [ ] Draw a head, a sock and a sword; undo and redo; the preview moves as you draw.
- [ ] Save, reload the page: the puppet is still there and selected.
- [ ] From the lobby, edit your puppet: your friend sees the new one.
- [ ] Delete a saved puppet.

### Milestone 5: the battle theme

- [ ] As host, pick each house track and the click track; the guest's lobby follows.
- [ ] Upload a real song: is the detected tempo right? Is the first beat right, and do the nudges and tap-along fix it when not?
- [ ] The guest sees a progress bar, then the title and tempo; neither can start before it has loaded.
- [ ] In the match the song is on the beat on both machines.
- [ ] A file that is too long, too big or not audio is refused with a plain reason.

### Milestone 6: accounts (only with a Supabase project)

- [ ] With no environment variables the corner note says "Drawings are saved in this browser." and nothing else changes.
- [ ] With them: "Save across devices" signs in as a guest; a second browser signed in to the same account (after adding an email) gets the puppets.
- [ ] With the project paused: a plain "Can't reach the saving service" note, and the game still plays.

### Milestone 7: polish

- [ ] "Calibrate timing": tap along; does the offset it suggests make parrying feel better, especially on Bluetooth audio?
- [ ] On a phone in landscape: everything fits, buttons are easy to tap, the stage does not scroll or zoom.
- [ ] In portrait: "Turn your phone sideways".
- [ ] On an iPhone: sound starts after the first tap; the screen stays awake during a match.
- [ ] After deploying: the browser console shows no Content-Security-Policy errors on any screen.
