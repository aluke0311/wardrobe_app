#!/usr/bin/env python3
# ===================================================================
# One-time Airtable -> Supabase import for the wardrobe app.
#
#   python3 import.py          DRY RUN — reads Airtable, maps, writes
#                              review.json. No writes to Supabase.
#   python3 import.py --live   downloads photos (resized with sips),
#                              uploads to Storage, inserts every item.
#
# Expects the "Wardrobe App" Airtable view on the Clothing table,
# with field names matching the spec in migration/RESET_PLAN.md.
#
# Stdlib only + macOS `sips` for image resizing. Secrets come from
# migration/.env (gitignored). Throwaway tooling — not the shipped app.
# ===================================================================
import json, os, sys, subprocess, tempfile, urllib.request, urllib.error, uuid
from pathlib import Path

LIVE = "--live" in sys.argv
HERE = Path(__file__).parent

# ---- env ----------------------------------------------------------
env = {}
for line in (HERE / ".env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.split("#", 1)[0].strip() if k.strip() != "AIRTABLE_TOKEN" else v.strip()

SUPABASE_URL   = env["SUPABASE_URL"]
SERVICE_KEY    = env["SUPABASE_SERVICE_KEY"]
AT_TOKEN       = env["AIRTABLE_TOKEN"]
AT_BASE        = env["AIRTABLE_BASE_ID"]
BUCKET         = "wardrobe"
CLOTHING_TABLE = env.get("AIRTABLE_CLOTHING_TABLE", "tbl8aGOLnxg7itoFe")
ARCHIVED_TABLE = env.get("AIRTABLE_ARCHIVED_TABLE", "tblKNGlQ8flGqthsu")
# Formality field IDs (multipleSelects, created 2026-06-26)
FORMALITY_FIELD_CLOTHING = "fldKIJYfSIi4v9dQr"
FORMALITY_FIELD_ARCHIVED = "fldyRqNs3vhWjxaQh"

for k in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "AIRTABLE_TOKEN", "AIRTABLE_BASE_ID"):
    if not env.get(k):
        sys.exit(f"Missing {k} in migration/.env")


def http(url, method="GET", headers=None, data=None):
    req = urllib.request.Request(url, method=method, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def sb(path, method="GET", headers=None, data=None):
    h = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}
    h.update(headers or {})
    return http(f"{SUPABASE_URL}{path}", method, h, data)


# ---- taxonomy -----------------------------------------------------
TAXONOMY = {
    "Tops":      ["Tee shirts", "Graphic tees", "Long-sleeve tees", "Sleeveless",
                  "Blouses", "Sweaters", "Cardigans", "Sweatshirts"],
    "Bottoms":   ["Jeans", "Pants", "Shorts", "Skirts", "Leggings/Joggers", "Tights"],
    "Dresses":   ["Casual dresses", "Work dresses", "Cocktail dresses"],
    "Outerwear": ["Blazers", "Jackets", "Coats"],
    "Shoes":     ["Boots", "Sandals", "Flats", "Heels", "Sneakers"],
    "Workout":   ["Workout tops", "Active shorts", "Sports bras"],
}
ALL_SUBCATS   = {s for subs in TAXONOMY.values() for s in subs}
SUBCAT_TO_CAT = {s: c for c, subs in TAXONOMY.items() for s in subs}

# Legacy Airtable subcategory names → canonical. Only needed if old data
# uses non-canonical names. The new "Wardrobe App" view uses canonical names.
SUBCAT_MAP = {
    "Tee Shirts": "Tee shirts", "Graphic Tees": "Graphic tees",
    "Long Sleeved Tees": "Long-sleeve tees", "Long-Sleeve Tees": "Long-sleeve tees",
    "Blouses": "Blouses", "Sweaters": "Sweaters", "Cardigans": "Cardigans",
    "Sweatshirts": "Sweatshirts", "Jeans": "Jeans", "Pants": "Pants",
    "Shorts": "Shorts", "Skirts": "Skirts", "Leggings/Joggers": "Leggings/Joggers",
    "Tights": "Tights", "Dresses": "Casual dresses", "Casual Dresses": "Casual dresses",
    "Work Dresses": "Work dresses", "Cocktail Dresses": "Cocktail dresses",
    "Blazers": "Blazers", "Jackets": "Jackets", "Coats": "Coats",
    "Boots": "Boots", "Sandals": "Sandals", "Flats": "Flats", "Heels": "Heels",
    "Tennis Shoes": "Sneakers", "Sneakers": "Sneakers",
    "Workout Tops": "Workout tops", "Active Shorts": "Active shorts",
    "Sports Bras": "Sports bras",
    # legacy nulls
    "Archive": None, "Boxed Up": None, "Long": None, "Short": None, "Workout": None,
}

STATUSES = {"Available", "Storage", "Archive"}

# ---- Formality parsing --------------------------------------------
# Airtable multi-select options look like "1 · Function", "3 · Casual", etc.
# Parse each selected option to extract the leading integer.
def parse_formality(raw):
    """raw is None, a list of option strings, or a single string."""
    if not raw:
        return None
    if isinstance(raw, (int, float)):
        n = int(raw)
        return [n] if 1 <= n <= 8 else None
    items = raw if isinstance(raw, list) else [raw]
    result = []
    for opt in items:
        # "1 · Function"  or  "1. Function"  or  "1"  or  just "Function"
        s = str(opt).strip()
        try:
            n = int(s.split()[0].rstrip(".·:"))
            if 1 <= n <= 8:
                result.append(n)
        except (ValueError, IndexError):
            pass  # label without leading number — skip
    result = sorted(set(result))
    return result if result else None


# ---- Airtable -----------------------------------------------------
def airtable_all(table_id):
    out, offset = [], None
    while True:
        url = f"https://api.airtable.com/v0/{AT_BASE}/{table_id}?pageSize=100"
        if offset:
            url += f"&offset={offset}"
        status, body = http(url, headers={"Authorization": f"Bearer {AT_TOKEN}"})
        if status != 200:
            sys.exit(f"Airtable {table_id}: {status} {body[:300]}")
        j = json.loads(body)
        out.extend(j["records"])
        offset = j.get("offset")
        if not offset:
            return out


def map_record(rec, archived):
    f = rec["fields"]
    flags = []

    # ---- subcategory + category -----------------------------------
    raw_sub = f.get("Subcategory")
    subcategory = None
    if raw_sub is not None:
        if raw_sub in ALL_SUBCATS:
            subcategory = raw_sub                     # canonical already
        elif raw_sub in SUBCAT_MAP:
            subcategory = SUBCAT_MAP[raw_sub]
            if subcategory is None and raw_sub != "Workout":
                flags.append(f'dropped subcategory "{raw_sub}"')
        else:
            flags.append(f'unknown subcategory "{raw_sub}"')

    raw_cat = f.get("Category")
    category = SUBCAT_TO_CAT.get(subcategory) if subcategory else None
    if not category:
        if raw_cat in ("Tops", "Bottoms", "Dresses", "Outerwear", "Shoes", "Workout"):
            category = raw_cat
        elif raw_cat == "Accessories":
            flags.append("Accessories — no longer a category, needs recategorizing")
        elif raw_cat == "Archive":
            flags.append("category was 'Archive' — needs a real category")
        elif raw_cat:
            flags.append(f'unknown category "{raw_cat}"')

    # ---- acquisition ----------------------------------------------
    # New view uses "Acquisition" (New/Secondhand/Gift).
    # Fall back to old "New vs Secondhand" field for legacy data.
    acquisition = f.get("Acquisition") or f.get("New vs Secondhand")
    if acquisition and acquisition not in ("New", "Secondhand", "Gift"):
        if "gift" in acquisition.lower() or "free" in acquisition.lower():
            acquisition = "Gift"
        else:
            acquisition = "New"

    # ---- status ---------------------------------------------------
    status = "Available"
    if archived or raw_cat == "Archive":
        status = "Archive"
    elif f.get("Status") in STATUSES:
        status = f["Status"]

    # ---- formality ------------------------------------------------
    # New view: multi-select field "Formality" with options "1 · Function" etc.
    formality = parse_formality(f.get("Formality"))

    # ---- photo ----------------------------------------------------
    pics = f.get("Picture") or []
    photo_url  = pics[0]["url"]  if pics else None
    photo_type = pics[0].get("type") if pics else None
    if not photo_url:
        flags.append("no photo")

    # ---- date_is_guess --------------------------------------------
    # Airtable checkboxes return True/False (not "Yes").
    raw_guess = f.get("Date is Guess")
    date_is_guess = bool(raw_guess) if raw_guess is not None else False

    price = f.get("Purchase Price")
    row = {
        "name":          str(f.get("Name") or "Untitled").strip(),
        "category":      category,
        "subcategory":   subcategory,
        "brand":         f.get("Brand"),
        "retailer":      f.get("Retailer"),
        "color_family":  f.get("Color Family"),
        "price":         price if isinstance(price, (int, float)) else None,
        "purchase_date": f.get("Date Acquired"),
        "date_is_guess": date_is_guess,
        "acquisition":   acquisition,
        "size":          f.get("Size"),
        "fabric":        f.get("Fabric")  if isinstance(f.get("Fabric"),  list) else [],
        "season":        f.get("Season")  if isinstance(f.get("Season"),  list) else [],
        "formality":     formality,        # smallint[] or null
        "status":        status,
        "tags":          f.get("Tags")    if isinstance(f.get("Tags"),    list) else [],
        "url":           f.get("URL"),
        "order_no":      f.get("Order #"),
        "receipt_url":   f.get("Receipt") if isinstance(f.get("Receipt"), str) else None,
        "official_name": f.get("Official Item Name"),
        "notes":         f.get("Notes"),
        "image_path":    None,
    }
    return {"row": row, "photo_url": photo_url, "photo_type": photo_type,
            "flags": flags, "src": {"id": rec["id"], "name": row["name"]}}


# ---- photo: download -> sips resize -> Storage --------------------
EXT = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
    "image/heic": "heic", "image/webp": "webp",
}


def upload_photo(url, ctype, user_id, tmp):
    ext = EXT.get(ctype, "jpg")
    src = tmp / f"in.{ext}"
    _, data = http(url)
    src.write_bytes(data)
    # HEIC doesn't render in browsers → convert to JPEG
    if ext == "heic":
        dst = tmp / "in.jpg"
        subprocess.run(["sips", "-s", "format", "jpeg", str(src), "--out", str(dst)],
                       capture_output=True)
        src, ext, ctype = dst, "jpg", "image/jpeg"
    # downscale only if larger than 1200 on the long edge; keep format (preserves transparency)
    dims = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(src)],
                          capture_output=True, text=True).stdout
    longest = max([int(x.split(":")[1]) for x in dims.splitlines()
                   if ":" in x and x.split(":")[1].strip().isdigit()] or [0])
    if longest > 1200:
        subprocess.run(["sips", "-Z", "1200", str(src)], capture_output=True)
    blob = src.read_bytes()
    path = f"{user_id}/{uuid.uuid4()}.{ext}"
    status, body = sb(f"/storage/v1/object/{BUCKET}/{path}", "POST",
                      {"Content-Type": ctype or "image/jpeg"}, blob)
    if status not in (200, 201):
        raise RuntimeError(f"upload {status}: {body[:200]}")
    return path


def resolve_user():
    if env.get("IMPORT_USER_ID"):
        return env["IMPORT_USER_ID"]
    status, body = sb("/auth/v1/admin/users?per_page=50")
    if status != 200:
        sys.exit(f"auth admin: {status} {body[:200]}")
    users = json.loads(body).get("users", [])
    if not users:
        sys.exit("No users in Supabase Auth — sign into the app once first.")
    if len(users) > 1:
        sys.exit("Multiple users — set IMPORT_USER_ID in .env: " +
                 ", ".join(u.get("email", "?") for u in users))
    return users[0]["id"]


# ---- main ---------------------------------------------------------
clothing = airtable_all(CLOTHING_TABLE)
try:
    archived = airtable_all(ARCHIVED_TABLE)
except SystemExit:
    archived = []
    print("  (No archived table — continuing with clothing only)")

mapped = [map_record(r, False) for r in clothing] + \
         [map_record(r, True)  for r in archived]

flagged  = [m for m in mapped if m["flags"]]
with_fml = sum(1 for m in mapped if m["row"]["formality"])
by_cat   = {}
for m in mapped:
    k = m["row"]["category"] or "(none)"
    by_cat[k] = by_cat.get(k, 0) + 1

print(f"\n  Clothing: {len(clothing)}   Archived: {len(archived)}   Total: {len(mapped)}")
print(f"  By category: {by_cat}")
print(f"  With photo:    {sum(1 for m in mapped if m['photo_url'])}")
print(f"  With formality: {with_fml}")
print(f"  Flagged for review: {len(flagged)}")
(HERE / "review.json").write_text(
    json.dumps([{**m["src"], "flags": m["flags"]} for m in flagged], indent=2))
print(f"  -> wrote review.json ({len(flagged)} rows to eyeball)\n")

if not LIVE:
    print("  DRY RUN — nothing written to Supabase. Re-run with --live to import.\n")
    sys.exit(0)

user_id = resolve_user()
print(f"  Importing as user {user_id}\n")

photo_fail = 0
with tempfile.TemporaryDirectory() as td:
    tmp = Path(td)
    for i, m in enumerate(mapped, 1):
        if m["photo_url"]:
            try:
                m["row"]["image_path"] = upload_photo(
                    m["photo_url"], m["photo_type"], user_id, tmp)
            except Exception as e:
                photo_fail += 1
                print(f"  ! photo failed for \"{m['row']['name']}\": {e}")
        m["row"]["user_id"] = user_id
        if i % 25 == 0:
            print(f"  photos+prep {i}/{len(mapped)}")

rows = [m["row"] for m in mapped]
for i in range(0, len(rows), 50):
    batch = rows[i:i + 50]
    status, body = sb("/rest/v1/items", "POST",
                      {"Content-Type": "application/json", "Prefer": "return=minimal"},
                      json.dumps(batch).encode())
    if status not in (200, 201):
        sys.exit(f"insert batch {i}: {status} {body[:300]}")
    print(f"  inserted {min(i + 50, len(rows))}/{len(rows)}")

print(f"\n  Done. {len(rows)} items imported, {photo_fail} photos failed.\n")
