/**
 * Dev page for the stage art kit: /dev/artkit.html?scene=attack|defend|menu|rig
 * Extra query parameters: sweep=1 (rig: animate the local tip), time=SECONDS (freeze the fake clock),
 * beat=N (freeze the fake clock at beat N of the defend loop), tipx / tipy (rig: fixed tip, design px).
 */
import '@fontsource/bungee/400.css';
import { Application, Container } from 'pixi.js';
import { DEFAULT_TUNABLES } from '../src/core/tunables';
import type { DuelView, Strike, TargetView } from '../src/core/types';
import { PLAY_RECT, fitStage } from '../src/stage/layout';
import { createMarkTextures, loadMarkFonts, MarksView } from '../src/stage/art/marks';
import { loadPresetImages, PuppetView } from '../src/stage/art/puppetView';
import { createTheatre, loadTheatreTextures, SUN_DUEL, SUN_MENU } from '../src/stage/art/theatre';
import type { Point } from '../src/puppet/parts';
import { PRESETS } from '../src/puppet/presets';
import { solveRig } from '../src/puppet/rig';

type Scene = 'attack' | 'defend' | 'menu' | 'rig';

const params = new URLSearchParams(location.search);
const sceneParam = params.get('scene');
const scene: Scene =
  sceneParam === 'defend' || sceneParam === 'menu' || sceneParam === 'rig' ? sceneParam : 'attack';
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
  const marks = new MarksView(createMarkTextures());

  theatre.middle.addChild(pink.container, teal.container);
  root.addChild(theatre.back, theatre.middle, theatre.front, marks.container);

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
