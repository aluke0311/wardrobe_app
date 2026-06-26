# Wardrobe App

A personal, single-user wardrobe tracker. Photograph clothing, track details,
log every wear, build outfits, plan capsules, and see stats like cost-per-wear
and formality coverage.

**Status:** Live. 476 items + 4,000 historical wears. — _2026-06-25 r6_

Live: https://aluke0311.github.io/wardrobe_app/  
Repo: https://github.com/aluke0311/wardrobe_app

**New to the app?** See the [User Manual](USER_MANUAL.md) for a screen-by-screen walkthrough.

---

## Features

**5 tabs:** Home · Closet · Looks · Calendar · Stats  
**Capsules** accessible from the Home tile grid.

- **Closet** — status lens (Available/Storage/Archive/All) → category folders →
  subcategory → item grid (2–5 col density). Tap an item: full photo view + edit
  view. Prev/next arrow through subcategory. Bulk select/edit/delete. Search with
  6 filter rows.

- **Add / Edit Item** — photo (camera or library, compressed to WebP), name,
  category→subcategory, color family, formality (1–6: Function→Formal), brand,
  retailer, price, season, fabric, size, acquisition, notes, status.

- **Looks** — outfit library with lens switcher (Formality/Season/Recent/All).
  Formality derived from piece heuristics; override per-look. Build-a-look canvas:
  drag and resize pieces, save arrangement. Active-capsule mode scopes to wearable
  looks from that set.

- **Outfit Suggestions** — slot-filling engine (Top/Dress + Bottom + Shoes +
  optional Outerwear). Scores by formality cohesion, color co-occurrence, and
  rotation. Weighted-random variety on every call. Capsule-scoped mode limits
  candidates to a capsule's items. Feedback: mark items "don't suggest" or add
  item-pair exclusions.

- **Capsules** — named item sets (Capsule or Trip). Trip mode: packing checklist +
  Open-Meteo weather strip per location and date range. "Plan outfits from this"
  scopes Closet + Looks tabs to just those items. "Suggest outfit" from capsule
  members only. Rename/Duplicate/Share list.

- **Calendar** — month grid with mini outfit collages; day view with swipe
  copy/move/delete. Log clothing or a saved look for any date.

- **Style Stats** — Clothing Stats (count, value, color bar, field breakdowns with
  donut), Looks Stats, smart lists (most/least worn, cost-per-wear, recently
  acquired), closet-vs-life formality gap. Filter by status/category/season/
  formality + date range. Closet Review: one card at a time to fill missing fields
  with inline chip pickers.

---

## Architecture

**One file.** The entire app is `index.html` (~6,950 lines). HTML + CSS + JS inline.
No build step, no framework, no bundler, no CDN, no JS libraries. Plain `fetch` for
all network calls.

**Backend: Supabase (free tier).** Auth, REST (PostgREST), and Storage.

- Publishable (anon) key only in client code — safe because RLS scopes all rows
  to `auth.uid()`. **Secret key must never be committed.**
- `schema.sql` in the repo root is the canonical DB definition.
- Migrations run by the user in the Supabase SQL editor.

**Photos:** private `wardrobe` bucket, path `<user_id>/<uuid>.<ext>`. Display via
signed URLs. Lazy-loaded in grids via IntersectionObserver.

---

## Data model

Six tables, all RLS-scoped to `auth.uid()`. Full definition in `schema.sql`.

| Table | Key columns |
|---|---|
| `items` | name, category, subcategory, brand, retailer, color_family, price, purchase_date, formality (1–6), status, season[], fabric[], tags[], image_path |
| `wears` | item_id, outfit_id (nullable), worn_on, context, formality_for |
| `outfits` | name, context, notes, formality_override, layout (JSONB), rating; join: `outfit_items` |
| `capsules` | name, kind, start_date, end_date, notes, locations (JSONB); join: `capsule_items(packed bool)` |
| `exclusions` | item_a, item_b, reason — pairs that shouldn't appear together in suggestions |

---

## Product decisions (locked)

- **Personal, single-user only.** No social, no sharing, no multi-user.
- **Heuristics only — no AI.** Client ships only the anon key; no server proxy.
  Open-Meteo (keyless) is the only allowed external data call.
- **Derive-first, capture-light.** Compute from logged data before adding captured fields.
- **Mobile-first.** The user primarily uses this on a phone.

---

## Deploy

```
git add index.html && git commit -m "…" && git push origin main
```

GitHub Pages rebuilds in ~1–2 min. Hard-refresh (`Cmd+Shift+R`) to clear cache.
Use the `deploy-wardrobe` skill from Claude Code.

**`APP_VERSION`** format: `YYYY-MM-DD rN` (same day → increment N). Shown in UI.

---

## Development

No build step. Edit `index.html`, preview with:

```
python3 -m http.server 4173
```

Auth/data only fully work against the live `https://` deploy. Use `preview_eval`
to inspect state via the Claude Code preview panel.

See [CLAUDE.md](CLAUDE.md) for full architecture details, code conventions, and known gotchas.
