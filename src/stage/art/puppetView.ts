import { Container, Sprite, type Texture } from 'pixi.js';
import { PARTS, PART_SCALE } from '../../puppet/parts';
import { svgDataUrl, type PuppetPreset } from '../../puppet/presets';
import type { Placement, RigPose } from '../../puppet/rig';
import { canvasTexture, cutoutPadding, outlineOffsets, type CutoutOptions } from './cutout';

export interface PuppetImages {
  head: CanvasImageSource;
  sock: CanvasImageSource;
  sword: CanvasImageSource;
} // at PARTS sizes

/** Cutout treatment for puppet parts (DESIGN_SPEC F2): 2 px white edge, shadow 4,5 at 28%. */
const PART_CUTOUT = { outline: 2, shadowX: 4, shadowY: 5, shadowAlpha: 0.28 } as const;
/** Texture pixels per design pixel for puppet parts. */
const RESOLUTION = 2;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode puppet part'));
    img.src = url;
  });
}

async function rasterise(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(svgDataUrl(svg));
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, width, height);
  return c;
}

/** Rasterise a preset's three SVGs to canvases at PARTS sizes (browser). */
export async function loadPresetImages(preset: PuppetPreset): Promise<PuppetImages> {
  const [head, sock, sword] = await Promise.all([
    rasterise(preset.svg.head, PARTS.head.width, PARTS.head.height),
    rasterise(preset.svg.sock, PARTS.sock.width, PARTS.sock.height),
    rasterise(preset.svg.sword, PARTS.sword.width, PARTS.sword.height),
  ]);
  return { head, sock, sword };
}

interface PartArt {
  /** Hard drop shadow of the outlined silhouette. */
  shadow: Texture;
  /** The white scissor edge: the dilated silhouette. */
  edge: Texture;
  /** The image alone. */
  face: Texture;
  /** First anchor (pin / pinA / handle) in the texture's logical px: the sprite pivot. */
  pivot: { x: number; y: number };
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** Fill every opaque pixel of `src` with `colour`, keeping the alpha. */
function silhouette(src: HTMLCanvasElement, colour: string): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = colour;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/**
 * Bakes one part as three textures that share one canvas size and pivot: the shadow, the white
 * edge and the face. Stacking all parts' shadows, then all edges, then all faces makes overlapping
 * parts read as one cutout with a single outline and shadow around the whole puppet.
 */
function bakePart(
  source: CanvasImageSource,
  kind: 'head' | 'sock' | 'sword',
  anchor: { x: number; y: number },
): PartArt {
  const scale = PART_SCALE[kind];
  const o: CutoutOptions = { ...PART_CUTOUT, scale, resolution: RESOLUTION };
  const pad = cutoutPadding(o);
  const res = RESOLUTION;
  const boxW = PARTS[kind].width * scale;
  const boxH = PARTS[kind].height * scale;
  const cw = Math.ceil((boxW + pad.left + pad.right) * res);
  const ch = Math.ceil((boxH + pad.top + pad.bottom) * res);

  const face = makeCanvas(cw, ch);
  const fg = face.getContext('2d') as CanvasRenderingContext2D;
  fg.imageSmoothingEnabled = true;
  fg.imageSmoothingQuality = 'high';
  fg.drawImage(source, pad.left * res, pad.top * res, boxW * res, boxH * res);

  const white = silhouette(face, '#ffffff');
  const edge = makeCanvas(cw, ch);
  const eg = edge.getContext('2d') as CanvasRenderingContext2D;
  const sides = { top: true, right: true, bottom: true, left: true };
  for (const off of outlineOffsets(PART_CUTOUT.outline, sides, res)) {
    eg.drawImage(white, off.x * res, off.y * res);
  }

  const shadow = makeCanvas(cw, ch);
  const sg = shadow.getContext('2d') as CanvasRenderingContext2D;
  sg.globalAlpha = PART_CUTOUT.shadowAlpha;
  sg.drawImage(silhouette(edge, '#000000'), PART_CUTOUT.shadowX * res, PART_CUTOUT.shadowY * res);

  return {
    shadow: canvasTexture(shadow, res),
    edge: canvasTexture(edge, res),
    face: canvasTexture(face, res),
    pivot: { x: pad.left + anchor.x * scale, y: pad.top + anchor.y * scale },
  };
}

function destroyArt(art: PartArt | null): void {
  art?.shadow.destroy(true);
  art?.edge.destroy(true);
  art?.face.destroy(true);
}

function place(sprite: Sprite, p: Placement): void {
  sprite.position.set(p.x, p.y);
  sprite.rotation = p.rotation;
  sprite.scale.set(p.scaleX, 1);
}

/** One part's three sprites, one in each layer. */
class PartSprites {
  readonly shadow = new Sprite();
  readonly edge = new Sprite();
  readonly face = new Sprite();

  setArt(art: PartArt): void {
    this.shadow.texture = art.shadow;
    this.edge.texture = art.edge;
    this.face.texture = art.face;
    for (const s of [this.shadow, this.edge, this.face]) s.pivot.set(art.pivot.x, art.pivot.y);
  }

  place(p: Placement): void {
    for (const s of [this.shadow, this.edge, this.face]) place(s, p);
  }

  destroy(): void {
    for (const s of [this.shadow, this.edge, this.face]) if (!s.destroyed) s.destroy();
  }
}

/**
 * A puppet drawn from baked cutout textures of its three parts. `setPose` applies a RigPose from
 * solveRig: segment sprites are pooled and added or removed as the count changes; the joints are not marked. Layers, bottom to top: every part's shadow, every part's white edge, every
 * part's face (segments, sword, head in each). Stacking by layer rather than by
 * part makes the edge and shadow wrap the whole puppet instead of each part.
 */
export class PuppetView {
  readonly container = new Container();
  readonly facing: 1 | -1;
  private readonly shadowLayer = new Container();
  private readonly edgeLayer = new Container();
  private readonly faceLayer = new Container();
  private readonly sword = new PartSprites();
  private readonly head = new PartSprites();
  private readonly segmentPool: PartSprites[] = [];
  private sockArt: PartArt | null = null;
  private headArt: PartArt | null = null;
  private swordArt: PartArt | null = null;
  private segmentsShown = 0;

  constructor(images: PuppetImages, facing: 1 | -1) {
    this.facing = facing;
    this.container.addChild(this.shadowLayer, this.edgeLayer, this.faceLayer);
    // The sword and head go on top of the body segments in every layer.
    for (const [layer, key] of [
      [this.shadowLayer, 'shadow'],
      [this.edgeLayer, 'edge'],
      [this.faceLayer, 'face'],
    ] as const) {
      layer.addChild(this.sword[key], this.head[key]);
    }
    this.setImages(images);
  }

  /** Re-bake when a drawing changes. */
  setImages(images: PuppetImages): void {
    const oldSock = this.sockArt;
    const oldHead = this.headArt;
    const oldSword = this.swordArt;
    this.sockArt = bakePart(images.sock, 'sock', PARTS.sock.pinA);
    this.headArt = bakePart(images.head, 'head', PARTS.head.pin);
    this.swordArt = bakePart(images.sword, 'sword', PARTS.sword.handle);

    for (const s of this.segmentPool) s.setArt(this.sockArt);
    this.head.setArt(this.headArt);
    this.sword.setArt(this.swordArt);

    destroyArt(oldSock);
    destroyArt(oldHead);
    destroyArt(oldSword);
  }

  private addSegment(i: number): void {
    const s = this.segmentPool[i] as PartSprites;
    // Segments sit below the sword and head, so insert them at the bottom of each layer.
    this.shadowLayer.addChildAt(s.shadow, Math.min(i, this.shadowLayer.children.length));
    this.edgeLayer.addChildAt(s.edge, Math.min(i, this.edgeLayer.children.length));
    this.faceLayer.addChildAt(s.face, Math.min(i, this.faceLayer.children.length));
  }

  private removeSegment(i: number): void {
    const s = this.segmentPool[i] as PartSprites;
    this.shadowLayer.removeChild(s.shadow);
    this.edgeLayer.removeChild(s.edge);
    this.faceLayer.removeChild(s.face);
  }

  setPose(pose: RigPose): void {
    const sock = this.sockArt;
    if (!sock) return;
    // Segment sprites: pooled, added or removed as the count changes.
    while (this.segmentPool.length < pose.segments.length) {
      const s = new PartSprites();
      s.setArt(sock);
      this.segmentPool.push(s);
    }
    while (this.segmentsShown < pose.segments.length) {
      this.addSegment(this.segmentsShown);
      this.segmentsShown++;
    }
    while (this.segmentsShown > pose.segments.length) {
      this.segmentsShown--;
      this.removeSegment(this.segmentsShown);
    }
    pose.segments.forEach((p, i) => (this.segmentPool[i] as PartSprites).place(p));

    this.sword.place(pose.sword);
    this.head.place(pose.head);
  }
  destroy(): void {
    this.container.destroy({ children: true });
    // Pooled sprites that are currently removed from the tree are not reached by the call above.
    for (const s of this.segmentPool) s.destroy();
    this.sword.destroy();
    this.head.destroy();
    destroyArt(this.sockArt);
    destroyArt(this.headArt);
    destroyArt(this.swordArt);
    this.segmentPool.length = 0;
  }
}
