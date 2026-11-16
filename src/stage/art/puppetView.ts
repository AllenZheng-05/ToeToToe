import { Container, Sprite, type Texture } from 'pixi.js';
import { PARTS, PART_SCALE } from '../../puppet/parts';
import { svgDataUrl, type PuppetPreset } from '../../puppet/presets';
import type { Placement, RigPose } from '../../puppet/rig';
import { bakeCutout, canvasTexture, cutoutPadding, type CutoutOptions, type Padding } from './cutout';

export interface PuppetImages {
  head: CanvasImageSource;
  sock: CanvasImageSource;
  sword: CanvasImageSource;
} // at PARTS sizes

/** Cutout treatment for puppet parts (DESIGN_SPEC F2): 2 px white edge, shadow 4,5 at 28%. */
const PART_CUTOUT = { outline: 2, shadowX: 4, shadowY: 5, shadowAlpha: 0.28 } as const;
/** Texture pixels per design pixel for puppet parts. */
const RESOLUTION = 2;

const PIN_FILL = '#D4AF37';
const PIN_EDGE = '#7A5C12';
const PIN_RADIUS = 7;

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
  texture: Texture;
  /** First anchor (pin / pinA / handle) in the texture's logical px: the sprite pivot. */
  pivot: { x: number; y: number };
}

function bakePart(
  source: CanvasImageSource,
  kind: 'head' | 'sock' | 'sword',
  anchor: { x: number; y: number },
): PartArt {
  const scale = PART_SCALE[kind];
  const opts: CutoutOptions = { ...PART_CUTOUT, scale, resolution: RESOLUTION };
  const pad: Padding = cutoutPadding(opts);
  const canvas = bakeCutout(source, PARTS[kind].width, PARTS[kind].height, opts);
  return {
    texture: canvasTexture(canvas, RESOLUTION),
    pivot: { x: pad.left + anchor.x * scale, y: pad.top + anchor.y * scale },
  };
}

function bakePinTexture(): Texture {
  const size = (PIN_RADIUS + 2) * 2;
  const c = document.createElement('canvas');
  c.width = size * RESOLUTION;
  c.height = size * RESOLUTION;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.scale(RESOLUTION, RESOLUTION);
  g.beginPath();
  g.arc(size / 2, size / 2, PIN_RADIUS, 0, Math.PI * 2);
  g.fillStyle = PIN_FILL;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = PIN_EDGE;
  g.stroke();
  return canvasTexture(c, RESOLUTION);
}

function place(sprite: Sprite, p: Placement): void {
  sprite.position.set(p.x, p.y);
  sprite.rotation = p.rotation;
  sprite.scale.set(p.scaleX, 1);
}

/**
 * A puppet drawn from baked cutout textures of its three parts. `setPose` applies a RigPose from
 * solveRig: segment sprites are pooled and added or removed as the count changes; brass pins are
 * drawn at the joints. Back to front: segments, sword, head, pins.
 */
export class PuppetView {
  readonly container = new Container();
  readonly facing: 1 | -1;
  private readonly segmentLayer = new Container();
  private readonly pinLayer = new Container();
  private readonly sword = new Sprite();
  private readonly head = new Sprite();
  private readonly pinTexture = bakePinTexture();
  private readonly segmentPool: Sprite[] = [];
  private readonly pinPool: Sprite[] = [];
  private sockArt: PartArt | null = null;
  private headArt: PartArt | null = null;
  private swordArt: PartArt | null = null;
  private segmentsShown = 0;
  private pinsShown = 0;

  constructor(images: PuppetImages, facing: 1 | -1) {
    this.facing = facing;
    this.container.addChild(this.segmentLayer, this.sword, this.head, this.pinLayer);
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

    for (const s of this.segmentPool) {
      s.texture = this.sockArt.texture;
      s.pivot.set(this.sockArt.pivot.x, this.sockArt.pivot.y);
    }
    this.head.texture = this.headArt.texture;
    this.head.pivot.set(this.headArt.pivot.x, this.headArt.pivot.y);
    this.sword.texture = this.swordArt.texture;
    this.sword.pivot.set(this.swordArt.pivot.x, this.swordArt.pivot.y);

    oldSock?.texture.destroy(true);
    oldHead?.texture.destroy(true);
    oldSword?.texture.destroy(true);
  }

  setPose(pose: RigPose): void {
    const sock = this.sockArt;
    if (!sock) return;
    // Segment sprites: pooled, added or removed as the count changes.
    while (this.segmentPool.length < pose.segments.length) {
      const s = new Sprite(sock.texture);
      s.pivot.set(sock.pivot.x, sock.pivot.y);
      this.segmentPool.push(s);
    }
    while (this.segmentsShown < pose.segments.length) {
      this.segmentLayer.addChild(this.segmentPool[this.segmentsShown] as Sprite);
      this.segmentsShown++;
    }
    while (this.segmentsShown > pose.segments.length) {
      this.segmentsShown--;
      this.segmentLayer.removeChild(this.segmentPool[this.segmentsShown] as Sprite);
    }
    pose.segments.forEach((p, i) => place(this.segmentPool[i] as Sprite, p));

    place(this.sword, pose.sword);
    place(this.head, pose.head);

    while (this.pinPool.length < pose.pins.length) {
      const s = new Sprite(this.pinTexture);
      s.anchor.set(0.5);
      this.pinPool.push(s);
    }
    while (this.pinsShown < pose.pins.length) {
      this.pinLayer.addChild(this.pinPool[this.pinsShown] as Sprite);
      this.pinsShown++;
    }
    while (this.pinsShown > pose.pins.length) {
      this.pinsShown--;
      this.pinLayer.removeChild(this.pinPool[this.pinsShown] as Sprite);
    }
    pose.pins.forEach((p, i) => (this.pinPool[i] as Sprite).position.set(p.x, p.y));
  }

  destroy(): void {
    this.container.destroy({ children: true });
    // Pooled sprites that are currently removed from the tree are not reached by the call above.
    for (const s of [...this.segmentPool, ...this.pinPool]) if (!s.destroyed) s.destroy();
    this.sockArt?.texture.destroy(true);
    this.headArt?.texture.destroy(true);
    this.swordArt?.texture.destroy(true);
    this.pinTexture.destroy(true);
    this.segmentPool.length = 0;
    this.pinPool.length = 0;
  }
}
