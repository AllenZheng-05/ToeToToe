import { describe, expect, it } from 'vitest';
import type { Tunables } from '../../src/core/types';

describe('smoke', () => {
  it('runs a trivial assertion and can reference shared types', () => {
    const partial: Partial<Tunables> = {};
    expect(Object.keys(partial)).toHaveLength(0);
    expect(1 + 1).toBe(2);
  });
});
