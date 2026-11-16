import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import curtainLeftUrl from '../../assets/stage/curtain-left.png';
import curtainRightUrl from '../../assets/stage/curtain-right.png';
import ledgeUrl from '../../assets/stage/ledge-cardboard.jpg';
import signUrl from '../../assets/stage/sign.png';
import skyUrl from '../../assets/stage/sky.jpg';
import sunUrl from '../../assets/stage/sun.png';
import valanceUrl from '../../assets/stage/valance.png';
import { DESIGN_H, DESIGN_W } from '../layout';
import { bakeCutout, canvasTexture, cutoutPadding, type CutoutOptions, type Padding } from './cutout';
import { coverRect } from './fit';

/** A baked texture and where the original image's box sits inside it. */
export interface BakedImage {
  texture: Texture;
  /** Growth of the baked canvas on each side, design px. */
  pad: Padding;
  /** The original image's box on screen, design px. */
  width: number;
  height: number;
}

export interface TheatreTextures {
  /** Sky already cropped to its 1201 x 651 box (no outline). */
  sky: BakedImage;
  /** Sun baked at 140 px wide (duel screens) and at 120 px wide (menus). */
  sun140: BakedImage;
  sun120: BakedImage;
  sign: BakedImage;
  /** Ledge with its white top border and the dark band above it. The box is 1216 x 92. */
  ledge: BakedImage;
  valance: BakedImage;
  curtainLeft: BakedImage;
  curtainRight: BakedImage;
}

export interface SunPlacement {
  /** Left and top of the unrotated box, design px (as in the mocks' CSS). */
  x: number;
  y: number;
  /** Degrees, clockwise, as in the mocks' CSS. */
  rotation: number;
  /** 120 or 140 selects the texture; any other value scales the 140 one. Default 140. */
  width?: number;
}

export interface TheatreOptions {
  sign?: boolean;
  sun?: SunPlacement;
}

export const SUN_DUEL: SunPlacement = { x: 150, y: 440, rotation: -10, width: 140 };
export const SUN_MENU: SunPlacement = { x: 958, y: 372, rotation: 8, width: 120 };

// DESIGN_SPEC section 1.
const PAPER_SHADOW = [44, 44, 1254, 36, 1260, 702, 38, 708];
const PAPER_WHITE = [36, 34, 1246, 26, 1252, 692, 30, 698];
const CLIP = [46, 44, 1236, 37, 1241, 682, 41, 687];
const SKY_BOX = { x: 41, y: 37, width: 1201, height: 651 };
const SIGN_BOX = { x: 340, y: 56, width: 600 };
const SUN_NATURAL = { width: 440, height: 468 };
const LEDGE_BOX = { x: 34, y: 603, width: 1216, height: 92, border: 5, shadow: 6 };
const VALANCE_BOX = { x: 34, y: 30, width: 1216, height: 112 };
const CURTAIN_BOX = { top: 132, height: 540, leftX: 36, rightEdge: 1242 };
const TAPES = [
  { left: 6, top: 26, rotate: -38 },
  { left: 1184, top: 20, rotate: 40 },
  { left: 2, top: 672, rotate: 36 },
  { left: 1186, top: 668, rotate: -42 },
];
const MAT = 0x2f6b52;

const CUTOUT_F1: CutoutOptions = { outline: 3, shadowX: 5, shadowY: 6, shadowAlpha: 0.28 };
const CUTOUT_F3: CutoutOptions = { ...CUTOUT_F1, sides: { top: false } };
const CUTOUT_F4: CutoutOptions = {
  outline: 3,
  shadowX: 0,
  shadowY: 6,
  shadowAlpha: 0.28,
  sides: { top: false, left: false, right: false },
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

function bakeImage(
  img: CanvasImageSource,
  naturalW: number,
  naturalH: number,
  scale: number,
  base: CutoutOptions,
  resolution: number,
): BakedImage {
  const o: CutoutOptions = { ...base, scale, resolution };
  return {
    texture: canvasTexture(bakeCutout(img, naturalW, naturalH, o), resolution),
    pad: cutoutPadding(o),
    width: naturalW * scale,
    height: naturalH * scale,
  };
}

/** Loads the stage images (Vite asset imports from src/assets/stage) and bakes them. */
export async function loadTheatreTextures(resolution = 2): Promise<TheatreTextures> {
  const [sky, sun, sign, ledge, valance, curtainL, curtainR] = await Promise.all([
    loadImage(skyUrl),
    loadImage(sunUrl),
    loadImage(signUrl),
    loadImage(ledgeUrl),
    loadImage(valanceUrl),
    loadImage(curtainLeftUrl),
    loadImage(curtainRightUrl),
  ]);
  const res = resolution;

  // Sky: object-fit cover into its box, no outline.
  const skyRect = coverRect(sky.naturalWidth, sky.naturalHeight, SKY_BOX.width, SKY_BOX.height);
  const [skyCanvas, sg] = canvasOf(SKY_BOX.width * res, SKY_BOX.height * res);
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(sky, skyRect.x * res, skyRect.y * res, skyRect.width * res, skyRect.height * res);
  const skyBaked: BakedImage = {
    texture: canvasTexture(skyCanvas, res),
    pad: { left: 0, top: 0, right: 0, bottom: 0 },
    width: SKY_BOX.width,
    height: SKY_BOX.height,
  };

  // Ledge: cardboard under a 5 px white top border, with a dark band 6 px above (box-shadow 0 -6px).
  const { width: lw, height: lh, border, shadow } = LEDGE_BOX;
  const [ledgeCanvas, lg] = canvasOf(lw * res, (lh + shadow) * res);
  lg.scale(res, res);
  lg.fillStyle = 'rgba(0,0,0,0.22)';
  lg.fillRect(0, 0, lw, shadow);
  lg.fillStyle = '#ffffff';
  lg.fillRect(0, shadow, lw, border);
  const contentH = lh - border;
  const lr = coverRect(ledge.naturalWidth, ledge.naturalHeight, lw, contentH);
  lg.save();
  lg.beginPath();
  lg.rect(0, shadow + border, lw, contentH);
  lg.clip();
  lg.imageSmoothingQuality = 'high';
  lg.drawImage(ledge, lr.x, shadow + border + lr.y, lr.width, lr.height);
  lg.restore();
  const ledgeBaked: BakedImage = {
    texture: canvasTexture(ledgeCanvas, res),
    pad: { left: 0, top: shadow, right: 0, bottom: 0 },
    width: lw,
    height: lh,
  };

  // Valance: cover, anchored to the bottom, then white edge and shadow below only.
  const vr = coverRect(
    valance.naturalWidth,
    valance.naturalHeight,
    VALANCE_BOX.width,
    VALANCE_BOX.height,
    0.5,
    1,
  );
  const [valCanvas, vg] = canvasOf(VALANCE_BOX.width * res, VALANCE_BOX.height * res);
  vg.imageSmoothingQuality = 'high';
  vg.drawImage(valance, vr.x * res, vr.y * res, vr.width * res, vr.height * res);
  const valanceBaked = bakeImage(valCanvas, VALANCE_BOX.width, VALANCE_BOX.height, 1, CUTOUT_F4, res);

  const curtainScaleL = CURTAIN_BOX.height / curtainL.naturalHeight;
  const curtainScaleR = CURTAIN_BOX.height / curtainR.naturalHeight;

  return {
    sky: skyBaked,
    sun140: bakeImage(sun, SUN_NATURAL.width, SUN_NATURAL.height, 140 / SUN_NATURAL.width, CUTOUT_F1, res),
    sun120: bakeImage(sun, SUN_NATURAL.width, SUN_NATURAL.height, 120 / SUN_NATURAL.width, CUTOUT_F1, res),
    sign: bakeImage(
      sign,
      sign.naturalWidth,
      sign.naturalHeight,
      SIGN_BOX.width / sign.naturalWidth,
      CUTOUT_F1,
      res,
    ),
    ledge: ledgeBaked,
    valance: valanceBaked,
    curtainLeft: bakeImage(
      curtainL,
      curtainL.naturalWidth,
      curtainL.naturalHeight,
      curtainScaleL,
      CUTOUT_F3,
      res,
    ),
    curtainRight: bakeImage(
      curtainR,
      curtainR.naturalWidth,
      curtainR.naturalHeight,
      curtainScaleR,
      CUTOUT_F3,
      res,
    ),
  };
}

/** Frees the GPU textures made by loadTheatreTextures. */
export function destroyTheatreTextures(t: TheatreTextures): void {
  for (const b of Object.values(t)) (b as BakedImage).texture.destroy(true);
}

function spriteAt(b: BakedImage, left: number, top: number): Sprite {
  const s = new Sprite(b.texture);
  s.position.set(left - b.pad.left, top - b.pad.top);
  return s;
}

function maskPolygon(points: number[]): Graphics {
  return new Graphics().poly(points).fill(0xffffff);
}

/**
 * The stage frame from DESIGN_SPEC section 1 as Pixi containers, in 1280x720 design pixels. `back`
 * holds the cutting mat, paper edge and its shadow, sky, sun and sign; `front` holds ledge, valance,
 * curtains and the four corner tapes. The caller puts puppets between them and interface above.
 * The sky, sun, sign, ledge, valance and curtains are clipped to the paper's skewed quad.
 */
export function createTheatre(
  textures: TheatreTextures,
  o: TheatreOptions = {},
): {
  back: Container;
  /** Empty, clipped to the paper's quad. Add `back`, `middle`, `front` in that order and put puppets here. */
  middle: Container;
  front: Container;
  setSign(visible: boolean): void;
  setSun(sun: SunPlacement): void;
  destroy(): void;
} {
  const back = new Container();
  const middle = new Container();
  const middleMask = maskPolygon(CLIP);
  middle.addChild(middleMask);
  middle.mask = middleMask;
  const front = new Container();

  // Layer A: cutting mat with its 40 px grid of 1 px lines.
  const mat = new Graphics().rect(0, 0, DESIGN_W, DESIGN_H).fill(MAT);
  for (let x = 0; x < DESIGN_W; x += 40) mat.rect(x, 0, 1, DESIGN_H);
  for (let y = 0; y < DESIGN_H; y += 40) mat.rect(0, y, DESIGN_W, 1);
  mat.fill({ color: 0xffffff, alpha: 0.14 });
  // Layers B and C: paper shadow and the white paper edge.
  const paperShadow = new Graphics().poly(PAPER_SHADOW).fill({ color: 0x000000, alpha: 0.35 });
  const paperWhite = new Graphics().poly(PAPER_WHITE).fill(0xffffff);

  // Layer D: everything behind the puppets, clipped.
  const clipBack = new Container();
  const sky = spriteAt(textures.sky, SKY_BOX.x, SKY_BOX.y);
  const sun = new Sprite();
  const sign = spriteAt(textures.sign, SIGN_BOX.x, SIGN_BOX.y);
  sign.visible = o.sign ?? false;
  const clipBackMask = maskPolygon(CLIP);
  clipBack.addChild(sky, sun, sign, clipBackMask);
  clipBack.mask = clipBackMask;
  back.addChild(mat, paperShadow, paperWhite, clipBack);

  const setSun = (p: SunPlacement): void => {
    const w = p.width ?? 140;
    const baked = w === 120 ? textures.sun120 : textures.sun140;
    const k = w === 120 || w === 140 ? 1 : w / 140;
    sun.texture = baked.texture;
    sun.pivot.set(baked.pad.left + baked.width / 2, baked.pad.top + baked.height / 2);
    sun.scale.set(k);
    sun.position.set(p.x + (baked.width * k) / 2, p.y + (baked.height * k) / 2);
    sun.rotation = (p.rotation * Math.PI) / 180;
  };
  setSun(o.sun ?? (o.sign ? SUN_MENU : SUN_DUEL));

  // Layers J to M, clipped as well.
  const clipFront = new Container();
  const ledge = spriteAt(textures.ledge, LEDGE_BOX.x, LEDGE_BOX.y);
  const valance = spriteAt(textures.valance, VALANCE_BOX.x, VALANCE_BOX.y);
  const curtainL = spriteAt(textures.curtainLeft, CURTAIN_BOX.leftX, CURTAIN_BOX.top);
  const curtainR = spriteAt(
    textures.curtainRight,
    CURTAIN_BOX.rightEdge - textures.curtainRight.width,
    CURTAIN_BOX.top,
  );
  const clipFrontMask = maskPolygon(CLIP);
  clipFront.addChild(ledge, valance, curtainL, curtainR, clipFrontMask);
  clipFront.mask = clipFrontMask;

  // Layer O: masking tape in the corners, outside the clip.
  const tapes = new Container();
  for (const t of TAPES) {
    const g = new Graphics().rect(-48, -15, 96, 30).fill({ color: 0xf4e4aa, alpha: 0.9 });
    g.position.set(t.left + 48, t.top + 15);
    g.rotation = (t.rotate * Math.PI) / 180;
    tapes.addChild(g);
  }
  front.addChild(clipFront, tapes);

  return {
    back,
    middle,
    front,
    setSign(visible: boolean): void {
      sign.visible = visible;
    },
    setSun,
    destroy(): void {
      back.destroy({ children: true });
      // Puppets added to `middle` belong to the caller.
      middleMask.destroy();
      middle.destroy();
      front.destroy({ children: true });
    },
  };
}
