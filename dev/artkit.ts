/**
 * Dev page for the stage art kit: /dev/artkit.html?scene=attack|defend|menu|rig|owners
 * (owners: both players' strikes and targets side by side, local = teal with the round outline, opponent = pink, scalloped)
 * Extra query parameters: sweep=1 (rig: animate the local tip), time=SECONDS (freeze the fake clock),
 * beat=N (freeze the fake clock at beat N of the defend loop), tipx / tipy (rig: fixed tip, design px).
 */
import '@fontsource/bungee/400.css';
import { Application, Container } from 'pixi.js';
import { DEFAULT_TUNABLES } from '../src/core/tunables';
import type { DuelView, Strike, TargetView } from '../src/core/types';
import { PLAY_RECT, fitStage } from '../src/stage/layout';
import {
  createMarkTextures,
  createPlayerMarkTextures,
  loadMarkFonts,
  MarksView,
} from '../src/stage/art/marks';
import { distinctColours, puppetMarkColour, type PixelImage, type Rgb } from '../src/puppet/colour';
import { PARTS } from '../src/puppet/parts';
import { loadPresetImages, PuppetView } from '../src/stage/art/puppetView';
import { createTheatre, loadTheatreTextures, SUN_DUEL, SUN_MENU } from '../src/stage/art/theatre';
import type { Point } from '../src/puppet/parts';
import { PRESETS } from '../src/puppet/presets';
import { solveRig } from '../src/puppet/rig';

type Scene = 'attack' | 'defend' | 'menu' | 'rig' | 'owners';

const params = new URLSearchParams(location.search);
const sceneParam = params.get('scene');
const scene: Scene =
  sceneParam === 'defend' || sceneParam === 'menu' || sceneParam === 'rig' || sceneParam === 'owners'
    ? sceneParam
    : 'attack';
const sweep = params.get('sweep') === '1';
const frozenTime = params.has('time') ? Number(params.get('time')) : null;
const frozenBeat = params.has('beat') ? Number(params.get('beat')) : null;

const BPM = 100;
const BEAT_SEC = 60 / BPM;
const BASES: [Point, Point] = [
  { x: 330, y: 675 },
  { x: 950, y: 675 },
];
const IDLE_TIPS: [Point, Point] = [
  { x: 668, y: 436 },
  { x: 612, y: 446 },
];

const toFraction = (x: number, y: number): Strike => ({
  slot: 0,
  x: (x - PLAY_RECT.x) / PLAY_RECT.width,
  y: (y - PLAY_RECT.y) / PLAY_RECT.height,
});

// Mock 5: strike discs 1 to 4.
const ATTACK_POINTS: [number, number][] = [
  [760, 548],
  [1046, 528],
  [716, 388],
  [1054, 364],
];
// Mock 6: targets 1 to 4 (1 already parried).
const DEFEND_POINTS: [number, number][] = [
  [200, 400],
  [833, 243],
  [420, 250],
  [640, 500],
];
const DEFEND_HIT_BEATS = [0.5, 1.3, 2.1, 2.9];
const DEFEND_CYCLE_BEATS = 6;

function baseView(partial: Partial<DuelView>): DuelView {
  const player = { health: 72, stamina: 46, winded: false, streak: 0 };
  return {
    phase: 'attack',
    localPlayer: 0,
    localActive: true,
    attacker: 0,
    act: 1,
    actWins: [0, 0],
    players: [player, { ...player, health: 54, stamina: 31 }],
    clockPhrase: 1,
    slotPosition: 0,
    beatPosition: 0,
    strikes: [],
    targets: [],
    countInBeatsLeft: 0,
    lastActWinner: null,
    matchWinner: null,
    ...partial,
  };
}

function targetsAt(beat: number): TargetView[] {
  return DEFEND_POINTS.map(([x, y], i) => {
    const hit = DEFEND_HIT_BEATS[i] as number;
    const timeToHit = (hit - beat) * BEAT_SEC;
    let result: TargetView['result'] = null;
    if (timeToHit < -0.05) result = i === 2 ? 'miss' : i === 1 ? 'good' : 'bravo';
    return { index: i, strike: toFraction(x, y), timeToHit, result };
  });
}

function readPixels(src: CanvasImageSource, width: number, height: number): PixelImage {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  g.drawImage(src, 0, 0, width, height);
  return { pixels: g.getImageData(0, 0, width, height).data, width, height };
}

const colourOf = (i: { head: CanvasImageSource; sock: CanvasImageSource }): Rgb =>
  puppetMarkColour({
    sock: readPixels(i.sock, PARTS.sock.width, PARTS.sock.height),
    head: readPixels(i.head, PARTS.head.width, PARTS.head.height),
  });

async function main(): Promise<void> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: 0x2f6b52,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });
  document.body.appendChild(app.canvas);
  const root = new Container();
  app.stage.addChild(root);
  const fit = (): void => {
    const f = fitStage(window.innerWidth, window.innerHeight);
    root.scale.set(f.scale);
    root.position.set(f.offsetX, f.offsetY);
  };
  fit();
  window.addEventListener('resize', fit);

  await loadMarkFonts();
  const textures = await loadTheatreTextures();
  const theatre = createTheatre(textures, {
    sign: scene === 'menu',
    sun: scene === 'menu' ? SUN_MENU : SUN_DUEL,
  });
  const [tealImages, pinkImages] = await Promise.all([
    loadPresetImages(PRESETS[0] as (typeof PRESETS)[number]),
    loadPresetImages(PRESETS[1] as (typeof PRESETS)[number]),
  ]);
  const teal = new PuppetView(tealImages, 1);
  const pink = new PuppetView(pinkImages, -1);
  const colours = distinctColours(colourOf(tealImages), colourOf(pinkImages));
  const sets = [createPlayerMarkTextures(colours[0], true), createPlayerMarkTextures(colours[1], false)] as [
    ReturnType<typeof createPlayerMarkTextures>,
    ReturnType<typeof createPlayerMarkTextures>,
  ];
  const neutral = createMarkTextures();
  const makeMarks = (): MarksView => {
    const m = new MarksView(neutral);
    m.setPlayers(sets, colours);
    return m;
  };
  const marks = makeMarks();
  // The owners scene: four views so each owner's strikes and targets sit in their own row.
  const rows = scene === 'owners' ? [marks, makeMarks(), makeMarks(), makeMarks()] : [marks];

  theatre.middle.addChild(pink.container, teal.container);
  root.addChild(theatre.back, theatre.middle, theatre.front, ...rows.map((m) => m.container));

  let tealTip: Point = { ...IDLE_TIPS[0] };
  const pinkTip: Point = { ...IDLE_TIPS[1] };
  if (scene === 'attack') {
    tealTip = { x: 1054, y: 364 };
  } else if (scene === 'defend') {
    tealTip = { x: 800, y: 250 };
  } else if (scene === 'rig') {
    tealTip = { x: Number(params.get('tipx') ?? 700), y: Number(params.get('tipy') ?? 330) };
    app.canvas.addEventListener('pointermove', (e) => {
      const p = root.toLocal({ x: e.clientX, y: e.clientY });
      tealTip = { x: p.x, y: p.y };
      mouseUsed = true;
    });
  }
  let mouseUsed = false;
  let tealCount: number | undefined;
  let pinkCount: number | undefined;

  const t0 = performance.now();
  const frame = (): void => {
    const time = frozenTime ?? (performance.now() - t0) / 1000;

    if (scene === 'rig' && sweep && !mouseUsed) {
      // A Lissajous path over the stage that passes close to the base now and then.
      tealTip = { x: 560 + Math.cos(time * 0.55) * 500, y: 410 + Math.sin(time * 0.9) * 180 };
    }

    const poseT = solveRig(BASES[0], tealTip, 1, tealCount);
    const poseP = solveRig(BASES[1], pinkTip, -1, pinkCount);
    tealCount = poseT.segmentCount;
    pinkCount = poseP.segmentCount;
    teal.setPose(poseT);
    pink.setPose(poseP);

    if (scene === 'attack') {
      marks.update(
        baseView({
          phase: 'attack',
          strikes: ATTACK_POINTS.map(([x, y], i) => ({ ...toFraction(x, y), slot: i })),
        }),
        DEFAULT_TUNABLES,
        BPM,
      );
    } else if (scene === 'defend') {
      const beat = frozenBeat ?? (time / BEAT_SEC) % DEFEND_CYCLE_BEATS;
      marks.update(baseView({ phase: 'defend', targets: targetsAt(beat) }), DEFAULT_TUNABLES, BPM);
    } else if (scene === 'owners') {
      const xs = [300, 440, 580, 720, 860];
      const row = (y: number): Strike[] => xs.map((x, i) => ({ ...toFraction(x, y), slot: i }));
      const targets = (y: number): TargetView[] =>
        row(y).map((strike, index) => ({
          index,
          strike,
          timeToHit: 10,
          result: index === 3 ? 'bravo' : index === 4 ? 'miss' : null,
        }));
      const R = rows as MarksView[];
      (R[0] as MarksView).update(
        baseView({ phase: 'attack', attacker: 0, strikes: row(250) }),
        DEFAULT_TUNABLES,
        BPM,
      );
      (R[1] as MarksView).update(
        baseView({ phase: 'attack', attacker: 1, strikes: row(340) }),
        DEFAULT_TUNABLES,
        BPM,
      );
      (R[2] as MarksView).update(
        baseView({ phase: 'defend', attacker: 0, localActive: false, targets: targets(440) }),
        DEFAULT_TUNABLES,
        BPM,
      );
      (R[3] as MarksView).update(
        baseView({ phase: 'defend', attacker: 1, localActive: true, targets: targets(540) }),
        DEFAULT_TUNABLES,
        BPM,
      );
    } else {
      marks.update(baseView({ phase: 'countIn' }), DEFAULT_TUNABLES, BPM);
    }

    app.render();
    (window as unknown as { __artkitFrames: number }).__artkitFrames =
      ((window as unknown as { __artkitFrames?: number }).__artkitFrames ?? 0) + 1;
  };
  app.ticker.add(frame);
  frame();
  (window as unknown as { __artkitReady: boolean }).__artkitReady = true;
}

void main();
