# Deployment

Target: `https://toetotoe.allenzheng.com`, a static site (the `dist/` folder from `pnpm build`) with a single-page fallback so room links such as `/ROW-G-12` and `/?room=ROW-G-12` resolve.

Facts: `allenzheng.com` is owned by Allen and its DNS is hosted on Cloudflare (confirmed 16 Nov 2026). The repo is `AllenZheng-05/ToeToToe`. Nothing has been pushed or deployed. pnpm 10 (pinned by `packageManager` in `package.json`), Node 22, build command `pnpm build`, output directory `dist`.

Files in this repo that the host reads: `public/_headers` (security and cache headers) and `public/_redirects` (single-page fallback). Vite copies everything in `public/` into `dist/`.

Dashboard wording changes often. Anything marked "check against the current dashboard" may be named differently.

## 1. Before the first deploy

1. Make sure the working tree is committed and that these pass locally: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
2. Create an empty repository `ToeToToe` under the GitHub account `AllenZheng-05` (no README, no licence, so nothing conflicts). The repo has no licence file by choice.
3. Push: `git remote add origin https://github.com/AllenZheng-05/ToeToToe.git`, then `git push -u origin main`.
4. CI (`.github/workflows/ci.yml`) runs on every push and pull request: install with `pnpm install --frozen-lockfile`, then `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Check the Actions tab shows green. CI does not run the Playwright test and does not deploy.
5. Check `docs/ASSETS.md` ("Before launch") before making the site public.

## 2. Cloudflare Pages (the plan)

### Create the project

1. Sign in to the Cloudflare dashboard. Go to Workers & Pages, Create, then the Pages tab, then "Connect to Git" (check against the current dashboard; see section 3 if Pages is hidden).
2. Authorise the Cloudflare GitHub app for `AllenZheng-05/ToeToToe` only, and select the repo.
3. Production branch: `main`.
4. Build settings:
   - Framework preset: None (or Vite; both work as long as the two values below are set).
   - Build command: `pnpm build`
   - Build output directory: `dist`
   - Root directory: leave empty.
5. Environment variables (Settings, Variables and Secrets, or the build settings screen):
   - `NODE_VERSION` = `22` (Pages defaults to an older Node otherwise; the repo needs 22.12 or newer, so `22` resolves to the latest 22.x; if the build complains, use `22.12.0`).
   - pnpm: Pages detects `pnpm-lock.yaml` and installs pnpm itself. The `packageManager` field in `package.json` pins the version. If the build log shows the wrong pnpm, add `PNPM_VERSION` = `10.34.6` (check against the current dashboard and build image notes).
6. Optional variables, all only needed if you use that feature. The game runs with none of them:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`: cross-device saving (see `docs/SUPABASE.md`). Anon key only, never the service role key.
   - `VITE_NET_STRATEGY`: handshake network; only `nostr` exists.
   - `VITE_NET_RELAYS`: comma-separated `wss://` relay URLs to replace Trystero's defaults.
   - `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`: a TURN relay for players behind strict NAT.
   - Vite bakes every `VITE_*` value into the JavaScript at build time. After adding or changing one, trigger a new build (Deployments, the latest one, Retry deployment, or push a commit). Changing it without rebuilding does nothing. These values are visible to anyone who opens the site, so never put a secret in them; a TURN credential here is public too, so use a limited or short-lived one.
7. Press Save and Deploy. The first build gives a `https://<project>.pages.dev` address. Open it and run the checks in "Check the deploy" below before adding the domain.

### Add the custom domain

1. Open the project, Custom domains, Set up a custom domain.
2. Enter `toetotoe.allenzheng.com` and continue.
3. Because the `allenzheng.com` zone is on the same Cloudflare account, Cloudflare offers to create the DNS record for you: a proxied CNAME `toetotoe` pointing to `<project>.pages.dev`. Accept it (Activate domain). Do not create the record by hand unless asked to.
4. Wait for the status to change from Initializing/Pending to Active. A certificate is issued automatically; this usually takes a few minutes, occasionally longer.
5. HTTPS: in the zone, SSL/TLS, the mode should not be "Flexible" (Pages needs Full or Full (strict), and the default for new setups is fine). Optionally turn on Edge Certificates, "Always Use HTTPS" (check against the current dashboard).
6. Open `https://toetotoe.allenzheng.com`.

### How the fallback and headers work

- `public/_redirects` contains `/*  /index.html  200`. A request for a path with no matching file (a room link) is answered with `index.html` and status 200, and the app reads the room code from the URL. Real files (`/assets/*`, `/tracks/*`) are served as they are. Pages also falls back to `index.html` on its own when there is no `404.html`; the file makes it explicit. A mistyped file URL under `/assets/` therefore returns the HTML page instead of a 404, which is expected.
- `public/_headers` sets the Content-Security-Policy and companions on every path, no-cache on `/` and `/index.html`, a one-year immutable cache on `/assets/*` (Vite names these with content hashes, so a new build means new names), and a one-hour cache on `/tracks/*` (names are not hashed). Both files are read from the root of the build output, so they only work if they end up in `dist/`; they do, because they live in `public/`.
- `_headers` applies to files served by Pages. Headers for a fallback response come from the rules matching the requested path, so `/*` covers room links.

### Preview deployments

Every branch and pull request other than `main` gets its own address `https://<hash>.<project>.pages.dev` (and a branch alias). The same `_headers` and `_redirects` apply. Variables can be set separately for Preview and Production in Settings, Variables and Secrets. Preview pages are public by default; Access policies can restrict them (check against the current dashboard).

### Check the deploy

1. Open `https://toetotoe.allenzheng.com/ROW-G-12` and `https://toetotoe.allenzheng.com/?room=ROW-G-12` (a made-up room). Both must show the game, not a 404.
2. Response headers: browser dev tools, Network, click the document request, Headers. Confirm `content-security-policy`, `x-content-type-options`, `referrer-policy`, `permissions-policy`. Or run `curl -sI https://toetotoe.allenzheng.com/`. Also check `curl -sI` of one `/assets/` file shows `cache-control: public, max-age=31536000, immutable`.
3. Dev tools Console: there must be no "Refused to ..." messages (those are CSP blocks).
4. Play the bot match from the title screen to the end. This checks fonts, the stage art, audio and the beat grid.
5. Upload a song in the battle theme picker. This checks the beat detector's worker (needs `worker-src blob:`).
6. Create a room in one browser, join by link in another (a private window or another device, ideally on a different network). Both players should see each other and the duel should start.

## 3. Cloudflare Workers static assets (alternative)

Cloudflare now steers new projects toward Workers with static assets, and the Pages option may be tucked away. The equivalent is a Workers project connected to the same GitHub repo, with build command `pnpm build` and a deploy configuration like this in a `wrangler.jsonc` at the repo root (this file is not in the repo; add it only if you go this way):

```jsonc
{
  "name": "toetotoe",
  "compatibility_date": "2026-11-16",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

Check against the current dashboard and the Cloudflare docs for the deploy command (usually `npx wrangler deploy`), the build settings screen and how custom domains are attached (Settings, Domains and Routes). `_headers` is supported by Workers static assets; `_redirects` is not needed because `not_found_handling` does the fallback. The CSP, domain and checks in section 2 are otherwise the same.

## 4. GitHub Pages (alternative)

What would change:

- No custom headers, so the CSP in `public/_headers` is ignored. Put the same policy in a `<meta http-equiv="Content-Security-Policy" content="...">` tag in `index.html`. `frame-ancestors` is ignored in a meta tag, and the other headers (nosniff, referrer, permissions) cannot be set.
- No `_redirects`. Add a build step that copies `dist/index.html` to `dist/404.html` so unknown paths load the app (GitHub serves it with status 404, which works in browsers but is not a clean 200).
- Cache headers cannot be set.
- DNS: in Cloudflare DNS add a CNAME `toetotoe` pointing to `allenzheng-05.github.io`, with the proxy switched off (grey cloud, "DNS only"). Then set the custom domain in the repo's Settings, Pages, and tick Enforce HTTPS once the certificate is ready.
- Add a GitHub Actions workflow that builds and publishes `dist` with `actions/upload-pages-artifact` and `actions/deploy-pages`, and set Pages source to "GitHub Actions". Pin action versions as the CI file does.

## 5. If DNS were elsewhere

Create a CNAME record for `toetotoe` pointing to the Pages hostname (`<project>.pages.dev`) at that provider, then add `toetotoe.allenzheng.com` as a custom domain in the Pages project. Cloudflare then validates the record and issues the certificate.

## 6. The Content-Security-Policy, directive by directive

The policy is one line in `public/_headers`:

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' blob: data: wss: https://*.supabase.co wss://*.supabase.co; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'none'` | Anything not listed below is blocked. |
| `script-src` | `'self'` | Only our own bundled JavaScript. No inline scripts, no CDNs. Vite emits one module script and no inline script. There is deliberately no `'unsafe-eval'`; see "PixiJS" below. |
| `style-src` | `'self'` | Vite's production build writes CSS to a linked file, and the app changes styles through the DOM style API (`element.style.width = ...`, `style.setProperty`), which the CSP does not block. Only markup that carries a literal `style="..."` attribute, or an inline `<style>` element, would be blocked. The app does not do that. If a browser console shows "Refused to apply inline style", the narrowest fix is to add `style-src-attr 'unsafe-inline'` (it allows style attributes only, not `<style>` elements); only fall back to `style-src 'self' 'unsafe-inline'` if that is not enough. |
| `img-src` | `'self' blob: data:` | Stage art and bundled images from our origin. `blob:` for drawings (stored and received as Blobs). `data:` for the preset puppets, which are SVG images embedded as data URLs, and for any small images Vite inlines. |
| `font-src` | `'self' data:` | The three fonts are self-hosted by `@fontsource` and emitted as files in `dist/assets/`. `data:` covers a font Vite might inline. No Google Fonts. |
| `media-src` | `'self' blob:` | Audio element sources: bundled tracks, and an uploaded song as a blob. Decoding through Web Audio uses `fetch`, covered by `connect-src`. |
| `connect-src` | `'self' blob: data: wss: https://*.supabase.co wss://*.supabase.co` | `'self'`: loading `/tracks/*` and the manifest. `blob:` and `data:`: the app fetches blob and data URLs for drawings and songs. `wss:`: the Nostr relays Trystero uses for the handshake are arbitrary public `wss:` hosts (Trystero 0.27.0 picks several from a built-in list of dozens, and `VITE_NET_RELAYS` can override), so any `wss:` host must be allowed. This is the widest part of the policy; it only permits outgoing WebSocket connections and cannot load code. The Supabase entries are needed only if you set the Supabase variables; the game works without them. WebRTC data channels to the other player are not governed by `connect-src`. STUN (default `stun.cloudflare.com:3478` and others) and TURN are UDP/TCP traffic from the ICE agent and are not governed by it either. |
| `worker-src` | `'self' blob:` | `web-audio-beat-detector` builds its Web Worker from a string: it creates a `Blob`, calls `URL.createObjectURL` and starts the Worker from that `blob:` URL (see `node_modules/web-audio-beat-detector/build/es2019/factories/load-or-return-broker.js`). Without `blob:` here, tempo detection of an uploaded song fails (the app then falls back to 120 BPM and tap-along). |
| `manifest-src` | `'self'` | A web app manifest, if one is added. |
| `object-src` | `'none'` | No plugins. |
| `base-uri` | `'self'` | Stops an injected `<base>` tag redirecting relative URLs. |
| `form-action` | `'self'` | Forms can only submit to our own origin. |
| `frame-ancestors` | `'none'` | Nobody can embed the game in a frame (clickjacking). This directive works only as a header, not in a meta tag. |

### PixiJS needs `pixi.js/unsafe-eval`

PixiJS v8 compiles some shader and uniform code with `new Function`, which needs `'unsafe-eval'`. The policy above does not allow that, so the app must import the CSP-safe polyfill once, before creating the Pixi application:

```ts
import 'pixi.js/unsafe-eval';
```

The orchestrator is adding this import. If it is missing, the stage stays blank and the Console shows "Refused to evaluate a string as JavaScript because 'unsafe-eval'". Check this in the deploy checks. Do not add `'unsafe-eval'` to the policy as a shortcut.

### Changing the policy

- Adding Supabase: the wildcard `*.supabase.co` entries are already present, so nothing to change. To tighten, replace them with your project: `https://<ref>.supabase.co wss://<ref>.supabase.co`.
- Adding a TURN relay: set `VITE_TURN_URL` etc. No CSP change is needed, because ICE traffic is not governed by `connect-src`. If you later fetch TURN credentials from an HTTPS API, add that origin to `connect-src`.
- Using your own Nostr relays: you can replace `wss:` with the listed hosts (`wss://relay.example.com`) for a tighter policy, as long as `VITE_NET_RELAYS` names the same hosts.
- Editing `public/_headers` needs a new deploy. The CSP must stay on a single line.

## 7. After deploying

1. Supabase (only if you use it): set the Site URL and redirect URLs to `https://toetotoe.allenzheng.com` as described in `docs/SUPABASE.md`, step 5, and add the two `VITE_SUPABASE_*` variables to the Pages build (then redeploy).
2. Re-check the deploy checklist from section 2 on the final domain.

## 8. Troubleshooting

- Room links give a 404 page: `_redirects` is missing from `dist/` (check `dist/_redirects` exists after a build), or the project was created as a different type. Compare with the Workers option in section 3.
- Fonts missing, the stage blank, or buttons unstyled: open the Console and look for "Refused to ..." CSP messages. The message names the blocked directive and URL. A blank stage with an "unsafe-eval" message means the `pixi.js/unsafe-eval` import is missing.
- Old version still showing after a deploy: hard-reload. `index.html` is no-cache, so this should not persist; if it does, purge the cache in Cloudflare (Caching, Configuration, Purge Everything).
- Changed an environment variable and nothing happened: redeploy, since values are baked in at build time.
- Two players cannot connect, or connect on the same Wi-Fi but not across networks: a strict NAT or firewall is blocking the direct WebRTC link. Set `VITE_TURN_URL`, `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL` to a TURN relay and redeploy. Also check the Console for the relays failing: if all Nostr relays are unreachable, the handshake cannot happen (try another network, or set `VITE_NET_RELAYS`).
- Tempo detection never finishes on an uploaded song: `blob:` is missing from `worker-src`.
- Build fails on Pages but passes locally: check the Node version (`NODE_VERSION`) and that `pnpm-lock.yaml` is committed.
