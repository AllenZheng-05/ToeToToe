import { PARTS } from './parts';

export interface PuppetPreset {
  id: string;
  name: string;
  /**
   * Complete standalone SVG documents sized exactly to the part canvas, transparent background,
   * drawn facing right, anchors at the PARTS positions.
   */
  svg: { head: string; sock: string; sword: string };
}

const INK = '#1B1210';

function doc(width: number, height: number, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<g stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`
  );
}

const headSvg = (body: string): string => doc(PARTS.head.width, PARTS.head.height, body);
const sockSvg = (body: string): string => doc(PARTS.sock.width, PARTS.sock.height, body);
const swordSvg = (body: string): string => doc(PARTS.sword.width, PARTS.sword.height, body);

/**
 * The mock's 120 x 82 segment scaled by 1.25 onto the 160 x 120 canvas, centred at (80,60).
 * `decor` is drawn over the body inside the clip of the rounded rectangle's interior.
 */
function sockPiece(body: string, decor: string): string {
  return sockSvg(
    `<rect x="5" y="9" width="150" height="102" rx="45" fill="${body}" stroke="${INK}" stroke-width="6"/>${decor}`,
  );
}

// Sword drawings in the design spec run from handle (38,40) to tip (318,40); the canvas keeps the
// tip at x = 312 so the stroke stays inside, so scale 280 -> 274 about the handle.
const FIT_SWORD = 'translate(38 40) scale(0.97857) translate(-38 -40)';

const TEAL_HEAD = headSvg(
  `<path d="M40 150 C 30 90, 70 50, 140 46 C 210 40, 280 70, 292 118 C 300 150, 262 176, 214 186 C 150 200, 52 204, 40 150 Z" fill="#3FB8AF" stroke="${INK}" stroke-width="7"/>` +
    `<circle cx="96" cy="132" r="12" fill="#FFE14D"/><circle cx="142" cy="154" r="9" fill="#FFE14D"/><circle cx="122" cy="98" r="8" fill="#FFE14D"/>` +
    `<path d="M292 122 L250 132 L262 146 L226 150 L240 164 L206 170" fill="none" stroke="${INK}" stroke-width="7"/>` +
    `<circle cx="196" cy="84" r="22" fill="#FFFFFF" stroke="${INK}" stroke-width="6"/><circle cx="244" cy="92" r="17" fill="#FFFFFF" stroke="${INK}" stroke-width="6"/>` +
    `<circle cx="203" cy="88" r="8" fill="${INK}"/><circle cx="249" cy="95" r="6" fill="${INK}"/>` +
    `<path d="M92 60 q-10 -34 12 -40 q4 30 14 34 q-2 -36 22 -40 q2 30 12 36" fill="none" stroke="#D42A40" stroke-width="7"/>`,
);

const TEAL_SOCK = sockPiece('#3FB8AF', '<rect x="70" y="12.5" width="20" height="95" fill="#FFE14D"/>');

const TEAL_SWORD = swordSvg(
  `<g transform="${FIT_SWORD}">` +
    `<rect x="14" y="30" width="48" height="20" fill="#8A5A2B" stroke="${INK}" stroke-width="8"/>` +
    `<path d="M70 26 L288 20 L318 40 L288 60 L70 54 Z" fill="#C9D2DC" stroke="${INK}" stroke-width="8"/>` +
    `<rect x="58" y="10" width="14" height="60" fill="#FFE14D" stroke="${INK}" stroke-width="8"/></g>`,
);

// The pink head's own anchors were pin (52,145) and mouth end (286,134); this similarity
// transform (rotate -4.13 degrees, scale 1.006) lands them on (58,150) and (292,122).
const PINK_HEAD = headSvg(
  `<g transform="translate(58 150) rotate(-4.13) scale(1.006) translate(-52 -145)">` +
    `<path d="M36 140 C 30 80, 90 40, 160 50 C 230 44, 290 80, 286 130 C 284 170, 230 196, 170 192 C 100 200, 44 196, 36 140 Z" fill="#F48FB1" stroke="${INK}" stroke-width="7"/>` +
    `<path d="M72 150 L98 164 M112 112 L134 128 M90 100 L104 108" fill="none" stroke="#7B3FD1" stroke-width="8"/>` +
    `<path d="M286 134 Q250 166 204 152" fill="none" stroke="${INK}" stroke-width="7"/>` +
    `<path d="M262 150 L262 162 M244 154 L244 166" fill="none" stroke="${INK}" stroke-width="5"/>` +
    `<circle cx="214" cy="98" r="30" fill="#FFFFFF" stroke="${INK}" stroke-width="6"/>` +
    `<circle cx="224" cy="102" r="11" fill="${INK}"/>` +
    `<path d="M178 62 L248 54" fill="none" stroke="${INK}" stroke-width="7"/>` +
    `<path d="M70 74 L58 30 L92 58 L100 18 L124 52 L142 24 L150 58" fill="none" stroke="#7B3FD1" stroke-width="7"/></g>`,
);

const PINK_SOCK = sockPiece('#F48FB1', '<rect x="70" y="12.5" width="20" height="95" fill="#7B3FD1"/>');

const PINK_SWORD = swordSvg(
  `<g transform="${FIT_SWORD}">` +
    `<rect x="14" y="30" width="44" height="20" fill="#7B3FD1" stroke="${INK}" stroke-width="8"/>` +
    `<path d="M70 32 L294 20 L318 40 L294 60 L70 48 Z" fill="#FFE14D" stroke="${INK}" stroke-width="8"/>` +
    `<circle cx="64" cy="40" r="22" fill="#F48FB1" stroke="${INK}" stroke-width="8"/></g>`,
);

// Yellow sock with red stripes, a toothy grin and a curved cutlass.
const YELLOW_HEAD = headSvg(
  `<path d="M40 152 C 32 96, 78 56, 148 52 C 218 46, 284 78, 292 122 C 298 156, 258 182, 208 190 C 146 202, 50 202, 40 152 Z" fill="#FFE14D" stroke="${INK}" stroke-width="7"/>` +
    `<path d="M92 66 L72 168 M128 54 L112 184 M164 52 L152 192" fill="none" stroke="#D42A40" stroke-width="12"/>` +
    `<path d="M292 122 Q262 168 206 160" fill="none" stroke="${INK}" stroke-width="7"/>` +
    `<path d="M270 138 L266 154 M246 150 L244 164 M224 156 L224 168" fill="none" stroke="${INK}" stroke-width="5"/>` +
    `<circle cx="214" cy="90" r="24" fill="#FFFFFF" stroke="${INK}" stroke-width="6"/><circle cx="222" cy="94" r="9" fill="${INK}"/>` +
    `<path d="M186 60 L242 70" fill="none" stroke="${INK}" stroke-width="7"/>` +
    `<path d="M116 52 q8 -22 26 -18 q-4 14 8 18" fill="none" stroke="#D42A40" stroke-width="7"/>`,
);

const YELLOW_SOCK = sockPiece(
  '#FFE14D',
  '<rect x="46" y="12.5" width="14" height="95" fill="#D42A40"/><rect x="100" y="12.5" width="14" height="95" fill="#D42A40"/>',
);

const YELLOW_SWORD = swordSvg(
  `<rect x="14" y="30" width="48" height="20" fill="#D42A40" stroke="${INK}" stroke-width="8"/>` +
    `<path d="M70 30 C 150 12, 250 16, 312 40 C 250 42, 150 54, 70 50 Z" fill="#E9EEF3" stroke="${INK}" stroke-width="8"/>` +
    `<path d="M62 14 Q76 40 62 66" fill="none" stroke="#F08A24" stroke-width="12"/>`,
);

// Blue sock with pink spots, a single big eye with lashes and a thin rapier.
const BLUE_HEAD = headSvg(
  `<path d="M42 150 C 34 100, 70 58, 134 50 C 206 40, 278 74, 292 122 C 296 154, 256 178, 204 188 C 142 200, 52 200, 42 150 Z" fill="#2456C8" stroke="${INK}" stroke-width="7"/>` +
    `<circle cx="100" cy="128" r="14" fill="#F48FB1"/><circle cx="148" cy="160" r="10" fill="#F48FB1"/><circle cx="118" cy="88" r="9" fill="#F48FB1"/><circle cx="176" cy="132" r="7" fill="#F48FB1"/>` +
    `<path d="M292 122 L240 136 Q216 142 196 134" fill="none" stroke="${INK}" stroke-width="7"/>` +
    `<circle cx="216" cy="92" r="34" fill="#FFFFFF" stroke="${INK}" stroke-width="6"/><circle cx="228" cy="96" r="14" fill="${INK}"/>` +
    `<path d="M188 62 L176 44 M212 56 L210 36 M238 60 L246 42" fill="none" stroke="${INK}" stroke-width="6"/>` +
    `<path d="M84 70 q-14 -20 -4 -40 M104 62 q-6 -26 10 -38" fill="none" stroke="#F48FB1" stroke-width="7"/>`,
);

const BLUE_SOCK = sockPiece(
  '#2456C8',
  '<circle cx="42" cy="44" r="11" fill="#F48FB1"/><circle cx="82" cy="78" r="13" fill="#F48FB1"/><circle cx="118" cy="40" r="10" fill="#F48FB1"/><circle cx="124" cy="82" r="7" fill="#F48FB1"/><circle cx="62" cy="88" r="6" fill="#F48FB1"/>',
);

const BLUE_SWORD = swordSvg(
  `<rect x="14" y="32" width="34" height="16" fill="#F48FB1" stroke="${INK}" stroke-width="8"/>` +
    `<path d="M84 35 L312 40 L84 45 Z" fill="#E9EEF3" stroke="${INK}" stroke-width="8"/>` +
    `<circle cx="64" cy="40" r="20" fill="#FFE14D" stroke="${INK}" stroke-width="8"/>`,
);

export const PRESETS: PuppetPreset[] = [
  { id: 'preset-teal', name: 'Teal sock', svg: { head: TEAL_HEAD, sock: TEAL_SOCK, sword: TEAL_SWORD } },
  { id: 'preset-pink', name: 'Pink sock', svg: { head: PINK_HEAD, sock: PINK_SOCK, sword: PINK_SWORD } },
  {
    id: 'preset-yellow',
    name: 'Yellow striped sock',
    svg: { head: YELLOW_HEAD, sock: YELLOW_SOCK, sword: YELLOW_SWORD },
  },
  {
    id: 'preset-blue',
    name: 'Blue spotted sock',
    svg: { head: BLUE_HEAD, sock: BLUE_SOCK, sword: BLUE_SWORD },
  },
];

/** `data:image/svg+xml` URL for use as an image source. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
