#!/usr/bin/env python3
"""Disaster recovery: re-upload a backup data.json into a Supabase project.

Usage:
    python3 migration/restore_backup.py migration/backup/2026-07-19/data.json
    python3 migration/restore_backup.py <data.json> --user <new-user-uuid>
    python3 migration/restore_backup.py <data.json> --force

Reads SUPABASE_URL + SUPABASE_SERVICE_KEY from migration/.env (service role).
SAFETY: refuses to touch any table that already has rows unless --force is
passed (this script is for restoring into an EMPTY/replacement project, not
for merging). --user rewrites user_id on every row — needed when restoring
into a NEW project where your auth user has a different id. Photos are not
handled here: re-upload the photo backup folder with the Storage UI or keep
the original bucket; image_path values in the data are preserved as-is.
"""
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
# FK-safe insert order.
TABLES = ["items", "outfits", "capsules", "wears", "outfit_items", "capsule_items", "exclusions"]
BATCH = 500


def read_env():
    env = {}
    with open(os.path.join(HERE, ".env")) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_KEY"]


def req(base, key, path, method="GET", body=None, prefer=None):
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{base}{path}", data=data, method=method, headers=headers)
    with urllib.request.urlopen(r) as resp:
        return resp.read()


def table_count(base, key, table):
    raw = req(base, key, f"/rest/v1/{table}?select=id&limit=1")
    return len(json.loads(raw))


def main():
    args = [a for a in sys.argv[1:]]
    force = "--force" in args
    if force:
        args.remove("--force")
    new_user = None
    if "--user" in args:
        i = args.index("--user")
        new_user = args[i + 1]
        del args[i:i + 2]
    if len(args) != 1:
        sys.exit(__doc__)
    with open(args[0]) as f:
        data = json.load(f)

    base, key = read_env()

    # Safety gate: every target table must be empty (or --force).
    if not force:
        occupied = [t for t in TABLES if data.get(t) and table_count(base, key, t) > 0]
        if occupied:
            sys.exit(f"REFUSING: {', '.join(occupied)} already contain rows. "
                     f"This restores into an empty project — pass --force only if you're sure.")

    for t in TABLES:
        rows = data.get(t) or []
        if new_user:
            for r in rows:
                if "user_id" in r:
                    r["user_id"] = new_user
        for i in range(0, len(rows), BATCH):
            chunk = rows[i:i + BATCH]
            req(base, key, f"/rest/v1/{t}", "POST", chunk, prefer="return=minimal")
        print(f"  {t}: {len(rows)} rows restored")
    print("Done. Verify counts in the app, then run a fresh backup.")


if __name__ == "__main__":
    main()
