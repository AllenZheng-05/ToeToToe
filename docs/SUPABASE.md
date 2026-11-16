# Supabase setup

Supabase is optional. The game runs fully without it; it only adds saving puppets across devices.

## Steps

1. Create a project at supabase.com on the free plan. Pick a region near you and save the database password somewhere safe (the game does not use it).
2. Enable anonymous sign-ins: Authentication, then Sign In / Providers (or Settings), then turn on "Allow anonymous sign-ins". Anonymous sign-ins can be abused to create many accounts, so also turn on CAPTCHA (Authentication, Attack Protection) if you see junk accounts, and check the sign-in rate limits under Authentication, Rate Limits. Menu names change; check them against the dashboard.
3. Run the migration `supabase/migrations/20261116000000_init.sql`, either way:
   - SQL editor: open SQL Editor, New query, paste the whole file, Run.
   - CLI: `supabase link --project-ref <ref>` then `supabase db push`.
4. Copy the Project URL and the anon (publishable) key from Project Settings, then API (or "API Keys"). Never use the service role key.
   - Development: copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
   - Production: add the same two variables to the Cloudflare Pages build environment variables, then redeploy.
5. Authentication, URL Configuration: set the Site URL to `https://toetotoe.allenzheng.com` and add it (and `http://localhost:5173` for development) to the redirect URLs. This is needed when a guest attaches an email.
6. Content-Security-Policy: add the project to `connect-src`, for example `https://<ref>.supabase.co wss://<ref>.supabase.co`, alongside the existing entries.
7. Check it works: run `pnpm dev`, save a puppet, then in the dashboard confirm a row in Table Editor, `puppets`, a user under Authentication, Users (marked anonymous), and three PNGs in Storage, `puppets`, under `<user id>/<puppet id>/`. Also confirm the bucket is private with a 512 KB limit.

## What is stored

- A display name per account.
- Three PNG drawings per saved puppet (head, sock piece, sword), plus the puppet name and file paths.
- Nothing else. Songs are never uploaded; they stay in the player's browser.

## Guest-first accounts

The game signs players in anonymously (`signInAnonymously()`), so they can save without signing up. Later they can attach an email to the same account with `updateUser({ email })`, keeping their puppets. Anonymous users have the `authenticated` database role, so the same owner-only policies cover them.

## Sleeping database

The free plan pauses a project after about a week of low activity. The game treats an unreachable database as normal: it falls back to browser storage (IndexedDB) with no error screen. To wake a paused project, press Restore in the dashboard.

## Free plan figures (seen November 2026)

- 500 MB database
- 1 GB file storage, 50 MB cap per file (the bucket sets its own 512 KB cap)
- 50,000 monthly active users

Check current limits on the Supabase pricing page.

## Adding the `combos` table later

Create a new migration, never edit the init one: `supabase migration new combos` (or a file named `<timestamp>_combos.sql` in `supabase/migrations/`). Model it on `puppets`:

- `id uuid primary key default gen_random_uuid()`
- `owner uuid not null references auth.users(id) on delete cascade default auth.uid()`
- `name text not null` with a length check
- `pattern jsonb not null` (beats and positions; positions are fractions 0..1)
- `created_at`, `updated_at`, an index on `owner`, the `set_updated_at` trigger, row-level security, and owner-only policies granted to `authenticated`.

Then run it the same way as step 3.
