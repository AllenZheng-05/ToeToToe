import { describe, expect, it } from 'vitest';
import { MAX_PART_BYTES, PARTS, type PartKind } from '../../src/puppet/parts';
import { checkDrawingBytes } from '../../src/puppet/validate';

function pngHeader(width: number, height: number, extra = 0): ArrayBuffer {
  const bytes = new Uint8Array(33 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8; // bit depth
  bytes[25] = 6; // RGBA
  return bytes.buffer;
}

const KINDS: PartKind[] = ['head', 'sock', 'sword'];

describe('checkDrawingBytes', () => {
  for (const kind of KINDS) {
    const { width, height } = PARTS[kind];

    it(`accepts a ${kind} header of the right size`, () => {
      expect(checkDrawingBytes(pngHeader(width, height), kind)).toEqual({ ok: true });
    });

    it(`rejects wrong ${kind} dimensions`, () => {
      expect(checkDrawingBytes(pngHeader(width + 1, height), kind)).toEqual({
        ok: false,
        reason: 'dimensions',
      });
      expect(checkDrawingBytes(pngHeader(width, height * 2), kind)).toEqual({
        ok: false,
        reason: 'dimensions',
      });
    });
  }

  it('rejects another part’s size', () => {
    expect(checkDrawingBytes(pngHeader(PARTS.sock.width, PARTS.sock.height), 'head')).toEqual({
      ok: false,
      reason: 'dimensions',
    });
  });

  it('rejects non-PNG bytes', () => {
    const jpeg = new Uint8Array(64);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(checkDrawingBytes(jpeg.buffer, 'head')).toEqual({ ok: false, reason: 'type' });
    const text = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(checkDrawingBytes(text.buffer as ArrayBuffer, 'sock')).toEqual({
      ok: false,
      reason: 'type',
    });
  });

  it('rejects a PNG signature with no IHDR', () => {
    const buf = pngHeader(PARTS.head.width, PARTS.head.height);
    new Uint8Array(buf).set([0x49, 0x44, 0x41, 0x54], 12); // IDAT instead
    expect(checkDrawingBytes(buf, 'head')).toEqual({ ok: false, reason: 'type' });
  });

  it('rejects truncated data', () => {
    const full = pngHeader(PARTS.head.width, PARTS.head.height);
    expect(checkDrawingBytes(full.slice(0, 20), 'head')).toEqual({ ok: false, reason: 'type' });
    expect(checkDrawingBytes(new ArrayBuffer(0), 'head')).toEqual({ ok: false, reason: 'type' });
  });

  it('rejects oversize data before looking at the contents', () => {
    const big = pngHeader(PARTS.head.width, PARTS.head.height, MAX_PART_BYTES);
    expect(big.byteLength).toBeGreaterThan(MAX_PART_BYTES);
    expect(checkDrawingBytes(big, 'head')).toEqual({ ok: false, reason: 'size' });
  });

  it('accepts data exactly at the size limit', () => {
    const atLimit = pngHeader(PARTS.head.width, PARTS.head.height, MAX_PART_BYTES - 33);
    expect(atLimit.byteLength).toBe(MAX_PART_BYTES);
    expect(checkDrawingBytes(atLimit, 'head')).toEqual({ ok: true });
  });
});
