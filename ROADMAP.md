# ROADMAP — Wardrobe App

> Read `CLAUDE.md` (architecture + conventions) and `schema.sql` (DB) alongside this.
> Current version: **2026-07-25 r18**. Round D "Where You Were" shipped r14 and
> was then hardened live against her real data across r15–r18 (see the r15–r18
> section below — every round was a response to a real failure she reported).
> ▶ NEXT UP: **Round D.3 "Answer, don't audit" (r19)** — planned by Fable
> 2026-07-25 (below), awaiting her answers to 3 questions, then Opus builds.
> The only other carried-over item is the **Formulas remainder**, gated on
> tuning `FORMULA_MIN_LOOKS`/`FORMULA_MIN_WEARS` against her real data first.

---

## ▶ PLANNED — Round D.3 "Answer, don't audit" (r19)

**Planned by Fable 2026-07-25 after a step-back review of the whole r14→r18
arc. Two live bugs, one latent bug, and a reframe of the surface. The
detection MATH stays — it converged through r15–r18 into something defensible
and 136-case-tested. What keeps failing is the FRAME: this was built as an
audit (a list of accusations) when the job is answering questions about days.
Every complaint she filed is a workflow complaint: can't see the days, can't
fix things from where she's looking, "I was home" dead-ends, buttons buried.**

### The step-back verdict (why not a different system)

Considered honestly, because she asked:
- **Rebuild the detectors?** No. Each patch round fixed a real, named flaw
  (own-spread bars, span+density clustering, null-day hygiene, signal
  separation, no-proposal-no-flag) and each is pinned by tests. A rewrite
  re-earns those lessons from scratch.
- **A provenance ledger** (every derived value carries evidence + override)?
  Overkill — the day view + review notes already deliver the visible/revisable
  part, and the app's derive-first philosophy means most values should stay
  fluid, not pinned.
- **The keeper from the "different system" thinking:** the one real unknown is
  WHERE SHE WAS. Given that, everything else is derivation, not detection. So
  promote day classification to a first-class three-state — **away / home /
  unknown** — make it visible, and let "unknown" be an honest answer instead
  of a presumption of home. The audit's job then shrinks to: surface suspect
  windows as QUESTIONS, and leave a small residue of one-tap tag fixes.
  That is a reframe of the existing surface, not a new engine.
- **Sheet vs full screen:** keep sheets. The stacking bug (below) is a
  one-line DOM-order fix, and the day view fits a sheet fine. A stats-screen
  queue is the fallback if sheets keep chafing — not now.

### Step 1 — Fix the buried field sheet (her bug 1, root-caused)

Every sheet wrapper is `z-index: 301` (backdrop 300), so **DOM order decides
the stack**. `#whereSheet` and `#wxAuditSheet` were appended LAST in
index.html — after `#fieldSheet` — so "Edit season" / "Season ✎" genuinely
opens the field sheet UNDERNEATH the audit sheet. It has worked all along;
she just couldn't see it. ("✈️ I was away" worked because that path hides the
audit sheet first — which is also the diagnostic that confirms this.)
**Fix:** move the `#whereSheet` + `#wxAuditSheet` wrapper divs ABOVE
`#fieldSheet` in index.html. Nothing else changes; the `_fieldOnSave`
callbacks already refresh the audit list underneath.
**CLAUDE.md gotcha to add:** sheets stack by DOM order; a sheet that must
open OVER another must be declared LATER in index.html; `#fieldSheet` should
stay last among sheets that host field edits.

### Step 2 — "I was home" keeps her working (her bug 2)

Both home buttons (trip card + day view) currently persist and bounce back to
the audit root — a dead end. New flow: persist → toast **with Undo** (removes
the range) → **stay in / open the day view for that window** in a `home` mode:
banner "Marked as home ✓ — the weather stands. If a piece's season looks
wrong below, fix it here." For each piece with an EXPLICIT season and a
computable proposal (`seasonForTemp` over the window's day temps, minus its
tags), show the one-tap "＋ Add X" chip beside "Season ✎".
**Untagged pieces get no chip, deliberately** — their season is derived and
self-correcting, one odd home day doesn't move a ≥15%-share derivation, and
setting a season would permanently replace the derivation with a fixed answer
(the day view already labels these "worked out, not set"). [Q1 below.]

### Step 3 — Deleting/undoing a location answer must revert the weather
(latent bug, found while planning)

`removeWhereEntry` deletes the range but leaves its days stranded with
`away:1` + the away location's weather — the correction outlives the answer
that justified it. **Fix:** `revertAwayWeather(r)` mirroring
`correctAwayWeather(r)`: fetch HOME weather for the span, merge (rebuilt
entries carry no `away` flag), then re-run `correctAwayWeather` for any
REMAINING away ranges that overlap the span (so deleting one of two
overlapping answers doesn't wipe the survivor). Call it from:
`removeWhereEntry`, the new home-toast Undo (step 2), and a new Undo chip on
the where-sheet save toast. Fire-and-forget like its mirror; `_wxAudit = null`
after each.

### Step 4 — Make the three-way day state visible (small, no nudges)

- `dayStatus(date, ranges?, home?)` → `"away" | "home" | "unknown"` helper
  (pure, selftest-facing); day view day-headers show 🏠 on confirmed-home days
  (away days already show the place).
- Settings "Where you've been" card gains one muted line: "N worn days still
  unaccounted for — the health check asks about the suspicious ones." Count =
  distinct wear-days not inside away ∪ home ranges. Visibility only — no
  queue, no badge, no Home-screen anything (her no-nudges ethos). [Q2 below.]
- Docs: the kv key stays `wxaudit_home` (data exists) but is documented as
  the **homelog** — first-class data consumed by the detectors, not a
  dismissal list.

### Step 5 — Selftest + docs

Cases: `dayStatus` three states · revert-then-reapply overlap logic via
`mergeWxDays` (pure: away merge → home revert clears the flag → surviving
overlap re-applies) · unaccounted-days count · home-mode proposal chips only
on explicitly-tagged pieces. The sheet-order fix is browser-verified (open
audit → Edit… → field sheet visibly on top), not selftested. CLAUDE.md gotcha
+ Round D entry update, ROADMAP flip, memory per [[close-out-routine]].

### Open questions (answer before Opus builds)

1. **Untagged pieces after "I was home":** plan says no season chip (one odd
   day shouldn't fix a tag; derivation ignores it). OK, or do you want a
   "Set season…" shortcut there anyway?
2. **The "N days unaccounted for" line:** visibility only this round, or do
   you want a way to browse them (e.g., a dimmed calendar overlay)? Plan says
   visibility only.
3. **Detector accuracy check:** after re-running "Look up past weather" on
   r18, are the remaining flags/windows sane on your real data? If something
   still looks wrong, name one wrong flag and what you'd have wanted it to
   say — that decides whether this round is UI-only (as planned) or needs one
   more detector change.

---

## ✅ SHIPPED — Round D hardening against her real data (2026-07-25, r15→r18)

Four same-day rounds, each answering a failure she reported live. Selftest
112 → 136. Full reasoning in the commit messages (e6067c1, 068aa07, b80e232,
22719cf); the lessons, briefly:
- **r15** — her St Lucia dress wasn't flagged: for an uncorrected away day the
  stored (home) weather and the calendar AGREE, so a trip-only piece is
  structurally invisible to tag-checking. Added `buildDayWxAnomalies`: the
  OUTFIT vs the day (sandals with years of summer habit on a "25°" day), with
  votes weighted by habit strength — a trip-only piece's habit IS the wrong
  weather, so it abstains.
- **r16** — "huge swaths of dates": judging pieces against their MEDIAN at a
  flat 30° bar made every cold snap read as travel (jeans median 55° vs a real
  18° day); clustering chained transitively across months. Now: own-spread
  bars (max(30°, 1.5·IQR)), span cap 24d, density ≥ 0.5. Plus the day view
  ("See these days"), I-was-home, and review integration, all her asks.
- **r17** — "some dates have 0°/0°": Open-Meteo nulls, `Math.round(null)`=0 —
  archive gaps stored as hard freezes, poisoning bands/profiles/detector at
  once. `_wxDay` drops nulls at the source; `purgeNullWxDays` clears stored
  artifacts. Flags gained `fit`/`missing` ("that's Winter weather here");
  day view names the exact culprit with arithmetic. And trip guesses stopped
  being fed by flagged items' histories — a mis-tagged winter coat's own
  consecutive cold-day wears had been clustering into spurious trips.
- **r18** — "nothing I can do about these flags": no-proposal-no-flag (a flag
  whose suggested seasons are already tagged is dropped), temp margin scales
  with the claimed season's own spread, one-tap "＋ Add Winter". Each flag
  kind proposes in the same currency as its evidence (temp→temperatures,
  calendar→calendar) — using temperature for both silently suppressed the
  calendar flag, caught by tests.

---

## ✅ SHIPPED — Round D "Where You Were" (planned + built 2026-07-25, r14)

**Planned by Fable, built by Opus the same day, shipped as ONE deploy (r14).
Selftest 91 → 112 and — unlike the last several rounds — actually RUN: 112/112
green, plus a browser smoke-test of the audit sheet, the Where sheet, and the
trip-guess → date-prefill handoff.** Implementation names are in CLAUDE.md's
Round D entry; the plan below is kept for the reasoning.

**Deviations, all deliberate:**
- The per-range helper is **`correctAwayWeather(r)`**, not `backfillAwayRange`.
- **One deploy, not eight.** The plan's per-step cadence was insurance against
  having no browser; with a green selftest available, a single reviewed diff was
  the safer option rather than the riskier one.
- **`daysBetween(a, b)` had to be written** (`js/03-state.js`) — the plan assumed
  it existed. Only `daysSince` did.
- **`SEASON_BAND_TRIM` was added and is load-bearing.** Not in the plan: the new
  tests caught untagged away days inflating the very band they'd be measured
  against (an 8-day warm-December fixture moved Winter p90 27° → 84°, silently
  disarming the detector). Percentiles are now taken after a ±35°F trim around
  the median. This is the round's one genuine design change under test pressure.
- **The "guilty" day set is per flag kind** (out-of-band for `temp`,
  out-of-season for `calendar`). The plan said "days outside the claimed bands"
  for both; implemented that way, a warm December week reads as Winter on the
  calendar, so the set came back empty and the trip cluster never formed.

**Where it surfaces** (asked on the day, worth writing down): the audit is
behind **Settings → Run data health check → "Season tags that disagree with the
weather" → Review**, and that row is **hidden at zero** like every other health
row. It also needs the away-corrected backfill to have run, and it only judges
items with an **explicit** season — derived-season items self-heal through
`effectiveSeasonOf` instead. Order for a first run: log where you've been →
"Look up past weather" → health check.

---

### The plan as locked (kept for the reasoning)

Read CLAUDE.md's Round C entry first — this round builds directly on the
WEATHER MEMORY machinery (`js/06-home.js`).

### The ask, and the insight underneath it

Her ask: *flag where an item's season and its "usually worn" weather contradict —
might mean the season is wrong, might mean the weather is wrong (e.g. St Lucia at
Christmastime) — and let me log locations & dates.*

The insight that shapes the whole round: **`backfillWxLog()` reconstructs weather
at her HOME location for every date.** A wear-day in St Lucia is recorded with
home December weather. So the weather record is corrupted for away days, which
means (a) `itemWxProfile` is polluted (a sundress worn on warm-winter trips gets
cold temps in its band), (b) any season/weather contradiction detector built on
the raw log would argue from bad evidence, and (c) the existing `similarDays`
trip-exclusion was really a workaround for this corruption. Fix the record
first, then detect contradictions, then spend the payoff.

### Locked decisions (user, 2026-07-25)

1. **Away wears DO count toward an item's temp profile** — with their true
   local temps. "Usually worn 80°+" is about the item's temperature niche,
   wherever that niche was visited.
2. **Away wears DO count toward "you've dressed for this before"** — once their
   weather is location-corrected, badged with the place name. This
   deliberately supersedes Round C's blanket trip-exclusion in `similarDays`:
   that exclusion existed because those days' recorded weather was home
   weather; correction removes the reason. The only days still excluded are
   away days the app CANNOT correct (a dated trip with no location).
3. **Derived seasons go "fancy"**: an away wear-day maps to the home season its
   *temperature* resembles (the St Lucia Christmas sundress derives as Summer,
   not Winter). Calendar season is what the field *means*; temperature is what
   it's *for*.
4. **Layer 3 (temperature-eligible trip suggestions) is in scope this round**,
   as the last step.
5. She explicitly wants to **enter past travel dates** — most past trips do NOT
   exist as dated capsules. The "Where you've been" editor (step 1) and the
   audit's trip-guess cards (step 6) are both first-class entry points for
   backfilling them, not afterthoughts.

### Data model (no schema change — everything rides the existing `kv` table)

- **`kvData("wherelog")`** = array of `{from, to, name, lat, lon}` — manually
  entered away ranges. Dates ISO `YYYY-MM-DD`, inclusive. `name` is the display
  string (fold geocode `admin1`/`country` in at save time, e.g. "Castries,
  St Lucia"). Never pruned — history is the point.
- **`wxlog` entries gain optional fields**: `{maxT, minT, code, away: 1,
  loc: "St Lucia"}` on days corrected to an away location. Absence of `away`
  = home weather, exactly today's shape — fully backward compatible.
- **`kv "wxaudit_ok"`** = `{itemId: "<JSON of items.season at dismissal>"}` —
  the "it's fine" seen-set. A flag is suppressed while the item's explicit
  season is unchanged from the stored signature; editing the season re-arms it.

- **`awayRanges()`** (new, `js/06-home.js` beside `wxLog`) — the single derived
  reader every consumer uses: dated trips' locations ∪ wherelog, as
  `[{from, to, name, lat, lon, src: "trip"|"log"}]`. For a capsule: each
  location with its own `from`/`to` uses those (clamped to trip dates); a
  single location without `from`/`to` covers the whole trip; **multiple
  locations all missing `from`/`to` → contribute NO ranges** (ambiguous —
  those days stay uncorrectable, and `similarDays` will exclude them).
  Trips first, then wherelog, so a wherelog entry overwrites a trip's weather
  where they overlap (applied in order during backfill).

### Steps — one deploy each (deploy-wardrobe skill), dependency order

**Step 1 — Wherelog + editor.** `WHERELOG_KEY = "wherelog"` (const beside the
WX_ constants). `awayRanges()` as specced above. Settings gains a **"Where
you've been"** card (below the Weather history card, `js/19-wiring.js`
`renderSettings`): lists `awayRanges()` newest-first — trip-sourced rows
labeled "· from trip" and not deletable there; wherelog rows get a ✕. "+ Add
somewhere" opens **`#whereSheet`** (new sheet wrapper in `index.html`; ⚠️ add
the id to `uiCanRefetch()`'s wrapper list; open/close ONLY via
`showSheet`/`hideSheet`): text input → `geocodeLocation(q)` (exists,
`js/18-weather.js`) result list → pick → from/to date inputs (validate
`from <= to`, both required, and `to` not in the future) → Save appends to
kv wherelog. Accept `{from, to}` prefill args — step 6's trip-guess cards use
them. Overlapping ranges are allowed silently (later wherelog entries win by
apply order). No weather fetch yet — that's step 2.

**Step 2 — Location-true weather.** Extract the merge in `backfillWxLog` into a
**pure `mergeWxDays(log, fetched, {today, keepAfter, away, loc, floor})`**
(returns `{log, n}`, no globals — selftest-facing). Then: `backfillWxLog()`
gains a second pass — for each `awayRanges()` range intersecting
`[floor, today]`, `fetchWeatherRange(r.lat, r.lon, clampedFrom, clampedTo)` and
merge with `{away: 1, loc: r.name}`, **unconditionally overwriting** those days
(the 15-day forecast-protection guard applies only to home days; on an away day
the home forecast is wrong by construction). New **`backfillAwayRange(r)`** =
fetch + merge + `kvSet` for one range; call it fire-and-forget after every
wherelog save in step 1's sheet (toast "Weather corrected for N days"). Also
call the full `backfillWxLog()` on the existing Settings button as today —
idempotency already holds. Daily live logging (`loadHomeWeather`) is untouched:
if she's traveling *today*, trip mode + a dated trip will correct it on the
next backfill; not worth live plumbing.

**Step 3 — Season bands + fancy derivation.**
- **`seasonBands(log?)`** (`js/06-home.js`): over non-away log days, per
  calendar season: `{p10, p25, median, p75, p90, n}` of `maxT`. Memoize on the
  wxlog object reference (`_seasonBands`, recompute when `wxLog()` identity
  changes). A season with `n < 15` returns null and every consumer falls back
  to calendar behavior for it.
- **`effectiveSeasonOf(dateStr, log?, bands?)`**: if `log[date]?.away` and
  bands are usable → the season minimizing `|maxT − bands[s].median|`; else
  `seasonOf(dateStr)`.
- **`itemSeasonSet(i, wearRows?, log?, bands?)`** (`js/12-looks.js`): same
  optional-args pattern `contextFormalityLevel` got in Round C. Swap
  `seasonOf(w.worn_on)` → `effectiveSeasonOf(w.worn_on, log, bands)`. Hot
  filter path — the per-call cost is one object lookup + ≤4 compares; bands
  are memoized, do NOT rebuild them per item. (12-looks loads after 06-home;
  call-time use is fine per the load-order contract.)
- `itemWxProfile` needs **no code change** — it reads temps from the log, which
  step 2 made true. Note this in its comment.

**Step 4 — `similarDays` inclusion rule.** Replace the blanket trip-range
exclusion (`js/06-home.js:113-121`) with: build the away-range list from
`awayRanges()` (keep the injectable `trips` arg working — rename it `ranges`,
update the selftest fixture); **exclude a date only if it falls in a range AND
`log[date]?.away` is not set** (i.e. known-away but uncorrected). Corrected
away days flow through and carry `loc` into the result row;
`wxMemoryRowHtml` appends ` · ${loc}` to the tile's date/temp line when
present. Update the comment — the locked decision it cites is superseded by
this round's decision 2.

**Step 5 — The detector.** Pure, injectable, in `js/06-home.js` after
`itemWxProfile`. Constants: `WXA_MIN_DAYS = 6` (min weather-matched wear-days
to judge an item), `WXA_CAL_SHARE = 0.2`, `WXA_TEMP_MARGIN = 3` (°F),
`WXA_GAP = 3` / `WXA_RUN_MIN = 2` (trip clustering).

`buildSeasonWxFlags({pool?, wearRows?, log?, bands?, ranges?, dismissed?})` →
`{flags, tripGuesses}`:
- Per Available item with an **explicit** `season` and ≥ `WXA_MIN_DAYS`
  distinct weather-matched wear-days (⚠️ a wear is a DAY — dedupe `worn_on`):
  - **`calendar` flag**: share of wear-days whose `effectiveSeasonOf` lands in
    the claimed set < `WXA_CAL_SHARE`. Evidence: "Marked Winter — but only 1 of
    14 worn days felt like winter."
  - **`temp` flag**: item's worn-temp p10 > (max over claimed seasons' band
    p90) + `WXA_TEMP_MARGIN` → worn hotter; or item's p90 < (min claimed band
    p10) − margin → worn colder. Evidence: "Marked Summer — usually worn
    28°–49°; your summers run 68°–90°." Skip seasons whose band is null.
  - An item gets at most ONE flag (`temp` wins over `calendar` — it's the
    stronger evidence). Suppress if `dismissed[itemId] ===
    JSON.stringify(i.season)`.
  - Items with NO explicit season get no flag — decision 3 already self-heals
    their derivation.
- **`tripGuesses`**: pool every flagged item's *contradicting* days (the days
  outside the claimed bands) that are NOT already inside `awayRanges()`; sort;
  greedy-cluster with gaps ≤ `WXA_GAP` days; keep clusters with ≥
  `WXA_RUN_MIN` distinct dates → `{from, to, dates, itemIds}`. This is the
  "might mean the weather is wrong" branch made automatic: contradicting days
  that cluster into one date window across items look like a trip, not thirteen
  mislabeled garments.

Session cache `wxAuditFlags()`: memoize on the stamp
`` `${wears.length}:${Object.keys(wxLog()).length}:${items.length}` `` — cheap
and safe; season edits bust it via the length-stable stamp? No — they don't, so
ALSO null `_wxAudit` in `saveField` when `field === "season"` and in the two
audit-resolution actions. That's 3 explicit sites; grep confirms.

**Step 6 — Surfaces + resolutions.**
- `runDataHealthCheck()` (`js/19-wiring.js:328`) gains a row: "Season vs
  weather: N items look off" → **`openSeasonAuditSheet()`** (`#wxAuditSheet`,
  same index.html + `uiCanRefetch` chores as step 1).
- Sheet layout, top to bottom: **trip-guess cards first** ("Were you away
  Dec 20–27, 2025? 4 items were worn in weather that doesn't match here." →
  tap opens `#whereSheet` prefilled with that range; on save, the audit
  recomputes and those flags dissolve on their own — that's the payoff moment).
  Then per-item rows: thumb (`thumbHtml`), name, the evidence sentence, and
  two actions: **"Edit season"** → `openFieldEdit(id, "season")`; **"It's
  fine"** → write `wxaudit_ok[itemId] = JSON.stringify(i.season)`, re-render.
- Item photo view (`js/09-item-detail.js:252-255`, beside the "Usually worn"
  line): when `wxAuditFlags()` has this item, a warn line
  ("⚠ Marked Winter, usually worn 70°+") that opens the audit sheet. Muted
  styling, `var(--muted)` — this is an audit note, not an alarm; **no
  hardcoded colors** (token rule).
- No Home card, no nudge. This surfaces only where she goes looking.

**Step 7 — Temperature-eligible suggestions (Layer 3).** The existing flaw: a
December St Lucia trip's planner passes `season = seasonOf(tripDate)` =
"Winter", and `inSeason` filters the sundress out of the pool before the wx
override in `scoreCombo` ever sees the 84° forecast. Fix:
**`inSeasonWx(i, season, wx)`** (`js/12-looks.js` beside `inSeason`) =
`inSeason(i, season) || (wx?.maxT != null && p = itemWxProfile(i.id) && wx.maxT
>= p.lo − WXA_RESCUE_MARGIN && wx.maxT <= p.hi + WXA_RESCUE_MARGIN)`;
`WXA_RESCUE_MARGIN = 5`. **Rescue-only — it widens the pool, never narrows
it**; items without a profile behave exactly as today. Use it in
`suggestOutfits`' pool filter, `swapSuggestionPiece`, and `addSuggestionLayer`
wherever both `season` and `wx` are in hand. No UI change.

**Step 8 — Selftest + docs.** New cases (injectable args throughout; remember
the iframe-realm `W.Set` gotcha and: **write the case AND RUN it in the same
session** — the 89/90 lesson; if there is genuinely no browser this session,
`jsc` parse-check per [[verify-cli-not-preview]] and say plainly shipped ≠
tested):
- `seasonBands` percentile math on a synthetic log; `n < 15` → null band.
- `effectiveSeasonOf`: away 85° December day → Summer; same day non-away →
  Winter; null bands → calendar fallback.
- `itemSeasonSet` fancy path: 5 away winter wears at 85° derive Summer.
- `mergeWxDays`: away overwrite beats the 15-day forecast guard; home merge
  still respects it; floor pruning.
- `similarDays`: corrected away day included with `loc`; uncorrected trip day
  excluded; home behavior unchanged.
- `buildSeasonWxFlags`: one fixture each for `calendar` flag, `temp` flag
  (both directions), temp-beats-calendar precedence, dismissal suppression,
  and a trip-guess cluster (3 items, one December week).
- `inSeasonWx`: rescue inside margin, no rescue without profile, never
  narrows.
Then: CLAUDE.md Round D entry (implementation names + the superseded
`similarDays` decision), flip this section to ✅ SHIPPED with deviations noted,
memory update per [[close-out-routine]].

### Gotchas that will bite this round specifically

- Two new sheet wrappers → both ids into `uiCanRefetch()`, open/close only via
  `showSheet`/`hideSheet`.
- `?v=` cache-bust on all touched `js/` tags + the 3-way version lockstep —
  the deploy skill does it; don't hand-roll.
- `itemSeasonSet` is called inside `matchesSeason` inside filter loops — bands
  must stay memoized; never rebuild per item.
- `similarDays`' injectable `trips` arg is pinned by existing selftest cases —
  update fixtures in the same commit as the rename.
- Open-Meteo costs: one `fetchWeatherRange` per away range, once, ever
  (idempotent). No new recurring fetches.

---

## ✅ SHIPPED — Round C deferred list (2026-07-25, r9→r10)

Both items she'd answered "yes, next round" to, built straight after Round C.

**r9 — Palette** (`buildPaletteStats` / `renderStatsPalettePage`, `statsView
"palette"`, row in Looks Stats beside Closet vs Life). Share of pieces OWNED per
colour family against share of pieces WORN; two stacked bars, then a row per family
sorted by the gap, tapping through to that colour's items.
⚠️ **The unit is PIECE-DAYS** — each piece counted once per day it went out. This is
the only unit comparable to a per-item closet share: wear rows would double-count
(the app-wide "a wear is a DAY" rule) and wear-DAYS would flatter accent colours
that only ever appear one piece at a time. Same unit `buildWrappedStats` calls
`pieceDays`; **the UI never calls this number "wears"**. Colourless pieces are
excluded from both sides so the columns stay comparable and each totals 100%.

**r10 — What's missing** (`buildThinSpots` / `buildMileage` /
`renderStatsMissingPage`, `statsView "missing"`). Strictly read-only and derived —
the before-you-buy manual-entry check stays rejected, so nothing here asks for input.
- **Thin spots:** per context above `GAP_MIN_CTX_DAYS`(5), count Available pieces
  covering its formality **per slot** and report the thinnest (`GAP_SLOT_FLOOR`=3).
  An outfit needs a top AND a bottom AND shoes, so a context is only as served as
  its binding slot — twelve Dressed-Up tops are worth nothing against one pair of
  shoes. Dresses count toward top and bottom both. This is the insight only this
  app can derive, and the reason the page isn't just "Closet vs Life again".
- **Mileage:** `MILEAGE_MIN_DAYS`(25)+ wear-days, sorted desc, with age and $/wear.
  **Explicitly NOT a wear-out prediction** — there is no durability model and the
  page's note says so. Transparent sort, no composite score (Workhorses/Declutter
  doctrine).
- `contextFormalityLevel(context, wearRows?)` gained an optional rows arg: it was
  reading the global `wears` while its new caller took a fixture, which would have
  made the selftest lie.

Selftest 80 → **87 cases. Still not run** (no browser, per [[verify-cli-not-preview]]).

---

## ✅ SHIPPED — Round C "Memory + Payback" (reviewed + built 2026-07-25, r1→r8)

**Built in one session, Fable-first order, deployed after every step** (r1 step 1 …
r8 steps 8+9). Selftest grew 52 → **80 cases**.

⚠️ **Not executed.** Per [[verify-cli-not-preview]] the app was not opened in a
browser and **the selftest was not run** — every step is syntax-verified against
JavaScriptCore (`new Function(src)` parse of the inline script) and reviewed by
hand, with the new cases written but not executed. Run
`migration/selftest.html?v=<bust>` at the next opportunity.

**Deviations from the plan below, all deliberate:**
- `openDayPlanSheet` did **not** get a `presetContexts` argument — it computes the
  weekday rhythm itself, which is simpler and produces the same result.
- Step 5's "add a search box to the flat pickers" turned out to be already done:
  the pickers have had `_capPickFilter` all along. Repointed it at the new shared
  `itemMatchesText` instead, so one box behaves the same everywhere.
- The Home attention group has **four** candidates, not three — the step 1 weather
  card joined catch-up / laundry / backup.
- No mending toggle was added to the item-details SUGGESTIONS card; the photo-view
  line is the only entry point, on purpose (see step 6's note).

**Implementation names** are in CLAUDE.md's Round C entry. The plan as written,
kept for the reasoning:

---

## Round C plan as locked (product review 2026-07-25, answered "defaults")

**Thesis:** the app knows what she owns and what she wore. Two assets are sitting
unspent — **the weather log it writes every day and never reads**, and **the log
moment itself**, which is the only second in the app that can pay her back for the
habit everything else depends on. This round spends both, then clears the small
stuff that a 476-item closet has outgrown.

**No schema changes.** Everything rides the live `kv` table (migration confirmed run
2026-07-20). New `kv` keys: `wxbackfill`, `milestones`, `beststreak`. Existing
`wxlog` window widens 400d → 1200d.

### Locked decisions (do not re-litigate)

- Round shape = **one deep thing (weather memory)** plus a mechanical tail, not a broad batch.
- **ERA5 backfill: YES**, one-shot, offered as a Home card **once** (plus a permanent Settings row).
- Precedent surfaces = **suggester + Tomorrow card**. Not its own stats page.
- **Trip days are excluded** from precedent matching.
- **`itemWxProfile` ships** ("usually worn 45°–62°" on the item photo view).
- Milestone toasts: **yes, all six rungs**, **max one per log, each key once ever**.
- Week planner: **pre-filled with muted weekday guesses, tap to accept, NEVER auto-saved.**
- **"Your week" rhythm strip** added to Stats.
- Free-text closet search: **yes — closet root AND the flat pickers.**
- **"Ask my closet" NL parser: later, not this round.**
- Also in: **mending tag · year-in-pixels · "On this day" on Home · Home attention
  hierarchy · taxonomy-rename warning.**
- **Next round (NOT now):** palette page (colors owned vs. worn), shopping gap +
  replacement watch. **Deferred indefinitely:** lookbook export; offline write queue
  (revisit only if she actually loses a log). **Formulas remainder: tune
  `FORMULA_MIN_LOOKS`/`FORMULA_MIN_WEARS` against real data BEFORE building more.**

### Build order — STRICT Fable-first (judgment 1–4, mechanical 5–9)

Per [[fable-first-build-order]]: deploy after each step.

---

#### STEP 1 — Weather memory core (judgment-heavy, the round's centerpiece)

**Why it exists:** `loadHomeWeather` writes `kvData("wxlog")` daily at
`index.html:2472` and **nothing reads it** (grep: two writes, zero reads). It was
groundwork for "style twins" and has been idle since 2026-07-20.

**1a. Widen the window.** `index.html:2478` prunes at `shiftDate(today, -400)` →
change to **-1200** so backfilled history survives. ~1200 entries × ~40B ≈ 50KB in
one JSONB row; fine.

**1b. `backfillWxLog()`** — one-shot, idempotent.
- Location: beside `loadHomeWeather` (~`index.html:2456`).
- Range = earliest `wears.worn_on` (clamped to `today-1200`) → today.
- **One call to the existing `fetchWeatherRange(lat, lon, start, end)`
  (`index.html:13821`)** — it already splits the forecast window (today−92 → today+15)
  from the ERA5 archive (`archive-api.open-meteo.com`) and merges the result, and it
  already stamps `hist`. Nothing new to write against Open-Meteo.
- Location from `getHomeLocation()` (`index.html:2435`, cached in `HOME_LOC_KEY`).
- **Merge rule: backfill OVERWRITES entries older than 15 days** (those were
  *forecasts* when they were written; ERA5 is *observed*). Entries within 15 days
  are left alone.
- On success `kvSet("wxbackfill", todayStr())`.

**1c. Entry points.**
- Home card, shown only when `dataReady && !kvData.get("wxbackfill") && wears.length > 100`.
  Copy: *"Match today's weather to what you actually wore — one-time lookup of past
  weather."* → `[Do it]` / `[Not now]`. "Not now" snoozes 14d via `store`.
  ⚠️ **She will never run this from Settings on her own** — the card is the real
  entry point; the Settings row is the re-run escape hatch.
- Permanent row in the Settings **Data** card.

**1d. `similarDays(wx, { contexts = null, limit = 4, excludeDays = 14 })`** — pure,
injectable, selftested.
- Pool = wear days from `wearDayMap()` (`index.html:8946`) that have a `wxlog` entry.
- Drop days within `excludeDays` of today (she remembers those).
- **Drop days inside any dated trip capsule's range** (locked).
- If `contexts` given, keep days whose wear rows share ≥1 context (`ctxArr`).
- Score = `|ΔmaxT| + 0.5·|ΔminT| + (wmoIsWet(a) !== wmoIsWet(b) ? 8 : 0)` — wet
  mismatch priced in degrees.
- **Hard cut at score > 15**: nothing similar → return nothing. A bad match is worse
  than an empty row.
- **Dedupe by `outfit_id`** so the strip isn't four copies of one look.
- Sort by score, tiebreak recency desc. Return `[{date, score, outfitId, itemIds, contexts}]`.

**1e. Surfaces.**
- **Suggester** (`openSuggestSheet`, `index.html:6897`): a row above the combo —
  **"You've dressed for this before"** — up to 4 tiles (`outfitCollageHtml` + a
  `Jan 12 · 47°/38°` label). Tap → `openLookFrom(outfitId)`, or the calendar day
  when the day has no look. Render only when `_suggWx()` has a wx AND there's ≥1 hit.
- **Tomorrow card** (`tomorrowCardHtml`, `index.html:2802`): same strip, fed by
  `_dpWx(tm)` (`index.html:1848`) and the entry's contexts.

**1f. `itemWxProfile(itemId)`** — wxlog entries across that item's wear days, **≥5
required**, return `{lo, hi}` from the 10th/90th percentile of `maxT`. Renders as a
`det-sub` on the item photo view next to the existing `wearRhythm` line
(`itemPartners`/`wearRhythm` live at `index.html:4850`): *"Usually worn 45°–62°."*

---

#### STEP 2 — Milestone toasts (judgment: the ladder + the cap)

**Why:** logging produces a flat "Wear logged" on the ~700th repetition. This is the
only moment the app can repay the habit in the same second, and it currently doesn't.

**`milestoneFor(itemIds, { outfitId, date })`** → `{key, text}` or `null`.
First hit wins, evaluated in this order:

1. `first:<itemId>` — item now has exactly 1 wear-day → *"First outing for the <name>."*
2. `paidoff:<itemId>` — `costPerWear` (`index.html:2065`) crossed **below $1.00** with
   this wear; requires `price` set and `acquisition !== "Gift"` → *"The <name> just
   went under $1 a wear."*
3. `rescued:<itemId>:<date>` — previous `lastWorn` (`index.html:2061`) was ≥180 days
   before this date → *"Back after N months."*
4. `round:<itemId>:<n>` — item hit exactly **10 / 25 / 50 / 100** wear-days
   (`wearCount`, `index.html:2060` — already day-based) → *"That's the <name>'s 50th day out."*
5. `completeset:<year>` — checked only when the wear includes Shoes: every Available
   pair of Shoes worn ≥once this calendar year. (Trip-mode variant: every packed
   capsule item now worn.) → *"You've worn every pair of shoes you own this year."*
6. `streak:<n>` — `calStreak()` just exceeded the stored best in `kv` `"beststreak"`
   → *"Longest logging streak yet — N days."*

**Cap (locked):** one per log; **each key fires once ever**. Seen-set in
`kvData("milestones")` = `{ "<key>": "<date>" }`. Build the cap in NOW — she'll want
these rarer after ~3 months, and a cap retrofitted later is a rewrite.

**Wiring:** a single `logCelebration(rows)` helper called at each wear-create site —
`logWearToday` (`index.html:5018`), `logLookOnDay` (`index.html:9900`),
`wearSuggestedCombo`, `wearPlannedEntry`, `saveCalClothingLog`. Where a post-log
sheet opens anyway, **pass the text into `openPostLogSheet` (`index.html:5072`) so
its close-toast carries it** — never stack a toast under an open sheet.

---

#### STEP 3 — Weekly rhythm (judgment: the confidence floor)

**Why:** `weekdayTopContext` (`index.html:4903`) derives the modal context per
weekday and is called **exactly once** — one chip in the post-log sheet
(`index.html:5079`). Meanwhile `openWeekPlanSheet` (`index.html:2870`) renders seven
rows that all say "—". **A blank-slate planner gets abandoned; a pre-guessed one gets used.**

- **`weeklyRhythm()`** → `Map(0..6 → {contexts, n})`. Same logic as
  `weekdayTopContext` but returns every context above the existing **≥3-distinct-days**
  floor, frequency-ordered, capped at 2. Below the floor → empty (show nothing).
- **Week planner:** days with no entries render the guess muted (`Chorus · usually`);
  tapping opens `openDayPlanSheet(d)` with those contexts **pre-selected and unsaved**.
  Needs a `presetContexts` arg on `openDayPlanSheet`.
- **Day plan sheet:** opening an empty day pre-ticks the rhythm contexts. Nothing
  writes until Save (locked: never auto-save).
- **Stats:** a non-nagging **"Your week"** strip on the main stats page — Mon–Sun with
  each day's modal context and its day count. Taps into the Contexts page.

---

#### STEP 4 — Home attention hierarchy (judgment: the priority call)

`index.html:2954` can stack **eight** blocks: `dash + tiles + todayPlanRows + cta +
tomorrow + catchup + laundry + backup`. (Parked since 2026-07-19; more true now.)

- **One attention row above the fold**, priority **trip dash > catch-up > laundry > backup**.
- The rest collapse to one quiet line — *"2 more things ›"* — expanding in place.
  Session-only state, nothing persisted.
- **The log CTA / logged row and the Tomorrow card are NOT attention rows** — they're
  the daily loop. They stay where they are.

---

#### STEP 5 — Free-text closet search (mechanical)

**Why:** `openSearch()` is now a one-line alias for the filter sheet
(`index.html:5298`) — the keyword box died in the filter unification and never came
back. Looks kept its text search (`looksSearchQ`, `index.html:7771`); the closet, with
476 items, has none. **Prediction: she'll use this more than anything else this round
and never mention it.**

- New `closetSearchQ` state (null = not searching). Search input row under
  `clToolbar` (`index.html:3495`) at root and at category/subcategory level.
- Match case-insensitively over `name`, `brand`, `retailer`, `category`,
  `subcategory`, `color_family`, `notes`, `tags` — **scoped to `lensItems()`** so lens
  and capsule scope still apply.
- Reuse the surviving `searchResults` plumbing: `renderCloset` (`index.html:3851`)
  needs a branch; `siblingItems()` (`index.html:4069`) and `gridSortKey`/
  `_gridSurface === "search"` (`index.html:8587`) already handle it. Cleared by
  `switchTab("closet")` (`index.html:14111`).
- Same input at the top of the flat pickers — mirror the existing scoped search in
  `builderPickContent`.

---

#### STEP 6 — Mending tag (mechanical)

`MEND_TAG = "mend"` + `isMending(i)`/`setMending(id, on)` via `setItemTag`
(`index.html:6514`) — same sentinel pattern as `no-suggest` / `layer` / `tol:<n>`.
- Toggle in the item photo view's SUGGESTIONS card.
- Closet root row **`🪡 Mending · N`** beside Hamper/Worn (`renderClosetRoot`,
  `index.html:3519`), with a `closetMend` view mirroring `closetWorn` **exactly** —
  wire into `closetBack` / `siblingItems` / `switchTab` the same way (see the Worn
  tray entry in CLAUDE.md; the delegation handlers are at `index.html:14531-14532`).
- Excluded from `suggestOutfits` like `no-suggest`.

⚠️ **Prediction: she will never tag retroactively** — only the moment the button pops
off. The item photo view is the only entry point that matters; don't build a review queue.

---

#### STEP 7 — Year in pixels (mechanical)

- New `statsView = "pixels"` + `renderStatsPixelsPage()` (dispatch at `index.html:10358`;
  remember `statsNavBack`/`statsRebuild`), entry row in Clothing Stats.
- 53×7 CSS grid, one cell per day, year chips like Wrapped.
- Cell color = the day's derived formality bucket (`deriveWearFormality` over that
  day's item ids) as an opacity ramp of `var(--accent)`; empty days `var(--panel)`.
  **Tokens only — no literal colors** (CLAUDE.md gotcha).
- Tap a cell → calendar day view. Legend row underneath.
- Use `statsToolbar(..., hideFilter=true)` — this page is the whole year, not `statsPool()`.

---

#### STEP 8 — "On this day" on Home (mechanical)

Reuse the calendar day view's existing prior-year finder (the `.otd-row` logic).
Render **only when there's a hit**, and put it **below the Tomorrow card** — it's a
delight row, not an attention row, so it must not compete with Step 4's slot.

---

#### STEP 9 — Taxonomy-rename warning (mechanical, closes a latent bug)

The in-app taxonomy editor (`openTaxonomySheet`, `index.html:14213`) can rename a
subcategory out from under constants that are keyed on the shipped names, silently
breaking workout mode.

- **At risk:** `WORKOUT_SLOTS` (`index.html:6532`) and `GEAR_CAND_SUBCATS`
  (`index.html:7043`). `SUBCAT_FORMALITY`/`WEAR_TOLERANCE` are already carried through
  `meta`.
- ✅ **`LAUNDRY_LOADS` is NOT at risk** — it's keyed on **color_family**, not
  subcategory (`index.html:2130`, used at `index.html:2254`). The CLAUDE.md gotcha
  that lists it is wrong; **fix the doc as part of this step.**
- Fix: `TAXONOMY_LOCKED_SUBCATS` = `Object.keys(WORKOUT_SLOTS) ∪ GEAR_CAND_SUBCATS`.
  Renaming one shows an inline warning ("Workout mode is keyed on this name — renaming
  will stop run/hike suggestions finding it") and requires a second tap. Delete stays
  blocked at nonzero usage, as today.

---

### Selftest additions (`migration/selftest.html` — Claude runs it before every deploy)

`similarDays` scoring + trip exclusion + outfit dedupe + the >15 hard cut ·
`milestoneFor` ladder ordering + once-ever cap · `weeklyRhythm` ≥3-day floor ·
closet search field matching · the 1200-day wxlog prune window.

### Out of guardrails (asked and answered — don't re-propose)

Reading her real calendar (needs a server/OAuth) · photo auto-tagging or semantic
search (needs a model key in client code). Both genuinely useful, both correctly
ruled out by the no-backend stance.

---

## ✅ SHIPPED — "Laundry Control" round (planned 2026-07-22 by Fable; built same day by Sonnet)

Seven user asks from one message (2 bugs, 3 features, 1 nav fix, 1 brainstorm).
All decisions below are LOCKED except the two flagged **[ASK ALINA]** — settle
those at build time, don't re-litigate the rest. No schema migration needed
anywhere in this round (one new sentinel tag, see D3). Build in the order given:
A is the bug fix, C is the big rework, the tail (E/F/G) is mechanical.

### A. BUG — trip day card says "2nd wear since laundry" after a real wash

**Root cause (confirmed in code):** `planRewearFlags(c, dates)` (~line 12159)
counts each piece's planned wear-days from the TRIP START, resetting only on a
planned 🧺 laundry-day sentinel (`planLaundryDay`). It never reads
`items.last_washed` — so a real wash stamped via the laundry sheet / bulk
"Mark washed" changes nothing, and the day card keeps flagging "2nd wear
since laundry" on a freshly washed piece.

**Fix:** inside the per-day loop, when counting an item, skip planned days on
or before that item's real wash: `if (it.last_washed && date <= it.last_washed)
continue;` (matches `wearDatesSinceWash`'s strict `d > since` — the wash day
itself doesn't count). The count naturally restarts on days after the stamp.
Keep the `planLaundryDay` reset as-is (it covers "will do laundry mid-trip",
which has no stamp yet).

**Selftest:** add a case to `migration/selftest.html` — item with tolerance 2,
planned 3 consecutive days, `last_washed` = day 2 → only a fresh count on day 3,
no flag; with `last_washed` null → day 3 flags "3rd wear". (planRewearFlags
reads module state via `outfitById`/`outfitItems`, so build the fixture the way
the existing laundry tests do.)

### B. NAV — trip dash "N of M pieces in the hamper" opens the hamper, not the wash sheet

Change the `[data-td-laundry]` handler (~line 3040) from
`openLaundrySheet({pool})` to opening the **scoped hamper page**:
`switchTab("closet")` first, THEN set `closetHamper = true; closetWorn = false;
closetCat = closetSub = searchResults = null;` and `renderCloset()` — order
matters, `switchTab` resets those flags (line ~13905); copy the working pattern
from the `[data-laundry]` handler at ~line 14325. Trip mode sets
`activeCapsuleId`, so `_scopedHamper()` already filters to the suitcase, and the
hamper page's existing "🧺 Did laundry — mark these washed" button already
re-opens the wash sheet with the capsule pool (~line 14323). Nothing else to
build — this is a handler swap.

### C. FEATURE — see (and edit) what's actually in a wash load

Her words: "I need to see what is in the load — not just check whatever happens
to be in those colors." Rework `renderLaundrySheet()` (~line 3536):

1. **Load chips become pre-selectors, not the selection.** Selection state
   moves from `_lnSel` (Set of load names) to a Set of ITEM ids. Tapping a load
   chip adds/removes that load's item ids (chip shows "on" when all its items
   are selected); "All together" selects the whole hamper as today.
2. **Below the chips, render the selected wash as a thumbnail grid** (reuse the
   Home `.laun-row` confirm-strip tile style: thumb + 🧺 tick overlay). EVERY
   hamper item in the selected loads appears; tapping a tile toggles it out/in.
   The "Mark washed · N items" button count comes from the id set.
3. **"Also worn, not dirty yet" section** — worn-tray items
   (`isWornNotDirty`, honoring `_lnPool`) whose `color_family` falls in the
   selected loads, shown as the same tappable tiles. **[ASK ALINA]** default
   pre-selected ON (recommended — this is exactly the bug she hit: a worn-once
   shirt went into the real wash but never got stamped, so its old
   `last_washed` kept accruing wears; pre-on matches "everything of that color
   went in") or OFF (conservative). Either way they're visible and one tap
   flips them.
4. `stampWash` already takes explicit ids — no change below the sheet. The
   bootstrap (`#lnStart`), date row, trip pool, and "Not yet" snooze all stay.

### D. FEATURE — per-item laundry control (item photo view, `laundryLineHtml` ~line 6039)

Derive-first: the wear count stays DERIVED from the wear log; what she gets to
edit is the wash date (source of truth) plus the existing one-shot overrides.
Do NOT build an arbitrary "set wear count to N" editor — editing `last_washed`
+ "One more wear" covers every real case without a second bookkeeping system.

1. **Editable wash date.** "Washed 3d ago" becomes tappable → date input
   (max today), PATCHes `last_washed` and clears `laundry_state` (a re-dated
   wash retires any override, same as `stampWash`). Also offered on DIRTY
   items as a "Washed on…" action beside "✓ Washed" (today) — that's the
   back-date she asked for. Reuse the `#lnDate` pattern or a `FIELD_CONFIGS`
   date sheet, whichever is less code.
2. **Show the derived count.** Add "worn N× since · M/T wears" to the line
   (T = `wearTolerance`), so the state she's overriding is visible. Worn-tray
   subtitle format `n/tol` already exists (~line 3674) — reuse.
3. **Per-item tolerance override** — the real "more control" lever: a
   `tol:<n>` sentinel tag (same pattern as `layer`/`no-suggest`, no
   migration). `wearTolerance(i)` checks the tag before the subcat/category
   tables. UI: "Wears per wash: 4 ✎" on the item's laundry line → small
   stepper/picker sheet (1–10 + "never dirty" = Infinity ~ maybe just omit
   Infinity, shoes/outerwear already are). Selftest: tag beats subcat default.

**Brainstormed and deliberately NOT in this round** (park in Back-burner):
wash-history log in `kv` (avg days between loads, hamper-size-over-time stat),
delicates/hang-dry flag, laundry-day forecast ("hamper will hit 20 by Friday").
All derivable later; none unblock her today.

### E. BUG — dark mode shows a light bar at the top (standalone PWA)

The page metas are already dark-aware (`theme-color` ×2, line 6–7), but:
- `apple-mobile-web-app-status-bar-style` is `default` (line 10) → iOS paints
  an opaque light status bar in the installed app. Change to
  **`black-translucent`** — the header already pads
  `env(safe-area-inset-top)` (lines 43/183), so content sits correctly and the
  oxblood/dark header paints under the clock.
- `manifest.json` still has `"background_color": "#ffffff", "theme_color":
  "#ffffff"` (pre-redesign) → update both to `#f8f4ee` (manifest can't
  media-query; this is the splash/Android chrome color, paper is the right
  single value).
- ⚠️ iOS caches the installed shell — verify on her phone after deploy; a
  delete + re-add of the home-screen app may be needed (same as F, do together).

### F. CHORE — app icons still pre-redesign

`icon-180.png`/`icon-512.png` date from 2026-07-17 (old identity). Regenerate
both to match the inline SVG favicon (line 14: oxblood `#6b2737` rounded
square, white hanger glyph) at 180/512. Method: write the master SVG at each
size into `migration/` (throwaway dir, fine), rasterize with whatever's on the
Mac — `qlmanage -t -s 512`, `rsvg-convert`, or render via the preview browser
canvas → `toDataURL` — output must be real PNGs at the SAME repo-root
filenames. Add `?v=2` to the `apple-touch-icon` href and the manifest icon
`src`s (GH Pages caches hard). ⚠️ iOS bakes the icon at install time — the
home-screen icon only updates when she deletes + re-adds the app; tell her.

### G. FEATURE — Build a look from the trip dash, alongside Suggest

The trip dash chips (~line 2644) have ✨ Suggest / 🗓 Trip plan / 🧳 Packing
list. Add **`✎ Build`** after Suggest → handler in `wireTripDash`:
`openBuilder(null, null, { capsuleId: tc.id, date: PLAN_BUCKET })`. That scopes
the picker to the suitcase AND lands the saved look in the trip's outfit
bucket ("Planned outfits") via the existing `finishBuilder` planCtx routing —
same plumbing as the plan view's Build button, zero new paths. (A bare
`openBuilder()` would also scope via `tripModeId` but the save would vanish
into the Looks list; bucket is the useful landing spot.)

### Close-out — DONE 2026-07-22 r1

- ASK ALINA (C.3) settled: worn-not-dirty items pre-selected ON by default.
- Selftest additions shipped: A (rewear reset on real `last_washed`) and D3
  (`tol:<n>` tag beats subcat/category defaults + edge cases). 48/48 passing.
- `APP_VERSION` + `<meta name="app-version">` bumped in lockstep; `WHATS_NEW`
  refreshed.
- CLAUDE.md's current-state entry updated with full details.
- **E and F still need on-device verification** (her phone) — the status bar
  fix and new icons only show after she deletes + re-adds the home-screen app
  (iOS bakes both at install time). Not toast-worthy; tell her directly.

---

## ✅ SHIPPED — user ask batch (2026-07-21, r5→r7)

Six requests in one message, all shipped same day (details + gotchas in
CLAUDE.md's 2026-07-21 entry):
1. **Editable categories/subcategories** — Settings → "Edit categories & types".
   kv-backed override of TAXONOMY; renames rewrite every affected item.
2. **"Home" formality** for looks with no shoes (supersedes the derived level).
3. **Closet Review asks for missing photos.**
4. **Wear counts on Looks tiles.**
5. **Tomorrow's pick is sticky** (kv, survives refresh) + tap to revise + ↻
   re-roll; Home decrowded (Plan-ahead folded into the card).
6. **"Worn" tray** — worn since washing, not yet dirty.

**Known follow-ups:** renaming a subcategory doesn't update the
subcategory-keyed constants `WORKOUT_SLOTS` / `LAUNDRY_LOADS` /
`GEAR_CAND_SUBCATS` (formality + laundry tolerance DO carry over via the
override's meta). Home is less crowded but still stacks several rows — the
parked "attention-slot hierarchy" idea is the real fix if it bothers her again.

---

## ▶ IN PROGRESS — Round B "Formulas" (2026-07-21, r3→r4 shipped)

**Thesis:** the app knows what she owns and what she wore; formulas tell her
what her style IS — the shapes she rebuilds without noticing — and then let
her re-cook them.

**Shipped (r3 + r4):** detection engine (`formulaKeyFor`/`formulaLabel`/
`buildFormulas`/`formulaShapeMap`, pure, nothing stored) · **Formulas Looks
lens** (first tab, folders = shapes, most-worn first, wear counts) · **"✨ New
outfit from this formula"** wiring `shapeKey` through `suggestOutfits` as a hard
per-slot subcategory filter + shape-respecting piece swaps. Selftest: 4 cases
added (not browser-run, per her no-browser-testing rule).

**Not yet built (next session):**
- **Name + keep a formula** — promote a discovered shape to a named template in
  `kv` ("Sunday uniform"), so the label is hers, not the taxonomy's.
- **Builder slot-seeding** — open the canvas with one placeholder per shape
  slot; tapping a placeholder opens the rail pre-filtered to that subcategory.
- **Formula chip inside the suggester** (pick a formula without going to Looks).
- **Tuning:** thresholds are guesses (2 looks / 6 wears). If the lens looks
  thin or noisy on her real data, tune `FORMULA_MIN_LOOKS`/`FORMULA_MIN_WEARS`
  before adding features. Colour is deliberately NOT part of the signature yet
  (subcategory-only keeps clusters interpretable) — revisit if shapes feel too
  coarse.

---

## ✅ SHIPPED BUILD — Round A "Tomorrow" (planning + prediction + activity gear)
### Planned + BUILT 2026-07-20 from the two-list feature brainstorm. Decisions LOCKED — do not re-litigate.
### Steps ①② deployed r1; steps ③–⑦ deployed r2 (kv migration confirmed run same day).

**Thesis:** the app answers "what did I wear" and "what could I wear right now";
this round makes it answer "what will I wear" — future-day contexts, per-day
outfit plans, a Tomorrow card on Home, and an activity/gear rework so planned
workout days can actually generate outfits.

**Migration gate:** `migration/kv_store.sql` (new `kv` table: `user_id, key,
value jsonb`, PK (user_id,key), RLS own_rows) — **CONFIRMED RUN 2026-07-20**
(anon-key REST probe returned 200). Now live; keys in use: `dayplan`, `wxlog`.

**Selftest note (2026-07-20):** user asked for NO browser testing at all —
selftest cases are still ADDED (36 total incl. gear/dayplan) but not run in a
browser by default; syntax verified via osascript/JavaScriptCore. See
[[verify-cli-not-preview]].

**Locked decisions (user, 2026-07-20):**
- **One activity: Workout** (`gear:workout` in `items.tags`, sentinel-tag
  pattern like `layer`). Run/lift/yoga/bike/hike all share it — no per-sport
  tags (refine later only if real use demands). **No swim activity**: swimwear
  is a grab, not an outfit; keep Swimwear gear-only so it never suggests.
- **Sports bras + Swimwear are never suggested** (map to no slot).
- **Rain is a condition, not an activity**: `gear:rain` items are eligible in
  NORMAL suggestions only when the active weather is wet (`wmoIsWet`), boosted
  when wet, absent when dry (locked/seeded exempt, as ever).
- **Rename level 1 "Function" → "Utility"** everywhere user-visible
  (`OCCASION_LADDER`, `OCCASION_HINTS`, any copy). Mechanics unchanged:
  `[1]`-only formality still means gear-only isolation (`formalityOk`).
- **Gear-leak guarantee comes from formality, not the tag**: bootstrap pass
  marks true gear as formality `[1]`-only (existing isolation excludes it from
  normal mode); `gear:workout` is the INCLUSION signal for activity mode.
  Dual-use pieces (casual-wearable leggings) = tag + normal levels → both worlds.
- **Day plan = ordered ENTRIES**: each `{contexts:[...], look}` where look is
  an outfit id, a raw item-id combo, or null (contexts set, outfit TBD). One
  outfit across contexts = one entry with several contexts; an outfit change =
  several entries. Logging an entry stamps ALL its contexts on the wear rows
  (`wears.context` is already text[] — no write-path change).
- **Multi-context formality = intersection** of the contexts'
  `contextFormalityLevel` ranges; if empty, planner shows a "these don't share
  a formality level — split into two outfits?" note instead of generating.
- **Activity contexts**: an entry whose context is the Workout-mapped context
  runs the suggester in activity mode, not formality mode.
- **Tomorrow card is visible ALL DAY** (her call — not a 5pm flip). Today's
  planned entries surface in the existing log-cta slot with one-tap "Wear it".
- Cluster-7 rejections recorded (no item notes surfacing, no persistent ban
  log, no A/B) — out of scope forever unless she reopens.

**Spec by piece:**
1. **Gear tags + rename (no migration).** Constants `GEAR_WORKOUT_TAG`/
   `GEAR_RAIN_TAG`; helpers `isWorkoutGear(i)`/`isRainGear(i)` via existing
   tag machinery (`setItemTag`). Item-detail SUGGESTIONS card gains "Workout
   gear" + "Rain gear" toggles (shown for all categories — gear crosses
   categories); Add Item gets the same row for Workout/Shoes/Outerwear/
   Leggings. Rename Function→Utility.
2. **Suggester activity mode + rain gating.** `_sugg.activity` (null |
   "workout"); a 🏋️ Workout chip beside the formality chips. Active: pool =
   `gear:workout` items; slot map: Workout tops→Top, Active shorts→Bottom,
   tagged Leggings/Joggers→Bottom, tagged Sneakers/Boots→Shoes, tagged
   Sweatshirts/Jackets→optional layer; bras/swim → no slot; `formalityOk`
   bypassed (tag = cohesion); weather scoring kept (cold → boost layer).
   Normal mode: rain-gated `gear:rain` filter. Zero-state door when no gear
   tagged → **bootstrap sheet**: review-deal-style pass over Workout category
   ∪ Sneakers/Boots/Jackets/Coats/Leggings (toggles: Workout gear / Rain gear
   / "Gear only — never normal days" which sets formality [1]). Also
   reachable from Settings.
3. **kv plumbing + day-plan model (AFTER migration confirmed).** `kvGet/kvSet`
   over REST (upsert on conflict); `dayplan` key holds
   `{ "<date>": [ {contexts:[...], outfit_id|items|null} ] }` pruned to
   past 7d + future 30d on write. Loaded in `loadData`, cached like other
   state, included in `saveDataSnapshot`.
4. **Week planner screen** (Home tile "Plan ahead" area — placement judged in
   build): next-7-days cards reusing trip-planner UI patterns; per entry: set
   context(s) (context picker), attach look via Pick (saved-look picker) /
   ✨ Suggest (suggester pre-scoped to entry contexts' intersected level or
   activity mode) / ✎ Build; 🧺 laundry sentinel honored. Trip-mode days show
   "planned in trip" and defer to `capsules.plan` — never double-plan.
5. **Tomorrow card on Home** (all-day): tomorrow's entries; look-TBD entries
   render a generated suggestion from tomorrow's forecast (extend
   `loadHomeWeather` to read tomorrow from the SAME single Open-Meteo call) +
   entry contexts + clean-only. Muted receipts line per generated outfit
   ("72° · Campus · all clean"). Today's entries → log-cta slot: "Wear it"
   creates wears (all contexts, derived formality, plan-sync semantics like
   `planWoreIt`), Undo parity, post-log sheet pre-seeded.
6. **Style twins row** on the Tomorrow card: most recent past day matching
   temp band (±8°F, month-bucketed approximation where no cached wx) + any
   shared context → mini collage, tap → that calendar day.
7. **Selftest additions** (`migration/selftest.html`): gear pool
   inclusion/exclusion, rain gating wet/dry, bras/swim never slotted,
   formality-intersection (incl. empty), dayplan prune, Utility rename
   lockstep. Run 38/38 (or current N) before every deploy.

**Build+deploy order (fable-first, one deploy per step):** ① tags+rename →
② activity mode+rain+bootstrap → [user runs kv migration] → ③ kv+model →
④ planner screen → ⑤ Tomorrow card+today Wear-it → ⑥ style twins →
⑦ selftest sweep + close-out.

---

## ✅ SHIPPED BUILD — "Loop Resilience + Payoff" (planned 2026-07-18, built
2026-07-18→19, r8 → 2026-07-19 r3)

**Status: FULLY SHIPPED, one deploy per step (r8 suggester cluster+B1 →
07-19 r1 catch-up+backup nudge → r2 gap page → r3 Year in Review; restore
script + selftest additions in the close-out commit). Selftest: 29/29.**
From the post-trip-mode product review; user answered "defaults except:
not-this first, gap page before Year in Review".

**Locked decisions (do not re-litigate):** no schema changes anywhere.
- **C1 "Not this" (HER TOP INTEREST — build first):** session-only piece bans
  in the suggestion sheet (`_sugg.banned` Set, reset per sheet open). Ban a
  piece → it's excluded from the pool/swaps/layers for the rest of the sheet
  session and the current combo swaps it out immediately. Locked+seed pieces
  can't be banned (banning a locked piece unlocks it first). No persistence.
- **C3 pool-starvation line:** when the engine returns fewer than the asked-for
  batch, one muted line naming the biggest hider (🧺 clean-only / capsule
  scope / formality level) with counts. Computed only when starved.
- **C2 variety seeding:** per-sheet-open random salt per item (small additive
  score jitter in `suggestOutfits`) so consecutive sessions lean into
  different corners of the closet. Small enough to break ties, not override
  real affinity.
- **B1 trip-offer dismissal = once per TRIP** (was per-day): `TRIP_OFFER_KEY`
  dismissal becomes permanent per capsule (legacy stored dates stay truthy).
  Manual entry stays on capsule detail.
- **A1 catch-up strip:** Home row when any of the last **3** days (not today)
  has zero wears and isn't skipped: per missed day, "Log" (→ that calendar day
  + wear-again chooser) or "skip" (marks deliberately-unlogged in a `store`
  JSON set `wardrobe.skipDays`, pruned to recent). Today is the CTA's job.
- **E1 backup nudge:** Home row when `wardrobe.lastBackup` is null or >30d —
  one tap runs `downloadBackup()` directly (which must re-render the CURRENT
  screen, not always Settings).
- **D2 closet-gap page (before D1, her call):** Stats page "Closet vs life" —
  per context: share of wears vs share of the Available closet eligible for
  that context's formality level (`contextFormalityLevel`), sorted by delta;
  calls out underserved (high wear share, thin closet) and overserved.
  Factored as pure `buildGapStats()` for the selftest harness.
- **D1 Year in Review:** any-time card stack in Stats with year chips
  (current year = "so far"): totals + coverage, most-worn item, top 5, CPW
  champion, top looks, context mix, new-this-year hit rate, dead weight,
  longest logged streak. Pure `buildWrappedStats(year)`.
- **E2 restore script:** `migration/restore_backup.py` — disaster-recovery
  re-upload of a backup `data.json` into an EMPTY project; refuses non-empty
  tables without `--force`. Stdlib only.

**Build order (Fable-first):** ① this spec → ② C1+C3+C2+B1 (suggester
cluster, deploy r8) → ③ A1+E1 (Home rows, r9) → ④ D2 gap page (r10) →
⑤ D1 Year in Review (r11) → ⑥ E2 + selftest additions + docs close-out.
Run `migration/selftest.html` before every deploy.

---

## ✅ SHIPPED BUILD — "Trip Mode + Tap Tax" (planned + built 2026-07-18, r1→r6)

**Status: FULLY SHIPPED same day, one deploy per build-order step (r1 trip
mode core+E1 → r2 filter/sort merge+✕ → r3 builder Browse/All rail → r4
unpack+recap → r5 post-log staleness fix+E4 → r6 ✨ tile+E2/E3/E5+docs).
Implementation names in CLAUDE.md's trip-mode entry. Every step verified in
local preview (parse + mocked pure-helper/render tests; full auth flows need
the live deploy).**

**Goal: an app-wide trip/capsule mode + a tap-tax fix pack + a consistency
sweep. NO schema changes, NO migrations** — the whole mode derives from
`capsules.start_date/end_date`, the `capsules.plan` JSONB, wears, and `store`
keys. Decisions locked in the 2026-07-18 brainstorm (three iterations, all
questions answered). Note for this round: the **"no nudges" rule is now SOFT**
(her words 2026-07-18: "I don't mind nudges — that rule is soft if it exists at
all"). Derived, dismissable prompts are fine. Predictable NAVIGATION is still
hard doctrine.

### Locked decisions (do not re-litigate)

**A · Fix pack (small, standalone, build first)**

- **A1 Post-log context staleness bug (user-reported "set it twice").**
  Diagnosed: `openPostLogSheet` (~line 3612) saves context to DB + local rows
  but never re-renders the screen behind it — calendar day card still shows
  "Add context" (data IS saved; reopening shows it selected). Fix: give
  `openPostLogSheet` an `onSaved` option (mirror `openContextSheet`'s, ~7141);
  every caller passes the right re-render (calendar day → `renderCalendarDay`,
  Home → `renderHome` so the `.logged-row` contexts refresh, etc.). Fire it
  only when a context was actually written.
- **A2 One-tap filter clear.** `funnelBtnHtml(id, state)` (~3769) renders an
  adjacent ✕ button whenever `hasActiveFilter(state)` — tap = reset the state
  clone + fire that surface's onApply. One component change propagates to every
  funnel surface. No sheet visit to clear.
- **A3 Merge sort into the filter sheet + fix the sort-label lie.** Today the
  default sort key is internally `"color"` but actually sorts category >
  subcategory > color, labeled **"Category" in the closet popover but "Color"
  in the picker popovers** — and no true color sort exists (user: "sort by
  color… only category, which doesn't make sense"; also "I always have trouble
  finding sort").
  - `openFilterSheet` gains a **Sort row at the top** (per-surface via the
    existing `gridSortKey()`/`setGridSort()`/`_gridSurface` plumbing); sheet
    title becomes "Filter & sort".
  - **Retire all three standalone sort popovers**: closet `[data-sort]` popover
    (~1028/6417/11693), calendar `#calLogSortPop` (~7412), capsule picker
    `#capPickSortPop` (~11060).
  - **Key rename + true color sort**: rename the composite key to
    `"category"` (label "Category" everywhere); `gridSortKey()` maps legacy
    stored `"color"` → `"category"` (keys persist in
    `store` `wardrobe.sort.<surface>`). NEW `"color"` comparator = true color:
    `COLOR_FAMILIES` declaration order (already spectrum-ish) → category →
    subcat → name within a color.
- **A4 ✨ Suggest for TODAY — the getting-out-of-bed flow.** The wear-again
  chooser (`openWearAgainChooser`, ~7575) gets a **✨ Suggest tile at the front
  of the strip** → `openSuggestSheet()`. "Wear this today" already logs today
  with full look create-or-merge. Two taps from a cold open (Home CTA → ✨).
  Explicitly NOT a past-date feature — she confirmed back-dated suggestions are
  not a use case; do not add ✨ to arbitrary calendar days.

**B · Picker toggle — Browse/All everywhere (replaces the earlier
"auto-flatten small pools" idea; user chose an explicit toggle: predictable
mode beats magic layout)**

- Every clothing-picking surface gets a header toggle: **🗂 Browse** (the
  folder drill that exists today) / **▦ All** (flat multi-select grid + search
  + funnel + sort — i.e., exactly the calendar +Clothing picker she likes).
- Surfaces: builder picker (`renderBuilderPicker` ~10629), capsule add-items
  picker (`renderCapsulePicker`), calendar +Clothing (`openCalAddClothing`
  ~7366 — already flat, gains the Browse option for symmetry), trip-plan
  pickers via the same components.
- **Persist per surface** in `store` (`wardrobe.pickmode.<surface>`, same
  pattern as `wardrobe.sort.<surface>`). Defaults = each surface's current
  behavior, EXCEPT capsule-scoped pools default to All (small pools are where
  flat shines).
- Builder flat mode keeps rail semantics: tap = `addPieceToBuilder(id, true)`,
  picker stays open. Back from either mode lands in the same place — flat mode
  has no depth by construction (this also answers her "back lands in different
  places depending how many folders deep" complaint).

**C · Trip mode / capsule mode (the flagship)**

- **State**: `store` key `wardrobe.tripMode` = capsule id. Entering also sets
  `activeCapsuleId` (existing scoping); exiting clears both. Three phases
  derived from capsule dates, never stored: **pack** (start − `PACK_LEAD_DAYS`
  = 3), **trip** (start ≤ today ≤ end), **unpack** (≤ `UNPACK_GRACE_DAYS` = 3
  after end).
- **Entry** (decision: yes, auto-offer): Home banner on/after start date for a
  dated trip capsule — "✈️ <name> starts today — Enter trip mode", dismissable
  (per-capsule store key). Manual entry button on capsule detail: dated →
  "Start trip mode", undated → "Enter capsule mode" (same machinery minus the
  date-driven pieces).
- **Home takeover** (decision: takeover, but ALL app functionality stays,
  scoped): `renderHome` (~2003) branches when trip mode is on. Dashboard:
  trip banner (Day X of N · name · exit ✕) · **today's planned look card**
  (from `capsules.plan`; "Wore it" → `planWoreIt` ~9783; nothing planned →
  "✨ Suggest from your suitcase" → `openSuggestSheet(null, cid, {capsuleId,
  date: today})`) · destination weather (`buildTripWeather`/`_planWx`, NOT
  `loadHomeWeather`) · **suitcase hamper row** ("🧺 3 of 24 dirty", opens the
  scoped laundry sheet) · mini-strip of remaining days' plans. The normal tile
  grid renders BELOW the dashboard — every tile works, capsule-scoped.
- **Scoping**: `activeCapsuleId` already scopes Closet + Looks; extend to the
  wear-again chooser (`wearAgainCandidates` filters to `outfitFullyInCapsule`),
  the suggester default pool, and the calendar log pickers. **Escape hatch
  everywhere** (decision: yes, offer): pickers get a "whole closet" affordance
  for that picking session; logging a NON-packed item in trip mode → after the
  log, offer chip "Add to trip capsule?" (toast chip). Add Item in trip mode
  auto-ticks the trip capsule in `_addState.capsules` (visible, un-tickable).
- **"Travel" context** (decision: derive + auto-stamp "Travel", other contexts
  addable): add `"Travel"` to `CONTEXT_SEED`. In trip mode, every wear-create
  path's post-log sheet opens with **Travel pre-selected** (via `presetCtx` —
  visible, un-tappable, composes with Church etc.). NOT a silent write: all
  wear paths already fire the post-log sheet, so cancel = declined, consistent
  with "each log asks exactly once". No per-trip named contexts (rejected —
  generic Travel keeps the contexts list clean; the trip itself is derivable
  from capsule dates).
- **Log-writes-to-plan** (her ask: "logging an outfit while on a trip and
  adding to the plan should be easier"): logging any look on a date inside the
  trip range → `addPlanLook(cid, date, outfitId)` if not already there; the
  day's planned card shows done. Works with the existing "Wore it" reverse
  path. A worn outfit IS the plan, fulfilled — never make her do both.
- **Trip laundry day** (the founding feature): `openLaundrySheet` (~2352)
  gains an optional pool — trip mode passes dirty **capsule members only**
  ("washing the suitcase, not the closet"). Load chips unchanged ("All
  together" already exists — hotel reality). `stampWash` unchanged (takes
  ids). A `PLAN_LAUNDRY` day in the plan surfaces on the dashboard as
  "Laundry day — wash your suitcase?" → scoped sheet.
- **Capsule mode** (undated) = banner + scoping + scoped laundry + Add-Item
  auto-assign + bucket looks card on Home. No day cards, no weather, no
  phases. Shares ~90% of the plumbing.

**D · Unpack flow + trip recap (decision: in v1)**

- Trigger: app open during the unpack phase while trip mode is active (or a
  manual "End trip" in the banner). One screen: capsule members split into
  **worn on trip** (any wear in the date range — pre-marked → hamper via the
  existing one-time `'hamper'` override) and **never worn**.
  Hamper writes go behind `LAUNDRY_READY()` like all laundry write-UI
  (belt-and-suspenders — the migration is CONFIRMED RUN 2026-07-18, laundry
  is fully live).
- **Dead-weight recap**: "5 pieces traveled 7 days and never left the
  suitcase" + most-worn piece + outfit repeat count. Not stored — pure
  derivation, so add a "Trip recap" row on the capsule detail of any PAST
  dated trip (re-viewable forever, works retroactively for old trips).
- Completing unpack (or dismissing it) exits trip mode.

**E · Consistency / professionalism sweep (the unifying ask)**

- **E1 One scope-banner component**: the two duplicated capsule-scope banners
  (~2504 closet, ~5714 looks) + the new trip banner become one
  `scopeBannerHtml()` — same look, same ✕ behavior, trip variant adds Day X
  of N. Any scoped surface shows it, so a short list is never a mystery.
- **E2 Icon language audit**: ✨ = suggest, 🧺 = laundry (done last round),
  🪣 = bucket, 🔒 = lock, ✈️ = trip — one meaning each, everywhere. Check
  every suggest entry point uses ✨.
- **E3 Empty-state pass**: every grid/list empty state gets the same style +
  one useful action (empty lens → "Add an item", empty hamper → "Nothing
  dirty", empty capsule → "Add pieces", empty day → log affordances already
  exist). Plain warm copy, no lorem-ipsum cuteness.
- **E4 Sheet-mutation audit** (A1 generalized): every sheet that writes data
  must re-render the surface beneath it on save. Audit all `showSheet`
  callers; `openContextSheet`/`openCalNotes` already comply; fix any others
  found (A1 is the known offender).
- **E5 Picker header standard**: same header row order everywhere a picker
  opens: Back/Cancel · title · Browse/All toggle · search · funnel(+✕).

### Rejected / out of scope this round

- Past-date suggestions (not a use case — her call).
- Auto-flattening pickers by pool size (superseded by the explicit B toggle).
- Per-trip named contexts (generic "Travel" instead).
- Any schema change (nothing in this round touches the DB shape;
  `items_laundry.sql` is confirmed run, so no migration prerequisites at all).
- Dark mode (standing rejection).

### Build order (STRICT Fable-first — user rule 2026-07-18: "keep things that
benefit from being coded by Fable first so that if I run out, I can continue
easily with Sonnet or Opus." Order = descending judgment-density, NOT size or
user-visible urgency. Each numbered step should leave the app deployable.)

1. ✅ this ROADMAP section (the plan itself is the highest-leverage Fable work)
2. **C trip/capsule mode core** — the architectural piece: mode state + phase
   derivation, entry/exit banner, Home takeover, scoping extension + escape
   hatches, Travel preset, log-writes-to-plan, scoped laundry pool, weather
   source switch. Most cross-cutting decisions live here; get them made and
   the patterns established.
3. **A3 filter/sort merge + legacy sort-key mapping** — touches every surface;
   the key-rename compat mapping is the subtle part. Include A2's ✕ (trivial
   once inside `funnelBtnHtml`).
4. **B picker toggle** — new shared component pattern across three pickers
   (builder rail semantics are the judgment call).
5. **D unpack + recap** — derivation logic (worn-in-range split, dead-weight,
   retroactive recap row) is Fable-worthy; the screen itself is mechanical.
6. **E1 scope-banner component + E4 sheet-mutation audit** — E4 needs judgment
   to audit; the fixes it finds are mechanical.
--- everything below is safely finishable by Sonnet/Opus from this spec ---
7. **A1 post-log `onSaved`** (fully diagnosed above — mechanical now), then
   **A4 ✨ suggest tile** (one tile + one call).
8. **E2 icon audit, E3 empty states, E5 picker headers** (checklist work).
9. Verify in preview (script parses = login renders; console clean; walk the
   trip-mode lifecycle with a test capsule), deploy via `deploy-wardrobe`
   (new day → `2026-07-18 r1`), close out docs/memory. **Deploy after EVERY
   numbered step** (her standing "always deploy after building" preference —
   and it means a model handoff never strands unshipped work).

### Build conventions for this plan

- Constants at top of script: `PACK_LEAD_DAYS = 3`, `UNPACK_GRACE_DAYS = 3`,
  `TRIP_CONTEXT = "Travel"`.
- New sheets/wrappers must be added to `uiCanRefetch()`'s wrapper list and use
  `showSheet`/`hideSheet` only (CLAUDE.md gotcha).
- All new item-photo surfaces route through `photoUrl`/`loadPhotoNode`;
  `background-size: contain`.
- Non-closet item/look opens via `openItemFrom`/`openLookFrom` (return
  thunks) — the trip dashboard is a new entry point, wire it correctly.
- Version bumps: `APP_VERSION` AND the `<meta name="app-version">` tag, in
  lockstep.

---

## ✅ SHIPPED BUILD — "Feels Professional" polish round (planned + built 2026-07-17, r1)

**Goal: perceived quality only — no new features, no capture, no schema.** From
the 2026-07-17 product review ("what would make this feel professional and a joy
to use"). User answered: **everything except dark mode** (E skipped entirely —
including the token-hygiene pass; do not start it). No migrations needed.

### Locked decisions (do not re-litigate)

- **A1/A2 Install as home-screen app**: add `manifest.json` + `icon-180.png` +
  `icon-512.png` (real files in repo root — user approved bending "one file";
  the constraint's letter is no external JS/CSS, which these aren't). Display
  `standalone`; `start_url`/`scope` = `/wardrobe_app/` (GH Pages subpath!).
  `<link rel="manifest">` + `<link rel="apple-touch-icon" href="icon-180.png">`
  + legacy `apple-mobile-web-app-capable` metas. Icon = Claude-drafted
  periwinkle (#8b8fd0) full-bleed square, white tee glyph (match
  `PHOTO_PLACEHOLDER`); iOS masks its own corners — do NOT pre-round.
  **NO service worker** (would be a real second JS file — rejected).
- **A3 Freshness on return**: `visibilitychange → visible` handler. If hidden
  >5 min AND the UI is "at rest" → silent `loadData()` + re-render current tab
  ROOT only. "At rest" = no sheet visible, `builder == null`, tab ≠ add, not
  `_reviewMode`, no item/look detail open (skip re-render but still refetch is
  NOT safe mid-edit — skip everything when not at rest; next return catches it).
  If the DATE rolled over while hidden → always re-render Home (logged-row /
  laundry strip recompute). Failures are silent (no toast on background fetch).
- **D1 Snapshot instant-boot**: stale-while-revalidate via Cache Storage
  (pattern: photo byte cache). After each successful `loadData` → stash JSON
  snapshot {items, wears, outfits, outfitLinks, capsules, capsuleLinks,
  exclusions, ts, user_id}. On boot: hydrate from snapshot immediately if
  <7 days old AND user_id matches, render, then fresh `loadData()` behind and
  re-render current root (reuse A3's at-rest guard). Skip cleanly where
  `caches` unavailable.
- **C1 Dead scroll fix**: `window.scrollTo(0,0)` is a no-op app-wide (body is
  the scroll container — CLAUDE.md r3 note). Add `scrollToTop()` helper setting
  `document.body.scrollTop` + `documentElement`; replace all 9 call sites.
- **C2 Scroll restoration on back**: capture scrollTop inside
  `makeItemReturn`/`makeScreenReturn` (they already snapshot view state) and in
  the plain closet grid→item path; restore after the return re-render (one rAF
  after `hydratePhotos`; tiles are fixed-height so early restore clamps safely).
- **B1 Sheet entrance/exit animation**: one `showSheet(el|id, bgEl?)` /
  `hideSheet(...)` helper — slide up from `translateY(100%)` on open (force
  reflow, then clear transform so the existing `.sheet` transition runs),
  animate down + backdrop fade on close, `hidden=true` after ~250ms. Cancel
  pending hide timers on reopen. Swap ALL sheet open/close sites. Keep `hidden`
  semantics identical (code checks `sheet.hidden` for state). Must not fight
  `wireSheetSwipe`'s inline transform (drag-dismiss).
- **B2 Photo fade-in**: preload via `Image.decode()` on the blob URL, then set
  background + fade opacity ~150ms. **Only on first display per session** —
  track shown `image_path`s in a session Set; cache-hit re-renders set
  instantly (avoid worsening re-render flicker).
- **A4 Version toast**: add a version marker near the TOP of `<head>` (meta
  `app-version`, kept in sync with `APP_VERSION` — update the `deploy-wardrobe`
  skill to bump BOTH). On boot + on A3's return path: cache-busted `Range`
  fetch of first ~2KB of own index.html, regex the marker, compare. If newer →
  toast "Update available" + "Reload" chip → `location.replace(path + '?v=' +
  Date.now())` (plain reload() can re-serve the stale cached copy). Toast once
  per detected version (store last-dismissed).
- **B3 reduced-motion**: `prefers-reduced-motion: reduce` kills
  transitions/animations globally.
- **F papercuts (all approved)**: F1 inline SVG data-URI favicon (tee glyph,
  periwinkle) · F2 `font-variant-numeric: tabular-nums` on stat/KPI/count
  surfaces · F3 desktop frame: `@media (min-width: 700px)` max-width ~640px
  centered on `#app` AND every fixed element (header, tabbar, sheets, gridbar,
  toast — fixed `left:0;right:0` + `max-width` + `margin-inline:auto`) · F4
  login email prefill (`store` key `wardrobe.lastEmail`, saved on sign-in).
- **REJECTED: dark mode** (user's phone stays light; would be the only item
  that rots). Don't propose again this round.

### Build order (Fable-first: judgment-heavy → mechanical)

1. ✅ this ROADMAP section
2. B1 sheet animation helper (most call sites, most care)
3. A3 freshness + D1 snapshot boot (share the at-rest guard)
4. C1 + C2 scroll fix + restoration
5. A4 version toast (+ deploy-wardrobe skill edit)
6. A1/A2 manifest + icons
7. B2 photo fade, B3 reduced motion, F1–F4 papercuts
8. Verify in preview (login screen parses = syntax OK; console clean), deploy
   via `deploy-wardrobe` (new day → `2026-07-17 r1`), close out docs/memory.

**Status: FULLY SHIPPED `2026-07-17 r1`, same session as the review.** All items
above landed and were verified in preview (script parses clean, sheet lifecycle,
snapshot round-trip, update-toast end-to-end, desktop frame). Implementation
names in CLAUDE.md's polish-round entry. Reminder for the user: after this
deploy, **re-add the app to the home screen** to pick up the icon + standalone
mode, and sign in once there (standalone storage is separate).

---

## ✅ SHIPPED BUILD — Laundry v1 + Trips (planned + built 2026-07-15, r1→r4)

**Status: FULLY SHIPPED same day, `2026-07-15 r1`→`r4` (core+suggester → sheet+
badges+item actions → Home strip+prompt → trips). `migration/items_laundry.sql`
CONFIRMED RUN on the live DB (verified 2026-07-18 via REST column probe) —
laundry is fully live. See CLAUDE.md's LAUNDRY entry for implementation names.**

History: laundry was rejected TWICE (v25 `availability` field died of manual
upkeep; v3 planning said "stays dead"). User deliberately reopened it 2026-07-15.
This section supersedes the v3 rejection. The survival condition: dirty state is
**derived from wears**, the reset costs ~one tap a week, and neglect degrades
gracefully. Note: the Home laundry row below is the user's own, deliberate first
exception to the "no nudges, ever" rule — laundry only, don't generalize.

### Locked decisions (do not re-litigate)

- **Dirty is DERIVED, never entered.** Item is "in the hamper" when wears since
  `items.last_washed` ≥ its rewear tolerance. `last_washed` null = clean (opt-in
  by behavior; nothing dirty on day one). No stored dirty flag.
- **`WEAR_TOLERANCE`** per-subcategory constant (pattern: `SUBCAT_FORMALITY`):
  tees/sleeveless/blouses/leggings/workout 1 · long-sleeves/shorts/skirts 2 ·
  sweatshirts/pants 3 · sweaters/cardigans 3–4 · jeans 5 · dresses 1–2 ·
  shoes/outerwear/blazers/tights ∞ (never dirty). Tune from use. No per-item
  override in v1 (the one-time overrides below cover the real cases).
- **Reset = her real loads.** Laundry sheet shows load chips derived from
  `color_family` with hamper counts: **Whites (White, Beige) · Cools (Blue, Teal,
  Green, Purple, Gray, Black, Metallic) · Warms (Red, Orange, Yellow, Pink,
  Maroon, Brown) · All together** — mapping APPROVED as a tunable `LAUNDRY_LOADS`
  constant. Tapping load(s) stamps `last_washed` on matching hamper items. Sheet
  carries a **date field** ("I did laundry on…", default today, back-datable) —
  everything recomputes from the derived model.
- **NO self-clear — prompt instead** (user override of the earlier 14-day
  self-clear idea): when the hamper is stale (oldest dirty item **7+ days**, no
  wash logged), the Home row becomes a "done laundry lately?" prompt → laundry
  sheet (set a date, or **"Not yet"** = snooze **3 days**).
- **Pool guard:** items dirty **7+ days re-enter the suggestion pool** (badged)
  even if the prompt is unanswered — suggestions can never starve.
- **One-time overrides, both directions** (`items.laundry_state`, one column):
  "**One more wear**" on a hamper item = treated clean until its next logged wear
  (the wear-create paths clear it); "**To the hamper**" on a clean item = dirty
  until a wash stamp clears it (coffee-spill case). UI: item-detail photo view
  contextual quick action + flipping thumbs on the Home row.
- **Home row = full previous-day confirm strip** (`.laundry-row`, bottom of Home):
  yesterday's worn items as mini thumbs pre-marked with the derived guess
  (over tolerance → 🧺, under → ↩︎ rewear). Tap a thumb to flip (= the one-time
  override, written to DB); ✓ confirms and hides for the day; **confirming
  guesses writes NOTHING** (derive-first). Same slot hosts the stale prompt.
- **Suggester: hard filter with 🧺 "clean only" chip** next to the weather chip
  (default ON, pattern: `_sugg.useWx`). Pool-filtered before combo generation;
  locked + seeded pieces exempt.
- **Log pickers / calendar NEVER filter** — logging records reality.
- **Closet:** hamper badge on tiles + a hamper row on closet root that opens the
  laundry sheet. NOT a closet lens (lenses are for status); filter-funnel dim ok.
- **Wear-again strip:** looks with a dirty piece get an "in the wash" badge,
  stay tappable.
- **Trips (in first cut):** ① packing checklist "N packed items are in the
  hamper" warning; ② **rewear budget** on by-day planner cards — count each
  piece's planned appearances across trip days, flag over-tolerance
  ("this tee appears Tue + Thu"), informational only; ③ **mid-trip laundry day**
  marker droppable on a trip day (reserved key in `capsules.plan` JSONB, pattern:
  `PLAN_BUCKET`) — resets the rewear budget from that day forward. Coming home
  needs nothing (trip wears are logged wears).

### Schema

One migration, `migration/items_laundry.sql`: `items.last_washed date` +
`items.laundry_state text` (null | `'extra:<n>'` | `'hamper'`). As built,
"one more wear" stores the wear-day count at set time (`extra:<n>`) and
self-expires when a newer wear lands — NO wear-path bookkeeping (improvement
over the planned clear-on-wear). Wash stamps clear the override.
**⚠️ User runs it in the Supabase SQL editor; UI shipped gated on it.**

### Build order (sketch)

1. Migration file + user runs it.
2. Constants (`WEAR_TOLERANCE`, `LAUNDRY_LOADS`) + pure derivation helpers
   (`isDirty(i)`, `dirtySince(i)`, hamper list) — testable from console.
3. Laundry sheet (load chips + date + counts) + closet-root hamper row + tile badges.
4. Suggester 🧺 chip (+ 7-day pool re-entry) + wear-again badges.
5. One-time overrides: item-detail quick action + wear-path clearing of 'extra_wear'.
6. Home `.laundry-row` (confirm strip + stale prompt + 3-day snooze in `store`).
7. Trips: packing warning → rewear budget → mid-trip laundry day.

---

## ✅ SHIPPED — Report Cards + Workhorses/Declutter (2026-07-10)

**Status: FULLY SHIPPED, r2 → r3 same day.** User asked how to think about
assessing best/worst brands and retailers by wear frequency and cost, plus
best/worst items within each. **r2** shipped Style Stats' "Brands & Retailers"
section: `renderStatsReportPage()` ranks brands/retailers by a wear-rate index vs.
similar items (tenure-normalized, indirect-standardized by subcategory/category so
basics don't win just for being basics), alongside median $/wear, total spend
(gifts excluded from cost), and a dud count (never worn / archived early). Tap
through to `renderStatsReportDetailPage()` for a KPI card + Best performers /
Underperformers item grids + all-items grid. Groups under 3 items are unranked.

**r3 (same session)** generalized this to a "Report Cards" section covering 7
dimensions: brand, retailer, **subcategory** (canonical taxonomy order, best/worst
WITHIN each type rather than cross-type ranking — her explicit correction), price
bracket, purchase year (current year marked "still proving out"), color, and
acquisition. Also added: **Workhorses** and **Declutter Candidates** smart lists
(Clothing Stats, toggle pair) — declutter logic is transparent (owned 6+ months,
not in any liked look, never-worn-or-badly-under-worn-and-stale) rather than a
black-box score; a **"★ Suggested" workhorse strip** at the top of the capsule
add-items picker (in-season, idx ≥ 1.2); and a **"★ Workhorse" badge** on item
detail (5+ wears, idx ≥ 1.5). See CLAUDE.md's STYLE STATS entry for the
implementation (`buildItemPerf`, `buildReportStats`, `REPORT_DIMS`, `reportPool`).

---

## ✅ SHIPPED BUILD — "Weather + Loop Polish" v3 (planned + built 2026-07-09)

**Status: FULLY SHIPPED in `2026-07-09 r1` (built same session as the review). All
decisions were locked in the 2026-07-09 product review (user answered the
questionnaire; overrides noted per item). No schema changes — `wears.formality_for`
already existed and stays populated (now derived, not asked).**

Through-line: **use what the app already knows** — weather it fetches, formality the
garments imply, weekday patterns in 4k wears — instead of asking or decorating.

### Locked decisions (do not re-litigate)

- **Today tile is DROPPED** (user override: "drop the today tile altogether"). Remove
  the tile; weather intelligence moves INTO the suggestion sheet + trip planner.
  Keep `getHomeLocation()` (suggestion-sheet weather needs it).
- **Weather-aware scoring**: real temps override the season layer heuristic in
  `scoreCombo` when weather is available. Thresholds are top-of-script constants
  (`WX_HOT_F = 78`, `WX_COLD_F = 50`, °F — tune from experience). Rain → boost Boots,
  penalize Sandals (category-level only, no fabric guessing). Surfaces: suggestion
  sheet (home location weather, toggleable chip) + trip-planner per-day suggest
  (that day's `_planWx`).
- **Formality is NEVER asked at log time** (user override on B4): the post-log sheet
  asks context only (+ heart). `wears.formality_for` is silently DERIVED from the
  worn pieces (`deriveWearFormality`) on every wear-create path so context stats
  keep working. Manual correction point = the look's formality edit, as today.
- **Day-of-week context chip**: suggested (pre-highlighted, never auto-saved) context
  in the post-log sheet from weekday history.
- **Dup guard + Undo parity**: `logLookOnDay` gets the soft dup guard; look logs get
  an Undo toast after the post-log sheet closes; back-date (`openLogWear`) toast gets
  an Undo chip.
- **Home logged-state row**: replaces the CTA once today has wears ("✓ Logged today ·
  …") → taps into today's day view. Calendar tile ALWAYS goes to month view (C9: no
  deep-link — predictability).
- **Wear-again strip**: reserve 2 of 12 slots for in-season `likedNeglectedOutfits()`,
  badged.
- **Lock-a-piece + layer button** (user addition): tap a suggestion piece chip to 🔒
  lock it across "New suggestions"; "+ Layer" adds a compatible outerwear/layer piece
  to a combo that lacks one, with a remove affordance when present.
- **"On this day"**: calendar day view shows prior-year wears for the same date (day
  view only, not Home).
- **REJECTED**: season-transition nudge (D13: no nudges), calendar-tile deep-link,
  laundry/availability (stays dead), Today tile in any form.

### Build order (function refs as of 2026-07-08 r1)

1. Drop Today tile: `renderHome`/`todayTileHtml`/`loadTodayTile`/`_todayTile`
   (~index.html:1639–1728) + `.today-tile` CSS.
2. Weather scoring: `scoreCombo` (~4136), `suggestOutfits` (~4192),
   `openSuggestSheet`/`renderSuggestSheet` (~4371/4454); trip path via `planCtx`.
3. Derived formality: new `deriveWearFormality`; wear-create paths `logWearToday`
   (~2933), `openLogWear` (~3052), `logLookOnDay` (~6480), `saveCalClothingLog`
   (~6322), `makeLookFromDay` (~6206), suggestion wear + `planWoreIt` (~8176);
   strip formality row from `openPostLogSheet` (~2977).
4. Post-log weekday context chip: `openPostLogSheet` + `renderContextPicker` (~2854).
5. Dup guard + Undo parity: `logLookOnDay`, `openPostLogSheet` close, `openLogWear`.
6. Home logged row: `renderHome` (~1704).
7. Wear-again neglected slots: `wearAgainCandidates` (~6433) +
   `likedNeglectedOutfits` (~7303).
8. Lock + layer: `_sugg` state (~4344), `renderSuggestSheet`, `suggestOutfits`.
9. On this day: `renderCalendarDay` (~5897).
10. Nav audit: closet-state snapshot in `makeItemReturn` (~2083) restored when the
    `_itemReturn` thunk fires (suggestion piece tap pre-sets `closetCat`/`closetSub`);
    verify capsule banner on all `activeCapsuleId`-scoped renders.

---

## ✅ SHIPPED BUILD — "Hearts + Filters Everywhere" v2 (planned 2026-07-06)

**Status: FULLY SHIPPED, all 8 waves, through 2026-07-06 r7. Kept for reference.
Original plan header follows.** All decisions locked
(user answered the review questionnaire: "defaults for everything" + 7 additions, all
folded in below). Build in wave order; deploy at each ✅ checkpoint via the
`deploy-wardrobe` skill (bump `APP_VERSION`, commit, push).

Through-line: **make the daily wear-log loop safe and single-ask, finish filter
unification on the pickers, add hearts ("I liked this look") captured at the wear
moment, organize Looks by context, and surface the payoff of context capture.**
No schema changes anywhere — `outfits.rating` already exists.

**User-corrected mental model (from the review — design against THIS):** serious
logging only began with this app (the sparse context/occasion coverage in imported
data is an import artifact, NOT evidence she skips capture). She says she **will fill
in context most of the time** — so context capture must be reliable and asked at the
right moment (exactly once), and context-powered features are worth building now. She
will heart looks **when wearing them, not while browsing** — the heart must live in the
wear/log flow, not only on browse surfaces.

### Locked decisions (do not re-litigate)

Hearts:
- **L1 Liked = `outfits.rating === 1`.** Heart toggle: liked ↔ null (PATCH). Other
  values reserved (a future 👎 could use −1). No migration needed.
- **L2 Heart placement (browse):** look canvas toolbar right slot (`openLook` renders
  `looksToolbar` with the shuffle slot unused — put the heart there, filled when liked).
  Do NOT add a 7th icon to the already-full `.lk-actbar`.
- **L2b Heart placement (wear moment — the user's PRIMARY hearting moment):**
  a heart toggle row in `openPostLogSheet` whenever the logged wears share an
  `outfit_id`, AND a small heart toggle on calendar day-view look cards.
- **L3 Tile badge:** small (~14px) heart overlay on `.otile` thumbnails in
  `outfitGridHtml` AND in the look pickers (calendar +Look, plan picker, capsule looks).
- **L4 Filter-by-liked:** a "Liked" dimension appended only to `LOOKS_FILTER_DIMS`
  (outfit-level; `outfitMatchesFilter` handles it, `itemMatchesFilter` ignores it).
- **L4b Liked LENS (user override of the earlier "no 7th lens" call):** add "Liked" to
  `LOOK_LENSES` as a flat folder-less list (like Recent/All). Lens row grows to 8 —
  see L8 CSS note.
- **L5 Liked-first sort** in the calendar +Look picker and the trip plan look picker.
- **L6 Suggestion nudge:** liked outfits count **double** in `buildSuggestIndexes`
  pair-affinity. Still capped/soft; no other engine change.
- **L7 "Liked but neglected" smart list:** liked looks not worn in 60+ days (or never),
  in the Stats Looks section. Ships empty-ish and fills itself as hearts accumulate
  (user expects little backfill — that's fine).

Looks organization:
- **L8 Context lens:** add "Context" to `LOOK_LENSES`. Folders = distinct contexts
  across a look's wears (`outfitContexts(o)` = union of `ctxArr(w)` over wears with
  `outfit_id === o.id`), sorted by look-count desc, plus a trailing "No context"
  folder so nothing disappears. A look may appear in multiple folders (same as Season).
  Final lens order: **Formality · Season · Context · Capsule · Liked · Recent · All ·
  Archived**. CSS: `.lens` buttons are `flex:1` (index.html:169) — 8 tabs won't fit;
  make the row horizontally scrollable (`overflow-x:auto`, `flex:none` buttons,
  `-webkit-overflow-scrolling:touch`, hide scrollbar) rather than shrinking labels.
- **L9 Auto-archive is DERIVED, not written:** a look is effectively archived iff
  `o.archived || outfitItems(o).some(i => itemStatus(i) === "Archive")`. Implement
  `effectiveArchived(o)` and use it in `activeOutfits()`/`archivedOutfits()`
  (index.html:3395). NO cascade PATCHes, NO new column — archiving an item instantly
  hides its looks everywhere; unarchiving the item restores them, and manually-archived
  looks stay archived (`o.archived` untouched). In the look canvas/details of an
  auto-archived look, show a one-line note ("Hidden from browse — contains an archived
  item") and leave the manual Archive/Unarchive button operating on `o.archived` only.

Logging flow (single-ask + log-as-look):
- **G1 Ask context/formality EXACTLY ONCE, at look creation.** Current double-ask:
  calendar +Clothing → `saveCalClothingLog` opens `openPostLogSheet` (ask #1), then the
  user hits "Create look from these N items" and gets asked again. New behavior:
  - `saveCalClothingLog` (index.html:5895): NO auto sheet. Toast with **Undo** +
    **"Add context →"** chips instead (same pattern as `logWearToday`).
  - `makeLookFromDay` (index.html:5768): after creating/merging the look, open
    `openPostLogSheet` for that day's wear rows — pre-seed `_ctxSel` (and formality)
    from any values already on the rows so nothing gets blanked. Include the L2b heart.
  - Solo items never grouped into a look: context stays reachable via the toast chip
    and the day-card "Add context" button — acceptable per user.
- **G2 "Log as look" directly from the +Clothing picker** (skip the day-page detour):
  a second commit button in `renderCalClothingPicker` next to Done ("Log as look",
  enabled when ≥2 picked). Extract the create-or-merge logic from `makeLookFromDay`
  into `createLookFromItems(itemIds, {name})` (dedup via `findDuplicateOutfit`,
  POST outfit + outfit_items, returns outfitId) shared by both; then POST wears WITH
  `outfit_id`, land on the day view, open `openPostLogSheet` once (with heart).
- **G3 Undo everywhere logging is one-tap:** extend `toast()` (index.html:1462) to
  accept an ARRAY of action chips. `logWearToday` toast becomes **Undo** + **Add
  context →**; `saveCalClothingLog` toast gets **Undo** too. Undo = DELETE the created
  wear rows + splice from `wears` + re-render if on the day view.
- **G4 Back-dating from the item:** `openLogWear(id)` (index.html:2811) is fully built
  but DEAD (zero call sites — verify it still works, it predates the rework). Wire it:
  a "Log on a date…" row in the long-press quick-actions sheet (`openQuickActions`,
  index.html:2613) + long-press on `#ibLog` (tap = today as now; wiring at
  index.html:9141).
- **G5 Stat strip on the item photo view:** in `openItem` (index.html:2013), one muted
  line between the nav/sib bar and the photo: `worn 14× · last worn 3 wk ago ·
  $6.20/wear` via `wearCount`/`lastWorn`/`relDate`/`costPerWear` (never-worn → "never
  worn"; no price → omit CPW). Photo view is the most-viewed surface; this is the
  glanceable payoff of logging.
- **G6 "Wear again" chooser:** the Home "Log today's wear" CTA (index.html:1535) and
  the calendar day-view footer open a chooser sheet: a horizontal strip of ~12 candidate
  looks — worn in the last 14 days ∪ liked ∪ most-worn this season, deduped, recency
  first — tap = `logLookOnDay(id)` for today → `openPostLogSheet` (with heart); below
  the strip, the existing **+ Clothing** and **+ Look** buttons. Reuses
  `outfitCollageHtml`. The most common real log is a repeat — make it 2 taps.
- **D1 Local "today":** `todayStr()` (index.html:1437) uses `toISOString()` = UTC;
  evening logs land on tomorrow. Add `localISO(d)` (getFullYear/Month/Date, padded) and
  sweep EVERY `toISOString().slice(0, 10)` call site (~1437, 1511, 2813, 3480, 5382
  streak walker, 5546 day nav — audit all).
- **D2 Soft dup-wear guard:** `logWearToday` (index.html:2731): if a wear for this item
  already exists today, skip the POST and toast "Already logged today" + "Log again →"
  chip. Calendar multi-pickers exempt (intentional).

Filters/pickers:
- **P1 The `_capPick*` picker family gets ONE shared unified funnel.** New
  `pickerFilter = newFilterState()` + `PICKER_FILTER_DIMS = FILTERS` minus
  status/category/subcategory (picker keeps its own status chips + category folders;
  **capsule stays IN** — that's the reported bug). Reset in both openers
  (`openCalAddClothing` index.html:5831, `openCapsulePicker` index.html:7842). Applied
  in `pickerPoolBase()` (index.html:7854) via
  `itemMatchesFilter(i, pickerFilter, { noStatusDefault: true })`.
- **P2 Funnel button + count badge beside each picker search input**, mirroring the
  builder-picker pattern. Extract shared `funnelBtnHtml(id, state)` — the
  button+badge markup is copy-pasted in 4+ toolbars; new surfaces must use it
  (retrofit old ones only if trivial).
- **P3 Calendar +Look picker funnel** (`renderCalLookPicker` index.html:5935) with
  `LOOKS_FILTER_DIMS` (incl. Liked) on a new `calLookFilter` state via
  `outfitMatchesFilter`; **plan look picker** (`openPlanLookPicker` index.html:7619)
  gets keyword search.

Context payoff (user says she WILL fill context — reward it):
- **C1 Context chips on the suggestion sheet:** a row of her top contexts (by wear
  count) above the formality chips in `renderSuggestSheet` (index.html:4112). Picking
  one sets the target level(s) from the EMPIRICAL distribution of `formality_for` on
  wears with that context (levels covering the bulk of those wears; min 3 wears to
  trust), falling back to a tweakable seed constant `CONTEXT_FORMALITY_SEED` (map
  context → level array on the 1–8 ladder; propose sensible values, e.g. Workout [1],
  Errands [1,2], Friends/Rehearsal [2,3], Campus/Travel [3], Date Night [4], Symphony/
  Church [3,4], Party/Shower [4], Work [5], Wedding [6], Chorus Concert [6] — user can
  tweak in code).
- **C2 Contexts page in Stats:** wears by context (respecting the stats date range via
  `rangeStart`), per-context formality demand (avg/spread of `formality_for`), top
  items/looks per context; tap-through to grids following the existing stats
  field-page patterns (`renderStatsFieldPage`). Entry row in `renderStatsMain`.

Hygiene:
- **H1 Dead-code sweep:** retired-search remnants (`searchState`, `newSearchState`,
  `searchOpenRow`, stub `renderSearch`/`runSearch` — KEEP `openSearch`, it's the live
  closet funnel entry), `placeholder()` (index.html:1551), and the duplicate sort menu
  (`PICK_SORT_OPTS`/`PICK_SORT_LABELS` index.html:5840 — derive from `SORT_OPTS`
  index.html:1584). Do NOT delete `openLogWear` — G4 revives it.
- **H2 `.gitignore` `reference-images/`** (user confirmed: don't version).
- **Rejected this round:** 👎 dislike UI, rating-driven suggestion overhaul, reorder
  capsules (needs schema), crop/rotate editor, mandatory context capture (must stay
  optional/skippable).

### NAVIGATION AUDIT (parallel track — user-reported pain, no single fix)

The user reports navigation "doesn't always take me where I expect." Principles to
enforce wherever violated: **back returns to the screen I visibly came from; a tab tap
goes to that tab's root; viewing something must not silently mutate my browse state.**
Known suspects found in review (fix these; user will report more cases as she hits them
— collect + fix in any wave):
- [x] **Fixed 2026-07-09 (v3)** — `openItemFrom(id, browseCtx)` now snapshots
  `closetCat`/`closetSub`/`searchResults` and restores them when the `_itemReturn`
  thunk fires; callers (suggestion piece tap, look-canvas piece tap, capsule item
  tap) pass `browseCtx` instead of pre-setting globals. Builder `_fromBuilder`
  path unchanged (documented exception).
- [x] **Look-return thunk shipped (2026-07-07 r2)** — `_lookReturn` + `openLookFrom(id)`
  mirror the item pattern: every non-Looks entry point (calendar day view, stats look
  grids, capsule looks, trip-plan days) now returns to its origin on back. `leaveLook()`
  is the single exit (back/archive/delete) so no stale returns. Bonus fixes: back from
  an item opened off a look canvas re-opens the LOOK (restoreTab re-opens `lookId`),
  and back from a look opened off Looks-search returns to the results instead of
  clearing the search. Builder round-trips (edit pieces → cancel/save) still abandon
  origin — accepted, they route through `switchTab("looks")`.
- [x] **Verified 2026-07-09 (v3)** — every closet render path (root / category /
  grid) includes `.cltoolbar` and `renderCloset` unconditionally inserts
  `capsuleBanner()` after it while scoped; Looks list renders `looksCapsuleBanner`.
  No gap found; no change needed.

### WAVE 0 — Land in-flight work + housekeeping ✅ deploy after
- [x] **Commit the builder-picker funnel** — uncommitted diff in `index.html`
  (`BUILDER_FILTER_DIMS`, `builderFilter`, funnel in `renderBuilderPicker`, pool filter
  in `builderPool`, `#bldPickFilter` wire). Parse-check, verify in preview, commit. (S)
- [x] **H2 gitignore** `reference-images/`. (S)
- [x] **H1 dead-code sweep** — removed `placeholder()`, `searchState`/`newSearchState`/
  `searchOpenRow`, stub `renderSearch`/`runSearch`; `PICK_SORT_OPTS`/`PICK_SORT_LABELS`
  now derive from `SORT_OPTS`. (see Hygiene above). (S)
→ ✅ **DEPLOYED** (`2026-07-06 r1`)

### WAVE 1 — Daily-loop correctness + safety
- [x] **D1 local-date fix** — added `localISO(d)`; every `toISOString().slice(0,10)`
  call site swept (todayStr, home calendar tile, openLogWear, currentSeason, calStreak,
  calendar month/day nav, stats ranges, trip dates, weather-range fetch). (M)
- [x] **D2 soft dup-wear guard** — `logWearToday` skips the POST if a wear already
  exists today for that item; toasts "Already logged today" + "Log again →" (force flag). (S)
- [x] **G3 multi-action `toast()` + Undo** — `toast()` now accepts an action array;
  `logWearToday` shows Undo + Add context; `saveCalClothingLog` fallback toast gets Undo.
  New shared `undoLoggedWears(rows)` DELETEs + splices + re-renders the active screen. (S/M)
- [x] **G4 back-date entry points** — "Log on a date…" row in quick-actions
  (`#qaLogDate` → `openLogWear`); long-press (500ms) on `#ibLog` opens the same;
  plain tap still logs today. `openLogWear` confirmed working against current wears flow. (S)
- [x] **G5 photo-view stat strip** — `itemStatLine(i)` (`worn N× · last worn X ago ·
  $Y/wear`, never-worn / no-price handled) shown in `openItem` between the sib bar
  and the photo. (S)
→ ✅ **DEPLOYED** (`2026-07-06 r2`)

### WAVE 2 — Capsule filter in the item pickers (the reported bug)
- [x] **P1 `pickerFilter` + `PICKER_FILTER_DIMS`**, reset in both openers
  (`openCalAddClothing`, `openCapsulePicker`). (S)
- [x] **Apply in `pickerPoolBase()`** via `itemMatchesFilter(i, pickerFilter,
  { noStatusDefault: true })`, gated on `hasActiveFilter`. (S)
- [x] **P2 funnel + badge in both picker headers** (`renderCalClothingPicker` +
  `renderCapsulePicker`); extracted shared `funnelBtnHtml(id, state)` and retrofitted
  the Wave-0 builder-picker funnel to use it too. (M)
- [x] **Verified** parse-check + preview load clean; capsule dim now reaches both
  pickers (previously only the builder picker had it). (S)
→ ✅ **DEPLOYED** (`2026-07-06 r3`)

### WAVE 3 — Hearts
- [x] **`toggleLikeLook(id)`** — PATCH rating 1↔null, optimistic update + rebuilds
  `buildSuggestIndexes()` (for L6), used everywhere hearting happens. (S)
- [x] **L2 heart on look canvas** — `looksToolbar` takes a `heartId` param that fills
  the right slot (unused when `showShuffle` is false) with a heart toggle. (S)
- [x] **L2b heart in `openPostLogSheet`** (shown when all logged wears share an
  `outfit_id`, tap saves immediately) + heart overlay on calendar day-view look cards
  (`.cal-heart-btn`, stopPropagation so it doesn't also open the look). (M)
- [x] **L3 tile badges** (`.otile-heart`) — `outfitGridHtml`, calendar +Look picker,
  plan look picker, capsule looks section + add-looks picker. (S)
- [x] **L4 Liked filter dim** — appended only to `LOOKS_FILTER_DIMS` (not the shared
  `FILTERS` array), `liked` key added to `newFilterState`/`hasActiveFilter`/
  `filterActiveCount`, handled in `outfitMatchesFilter`; `itemMatchesFilter` untouched
  so it's naturally ignored elsewhere. (S)
- [x] **L4b Liked lens** — flat folder-less lens in `LOOK_LENSES` (like Recent/All)
  **+ L8 scrollable `.lens` CSS** (`overflow-x:auto`, `flex:none` buttons — ready for
  Wave 4's Context lens too). (S/M)
- [x] **L5 liked-first** — calendar +Look picker (`calLookListHtml`) and the trip plan
  look picker both sort liked looks first, then by recency. (S)
- [x] **L6 liked ×2 pair-affinity** — `buildSuggestIndexes` weights each pair +2
  instead of +1 when the source outfit is liked. (S)
- [x] **L7 "liked but neglected" smart list** — `likedNeglectedOutfits()` (liked +
  never-worn-or-60d+); new "Liked Looks" row in Looks Stats (count + neglected count)
  routes to a dedicated outfits page (`statsOutfitsMode`). (S/M)
→ ✅ **DEPLOYED** (`2026-07-06 r4`)

### WAVE 4 — Looks organization
- [x] **L8 Context lens** — `outfitContexts(o)` helper (union of `ctxArr(w)` over the
  look's real wears); folder rows sorted by count desc + trailing "No context" folder;
  wired into `folderRowsHtml`/`folderOutfits`/`folderLabel`. Lens order now Formality ·
  Season · Context · Capsule · Liked · Recent · All · Archived. (M)
- [x] **L9 `effectiveArchived(o)`** — `o.archived || outfitItems(o).some(archived
  status)`; swapped into `activeOutfits`/`archivedOutfits` (no cascade PATCH, no new
  column); auto-archived note ("Hidden from browse — contains an archived item") on
  the look canvas + details when auto- but not manually-archived; the Archive/
  Unarchive button still reads/writes `o.archived` only. Verified calendar +Look,
  plan picker, capsule looks/add-looks, and Stats liked-neglected all route through
  `activeOutfits()`. (M)
→ ✅ **DEPLOYED** (`2026-07-06 r4`)

### WAVE 5 — Logging flow rework
- [x] **G1 single-ask** — `saveCalClothingLog` no longer auto-opens the sheet (toast
  w/ Undo + "Add context →" chip instead); `makeLookFromDay` opens `openPostLogSheet`
  once post-creation, pre-seeded (`presetCtx`/`presetFml`) from whatever's already on
  the day's wear rows so nothing gets blanked. Heart shows automatically (L2b) since
  the wears now share an `outfit_id`. (M)
- [x] **G2 "Log as look"** — extracted `createLookFromItems(itemIds, {name})` (dedup
  via `findDuplicateOutfit`, shared by `makeLookFromDay` and the new flow); second
  commit button `#calLogAsLook` in the +Clothing picker (shown/hidden by `togglePick`
  once ≥2 picked); wears POSTed with `outfit_id`; one post-log sheet. (M)
- [x] **G6 "Wear again" chooser** — `openWearAgainChooser(date)` shared sheet from the
  Home CTA and a new "↻ Wear again" button in the calendar day-view footer.
  `wearAgainCandidates()` = worn-in-last-14-days ∪ liked ∪ most-worn-this-season,
  deduped, recency-first, capped at 12; horizontal `.wa-strip` via `outfitCollageHtml`;
  tap → `logLookOnDay` → post-log sheet (with heart); +Clothing/+Look stay reachable
  below the strip. (M)
→ ✅ **DEPLOYED** (`2026-07-06 r5`)

### WAVE 6 — Context payoff + finish funnels
- [x] **C1 context chips on the suggestion sheet** — `topContextsByWearCount(6)` row
  above the formality chips; picking one sets `_sugg.targetLevel` via
  `contextFormalityLevel(context)` (mode of that context's `formality_for` wears, min
  3 to trust; else `CONTEXT_FORMALITY_SEED`). Picking a formality chip directly clears
  the active context (manual pick supersedes it). (M)
- [x] **C2 Contexts stats page** — new "Contexts" row in Looks Stats; list page
  (wear count + avg/spread formality demand per context, range-scoped) → tap through
  to a detail page (top items + top looks for that context, also range-scoped). (M)
- [x] **P3 +Look picker funnel + plan-picker search** — `calLookFilter` +
  `LOOKS_FILTER_DIMS` funnel on `renderCalLookPicker`; keyword search added to
  `openPlanLookPicker` (`_planPickQ`), alongside the existing liked-first sort. (M)
- [x] **Docs sync** — ticked shipped boxes here; `FILTER_UNIFICATION.md` Phase 3
  marked SHIPPED; `CLAUDE.md` LOOKS/OUTFIT SUGGESTIONS/CALENDAR/STYLE STATS/DAILY LOOP
  sections + data model updated for hearts/context lens/effectiveArchived/wear-again/
  single-ask. (S)
→ ✅ **DEPLOYED** (`2026-07-06 r6`)

### WAVE 7 — Flagship (build LAST)
- [x] **"Today" tile on Home — weather-aware outfit of the day.** `getHomeLocation()`
  wraps `navigator.geolocation` (keyless, permission-prompted, last fix cached in
  `store` under `HOME_LOC_KEY`/`HOME_LOC_TTL`) → existing open-meteo plumbing
  (`fetchWeatherRange`) for today → one `suggestOutfits(null,null,null,
  currentSeason())` pick, cached per day in `_todayTile` (`loadTodayTile()`, doesn't
  reshuffle on re-render) → rendered as an `.ocanvas.omini` mini collage on a Home
  tile (`todayTileHtml()`); tap → `openSuggestSheet()`. Degrades gracefully: no
  permission/offline → season-only label, no weather; not enough items to suggest →
  tile omitted (no dead state). (L)
→ ✅ **DEPLOYED** (`2026-07-06 r7`)

**"Hearts + Filters Everywhere" v2 is now FULLY SHIPPED (Waves 0–7, `2026-07-06 r7`).**

### Build conventions for this plan
- One wave = one deploy at the ✅ checkpoint; bump `APP_VERSION` each deploy.
- No schema changes anywhere (`outfits.rating` already live in the DB).
- New UI uses the shared helpers (`chip()`, `sectionLabel()`, `openFilterSheet`,
  `itemGridView`, `funnelBtnHtml` once extracted) — never a new bespoke filter UI.
- Context/formality capture stays OPTIONAL on every path — never block a log on it.
- Parse-check before deploy: extract the inline `<script>`, wrap in `new Function(...)`,
  run via `osascript -l JavaScript` (no node locally; preview is login-only).
- Line numbers are as of `2026-07-01 r1` + the uncommitted builder diff; re-grep if
  drifted. Read `CLAUDE.md` (architecture, gotchas, nav model) before each wave.

---

## ✅ SHIPPED BUILD — "Unified Experience + Daily Loop" (planned 2026-06-26)

**Status: FULLY SHIPPED through Wave 5 (2026-06-27 r2). Wave 0 checkboxes below were
never ticked but all items shipped (verified in code 2026-07-06). Kept for history.**

This plan came out of a 3-part product + UX + unification review. The through-line:
the app is a collection of independent render functions that each re-decide layout,
sorting, filtering, density, and gestures. **Unify the "many items at once" experience,
make the daily wear-logging loop a ≤1-gesture reflex, and reduce one-handed reach.**

### Locked decisions (do not re-litigate)
- **A1** One-tap "Wear today": single tap on item photo-view Log = logs today immediately,
  then toast "Wear logged — add context?" with a chip that re-opens context. No modal.
- **A2** Context picker ordering: most-used contexts **for that specific item** first
  (`itemContexts(id)`), then the rest.
- **A3** Do NOT pre-select/pre-check a context.
- **A4** Home: when today has 0 wears logged, show a "Log today's wear" CTA (subtile/badge).
- **B1** Suggestion sheet: after the 8th result show a "New suggestions →" button that
  regenerates a fresh 8 (vary the random seed).
- **B2** Lightly downweight today's dismissed/skipped suggestion combos (session memory).
- **C1** Closet Review landing: pin **Formality** and **Color** to top as "Suggested",
  rest alphabetical.
- **C2** Keep manual field choice (do NOT auto-launch a field).
- **D1** Home calendar tile subtitle: "X wears logged today" (0 → "Nothing logged yet").
- **D2** Move "Closet vs. Your Life" to the TOP of the Stats page.
- **E2** Calendar day view: swipe left/right between days.
- **E4** Build `wears.formality_for` capture: after logging a wear/look, one-tap
  "How dressed up were you?" chip row (levels 1–8). Column already exists — no migration.
- **U1** Build a single `itemGridView(list, config)` component to replace the 7 grid
  wrappers. Fold into the design-system refactor.
- **U2** One shared sort menu everywhere: Color · Name · Newest · Most/Least worn ·
  Formality · Price. Remembered per surface. Replaces hardcoded color sort + count/name +
  category/formality toggles.
- **U3** One shared filter sheet callable from any grid (funnel icon). **MUST filter on
  everything it can** — current Search covers only Color/Fabric/Size/Season/Brand/Status;
  ADD **Formality, Category, Subcategory, Retailer, Acquisition, Price range**.
- **U4** Expose density (per-row) control on every grid via the shared controls bar.
- **U5** Long-press a grid tile → quick actions (Log today · Add to look · Move) without
  entering the item.
- **U6** One selection affordance everywhere (the dot); retire builder outline-only;
  trip pack-tick becomes a dot variant.
- **F1/UX-1** 44px minimum tap-target audit (item nav arrows, clback, sib buttons).
- **F2** Extract type-scale + spacing tokens and shared render helpers
  (`row()`, `sectionLabel()`, `chip()`, `sheet()`) before the feature wave.
- **F3** Sheet grabber pill + swipe-down-to-dismiss.
- **F4** Remove dev-scaffolding (`placeholder()` "We'll build this next"); give every
  empty/zero state a friendly line + a primary action.
- **New feature** "Make a look from today's logged items": in calendar day view, when ≥2
  solo items (`dayGroups` entries with `outfitId === null`) exist for the day, show
  "Create look from these N items" → creates `outfit` + `outfit_items`, back-fills
  `wears.outfit_id` so the day re-groups. **2+ items = a Look; 1 item stays an item.**
- **Bug** Stats "Least Expensive" must exclude $0/free items (`> 0`, not just `!= null`).
- **Gesture** Global swipe-right-from-left-edge = back (dispatch to active screen's back fn).
- **Rejected this round:** E1 duplicate-item, E3 swipe-log from Looks list, B3 suggest-from-search.

### Guardrails (unchanged, see §0 below): single-user · heuristics-only · one `index.html`
· plain `fetch` · `background-size: contain` · no libraries.

---

### WAVE 0 — Quick wins (independent, instant value) ✅ deploy after
- [ ] **Least Expensive excludes $0** — `buildSmartList` line 4882, `least-expensive`
  branch: filter `parseFloat(i.price) > 0`. (S)
- [ ] **Stats label fix** — `buildSmartList` `never-worn` (line 4862) + `renderStatsMain`
  `notLoggedLabel` (line 5128): rename "Not Logged on Calendar" → "Never Worn" (all-time) /
  "Not Worn · past N" (range). (S)
- [ ] **Home calendar tile subtitle** (D1) — `HOME_TILES` line 1290: `sub()` returns
  today's wear count from `wearDayMap()`. (S)
- [ ] **Closet-vs-Life to top of Stats** (D2) — `renderStatsMain` (5113): move
  `closetVsLifeHtml()` (5055) above Clothing Stats section. (S)
- [ ] **Closet Review field priority** (C1) — `renderReviewLanding` (5389): pin formality +
  color_family rows to top under a "Suggested" label, rest alphabetical. (S)
- [ ] **Suggestion "New suggestions →" + dismissal memory** (B1/B2) — `renderSuggestSheet`
  (3008): add regen button at end-of-list; track shown/dismissed piece-id sets in a
  session global, downweight in `scoreCombo` (2855). (M)
- [ ] **44px tap-target audit** (F1) — CSS lines 434/442/148: `.item-sib-btn`,
  `.item-nav-btn`, `.clback`/`.clsearch` → 44px hit area (padding, keep glyph small). (S)
→ ✅ **DEPLOY** (`2026-06-26 r5`)

### WAVE 1 — Foundation: tokens + helpers + grid component (behavior-preserving)
- [x] **Type-scale + spacing tokens** (F2/UX-2) — `--fs-xs..xl`, `--sp-*` in `:root`. (shipped r6)
- [x] **Shared render helpers** (F2) — `sectionLabel()`, `chip()` added. (shipped r7)
- [x] **Sheet grabber + swipe-down dismiss** (F3) — `.sheet` grabber + touch handler. (shipped r6)
- [x] **`itemGridView(list, config)`** (U1) — unified grid; surfaces migrate in Wave 2. (shipped r7)
- [x] **Shared grid-controls bar** (U2/U3/U4) — `showGridBar()`/`hideGridBar()` wrappers;
  sort + filter stub buttons added to `#gridBar`. (shipped r7)
→ ✅ **DEPLOY** (`r7`) — behavior unchanged; `itemGridView` ready for Wave 2 migration.

### WAVE 2 — Unified rollout: sort, filter, density, selection everywhere
- [x] **Migrate all 7 surfaces** to `itemGridView` — gridHtml, pickerGridHtml, builderItemGrid,
  capGroupsHtml all delegate to itemGridView; capItemTileHtml removed. (shipped r8)
- [x] **Shared sort menu** (U2) — Color · Name · Newest · Most/Least worn · Formality · Price;
  `#gbSort` button, `#sortMenuPop`, `sortItems()`, per-surface `_gridSortKeys` persisted to
  localStorage. Applied to closet + search grid. (shipped r8)
- [x] **Expanded shared filter sheet** (U3) — added Category, Subcategory, Formality,
  Retailer, Acquisition to `FILTERS`/`searchState`/`runSearch`. (shipped r8)
- [x] **Unified selection affordance** (U6) — dot everywhere via itemGridView migration;
  builder tiles now show dots for pieces already on canvas. (shipped r8)
- [ ] **Empty-state pass + remove scaffolding** (F4) — `placeholder()` defined but never
  called; existing empty states are already friendly. No action needed.
→ ✅ **DEPLOY** (`r8`)

### WAVE 3 — Daily logging loop
- [x] **One-tap "Wear today"** (A1) — `logWearToday()`: tap Log → immediate POST → toast
  "Wear logged" with "Add context →" chip. (shipped r9)
- [x] **Context picker ordering** (A2) — `renderContextPicker`: `_logItemId` drives
  per-item context frequency sort via `itemContexts()`. (shipped r9)
- [x] **`wears.formality_for` capture** (E4) — `openPostLogSheet(wearRows)`: context chips
  + 1–8 formality row; PATCHes all wears. Surfaces: A1 toast chip + look "Wear" flow. (shipped r9)
- [x] **Home "Log today's wear" CTA** (A4) — `renderHome`: no-wear-today shows `.log-cta`
  button → calendar day (today) + openCalAddClothing. (shipped r9)
→ ✅ **DEPLOY** (`r9`)

### WAVE 4 — Gestures & reach
- [x] **Swipe-right-to-go-back, app-wide** — one left-edge (<24px) swipe listener;
  dispatch to active screen's back fn (`closetBack` / `looksBack` / `statsNavBack` /
  calendar). (shipped r1 2026-06-27)
- [x] **Day-view swipe between days** (E2) — `renderCalendarDay`: horizontal swipe →
  prevD/nextD; skips if touch starts on a cal-outfit-card. (shipped r1 2026-06-27)
- [x] **Swipe between sibling items in detail** — `openItem`: swipe photo →
  `siblingItems()` prev/next. (shipped r1 2026-06-27)
- [x] **Long-press tile quick-actions** (U5) — 500 ms long-press on `.gtile[data-item]` →
  `#quickActSheet` (Log today · Add to look · Move to folder). (shipped r1 2026-06-27)
→ ✅ **DEPLOY** (`r1` 2026-06-27)

### WAVE 5 — New capture feature
- [x] **Make-a-look from today's logged items** — `renderCalendarDay`: when ≥2 unique
  items in solo groups (`outfitId === null`), shows accent "Create look from these N items"
  button; POSTs outfit + outfit_items, PATCHes wears.outfit_id, rebuilds indexes,
  re-renders day. Toast with "View →" shortcut to Looks tab. (shipped r2 2026-06-27)
→ ✅ **DEPLOY** (`r2` 2026-06-27)

### Build conventions for this plan
- One wave = one or more deploys; **always deploy at the ✅ checkpoint** before starting the
  next wave so regressions are isolated.
- Bump `APP_VERSION` each deploy (line 871). Same-day = increment `rN`.
- After Wave 1, **build all new UI with the shared helpers/tokens**, never inline styles.
- No schema changes needed anywhere in this plan (formality_for column already live).

---

## What's shipped (rework series, 2026-06-20 → 2026-06-25)

All screens are fully built. Per-release detail in `archive/CLAUDE_build_history.md`.

- ✅ Home launcher (Stylebook tile grid)
- ✅ Closet: status lens, category folder drill, item detail (two-view), field editing, bulk select/edit/delete/move, prev/next item nav, root jump link
- ✅ Add Item: photo, all fields, inline category picker
- ✅ Search: keyword + 6 filter rows
- ✅ Looks: lens switcher (Formality/Season/Recent/All), outfit collage, look detail, formality override, nudge pieces, active-capsule scoping
- ✅ Build-a-look canvas: pointer drag+resize, save to `outfits.layout`, entry from Looks + item detail
- ✅ Calendar: month grid with mini collages, day view, swipe copy/move/delete, log Clothing + Look
- ✅ Style Stats: Clothing Stats + Looks Stats + View Closet By; field donut; smart list grids; filter + range sheet
- ✅ Closet Review: inline field picker on deal card, shuffled queue, review formality
- ✅ Bulk edit: includes Formality
- ✅ Capsules & Trips: list/detail/form/add-items picker; packing checklist; weather strip (Open-Meteo); Rename/Duplicate/Share list; "Plan outfits from this" scopes Closet + Looks
- ✅ Outfit suggestions: slot-filling engine; formality cohesion + color co-occurrence + rotation scoring; exclusions hard filter; softmax variety; "no-suggest" tag; capsule-scoped mode; feedback sheet (exclusions)
- ✅ Closet-vs-life gap in Stats
- ✅ Schema: 1–6 formality (`items.formality`), `wears.formality_for`, `outfits.rating`, `exclusions` table

---

## Back-burner (not yet scheduled)

- **Home attention-slot hierarchy** (proposed 2026-07-19, not picked): cap
  stacked Home rows (trip > catch-up > laundry > backup) at ONE above the
  fold, rest collapse to a quiet expandable line; unify the row components'
  styling. Revisit if Home starts feeling naggy in real use.
- **In-app confirm sheets** (proposed 2026-07-19, not picked): replace the
  ~8 native confirm() calls with a styled confirm sheet in the app's design
  language.

- **Picker shell unification** (parked 2026-07-18): the flat pickers already
  share their data layer (pickerPoolBase/pickerCatBar/pickerGridHtml/
  togglePick); the remaining duplication is thin render shells + wiring
  (renderCalClothingPicker vs renderCapsulePicker). Deliberately NOT refactored
  blind — do it behind `migration/selftest.html` the next time a picker change
  is needed anyway.
- **Data-safety follow-ons**: backup nudge when last backup > 30d (nudge rule
  is soft now); restore-from-backup script in migration/.

These are agreed-on ideas parked for a future session. No timeline.

**Features:**
- Capsule suggestions improvements: variety seeding, multi-anchor ("these jeans AND these boots"), constraints ("no heels today"), context picker
- ✅ Multi-exclude UI — shipped r3, reworked r4 2026-06-27. `openExcludeSheet` lists every unordered
  PAIR among the shown pieces as a toggle row (thumbnails + names); the user ticks only the specific
  pairs that clash (A×B can be excluded while A×C stays fine). Already-excluded pairs show locked.
  Each ticked pair → its own exclusion row. NOT subset-pairwise, NOT "none of these".
- ✅ Context typeahead — shipped r3 2026-06-27. `renderContextPicker` "+ Add…" input now live-filters
  known contexts (`contextOptions()`) and offers tap-to-pick or "+ Create". Routed into suggestion
  "Wear today" + calendar +Clothing/+Look flows via `openPostLogSheet`.
- ✅ `wears.formality_for` capture — shipped r3 2026-06-27. `openPostLogSheet` (context + 1–8 formality)
  now also fires after suggestion "Wear today", calendar +Clothing, and calendar +Look (previously
  only solo-log + look-detail wear).
- ✅ Builder subcategory drill + scoped search (Phase 3a) — already implemented in `builderPickContent`
  (cat → subcat folders → grid, scoped search, quick-switch subcat chips). Verified r3 2026-06-27.
- ✅ Season derive-and-confirm in Closet Review (Phase 3c) — shipped r3 2026-06-27. Season + Formality
  REVIEW_FIELDS now carry `guess`/`guessLabel`; the deal card pre-fills the derived value and shows a
  "✨ Guessed from… — confirm or change" hint that clears once the user edits.
- ~~Outfit rating~~ → SCHEDULED: hearts, Wave 3 of the v2 build above (👎 still rejected)
- ~~"Outfit of the day" on Home connected to weather~~ → SCHEDULED: Wave 7 of the v2 build
- ~~Wear-logging loop overhaul~~ → SCHEDULED: Waves 1+5 of the v2 build (Undo, back-date,
  single-ask, log-as-look, wear-again). Long-press grid log already shipped (W4 quick-actions).

**Guessed-value indication (r3 2026-06-27):** Formality imputation (`itemFormalitySet`) shows `est.`
in detail/looks AND now pre-fills + labels in Closet Review. Season guess (`guessSeason`) labeled in
review. `date_is_guess` deliberately left OUT of review (476 imported items would flood the queue;
already indicated via month-only display).

**Infrastructure:**
- Reorder capsules (needs an `order` column on `capsules`)
- Crop/rotate photo editor
- ✅ Auto-refresh trip weather — shipped r3 2026-06-27. `_wxAutoTimer` re-fetches the weather strip
  every `WX_TTL` (10 min) while a trip detail is open (cleared on re-render + tab switch); manual ↻
  refresh button added to the Locations header.

---

## North star & guardrails (locked)

- **Single-user.** No social/sharing/multi-account features.
- **Heuristics only, no AI backends.** Client has only the Supabase anon key. "Smart" = analytics + rules over own data + keyless external APIs (open-meteo). No Edge Functions, no server proxy.
- **Derive-first, capture-light.** Compute from existing data. Add a captured field only when it can't be derived and a feature in hand needs it.
- **One `index.html`.** No build step, no CDN, no libraries.
- **Plain `fetch`.** No supabase-js.
- **`background-size: contain`** on all garment photos, always.

---

## Full data reset (planned)

Once feature-complete, the user will update Airtable with new schema fields, wipe
Supabase, and re-import. Plan: `migration/RESET_PLAN.md`.
