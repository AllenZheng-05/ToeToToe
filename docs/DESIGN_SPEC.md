# Toe to Toe: design spec (extracted from design/mocks)

Source of truth: `design/mocks/1..7-*.html` (1280 x 720, inline styles). This file restates them as numbers. All units are design pixels at 1280 x 720. CSS shown is copied from the mocks. Where a value is not in the mocks it says "not in mocks".

Fonts: `Bungee` (display), `Special Elite` (typewriter, the default body font), `Permanent Marker` (marker). Fallbacks used in mocks: `Bungee, Impact, sans-serif`; `'Special Elite', 'Courier New', monospace`; `'Permanent Marker', 'Comic Sans MS', cursive`.

Asset natural sizes (px):

| File | W x H | Type |
|---|---|---|
| `sky.jpg` | 1600 x 914 | JPEG |
| `sun.png` | 440 x 468 | PNG, alpha |
| `sign.png` | 1300 x 719 | PNG, alpha |
| `curtain-left.png` | 701 x 1240 | PNG, alpha |
| `curtain-right.png` | 640 x 1240 | PNG, alpha |
| `valance.png` | 1611 x 236 | PNG, alpha |
| `ledge-cardboard.jpg` | 1423 x 140 | JPEG |

---

## 1. Shared stage frame

Screens 1, 2, 5, 6, 7 use the full stage frame. Screens 3 (workshop) and 4 (battle theme) use only the mat (layer A) plus panels; no paper, tape, sky, curtains.

### 1.1 Layers, back to front (screens 1, 2, 5, 6, 7)

Root: `position:relative; width:1280px; height:720px; overflow:hidden; box-sizing:border-box; color:#1B1210; font-family:'Special Elite','Courier New',monospace`.

| # | Layer | Asset | left | top | w | h | rot | Treatment |
|---|---|---|---|---|---|---|---|---|
| A | Cutting mat | none | 0 | 0 | 1280 | 720 | 0 | `background-color:#2F6B52; background-image:linear-gradient(rgba(255,255,255,0.14) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.14) 1px,transparent 1px); background-size:40px 40px` (grid lines at x,y = 0,40,80...; 1 px lines) |
| B | Paper drop shadow | none | 0 | 0 | 1280 | 720 | 0 | `background:rgba(0,0,0,0.35); clip-path:polygon(44px 44px,1254px 36px,1260px 702px,38px 708px)` |
| C | White paper edge | none | 0 | 0 | 1280 | 720 | 0 | `background:#FFFFFF; clip-path:polygon(36px 34px,1246px 26px,1252px 692px,30px 698px)` |
| D | Clip container | none | 0 | 0 | 1280 | 720 | 0 | `clip-path:polygon(46px 44px,1236px 37px,1241px 682px,41px 687px)`. Everything below (E to P) is a child of this, so it is clipped by the skewed quad. |
| E | Sky | `sky.jpg` | 41 | 37 | 1201 | 651 | 0 | `object-fit:cover` (scale 0.7506 -> 1201 x 686; 17.5 px cropped top and bottom, centred). No outline. |
| F | Sun | `sun.png` | see 1.2 | see 1.2 | 140 or 120 (h auto: 148.9 or 127.6) | auto | see 1.2 | cutout filter F1 |
| G | Sign | `sign.png` | 340 | 56 | 600 (h auto = 331.9; spans y 56..388) | auto | 0 | cutout filter F1. Screens 1, 2, 7 only. |
| H | Sign text block | none | 350 | 186 / 188 / 192 | 580 | auto | -1 | DOM flex column, centred, children centred on the sign (see section 5). Comes before puppets in the DOM, so puppets paint over it. Screens 1, 2, 7 only. |
| I | Puppets + targets line SVG | none | 0 | 0 | 1280 | 720 | 0 | one `<svg viewBox="0 0 1280 720" width="1280" height="720">`; puppet filter F2 (section 4) |
| J | Ledge | `ledge-cardboard.jpg` | 34 | 603 | 1216 | 92 (spans y 603..695) | 0 | `object-fit:cover; box-sizing:border-box; border-top:5px solid #FFFFFF; box-shadow:0 -6px 0 rgba(0,0,0,0.22)`. Content box is 1216 x 87; scale 0.8545 -> 119.6 high, centre-cropped. |
| K | Valance | `valance.png` | 34 | 30 | 1216 | 112 (spans y 30..142) | 0 | wrapper `filter: drop-shadow(0 3px 0 #FFFFFF) drop-shadow(0 6px 0 rgba(0,0,0,0.28))`; img `width:1216px;height:112px;object-fit:cover;object-position:center bottom` (scale 0.7548 -> 178 high; only the bottom 112 px of the image shows) |
| L | Left curtain | `curtain-left.png` | 36 | 132 | 305.3 (auto from h) | 540 (y 132..672) | 0 | filter F3 |
| M | Right curtain | `curtain-right.png` | x = 963.3 (CSS `right:38px`, right edge 1242) | 132 | 278.7 (auto) | 540 (y 132..672) | 0 | filter F3 |
| N | Screen UI | | | | | | | DOM: labels, bars, buttons, banners, targets, notes (sections 3 and 5) |
| O | Corner tapes x4 | none | see 1.3 | | 96 | 30 | see 1.3 | masking tape, above everything, outside the clip container |

Note on duel screens: targets, strike discs, banners and notes (N) are DOM elements placed after the curtains, so they paint over curtains and valance. The teal/pink puppets are in layer I, so curtains paint over puppets.

### 1.2 Filters

```css
/* F1 cutout, for sun and sign (3 px white edge + hard shadow 5,6 at 28%) */
filter: drop-shadow(3px 0 0 #FFFFFF) drop-shadow(-3px 0 0 #FFFFFF)
        drop-shadow(0 3px 0 #FFFFFF) drop-shadow(0 -3px 0 #FFFFFF)
        drop-shadow(5px 6px 0 rgba(0,0,0,0.28));
/* F2 puppet parts (2 px white edge + shadow 4,5 at 28%); in the workshop preview shadow is 3px 4px */
filter: drop-shadow(2px 0 0 #FFFFFF) drop-shadow(-2px 0 0 #FFFFFF)
        drop-shadow(0 2px 0 #FFFFFF) drop-shadow(0 -2px 0 #FFFFFF)
        drop-shadow(4px 5px 0 rgba(0,0,0,0.28));
/* F3 curtains: 3 px white edge left, right and BOTTOM only (no -3px top), shadow 5,6 at 28% */
filter: drop-shadow(3px 0 0 #FFFFFF) drop-shadow(-3px 0 0 #FFFFFF)
        drop-shadow(0 3px 0 #FFFFFF) drop-shadow(5px 6px 0 rgba(0,0,0,0.28));
/* F4 valance: white edge and shadow below only */
filter: drop-shadow(0 3px 0 #FFFFFF) drop-shadow(0 6px 0 rgba(0,0,0,0.28));
```

docs/DESIGN.md says "a 3 px white outline and a hard shadow offset 5 px right and 6 px down at 28% black". The mocks use 3 px for sun, sign, curtains and 2 px for puppet parts (shadow 4,5). Follow the mocks. Bake into textures (offscreen canvas), per DESIGN.md.

### 1.3 Per-screen differences

| Item | 1 title | 2 lobby | 5 attack | 6 defend | 7 victory |
|---|---|---|---|---|---|
| Sun left/top/width/rot | 958 / 372 / 120 / +8deg | same as 1 | 150 / 440 / 140 / -10deg | same as 5 | same as 1 |
| Sign (G) | yes | yes | no | no | yes |
| Sign text block top | 186 | 188 | n/a | n/a | 192 |

Corner tapes (layer O, identical on all five stage screens, children of root, not of the clip container). Colour `rgba(244,228,170,0.9)`, size 96 x 30, no border or shadow:

| Corner | left | top | rotate |
|---|---|---|---|
| top-left | 6 | 26 | -38deg |
| top-right | 1184 | 20 | 40deg |
| bottom-left | 2 | 672 | 36deg |
| bottom-right | 1186 | 668 | -42deg |

Workshop and battle theme (screens 3, 4) have no stage frame and no corner tapes; they sit on layer A only.

---

## 2. Play area

### 2.1 Measured edges

Curtain inner edge measured from the alpha channel of the PNGs (alpha > 128), at the mock scale (height 540, scale 0.4355):

| y | left curtain inner edge x | right curtain inner edge x |
|---|---|---|
| 132 (top) | 315.6 | 965.0 |
| 162 | 301.2 | 978.1 |
| 192 | 287.3 | 992.0 |
| 222 | 269.9 | 1009.5 |
| 252 | 247.2 | 1032.5 |
| 282 | 219.3 | 1060.0 |
| 312 | 186.2 | 1093.1 |
| 342 | 150.1 | 1129.2 |
| 372 | 122.2 | 1157.1 |
| 402 (tie-back, narrowest curtain) | 115.7 | 1163.6 |
| 432 | 120.9 | 1158.8 |
| 462 | 126.6 | 1152.7 |
| 492 | 132.7 | 1147.1 |
| 522 | 138.8 | 1140.5 |
| 552 | 145.3 | 1134.0 |
| 582 | 152.3 | 1127.0 |
| 612 | 158.4 | 1120.9 |

Add the 3 px white outline to each edge when you need the visible edge (left x + 3, right x - 3).

- Valance: lowest opaque pixel y = 141.2 (box bottom 142); with F4 the white edge ends at about 145 and the shadow at about 148.
- Ledge: top edge y = 603. White border 603..608. The -6 px shadow darkens y 597..603. Ledge bottom = 695.
- Curtains hang to y = 671.6 (hems rest on the ledge, over it, y 603..672).

### 2.2 Open stage

Between valance and ledge the curtains taper: the open stage is narrow at the top (x 316..965 at y 132) and wide at the bottom (x 116..1164 at y 402). A strict rectangle clear of both curtains over the whole height y 148..603 is x 310..970 (660 wide, 455 high).

The widest clear 2:1 rectangle (maximised by search, 3 px outline allowance) is 746 x 373 at x 267..1013, y 230..603. Recommended (rounded, with margin):

```
PLAY_RECT = { x: 270, y: 230, w: 740, h: 370 }   // aspect exactly 2:1; centre (640, 415)
            // right edge 1010, bottom edge 600
```

Margins from PLAY_RECT to the visible curtain edge (incl. 3 px outline): about 3 px left and 3 px right at the tightest row (y 230), growing to 100+ px lower down. Bottom margin: 3 px above the ledge top (603), 0 px if you count the ledge shadow that starts at 597. Top margin: 82 px below the valance. The centre line x = 640 is also the centre of the stage (curtains are symmetric about 640 to within 1 px: left 36..341.3, right 963.3..1242, mirror axis 639).

The mocks put things outside this rect: targets at y 165 to 330 (defending screen ring top at y 165), the heckle and streak notes over the curtains, the sun at x 150..290. Banners are overlays and may overlap the rect (the ATTACK/PARRY banner spans y 146..~235). PLAY_RECT is the safe zone for anything that must not be hidden by curtains; sample target positions in the mocks are not inside it (see section 7).

### 2.3 Ledge and puppet bases

| Item | Value |
|---|---|
| Ledge top y | 603 (border-box top; visible cardboard from y 608) |
| Ledge x extent | 34..1250 |
| Left puppet (teal in mocks) first segment centre | (330, 640) (below the ledge top, so its lower half is hidden behind the ledge) |
| Right puppet (pink in mocks) first segment centre | (950, 640) = mirrored (1280 - 330) |
| Second segment centre, idle | (356, 545) left; (924, 545) right |
| Head centre idle | (452, 455) left; (828, 455) right |
| Mouth end / sword anchor idle | (529, 440) teal; right: mirrored x of (527, 448) = (753, 448) |
| Centre line | x = 640 |

Mirroring: the right puppet is drawn in left-puppet coordinates inside `<g transform="translate(1280,0) scale(-1,1)">`.

---

## 3. Reusable components

All text colour is ink `#1B1210` unless stated. `Special Elite` is the default body font.

### 3.1 Ransom-note letter tiles

A tile is `display:flex; align-items:center; justify-content:center; width:W; height:H; transform:rotate(R)`; the row is `display:flex; align-items:center; gap:G; line-height:1`. Tiles have no border, no radius and no shadow of their own. Letter case is as typed (uppercase in banners; `t`, `o` lowercase in the title).

The 8-style cycle. The letter counter increments per tile (spaces and word gaps are skipped, punctuation counts). It restarts at 0 for each lettering, except the start offset differs: ATTACK! starts at style 0, PARRY! at style 2, "ALLEN WINS!" at style 5, ROW-G-12 at style 0.

| Style | Background | Text colour | Font | Rotate |
|---|---|---|---|---|
| 0 | #FFE14D | #1B1210 | Bungee | -4deg |
| 1 | #1B1210 | #FFFDF5 | Special Elite | 3deg |
| 2 | #D42A40 | #FFFFFF | Bungee | -2deg |
| 3 | #FFFDF5 | #1B1210 | Permanent Marker | 5deg |
| 4 | #2456C8 | #FFFFFF | Special Elite | -6deg (workshop header: -5deg) |
| 5 | #F48FB1 | #1B1210 | Bungee | 3deg |
| 6 | #FFFDF5 | #1B1210 | Special Elite | -3deg |
| 7 | #1B1210 | #FFE14D | Bungee | 4deg |

Sizes per lettering (fs = base font size on the row; Special Elite tiles use a larger font; Bungee tiles are 4 px taller than Elite/Marker in most rows):

| Lettering | gap | tile W | H Bungee (styles 0,2,5,7) | H Elite/Marker (1,3,4,6) | Bungee / Marker font | Elite font | Punctuation tile W |
|---|---|---|---|---|---|---|---|
| Title "TOE to TOE" | 6 | 62 (O Elite: 60) | 86 | 80 (O); small tiles below | 58 (set on row) | 66 | n/a |
| ATTACK! / PARRY! | 5 | 44 | 54 | 50 | 38 | 43 | 31 |
| Room code ROW-G-12 | 4 | 44 | 60 | 56 | 38 | 43 | 31 |
| NAME WINS! (victory) | 5 | 46 | 66 | 62 | 42 | 47 | 33 |
| Workshop header | 5 | 36 (W: 40) | 46 | 44 | 30 (row fs 30) | 34 | n/a |
| Battle theme header | 5 | 36 | 46 | 42 | 30 | 34 | n/a |

Title specifics: the lower-case words "to" use small tiles: `t` is style 3 (Permanent Marker, 46px, 46 x 62, rotate 5deg, `margin-left:14px`); `o` is style 4 (Special Elite 46px, 46 x 58, rotate -6deg, `margin-right:14px`). The rest are 62 wide; the row `h1` is `margin:0; font-weight:400; font-size:58px; line-height:1`. The whole title block is `rotate(-1deg)`.

Word gap in "ALLEN WINS!": `margin-left:18px` on the first tile of the second word. In "BATTLE THEME": `margin-left:14px` on the T. Punctuation (`!`, `-`) uses the narrow tile and the same cycle style. Heights on `-` tiles follow their style (ROW-G-12: `-` as style 3 is 56 high, as style 5 is 60 high).

### 3.2 Black label strips

```css
padding:2px 10px 0 10px; background:#1B1210; color:#FFFFFF;
letter-spacing:0.14em; line-height:1.5; text-transform: none (text typed in capitals);
```

Font sizes: 17 (player names in duel and victory), 16 (ROOM CODE), 15 (panel headings in workshop, battle theme; letter-spacing 0.14em in battle theme, 0.16em with `padding:1px 10px` in workshop), 14 (YOUR NAME, YOUR FRIEND, BATTLE THEME tag, duel phrase caption), 13 (SELECTED badge, letter-spacing 0.12em, `padding:1px 8px 0 8px; line-height:1.6`). Colour is pure `#FFFFFF`, not the paper white. The text in the mocks is typed in capitals.

### 3.3 Masking-tape notes (marker)

```css
background:rgba(244,228,170,0.95);   /* 0.96 on duel notes, 0.95 elsewhere */
font-family:'Permanent Marker',...; line-height:1.3;
padding:4px 18px; transform:rotate(Rdeg);
```

Instances: sizes 19 to 21, rotate -5deg to 2deg, padding `4px 18px` (strike hint `4px 16px`, workshop and battle theme notes `6px 18px` and `8px 18px`). No border, no shadow. Plain rectangles (no torn clip).

### 3.4 Torn-paper typed notes

```css
background:#FFFDF5; font-family:'Special Elite'; font-size:17px (note) / 18px / 24px (subtitle);
line-height:1.25; padding:8px 12px 5px 12px; transform:rotate(-3deg);
clip-path:polygon(0% 5%, 97% 0%, 100% 94%, 3% 100%);   /* heckles and hints */
```

Subtitle variant: `padding:6px 22px 4px 22px; font-size:24px; line-height:1.2; clip-path:polygon(0% 12%,4% 0%,97% 6%,100% 88%,95% 100%,3% 92%)`. No box-shadow on these (a clip-path would cut it off anyway).

Plain paper tags without clip: `padding:2px 10px 0 10px; background:#FFFDF5; font-size:15..18px; line-height:1.4` (act counter label, "you", "not ready", "ACT 2 of 3").

### 3.5 Buttons

Common to all button variants:

```css
display:flex; align-items:center; border:0; border-radius:0; padding:3px 20px 0 20px;
font-family:Bungee,Impact,sans-serif; color:#1B1210; text-decoration:none; cursor:pointer;
box-shadow:5px 6px 0 rgba(0,0,0,0.35);
```

| Variant | Label | bg | h | fs | rotate | clip-path | Where |
|---|---|---|---|---|---|---|---|
| Primary yellow, large | "Create a room" | #FFE14D | 46 | 20 | -2deg | `polygon(1% 5%,99% 0%,100% 93%,2% 100%)` | title |
| Primary yellow, large | "I'm ready" | #FFE14D | 48 | 22 | 2deg | same | lobby |
| Primary yellow, large | "Rematch" | #FFE14D | 48 | 22 | -2deg | same | victory |
| Primary yellow, large | "Use this theme" | #FFE14D | 50 | 22 | -1deg | same | battle theme |
| Primary yellow, large | "Save to my Sock Drawer" | #FFE14D | 50 | 21 | -1deg | same (`margin-top:4px`) | workshop |
| Yellow, small | "Copy link" | #FFE14D | 38 | 16 | 2deg | none | lobby |
| Yellow, small | "Choose a file" | #FFE14D | 40 | 17 | -1deg | none | battle theme |
| Pink, large | "Join a room" | #F48FB1 | 46 | 20 | 2deg | `polygon(0% 0%,98% 4%,100% 100%,3% 95%)` | title |
| Pink, medium | "Tap along" | #F48FB1 | 52 | 20 | -2deg | none | battle theme |
| Pink, medium | "Edit my puppet" | #F48FB1 | 40 | 17 | -1deg | none | lobby |
| Pink, medium | "Back to the room" | #F48FB1 | 40 | 18 | 2deg (workshop), -2deg (battle theme) | none | workshop (shadow `4px 5px 0 rgba(0,0,0,0.35)`, padding `3px 18px 0 18px`), battle theme |
| Pink, medium | "Leave" | #F48FB1 | 40 | 17 | -1deg | none | victory |
| Paper (secondary) | "Workshop" | #FFFDF5 | 40 | 17 | -1deg | none | title |
| Paper (secondary) | "Themes" | #FFFDF5 | 40 | 17 | 1deg | none | title |
| Paper (secondary) | "Back to the room" | #FFFDF5 | 40 | 17 | 1deg | none | victory |
| Paper outlined | "Play with a click track" | #FFFDF5 | 42 | 16 | 1deg | none | battle theme: `border:3px solid #1B1210; box-shadow:none` |
| Paper text link | "leave the room" | #FFFDF5 | auto | 17 (Special Elite, line-height 1.3) | -3deg | none | lobby; `padding:6px 14px 3px 14px`, no shadow, not Bungee |

Button rows use `display:flex; gap:14..16px; align-items:center`. Title row: top 622, centred on x = 640, `gap:14px`, with `margin-left:10px` before the room-code group, `margin-left:16px` before Workshop/Themes.

When `clip-path` is set the `box-shadow` is clipped off and is not visible (see section 7).

Icon button (workshop tools): `height:52px; background:#FFFFFF (selected #FFE14D); border:3px solid #1B1210; border-radius:0; cursor:pointer`, icon svg 28 x 28, `stroke:#1B1210; stroke-width:2.4; round caps and joins; fill:none`. Brush-size buttons: height 44, dot sizes 8, 14, 22 px. Colour swatches: 30 x 30 circle, `border:3px solid #1B1210`; selected swatch adds `box-shadow:0 0 0 3px #FFFDF5, 0 0 0 6px #1B1210`. Stepper buttons (battle theme): 44 x 44, white, 3px ink border, icon 22 x 22, stroke 3. Step/phase tabs (workshop): `height:34px; padding:2px 16px 0 16px; font:Special Elite 18px; letter-spacing:0.14em; border:0; border-radius:0`; selected bg #FFE14D with ink text; unselected bg #1B1210 with #FFFFFF text.

Track row button (battle theme): `width:100%; height:48px; padding:3px 14px 0 14px; border:3px solid #1B1210; border-radius:0; font:Special Elite 19px; text-align:left; display:flex; justify-content:space-between; gap:12px`; unselected bg #FFFFFF, selected bg #FFE14D; right side text 16px.

### 3.6 Text inputs

```css
box-sizing:border-box; background:#FFFDF5; color:#1B1210; border:3px dashed #1B1210;
border-radius:0; font-family:'Special Elite','Courier New',monospace;
```

| Input | w | h | font-size | padding | placeholder/value |
|---|---|---|---|---|---|
| Room code (title) | 150 | 46 | 20 | `3px 12px 0 12px` | placeholder "ROOM CODE" |
| Your name (lobby) | 140 | 42 | 20 | `3px 10px 0 10px` | value "Allen" (example) |
| Puppet's name (workshop) | 376 (stretch) | 46 | 22 | `3px 14px 0 14px` | value "Sir Stinkfoot" (example) |

Placeholder colour is not in the mocks (browser default in the screenshot).

### 3.7 Health and Stamina bars

Block per player, `position:absolute; top:609px`; left player `left:186px` (x 186..392), right player `right:186px` (x 888..1094), both inset from the curtain hems. Left block is `align-items:flex-start`, right block `align-items:flex-end`; `display:flex; flex-direction:column; gap:3px`.

```css
/* name strip: section 3.2 at 17px; left player also gets a "you" tag next to it (gap 6) */
.row  { display:flex; align-items:center; gap:8px; padding:3px 8px; background:#FFFDF5 }   /* width 206 */
.row .label { width:70px; font-size:15px; line-height:1 }   /* Special Elite */
.bar  { width:112px; height:12px; box-sizing:border-box; border:3px solid #1B1210; background:#FFFFFF }
.bar > .fill { width:N%; height:100% }          /* interior 106 x 6 */
/* Health fill #D42A40; Stamina fill #2456C8 */
```

Order: name strip, Health row, Stamina row. Heights: name strip about 27, rows 21 each, block ends about y 685 (inside the ledge, which ends 695). Fill percentages in mocks (examples): Allen Health 72, Stamina 46 (attack) / 88 (defend); Maya Health 54, Stamina 31.

Label text: mocks contain "HEALTH" and "STAMINA" in capitals; see section 7 for the required wording.

### 3.8 Phrase dots (8 half-beat dots, middle of ledge)

Container: `position:absolute; left:0; top:613px; width:1280px; display:flex; flex-direction:column; align-items:center; gap:6px; pointer-events:none`. Caption is a black label strip, fs 14: "YOUR ATTACK, IN HALF-BEATS" (attacking) / "MAYA'S ATTACK, IN HALF-BEATS" (defending). Under it a row of 8 dots, `gap:8px`, each `24 x 24; border-radius:50%; box-sizing:border-box; border:3px solid`:

| Dot state | background | border | opacity |
|---|---|---|---|
| Empty (no strike on this half-beat) | #FFFDF5 | #1B1210 | 0.6 |
| Planted strike (attack screen) | #D42A40 | #FFFFFF | 1 |
| Newest planted / current (attack) | #FFE14D | #1B1210 | 1 |
| Parried (defend) | #7BC67B | #1B1210 | 1 |
| Red with ink border (defend, beat 3) | #D42A40 | #1B1210 | 1 (meaning not stated, see section 7) |
| Yellow with ink border (defend, beats 4 and 7) | #FFE14D | #1B1210 | 1 |

Attack mock dots by half-beat 1..8: red, red, empty, red, yellow, empty, empty, empty. Defend mock: green, empty, red/ink, yellow, empty, empty, yellow, empty.

### 3.9 Act counter

Container `position:absolute; left:0; top:146px; width:1280px; display:flex; flex-direction:column; align-items:center; gap:6px; pointer-events:none` (it also contains the banner, section 3.12). Counter row `display:flex; align-items:center; gap:12px`:
- Label: `padding:2px 10px 0 10px; background:#FFFDF5; font-size:18px; line-height:1.4`, text "ACT 2 of 3".
- Act dots: done = 18 x 18 circle `background:#1B1210`; current = 24 x 24 `background:#D42A40; border:3px solid #FFFFFF`; to come = 18 x 18 `background:#FFFDF5; border:3px solid #1B1210`.
Attack mock: done, done, current, to come (4 dots). Defend mock: done, current, to come, to come (4 dots). See section 7: 4 dots for "of 3".

### 3.10 Streak note

```css
position:absolute; left:1004px; top:250px; padding:12px 22px 8px 22px; background:#FFFDF5;
box-shadow:4px 5px 0 rgba(0,0,0,0.28); font-family:'Permanent Marker'; font-size:28px; line-height:1.05;
text-align:center; transform:rotate(4deg); clip-path:polygon(0% 6%,96% 0%,100% 90%,5% 100%);
/* inside: <span style="font-size:60px;color:#D42A40">7</span><br>in a row!  */
```

The shadow is cut off by the clip-path.

### 3.11 Heckle notes

Torn-paper typed note (3.4): `position:absolute; left:60px; top:150px; width:170px` (176 on the attack hint). Copy: `A child in row G: "that one is just a sock."`. Hint on attack screen uses the same style and place. Lobby/victory heckle in marker tape style (3.3), e.g. `a child in row G: "again! again!"`.

### 3.12 Banners and Bravo

Banner (ATTACK!, PARRY!): tile lettering (3.1, banner row), `role="img" aria-label="ATTACK!"`, centred under the act counter; the banner row sits inside the container at top 146, so tile tops are at about y 176 and the bottom at about y 230.

- "ATTACK!": 7 tiles, styles 0..6.
- "PARRY!": 6 tiles, styles 2..7.
- "NAME WINS!": victory lettering size (46 x 66, fs 42), 10 tiles in the mock ("ALLEN WINS!"), centred on the sign at top 192.

Bravo pop-up (parry feedback), on the defend screen:

```css
position:absolute; left:104px; top:296px; padding:2px 20px; background:rgba(244,228,170,0.96);
font-family:'Permanent Marker'; font-size:36px; line-height:1.3; transform:rotate(-8deg);   /* text "BRAVO!" */
```

### 3.13 Targets (defend screen; 88 px discs)

Disc (waiting):

```css
width:88px; height:88px; box-sizing:border-box; border-radius:50%; background:#FFE14D;
border:5px solid #1B1210; box-shadow:inset 0 0 0 4px #FFE14D, inset 0 0 0 7px #1B1210;   /* double ring */
font-family:Bungee; font-size:30px; line-height:1; display:flex; align-items:center; justify-content:center;
```

Ring closing in: a second element, same centre as the disc, `border-radius:50%; box-sizing:border-box; border:5px solid rgba(27,18,16,1)`, no fill. Its diameter is larger the further away the strike is in time and shrinks toward the disc's 88 px. Sizes in the mock: 116 (about to land, target 2), 170 (target 3), 230 (target 4). The far ring is faded: `rgba(27,18,16,0.45)` border, and the disc `opacity:0.8`. The final ring size and the hit/early/late timing windows are not in the mocks.

Parried: `width:88px; height:88px; border-radius:50%; background:#7BC67B; border:5px solid #1B1210`, containing a 44 x 44 tick `<svg viewBox="0 0 24 24" fill="none" stroke="#1B1210" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13 L10 18 L19 7"/></svg>`.

Missed: not shown in any mock. Not in mocks.

Order line: `polyline points="200,400 833,243 420,250 640,500"; fill:none; stroke:#1B1210; stroke-width:4; stroke-dasharray:2 12; stroke-linecap:round; opacity:0.6` (inside the puppet SVG, between pink and teal groups). Connects target centres in order (parried one first).

### 3.14 Planted strike discs and joining line (attack screen)

```css
/* planted */ width:54px;height:54px;box-sizing:border-box;border-radius:50%;background:#D42A40;
              border:4px solid #FFFFFF;box-shadow:0 0 0 3px #1B1210;color:#FFFFFF;
              font-family:Bungee;font-size:22px;line-height:1;display:flex;align-items:center;justify-content:center
/* newest  */ width:64px;height:64px;background:#FFE14D;border:4px solid #FFFFFF;box-shadow:0 0 0 3px #1B1210;color:#1B1210;font-size:26px
```

Disc centres (disc left/top + half size): #1 (760, 548), #2 (1046, 528), #3 (716, 388), #4 newest (1054, 364). Line: `<polyline points="760,548 1046,528 716,388 1054,364" fill="none" stroke="#D42A40" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`, drawn after the pink puppet and before the teal puppet (so it passes behind the teal puppet, in front of the pink). Discs are DOM, above the curtains.

### 3.15 Other panels and widgets (menus)

| Component | CSS |
|---|---|
| Paper panel (workshop tools, battle theme) | `background:#FFFDF5; box-shadow:5px 6px 0 rgba(0,0,0,0.3); box-sizing:border-box; padding:14px (tools) / 18px (battle theme); display:flex; flex-direction:column; gap:10px; transform:rotate(-0.6deg)` (tools, w168), `rotate(-0.5deg)` (house tracks, w580), `rotate(0.5deg)` (set the beat, w588) |
| Header strip (workshop, battle theme) | `left:40; top:20; w1200; h66; border:4px solid #FFFFFF; box-shadow:5px 6px 0 rgba(0,0,0,0.3); box-sizing:border-box; overflow:hidden; transform:rotate(-0.4deg)` (workshop) / `rotate(0.4deg)` (battle theme); background = `ledge-cardboard.jpg` object-fit cover; content row `padding:0 18px; justify-content:space-between; align-items:center` |
| Drawing page | `left:232; top:146; w600; h440; background:#FFFFFF; box-shadow:6px 8px 0 rgba(0,0,0,0.3)`; guide box rect x40 y40 520 x 360, `stroke:#9AA3AF; stroke-width:2; stroke-dasharray:8 8; fill:none`; corner tapes 84 x 26 `rgba(244,228,170,0.92)` rotate 32deg at `left:-24px;bottom:-10px` and `right:-22px;top:-12px` |
| Drawing-page hints | `padding:0 6px; background:#FFFFFF; font-size:15px; color:#4B5563`: "pin goes here" (left 150, top 276), "mouth end" (left 470, top 236); arrow `M500 220 L544 220 M532 208 L544 220 L532 232`, `stroke:#6B7280; stroke-width:3` |
| Live preview frame | `w376; h226; border:5px solid #FFFFFF; box-shadow:5px 6px 0 rgba(0,0,0,0.3); overflow:hidden`; sky image fills; a ledge strip `height:34px; border-top:3px solid #FFFFFF` at the bottom |
| Sock drawer cell | `height:64px; background:#FFFDF5; border:3px solid #1B1210; border-radius:0`; selected: `border:4px solid #FFE14D; box-shadow:0 0 0 3px #1B1210`; "new" cell `border:3px dashed #1B1210` with a plus icon 28 px; thumbnail ellipse `cx30 cy24 rx22 ry14`, stroke 3, two white eye circles r5 at (34,16) and r4 at (44,18), stroke 2 |
| Drop zone | `height:132px; border:3px dashed #1B1210; background:#FFFFFF; margin-top:6px; gap:8px; flex column centred` |
| Waveform | `svg 516 x 80; background:#FFFFFF; border:3px solid #1B1210`; bars 4 px wide, pitch 6 px from x = 6 to 504, `fill:#1B1210`, beat bars `fill:#D42A40` at x = 30, 102, 174, 246, 318, 390, 462; bar heights vary 12 to 57 px, centred on y 40 (data is an example) |
| Tap-along strip | `display:flex; align-items:center; gap:16px; padding:12px; background:#FFFFFF; border:3px solid #1B1210`; beat dots: 22 px filled ink; 30 px `background:#D42A40; border:3px solid #1B1210`; 22 px outline `border:3px solid #1B1210` x2 |
| Status tag "ready" | `padding:2px 8px 0 8px; background:#7BC67B; border:3px solid #1B1210; font-size:15px; line-height:1.4` |
| Status tag "winner" | same, `background:#FFE14D` |
| Friend name box | `height:42px; padding:3px 12px 0 12px; background:#FFFDF5; font-size:20px; display:flex; align-items:center` |
| BATTLE THEME chip (lobby) | `display:flex; align-items:center; gap:12px; padding:8px 14px; background:#FFFDF5; box-shadow:4px 5px 0 rgba(0,0,0,0.28); transform:rotate(1deg)`; contains label strip (14), text 18px, link "change" 18px (default link style) |

---

## 4. Puppets

The two example puppets are inline SVG. In the game they are player bitmaps; below is how the example is built so presets can be rendered from it.

### 4.1 Build

A puppet = a chain of identical sock segments (a stripe-patterned rounded rect), pins at the joints, a head at the end of the chain, and a sword held in the head's mouth. Everything is drawn once and transformed. Group attributes: `stroke-linecap="round" stroke-linejoin="round"`, filter F2 (section 1.2) on the whole puppet group (segments, sword, head, not the pins; pins are in a separate group after, unfiltered).

Draw order in a puppet group (back to front): sock segments (first to last) -> sword -> head. Pins are drawn after the filtered group.

Sock segment (identical for both puppets except colours):

```svg
<g transform="translate(CX,CY) rotate(A)">
  <rect x="-60" y="-41" width="120" height="82" rx="36" fill="BODY" stroke="#1B1210" stroke-width="5"/>
  <rect x="-8" y="-38" width="16" height="76" fill="STRIPE"/>
</g>
```

- Natural size 120 x 82 (stroke adds 2.5 px per side: bbox about 125 x 87), corner radius 36, centred on the origin; the long axis is the local x axis. The stripe is 16 x 76 centred (no stroke).
- The mocks shrink the long axis to compress the chain (widths 96..120; the height stays 82). Width values seen: 120 (idle), 104..110 (stretched), 96 and 106 (slumped).
- Teal: BODY `#3FB8AF`, STRIPE `#FFE14D`. Pink: BODY `#F48FB1`, STRIPE `#7B3FD1`.
- The workshop preview uses the same shape at 74 x 58, rx 26, stroke 4, stripe 12 x 52 (scale 0.62).

Pins: `<g fill="#D4AF37" stroke="#7A5C12" stroke-width="2"><circle cx cy r="7"/>...</g>` (workshop preview: r 5, stroke 1.5). One pin per joint between consecutive pieces, placed where the two pieces overlap (for the idle pose: segment 1/2 joint at (333, 590); segment 2/head joint at (390, 487) teal, (386, 485) pink as mirrored x in group coordinates). A pin is a gold dot at the joint, not at either segment's centre. The pin sits at the head's pin point (local (58, 150) teal; pink head about (52, 145)).

Head transform: `translate(HX,HY) rotate(HA) scale(HS) translate(-166,-120)`; the head's local point (166,120) is placed at (HX,HY). Idle: translate(452,455) rotate(-12) scale(0.62).

Sword transform: `translate(SX,SY) rotate(SA) scale(SS) translate(-38,-40)`; the sword's local point (38, 40) (the middle of the hilt) is placed at (SX,SY). Idle teal: translate(529,440) rotate(-14) scale(0.5). Idle pink: translate(527,448) rotate(-14) scale(0.5). The sword anchor equals the head's mouth end: mouth end local (292,122) teal / (286,134) pink maps to (528.7, 440.0) / (526.6, 448.0) with the idle head transform (verified), so SX,SY equals the head's transformed mouth end.

### 4.2 Natural sizes and anchors

| Part | Natural drawing extent (local coords) | Anchors (local coords) |
|---|---|---|
| Sock segment | rect 120 x 82 centred on (0,0), stroke 5 | joint ends at x = +/-60 (pin region about 10 px inside each end); long axis x |
| Teal head | path extent x 38..293, y 45..195 (sample), plus hair to y about 20; features (eyes to x 266, mouth to x 292); all about x 33..300, y 16..198 with stroke | pin point (58, 150); mouth end (292, 122); drawing origin (166, 120) used as the transform centre |
| Pink head | path x 36..286, y 48..195; hair up to y 18; all about x 33..290, y 14..198 | pin point about (52, 145) (derived from the lobby mock, 386,485; the workshop does not show the pink head); mouth end (286, 134); origin (166, 120) |
| Teal sword | grip rect x 14..62, y 30..50; blade polygon x 70..318, y 20..60; guard rect x 58..72, y 10..70; total x 10..322, y 6..74 incl. stroke 8 | handle anchor (38, 40); tip (318, 40) |
| Pink sword | grip rect x 14..58, y 30..50; blade polygon x 70..318, y 20..60; pommel circle (64,40) r22; total x 10..322, y 14..66 incl. stroke 8 | handle anchor (38, 40); tip (318, 40) |

The sword's tip distance from the anchor is 280 local units (140 px at scale 0.5, 112 at 0.4, 162 at 0.58). In the idle pose the two swords cross near x 640.

The workshop drawing page (600 x 440) shows the head at `translate(110,70) scale(1.25)`, so the player draws about 340 x 240 inside the 520 x 360 dashed guide box (x 40..560, y 40..400). The pin marker is at page (182, 258) = head local (58, 150). The arrow at page x 500..544, y 220 = head local x about 312..347, y 120 marks the mouth end (the mouth end points right).

### 4.3 SVG path data

Teal head (fill #3FB8AF, stroke #1B1210, 7; origin 166,120):

```svg
<path d="M40 150 C 30 90, 70 50, 140 46 C 210 40, 280 70, 292 118 C 300 150, 262 176, 214 186 C 150 200, 52 204, 40 150 Z" fill="#3FB8AF" stroke="#1B1210" stroke-width="7"/>
<circle cx="96" cy="132" r="12" fill="#FFE14D"/><circle cx="142" cy="154" r="9" fill="#FFE14D"/><circle cx="122" cy="98" r="8" fill="#FFE14D"/>
<path d="M292 122 L250 132 L262 146 L226 150 L240 164 L206 170" fill="none" stroke="#1B1210" stroke-width="7"/>
<circle cx="196" cy="84" r="22" fill="#FFFFFF" stroke="#1B1210" stroke-width="6"/><circle cx="244" cy="92" r="17" fill="#FFFFFF" stroke="#1B1210" stroke-width="6"/>
<circle cx="203" cy="88" r="8" fill="#1B1210"/><circle cx="249" cy="95" r="6" fill="#1B1210"/>
<path d="M92 60 q-10 -34 12 -40 q4 30 14 34 q-2 -36 22 -40 q2 30 12 36" fill="none" stroke="#D42A40" stroke-width="7"/>
```

Teal sock segment: see 4.1 (BODY #3FB8AF, STRIPE #FFE14D). Teal sword (grip brown #8A5A2B, blade grey #C9D2DC, guard yellow #FFE14D, stroke #1B1210, 8):

```svg
<rect x="14" y="30" width="48" height="20" fill="#8A5A2B" stroke="#1B1210" stroke-width="8"/>
<path d="M70 26 L288 20 L318 40 L288 60 L70 54 Z" fill="#C9D2DC" stroke="#1B1210" stroke-width="8"/>
<rect x="58" y="10" width="14" height="60" fill="#FFE14D" stroke="#1B1210" stroke-width="8"/>
```

(In the duel attack mock the teal grip rect is 48 wide at x 14, the same sword; the workshop preview sword uses blade `M70 40 L300 26 L318 40 L300 54 Z` fill `#E9EEF3`, the same grip and guard.)

Pink head (fill #F48FB1; faces right in its own frame, the right puppet is mirrored by the group transform; origin 166,120):

```svg
<path d="M36 140 C 30 80, 90 40, 160 50 C 230 44, 290 80, 286 130 C 284 170, 230 196, 170 192 C 100 200, 44 196, 36 140 Z" fill="#F48FB1" stroke="#1B1210" stroke-width="7"/>
<path d="M72 150 L98 164 M112 112 L134 128 M90 100 L104 108" fill="none" stroke="#7B3FD1" stroke-width="8"/>
<path d="M286 134 Q250 166 204 152" fill="none" stroke="#1B1210" stroke-width="7"/>
<path d="M262 150 L262 162 M244 154 L244 166" fill="none" stroke="#1B1210" stroke-width="5"/>
<circle cx="214" cy="98" r="30" fill="#FFFFFF" stroke="#1B1210" stroke-width="6"/>
<circle cx="224" cy="102" r="11" fill="#1B1210"/>
<path d="M178 62 L248 54" fill="none" stroke="#1B1210" stroke-width="7"/>
<path d="M70 74 L58 30 L92 58 L100 18 L124 52 L142 24 L150 58" fill="none" stroke="#7B3FD1" stroke-width="7"/>
```

Pink head, knocked out (victory mock): replace the pupil circle `<circle cx="224" cy="102" r="11"/>` with `<path d="M200 84 L228 112 M228 84 L200 112" fill="none" stroke="#1B1210" stroke-width="7"/>`.

Pink sock segment: see 4.1 (BODY #F48FB1, STRIPE #7B3FD1). Pink sword (grip purple #7B3FD1, blade yellow #FFE14D, pommel pink #F48FB1):

```svg
<rect x="14" y="30" width="44" height="20" fill="#7B3FD1" stroke="#1B1210" stroke-width="8"/>
<path d="M70 32 L294 20 L318 40 L294 60 L70 48 Z" fill="#FFE14D" stroke="#1B1210" stroke-width="8"/>
<circle cx="64" cy="40" r="22" fill="#F48FB1" stroke="#1B1210" stroke-width="8"/>
```

### 4.4 Poses seen in the mocks

Left puppet (teal), segment tuples are `translate(x,y) rotate(deg)` with the long-axis width in brackets. Pink poses are in mirrored group coordinates (actual x = 1280 - x).

| Screen / pose | Segments | Head `(x,y,rot,scale)` | Sword `(x,y,rot,scale)` | Pins |
|---|---|---|---|---|
| 1, 2 idle teal | (330,640,-84)[120]; (356,545,-62)[120] | (452,455,-12,0.62) | (529,440,-14,0.5) | (333,590); (390,487) |
| 1, 2 idle pink | (330,640,-84)[120]; (356,545,-62)[120] | (452,455,-12,0.62) | (527,448,-14,0.5) | (333,590); (386,485) |
| 5 attack, pink (idle, same as above) | same | same | (527,448,-14,0.5) | (333,590); (386,485) |
| 5 attack, teal (stretched) | (309,672,-79)[107]; (350,592,-48)[111]; (423,534,-29)[110]; (500,482,-39)[110]; (554,409,-67)[110]; (602,330,-50)[109]; (677,285,-11)[109]; (769,285,12)[110] | (880,300,20,0.58) head path: teal | (948,326,20,0.4) | (318,628) (382,557) (464,512) (536,452) (572,366) (632,294) (723,276) (815,295) |
| 6 defend, teal (stretched) | (306,674,-81)[104]; (345,597,-46)[108]; (407,531,-48)[106]; (447,453,-78)[108]; (483,375,-51)[100]; (555,336,-8)[107] | (655,295,-16.7,0.58) | (725,275,-16.7,0.4) | (313,630) (377,564) (437,497) (457,408) (510,342) (600,330) |
| 6 defend, pink | idle (as attack) | idle | idle | idle |
| 7 victory, teal (sword raised) | (330,640,-84)[120]; (356,545,-62)[120] | (448,462,-16,0.62) | (523,442,-24,0.45) | (333,590); (389,498) |
| 7 victory, pink (slumped) | (330,652,-84)[106]; (348,588,-66)[96] | (424,574,34,0.58), head with X eye | (566,574,10,0.5) (sword lying) | (334,612); (361,550) |

The sword in 5 and 6 (teal) uses scale 0.4 (shorter than idle 0.5), and the teal sword in these screens is longer in reach because the head is scaled 0.58.

---

## 5. Per-screen layouts

Positions are absolute within the 1280 x 720 root unless a row says "in flow". `rot` is CSS rotate. Style codes refer to sections 3.x.

### 5.1 Title (1-title.html)

| Element | Text | left | top | w x h | rot | Style |
|---|---|---|---|---|---|---|
| Sign text block (flex column, centre, gap 10) | | 350 | 186 | 580 x auto | -1deg | container |
| Title tiles | "TOE to TOE" (aria "Toe to Toe") | in block | | row, tiles per 3.1 | block -1deg | ransom tiles, title size |
| Subtitle | "a sock puppet duel for two" | in block | | auto | 0 | torn-paper subtitle (3.4), 24px |
| Tape note | "tonight only! the socks do not match." | in block | | auto | 2deg | masking-tape note 21px, `padding:4px 18px`, background `rgba(244,228,170,0.95)` |
| Button row | | 0 | 622 | 1280 x auto, centred | 0 | row, gap 14 |
| Create a room | "Create a room" | in row | | h46 | -2deg | primary yellow large |
| Room code input | placeholder "ROOM CODE" | in row (margin-left 10) | | 150 x 46 | 0 | input (3.6) |
| Join a room | "Join a room" | in row (gap 8 from input) | | h46 | 2deg | pink large |
| Workshop | "Workshop" | in row (margin-left 16) | | h40 | -1deg | paper secondary |
| Themes | "Themes" | in row | | h40 | 1deg | paper secondary |

Sun (958,372,120, rot 8deg) and puppets idle (section 4.4). Puppet SVG aria: "Two hand-drawn sock puppets, one teal and one pink, rise from behind the ledge and cross their drawn swords".

### 5.2 Room lobby (2-lobby.html)

| Element | Text | left | top | w x h | rot | Style |
|---|---|---|---|---|---|---|
| Sign text block (column, centre, gap 10) | | 350 | 188 | 580 x auto | -1deg | container |
| Room code label | "ROOM CODE" | in block row (gap 14) | | auto | 0 | black label, fs 16 |
| Room code tiles | "ROW-G-12" (example) | in row | | tiles 44 x 60/56, gap 4 | 0 | ransom tiles, lobby size |
| Link text | "toetotoe.allenzheng.com/ROW-G-12" (example domain) | in block row (gap 12) | | auto | 0 | paper tag, `padding:6px 16px 3px 16px; font-size:19px; line-height:1.3` |
| Copy link | "Copy link" | in row | | h38 | 2deg | yellow small |
| Share note | "send this link to a friend" | in block | | auto | -1deg | masking-tape note 20px |
| Leave link | "leave the room" | 60 | 150 | auto | -3deg | paper text link |
| Battle theme chip | "BATTLE THEME", "[DEFAULT TRACK 1], 120 BPM", "change" | 0 (full width, centred) | 532 | auto | 1deg | chip (3.15) |
| Your name block (column, gap 4) | label "YOUR NAME" | 186 | 609 | auto | 0 | black label 14 |
| Name input | value "Allen" (example) | in block | | 140 x 42 | 0 | input |
| Ready tag next to input | "not ready" | in block row (gap 8) | | auto | 0 | paper tag 15px |
| Button row | | 0 | 622 | 1280 x auto, centred, gap 16 | 0 | |
| Edit my puppet | "Edit my puppet" | in row | | h40 | -1deg | pink medium |
| I'm ready | "I'm ready" | in row | | h48 | 2deg | yellow large (fs 22) |
| Friend block (column, gap 4, right aligned) | label "YOUR FRIEND" | right:186 (x 888..1094) | 609 | auto | 0 | black label 14 |
| Friend ready tag | "ready" | in block row (gap 8) | | auto | 0 | green status tag |
| Friend name | "Maya" (example) | in block row | | auto x 42 | 0 | friend name box |

Sun (958,372,120,+8) and puppets idle. Puppet SVG aria: "Both players' hand-drawn sock puppets wait on the stage, swords crossed".

### 5.3 Puppet workshop (3-workshop.html; mat only)

| Element | Text | left | top | w x h | rot | Style |
|---|---|---|---|---|---|---|
| Header strip | | 40 | 20 | 1200 x 66 | -0.4deg | header strip |
| Title tiles | "WORKSHOP" | in strip (left, padding 18) | | row, workshop size | 0 | ransom tiles |
| Header caption | "draw your own puppet and sword" | in strip (centre) | | auto | 0 | paper tag, `padding:3px 14px 0 14px; font-size:18px; line-height:1.4` |
| Back button | "Back to the room" | in strip (right) | | h40 | 2deg | pink medium |
| Tools panel | | 40 | 106 | 168 x auto | -0.6deg | paper panel, padding 14 |
| TOOLS label | "TOOLS" | in panel | | auto | 0 | black label 15, ls 0.16em |
| Tool buttons (grid 2 x 3, gap 8) | aria: Brush (selected), Eraser, Fill, Undo, Redo, Clear the page | in panel | | each (168-28-8)/2 = 66 x 52 | 0 | icon button |
| BRUSH SIZE label | "BRUSH SIZE" | in panel | | | | black label |
| Brush sizes (grid 3, gap 8) | aria: Small / Medium (selected) / Large brush | in panel | | each 44 high | 0 | icon button |
| COLOURS label | "COLOURS" | in panel | | | | black label |
| Swatches (grid 4 x 3, gap 6) | Black #1B1210, White #FFFFFF, Red #D42A40, Pink #F48FB1, Orange #F08A24, Yellow #FFE14D, Green #3FA65A, Teal #3FB8AF (selected), Blue #2456C8, Purple #7B3FD1, Brown #8A5A2B, Grey #9AA3AF | in panel | | 30 x 30 | 0 | swatch |
| Tabs | "1. HEAD" (selected), "2. SOCK PIECE", "3. SWORD" | 232 | 106 | h34, gap 8 | 0 | tab buttons |
| Drawing page | | 232 | 146 | 600 x 440 | 0 | drawing page (3.15) |
| Draw hint | "draw inside the dashes. the mouth end points right!" | 232 | 604 | auto | -1deg | masking-tape note 19px, `padding:6px 18px` |
| Right column (column, gap 8, width 376) | | 864 | 106 | 376 x auto | 0 | |
| LIVE PREVIEW label | "LIVE PREVIEW" | in column | | | | black label 15, ls 0.16em |
| Preview frame | | in column | | 376 x 226 | 0 | live preview frame |
| PUPPET'S NAME label | "PUPPET'S NAME" | in column (margin-top 4) | | | | black label |
| Puppet name input | "Sir Stinkfoot" (example) | in column | | 376 x 46 | 0 | input 22px |
| Save button | "Save to my Sock Drawer" | in column (margin-top 4) | | 376 x 50 | -1deg | primary yellow large |
| MY SOCK DRAWER label | "MY SOCK DRAWER" | in column (margin-top 10) | | | | black label |
| Drawer grid (4 cols, gap 8) | aria: "Sir Stinkfoot, being edited" (selected), "Open saved puppet Lady Lint", "Open saved puppet Gary", "Start a new puppet" | in column | | each 64 high | 0 | sock drawer cell |

Drawer cell thumbnails: teal #3FB8AF, pink #F48FB1, orange #F08A24 ellipses. Tape: two corner tapes on the drawing page (84 x 26) as in 3.15.

Live preview content (376 x 230 viewBox, svg 366 x 216): three segments (64,214,-78), (92,162,-52), (138,122,-28) each `rect x -37 y -29 w74 h58 rx26`, stroke 4, stripe `x -6 y -26 w12 h52`; head `translate(142,22) scale(0.46)`; sword `translate(262,84) rotate(-10) scale(0.34)`; pins r5 at (76,188),(114,140),(166,100); F2 filter with shadow 3px 4px; ledge strip at the bottom.

### 5.4 Battle theme (4-battle-theme.html; mat only)

| Element | Text | left | top | w x h | rot | Style |
|---|---|---|---|---|---|---|
| Header strip | | 40 | 20 | 1200 x 66 | 0.4deg | header strip |
| Title tiles | "BATTLE THEME" (aria "Battle theme") | in strip | | battle theme size | 0 | ransom tiles |
| Header caption | "pick the song you fight to" | in strip | | auto | 0 | paper tag 18px |
| Back button | "Back to the room" | in strip | | h40 | -2deg | pink medium |
| Left panel | | 40 | 108 | 580 x auto | -0.5deg | paper panel, padding 18, gap 10 |
| HOUSE TRACKS label | "HOUSE TRACKS" | in panel | | | | black label 15, ls 0.14em |
| Track rows | "[DEFAULT TRACK 1]" "120 BPM"; "[DEFAULT TRACK 2]" "[BPM]"; "[DEFAULT TRACK 3]" "[BPM]" | in panel | | 100% x 48 | 0 | track row, unselected |
| MY TRACKS label | "MY TRACKS" (margin-top 8) | in panel | | | | black label |
| My track row (selected) | "my-song.mp3", "128 BPM, 2:41", badge "SELECTED" | in panel | | 100% x 48 | 0 | track row selected, badge: black label 13 |
| Drop zone | "drop a song here, or" (19px); button "Choose a file"; "[ALLOWED FILE TYPES], up to [MAX FILE SIZE]" (15px) | in panel (margin-top 6) | | 100% x 132 | 0 | drop zone |
| Right panel | | 652 | 108 | 588 x auto | 0.5deg | paper panel, padding 18, gap 12 |
| Right panel header | label "SET THE BEAT"; file name "my-song.mp3" (17px, right) | in panel | | | | black label 15; text |
| Waveform | | in panel | | 516 x 80 | 0 | waveform |
| Tempo stepper | label "TEMPO WE HEARD" (15px, ls 0.1em); buttons aria "Slower" (minus), "Faster" (plus); value "128" Bungee 40px + "BPM" 17px | in panel row | | | | stepper 44 x 44 |
| First beat stepper | label "FIRST BEAT" (15px, ls 0.1em, right aligned); aria "Earlier", "Later"; value "0.42 s" Bungee 28px | in panel row, right | | | | stepper |
| Tap-along strip | button "Tap along"; helper "tap on every beat to check we heard it right" (16px, line-height 1.3, flex 1) | in panel | | | | tap-along strip |
| Action row (space-between, gap 16, margin-top 4) | "Play with a click track" (paper outlined) and "Use this theme" (primary yellow large h50 fs22 rot -1deg) | in panel | | | | |
| Privacy note | "your song stays on this device. it goes straight to your friend when the match starts." | 652 | 566 | 540 x auto | -1deg | masking-tape note 19px, `padding:8px 18px; box-sizing:border-box` |

Values in `[BRACKETS]` in the mock are placeholders in the mock; replace with real data.

### 5.5 Duel, attacking (5-duel-attacking.html)

| Element | Text | left | top | w x h | rot | Style |
|---|---|---|---|---|---|---|
| Act counter + banner container | | 0 | 146 | 1280 x auto | 0 | 3.9 + 3.12 |
| Act counter | "ACT 2 of 3" | centred | | auto | 0 | 3.9 |
| Banner | "ATTACK!" | centred | | tiles 44 x 54/50 | 0 | ransom tiles banner size |
| Hint note | "Click on the beat to plant a strike. Maya has to parry them next." | 60 | 150 | 176 x auto | -3deg | torn-paper typed note 17px |
| Aside | "every strike costs stamina.<br>long leaps cost more!" | 96 | 300 | auto | -5deg | masking-tape note 20px, `padding:4px 16px` |
| Strike discs | 1, 2, 3, newest 4 | see 3.14 | | 54 / 64 | 0 | strike discs |
| Left bars | "ALLEN", "you", Health 72%, Stamina 46% (example) | 186 | 609 | | 0 | 3.7 |
| Right bars | "MAYA", Health 54%, Stamina 31% (example) | right:186 | 609 | | 0 | 3.7 (no "you" tag) |
| Phrase dots | "YOUR ATTACK, IN HALF-BEATS" | 0 | 613 | 1280 x auto | 0 | 3.8 |

Sun (150, 440, 140, -10deg). No sign. Puppets: section 4.4. Puppet SVG aria: "The teal puppet stretches right across the stage to jab its sword at the pink puppet, leaving a trail of numbered strikes".

### 5.6 Duel, defending (6-duel-defending.html)

| Element | Text | left | top | w x h | rot | Style |
|---|---|---|---|---|---|---|
| Act counter + banner | "ACT 2 of 3", "PARRY!" | 0 | 146 | 1280 x auto | 0 | 3.9, 3.12 |
| Heckle | `A child in row G: "that one is just a sock."` | 60 | 150 | 170 x auto | -3deg | torn-paper note 17px |
| Bravo pop-up | "BRAVO!" | 104 | 296 | auto | -8deg | 3.12 |
| Streak note | "7" (60px red) over "in a row!" | 1004 | 250 | auto | 4deg | 3.10 |
| Parried target | tick | 156 | 356 | 88 x 88 | 0 | 3.13 |
| Target 2 ring + disc | "2" | ring 775, 185 (116 x 116); disc 789, 199 | | 88 x 88 | 0 | 3.13 |
| Target 3 ring + disc | "3" | ring 335, 165 (170 x 170); disc 376, 206 | | 88 x 88 | 0 | 3.13 |
| Target 4 ring + disc (faded) | "4" | ring 525, 385 (230 x 230, border alpha .45); disc 596, 456 (opacity .8) | | 88 x 88 | 0 | 3.13 |
| Left bars | "ALLEN", "you", Health 72%, Stamina 88% | 186 | 609 | | 0 | 3.7 |
| Right bars | "MAYA", Health 54%, Stamina 31% | right:186 | 609 | | 0 | 3.7 |
| Phrase dots | "MAYA'S ATTACK, IN HALF-BEATS" | 0 | 613 | 1280 x auto | 0 | 3.8 |

Sun (150, 440, 140, -10deg), no sign. Puppet SVG aria: "The teal puppet stretches across the stage so the sword in its mouth reaches the next target, while the pink puppet waits on the right". The dotted order line (3.13) is in the SVG.

### 5.7 Victory (7-victory.html)

| Element | Text | left | top | w x h | rot | Style |
|---|---|---|---|---|---|---|
| Sign text block (column, centre, gap 12) | | 350 | 192 | 580 x auto | -1deg | container |
| Win lettering | "ALLEN WINS!" (aria "Allen wins!"; name is an example) | in block | | tiles 46 x 66/62 | 0 | ransom tiles victory size |
| Result line | "2 acts to 1" | in block | | auto | 0 | torn-paper subtitle 24px |
| Heckle | `a child in row G: "again! again!"` | in block | | auto | 2deg | masking-tape note 20px |
| Winner strip | "ALLEN" + tag "winner" | 186 | 620 | auto | 0 | black label 17 + winner tag, gap 6 |
| Loser strip | "MAYA" | right:186 | 620 | auto | 0 | black label 17 |
| Button row | | 0 | 618 | 1280 x auto, centred, gap 16 | 0 | |
| Rematch | "Rematch" | in row | | h48 | -2deg | primary yellow large |
| Back to the room | "Back to the room" | in row | | h40 | 1deg | paper secondary |
| Leave | "Leave" | in row | | h40 | -1deg | pink medium |

Sun (958, 372, 120, +8deg) and sign (340, 56, 600). Puppets: victory poses (section 4.4). Puppet SVG aria: "The teal puppet holds its sword high in victory while the pink puppet slumps over the ledge with a crossed-out eye, its sword dropped". No bars on this screen.

---

## 6. Colour and type summary

### 6.1 Colours

| Hex / value | Name | Used for |
|---|---|---|
| #2F6B52 | cutting mat | root background; grid lines `rgba(255,255,255,0.14)` 40 px |
| #1B1210 | ink | all text, strokes, outlines, label strip bg, bar borders, ring borders, tile bg (styles 1, 7) |
| #FFFDF5 | paper | notes, tags, panels, inputs, tile text/bg, rows behind bars, empty dots |
| #FFFFFF | white | paper edge, outlines, label strip text, drawing page, bar trough, input swatches, tile text, planted disc border |
| #FFE14D | yellow | primary buttons, tile style 0/7, newest strike, current dot, selected tab/tool, sock stripe (teal), sword guard, target disc |
| #D42A40 | red | Health fill, planted strikes, tile style 2, streak digit, hair (teal), curtain-like accents, current act dot, beat marks in waveform |
| #2456C8 | blue | Stamina fill, tile style 4 |
| #F48FB1 | pink | pink buttons, tile style 5, pink puppet body, pink pommel |
| #7BC67B | parried green | parried target, parried dot, "ready" tag |
| #3FB8AF | teal | teal puppet, swatch, thumbnail |
| #7B3FD1 | purple | pink puppet stripe, hair, grip |
| #8A5A2B | brown | teal sword grip, swatch |
| #C9D2DC | steel | teal sword blade (duel) |
| #E9EEF3 | light steel | teal sword blade (workshop preview) |
| #D4AF37 / #7A5C12 | brass | pin fill / stroke |
| #F08A24 | orange | swatch, thumbnail |
| #3FA65A | green | swatch |
| #9AA3AF | grey | swatch, drawing guide dash stroke |
| #6B7280 | grey | drawing page arrow |
| #4B5563 | dark grey | drawing page hint text |
| rgba(244,228,170,0.9 / 0.92 / 0.95 / 0.96) | masking tape | corner tapes (0.9), drawing-page tapes (0.92), tape notes (0.95, 0.96 on duel) |
| rgba(0,0,0,0.35) | | paper shadow polygon; button shadow |
| rgba(0,0,0,0.3) | | panel / header / preview shadow (5px 6px; drawing page 6px 8px) |
| rgba(0,0,0,0.28) | | cutout shadows (F1..F4), streak note, lobby chip |
| rgba(0,0,0,0.22) | | ledge top shadow `0 -6px 0` |
| rgba(27,18,16,0.45) / 0.6 | | far target ring border / dashed order line opacity .6 |

### 6.2 Type sizes

| Font | Sizes (px) and uses |
|---|---|
| Bungee | 16 (Copy link, click-track button), 17 (medium buttons, Choose a file), 18 (Back to the room, workshop), 20 (Create a room, Join a room, Tap along), 21 (Save), 22 (I'm ready, Rematch, Use this theme), 22 (strike disc number), 26 (newest strike), 28 (first beat value), 30 (target number; workshop/battle tile font), 38 (banner tile), 40 (tempo value), 42 (victory tile), 58 (title tile) |
| Special Elite | 13 (SELECTED), 14 (labels), 15 (HEALTH/STAMINA, tags, panel labels, hints), 16 (BPM text, ROOM CODE label, helper), 17 (notes, tempo unit), 18 (act label, tabs, captions), 19 (track name, link text, drop-zone), 20 (inputs, friend name), 22 (puppet name input), 24 (subtitles); tile fonts 34, 43, 47, 66 |
| Permanent Marker | 19, 20, 21 (tape notes), 28 (streak text), 36 ("BRAVO!"), 60 (streak digit); tile fonts 30, 38, 42, 46 |

Letter spacing: 0.14em on label strips and tabs (0.16em on workshop panel labels, 0.12em on SELECTED, 0.1em on tempo labels). No other letter-spacing.

---

## 7. Things a builder should know

1. **Required wording vs mocks.** Required labels: "Health", "Stamina", "Create a room", "Join a room". The title mock has "Create a room" and "Join a room" exactly. The bars use the literal strings "HEALTH" and "STAMINA" (capitals). Use the exact words "Health" and "Stamina"; if the design wants capitals, apply `text-transform:uppercase` in CSS so the source string stays "Health" or "Stamina". Decide once and use it everywhere.
2. **Names are examples.** Allen, Maya, Sir Stinkfoot, Lady Lint, Gary, "ROW-G-12", "toetotoe.allenzheng.com/ROW-G-12" are all samples. Players choose names, so name strips must size to their text and should handle long names (the strip `padding:2px 10px 0 10px; letter-spacing:0.14em` is the only constraint; max width is not in mocks). The "you" tag shows only on the local player's strip (left side). Which player is on the left in a match: not in mocks.
3. **Placeholders.** The battle theme mock has `[DEFAULT TRACK 1]`, `[DEFAULT TRACK 2]`, `[DEFAULT TRACK 3]`, `[BPM]`, `[ALLOWED FILE TYPES]`, `[MAX FILE SIZE]` in square brackets: real values to be supplied. The waveform and the beat values (128 BPM, 0.42 s, 2:41) are example data.
4. **clip-path kills box-shadow.** Buttons with `clip-path` and `box-shadow:5px 6px 0` lose the shadow in a browser (the clip is applied after). In the mocks the clipped buttons (large yellow, Join a room, Save, Use this theme, Rematch, I'm ready) therefore have no visible shadow while the unclipped ones do. The streak note and the torn notes are the same. Pixi: decide one rule (shadow everywhere, or shadow only on non-torn items) and apply it consistently; the mocks' visible result is "shadow only on unclipped".
5. **Pink puppet is mirrored.** All pink SVG is drawn facing the left puppet's way and flipped by `translate(1280,0) scale(-1,1)`. Do not flip the pin or head anchor coordinates separately: mirror the whole puppet. The pink head asset is a different drawing (one eye, purple stripe, hair) from the teal.
6. **Layer order.** Puppets (I) are under the ledge (J) and curtains (L, M), but strike discs, targets and banners are DOM above the curtains. The sign text block (H) is under the puppets. The puppet bases at y 640 are partly hidden by the ledge (top 603).
7. **Sky.** The sky image is 41 px from the left and 37 px from the top and is clipped by the skewed quad D (corners (46,44) (1236,37) (1241,682) (41,687)). Its box (41..1242, 37..688) is a little bigger than the clip, so the clip hides the edges.
8. **Filter widths differ by layer.** Puppet parts 2 px outline / 4,5 shadow; everything else 3 px outline / 5,6 shadow. Curtains skip the top white edge; the valance has only a bottom edge.
9. **Act counter has 4 dots for "of 3".** Both duel mocks show 4 act dots under "ACT 2 of 3" (attack: done, done, current, to come; defend: done, current, to come, to come). The dots disagree between screens (current is dot 3 vs dot 2) although both are act 2. Treat as a mock error: one dot per act (3), with done/current/to come states.
10. **Dot colours in the defend phrase row.** The mock shows green (parried), red with an ink border, yellow with an ink border (x2), and faded empty. The mapping for red/ink and yellow/ink (missed / current / upcoming) is not stated. Likely: green = parried, red = missed or current, yellow = upcoming; confirm before building. The missed target visual is not in any mock.
11. **Target ring size.** The ring shrinks to the disc; its end size and timing windows are not in the mocks. The 116 / 170 / 230 px rings and the 0.45 alpha on the farthest ring show the intended distance fade.
12. **Targets and notes outside PLAY_RECT.** Defend targets sit at disc centres (833,243), (420,250), (640,500) and the parried one at (200,400); the attack strikes sit at y 364..548 and x 716..1054. Several are outside the 270..1010 x 230..600 rectangle (e.g. the left target at x 200 sits over the curtain tie-back area, which is open there). The mocks use the open stage as it widens downward. The play-area rect is a safe zone, not a hard clip.
13. **Disc and parry sizes.** Planted strike discs are 54 (newest 64); parry targets 88. Hit radius for phones is larger than the visual (DESIGN.md): not specified in mocks.
14. **Lettering start offsets.** The 8-style cycle starts at style 0 in the title, attack, lobby, workshop and battle theme, at style 2 in PARRY!, and at style 5 in the victory line. Reproduce by storing a start index per lettering or just by following the table in each mock.
15. **Tile punctuation.** Punctuation tiles are narrower (31 vs 44). Widths for other narrow characters (I, 1) are not narrowed: the "I" in WINS and the "1" in the room code are full width.
16. **Interaction states.** Hover, focus, active, disabled, error and the placeholder style are not in the mocks (only `a:hover{color:#D42A40}` for plain links, and `a{color:#1B1210}`). Selected states exist for tools, brush sizes, swatches, tabs, track rows, drawer cells.
17. **Accessibility labels.** Most graphics have `role="img"` plus an `aria-label` (listed in section 5). Keep them.
18. **Not covered by any mock** (build in the same vocabulary, per docs/DESIGN.md): waiting for a friend, connecting, drawing/song transfer progress, count-in, between acts, "your friend left", "this room is full", input calibration, adding an email, "turn your phone sideways".
19. **Screenshots** were rendered with stand-in fonts (Times-like for Special Elite and Permanent Marker, sans for Bungee). Measure type from the mocks, not the screenshots. The screenshot of the workshop shows the sky preview image with a ledge strip, matching the mock.
20. **Ledge and bars.** Bars (y 609..685) fit inside the ledge (603..695) and between the curtain hems: the left curtain's hem at y 603..672 reaches x 36..159 (visible edge 36..162) and the block starts at x 186. The "YOUR NAME" and friend blocks in the lobby use the same x anchors (186 and right 186).
