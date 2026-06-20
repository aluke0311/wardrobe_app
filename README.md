# Wardrobe App

A personal, single-user wardrobe tracker. Photograph clothing, track details,
log every wear, build outfits, plan capsules, and see stats like cost-per-wear,
most/least worn, and occasion coverage.

**Status:** Live and in active use. 476 items + 4,000 historical wears imported
from Airtable. — _v2026-06-19 v10_

Live: https://aluke0311.github.io/wardrobe_app/  
Repo: https://github.com/aluke0311/wardrobe_app

---

## Features

**7 tabs:** Closet · Log · Capsules · Calendar · Fill · Insights · Settings

- **Closet** — hierarchical category→subcategory folders with photo grid (2–4 col
  density). Filters: status (Available/Storage/Archive/Wishlist), search, sort,
  Neglected (not worn in 30d). Multi-select for batch status/tags/capsule/delete.
  Closet lens from an active capsule. Add item via ＋ button.
- **Add / Edit Item** — photo pick (camera or library, compressed to WebP), name,
  category→subcategory, color family, brand, retailer (with type-ahead from existing
  values), occasion range (1–7 formality ladder), purchase details, size, season,
  fabric, care, fit, length, rise, storage location, status, availability, tags, notes.
- **Log** — two modes (segmented): single-item wear (pick item, date, context,
  rating, compliments, note) and outfit wear (pick an outfit, date, rating). Date
  pre-fills from Calendar "log for this day" shortcut.
- **Capsules** — named item sets (capsule / packing / travel). Packing checklist
  (pack/✓ per item). Add-an-outfit-to-capsule. Active lens filters Closet to just
  that capsule's items.
- **Calendar** — month grid heat-shaded by wear count, event dots. Tap a day →
  wears grouped by outfit, inline notes, "Log wear/outfit for this day" + "Add
  event". Events (title, context, dress code, notes) stored in DB.
- **Fill** — one-at-a-time data entry: shows a random Available item with a
  randomly-chosen empty field; single-tap chip saves. Skip to get another item.
- **Insights** (Stats tab) — KPIs: item count, closet value, overall CPW, 1-yr
  utilization. Drill-downs with time-range filter + Best/Worst toggle: CPW, Most
  Worn, Wear Velocity, Never Worn, Best Purchases, Recency states. View Closet By
  (donut chart + bar list: color, brand, size, season, fabric, price). Occasion
  Coverage per context. All stats: Available items only.
- **Item detail sheet** — hero photo, KPIs (times worn / cost per wear / price
  paid / days in wardrobe), occasion range, color, full details card, outfit
  mosaic ("Used in N outfits"), "Wear it with" co-occurrence pairings, "Create
  outfit from this item" button, status + availability switchers.
- **Settings** — sign out, manual data refresh, app version.

---

## Architecture

**One file.** The entire app is `index.html` — HTML, CSS, and JS inline. No build
step, no framework, no bundler, no CDN, no JS libraries. Plain `fetch` for all
network calls.

**Backend: Supabase (free tier).** Auth, REST (PostgREST), and Storage.

- REST path: `https://ofwaxqrwbcixrnjkepuz.supabase.co/rest/v1/…`
- Publishable (anon) key only in client code — safe because RLS scopes all rows
  to `auth.uid()`. **Secret key must never be committed.**
- `schema.sql` in the repo root is the canonical DB definition. Migrations are
  run by the user in the Supabase SQL editor.

**Session:** `store` wrapper over `localStorage` (in-memory fallback for `data:`
URL contexts). Token refresh handled transparently in `api()`.

**Photos:** private `wardrobe` bucket, path `<user_id>/<uuid>.<ext>`. Display via
signed URLs (cached in `_urlCache`). Lazy-loaded in grids via IntersectionObserver.

---

## Data model

Five tables, all RLS-scoped to `auth.uid()` (client never sends `user_id`).
Full definition in `schema.sql`.

| Table | Key columns |
|---|---|
| `items` | name, category, subcategory, brand, retailer, color_family, price, price_original, purchase_date, date_is_guess, acquisition, size, fabric[], season[], min_occasion, max_occasion, status, availability, care[], needs_repair, needs_tailoring, fit, length, rise, storage_location, tags[], url, notes, image_path |
| `wears` | item_id, outfit_id (nullable), worn_on (date), context, rating (1–3), compliments, note |
| `outfits` | name, context, notes, image_path; join: `outfit_items(outfit_id, item_id)` |
| `capsules` | name, kind (capsule\|packing\|travel), start_date, end_date, notes; join: `capsule_items(capsule_id, item_id, packed bool)` |
| `events` | title, event_date, context, dress_code, planned_outfit_id, backup_outfit_id, notes |

**Fixed vocabularies (top-of-script constants):**
- `TAXONOMY` — category → subcategory list
- `COLOR_FAMILIES` — 15 named color families, each with a hex
- `OCCASION_LADDER` — 1 At-home · 2 Relaxed · 3 Casual · 4 Smart casual · 5 Professional · 6 Cocktail · 7 Formal
- `CONTEXTS` — 13 named wear occasions, each with a formality `min`/`max`
- `STATUSES` — Available · Storage · Archive · Wishlist
- `AVAILABILITY` — Ready · Laundry · Cleaners · Lent
- `RATINGS` — 3 Loved · 2 Fine · 1 Didn't work

---

## Product decisions (locked)

- **Personal, single-user only.** No social, no sharing, no multi-user.
- **Heuristics only — no AI.** Client ships only the anon key; no server proxy / Edge Function. Open-meteo (keyless) is the only allowed external data call.
- **Derive-first, capture-light.** Compute from logged data before adding new
  captured fields. Subjective data at moment-of-use only (wear rating).
- **Thumbnail outfits, no collage canvas.**
- **Mobile-first AND web-comfortable.** Same `index.html`, fluid/responsive.

---

## Deploy

```
git add index.html && git commit -m "…" && git push origin main
```

GitHub Pages rebuilds in ~1–2 min. Hard-refresh (`Cmd+Shift+R`) to clear cache.
Use the `deploy-wardrobe` skill from Claude Code.

**`APP_VERSION`** format: `YYYY-MM-DD vN` (same day → increment N). Shown in UI.

---

## Development

No build step. Edit `index.html`, preview with:

```
python3 -m http.server 4173
```

The preview loses its auth session on restart. Verify UI client-side by injecting
fixtures into the global `items`/`wears`/`outfits` arrays via `preview_eval`.

See `CLAUDE.md` for full architecture details, code conventions, and known gotchas.
