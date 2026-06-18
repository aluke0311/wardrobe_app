---
name: deploy-wardrobe
description: Deploy the wardrobe app to GitHub Pages. Use when the user wants to ship/publish/deploy changes to index.html, or asks to make the latest changes live. Handles the APP_VERSION bump, commit, and push.
---

# Deploy the Wardrobe App

The app is a single `index.html` hosted on GitHub Pages off `origin/main`.
Deploying = bump version, commit, push. Pages rebuilds in ~1–2 minutes.

## Steps

1. **Bump `APP_VERSION`** in `index.html` to today's date (`YYYY-MM-DD`) if this
   is a meaningful change and the version still shows an older date. It's a
   constant near the top of the `<script>` and is displayed in the UI.

2. **Stage and commit** with a clear, specific message describing what changed
   (not "update index.html"). End the commit body with:
   ```
   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   ```

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
