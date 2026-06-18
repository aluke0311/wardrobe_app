# CLAUDE.md — Wardrobe App

Guidance for working in this repo. Read alongside `README.md`.

## What this is

A personal, single-user wardrobe tracker. **The entire app is one file:
`index.html`** (HTML + CSS + JS inline). No build step, no framework, no
bundler, no JS libraries, no CDN scripts. It talks to Supabase using the **REST
API and Storage API via plain `fetch`** — do **not** add supabase-js or any
library. If something seems to need a library, ask the user first.

## Hard constraints (do not break)

- Keep it a single `index.html`. No external JS/CSS assets, no `<script src>`.
- Plain `fetch` only for all Supabase calls.
- Mobile-first; the user mostly uses this on a phone and takes photos with it.
- Only the publishable (anon) key ever appears in client code — it's safe to
  ship because RLS scopes everything to the signed-in user. The **secret key
  must never** be added or committed.

## Architecture (inside `index.html`)

Top-of-`<script>` config, then logically grouped sections:

- **CONFIG** — `SUPABASE_URL`, `SUPABASE_KEY`, `BUCKET`, `APP_VERSION`,
  `CATEGORIES`, `PALETTE`, image/encode constants.
- **SESSION** — `store` is a safe wrapper that probes `localStorage` once and
  falls back to an in-memory Map if storage is blocked (e.g. `data:` URLs).
  Always go through `store` / `saveSession` / `loadSession`, never raw
  `localStorage`.
- **FETCH HELPERS**
  - `authRequest(grant, body)` → Supabase Auth token endpoint (sign in / refresh).
  - `api(path, opts)` → core authed fetch; adds `apikey` + `Authorization`
    bearer; **transparently refreshes the token once on 401**, then retries.
  - `rest(path, opts)` → PostgREST wrapper over `api`, returns parsed JSON.
  - `uploadPhoto` / `deletePhoto` / `signedUrl` → Storage; photos are private so
    display uses **signed URLs** (cached in `_urlCache`).
- **IMAGE COMPRESSION** — `compressImage(file)`: canvas downscale to 1200px max
  edge, encode WebP at q0.82, fall back to JPEG if the browser can't encode WebP.
- **STATE + DERIVED** — `items`, `wears` arrays loaded once via `loadData()`;
  helpers `wearCount`, `lastWorn`, `costPerWear`, `daysSince`, `money`, `esc`.
- **RENDER** — `renderCloset`, `openItem` (detail sheet), add-item form,
  log-wear, `renderStats`. Lists are built as HTML strings; **always `esc()`
  user-supplied values** when interpolating into HTML.
- **TABS + WIRING** — `switchTab`, `refreshViews`, `wireEvents`, `init()` (IIFE
  at the bottom that boots the app).

## Data model

- `items`: id, user_id, name, category, brand, colors (text[]), price (numeric),
  purchase_date, purchase_place, notes, image_path, archived (bool), created_at.
- `wears`: id, user_id, item_id, worn_on, occasion, created_at. One row per wear.
- `user_id` defaults to `auth.uid()` server-side, so the client never sends it.
- Photos: private `wardrobe` bucket, path `<user_id>/<uuid>.webp`. RLS keys off
  the first path segment matching `auth.uid()`.

## Conventions

- **`APP_VERSION`** (date string) is shown in the UI — bump it to the current
  date on each meaningful change. Currently `2026-06-17`.
- Match the surrounding code's comment density; comment non-obvious logic only.
- Fixed product choices (categories, color palette, cost-per-wear headline) are
  `CATEGORIES` / `PALETTE` constants — change them there.

## Known gotchas / lessons

- **`localStorage` in restricted contexts**: opening the file from a `data:` URL
  (some preview surfaces) throws "Storage is disabled". The `store` wrapper
  handles this — never touch `localStorage` directly. On GitHub Pages (real
  `https://`) it works normally and the session persists.
- **WebP encode support**: `canvas.toBlob(..., 'image/webp')` silently returns a
  PNG on browsers that can't encode WebP, so `compressImage` checks
  `blob.type === 'image/webp'` and falls back to JPEG. Keep that check.
- **Private photos need signed URLs** — you can't use a public bucket URL.
- GitHub Pages caches aggressively; hard-refresh after deploy.

## Deploy

Commit `index.html` → push to `origin/main` → Pages deploys in ~1–2 min. See the
`deploy-wardrobe` skill. Repo: aluke0311/wardrobe_app. Live:
https://aluke0311.github.io/wardrobe_app/

## Local preview

`.claude/launch.json` runs `python3 -m http.server 4173` for the Claude preview
panel. Note: auth/data only fully work against the real `https://` deploy or any
non-`data:` origin; the in-memory session fallback applies otherwise.
