import { describe, expect, it } from 'vitest';
import {
  FALLBACK_MARK_COLOUR,
  INK_RGB,
  MIN_COLOUR_DISTANCE,
  WHITE_RGB,
  colourDistance,
  distinctColours,
  dominantColour,
  inkOrWhite,
  puppetMarkColour,
  type PixelImage,
  type Rgb,
} from '../../src/puppet/colour';

type Px = [number, number, number, number];

function image(pixels: Px[]): PixelImage {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((p, i) => data.set(p, i * 4));
  return { pixels: data, width: pixels.length, height: 1 };
}
const fill = (n: number, p: Px): Px[] => Array.from({ length: n }, () => p);
const dominant = (px: Px[]): Rgb | null => {
  const i = image(px);
  return dominantColour(i.pixels, i.width, i.height);
};

describe('dominantColour', () => {
  it('returns the colour of a single-colour drawing', () => {
    expect(dominant(fill(50, [63, 184, 175, 255]))).toEqual({ r: 63, g: 184, b: 175 });
  });

  it('takes the majority of two colours', () => {
    const c = dominant([...fill(30, [212, 42, 64, 255]), ...fill(70, [36, 86, 200, 255])]);
    expect(c).toEqual({ r: 36, g: 86, b: 200 });
  });

  it('averages the pixels of the fullest bucket', () => {
    const c = dominant([...fill(10, [200, 40, 40, 255]), ...fill(10, [204, 44, 44, 255])]);
    expect(c).toEqual({ r: 202, g: 42, b: 42 });
  });

  it('ignores an outline that outnumbers the colour', () => {
    const px = [
      ...fill(200, [27, 18, 16, 255]),
      ...fill(40, [255, 255, 255, 255]),
      ...fill(10, [244, 143, 177, 255]),
    ];
    expect(dominant(px)).toEqual({ r: 244, g: 143, b: 177 });
  });

  it('ignores transparent pixels', () => {
    const px = [...fill(500, [255, 0, 0, 0]), ...fill(5, [0, 160, 0, 255])];
    expect(dominant(px)).toEqual({ r: 0, g: 160, b: 0 });
  });

  it('is null for a fully transparent drawing', () => {
    expect(dominant(fill(20, [10, 200, 30, 0]))).toBeNull();
  });

  it('is null for greys, black and white only', () => {
    const px = [
      ...fill(10, [128, 128, 128, 255]),
      ...fill(10, [0, 0, 0, 255]),
      ...fill(10, [255, 255, 255, 255]),
    ];
    expect(dominant(px)).toBeNull();
  });

  it('is null for an empty image', () => {
    expect(dominantColour(new Uint8ClampedArray(0), 0, 0)).toBeNull();
  });
});

describe('puppetMarkColour', () => {
  it('weights the sock above the head', () => {
    const sock = image(fill(10, [63, 184, 175, 255]));
    const head = image(fill(15, [212, 42, 64, 255]));
    expect(puppetMarkColour({ sock, head })).toEqual({ r: 63, g: 184, b: 175 });
  });

  it('lets a big head win over a small sock patch', () => {
    const sock = image(fill(3, [63, 184, 175, 255]));
    const head = image(fill(20, [212, 42, 64, 255]));
    expect(puppetMarkColour({ sock, head })).toEqual({ r: 212, g: 42, b: 64 });
  });

  it('falls back to the brief yellow when nothing qualifies', () => {
    const none = image(fill(10, [0, 0, 0, 0]));
    expect(puppetMarkColour({ sock: none, head: none })).toEqual(FALLBACK_MARK_COLOUR);
  });

  it('lightens a colour too dark to read against ink', () => {
    const dark = image(fill(10, [0, 0, 70, 255]));
    const c = puppetMarkColour({ sock: dark, head: dark });
    expect(c.b).toBeGreaterThan(70);
  });
});

describe('distinctColours', () => {
  const teal: Rgb = { r: 63, g: 184, b: 175 };
  const pink: Rgb = { r: 244, g: 143, b: 177 };

  it('leaves clearly different colours alone', () => {
    expect(colourDistance(teal, pink)).toBeGreaterThan(MIN_COLOUR_DISTANCE);
    expect(distinctColours(teal, pink)).toEqual([teal, pink]);
  });

  it('moves the opponent, not the local player, when the colours are near-identical', () => {
    const near: Rgb = { r: 66, g: 182, b: 178 };
    expect(colourDistance(teal, near)).toBeLessThan(MIN_COLOUR_DISTANCE);
    const [local, opp] = distinctColours(teal, near);
    expect(local).toEqual(teal);
    expect(colourDistance(local, opp)).toBeGreaterThanOrEqual(MIN_COLOUR_DISTANCE);
  });

  it('separates two identical colours', () => {
    const [a, b] = distinctColours(pink, pink);
    expect(a).toEqual(pink);
    expect(colourDistance(a, b)).toBeGreaterThanOrEqual(MIN_COLOUR_DISTANCE);
  });

  it('copes with a grey opponent equal to a grey local colour', () => {
    const grey: Rgb = { r: 120, g: 120, b: 120 };
    const [a, b] = distinctColours(grey, grey);
    expect(colourDistance(a, b)).toBeGreaterThanOrEqual(MIN_COLOUR_DISTANCE);
  });
});

describe('inkOrWhite', () => {
  it('picks ink on light discs and white on dark ones', () => {
    expect(inkOrWhite({ r: 255, g: 225, b: 77 })).toEqual(INK_RGB);
    expect(inkOrWhite({ r: 244, g: 143, b: 177 })).toEqual(INK_RGB);
    expect(inkOrWhite({ r: 36, g: 86, b: 200 })).toEqual(WHITE_RGB);
    expect(inkOrWhite({ r: 123, g: 63, b: 209 })).toEqual(WHITE_RGB);
  });
});
