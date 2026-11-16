import { MAX_PART_BYTES, PARTS, type PartKind } from './parts';

export type DrawingRejection = 'size' | 'type' | 'dimensions';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4). */
const HEADER_BYTES = 24;

/**
 * For drawings from the other player (untrusted): at most MAX_PART_BYTES, PNG signature, IHDR
 * present, width and height exactly the part's canvas size. Reads headers only; decoding is left
 * to the browser.
 */
export function checkDrawingBytes(
  data: ArrayBuffer,
  kind: PartKind,
): { ok: true } | { ok: false; reason: DrawingRejection } {
  if (data.byteLength > MAX_PART_BYTES) return { ok: false, reason: 'size' };
  if (data.byteLength < HEADER_BYTES) return { ok: false, reason: 'type' };
  const bytes = new Uint8Array(data, 0, HEADER_BYTES);
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) return { ok: false, reason: 'type' };
  }
  // IHDR chunk: length 13, then the ASCII name.
  const view = new DataView(data, 0, HEADER_BYTES);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) {
    return { ok: false, reason: 'type' };
  }
  const part = PARTS[kind];
  if (view.getUint32(16) !== part.width || view.getUint32(20) !== part.height) {
    return { ok: false, reason: 'dimensions' };
  }
  return { ok: true };
}
