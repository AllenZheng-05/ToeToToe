import { SETTINGS, type Store } from '../data/store';

/** Where the name lived before it moved into the store's settings. Read once, then removed. */
const LEGACY_NAME_KEY = 'toetotoe.name';
export const DEFAULT_NAME = 'Player';
export const MAX_NAME_LENGTH = 20;

/** Trim, cap the length and fall back to the default. */
export function cleanName(raw: string): string {
  const name = raw.trim().slice(0, MAX_NAME_LENGTH);
  return name === '' ? DEFAULT_NAME : name;
}

function legacyName(): string | null {
  try {
    return localStorage.getItem(LEGACY_NAME_KEY);
  } catch {
    return null;
  }
}

function dropLegacyName(): void {
  try {
    localStorage.removeItem(LEGACY_NAME_KEY);
  } catch {
    // storage unavailable: nothing to remove
  }
}

/** The saved display name. A name from the old localStorage key is moved into the settings once. */
export async function loadName(store: Store): Promise<string> {
  try {
    const saved = await store.settings.get<string>(SETTINGS.displayName, '');
    if (typeof saved === 'string' && saved.trim() !== '') return cleanName(saved);
    const old = legacyName();
    if (old !== null && old.trim() !== '') {
      const name = cleanName(old);
      await store.settings.set(SETTINGS.displayName, name);
      dropLegacyName();
      return name;
    }
  } catch {
    // settings unavailable: the default name
  }
  return DEFAULT_NAME;
}

export async function saveName(store: Store, name: string): Promise<void> {
  try {
    await store.settings.set(SETTINGS.displayName, cleanName(name));
  } catch {
    // the name just does not persist
  }
}
