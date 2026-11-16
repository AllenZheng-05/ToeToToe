# Design

## The final design

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

## Build facts

- **Bake the cutout look into textures.** Every stage image and every puppet part has a white scissor edge and a hard shadow. Generate those once on an offscreen canvas when an image loads. Do not run outline or shadow filters every frame.
- **Fonts are self-hosted** (Bungee, Special Elite, Permanent Marker), for example through `@fontsource` packages. No font CDN at runtime.
- **Design size is 1280 by 720.** Scale the stage to fit the window and keep the aspect; the cutting mat fills the rest.
