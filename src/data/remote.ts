/** Everything the app needs from a backend. No Supabase types appear here. */
export interface RemoteUser {
  id: string;
  email: string | null;
  isGuest: boolean;
}
export interface RemotePuppetRow {
  id: string;
  name: string;
  updatedAt: number; // epoch ms
}
export interface Remote {
  /** Restores a persisted session if there is one. */
  currentUser(): Promise<RemoteUser | null>;
  signInGuest(): Promise<RemoteUser>;
  /** Links an email to the current (guest) account. */
  attachEmail(email: string): Promise<void>;
  signOut(): Promise<void>;
  getProfileName(): Promise<string | null>;
  setProfileName(name: string): Promise<void>;
  listPuppets(): Promise<RemotePuppetRow[]>;
  uploadPuppet(p: {
    id?: string;
    name: string;
    head: Blob;
    sock: Blob;
    sword: Blob;
    updatedAt: number;
  }): Promise<RemotePuppetRow>;
  downloadPuppet(id: string): Promise<{ row: RemotePuppetRow; head: Blob; sock: Blob; sword: Blob }>;
  deletePuppet(id: string): Promise<void>;
}

/** Null when VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing or malformed. Pure. */
export function supabaseConfigFromEnv(
  env: Record<string, string | undefined>,
): { url: string; anonKey: string } | null {
  const url = env['VITE_SUPABASE_URL']?.trim();
  const anonKey = env['VITE_SUPABASE_ANON_KEY']?.trim();
  if (!url || !anonKey) return null;
  if (/\s/.test(anonKey)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) return null;
  return { url: parsed.origin, anonKey };
}
