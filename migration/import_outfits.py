#!/usr/bin/env python3
# ===================================================================
# One-time Airtable -> Supabase import of OUTFITS.
#
#   python3 import_outfits.py          DRY RUN — builds everything, writes
#                                      outfits_review.json. No writes.
#   python3 import_outfits.py --live   inserts outfits + outfit_items and
#                                      back-links wears.outfit_id.
#   python3 import_outfits.py --live --force
#                                      proceed even if outfits already exist.
#
# Airtable "Outfits" = a set of Clothing Items worn together on a Date (a day can
# have several). We create one Supabase `outfits` row per Airtable outfit, link
# its items via `outfit_items`, and set `wears.outfit_id` on the matching
# (item, day) wears already imported by import_wears.py. `created_at` is set to
# the outfit's date so the set stays chronological (the schema has no date column;
# the date lives on the linked wears). Occasion -> context (only a handful set),
# the few outfit photos are re-hosted to Storage like item photos.
#
# Item identity is re-established by normalized name, same as import_wears.py
# (items carry no Airtable id). Stdlib + macOS `sips`. Secrets from .env.
# ===================================================================
import json, sys, re, subprocess, tempfile, uuid, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

LIVE = "--live" in sys.argv
FORCE = "--force" in sys.argv
HERE = Path(__file__).parent

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
OUTFITS_TABLE  = "tblJYYz23lCewCXUd"
F_CLOTH_NAME, F_CLOTH_BRAND, F_CLOTH_CAT = "fldGRW511cI4SFpW4", "fldsglwzVbUW7Hi5r", "fldfOHsmIW54THGVL"
F_CLOTH_DATE, F_CLOTH_PRICE = "fldHhvtErNkgBvUuU", "fldu2YUgkDFJWL8bS"
F_OUT_DATE  = "fldq7m6Xtl4gak29R"   # Outfits.Date
F_OUT_CLOTH = "fldpfp9o0GqFVZnb9"   # Outfits.Clothing Items (links)
F_OUT_OCC   = "flduxF05jNNCBiQpw"   # Outfits.Occasion
F_OUT_IMG   = "fldzuXTFX7xv6AN6V"   # Outfits.Image (attachments)

for k in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "AIRTABLE_TOKEN", "AIRTABLE_BASE_ID"):
    if not env.get(k):
        sys.exit(f"Missing {k} in migration/.env")


def http(url, method="GET", headers=None, data=None):
    req = urllib.request.Request(url, method=method, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), {}


def sb(path, method="GET", headers=None, data=None):
    h = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}
    h.update(headers or {})
    return http(f"{SUPABASE_URL}{path}", method, h, data)


def sb_page(path):
    """GET all rows, paging past Supabase's default 1000-row response cap."""
    out, start = [], 0
    while True:
        status, body, _ = sb(path, headers={"Range-Unit": "items", "Range": f"{start}-{start+999}"})
        if status not in (200, 206):
            sys.exit(f"page fetch {status}: {body[:200]}")
        chunk = json.loads(body)
        out.extend(chunk)
        if len(chunk) < 1000:
            return out
        start += 1000


def airtable_all(table_id, fields):
    out, offset = [], None
    params = "returnFieldsByFieldId=true&" + "&".join(f"fields%5B%5D={f}" for f in fields)
    while True:
        url = f"https://api.airtable.com/v0/{AT_BASE}/{table_id}?pageSize=100&{params}"
        if offset:
            url += f"&offset={offset}"
        status, body, _ = http(url, headers={"Authorization": f"Bearer {AT_TOKEN}"})
        if status != 200:
            sys.exit(f"Airtable {table_id}: {status} {body[:300]}")
        j = json.loads(body)
        out.extend(j["records"])
        offset = j.get("offset")
        if not offset:
            return out


def cell(rec, fid):
    return rec.get("fields", {}).get(fid)


def norm(name):
    s = re.sub(r"^archived?\s+", "", str(name or "").strip(), flags=re.I)
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s or "untitled"


# ---- 1. items + rec->item map (mirrors import_wears.py) ------------
status, body, _ = sb("/rest/v1/items?select=id,user_id,name,status,brand,category,purchase_date,price&limit=5000")
if status != 200:
    sys.exit(f"items fetch: {status} {body[:300]}")
items = json.loads(body)
OWNER_ID = env.get("IMPORT_USER_ID") or next((i.get("user_id") for i in items if i.get("user_id")), None)
print(f"\n  Supabase items: {len(items)}")

by_name = defaultdict(list)
for it in items:
    by_name[norm(it["name"])].append(it)

clothing = airtable_all(CLOTHING_TABLE, [F_CLOTH_NAME, F_CLOTH_BRAND, F_CLOTH_CAT, F_CLOTH_DATE, F_CLOTH_PRICE])
used, rec_to_item = set(), {}


def pick(cands, rec):
    free = [c for c in cands if c["id"] not in used]
    pool = free or cands
    if len(pool) == 1:
        return pool[0]
    pdate, price = cell(rec, F_CLOTH_DATE), cell(rec, F_CLOTH_PRICE)
    brand = (cell(rec, F_CLOTH_BRAND) or "").strip().lower()
    for keyfn in (
        lambda c: c.get("status") != "Archive",
        lambda c: pdate and c.get("purchase_date") == pdate,
        lambda c: price is not None and c.get("price") is not None and abs(float(c["price"]) - float(price)) < 0.005,
        lambda c: brand and (c.get("brand") or "").strip().lower() == brand,
    ):
        narrowed = [c for c in pool if keyfn(c)]
        if len(narrowed) == 1:
            return narrowed[0]
        if narrowed:
            pool = narrowed
    return sorted(pool, key=lambda c: c["id"])[0]


for rec in clothing:
    cands = by_name.get(norm(cell(rec, F_CLOTH_NAME)), [])
    if not cands:
        continue
    chosen = pick(cands, rec)
    rec_to_item[rec["id"]] = chosen["id"]
    used.add(chosen["id"])
print(f"  Clothing records mapped to items: {len(rec_to_item)}/{len(clothing)}")

# ---- 2. outfits ---------------------------------------------------
outfits = airtable_all(OUTFITS_TABLE, [F_OUT_DATE, F_OUT_CLOTH, F_OUT_OCC, F_OUT_IMG])
print(f"  Airtable outfits: {len(outfits)}")

# Build a plan: one entry per outfit with its resolved item ids + metadata.
plan = []            # {date, context, item_ids[], img_url, img_type}
link_total = link_unmatched = with_occ = with_img = no_items = 0
for o in outfits:
    day = (cell(o, F_OUT_DATE) or "")[:10] or None
    item_ids, seen = [], set()
    for link_id in (cell(o, F_OUT_CLOTH) or []):
        link_total += 1
        iid = rec_to_item.get(link_id)
        if not iid:
            link_unmatched += 1
            continue
        if iid not in seen:        # an item can't appear twice in one outfit row
            seen.add(iid); item_ids.append(iid)
    if not item_ids:
        no_items += 1
        continue
    occ = cell(o, F_OUT_OCC)
    img = cell(o, F_OUT_IMG) or []
    if occ:
        with_occ += 1
    if img:
        with_img += 1
    plan.append({
        "date": day,
        "context": occ,
        "item_ids": item_ids,
        "img_url": img[0]["url"] if img else None,
        "img_type": img[0].get("type") if img else None,
    })

oi_rows_est = sum(len(p["item_ids"]) for p in plan)
print(f"\n  Outfits to create: {len(plan)}   (skipped {no_items} with no resolvable items)")
print(f"  outfit_items links: {oi_rows_est}   unmatched item links: {link_unmatched}")
print(f"  with context: {with_occ}   with photo to re-host: {with_img}")

(HERE / "outfits_review.json").write_text(json.dumps({
    "outfits_to_create": len(plan), "outfit_item_links": oi_rows_est,
    "unmatched_item_links": link_unmatched, "outfits_with_no_items": no_items,
    "with_context": with_occ, "photos_to_rehost": with_img,
}, indent=2))
print("  -> wrote outfits_review.json")

if not LIVE:
    print("\n  DRY RUN — nothing written. Re-run with --live to import.\n")
    sys.exit(0)

if not OWNER_ID:
    sys.exit("\n  No user_id available (IMPORT_USER_ID blank and no items).\n")

# guard against re-import
status, body, hdr = sb("/rest/v1/outfits?select=id", headers={"Prefer": "count=exact", "Range": "0-0"})
existing = 0
if "Content-Range" in hdr and "/" in hdr["Content-Range"]:
    tail = hdr["Content-Range"].split("/")[-1]
    existing = int(tail) if tail.isdigit() else 0
if existing and not FORCE:
    sys.exit(f"\n  outfits table is NOT empty ({existing} rows). Re-run with --force to add anyway.\n")


# ---- 3. re-host the handful of outfit photos ----------------------
EXT = {"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/heic": "heic", "image/webp": "webp"}


def rehost(url, ctype, tmp):
    ext = EXT.get(ctype, "jpg")
    src = tmp / f"o_{uuid.uuid4().hex}.{ext}"
    _, data, _ = http(url)
    src.write_bytes(data)
    if ext == "heic":
        dst = src.with_suffix(".jpg")
        subprocess.run(["sips", "-s", "format", "jpeg", str(src), "--out", str(dst)], capture_output=True)
        src, ext, ctype = dst, "jpg", "image/jpeg"
    subprocess.run(["sips", "-Z", "1200", str(src)], capture_output=True)
    path = f"{OWNER_ID}/{uuid.uuid4()}.{ext}"
    status, body, _ = sb(f"/storage/v1/object/{BUCKET}/{path}", "POST",
                         {"Content-Type": ctype or "image/jpeg"}, src.read_bytes())
    if status not in (200, 201):
        raise RuntimeError(f"upload {status}: {body[:200]}")
    return path


with tempfile.TemporaryDirectory() as td:
    tmp = Path(td)
    for p in plan:
        p["image_path"] = None
        if p["img_url"]:
            try:
                p["image_path"] = rehost(p["img_url"], p["img_type"], tmp)
                print(f"  re-hosted outfit photo -> {p['image_path']}")
            except Exception as e:
                print(f"  ! outfit photo failed: {e}")

# ---- 4. insert outfits (bulk, representation preserves order) ------
created_ids = []
B = 100
for i in range(0, len(plan), B):
    batch = plan[i:i + B]
    # Every row must carry the SAME keys (PostgREST bulk-insert rule), so keep
    # explicit nulls rather than dropping empty fields.
    payload = [{
        "user_id": OWNER_ID,
        "name": None,
        "context": p["context"],
        "notes": None,
        "image_path": p.get("image_path"),
        "created_at": (p["date"] + "T12:00:00+00:00") if p["date"] else "2020-01-01T12:00:00+00:00",
    } for p in batch]
    status, body, _ = sb("/rest/v1/outfits", "POST",
                         {"Content-Type": "application/json", "Prefer": "return=representation"},
                         json.dumps(payload).encode())
    if status not in (200, 201):
        sys.exit(f"outfit insert {i}: {status} {body[:300]}")
    created_ids.extend([r["id"] for r in json.loads(body)])
    print(f"  outfits {min(i + B, len(plan))}/{len(plan)}")

if len(created_ids) != len(plan):
    sys.exit(f"  insert count mismatch: {len(created_ids)} != {len(plan)}")
for p, oid in zip(plan, created_ids):
    p["outfit_id"] = oid

# ---- 5. outfit_items ----------------------------------------------
oi_rows = []
for p in plan:
    for iid in p["item_ids"]:
        oi_rows.append({"outfit_id": p["outfit_id"], "item_id": iid, "user_id": OWNER_ID})
for i in range(0, len(oi_rows), 500):
    batch = oi_rows[i:i + 500]
    status, body, _ = sb("/rest/v1/outfit_items", "POST",
                         {"Content-Type": "application/json", "Prefer": "return=minimal"},
                         json.dumps(batch).encode())
    if status not in (200, 201):
        sys.exit(f"outfit_items insert {i}: {status} {body[:300]}")
    print(f"  outfit_items {min(i + 500, len(oi_rows))}/{len(oi_rows)}")

# ---- 6. back-link wears.outfit_id by (item_id, day) ---------------
# Page past the 1000-row cap — there are ~4k wears, and a truncated fetch would
# silently link only a fraction of them.
wears = sb_page("/rest/v1/wears?select=id,item_id,worn_on&order=id")
wear_by_key = {(w["item_id"], w["worn_on"]): w["id"] for w in wears}
claimed = set()
by_outfit = defaultdict(list)   # outfit_id -> [wear_id]
for p in plan:
    if not p["date"]:
        continue
    for iid in p["item_ids"]:
        key = (iid, p["date"])
        wid = wear_by_key.get(key)
        if wid and wid not in claimed:      # one outfit claims each wear
            claimed.add(wid)
            by_outfit[p["outfit_id"]].append(wid)

linked = 0
for oid, wids in by_outfit.items():
    for i in range(0, len(wids), 200):
        chunk = wids[i:i + 200]
        flt = "id=in.(" + ",".join(chunk) + ")"
        status, body, _ = sb(f"/rest/v1/wears?{flt}", "PATCH",
                             {"Content-Type": "application/json", "Prefer": "return=minimal"},
                             json.dumps({"outfit_id": oid}).encode())
        if status not in (200, 204):
            sys.exit(f"wear link patch: {status} {body[:200]}")
        linked += len(chunk)
print(f"  linked wears to outfits: {linked}")

print(f"\n  Done. {len(created_ids)} outfits, {len(oi_rows)} outfit_items, {linked} wears linked.\n")
