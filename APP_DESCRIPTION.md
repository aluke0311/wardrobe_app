# Wardrobe App — full description

A complete, self-contained account of what this app is, what it does, and why it's
built the way it is. Written to be **portable**: you can paste the whole thing into
a fresh conversation, hand it to a designer, or read it yourself after six months
away, without needing any other file in this repo.

- **Live:** https://aluke0311.github.io/wardrobe_app/
- **Repo:** https://github.com/aluke0311/wardrobe_app
- **Current version:** `2026-07-25 r11`
- **Companion docs:** `USER_MANUAL.md` (how to use it) · `CLAUDE.md` (implementation
  reference) · `ROADMAP.md` (what shipped when, and every locked decision) ·
  `schema.sql` (canonical DB) · `STYLE_MODEL.md` (the formality model)

---

## 1. What it is, in one paragraph

A personal wardrobe tracker for exactly one person. You photograph everything you
own, log what you actually wear each day, and the app turns that history into
answers: what earns its place, what never leaves the closet, what you reach for
when it's 48° and raining, what you wore to the last three concerts. It also helps
forward — outfit suggestions, day and week planning, trip packing, and a laundry
model that knows what's dirty without being told. It is a **mirror first and a
stylist second**, and it is built so that the only ongoing effort is a one-tap
daily log.

## 2. Who it's for, and what that rules out

One user, on her own phone, using it daily for years. That single fact drives most
of the design:

- **No onboarding, no discoverability work, no empty-state tutorials.** She knows
  every feature. Optimize for the 700th use, not the first.
- **No multi-user, no sharing, no social, no accounts to manage.** Features that
  only make sense with an audience are out of scope.
- **Speed and low friction beat completeness.** A feature that requires periodic
  manual upkeep will be abandoned; the app has already lost fields this way
  (`storage_location`, `fit`, `length`, `rise` were all built, never maintained,
  and removed).
- **She accumulates, she doesn't prune.** 476 items and thousands of wears, almost
  nothing deleted. So: auto-maintenance beats manual upkeep, dedup must be
  automatic, and archive state is derived rather than cascaded.
- **Predictable navigation is doctrine.** Back returns where you visibly came from.
  Tapping a tab goes to that tab's root. Viewing something must not mutate browse
  state. This has been reaffirmed repeatedly and outranks saving taps.

## 3. The five governing principles

These are locked. New work is checked against them, and things that violate them
get flagged rather than quietly built.

1. **Single-user personal tool.** Not a product.
2. **Heuristics only — no AI backends.** The client ships only the Supabase
   publishable (anon) key, so a model key can never reach it. That rules out
   stylist chat, photo auto-tagging, background removal, and semantic search.
   "Smart" here means analytics and rules over the app's own data, plus **keyless**
   external data (Open-Meteo weather). Revisit only if the no-backend stance
   changes.
3. **Derive-first, capture-light.** Compute everything possible from what's already
   logged. Add a *captured* field only when it can't be derived AND a feature being
   built right now needs it. Capture subjective data at the moment of use, never as
   a per-item chore.
4. **One `index.html`.** The entire app — HTML, CSS, JavaScript — is a single
   ~15,900-line file. No build step, no framework, no bundler, no libraries, no CDN
   scripts. The only approved exceptions are `manifest.json` and two icon PNGs for
   PWA install. **No service worker, ever** (that would be a real second JS file).
5. **Plain `fetch` for everything.** No `supabase-js`, no HTTP wrapper library.

## 4. Architecture

**Frontend:** one static file, served by GitHub Pages off `origin/main`. Deploying
is `git push`. Mobile-first; installable to the home screen as a PWA.

**Backend:** Supabase free tier — Auth, PostgREST, and Storage. Every table is
row-level-security scoped to `auth.uid()`, which is what makes shipping the anon key
safe. Migrations are written as SQL files in `migration/` and run by hand in the
Supabase SQL editor.

**Photos:** private `wardrobe` bucket at `<user_id>/<uuid>.<ext>`. Display uses
signed URLs, but the bytes are cached locally in the Cache Storage API keyed by the
stable `image_path` — signed URLs rotate every session, so without that cache every
session re-downloaded every photo (this triggered a real egress-quota warning in
July 2026). Uploads are canvas-downscaled to 1200px and encoded WebP, with a JPEG
fallback for browsers that silently lie about WebP support.

**Offline / freshness:** after every load the full dataset is snapshotted into Cache
Storage, so a cold open paints instantly from the snapshot and revalidates behind
it. Returning to the app after five minutes (or across midnight) silently refetches
when the UI is at rest. There is no offline *write* queue — writes fail with an
honest message.

## 5. Data model

Eight tables. `schema.sql` is canonical.

| Table | What it holds |
|---|---|
| `items` | The closet. name, category, subcategory, brand, retailer, color_family, price, purchase_date, acquisition (New/Secondhand/Gift), size, fabric[], season[], **formality smallint[]**, status (Available/Storage/Archive), tags[], notes, url, image_path, last_washed, laundry_state |
| `wears` | The log. item_id, outfit_id (nullable), worn_on (date), context text[], formality_for (derived at log time) |
| `outfits` | Saved looks. name, notes, formality_override, **layout** JSONB (the drag-and-drop canvas), **rating** (`1` = liked), archived. Join table `outfit_items` |
| `capsules` | Named item sets and trips. kind, start_date, end_date, locations JSONB, **plan** JSONB (per-day outfit intentions). Join table `capsule_items(packed bool)` |
| `exclusions` | Item pairs that shouldn't be suggested together |
| `kv` | Small per-user app state as JSONB: day plans, the weather log, milestone bookkeeping, the taxonomy override |

**Two rules that matter more than they look:**

- **A wear is a DAY, never a row.** One outfit logged on one day writes one `wears`
  row *per piece*, so `rows.length` reads a five-piece look as five wears — and a
  context stamped on it as five separate outings. Every "N wears" number must dedupe
  on `worn_on`. A full audit in July 2026 found and fixed this in a dozen places;
  the helper `countByDay(rows, keyFn)` exists so new code gets it right.
- **Status is a lens, not a category.** A tee is always under Tops; Available /
  Storage / Archive is a filter over the whole closet, changed only on the item's
  own detail page. An empty status filter means **Available only**.

## 6. The design model

**Formality is a 1–8 ladder, and each item holds a SET of levels**, not a single
value — "where could I wear this?" answered yes/no per level, rather than a single
point on a scale.

1. Utility · 2. Very Casual · 3. Casual · 4. Polished Casual · 5. Smart Casual ·
6. Dressed Up · 7. Business Professional · 8. Formal

An outfit is valid at level L only if *every* piece's set contains L. Pure-Utility
items (set == `[1]`) never mix with anything else, which is what keeps gym clothes
and rain gear off normal days. Items without an explicit set get one imputed from
name keywords, a per-subcategory seed, and co-occurrence — shown as "est." so a
guess never masquerades as a fact.

There's also a derived **"home"** bucket: a look with no shoes is one you wore at
home, and that supersedes the computed level.

**Contexts** are named occasions (Work, Symphony, Church, Errands, Date Night,
Travel…) stamped on *wears*, not on items. The seed list is extensible — any
context she types becomes part of the vocabulary.

**Taxonomy** is category → subcategory (Tops, Bottoms, Dresses, Outerwear, Shoes,
Workout), and it's **editable in-app**: renames bulk-update every affected item.

**Sentinel tags** in `items.tags` carry per-item behavior without new columns:
`no-suggest`, `layer` (a top that also works as a layer), `gear:workout`,
`gear:rain` (only suggested when it's actually wet), `mend`, and `tol:<n>` (a
per-item laundry tolerance override).

## 7. What it does, screen by screen

Five tabs — **Home · Closet · Looks · Calendar · Stats** — plus **Capsules**, which
opens from a Home tile rather than the tab bar.

### Home
The daily loop and nothing else. A tile grid, a one-tap "Log today's wear" (which
becomes "✓ Logged today" once you have), and a **Tomorrow card** showing tomorrow's
plan or a generated outfit with the forecast. Below that, at most **one** thing
asking for attention — catch-up for missed days, a laundry question, a backup
reminder — with the rest folded into a quiet "N more things" line. On days it has
something, an "On this day" row from a previous year sits at the bottom.

In **trip mode**, Home is replaced by a trip dashboard: day counter, today's planned
looks with one-tap "wore it", suitcase weather, hamper status, and packing shortcuts.

### Closet
Status lens → category folders → subcategory → item grid, with adjustable density,
bulk select, a filter funnel, and **keyword search** across name, brand, retailer,
type, color, size, notes and tags. Special trays hang off the root: **Hamper**
(what's dirty), **Worn** (worn since washing but not dirty yet — the pile on the
chair), and **Mending**. Item detail is two views: a full-bleed photo view with the
fast actions, and an edit view behind it.

### Looks
Saved outfits, browsable through nine lenses: **Formulas · Formality · Season ·
Context · Capsule · Liked · Recent · All · Archived**. "Formulas" is the interesting
one — it discovers the outfit *shapes* you rebuild without noticing ("Blouse +
Jeans + Flats") and lets you generate a new outfit from that silhouette.

**Build-a-look** is a drag-and-resize canvas; arrangements persist as JSONB and are
reused as the thumbnail everywhere. Editing a look's pieces offers to reconcile its
most recent wear, so swapping the shoes in a look doesn't leave the old shoes
holding a wear they didn't earn.

### Calendar
Month grid with outfit collages; day view with swipe copy/move/delete, log pickers
for clothing or a saved look, a "wear again" chooser, and an "on this day" row.

### Stats
The centerpiece, and the reason the logging matters. Fifteen views:

- **Clothing / Looks stats** — counts, value, color bar, rotation, field breakdowns
- **Rotation** — what share of the closet actually came out in the last 30/90/365
  days, drillable into the worn and unworn halves
- **Report Cards** across seven dimensions (brand, retailer, subcategory, price
  bracket, purchase year, color, acquisition) — each scored by a tenure-normalized
  wear-rate index against comparable items, plus median $/wear and dud rate
- **Closet vs Life** — where the closet over- and under-serves the contexts you
  actually live in
- **Palette** — the colors you own beside the colors you actually wear
- **What's missing** — thin spots (a context is only as well served as its
  *thinnest* required slot) and mileage (what's done the most work)
- **Year in Review** — a card stack of the year's highlights
- **Year in pixels** — the whole year as one picture, a square per day shaded by
  how dressed up you were
- **Closet Review** — one card at a time to fill in missing fields, with inline
  pickers so there's no sheet-hop
- **Smart lists** — most/least worn, best/worst $/wear, Workhorses, Declutter
  candidates

## 8. The intelligence, and its honest limits

Everything below is rules and arithmetic over her own data. There is no model.

**Outfit suggestions** fill slots (Top or Dress + Bottom + Shoes + optional layer)
and score candidates on formality cohesion (a hard filter), explicit exclusions
(hard), loud-color and pattern-clash penalties, and a capped boost for color-pair
and item-pair affinity learned from outfits she's actually saved — with liked looks
counting double. Weather overrides the season heuristic when a forecast is
available. **There is deliberately no rotation or novelty weighting**: slots sample
randomly among things that plausibly match, because the user wanted variety, not a
nagging engine pushing neglected items. You can lock a piece, ban a piece for the
session, add or remove a layer, and constrain to a context, a formality, a capsule,
a discovered formula, or workout mode.

**Weather memory** is the one that most feels like intelligence and is the simplest
underneath: the app logs the daily forecast, backfills history from the ERA5 archive
in a single request, and then — given tomorrow's forecast — finds the past days that
actually *felt* like this and shows what she wore. It excludes trip days and the
last two weeks, and if nothing scores close enough it shows nothing at all, because
a bad match is worse than no match.

**Laundry** is derived, never entered. A piece is dirty when the number of distinct
wear-days since its last wash reaches a per-subcategory tolerance (tees 1, jeans ~5,
shoes and outerwear never). A null wash date means clean, so tracking opts in by
behavior rather than by a setup step. Wash loads mirror her real sorting — whites,
cools, warms — derived from color families.

**Planning** covers a day, a week, and a trip. Day plans support one outfit across
several contexts *and* several outfits in one day. The week planner pre-fills each
day with that weekday's usual contexts, derived from history — shown as a guess, and
never saved until tapped.

**Milestones** fire at most once per log and each exactly once ever: a first outing,
a piece crossing under $1 a wear, something back after months, a 25th day out, a new
longest streak.

**What it does not do, on purpose:** predict when clothes wear out (there's no
durability model, and the mileage list says so), tell you what to buy from a
manually-entered wishlist, rate outfits down (👎 was rejected), or nag. Nudges are
allowed if derived, time-bound and dismissable, but the app never interrupts.

## 9. Development and deployment

Edit `index.html`. Bump `APP_VERSION` (`YYYY-MM-DD rN`) **and** the matching
`<meta name="app-version">` tag — they must stay in lockstep or the in-app update
check misfires. Refresh the `WHATS_NEW` bullets. Commit, push to `origin/main`,
GitHub Pages rebuilds in a minute or two, hard-refresh to clear its cache.

Local preview is `python3 -m http.server 4173`, but auth and data only work against
the real HTTPS deploy, so locally you get the login screen. There is **no browser
testing during builds** by explicit preference. Verification is:

- a syntax check that parses the inline script without executing it (JavaScriptCore
  is available on macOS even with no Node installed), and
- `migration/selftest.html`, a harness that loads the app in an iframe and asserts
  the derivation logic — **90 cases** as of r11, covering trip phases, sort keys,
  laundry, formality, weather matching, milestones, rhythm, search, palette and
  back-navigation.

⚠️ **The selftest is currently written but unrun.** Treat "shipped" as
"syntax-verified and reviewed", not "tested", until someone opens it.

## 10. History in one paragraph

Rebuilt from scratch in June 2026 (an older v25 survives at the `v25-full` git tag,
and should not be used as a reference). 476 items, ~4,000 historical wears and
1,543 outfits were imported from an Airtable base. Since then it has shipped in
themed rounds, each planned as a written spec with locked decisions before any code:
the style model and suggestions engine, a unified filter system, hearts, weather,
report cards, laundry, trip mode, data safety, a full editorial redesign with dark
mode, planning and "Tomorrow", outfit formulas, and — most recently — weather
memory, milestones, weekly rhythm, closet search, and the palette and gap pages.
`ROADMAP.md` holds every round with its reasoning intact; the decisions in it are
treated as settled and not re-litigated without new evidence.
