---
name: deploy-wardrobe
description: Deploy the wardrobe app to GitHub Pages. Use when the user wants to ship/publish/deploy changes to index.html, or asks to make the latest changes live. Handles the APP_VERSION bump, commit, and push.
---

# Deploy the Wardrobe App

The app is a single `index.html` hosted on GitHub Pages off `origin/main`.
Deploying = bump version, commit, push. Pages rebuilds in ~1–2 minutes.

## Steps

1. **Bump `APP_VERSION`** in `index.html` (a constant near the top of the
   `<script>`, shown in the UI). Format is **`YYYY-MM-DD rN`** (matches the
   convention in CLAUDE.md):
   - If the current value's date is **before today** → set today's date with `r1`.
   - If it's **already today** → increment the `rN` (so multiple pushes the same
     day differ: `r1` → `r2` → …). Check the value in the LAST COMMIT
     (`git show HEAD:index.html | grep APP_VERSION`), not just the working tree —
     an earlier session may already have deployed today's `r1`.
   The UI prints `APP_VERSION` verbatim.

   ⚠️ **Also bump the `<meta name="app-version">` tag in `<head>` to the SAME
   value** (added 2026-07-17). The in-app update check (`checkForNewVersion`)
   Range-fetches the first 2KB of the deployed page and compares that meta tag
   against the running `APP_VERSION` — if the two ever diverge, users get a
   phantom "Update available" toast (or never see a real one). One value, two
   places, always in lockstep.

   **Also refresh `WHATS_NEW`** (the const right under `APP_VERSION`, added
   2026-07-19): replace its bullets with 2–4 plain-language, user-facing lines
   describing what THIS deploy (or deploy batch) changes — it powers the
   one-time "What's new" toast after each update. Skip only for deploys with
   zero user-visible change (then leave the old bullets; the toast still
   shows once per version, so stale bullets are worse than repeated ones —
   when in doubt, update).

2. **Stage and commit** with a clear, specific message describing what changed
   (not "update index.html"). End the commit body with the standard
   `Co-Authored-By: Claude <model> <noreply@anthropic.com>` trailer for the
   current model.

3. **Push to main:**
   ```
   git push origin main
   ```
   This is the deploy. The repo + Pages already exist — never create new ones.

4. **Tell the user:**
   - Live URL: https://aluke0311.github.io/wardrobe_app/
   - Wait ~1–2 min, then **hard-refresh** (`Cmd+Shift+R`) — Pages caches hard.

## Notes

- Only `index.html` matters for the live app. `.claude/`, `README.md`,
  `CLAUDE.md` are repo hygiene and safe to commit but don't affect the page.
- Never commit a Supabase **secret** key. Only the publishable key belongs in
  `index.html` (it's safe — RLS scopes it to the signed-in user).
- If the user reports the page is stale after a push, confirm the commit landed
  on `origin/main` and have them hard-refresh; Pages can lag a couple minutes.
