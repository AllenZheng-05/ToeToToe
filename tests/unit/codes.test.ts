import { describe, expect, it } from 'vitest';
import { generateRoomCode, normaliseRoomCode, roomCodeFromUrl, roomLink } from '../../src/net/codes';

describe('generateRoomCode', () => {
  it('makes WORD-L-NN codes with no I or O and some variety', () => {
    const seen = new Set<string>();
    const words = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-Z]{3}-[A-HJ-NP-Z]-\d{2}$/);
      expect(normaliseRoomCode(code)).toBe(code);
      seen.add(code);
      words.add(code.slice(0, 3));
    }
    expect(seen.size).toBeGreaterThan(400);
    expect(words.size).toBeGreaterThanOrEqual(40);
  });
});

describe('normaliseRoomCode', () => {
  it('accepts spaces, dashes, no separator and any case', () => {
    for (const v of ['row g 12', 'rowg12', ' ROW-g-12 ', 'ROW-G-12', 'Row G-12', 'row-g 12']) {
      expect(normaliseRoomCode(v)).toBe('ROW-G-12');
    }
  });

  it('rejects junk', () => {
    for (const v of [
      '',
      'about',
      'ROW-G-1',
      'ROW-G-123',
      'RO-G-12',
      'ROW-I-12',
      'ROW-O-12',
      'ROW-GG-12',
      'ROW-G-1A',
      'ROW-G-12-',
      '12-G-ROW',
    ]) {
      expect(normaliseRoomCode(v)).toBeNull();
    }
  });
});

describe('roomCodeFromUrl', () => {
  it('reads a path segment', () => {
    expect(roomCodeFromUrl('https://toetotoe.allenzheng.com/ROW-G-12')).toBe('ROW-G-12');
    expect(roomCodeFromUrl('/ROW-G-12')).toBe('ROW-G-12');
    expect(roomCodeFromUrl('https://x.test/row-g-12/')).toBe('ROW-G-12');
  });

  it('reads ?room= and lets it win', () => {
    expect(roomCodeFromUrl('https://x.test/?room=row-g-12')).toBe('ROW-G-12');
    expect(roomCodeFromUrl('https://x.test/BOX-A-01?room=cue-b-02')).toBe('CUE-B-02');
  });

  it('gives null when there is no code', () => {
    expect(roomCodeFromUrl('https://x.test/')).toBeNull();
    expect(roomCodeFromUrl('/')).toBeNull();
    expect(roomCodeFromUrl('/about')).toBeNull();
    expect(roomCodeFromUrl('https://x.test/about?room=nope')).toBeNull();
  });
});

describe('roomLink', () => {
  it('joins origin and code', () => {
    expect(roomLink('https://toetotoe.allenzheng.com', 'ROW-G-12')).toBe(
      'https://toetotoe.allenzheng.com/ROW-G-12',
    );
    expect(roomLink('http://localhost:5173/', 'ROW-G-12')).toBe('http://localhost:5173/ROW-G-12');
  });
});
