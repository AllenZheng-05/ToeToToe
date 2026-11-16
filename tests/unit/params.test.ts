import { describe, expect, it } from 'vitest';
import { parseParams } from '../../src/app/params';

const base = 'http://localhost:5173/';

describe('parseParams', () => {
  it('gives defaults for a bare URL', () => {
    expect(parseParams(base)).toEqual({
      debug: false,
      bot: false,
      autoplay: false,
      bpm: null,
      seed: null,
      botAccuracy: null,
      room: null,
      tunables: {},
    });
  });

  it('reads every field', () => {
    const tunables = encodeURIComponent('{"startHealth":30,"missDamage":4}');
    const p = parseParams(
      `${base}?debug=1&bot=1&autoplay=1&bpm=140&seed=7&botAccuracy=0.5&room=ROW-G-12&tunables=${tunables}`,
    );
    expect(p).toEqual({
      debug: true,
      bot: true,
      autoplay: true,
      bpm: 140,
      seed: 7,
      botAccuracy: 0.5,
      room: 'ROW-G-12',
      tunables: { startHealth: 30, missDamage: 4 },
    });
  });

  it('treats flags other than 1 or true as off', () => {
    const p = parseParams(`${base}?debug=0&bot=yes&autoplay=true`);
    expect(p.debug).toBe(false);
    expect(p.bot).toBe(false);
    expect(p.autoplay).toBe(true);
  });

  it('ignores non-numeric numbers', () => {
    const p = parseParams(`${base}?bpm=fast&seed=&botAccuracy=NaN`);
    expect(p.bpm).toBeNull();
    expect(p.seed).toBeNull();
    expect(p.botAccuracy).toBeNull();
  });

  it('drops bad tunables JSON', () => {
    expect(parseParams(`${base}?tunables=%7Bnope`).tunables).toEqual({});
    expect(parseParams(`${base}?tunables=%5B1%2C2%5D`).tunables).toEqual({});
    expect(parseParams(`${base}?tunables=5`).tunables).toEqual({});
  });

  it('drops unknown keys and non-number values', () => {
    const raw = encodeURIComponent(
      '{"startHealth":30,"bogus":1,"missDamage":"4","minBpm":null,"maxBpm":1e999}',
    );
    expect(parseParams(`${base}?tunables=${raw}`).tunables).toEqual({ startHealth: 30 });
  });

  it('reads a path-style room code', () => {
    expect(parseParams(`${base}ROW-G-12`).room).toBe('ROW-G-12');
    expect(parseParams('/ROW-G-12?debug=1')).toMatchObject({ room: 'ROW-G-12', debug: true });
  });

  it('prefers the query room over the path', () => {
    expect(parseParams(`${base}AAA?room=BBB`).room).toBe('BBB');
  });

  it('rejects odd room codes', () => {
    expect(parseParams(`${base}?room=<script>`).room).toBeNull();
    expect(parseParams(`${base}index.html`).room).toBeNull();
  });
});
