import { describe, expect, it } from 'vitest';
import { roomPathFor, titlePathFor } from '../../src/app/address';

describe('address paths', () => {
  it('puts the code in the path and keeps the query string', () => {
    expect(roomPathFor('ROW-G-12', '')).toBe('/ROW-G-12');
    expect(roomPathFor('ROW-G-12', '?net=tab&debug=1')).toBe('/ROW-G-12?net=tab&debug=1');
  });
  it('restores the title path with the query string', () => {
    expect(titlePathFor('')).toBe('/');
    expect(titlePathFor('?debug=1')).toBe('/?debug=1');
  });
});
