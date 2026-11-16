/** The twelve colours of mock 3, in its reading order (three rows of four). */
export const PALETTE: string[] = [
  '#1B1210', // black
  '#FFFFFF', // white
  '#D42A40', // red
  '#F48FB1', // pink
  '#F08A24', // orange
  '#FFE14D', // yellow
  '#3FA65A', // green
  '#3FB8AF', // teal
  '#2456C8', // blue
  '#7B3FD1', // purple
  '#8A5A2B', // brown
  '#9AA3AF', // grey
];

export const COLOUR_NAMES: string[] = [
  'Black',
  'White',
  'Red',
  'Pink',
  'Orange',
  'Yellow',
  'Green',
  'Teal',
  'Blue',
  'Purple',
  'Brown',
  'Grey',
];

/** Brush radii in drawing pixels: small, medium, large. */
export const BRUSH_SIZES: [number, number, number] = [4, 9, 18];

export function hexToRgba(hex: string): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}
