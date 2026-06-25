# Airtable Reset Plan

Full wipe of Supabase + re-import from an updated Airtable base.
Run this once the app is feature-complete (or close to it).

**Reflects the 2026-06-23 style-model rework** (single formality 1–6, clean-slate
schema prune). Read `../STYLE_MODEL.md` first — this doc just operationalizes it.

---

## Overview

1. **Update Airtable** — add/clean columns, fill enriched data, swap in better photos
2. **Update the schema** — run the clean target `schema.sql` (drops dead columns)
3. **Wipe Supabase** — clear all tables + Storage bucket
4. **Update migration scripts** — `formality` field, dropped fields, taxonomy
5. **Re-run import** — items → wears → outfits
6. **Verify**

---

## Step 1 — Update Airtable schema

Fill these columns in the **Clothing** (active) and **Archived** tables. Airtable
lets you bulk-fill with formulas or CSV paste; do both tables.

### The one big change: `Formality` (single number 1–6)

Replaces the old `Min Occasion` / `Max Occasion` range. **One number per item.**

| # | Label | Example pieces |
|---|---|---|
| 1 | Function | gym/activewear (Workout items) |
| 2 | Very Casual | basic tees, hoodies, sweat sets, athleisure, sneakers |
| 3 | Everyday Casual | jeans, graphic tees, casual dresses, chinos, fashion sneakers, flats |
| 4 | Smart Casual | blazers, nicer dresses, polished denim, blouses, heels/loafers |
| 5 | Dressed Up | suits, structured dresses, cocktail attire, dress shoes |
| 6 | Formal | gowns, tuxedos, formalwear |

> Assess the *specific piece* (fabric + cut), not just the garment type — plain
> black pants can be a 2 (casual) or a 5 (dress trousers). When unsure, the app
> seeds a guess from category/subcategory you can confirm in Closet Review.

### Full column list

| Column (in Airtable) | Type | Values / notes |
|---|---|---|
| `Name` | text | required |
| `Category` | single select | Tops, Bottoms, Dresses, Outerwear, Shoes, Workout |
| `Subcategory` | single select | see taxonomy below |
| `Brand` | text | |
| `Retailer` | text | where it was bought |
| `Color Family` | single select | Green, Teal, Blue, Purple, Maroon, Pink, Red, Orange, Yellow, Beige, Brown, White, Gray, Black, Metallic |
| `Formality` | number | **1–6** (see scale above) |
| `Acquisition` | single select | New, Secondhand, Gift |
| `Size` | text | e.g. S, M, 6, 8.5 |
| `Fabric` | multi-select | Cotton, Linen, Silk, Wool, Cashmere, Polyester, Nylon, Rayon, Denim, Leather, Knit, Velvet, Chiffon |
| `Season` | multi-select | Spring, Summer, Fall, Winter, Year-round |
| `Status` | single select | Available, Storage, Archive |
| `Purchase Price` | number | |
| `Date Acquired` | date | |
| `Date is Guess` | checkbox | check if the purchase date is approximate |
| `Tags` | multi-select / text | optional |
| `URL` | text | product link |
| `Order #` | text | optional |
| `Receipt` | attachment / text | optional |
| `Official Item Name` | text | optional |
| `Notes` | long text | optional |
| `Picture` | attachment | first attachment is used |

### Subcategory values by category (taxonomy — unchanged)

- **Tops:** Tee shirts, Graphic tees, Long-sleeve tees, Sleeveless, Blouses, Sweaters, Cardigans, Sweatshirts
- **Bottoms:** Jeans, Pants, Shorts, Skirts, Leggings/Joggers, Tights
- **Dresses:** Casual dresses, Work dresses, Cocktail dresses
- **Outerwear:** Blazers, Jackets, Coats
- **Shoes:** Boots, Sandals, Flats, Heels, Sneakers
- **Workout:** Workout tops, Active shorts, Sports bras

### Columns being RETIRED (do not fill — dropped from the schema)

`Min Occasion`, `Max Occasion` (→ replaced by `Formality`), and the never-used v25
fields: availability/laundry, care, needs repair, needs tailoring, storage location,
fit, length, rise, original/retail price. Leave them out of the refresh.

---

## Step 2 — Replace photos in Airtable

The script downloads photos from Airtable attachment URLs, resizes to 1200px max
edge, and uploads to Supabase Storage. Just replace the `Picture` attachment.

- JPEG / PNG / WebP / HEIC all handled; first attachment only; higher-res is fine
  (downscaled). Transparent PNG/WebP keep transparency.

---

## Step 3 — Bulk-fill order (most impactful first)

1. **Status** — mark Storage/Archive items
2. **Color Family** — single value per item
3. **Subcategory** — match the canonical names exactly
4. **Formality** — the 1–6 number for each item
5. **Acquisition** — New / Secondhand / Gift
6. **Size**, then **Fabric**, then **Season** (leave Season blank for year-round)

> Anything left blank can be filled later in-app via **Closet Review** (the
> deal-one-card-at-a-time gap filler), which seeds a `Formality` guess from the
> item's category/subcategory.

---

## Step 4 — Run the clean schema

Before wiping data, run the updated `../schema.sql` in the Supabase SQL editor. The
refreshed schema:
- replaces `min_occasion`/`max_occasion` with `formality smallint check (between 1 and 6)`
- drops the dead columns (availability, care, needs_repair, needs_tailoring,
  storage_location, fit, length, rise, price_original) and the `events` table
- adds `wears.formality_for` (1–6, nullable), `outfits.rating` (nullable), and the
  `exclusions` table (negative pairs) — all app-captured, not imported

---

## Step 5 — Wipe Supabase

Run in the SQL editor, in FK-safe order:

```sql
DELETE FROM outfit_items;
DELETE FROM capsule_items;
DELETE FROM exclusions;
DELETE FROM wears;
DELETE FROM outfits;
DELETE FROM capsules;
DELETE FROM items;
```

Then wipe Storage (dashboard → Storage → wardrobe → select all → Delete, or):

```sql
DELETE FROM storage.objects WHERE bucket_id = 'wardrobe';
```

---

## Step 6 — Update migration scripts

### `import.py`
- **Map `Formality` → `items.formality`** (single int, clamp 1–6). Remove the old
  `Min Occasion`/`Max Occasion` reads and the `remap_occ` +1 offset entirely.
- **Drop** the dead-field reads (availability/care/fit/length/rise/etc.) — they no
  longer exist in the schema.
- Verify field-name reads match the Airtable columns confirmed in Step 1
  (`Color Family`, `Formality`, `Date Acquired`, `New vs Secondhand`/`Acquisition`).
- `TAXONOMY` is unchanged. If Airtable subcategory values match the canonical names,
  `SUBCAT_MAP` can be simplified/removed.
- **Archived table:** decide whether to keep a separate Archived table or use the
  `Status` field on one table; update the fetch accordingly.

### `import_wears.py` / `import_outfits.py`
Read the Airtable **Dates** / **Outfits** tables — no changes expected unless those
structures changed. The name→item matcher still re-links by normalized name (new
UUIDs, same names). `wears.context`, `wears.formality_for`, `outfits.rating` are left
null on import (captured in-app over time).

---

## Step 7 — Re-run imports

```bash
cd migration
python3 import.py            # dry run → review.json
python3 import.py --live     # ~476 items
python3 import_wears.py --live    # ~3,995 wears
python3 import_outfits.py --live  # ~1,543 outfits + outfit_items + wear back-links
```

---

## Step 8 — Verify

In the app:
- [ ] Item count looks right; photos load on cards + detail
- [ ] Wear counts non-zero; calendar shows historical wears; Looks shows past outfits
- [ ] Stats KPI cards have data; closet-vs-life gap renders
- [ ] Spot-check a few items: color_family, subcategory, **formality** look right
- [ ] Closet + Looks filters work

In Supabase:
```sql
SELECT COUNT(*) FROM items;
SELECT COUNT(*) FROM wears;
SELECT COUNT(*) FROM outfits;
SELECT COUNT(formality) FROM items WHERE formality IS NOT NULL;
SELECT COUNT(image_path) FROM items WHERE image_path IS NOT NULL;
```

---

## Notes

- **Wears/outfits come from the Airtable Dates/Outfits tables**, not the clothing
  tables — historical history is preserved as long as those are intact.
- **Photos re-upload fresh** (new Storage paths/UUIDs); old files are gone after the wipe.
- **Run wipe + re-import in one session** — the app has no data in between.
- **Hard-refresh** the app (Cmd+Shift+R) after re-import.
- **`review.json`** from the dry run lists items with mapping problems — fix in
  Airtable before the live run.
