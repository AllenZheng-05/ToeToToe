# Data, accounts and privacy

## Accounts and saved designs (Supabase)

I create the Supabase project myself. You cannot log in to it. Prepare everything so I only have to paste keys and run migrations:

- SQL migrations in `supabase/migrations/`, a `.env.example` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and `docs/SUPABASE.md` with the exact setup steps.
- **The game must run fully with no environment variables set**: presets, browser-saved drawings, browser-saved songs, and matches all work. Supabase only adds saving across devices.

| Table | Holds |
|---|---|
| `profiles` | id (the auth user), display name, created date |
| `puppets` | id, owner, puppet name, the three drawings, created date |
| `combos` (later; create no table yet) | owner, name, the pattern as beats and positions |

- **Guest first.** Use anonymous sign-in so a player can save without signing up, and let them attach an email to the same account later.
- **Owner-only access** through row-level security on every table and on the storage bucket for drawings.
- **Collect little.** A display name is all a profile holds.
- **Sleeping database.** The free plan pauses a project after about a week of low activity. Treat an unreachable database as normal: fall back to local data without an error screen.

Free plan figures seen in November 2026: 500 MB database, 1 GB file storage with a 50 MB cap per file, 50,000 monthly users.

## Song storage

- **Storage.** The file, tempo and offset are kept in IndexedDB on the uploader's device.
- **Not in Supabase.** Planning advice was to keep audio files out of the database: the free plan's storage and download allowances are small, it pauses when idle, and storing people's uploaded music on my project makes me the one distributing it. Put songs behind a `TrackSource` interface so a remote source can be added if I decide otherwise.

## Privacy and safety

- Ask for nothing but a display name. Say plainly, where a song is uploaded, that it stays on the player's device and is sent only to the friend in the room.
- Drawings and songs from the other player are untrusted files: accept only the expected image and audio types within the size limits, and decode them with the browser's own decoders.
- A strict Content-Security-Policy: scripts from our own origin only; connections limited to the handshake network and, when configured, my Supabase project.
