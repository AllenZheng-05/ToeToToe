import { describe, expect, it } from 'vitest';
import { PARTS } from '../../src/puppet/parts';
import { PRESETS, svgDataUrl } from '../../src/puppet/presets';

describe('PRESETS', () => {
  it('has four presets with unique ids and names', () => {
    expect(PRESETS).toHaveLength(4);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(4);
    expect(new Set(PRESETS.map((p) => p.name)).size).toBe(4);
    expect(PRESETS[0]?.id).toBe('preset-teal');
    expect(PRESETS[1]?.id).toBe('preset-pink');
  });

  const sizes = {
    head: PARTS.head,
    sock: PARTS.sock,
    sword: PARTS.sword,
  } as const;

  for (const preset of PRESETS) {
    for (const kind of ['head', 'sock', 'sword'] as const) {
      it(`${preset.id} ${kind} is a safe standalone SVG of the exact canvas size`, () => {
        const svg = preset.svg[kind];
        const { width, height } = sizes[kind];
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg).toContain(`width="${width}"`);
        expect(svg).toContain(`height="${height}"`);
        expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
        expect(svg).not.toContain('<script');
        expect(svg).not.toContain('<image');
        expect(svg).not.toContain('<foreignObject');
        expect(svg).not.toContain('href=');
        expect(svg).not.toContain('url(');
        expect(svg).not.toMatch(/\son[a-z]+=/);
      });
    }
  }

  it('makes a data URL', () => {
    const url = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(url.split(',')[1] as string)).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
  });
});
