import type { Clock } from '../../src/core/types';

/** A clock stepped by hand. */
export class FakeClock implements Clock {
  private t: number;

  constructor(start = 0) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  set(t: number): void {
    this.t = t;
  }

  advance(dt: number): void {
    this.t += dt;
  }
}
