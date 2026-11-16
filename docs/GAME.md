# Game rules

## What we're building

A one-against-one rhythm duel in the browser, in the spirit of osu. Each player is a sock puppet holding a sword in its mouth. The puppet's body stretches so the sword follows the player's pointer, and clicks on the beat are attacks and parries. The stage is a puppet theatre shown as a cut-and-paste collage on a cutting mat.

The core idea: **each player is the other's beatmap.** One player plants a phrase of strikes on the beat; a phrase later the other player has to parry those same strikes, in the same places and rhythm.

It will live at `toetotoe.allenzheng.com`. I own `allenzheng.com`. This repo is only this game.

## Decisions and planning defaults

Things I decided. Treat these as fixed:

- Two players, one against one, in a private room shared by link or code. Friends only; no matchmaking.
- The only inputs are a pointer and a single click or tap. No keyboard controls in a match.
- **No game server run by me.** Matches run browser to browser. The site is static files.
- **Desktop and laptop first.** Phones are supported for tap input, but never at the cost of the desktop experience.
- The game is called **Toe to Toe** and deploys to `toetotoe.allenzheng.com`.
- The visual design is the "final design" described in `docs/DESIGN.md`. Follow the mocks.
- **Plain labels.** Health is "Health". The second bar is "Stamina". The buttons are "Create a room" and "Join a room". Players choose their own display names; never give them names like "Lefty".
- Players **draw their own puppet and sword from scratch** as bitmap drawings.
- I will set up a **Supabase** project for basic user info and saved puppet designs, with room to add saved custom combos later.
- Players can **upload their own song** as the battle theme. This is unmoderated; the only limits are file type and size.
- I will choose the default tracks later.

Planning defaults. These were proposed during planning and I have not confirmed each one. Use them tonight, keep them easy to change, and list any you think I should revisit in the morning report:

- Every number in the duel rules (see "The duel" below).
- The merged Stamina rules (see "The duel" below): one bar that both pays for strikes and takes parry losses.
- The tech stack (see `docs/KICKOFF.md`).
- Where songs are stored (see "Songs" below): on the player's device and sent peer to peer, not in Supabase.
- The database structure (see `docs/DATA.md`).
- The upload limits for songs (see "Songs" below).

## The duel

Idea approved; every number is a starting value. Put them all in the tunables object.

### Clock and phrases

- The song's tempo drives everything. House tracks carry their tempo in a manifest; uploaded songs get one in the battle theme screen (see "Songs" below).
- A **phrase** is four beats. Strikes snap to half-beats, so a phrase has eight slots.
- If a song's tempo is outside 80 to 240 BPM, halve or double it until it fits.
- A match starts with a one-phrase count-in.

### The loop

1. **Attack.** The attacker clicks anywhere in the play area on the beat. Each click plants a numbered strike in that half-beat slot, up to eight per phrase. The defender sees strikes appear as they are planted.
2. **Defend.** In the next phrase, the same strikes replay for the defender as numbered targets in the same positions and slots, each with a ring that closes on its beat. Clicking a target on time is a parry. A miss costs health.
3. **Swap roles** and repeat.

Positions are stored as fractions of the play area, so both screens agree whatever their size. The play area is the stage between the curtains and above the ledge.

### Judging a parry

(defender's own browser judges, then reports)

| Result | Timing | Effect |
|---|---|---|
| Bravo | within 45 ms | No damage. Attacker loses 6 stamina |
| Good | within 100 ms | No damage |
| Miss | later, earlier, or not clicked | Defender loses 10 health and 8 stamina |

The click must also land inside the target (radius about 6% of the play area width; larger on touch screens).

### Health and Stamina

- Both start at 100.
- **Stamina pays for strikes.** A strike costs 8, plus up to 12 more for distance from the previous strike. A player cannot plant a strike they cannot afford.
- **Stamina comes back** by 35 at the start of that player's own attack phrase.
- **Stamina is also lost** on missed parries and to an opponent's Bravo, as in the table.
- **Winded.** At 0 stamina a player is winded: the next phrase they defend deals double damage, then their stamina resets to 50.

This merges two ideas from planning (a posture bar and a separate strike cost) into the one Stamina bar I asked for.

### Acts and matches

- An act ends when someone's health reaches 0, or after 90 seconds, when the higher health wins.
- A match is the best of three acts. Then the victory screen offers a rematch.
- The player who did not attack first in the previous act attacks first in the next.

**Later, not tonight:** an initiative rule (keep attacking while hits land; a clean parry steals the turn), sliders and spinners as extra strike types, tempo that rises as health drops, saved custom combos, and a variant where both players attack at once.

## Clarifications

These refine the duel rules above.

7. **Acts end only at the end of a defend phrase.** Health can reach 0 mid-phrase; the phrase plays out. Keeps act scoring on a clean boundary both browsers agree on.
8. **A tie on time plays on.** The brief says the higher health wins after 90 seconds and does not cover equal health. Further turns are played until health differs.
9. **Winded applies to the next whole defend phrase.** If stamina hits 0 in the middle of a defend phrase, that phrase is not doubled; the next one the player defends is, and afterwards stamina resets to 50.
10. **Early clicks.** A click on a target more than `missWindowMs` (200 ms) early is ignored; inside that but outside the Good window is a Miss. The brief says only "later, earlier, or not clicked".
11. **Distance cost of a strike** scales linearly up to `strikeDistanceForMaxCost` (0.6 of the play-area width) from the previous strike of the same phrase; the first strike of a phrase pays only the base cost.
13. **Between acts there is a 2-phrase intermission and then the count-in**; the music keeps playing so the beat grid never restarts.

## Puppets and the workshop

- A puppet is **three drawings**: head, sock piece and sword, each a PNG with transparency. Planning sizes: head 320 by 240, sock piece 160 by 120, sword 320 by 80.
- The body is the sock piece repeated as segments joined with brass split pins. Segments overlap at the pins, so the drawing does not need to repeat seamlessly.
- **The rig.** The base is fixed behind the ledge. A chain of segments bends and stretches so the **sword tip sits at the pointer**. Add or remove segments with distance. On touch, the tip follows the finger while it is down and stays put when lifted.
- **Fixed anchors.** The head has a pin point (where it joins the sock) and a mouth end; the sword has a handle point and a tip. They sit at set positions on each canvas and the workshop shows guides for them. Hits are judged from the pointer position, never from the drawing, so a huge sword gives no advantage.
- **Workshop tools:** brush, eraser, fill, undo, redo, clear, three brush sizes, twelve colours, a dashed guide box, a live preview on the stage, a name field, and a row of saved puppets.
- **Presets.** Ship four ready-made puppets for players who skip drawing. The two in the mocks (a teal one and a pink one) are good starting points; they are inline SVG in `design/mocks/`.
- **Saving.** Drawings are saved in IndexedDB at once, and synced to Supabase when the player has an account (see `docs/DATA.md`).
- **In a match,** each browser sends its three drawings to the other when the room fills.

## Songs

- **House tracks** are static files in `public/tracks/` with a `tracks.json` manifest: title, file, tempo, first-beat offset, credit and licence. Adding a track is adding a file and a manifest entry. I have not chosen any yet, so ship two or three short loops synthesised by a script in the repo, clearly named as placeholders.
- **Uploaded songs.** A player picks or drops an audio file in the battle theme screen. Planning limits: MP3, OGG, WAV or M4A, up to 10 MB and six minutes. Reject anything else with a plain message. There is no other moderation.
- **Setting the beat.** Decode the file, run tempo detection, and show the tempo and first-beat offset with nudge buttons, a tap-along check, and a preview with a click track over the song.
- **Storage.** The file, tempo and offset are kept in IndexedDB on the uploader's device.
- **In a match,** the room creator's chosen theme is used. If it is an uploaded song, it is sent to the other player over the peer connection before the match starts, with a progress bar, and both sides confirm the same file by hash.
- **Not in Supabase.** Planning advice was to keep audio files out of the database: the free plan's storage and download allowances are small, it pauses when idle, and storing people's uploaded music on my project makes me the one distributing it. Put songs behind a `TrackSource` interface so a remote source can be added if I decide otherwise.

## Open items

I haven't decided these. Use the default, and list each one in the morning report so I can change it:

- **Default tracks:** none chosen. Ship generated placeholder loops.
- **Song storage:** local and peer to peer, as in the Songs section above.
- **Upload limits:** as in the Songs section above.
- **Where `allenzheng.com`'s DNS is hosted:** unknown. Cover both cases in `docs/DEPLOY.md`. Deploy nothing.
- **Licence for the code:** add no licence file.
- **Asset licences:** unchecked. List the files in `docs/ASSETS.md`.
- **Words for a good parry and a miss:** "Good" and "Miss". Only "Bravo!" is designed.
- **Conflicts between this brief and current library versions or docs:** follow the current docs, keep to the intent of the brief, and record the difference in `docs/DECISIONS.md`.
