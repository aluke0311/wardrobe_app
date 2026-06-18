#!/usr/bin/env python3
# ===================================================================
# One-time Airtable -> Supabase import for the wardrobe app.
#
#   python3 import.py          DRY RUN — reads Airtable, maps, writes
#                              review.json. No writes to Supabase.
#   python3 import.py --live   downloads photos (resized with sips),
#                              uploads to Storage, inserts every item.
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

SUPABASE_URL = env["SUPABASE_URL"]
SERVICE_KEY  = env["SUPABASE_SERVICE_KEY"]
AT_TOKEN     = env["AIRTABLE_TOKEN"]
AT_BASE      = env["AIRTABLE_BASE_ID"]
BUCKET       = "wardrobe"
CLOTHING_TABLE = "tbl8aGOLnxg7itoFe"
ARCHIVED_TABLE = "tblKNGlQ8flGqthsu"
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
    "Tops": ["Tee shirts", "Graphic tees", "Long-sleeve tees", "Sleeveless", "Blouses", "Sweaters", "Cardigans", "Sweatshirts"],
    "Bottoms": ["Jeans", "Pants", "Shorts", "Skirts", "Leggings/Joggers", "Tights"],
    "Dresses": ["Casual dresses", "Work dresses", "Cocktail dresses"],
    "Outerwear": ["Blazers", "Jackets", "Coats"],
    "Shoes": ["Boots", "Sandals", "Flats", "Heels", "Sneakers"],
    "Workout": ["Workout tops", "Active shorts", "Sports bras"],
}
SUBCAT_TO_CAT = {s: c for c, subs in TAXONOMY.items() for s in subs}
SUBCAT_MAP = {
    "Tee Shirts": "Tee shirts", "Graphic Tees": "Graphic tees", "Long Sleeved Tees": "Long-sleeve tees",
    "Sleeveless": "Sleeveless", "Blouses": "Blouses", "Sweaters": "Sweaters", "Cardigans": "Cardigans",
    "Sweatshirts": "Sweatshirts", "Jeans": "Jeans", "Pants": "Pants", "Shorts": "Shorts", "Skirts": "Skirts",
    "Leggings/Joggers": "Leggings/Joggers", "Tights": "Tights", "Dresses": "Casual dresses",
    "Work Dresses": "Work dresses", "Cocktail Dresses": "Cocktail dresses", "Blazers": "Blazers",
    "Jackets": "Jackets", "Coats": "Coats", "Boots": "Boots", "Sandals": "Sandals", "Flats": "Flats",
    "Heels": "Heels", "Tennis Shoes": "Sneakers", "Workout Tops": "Workout tops", "Active Shorts": "Active shorts",
    "Archive": None, "Boxed Up": None, "Long": None, "Short": None, "Workout": None,
}
CAT_MAP = {"Tops": "Tops", "Bottoms": "Bottoms", "Dresses": "Dresses", "Outerwear": "Outerwear", "Shoes": "Shoes", "Workout": "Workout"}
STATUSES = {"Available", "Storage", "Archive"}


def remap_occ(n):
    if n is None:
        return None
    return min(7, max(1, int(n) + 1))  # old 1-6 ladder -> new 1-7 (review after)


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

    raw_sub = f.get("Subcategory")
    subcategory = None
    if raw_sub is not None:
        if raw_sub in SUBCAT_MAP:
            subcategory = SUBCAT_MAP[raw_sub]
            if subcategory is None and raw_sub != "Workout":
                flags.append(f'dropped subcategory "{raw_sub}"')
        else:
            flags.append(f'unknown subcategory "{raw_sub}"')

    raw_cat = f.get("Category")
    category = SUBCAT_TO_CAT.get(subcategory) if subcategory else CAT_MAP.get(raw_cat)
    if not category and raw_cat == "Workout":
        category = "Workout"
    if not category:
        if raw_cat == "Accessories":
            flags.append("Accessories — no longer a category, needs recategorizing")
        elif raw_cat == "Archive":
            flags.append("category was 'Archive' — needs a real category")
        elif raw_cat:
            flags.append(f'unknown category "{raw_cat}"')

    acquisition = f.get("New vs Secondhand")
    if not acquisition and f.get("Source"):
        acquisition = "Gift" if f["Source"] == "Gift or Free" else "New"

    status = "Available"
    if archived or raw_cat == "Archive":
        status = "Archive"
    elif f.get("Status") in STATUSES:
        status = f["Status"]

    min_o = remap_occ(f.get("Min Occasion", f.get("Max Occasion")))
    max_o = remap_occ(f.get("Max Occasion", f.get("Min Occasion")))

    pics = f.get("Picture") or []
    photo_url = pics[0]["url"] if pics else None
    photo_type = pics[0].get("type") if pics else None
    if not photo_url:
        flags.append("no photo")

    price = f.get("Purchase Price")
    row = {
        "name": str(f.get("Name") or "Untitled").strip(),
        "category": category,
        "subcategory": subcategory,
        "brand": f.get("Brand"),
        "retailer": f.get("Retailer"),
        "color_family": f.get("Color Family"),
        "price": price if isinstance(price, (int, float)) else None,
        "purchase_date": f.get("Date Acquired"),
        "date_is_guess": f.get("Date is Guess") == "Yes",
        "acquisition": acquisition,
        "size": f.get("Size"),
        "fabric": f.get("Fabric") if isinstance(f.get("Fabric"), list) else [],
        "season": f.get("Season") if isinstance(f.get("Season"), list) else [],
        "min_occasion": min_o,
        "max_occasion": max_o,
        "status": status,
        "tags": f.get("Tags") if isinstance(f.get("Tags"), list) else [],
        "url": f.get("URL"),
        "order_no": f.get("Order #"),
        "receipt_url": f.get("Receipt") if isinstance(f.get("Receipt"), str) else None,
        "official_name": f.get("Official Item Name"),
        "notes": f.get("Notes"),
        "image_path": None,
    }
    return {"row": row, "photo_url": photo_url, "photo_type": photo_type,
            "flags": flags, "src": {"id": rec["id"], "name": row["name"]}}


# ---- photo: download -> sips resize -> Storage --------------------
EXT = {"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/heic": "heic", "image/webp": "webp"}


def upload_photo(url, ctype, user_id, tmp):
    ext = EXT.get(ctype, "jpg")
    src = tmp / f"in.{ext}"
    _, data = http(url)
    src.write_bytes(data)
    # HEIC doesn't render in browsers -> convert to JPEG
    if ext == "heic":
        dst = tmp / "in.jpg"
        subprocess.run(["sips", "-s", "format", "jpeg", str(src), "--out", str(dst)], capture_output=True)
        src, ext, ctype = dst, "jpg", "image/jpeg"
    # downscale only if larger than 1200 on the long edge; keep format (preserves transparency)
    dims = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(src)],
                          capture_output=True, text=True).stdout
    longest = max([int(x.split(":")[1]) for x in dims.splitlines() if ":" in x and x.split(":")[1].strip().isdigit()] or [0])
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
        sys.exit("Multiple users — set IMPORT_USER_ID in .env: " + ", ".join(u.get("email", "?") for u in users))
    return users[0]["id"]


# ---- main ---------------------------------------------------------
clothing = airtable_all(CLOTHING_TABLE)
try:
    archived = airtable_all(ARCHIVED_TABLE)
except SystemExit:
    archived = []
mapped = [map_record(r, False) for r in clothing] + [map_record(r, True) for r in archived]

flagged = [m for m in mapped if m["flags"]]
by_cat = {}
for m in mapped:
    by_cat[m["row"]["category"] or "(none)"] = by_cat.get(m["row"]["category"] or "(none)", 0) + 1

print(f"\n  Clothing: {len(clothing)}   Archived: {len(archived)}   Total: {len(mapped)}")
print(f"  By category: {by_cat}")
print(f"  With photo: {sum(1 for m in mapped if m['photo_url'])}")
print(f"  Flagged for review: {len(flagged)}")
(HERE / "review.json").write_text(json.dumps([{**m["src"], "flags": m["flags"]} for m in flagged], indent=2))
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
                m["row"]["image_path"] = upload_photo(m["photo_url"], m["photo_type"], user_id, tmp)
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
