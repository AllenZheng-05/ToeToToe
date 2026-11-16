import { SETTINGS, type Store } from '../data/store';
import { PARTS, type PartKind } from '../puppet/parts';
import { PRESETS, svgDataUrl, type PuppetPreset } from '../puppet/presets';
import type { PuppetDrawing } from './workshop';

export const KINDS: PartKind[] = ['head', 'sock', 'sword'];

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the drawing'))),
      'image/png',
    );
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the image'));
    img.src = url;
  });
}

/** Draw an image-like thing onto a canvas of the part's own size. */
async function blobToCanvas(blob: Blob, kind: PartKind): Promise<HTMLCanvasElement> {
  const { width, height } = PARTS[kind];
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob);
    try {
      ctx.drawImage(bmp, 0, 0, width, height);
    } finally {
      bmp.close();
    }
  } else {
    const url = URL.createObjectURL(blob);
    try {
      ctx.drawImage(await loadImage(url), 0, 0, width, height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return canvas;
}

/** Decode a PuppetDrawing's blobs into canvases for rendering (createImageBitmap or Image). */
export async function decodeDrawing(d: {
  head: Blob;
  sock: Blob;
  sword: Blob;
}): Promise<{ head: HTMLCanvasElement; sock: HTMLCanvasElement; sword: HTMLCanvasElement }> {
  const [head, sock, sword] = await Promise.all([
    blobToCanvas(d.head, 'head'),
    blobToCanvas(d.sock, 'sock'),
    blobToCanvas(d.sword, 'sword'),
  ]);
  return { head, sock, sword };
}

async function rasteriseSvg(svg: string, kind: PartKind): Promise<Blob> {
  const { width, height } = PARTS[kind];
  const img = await loadImage(svgDataUrl(svg));
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  ctx.drawImage(img, 0, 0, width, height);
  return canvasToBlob(canvas);
}

/** PNG blobs (at PARTS sizes) for a preset, rasterised from its SVG in the browser. */
export async function presetToDrawing(preset: PuppetPreset): Promise<PuppetDrawing> {
  const [head, sock, sword] = await Promise.all([
    rasteriseSvg(preset.svg.head, 'head'),
    rasteriseSvg(preset.svg.sock, 'sock'),
    rasteriseSvg(preset.svg.sword, 'sword'),
  ]);
  return { id: preset.id, name: preset.name, head, sock, sword, presetId: preset.id };
}

async function blankDrawing(): Promise<PuppetDrawing> {
  const blank = (kind: PartKind): Promise<Blob> => {
    const { width, height } = PARTS[kind];
    return canvasToBlob(makeCanvas(width, height));
  };
  const [head, sock, sword] = await Promise.all([blank('head'), blank('sock'), blank('sword')]);
  return { id: null, name: 'My puppet', head, sock, sword };
}

/**
 * The puppet the player will take into a match: the saved puppet or preset named by the
 * `selectedPuppetId` setting, else the first preset. Never rejects.
 */
export async function loadSelectedPuppet(store: Store): Promise<PuppetDrawing> {
  try {
    const id = await store.settings.get<string>(SETTINGS.selectedPuppetId, '');
    if (id) {
      const preset = PRESETS.find((p) => p.id === id);
      if (preset) return await presetToDrawing(preset);
      const saved = await store.puppets.get(id);
      if (saved) {
        return { id: saved.id, name: saved.name, head: saved.head, sock: saved.sock, sword: saved.sword };
      }
    }
  } catch {
    /* fall through to the first preset */
  }
  try {
    return await presetToDrawing(PRESETS[0] as PuppetPreset);
  } catch {
    return blankDrawing();
  }
}
