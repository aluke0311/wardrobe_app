# Airtable Reset Plan

Full wipe of Supabase + re-import from an updated Airtable base.
Run this once the app is feature-complete (or close to it).

---

## Overview

1. **Update Airtable** — add new columns, fill in enriched data, swap in better photos
2. **Wipe Supabase** — clear all tables and Storage bucket
3. **Update migration scripts** — adjust field mappings, remove the old occasion offset
4. **Re-run import** — items → wears → outfits
5. **Verify**

---

## Step 1 — Update Airtable schema

Add or update these columns in the **Clothing** (active) and **Archived** tables.
Airtable lets you bulk-fill with formulas or CSV paste; do both tables.

### New columns to add

| Column name (in Airtable) | Type | Values / notes |
|---|---|---|
| `Color Family` | Single select | Green, Teal, Blue, Purple, Maroon, Pink, Red, Orange, Yellow, Beige, Brown, White, Gray, Black, Metallic |
| `Min Occasion` | Number | 1–7 (new scale — see ladder below) |
| `Max Occasion` | Number | 1–7 |
| `Acquisition` | Single select | New, Secondhand, Gift |
| `Size` | Single line text | e.g. S, M, 6, 8.5 |
| `Fabric` | Multi-select | Cotton, Linen, Silk, Wool, Cashmere, Polyester, Nylon, Rayon, Denim, Leather, Knit, Velvet, Chiffon |
| `Season` | Multi-select | Spring, Summer, Fall, Winter, Year-round |
| `Status` | Single select | Available, Storage, Archive |
| `Subcategory` | Single select | see taxonomy below |
| `Retailer` | Single line text | (may already exist) |
| `Date is Guess` | Checkbox | check if purchase date is approximate |

**Formality ladder (1–7) for Min/Max Occasion:**
1 = At-home · 2 = Relaxed · 3 = Casual · 4 = Smart casual · 5 = Professional · 6 = Cocktail · 7 = Formal

> **Note on occasion scale:** the original Airtable had a 1–6 scale; the migration script did `+1` to shift it. For the reset, enter values on the **new 1–7 scale** directly in Airtable — the migration script will be updated to read them as-is (no offset).

### Subcategory values by category

- **Tops:** Tee shirts, Graphic tees, Long-sleeve tees, Sleeveless, Blouses, Sweaters, Cardigans, Sweatshirts
- **Bottoms:** Jeans, Pants, Shorts, Skirts, Leggings/Joggers, Tights
- **Dresses:** Casual dresses, Work dresses, Cocktail dresses
- **Outerwear:** Blazers, Jackets, Coats
- **Shoes:** Boots, Sandals, Flats, Heels, Sneakers
- **Workout:** Workout tops, Active shorts, Sports bras

### Columns already in Airtable (verify names match exactly)

The migration script reads these by exact field name — confirm they haven't been renamed:

| Script expects | Airtable field name |
|---|---|
| `Name` | `Name` |
| `Brand` | `Brand` |
| `Retailer` | `Retailer` |
| `Purchase Price` | `Purchase Price` |
| `Date Acquired` | `Date Acquired` |
| `New vs Secondhand` | `New vs Secondhand` |
| `Status` | `Status` |
| `Tags` | `Tags` |
| `URL` | `URL` |
| `Order #` | `Order #` |
| `Receipt` | `Receipt` |
| `Official Item Name` | `Official Item Name` |
| `Notes` | `Notes` |
| `Picture` | `Picture` (attachment field) |

---

## Step 2 — Replace photos in Airtable

The script downloads photos directly from Airtable attachment URLs, resizes to max 1200px, and uploads to Supabase Storage. So simply replacing the `Picture` attachment in Airtable is all you need to do.

- Upload new photos to the `Picture` field in each row
- Photos can be JPEG, PNG, WebP, or HEIC — the script handles all of them
- Multiple attachments: the script uses the **first** one only
- Higher resolution is fine; the script will downscale to 1200px max edge
- Transparent PNGs / WebPs will keep their transparency (not converted to JPEG)

---

## Step 3 — Bulk-fill data in Airtable

Recommended order (most impactful first):

1. **Status** — mark Storage/Archive items (anything not in active rotation)
2. **Color Family** — single value per item; most items probably already have this from the old Colors field
3. **Subcategory** — if the existing Subcategory field values already match the new taxonomy names, no change needed; otherwise update to match exactly
4. **Min/Max Occasion** — fill the 1–7 formality range for each item; ~34 items had values before (on the old 1–6 scale — re-enter on new scale)
5. **Acquisition** — New / Secondhand / Gift
6. **Size** — text field, whatever format makes sense (S/M/L or numeric)
7. **Fabric** — multi-select, fill where you know it
8. **Season** — multi-select; can leave blank for year-round items

---

## Step 4 — Wipe Supabase

Run in the Supabase **SQL editor** (Tables → SQL editor). Run in this order to respect foreign keys:

```sql
-- 1. join tables first
DELETE FROM outfit_items;
DELETE FROM capsule_items;

-- 2. dependent tables
DELETE FROM wears;
DELETE FROM outfits;
DELETE FROM capsules;

-- 3. items last
DELETE FROM items;
```

Then wipe Storage. In the Supabase dashboard go to **Storage → wardrobe bucket → select all → Delete**. Or via SQL:

```sql
-- Lists all objects to delete (review first)
SELECT name FROM storage.objects WHERE bucket_id = 'wardrobe';

-- Then delete:
DELETE FROM storage.objects WHERE bucket_id = 'wardrobe';
```

> The Storage dashboard bulk-delete is easier if there are hundreds of files. The SQL approach is faster for large counts.

---

## Step 5 — Update migration scripts

### `import.py` changes needed

**Remove the occasion +1 offset** — `remap_occ()` currently does `int(n) + 1` to shift old 1-6 → new 1-7. Since Airtable will now store 1-7 directly:

```python
# BEFORE (old, remove this)
def remap_occ(n):
    if n is None:
        return None
    return min(7, max(1, int(n) + 1))

# AFTER (new, just clamp)
def remap_occ(n):
    if n is None:
        return None
    return min(7, max(1, int(n)))
```

**Update `SUBCAT_MAP`** if Airtable subcategory values were cleaned up to match the canonical names exactly. If Airtable subcategory values now match the `TAXONOMY` names exactly, the `SUBCAT_MAP` can be simplified or removed entirely (just pass through directly).

**Check `map_record`** field name reads match the Airtable column names confirmed in Step 1. Key ones that may need updates:
- `f.get("New vs Secondhand")` → still correct, or rename to `f.get("Acquisition")` if you renamed the column
- `f.get("Color Family")` → verify the column name
- `f.get("Min Occasion")` / `f.get("Max Occasion")` → verify column names

**The Archived table:** at reset time, decide whether to keep a separate Archived table in Airtable or use the `Status` field on the main table. If using `Status` only (single table), update the script to not fetch `ARCHIVED_TABLE`.

### `import_wears.py` and `import_outfits.py`

These read from the Airtable **Dates** and **Outfits** tables (not the clothing tables), so they should not need changes unless those table structures changed.

Check: the name→item matcher in both scripts matches items by normalized name. After the reset, items will have new UUIDs but the same names, so this should still work.

---

## Step 6 — Re-run imports

```bash
cd migration

# Dry run first — no Supabase writes
python3 import.py
# Review review.json for flagged items

# Live run
python3 import.py --live

# Then wears
python3 import_wears.py --live

# Then outfits (links wears to outfit_id)
python3 import_outfits.py --live
```

Expected output:
- `import.py --live`: ~476 items, 0 photo failures (with new photos)
- `import_wears.py --live`: ~3,995 wear rows
- `import_outfits.py --live`: ~1,543 outfits + ~4,182 outfit_items + wear back-links

---

## Step 7 — Verify

In the app after reset:

- [ ] Item count looks right (~476 or updated count)
- [ ] Photos load on item cards and detail sheets
- [ ] Wear counts on items are non-zero (wears imported)
- [ ] Outfit log ("Worn" tab in Log) shows past outfits
- [ ] Calendar shows historical wear events
- [ ] Insights KPI cards have data
- [ ] A few items: check color_family, subcategory, occasion range look correct
- [ ] Filter chips in closet (category, status) work as expected

In Supabase:
```sql
SELECT COUNT(*) FROM items;
SELECT COUNT(*) FROM wears;
SELECT COUNT(*) FROM outfits;
SELECT COUNT(image_path) FROM items WHERE image_path IS NOT NULL;
```

---

## Notes

- **Wears and outfits come from Airtable Dates/Outfits tables** — not from the clothing tables. Historical wear history is preserved as long as those tables are intact.
- **Photos are re-uploaded fresh** — new Storage paths, new UUIDs. The old Storage files are gone after Step 4.
- **Run the wipe and re-import in one session** — the app will have no data between wipe and re-import completion.
- **After re-import, do a hard refresh** on the app (Cmd+Shift+R) to clear any cached data.
- **The `review.json` file** from the dry run lists any items with mapping problems (unknown subcategory, missing category, no photo) — fix those in Airtable before the live run.
