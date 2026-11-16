import { describe, expect, it } from 'vitest';
import type { App } from '../../src/app/app';
import { syncReport } from '../../src/debug/overlay';
import { ARRIVAL_RING_SIZE, ArrivalLog, newSyncStats } from '../../src/net/syncStats';

describe('the arrival log', () => {
  it('keeps latest and worst per kind, in ms, negative meaning early', () => {
    const log = new ArrivalLog();
    expect(log.latest()).toEqual({ plant: null, commit: null, resolve: null });
    log.record('commit', -0.12, 10);
    log.record('commit', 0.03, 11);
    log.record('commit', -0.25, 12);
    log.record('plant', 0.08, 13);
    expect(log.latest().commit).toBeCloseTo(-250);
    expect(log.latest().plant).toBeCloseTo(80);
    expect(log.latest().resolve).toBeNull();
    const worst = log.worst();
    expect(worst.early.commit).toBeCloseTo(-250);
    expect(worst.late.commit).toBeCloseTo(30);
    expect(worst.late.plant).toBeCloseTo(80);
    expect(worst.early.plant).toBeCloseTo(80);
    expect(Array.from(log.counts)).toEqual([1, 3, 0]);
  });

  it('keeps a ring of the most recent, oldest first, and resets', () => {
    const log = new ArrivalLog();
    for (let i = 0; i < ARRIVAL_RING_SIZE + 5; i++) log.record('resolve', i / 1000, i);
    const recent = log.recent();
    expect(recent).toHaveLength(ARRIVAL_RING_SIZE);
    expect(recent[0]?.lateMs).toBeCloseTo(5);
    expect(recent.at(-1)?.lateMs).toBeCloseTo(ARRIVAL_RING_SIZE + 4);
    expect(recent.every((a) => a.kind === 'resolve')).toBe(true);
    log.reset();
    expect(log.recent()).toEqual([]);
    expect(log.latest().resolve).toBeNull();
  });

  it('ignores a value that is not a number', () => {
    const log = new ArrivalLog();
    log.record('plant', Number.NaN, 0);
    log.record('plant', Number.POSITIVE_INFINITY, 0);
    expect(log.recent()).toEqual([]);
  });

  it('recording reuses its buffers: nothing it holds grows', () => {
    const log = new ArrivalLog();
    const before = [log.latestMs, log.worstLateMs, log.worstEarlyMs, log.counts];
    for (let i = 0; i < 10_000; i++) log.record('plant', 0.001 * (i % 7), i);
    expect([log.latestMs, log.worstLateMs, log.worstEarlyMs, log.counts]).toEqual(before);
    expect(log.recent()).toHaveLength(ARRIVAL_RING_SIZE);
  });
});

describe('the sync report for window.__ttt', () => {
  it('is null outside a room, and carries the numbers inside one', () => {
    expect(syncReport({ connection: null } as unknown as App)).toBeNull();
    const stats = {
      ...newSyncStats(),
      offsetMs: 1234.5,
      estimateAt: 90,
      bestRttMs: 40,
      lastRttMs: 55,
      samples: 6,
    };
    stats.driftMs = 12;
    const log = new ArrivalLog();
    log.record('commit', -0.2, 95);
    const app = {
      hasEngine: true,
      engine: { clock: { now: () => 100 } },
      connection: { room: { role: 'guest', syncStats: stats, arrivals: log } },
    } as unknown as App;
    const report = syncReport(app);
    expect(report).toMatchObject({
      role: 'guest',
      offsetMs: 1234.5,
      ageSec: 10,
      bestRttMs: 40,
      lastRttMs: 55,
      samples: 6,
      driftMs: 12,
    });
    expect(report?.arrivals.latestMs.commit).toBeCloseTo(-200);
    expect(report?.arrivals.worstEarlyMs.commit).toBeCloseTo(-200);
    expect(report?.arrivals.counts).toEqual({ plant: 0, commit: 1, resolve: 0 });
    expect(report?.arrivals.recent).toHaveLength(1);
  });
});
