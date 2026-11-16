const NAME_KEY = 'toetotoe.name';
export const DEFAULT_NAME = 'Player';
export const MAX_NAME_LENGTH = 20;

/** Trim, cap the length and fall back to the default. */
export function cleanName(raw: string): string {
  const name = raw.trim().slice(0, MAX_NAME_LENGTH);
  return name === '' ? DEFAULT_NAME : name;
}

export function loadName(): string {
  try {
    return cleanName(localStorage.getItem(NAME_KEY) ?? '');
  } catch {
    return DEFAULT_NAME;
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, cleanName(name));
  } catch {
    // storage unavailable: the name just does not persist
  }
}
