/**
 * Whatever a link hands over as binary data, as a fresh `ArrayBuffer` holding exactly those bytes.
 * Accepts an `ArrayBuffer` or any `ArrayBufferView` (Trystero delivers a `Uint8Array`, possibly a window
 * onto a larger buffer, so the exact byte range is copied). Anything else is not bytes: null.
 */
export function toArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return copy.buffer;
  }
  return null;
}
