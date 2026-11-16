import '@fontsource/bungee/latin-400.css';
import '@fontsource/special-elite/latin-400.css';
import '@fontsource/permanent-marker/latin-400.css';

const FACES = ['16px Bungee', "16px 'Special Elite'", "16px 'Permanent Marker'"];

/** Resolves when the three bundled display fonts are loaded. Never rejects (a missing font falls back). */
export async function fontsReady(): Promise<void> {
  try {
    if (typeof document === 'undefined' || !document.fonts) return;
    await Promise.all(FACES.map((f) => document.fonts.load(f, 'AaBb0!')));
    await document.fonts.ready;
  } catch {
    /* fall back to the system fonts in the CSS stacks */
  }
}
