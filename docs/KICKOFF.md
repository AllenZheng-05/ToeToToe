# Toe to Toe: kickoff brief for Claude Code

You are starting work on **Toe to Toe**, a two-player browser game I (Allen) am building. This brief contains everything settled in planning as of 16 November 2026: the concept, the constraints, the chosen design, the duel rules, the tech stack, the data plan, the roadmap, and how I want you to work. Read all of it before doing anything, then follow section 3 (how you work) and section 16 (milestones).

**This run is unattended.** I am starting you and walking away. I will not look at the session, answer questions or approve anything until I come back. Get as far through the milestones as you can on your own, to a standard where the checks pass, and leave me a clear report.

The repo is already cloned in the directory you are running in:

- GitHub: https://github.com/AllenZheng-05/ToeToToe
- Local: `C:\Users\Plasm\Projects\ToeToToe` (Windows)
- State: newly created, with no commits of mine yet. This brief is at `docs/KICKOFF.md` and the design kit is in `design/`; both are uncommitted. Check `git status` and `git log` first and work with whatever is there.
- Design kit: `design/` holds the stage images, a static HTML mock of every screen, and screenshots (section 11). If `design/` is missing, do not stop: build with simple placeholder art and say so at the top of the morning report.

---

## 1. What we're building

A one-against-one rhythm duel in the browser, in the spirit of osu. Each player is a sock puppet holding a sword in its mouth. The puppet's body stretches so the sword follows the player's pointer, and clicks on the beat are attacks and parries. The stage is a puppet theatre shown as a cut-and-paste collage on a cutting mat.

The core idea: **each player is the other's beatmap.** One player plants a phrase of strikes on the beat; a phrase later the other player has to parry those same strikes, in the same places and rhythm.

It will live at `toetotoe.allenzheng.com`. I own `allenzheng.com`. This repo is only this game.

## 2. Decisions and planning defaults

Things I decided. Treat these as fixed:

- Two players, one against one, in a private room shared by link or code. Friends only; no matchmaking.
- The only inputs are a pointer and a single click or tap. No keyboard controls in a match.
- **No game server run by me.** Matches run browser to browser. The site is static files.
- **Desktop and laptop first.** Phones are supported for tap input, but never at the cost of the desktop experience.
- The game is called **Toe to Toe** and deploys to `toetotoe.allenzheng.com`.
- The visual design is the "final design" described in section 11. Follow the mocks.
- **Plain labels.** Health is "Health". The second bar is "Stamina". The buttons are "Create a room" and "Join a room". Players choose their own display names; never give them names like "Lefty".
- Players **draw their own puppet and sword from scratch** as bitmap drawings.
- I will set up a **Supabase** project for basic user info and saved puppet designs, with room to add saved custom combos later.
- Players can **upload their own song** as the battle theme. This is unmoderated; the only limits are file type and size.
- I will choose the default tracks later.

Planning defaults. These were proposed during planning and I have not confirmed each one. Use them tonight, keep them easy to change, and list any you think I should revisit in the morning report:

- Every number in the duel rules (section 6).
- The merged Stamina rules (section 6): one bar that both pays for strikes and takes parry losses.
- The tech stack (section 5).
- Where songs are stored (section 8): on the player's device and sent peer to peer, not in Supabase.
- The database structure (section 10).
- The upload limits for songs (section 8).

## 3. How you work: you orchestrate, subagents code

I am running you on Fable as the **planner and orchestrator**. Less powerful models do the coding as subagents. Your context is the scarce resource, so spend it on planning, writing briefs, reviewing results and making decisions, not on writing feature code.

### Roles

| Role | Model | Does |
|---|---|---|
| You (main session) | fable | Plan milestones, split them into tasks, write briefs, spawn subagents, review and integrate their work, keep docs current |
| `builder` | sonnet | Implements features: game loop, audio clock, duel rules, rendering, puppet rig, networking, editor |
| `helper` | haiku | Mechanical work: scaffolding, config, boilerplate, docs, simple unit tests, renames, repo searches |
| `reviewer` | opus | Read-only review of a finished task against its brief; runs typecheck and tests; reports defects. Never edits |

First thing in milestone 0, create these three project subagents as files in `.claude/agents/`:

`.claude/agents/builder.md`
```markdown
---
name: builder
description: Implements a well-specified coding task for Toe to Toe from a written brief. Use for all feature code.
model: sonnet
---
You implement one task for Toe to Toe, a two-player browser rhythm duel (TypeScript, Vite, PixiJS, Web Audio, WebRTC through Trystero, Supabase). Your brief names the goal, the files you own, the interfaces you must match, and the checks that must pass. Read CLAUDE.md and any docs the brief points to before writing code. Touch only the files the brief assigns to you; if you need a change elsewhere, stop and say so in your report. Do not spawn other agents. Before reporting, run the typecheck, lint and tests named in the brief and fix what fails. Report: what you built, files changed, check results, anything you could not verify (for example, anything that needs two real people or real speakers), and any decision you made that the brief did not cover.
```

`.claude/agents/helper.md`
```markdown
---
name: helper
description: Fast, cheap agent for mechanical work on Toe to Toe: scaffolding, config files, boilerplate, docs, simple tests, renames and codebase searches.
model: haiku
---
You do one small, mechanical task for the Toe to Toe repo exactly as the brief describes. Touch only the files the brief names. Do not make design decisions; if the brief is ambiguous or the task turns out to need judgment, stop and report that instead of guessing. Do not spawn other agents. Report what you changed and the result of any check the brief asked you to run.
```

`.claude/agents/reviewer.md`
```markdown
---
name: reviewer
description: Read-only reviewer. Checks a completed Toe to Toe task against its brief and the project rules, runs typecheck and tests, and reports defects.
model: opus
tools: Read, Grep, Glob, Bash
---
You review one completed task for Toe to Toe. You are given the brief and the list of changed files. Read CLAUDE.md first. Check that the work does what the brief asked, matches the stated interfaces, follows the timing rules in CLAUDE.md (especially: all beat timing comes from the audio clock, duel rules are pure and deterministic, nothing in a match depends on the database), and that typecheck, lint and tests pass. Do not edit files. Report defects ranked by severity, each with file, line and a concrete failure scenario. Say plainly when you found nothing; do not invent issues.
```

If a newly created agent type isn't available until the session restarts, don't stall: spawn a general-purpose subagent with the `model` parameter set to `sonnet`, `haiku` or `opus` and paste the role text into its prompt. In the morning report, tell me which model each subagent actually ran on, if you can tell.

### Rules of orchestration

- **You do not write production code.** You may write and edit docs, plans, `CLAUDE.md`, agent definitions, and make tiny integration fix-ups (a few lines) when delegating would cost more than doing it.
- **Every task gets a written brief.** A subagent starts with none of your context. Each brief states: the goal and why it matters; which docs and files to read first; the exact files the agent owns; interfaces to implement or consume, written out as TypeScript signatures; acceptance checks (commands that must pass, behaviours to demonstrate); what is out of scope; and the report format. Decide architecture and interfaces yourself and put them in the brief.
- **Parallelise only across disjoint files.** Run builders in parallel when their file sets don't overlap and the shared interfaces are already committed. Otherwise sequence them. Use git worktrees for larger parallel work.
- **Review before you accept.** After each builder task, read the diff yourself, and send anything non-trivial to `reviewer`. Send defects back to a builder with a specific brief. Re-run the checks yourself after the fix.
- **Commit small.** One logical commit per accepted task, clear message. Commit on `main` for milestone 0; use short-lived feature branches merged into `main` after that. **Do not push** until I say so.
- **Keep the plan visible.** Maintain `docs/ROADMAP.md` with milestone and task status so a fresh session can pick up from the repo alone.
- **Record decisions.** Make engineering calls yourself and write each one, with its reason, in `docs/DECISIONS.md`.

### This run is unattended

Nobody is watching. A question or a prompt that waits for me wastes the whole run, so:

- **Never ask and never wait.** When something is ambiguous, take the most reasonable reading, record it in `docs/DECISIONS.md`, and keep going. Section 17 gives the defaults for the questions I already know about. Don't open with a plan for approval; write the plan into `docs/ROADMAP.md` and start.
- **Nothing blocks the run.** Give a failing task up to three real attempts, a different approach each time. If it still fails, park it: write what failed and what you tried in the morning report, then continue with work that doesn't depend on it. If a later milestone depends on a parked task, build against the agreed interface with a stub and say so.
- **Stay inside this repo.** Do not push, deploy, log in to any account (GitHub, Supabase, Cloudflare or anything else), install anything globally, or create, change or delete files outside the repo directory. Installing npm packages into the project is expected. Package-manager caches are fine, and so is Playwright's Chromium download (set `PLAYWRIGHT_BROWSERS_PATH=0` to keep it inside `node_modules` if you can). If the permission system denies a command, do not hunt for a workaround; record it and move on.
- **No interactive commands.** Use non-interactive flags everywhere. Run dev servers and browsers in the background and shut them down when the check is finished.
- **Write state to disk as you go.** After every accepted task, update `docs/ROADMAP.md` and `docs/MORNING_REPORT.md` and commit them. The session may be cut off at any point, and the repo must show exactly where things stand so a new session can resume from "continue from docs/ROADMAP.md".
- **Done means the checks pass.** A milestone counts only when typecheck, lint, tests and the build pass. Never weaken or delete a test to get there, and never mark something done that isn't. A smaller number of working milestones is worth more to me than a larger number of broken ones.
- **Don't polish what only I can tune.** Timing windows, tempo and game feel can't be judged without a person playing. Take each feature to "complete, driven end to end by the bot, tunables exposed", then move on.
- **Protect your context.** Delegate, ask subagents for short reports, and read diffs selectively.

### The morning report

Keep `docs/MORNING_REPORT.md` current throughout, written for me to read first. It contains: what is finished and how it was verified; what is parked and why; every decision you made that I might disagree with; anything the permission system or the network blocked; which model each subagent ran on; exactly how to run the game, how to open two windows that play each other, and how to open the debug overlay; and a **playtest checklist per milestone** (what to open, what to do, what I should see, which tunables to adjust). Lead with the state of things, not the story of the run.

## 4. What can't be checked without people

A match needs two humans, real speakers and a real network, and none of those are available to you. Build the game so everything else can be verified:

- **A bot opponent.** It attacks with generated phrases and parries with configurable accuracy. It drives the same interfaces a remote player does, so a full match runs with one browser and no network.
- **A swappable transport.** The game talks to the other player through one `Transport` interface with three implementations: the real peer-to-peer one, a **loopback** that connects two game instances in the same page or across two tabs (BroadcastChannel), and the bot.
- **A swappable clock.** Duel logic reads time from a `Clock` interface. Production uses the audio clock; tests use a fake clock stepped by hand. Duel rules are pure functions of state and events, with no timers inside.
- **Two-window checks with Playwright.** Open two pages on the loopback transport, script pointer input on both from a list of timed events, play a full act, and assert on the outcome (health totals, act winner, both pages agree). Fail on console errors. Save screenshots and compare them by eye against `design/screenshots/`.
- **A generated click track** as the test song: a short loop synthesised in code at a known tempo, so no audio file is needed for checks.
- **A debug overlay** (`?debug=1`): beat counter, audio clock, measured input offset, connection state, round-trip time, frame rate, and the current phrase as data.
- **Every tunable in one place.** Tempo limits, phrase length, timing windows, damage, stamina costs and regeneration live in a single typed config object, editable live from the debug overlay.
- **Playtest checklists** for everything that needs me and a friend go in the morning report.

## 5. Tech stack (planning default, checked November 2026)

| Layer | Choice | Notes |
|---|---|---|
| Language and build | TypeScript (strict), Vite, pnpm, Vitest, ESLint, Prettier | Same as my Headless Sports project |
| Stage rendering | PixiJS v8 | Sprites for the stage, puppets, targets and effects. v8.20.x was current in August 2026 |
| Menus and labels | Plain DOM over the canvas | The design's lettering is CSS-friendly; the mocks are HTML. No UI framework unless menus outgrow plain DOM |
| Audio and timing | Web Audio API | The `AudioContext` clock is the master clock for everything on the beat |
| Tempo detection | `web-audio-beat-detector` | Its `guess()` returns a tempo and the offset of the first beat. It assumes 90 to 180 BPM by default |
| Peer to peer | `trystero` | WebRTC data channels with no server of ours. Typed actions, binary transfer with chunking and progress. v0.25.x seen |
| Local storage | IndexedDB | Drawings, uploaded songs, settings |
| Accounts and saved designs | `@supabase/supabase-js` | Only when environment variables are present (section 10) |
| Tests in a browser | Playwright | Two pages, loopback transport |
| Hosting | Static host with HTTPS and a single-page fallback | Cloudflare Pages preferred; GitHub Pages as the alternative |

**Check npm for the current stable releases, then pin exact versions** (no `^`, no `@latest`). If current docs disagree with this brief, follow the docs, keep the intent, and record the difference.

Facts that shape the build:

- **Bake the cutout look into textures.** Every stage image and every puppet part has a white scissor edge and a hard shadow. Generate those once on an offscreen canvas when an image loads. Do not run outline or shadow filters every frame.
- **Never time the beat with `setTimeout` or frame counts.** Schedule audio ahead on the audio clock and derive the beat position from `AudioContext.currentTime` each frame.
- **Pointer Events for all input.** One code path for mouse and touch. Convert each `pointerdown` to audio-clock time when it arrives.
- **An input offset setting.** Speakers, Bluetooth and displays add delay. Give players a calibration screen (tap along to a click) that stores an offset in milliseconds, and apply it to judging.
- **Fonts are self-hosted** (Bungee, Special Elite, Permanent Marker), for example through `@fontsource` packages. No font CDN at runtime.
- **Design size is 1280 by 720.** Scale the stage to fit the window and keep the aspect; the cutting mat fills the rest.

## 6. The duel

Idea approved; every number is a starting value. Put them all in the tunables object.

**Clock and phrases**

- The song's tempo drives everything. House tracks carry their tempo in a manifest; uploaded songs get one in the battle theme screen (section 8).
- A **phrase** is four beats. Strikes snap to half-beats, so a phrase has eight slots.
- If a song's tempo is outside 80 to 180 BPM, halve or double it until it fits.
- A match starts with a one-phrase count-in.

**The loop**

1. **Attack.** The attacker clicks anywhere in the play area on the beat. Each click plants a numbered strike in that half-beat slot, up to eight per phrase. The defender sees strikes appear as they are planted.
2. **Defend.** In the next phrase, the same strikes replay for the defender as numbered targets in the same positions and slots, each with a ring that closes on its beat. Clicking a target on time is a parry. A miss costs health.
3. **Swap roles** and repeat.

Positions are stored as fractions of the play area, so both screens agree whatever their size. The play area is the stage between the curtains and above the ledge.

**Judging a parry** (defender's own browser judges, then reports)

| Result | Timing | Effect |
|---|---|---|
| Bravo | within 45 ms | No damage. Attacker loses 6 stamina |
| Good | within 100 ms | No damage |
| Miss | later, earlier, or not clicked | Defender loses 10 health and 8 stamina |

The click must also land inside the target (radius about 6% of the play area width; larger on touch screens).

**Health and Stamina**

- Both start at 100.
- **Stamina pays for strikes.** A strike costs 8, plus up to 12 more for distance from the previous strike. A player cannot plant a strike they cannot afford.
- **Stamina comes back** by 35 at the start of that player's own attack phrase.
- **Stamina is also lost** on missed parries and to an opponent's Bravo, as in the table.
- **Winded.** At 0 stamina a player is winded: the next phrase they defend deals double damage, then their stamina resets to 50.

This merges two ideas from planning (a posture bar and a separate strike cost) into the one Stamina bar I asked for.

**Acts and matches**

- An act ends when someone's health reaches 0, or after 90 seconds, when the higher health wins.
- A match is the best of three acts. Then the victory screen offers a rematch.
- The player who did not attack first in the previous act attacks first in the next.

**Later, not tonight:** an initiative rule (keep attacking while hits land; a clean parry steals the turn), sliders and spinners as extra strike types, tempo that rises as health drops, saved custom combos, and a variant where both players attack at once.

## 7. Puppets and the workshop

- A puppet is **three drawings**: head, sock piece and sword, each a PNG with transparency. Planning sizes: head 320 by 240, sock piece 160 by 120, sword 320 by 80.
- The body is the sock piece repeated as segments joined with brass split pins. Segments overlap at the pins, so the drawing does not need to repeat seamlessly.
- **The rig.** The base is fixed behind the ledge. A chain of segments bends and stretches so the **sword tip sits at the pointer**. Add or remove segments with distance. On touch, the tip follows the finger while it is down and stays put when lifted.
- **Fixed anchors.** The head has a pin point (where it joins the sock) and a mouth end; the sword has a handle point and a tip. They sit at set positions on each canvas and the workshop shows guides for them. Hits are judged from the pointer position, never from the drawing, so a huge sword gives no advantage.
- **Workshop tools:** brush, eraser, fill, undo, redo, clear, three brush sizes, twelve colours, a dashed guide box, a live preview on the stage, a name field, and a row of saved puppets.
- **Presets.** Ship four ready-made puppets for players who skip drawing. The two in the mocks (a teal one and a pink one) are good starting points; they are inline SVG in `design/mocks/`.
- **Saving.** Drawings are saved in IndexedDB at once, and synced to Supabase when the player has an account (section 10).
- **In a match,** each browser sends its three drawings to the other when the room fills.

## 8. Songs

- **House tracks** are static files in `public/tracks/` with a `tracks.json` manifest: title, file, tempo, first-beat offset, credit and licence. Adding a track is adding a file and a manifest entry. I have not chosen any yet, so ship two or three short loops synthesised by a script in the repo, clearly named as placeholders.
- **Uploaded songs.** A player picks or drops an audio file in the battle theme screen. Planning limits: MP3, OGG, WAV or M4A, up to 10 MB and six minutes. Reject anything else with a plain message. There is no other moderation.
- **Setting the beat.** Decode the file, run tempo detection, and show the tempo and first-beat offset with nudge buttons, a tap-along check, and a preview with a click track over the song.
- **Storage.** The file, tempo and offset are kept in IndexedDB on the uploader's device.
- **In a match,** the room creator's chosen theme is used. If it is an uploaded song, it is sent to the other player over the peer connection before the match starts, with a progress bar, and both sides confirm the same file by hash.
- **Not in Supabase.** Planning advice was to keep audio files out of the database: the free plan's storage and download allowances are small, it pauses when idle, and storing people's uploaded music on my project makes me the one distributing it. Put songs behind a `TrackSource` interface so a remote source can be added if I decide otherwise.

## 9. Networking

- **Transport:** WebRTC data channels through Trystero, behind the `Transport` interface from section 4. Use its default strategy; make the strategy a config value so my Supabase project can take over the handshake later.
- **Rooms.** The creator gets a short code (three short parts, such as `ROW-G-12`). The link is `toetotoe.allenzheng.com/ROW-G-12`; also accept `?room=ROW-G-12`. A room holds two players; a third visitor sees "this room is full".
- **Referee.** The room creator's browser owns the clock start, health, stamina and act state, and sends state after every phrase. The other browser renders from that.
- **Clock sync.** A handful of ping exchanges when the room fills estimate the offset between the two audio clocks. The creator then sends "the song starts at T". A strike has a whole phrase to arrive, so ordinary lag is invisible.
- **Messages** (typed, small): hello with display name; puppet drawings; theme offer and song data; ready; clock ping and pong; start time; strike planted (live preview); phrase committed; parry results; state after each phrase; rematch; leave.
- **Leaving.** If either player disconnects mid-match, show it plainly and return the other to the lobby.

Known limits, accepted:

- Two players who are both behind strict network address translation cannot connect without a relay. Ship without one; add a TURN relay only if friends report failures.
- The creator's browser is trusted. There is no cheat protection and no ranked play.

## 10. Accounts and saved designs (Supabase)

I create the Supabase project myself. You cannot log in to it. Prepare everything so I only have to paste keys and run migrations:

- SQL migrations in `supabase/migrations/`, a `.env.example` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and `docs/SUPABASE.md` with the exact setup steps.
- **The game must run fully with no environment variables set**: presets, browser-saved drawings, browser-saved songs, and matches all work. Supabase only adds saving across devices.

| Table | Holds |
|---|---|
| `profiles` | id (the auth user), display name, created date |
| `puppets` | id, owner, puppet name, the three drawings, created date |
| `combos` (later; create no table yet) | owner, name, the pattern as beats and positions |

- **Guest first.** Use anonymous sign-in so a player can save without signing up, and let them attach an email to the same account later.
- **Owner-only access** through row-level security on every table and on the storage bucket for drawings.
- **Collect little.** A display name is all a profile holds.
- **Sleeping database.** The free plan pauses a project after about a week of low activity. Treat an unreachable database as normal: fall back to local data without an error screen.

Free plan figures seen in November 2026: 500 MB database, 1 GB file storage with a 50 MB cap per file, 50,000 monthly users.

## 11. Design

The chosen design is the "final design" board. You cannot open it, so the design kit in `design/` is your source:

- `design/assets/`: `sky.jpg`, `curtain-left.png`, `curtain-right.png`, `valance.png`, `ledge-cardboard.jpg`, `sign.png`, `sun.png`.
- `design/mocks/`: one static HTML file per screen at 1280 by 720. Positions, colours, fonts and labels in them are the intended design.
- `design/screenshots/`: a picture of each mock. They were rendered with stand-in fonts; trust the mocks for type.

Copy the assets you use into the app's own asset folder; leave `design/` as reference.

**The stage.** A puppet theatre cut out and taped to a green cutting mat. Layers, back to front: sky, cardboard sun, hanging cardboard sign (menus only), puppets, cardboard ledge, side curtains with their hems resting on the ledge, valance across the top, then interface elements.

**Vocabulary**

- **Lettering:** ransom-note letter tiles for the title and the big banners ("ATTACK!", "PARRY!", "NAME WINS!"); black label strips with white type for labels; marker on masking tape and typed notes on torn paper for asides.
- **Fonts:** Bungee, Special Elite, Permanent Marker.
- **Colours:** cutting mat `#2F6B52`, ink `#1B1210`, paper `#FFFDF5`, yellow `#FFE14D`, red `#D42A40`, blue `#2456C8`, pink `#F48FB1`, parried green `#7BC67B`, masking tape `rgba(244,228,170,0.9)`.
- **Cutout treatment:** a 3 px white outline and a hard shadow offset 5 px right and 6 px down at 28% black.
- **Targets** are plain icon circles, not pictures: yellow with an ink double ring and a number, a solid ink ring that closes in, green with a tick once parried. Planted strikes in the attack phase are smaller red numbered discs joined by a red line; the newest is yellow.
- **Bars:** each player's display name, Health (red) and Stamina (blue) sit on the ledge, inset so the curtain hems do not cover them. The middle of the ledge shows the current phrase as eight half-beat dots.
- **Asides:** short heckles from "a child in row G", an act counter ("Act 2 of 3"), a streak note ("7 in a row!").

**Screens in the kit:** 1 title, 2 room lobby, 3 puppet workshop, 4 battle theme, 5 duel (attacking), 6 duel (defending), 7 victory.

**States with no mock.** Build them in the same vocabulary: waiting for a friend to join; connecting; sending or receiving drawings and a song (progress); the count-in; between acts; "your friend left"; "this room is full"; the input calibration screen; adding an email to an account; a "turn your phone sideways" prompt.

**Phones.** Landscape only. Same layout scaled to fit. Tap targets at least 44 px. Larger hit radius for parries. No hover-only affordances.

The source images look like stock downloads and **their licence terms have not been checked**. Keep a `docs/ASSETS.md` listing each file so I can check them before launch.

## 12. Architecture

```
[Pointer Events] -> [Input: pointer position, clicks stamped in audio time]
        |
[Clock: AudioContext time -> beat, slot, phrase]        [Transport: peer | loopback | bot]
        |                                                        |
[Duel rules: pure reducer over (state, event) -> state] <--------+
        |
[Game scenes: title, lobby, workshop, theme, duel, victory]
        |
[Stage renderer (PixiJS): baked cutout textures, puppet rig, targets]   [DOM overlay: labels, buttons, bars]
[Storage: IndexedDB | Supabase sync]                                    [Songs: house manifest | local uploads]
```

Suggested layout, adjust as you see fit: `src/core/` (clock, tunables, duel rules, events), `src/net/` (transport interface, peer, loopback, bot, protocol), `src/audio/` (playback, scheduling, tempo detection, click track), `src/stage/` (renderer, textures, puppet rig, targets), `src/ui/` (DOM screens and components), `src/scenes/`, `src/workshop/`, `src/data/` (IndexedDB, Supabase), `src/debug/`, `public/tracks/`, `supabase/migrations/`, `tests/`, `docs/`, `design/`.

## 13. Hosting and deployment

- Target: `toetotoe.allenzheng.com` over HTTPS, on a static host with a single-page fallback so room links resolve.
- Prepare the deployment configuration and a `docs/DEPLOY.md` with the exact steps. **Do not log in to or change any of my accounts or DNS**; I run those steps. I haven't confirmed where `allenzheng.com`'s DNS is hosted, so cover both the Cloudflare case and the other case.

## 14. Verification standards

- `pnpm typecheck`, `pnpm lint` and `pnpm test` pass before any commit.
- Duel rules, stamina, judging and act scoring are pure and deterministic, with unit tests on a fake clock.
- The protocol has tests that run two game instances over the loopback transport and check both end in the same state.
- `pnpm build` succeeds, and the Playwright two-window check plays a full act.
- A builder's "done" always lists what it could not verify without people; carry those into my playtest checklist.
- Set up a GitHub Actions workflow that runs typecheck, lint and tests on push.

## 15. Privacy and safety

- Ask for nothing but a display name. Say plainly, where a song is uploaded, that it stays on the player's device and is sent only to the friend in the room.
- Drawings and songs from the other player are untrusted files: accept only the expected image and audio types within the size limits, and decode them with the browser's own decoders.
- A strict Content-Security-Policy: scripts from our own origin only; connections limited to the handshake network and, when configured, my Supabase project.

## 16. Milestones

Work through these in order, without stopping between them, for as long as the session lasts.

**Milestone 0: repo setup.** Check the environment (Node version, pnpm via corepack, git, which shell you're in on Windows). If pnpm can't be enabled without a global install, use npm and note it. Create the three subagents. Write `CLAUDE.md` (concise: what the project is, commands, the timing rules, the orchestration rules, pointers into `docs/`). Split this brief into `docs/`: `GAME.md`, `ARCHITECTURE.md`, `DESIGN.md`, `NETWORKING.md`, `DATA.md`, `ROADMAP.md`, `DECISIONS.md`, `DEPLOY.md`. Scaffold Vite, strict TypeScript, ESLint, Prettier, Vitest, `.gitignore`, a README and CI. Commit, including `design/` and this brief. After this milestone the repo, not this prompt, is the source of truth.

**Milestone 1: the duel against a bot.** Clock, tunables, duel rules, pointer input, the generated click track, a plain-shapes stage, the bot, the debug overlay. A full best-of-three match plays in one browser. This is the milestone that proves the game is fun, so it comes before any art.

**Milestone 2: two players.** The transport interface, loopback, the protocol, clock sync, the referee, rooms and codes, then the real peer-to-peer transport. The Playwright two-window check.

**Milestone 3: the final design.** Baked cutout textures, the stage, the jointed puppet rig, targets and strikes, banners, bars, and the title, lobby and victory screens, matched against the mocks.

**Milestone 4: the workshop.** The drawing editor, presets, local saving, and sending drawings to the other player.

**Milestone 5: songs.** The house-track manifest with placeholder loops, the battle theme screen, upload limits, tempo detection with tap-along and nudges, local saving, and sending a song to the other player.

**Milestone 6: accounts.** Supabase migrations, guest sign-in, syncing saved puppets, the no-database fallback, `docs/SUPABASE.md`.

**Milestone 7: launch polish.** Phone layout and touch, the input calibration screen, the states with no mock, deployment configuration and `docs/DEPLOY.md`, `docs/ASSETS.md`.

**If you finish everything**, do not invent new scope. Spend remaining effort, in this order, on: a `reviewer` pass over the whole codebase against the timing rules; test coverage for the duel rules and protocol; then stop and finalise the morning report.

## 17. Open items, with defaults

I haven't decided these. Use the default, and list each one in the morning report so I can change it:

- **Default tracks:** none chosen. Ship generated placeholder loops.
- **Song storage:** local and peer to peer, as in section 8.
- **Upload limits:** as in section 8.
- **Where `allenzheng.com`'s DNS is hosted:** unknown. Cover both cases in `docs/DEPLOY.md`. Deploy nothing.
- **Licence for the code:** add no licence file.
- **Asset licences:** unchecked. List the files in `docs/ASSETS.md`.
- **Words for a good parry and a miss:** "Good" and "Miss". Only "Bravo!" is designed.
- **Conflicts between this brief and current library versions or docs:** follow the current docs, keep to the intent of the brief, and record the difference in `docs/DECISIONS.md`.

## 18. Start

Write your plan into `docs/ROADMAP.md` (tasks, which subagent takes each, what runs in parallel) and begin milestone 0 straight away. Do not wait for a reply from me at any point.
