---
name: deploy-wardrobe
description: Deploy the wardrobe app to GitHub Pages. Use when the user wants to ship/publish/deploy changes to index.html, or asks to make the latest changes live. Handles the APP_VERSION bump, commit, and push.
---

# Deploy the Wardrobe App

The app is static files on GitHub Pages off `origin/main`: `index.html`
(markup + ordered `<script src>` tags), `css/styles.css`, `js/01…20-*.js`.
No build step — what you commit is what runs. Deploying = check, bump version,
commit, push. Pages rebuilds in ~1–2 minutes.

## Steps

0. **Run the self-test — required for logic deploys, skipped for cosmetic ones.**
   The user does not want a browser opened for every push (preference 2026-07-20,
   narrowed 2026-07-25), so this is conditional. Decide it mechanically, not by
   feel — read the actual diff (`git diff`, plus staged/unstaged):

   **SKIP** only when every changed line is confined to:
   - the `<style>` block (pure CSS), or
   - `APP_VERSION` / `<meta name="app-version">` / `WHATS_NEW`, or
   - static markup or user-facing copy with no JS behaviour attached, or
   - files that aren't `index.html` (docs, skills, migrations).

   **RUN** for anything else. In particular, always run when the diff touches
   derivations or state: wear/day counting, laundry, formality, suggestions,
   stats pools and funnels, plans, capsules/trips, back-nav flags, filters.
   **Mixed diff = run.** When genuinely unsure, run it — 20 seconds beats a
   silent wrong number in her stats.

   The run itself, when required — nothing ships on a red or unknown result:

   1. `preview_start` with `{name: "wardrobe"}` (never `Bash` — dev servers go
      through the preview tools). Note the returned `tabId`.
   2. `navigate` that tab to
      `http://localhost:4173/migration/selftest.html?v=<something-fresh>`.
      The query string matters: the preview browser caches hard. (The harness
      cache-busts its own iframe, so the app under test is always current.)
   3. Read the result:
      ```
      javascript_tool: JSON.stringify({
        summary: document.getElementById('summary').textContent,
        fails: Array.from(document.querySelectorAll('#results li'))
          .filter(li => li.textContent.startsWith('✗')).map(li => li.textContent)
      })
      ```
   4. **Require `N/N passed` with an empty `fails` array.** Anything else —
      including "Loading app…" (the app script failed to parse) or a missing
      summary — stops the deploy. Fix the cause, re-run, then continue.
   5. `preview_stop` with the `serverId`.

   If a failure turns out to be a bug in the *test* rather than the app, say so
   explicitly and fix the test in the same deploy — don't wave it through. A
   test nobody runs is just a comment (that's how the harness sat at 89/90 with
   a broken case for a full round of deploys, 2026-07-25).

   **When you skip it**, still parse-check the inline script — a stray brace in
   a CSS-only deploy would white-screen the app. Extract the `<script>` blocks
   and run them through `new Function(src)` (parses without executing) under
   JavaScriptCore:
   `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc`
   — there is no `node`/`deno`/`bun` on this machine. Drive it from a short
   Python script into the scratchpad.

   Add a case to `migration/selftest.html` whenever a deploy proves something
   worth keeping true — including the deploys where the gate was skipped. The
   suite is only worth running because it keeps growing.

   **Say which one you did** in the summary. "Selftest 90/90" and
   "parse-checked, selftest skipped (CSS-only)" are different claims — never let
   "shipped" imply "tested".

1. **Bump `APP_VERSION`** in `js/01-config.js` (near the top, shown in the UI).
   Format is **`YYYY-MM-DD rN`** (matches the convention in CLAUDE.md):
   - If the current value's date is **before today** → set today's date with `r1`.
   - If it's **already today** → increment the `rN` (so multiple pushes the same
     day differ: `r1` → `r2` → …). Check the value in the LAST COMMIT
     (`git show HEAD:js/01-config.js | grep APP_VERSION`), not just the working
     tree — an earlier session may already have deployed today's `r1`. This
     happens for real: two sessions overlapped on 2026-07-25.
   The UI prints `APP_VERSION` verbatim.

   ⚠️ **The version lives in THREE places and all must match.** Bump them
   together, in one pass:

   ```bash
   # from the repo root — OLD and NEW as "2026-07-25 r13"
   sed -i '' 's/APP_VERSION = "OLD"/APP_VERSION = "NEW"/' js/01-config.js
   sed -i '' 's/content="OLD"/content="NEW"/' index.html          # <meta app-version>
   sed -i '' 's/?v=OLDNOSPACE/?v=NEWNOSPACE/g' index.html          # all 21 tags
   ```

   - `APP_VERSION` in `js/01-config.js` — what the UI prints.
   - `<meta name="app-version">` in `index.html` — `checkForNewVersion`
     Range-fetches the first 2KB of the deployed page and compares it against
     the running `APP_VERSION`. Diverge and users get a phantom "Update
     available" toast, or never see a real one.
   - the **`?v=` on every `js/`+`css/` tag** (21 of them, no space in the
     token: `2026-07-25r13`). This is the cache-bust. Miss one and Pages serves
     a fresh `index.html` next to a stale module — a half-updated app, which is
     worse than an un-updated one.

   Verify before committing — this is cheap and the failure is ugly:
   ```bash
   grep -c "?v=$(grep -o 'r[0-9]*"' js/01-config.js | head -1 | tr -d '"')" index.html
   ```
   The selftest also pins all three (`every js/ + css/ tag is cache-busted…`),
   which is the real backstop on a logic deploy.

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

- `index.html`, `css/`, `js/`, `manifest.json` and the icons are the live app —
  **stage `js/` and `css/`, not just `index.html`** (`git add -A` is safest; a
  commit that ships markup without its modules is a white screen). `.claude/`,
  `migration/`, `README.md`, `CLAUDE.md` are repo hygiene: safe to commit,
  no effect on the page.
- **Load order is the contract.** Adding a `js/` file means adding its
  `<script src>` tag in the right position — top-level `const`/`let` are shared
  across classic scripts, so a file can only use a binding declared in a file
  loaded earlier. Keep the numeric prefix and the tag order in sync.
- Never commit a Supabase **secret** key. Only the publishable key belongs in
  `index.html` (it's safe — RLS scopes it to the signed-in user).
- If the user reports the page is stale after a push, confirm the commit landed
  on `origin/main` and have them hard-refresh; Pages can lag a couple minutes.
