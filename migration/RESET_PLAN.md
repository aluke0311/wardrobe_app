# Airtable → Supabase Reset Plan

Full wipe of Supabase + re-import from an updated Airtable base.
Run this once Airtable data is clean and the app is feature-complete.

---

## Overview

1. Set up the **"Wardrobe App" Airtable view** (exact field names + types)
2. Fill / re-score item data in Airtable (especially Formality 1–8)
3. Run `schema.sql` in Supabase to recreate the clean schema
4. Wipe Supabase tables + Storage
5. Run `import.py --live` → `import_wears.py --live` → `import_outfits.py --live`
6. Verify

---

## Step 1 — Airtable "Wardrobe App" view

Create a **Grid view** named exactly **"Wardrobe App"** on the **Clothing** table
(and mirror it on the Archived table). Show only these fields, in this order, with
these exact names and types. The import script reads fields by name.

| # | Field Name | Airtable Type | Options / Notes |
|---|---|---|---|
| 1 | **Name** | Single line text | Required |
| 2 | **Category** | Single select | Tops, Bottoms, Dresses, Outerwear, Shoes, Workout |
| 3 | **Subcategory** | Single select | See canonical list below |
| 4 | **Brand** | Single line text | |
| 5 | **Retailer** | Single line text | Where it was bought |
| 6 | **Color Family** | Single select | Green, Teal, Blue, Purple, Maroon, Pink, Red, Orange, Yellow, Beige, Brown, White, Gray, Black, Metallic |
| 7 | **Formality** | Multiple select | `1 · Function`, `2 · Very Casual`, `3 · Casual`, `4 · Polished Casual`, `5 · Smart Casual`, `6 · Dressed Up`, `7 · Business Professional`, `8 · Formal` |
| 8 | **Acquisition** | Single select | New, Secondhand, Gift |
| 9 | **Size** | Single line text | S / M / 8 / 8.5 etc. |
| 10 | **Fabric** | Multiple select | Cotton, Linen, Wool, Cashmere, Silk, Denim, Polyester, Spandex, Nylon, Fleece, Leather, Velvet |
| 11 | **Season** | Multiple select | Spring, Summer, Fall, Winter |
| 12 | **Status** | Single select | Available, Storage, Archive |
| 13 | **Purchase Price** | Currency (or Number) | |
| 14 | **Date Acquired** | Date | |
| 15 | **Date is Guess** | Checkbox | Check if the date is approximate |
| 16 | **Tags** | Multiple select | e.g. `no-suggest` |
| 17 | **URL** | URL | Product link |
| 18 | **Order #** | Single line text | |
| 19 | **Official Item Name** | Single line text | Exact retailer name |
| 20 | **Notes** | Long text | |
| 21 | **Picture** | Attachment | First attachment only; higher-res is fine |

### Subcategory canonical values (must match exactly)

- **Tops:** Tee shirts, Graphic tees, Long-sleeve tees, Sleeveless, Blouses, Sweaters, Cardigans, Sweatshirts
- **Bottoms:** Jeans, Pants, Shorts, Skirts, Leggings/Joggers, Tights
- **Dresses:** Casual dresses, Work dresses, Cocktail dresses
- **Outerwear:** Blazers, Jackets, Coats
- **Shoes:** Boots, Sandals, Flats, Heels, Sneakers
- **Workout:** Workout tops, Active shorts, Sports bras

### Formality options (exact option text for the multi-select)

Copy these exactly as option labels — the import script parses the leading number:

```
1 · Function
2 · Very Casual
3 · Casual
4 · Polished Casual
5 · Smart Casual
6 · Dressed Up
7 · Business Professional
8 · Formal
```

Each item gets all the levels where you'd say "yes, I could wear this here."
A wrap dress might be `3 · Casual`, `4 · Polished Casual`, `6 · Dressed Up`.
Heels: `6 · Dressed Up`, `8 · Formal`.
Blazer: `5 · Smart Casual`, `6 · Dressed Up`, `7 · Business Professional`.

---

## Step 2 — Re-score Formality in Airtable

Old scale was 1–6. New scale is 1–8 with different names. Rough mapping:

| Old (1–6) | Old name | New level(s) to consider |
|---|---|---|
| 1 | Function | 1 · Function |
| 2 | Very Casual | 2 · Very Casual |
| 3 | Everyday Casual | 3 · Casual |
| 4 | Smart Casual | 4 · Polished Casual AND/OR 5 · Smart Casual |
| 5 | Dressed Up | 6 · Dressed Up AND/OR 7 · Business Professional |
| 6 | Formal | 6 · Dressed Up AND/OR 8 · Formal |

The split at 4→4/5 and 5→6/7 is where most re-scoring happens:
- A blazer that was "4 Smart Casual" → now `5 · Smart Casual`, `6 · Dressed Up`, `7 · Business Professional`
- A cocktail dress that was "5 Dressed Up" → now `6 · Dressed Up`
- A tux that was "6 Formal" → now `8 · Formal`
- Items that can skip levels (heels, formal gown) → use the exact levels, not contiguous ranges

Items left blank in Airtable are fine — the app will impute from category/subcategory/name
and you can confirm in Closet Review after import.

---

## Step 3 — Fill other fields (priority order)

1. **Status** — mark Storage / Archive items
2. **Color Family** — single value per item
3. **Subcategory** — use canonical names from the list above
4. **Formality** — multi-select using the 1–8 options
5. **Acquisition** — New / Secondhand / Gift
6. **Size** (optional), **Fabric** (optional), **Season** (optional)

Anything left blank can be filled later in-app via Closet Review.

---

## Step 4 — Wipe Supabase + re-run schema

### 4a. Run clean schema

Open Supabase SQL editor → paste the contents of `../schema.sql` → run.
This drops + recreates all tables cleanly (uncomment the DROP lines at the top first).

### 4b. Wipe Storage

Dashboard → Storage → wardrobe bucket → select all files → Delete.
Or via SQL:
```sql
DELETE FROM storage.objects WHERE bucket_id = 'wardrobe';
```

---

## Step 5 — Run imports

```bash
cd migration

# Dry run first — check review.json for mapping problems
python3 import.py

# Fix anything in Airtable, then:
python3 import.py --live           # items + photos (~476 items)
python3 import_wears.py --live     # historical wears (~3,995)
python3 import_outfits.py --live   # outfits + outfit_items (~1,543)
```

### import.py behavior
- Reads Clothing table + Archived table
- Maps subcategory names using SUBCAT_MAP (handles legacy capitalisation)
- Parses `Formality` multi-select → `smallint[]` (e.g. `["1 · Function"]` → `[1]`)
- Downloads each photo → resizes to ≤1200px with macOS `sips` → uploads to Storage
- Dry run prints stats + writes `review.json` (items with mapping problems)

### What's NOT imported (captured in-app over time)
- `wears.context`, `wears.formality_for` — stamped at log time
- `outfits.rating` — stamped via feedback UI
- `exclusions` — built up via item detail / suggestion feedback
- capsule memberships

---

## Step 6 — Verify

In the app (hard-refresh first: Cmd+Shift+R):
- [ ] Item count looks right; photos load on cards + detail
- [ ] Wear counts non-zero; calendar shows historical wears; Looks tab has outfits
- [ ] Stats KPI cards have data; Closet vs. Life gap renders
- [ ] Spot-check a few items: color_family, subcategory, formality set look right
- [ ] Closet + Looks filters work; suggestion engine returns results

In Supabase SQL:
```sql
SELECT COUNT(*) FROM items;
SELECT COUNT(*) FROM wears;
SELECT COUNT(*) FROM outfits;
SELECT COUNT(*) FROM items WHERE formality IS NOT NULL;
SELECT COUNT(*) FROM items WHERE image_path IS NOT NULL;
-- Check a sample of formality arrays:
SELECT name, formality FROM items WHERE formality IS NOT NULL LIMIT 20;
```

---

## Notes

- **Run wipe + re-import in one session** — the app has no data in between.
- **Wears + outfits come from Airtable Dates/Outfits tables** (separate from Clothing).
  Historical history is preserved as long as those tables are intact.
- **Photos re-upload fresh** (new Storage paths/UUIDs); old files are gone after the wipe.
- **Hard-refresh** the app (Cmd+Shift+R) after re-import.
- **`review.json`** lists items with mapping problems — fix in Airtable before `--live`.
- **Table IDs** in `import.py` can be overridden in `.env` as `AIRTABLE_CLOTHING_TABLE`
  and `AIRTABLE_ARCHIVED_TABLE` if the base gets restructured.
