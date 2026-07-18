#!/usr/bin/env python3
"""Full offline backup: every table as JSON + every photo from the private bucket.

Usage:  python3 migration/backup_photos.py
Reads SUPABASE_URL + SUPABASE_SERVICE_KEY from migration/.env (service role —
bypasses RLS; NEVER ships to the client). Output goes to
migration/backup/<YYYY-MM-DD>/ :
    data.json            all seven tables
    photos/<user>/<file> original photo bytes (skips files already downloaded)

Stdlib only — no pip installs. Safe to re-run; photo downloads are incremental.
"""
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BUCKET = "wardrobe"
TABLES = ["items", "wears", "outfits", "outfit_items", "capsules", "capsule_items", "exclusions"]


def read_env():
    env = {}
    try:
        with open(os.path.join(HERE, ".env")) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        sys.exit("migration/.env not found — it must hold SUPABASE_URL and SUPABASE_SERVICE_KEY")
    if not env.get("SUPABASE_URL") or not env.get("SUPABASE_SERVICE_KEY"):
        sys.exit("migration/.env is missing SUPABASE_URL or SUPABASE_SERVICE_KEY")
    return env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_KEY"]


def req(url, key, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(r) as resp:
        return resp.read()


def fetch_table(base, key, table):
    """Page through PostgREST (1000-row cap per request)."""
    rows, offset = [], 0
    while True:
        raw = req(f"{base}/rest/v1/{table}?select=*&limit=1000&offset={offset}", key)
        page = json.loads(raw)
        rows.extend(page)
        if len(page) < 1000:
            return rows
        offset += 1000


def list_bucket(base, key, prefix=""):
    """Recursive listing of the storage bucket."""
    paths = []
    offset = 0
    while True:
        raw = req(f"{base}/storage/v1/object/list/{BUCKET}", key, "POST",
                  {"prefix": prefix, "limit": 100, "offset": offset})
        entries = json.loads(raw)
        for e in entries:
            name = f"{prefix}{e['name']}" if not prefix else f"{prefix}/{e['name']}"
            if e.get("id") is None:  # folder
                paths.extend(list_bucket(base, key, name))
            else:
                paths.append(name)
        if len(entries) < 100:
            return paths
        offset += 100


def main():
    base, key = read_env()
    from datetime import date
    out_dir = os.path.join(HERE, "backup", date.today().isoformat())
    os.makedirs(out_dir, exist_ok=True)

    print("Fetching tables…")
    data = {t: fetch_table(base, key, t) for t in TABLES}
    data_path = os.path.join(out_dir, "data.json")
    with open(data_path, "w") as f:
        json.dump(data, f)
    counts = " · ".join(f"{t} {len(rows)}" for t, rows in data.items())
    print(f"  wrote {data_path}  ({counts})")

    print("Listing photo bucket…")
    paths = list_bucket(base, key)
    print(f"  {len(paths)} photos")
    photo_dir = os.path.join(out_dir, "photos")
    done = skipped = failed = 0
    for p in paths:
        dest = os.path.join(photo_dir, p)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            skipped += 1
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        try:
            blob = req(f"{base}/storage/v1/object/{BUCKET}/{p}", key)
            with open(dest, "wb") as f:
                f.write(blob)
            done += 1
            if done % 25 == 0:
                print(f"  …{done} downloaded")
        except Exception as e:  # keep going; report at the end
            failed += 1
            print(f"  FAILED {p}: {e}")
    print(f"Done. {done} downloaded, {skipped} already present, {failed} failed.")
    print(f"Backup folder: {out_dir}")


if __name__ == "__main__":
    main()
