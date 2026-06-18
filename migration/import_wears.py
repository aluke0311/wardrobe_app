#!/usr/bin/env python3
# ===================================================================
# One-time Airtable -> Supabase import of HISTORICAL WEARS.
#
#   python3 import_wears.py          DRY RUN — fetches everything, builds
#                                    the recId->item map + wear rows, writes
#                                    wears_review.json. No writes to Supabase.
#   python3 import_wears.py --live   inserts the wear rows.
#   python3 import_wears.py --live --force
#                                    insert even if the wears table is non-empty.
#
# Wear history in Airtable lives in the **Dates** table: one record per day,
# each linking the Clothing items worn that day (this is what drives Airtable's
# "Number of Wears" rollups). A wear = (clothing item, date). We map each
# Airtable Clothing record back to its Supabase item, then emit one wears row
# per (item, day), deduped.
#
# The Supabase items were imported WITHOUT an Airtable id (see import.py), so we
# re-establish the link by matching on the (normalized) item name, falling back
# to purchase_date / price / brand to break ties. The dry run reports any
# Clothing record that couldn't be matched 1:1 so you can eyeball it first.
#
# Stdlib only. Secrets come from migration/.env (gitignored). Throwaway tooling.
# ===================================================================
import json, sys, re, datetime, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

LIVE = "--live" in sys.argv
FORCE = "--force" in sys.argv
HERE = Path(__file__).parent
TODAY = datetime.date.today().isoformat()

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
CLOTHING_TABLE = "tbl8aGOLnxg7itoFe"
DATES_TABLE    = "tbliythEqAGKgaDtE"
F_CLOTH_NAME   = "fldGRW511cI4SFpW4"   # Clothing.Name
F_CLOTH_BRAND  = "fldsglwzVbUW7Hi5r"   # Clothing.Brand
F_CLOTH_CAT    = "fldfOHsmIW54THGVL"   # Clothing.Category
F_CLOTH_DATE   = "fldHhvtErNkgBvUuU"   # Clothing.Date Acquired
F_CLOTH_PRICE  = "fldu2YUgkDFJWL8bS"   # Clothing.Purchase Price
F_DATE_DAY     = "fldkoakkgCAvDSyez"   # Dates.Date
F_DATE_CLOTH   = "fldtcPacuGx4RSET8"   # Dates.Clothing (links)

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


def airtable_all(table_id, fields):
    out, offset = [], None
    # returnFieldsByFieldId keys `fields` by field id (stable across renames).
    params = "returnFieldsByFieldId=true&" + "&".join(f"fields%5B%5D={f}" for f in fields)
    while True:
        url = f"https://api.airtable.com/v0/{AT_BASE}/{table_id}?pageSize=100&{params}"
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


# ---- name normalisation (mirror import.py: name was Airtable Name .strip()) --
# Archived names carried an "ARCHIVE " prefix that was cleaned in Supabase, so we
# strip it here too even though dated wears only reference the active table.
def norm(name):
    s = re.sub(r"^archived?\s+", "", str(name or "").strip(), flags=re.I)
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s or "untitled"   # import.py named blank Airtable records "Untitled"


# REST API (returnFieldsByFieldId=true): fields keyed by id; singleSelect is the
# option-name string, link fields are lists of record-id strings.
def cell(rec, fid):
    return rec.get("fields", {}).get(fid)


# ---- 1. Supabase items --------------------------------------------
status, body = sb("/rest/v1/items?select=id,user_id,name,status,brand,category,purchase_date,price&limit=5000")
if status != 200:
    sys.exit(f"items fetch: {status} {body[:300]}")
items = json.loads(body)
print(f"\n  Supabase items: {len(items)}")

# user_id to stamp on every wear (service key bypasses the auth.uid() default, so
# the NOT NULL column must be set explicitly). Prefer .env; else reuse items'.
OWNER_ID = env.get("IMPORT_USER_ID") or next((i.get("user_id") for i in items if i.get("user_id")), None)

by_name = defaultdict(list)
for it in items:
    by_name[norm(it["name"])].append(it)

# ---- 2. Airtable Clothing (the records dated wears can reference) ---
clothing = airtable_all(CLOTHING_TABLE, [F_CLOTH_NAME, F_CLOTH_BRAND, F_CLOTH_CAT, F_CLOTH_DATE, F_CLOTH_PRICE])
print(f"  Airtable Clothing: {len(clothing)}")

# ---- 3. Resolve each Clothing recId -> a single Supabase item id ---
# Greedy 1:1: each Supabase item is claimed by at most one Airtable record.
used = set()
rec_to_item = {}
unmatched, fallback = [], []


def pick(cands, rec):
    """Choose the best unused Supabase item for an Airtable clothing record.
    Returns (item_or_None, used_fallback). Dated wears only come from the active
    Clothing table, so a non-Archive candidate beats its archived namesake."""
    free = [c for c in cands if c["id"] not in used]
    pool = free or cands
    if len(pool) == 1:
        return pool[0], False
    pdate = cell(rec, F_CLOTH_DATE)
    price = cell(rec, F_CLOTH_PRICE)
    brand = (cell(rec, F_CLOTH_BRAND) or "").strip().lower()
    for keyfn in (
        lambda c: c.get("status") != "Archive",
        lambda c: pdate and c.get("purchase_date") == pdate,
        lambda c: price is not None and c.get("price") is not None and abs(float(c["price"]) - float(price)) < 0.005,
        lambda c: brand and (c.get("brand") or "").strip().lower() == brand,
    ):
        narrowed = [c for c in pool if keyfn(c)]
        if len(narrowed) == 1:
            return narrowed[0], False
        if narrowed:
            pool = narrowed
    # genuine duplicate (e.g. two archived namesakes) — pick deterministically so
    # the wear history isn't dropped; record it for review.
    return sorted(pool, key=lambda c: c["id"])[0], True


for rec in clothing:
    nm = norm(cell(rec, F_CLOTH_NAME))
    cands = by_name.get(nm, [])
    if not cands:
        unmatched.append({"id": rec["id"], "name": cell(rec, F_CLOTH_NAME)})
        continue
    chosen, used_fallback = pick(cands, rec)
    rec_to_item[rec["id"]] = chosen["id"]
    used.add(chosen["id"])
    if used_fallback:
        fallback.append({"id": rec["id"], "name": cell(rec, F_CLOTH_NAME), "chosen": chosen["id"]})

print(f"  Matched: {len(rec_to_item)}   Unmatched: {len(unmatched)}   Fallback-resolved: {len(fallback)}")

# ---- 4. Dates table -> wear events --------------------------------
dates = airtable_all(DATES_TABLE, [F_DATE_DAY, F_DATE_CLOTH])
print(f"  Airtable Dates: {len(dates)}")

USER_ID = OWNER_ID
seen = set()             # (item_id, day) dedupe — one wear per item per day
rows = []
future = 0
link_unmatched = 0
links_total = 0

for d in dates:
    day = cell(d, F_DATE_DAY)
    if not day:
        continue
    day = day[:10]
    if day > TODAY:      # skip planned/future outfits — those aren't wears yet
        future += 1
        continue
    for link_id in (cell(d, F_DATE_CLOTH) or []):   # list of clothing record-id strings
        links_total += 1
        item_id = rec_to_item.get(link_id)
        if not item_id:
            link_unmatched += 1
            continue
        key = (item_id, day)
        if key in seen:
            continue
        seen.add(key)
        row = {"item_id": item_id, "worn_on": day, "context": None}
        if USER_ID:
            row["user_id"] = USER_ID
        rows.append(row)

print(f"\n  Wear links seen: {links_total}   unmatched links: {link_unmatched}   future dates skipped: {future}")
print(f"  Wear rows to insert (deduped): {len(rows)}")
if rows:
    days = sorted({r['worn_on'] for r in rows})
    print(f"  Date range: {days[0]} .. {days[-1]}  across {len(days)} days")

(HERE / "wears_review.json").write_text(json.dumps(
    {"unmatched_items": unmatched, "fallback_resolved_items": fallback,
     "unmatched_link_count": link_unmatched, "future_dates_skipped": future,
     "wear_rows": len(rows)}, indent=2))
print(f"  -> wrote wears_review.json")

# ---- 5. Insert ----------------------------------------------------
status, body = sb("/rest/v1/wears?select=id&limit=1")
existing = len(json.loads(body)) if status == 200 else 0
# also get an exact count
status_c, body_c = sb("/rest/v1/wears?select=id", headers={"Prefer": "count=exact", "Range": "0-0"})

if not LIVE:
    print("\n  DRY RUN — nothing written. Re-run with --live to import.")
    if unmatched or fallback:
        print(f"  NOTE: {len(unmatched)} unmatched + {len(fallback)} fallback-resolved items — see wears_review.json.")
    print()
    sys.exit(0)

if existing and not FORCE:
    sys.exit(f"\n  wears table is NOT empty ({existing}+ rows). Re-run with --force to add anyway.\n")

if not USER_ID:
    sys.exit("\n  No user_id available (IMPORT_USER_ID blank and no items to borrow it from).\n")

inserted = 0
for i in range(0, len(rows), 200):
    batch = rows[i:i + 200]
    status, body = sb("/rest/v1/wears", "POST",
                      {"Content-Type": "application/json", "Prefer": "return=minimal"},
                      json.dumps(batch).encode())
    if status not in (200, 201):
        sys.exit(f"insert batch {i}: {status} {body[:300]}")
    inserted += len(batch)
    print(f"  inserted {inserted}/{len(rows)}")

print(f"\n  Done. {inserted} historical wears imported.\n")
