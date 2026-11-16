import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Remote, RemotePuppetRow, RemoteUser } from './remote';

const BUCKET = 'puppets';
const PUPPET_COLUMNS = 'id,name,updated_at';
const KINDS = ['head', 'sock', 'sword'] as const;
type Kind = (typeof KINDS)[number];

interface PuppetDbRow {
  id: string;
  name: string;
  updated_at: string;
}

function toUser(u: User): RemoteUser {
  return { id: u.id, email: u.email ?? null, isGuest: u.is_anonymous ?? false };
}

function toRow(r: PuppetDbRow): RemotePuppetRow {
  const t = Date.parse(r.updated_at);
  return { id: r.id, name: r.name, updatedAt: Number.isFinite(t) ? t : 0 };
}

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? 'unknown error'}`);
}

/**
 * Loads @supabase/supabase-js with a dynamic import (a separate chunk that unconfigured sites
 * never download) and implements Remote against supabase/migrations/20261116000000_init.sql.
 */
export async function createSupabaseRemote(config: { url: string; anonKey: string }): Promise<Remote> {
  const { createClient } = await import('@supabase/supabase-js');
  const client: SupabaseClient = createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  async function userId(): Promise<string> {
    const { data, error } = await client.auth.getSession();
    if (error) fail('session', error);
    const id = data.session?.user.id;
    if (!id) throw new Error('Not signed in');
    return id;
  }

  const path = (uid: string, id: string, kind: Kind): string => `${uid}/${id}/${kind}.png`;

  return {
    async currentUser() {
      const { data, error } = await client.auth.getSession();
      if (error) fail('session', error);
      return data.session ? toUser(data.session.user) : null;
    },

    async signInGuest() {
      const { data, error } = await client.auth.signInAnonymously();
      if (error || !data.user) fail('guest sign-in', error);
      return toUser(data.user);
    },

    async attachEmail(email) {
      const { error } = await client.auth.updateUser(
        { email },
        { emailRedirectTo: typeof location === 'undefined' ? undefined : location.origin },
      );
      if (error) fail('attach email', error);
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) fail('sign out', error);
    },

    async getProfileName() {
      const uid = await userId();
      const { data, error } = await client
        .from('profiles')
        .select('display_name')
        .eq('id', uid)
        .maybeSingle<{ display_name: string }>();
      if (error) fail('read profile', error);
      return data?.display_name ?? null;
    },

    async setProfileName(name) {
      const uid = await userId();
      const display = name.trim().slice(0, 24);
      if (!display) return; // the table requires 1 to 24 characters
      const { error } = await client.from('profiles').upsert({ id: uid, display_name: display });
      if (error) fail('save profile', error);
    },

    async listPuppets() {
      const { data, error } = await client
        .from('puppets')
        .select(PUPPET_COLUMNS)
        .order('updated_at', { ascending: false })
        .returns<PuppetDbRow[]>();
      if (error) fail('list puppets', error);
      return (data ?? []).map(toRow);
    },

    async uploadPuppet(p) {
      const uid = await userId();
      const id = p.id ?? crypto.randomUUID();
      const blobs: Record<Kind, Blob> = { head: p.head, sock: p.sock, sword: p.sword };
      for (const kind of KINDS) {
        const { error } = await client.storage
          .from(BUCKET)
          .upload(path(uid, id, kind), blobs[kind], { upsert: true, contentType: 'image/png' });
        if (error) fail(`upload ${kind}`, error);
      }
      const fields = {
        name: p.name.trim().slice(0, 32) || 'Puppet',
        head_path: path(uid, id, 'head'),
        sock_path: path(uid, id, 'sock'),
        sword_path: path(uid, id, 'sword'),
      };
      // With an id this updates that row (the trigger bumps updated_at); without one it inserts.
      const query = p.id
        ? client.from('puppets').update(fields).eq('id', id)
        : client.from('puppets').insert({ id, ...fields });
      const { data, error } = await query.select(PUPPET_COLUMNS).single<PuppetDbRow>();
      if (error) fail('save puppet', error);
      return toRow(data);
    },

    async downloadPuppet(id) {
      const uid = await userId();
      const { data: row, error } = await client
        .from('puppets')
        .select(PUPPET_COLUMNS)
        .eq('id', id)
        .single<PuppetDbRow>();
      if (error) fail('read puppet', error);
      const out: Partial<Record<Kind, Blob>> = {};
      for (const kind of KINDS) {
        const { data, error: e } = await client.storage.from(BUCKET).download(path(uid, id, kind));
        if (e || !data) fail(`download ${kind}`, e);
        out[kind] = data;
      }
      return { row: toRow(row), head: out.head as Blob, sock: out.sock as Blob, sword: out.sword as Blob };
    },

    async deletePuppet(id) {
      const uid = await userId();
      const { error: e1 } = await client.storage.from(BUCKET).remove(KINDS.map((k) => path(uid, id, k)));
      if (e1) fail('delete drawings', e1);
      const { error } = await client.from('puppets').delete().eq('id', id);
      if (error) fail('delete puppet', error);
    },
  };
}
