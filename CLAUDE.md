# CLAUDE.md — Wardrobe App

Guidance for working in this repo. Read alongside `README.md`.

> ## ⚠️ READ FIRST — the product philosophy was re-decided on 2026-07-26
>
> A strategy interview that explicitly treated **every "locked" decision in this
> file as provisional** produced an approved philosophy that supersedes the
> product framing below wherever they conflict. The engineering content of this
> file (architecture, gotchas, data model, conventions) is unaffected and still
> authoritative. **`AUDIT_2026-07-26.md` in the repo root is the companion** —
> findings, what's fixed, what's open, and a revised rack spec.
>
> What changed, in short:
> - **Identity is mirror-first, and that's stronger than this file implies.**
>   She opens Stats *daily*, to look rather than to learn, and when offered 12
>   analytical features to cut she kept 11 (dropped **Mending**, removed in r8).
>   The stats ARE the daily reward.
> - **The app is over-*presented*, not overbuilt. Compress, don't delete.**
>   Given one round she chose a coherence pass over new features.
> - **The rack is BUILT (2026-07-26 r6+r7, `js/20-rack.js`)** — a standing ~46-piece derived pool
>   the suggester draws from by default, stratified by slot + formality +
>   temperature, **80% recently-reached-for / 20% deliberately cold**. The cold
>   quota is load-bearing: without it the rack calcifies and shrinks her working
>   wardrobe, i.e. the mirror would cause the thing it measures. It must read
>   **forward `dayplan` contexts and trip dates** so declared upcoming events
>   stock it, rather than guessing levels from history. Her four conditions:
>   the rack is always a visible screen, the suggester always names its pool
>   with a count and a one-tap widen, pull-in works from anywhere, and locking a
>   non-rack piece never fails. **All four are enforced and pinned by tests** —
>   see the RACK entry below.
> - ⚠️ **This conflicts with two entries below** and the conflict is deliberate,
>   not an oversight: ⑨'s "rescue-only: widens the pool, never narrows it", and
>   the suggester's "by design there is NO unworn/last-worn weighting". The rack
>   narrows, and reintroduces recency via pool construction. She approved it
>   knowingly, on condition the narrowing is visible and reversible.
> - **Hard NOs, asked directly:** notifications, AI, a second user, shopping,
>   voice, export-as-a-product. In-app laundry prompts remain fine.
> - **Sacred two-tap:** "what do I wear today" and "log what I wore".
> - **She likes building this.** The goal is not to finish — it's an app that
>   can absorb five more years without getting worse.

**"THINGS YOU MIGHT BE WRONG ABOUT" (2026-07-26 r10) — SHIPPED.** Audit B3, and
the clearest expression of the mirror-first identity: the app knows things about
the wardrobe that disagree with what she TOLD it, and the disagreement is more
interesting than either number alone. `buildMisfits(pool?, wearRows?)` +
`renderStatsMisfitPage()` + `statsView "misfit"`, row in Clothing Stats.
Per Available piece with an EXPLICIT `items.formality` and ≥`MISFIT_MIN_DAYS`(5)
levelled wear-DAYS: if ≥`MISFIT_SHARE`(70%) of those days sit at a level the
claim doesn't contain, it's flagged. `addMisfitLevel` **appends, never replaces**
(same rule as the season flag) and clears every `o._bucket`.
⚠️ **Explicit formality only** — `itemFormalitySet()` imputes a set when none is
stored, and flagging an imputed value would be the app arguing with itself.
⚠️ Not circular with the piece's own tag: `wears.formality_for` is derived from
the WHOLE outfit (`deriveWearFormality`), so a blazer tagged Dressed Up that
keeps going out with jeans records genuinely lower days. A solo-logged piece
derives its level from itself alone and so can never disagree — harmless.

**THE RACK (2026-07-26, r6 + r7) — SHIPPED.** `js/20-rack.js` (boot renumbered
to `21-boot.js`; index.html now has **22** cache-busted tags). A standing derived
pool — "what's in play right now" — that the suggester draws from by default.
It exists because the suggester is good in a capsule and a slot machine over 476
items: the fix was the POOL, not the algorithm.

- **`buildRack({pool, wearRows, today, season, wx, plans, pinned, pushed})`** is
  injectable and deterministic — same inputs, same rack — because **stability is
  the feature**; a rack that reshuffles every open is a random sample with extra
  steps. Stratified, NOT a top-N: `RACK_SLOT_QUOTA` (Tops 16 · Bottoms 11 ·
  Dresses 5 · Shoes 9 · Outerwear 5), because a 60-piece rack that happens to be
  45 tops cannot build an outfit.
- ⚠️ **`RACK_COLD_SHARE` (20% of every slot) is LOAD-BEARING, not a nicety.**
  Without it the rack calcifies — worn → on the rack → suggested → worn — and
  over five years shrinks her working wardrobe, i.e. the mirror would cause the
  thing it measures. It's also the nicest part (the rack screen leads with "N you
  haven't reached for lately"), and a selftest case goes red if it's relaxed —
  verified by zeroing it. **Do not "optimise" it away.**
- **`rackNeededLevels()` reads FORWARD `dayplan` contexts** (her ask: "can set
  events for future so the rack knows"), with her habitual levels as the floor.
  ⚠️ Load-bearing too: `targetLevel` is a HARD filter in `suggestOutfits`, so a
  rack that can't cover a declared level returns an **empty sheet** — the
  2026-07-19 capsule bug arriving via a smaller pool instead of a smaller capsule.
- **Laundry is deliberately ignored here.** Dirty pieces falling off would churn
  the rack daily and stop it being recognisable; the suggester's own `cleanOnly`
  still applies on top.
- **Nudges, never upkeep:** `pullOntoRack` / `pushOffRack` from any item photo
  view. Pins persist; **push-outs EXPIRE after `RACK_PUSH_DAYS` (42)** so a
  summer "not now" can't haunt October. She said she wouldn't reliably curate but
  might sometimes — so the app keeps it and she nudges it.
- **Pool precedence (audit M2):** during a trip the **suitcase IS the rack**.
  They never compose — the intersection could be four items. `openSuggestSheet`
  sets `capsuleId` from `tripModeId`, so the capsule branch wins in `_suggPool()`
  and the rack chip hides. Pinned by a test.
- **`_sugg.wholeCloset`** is the widen; session-only, resets every open, so the
  app never quietly stays narrowed OR quietly stays wide.
  `suggestPoolChipHtml()` always names the pool and its count.
- ⚠️ **Locking or seeding an off-rack piece must never fail.** Holds by
  construction (`slot()` returns locked pieces directly; the seed is unshifted
  after filtering) and is pinned by two tests. This is the line between a tool
  and a cage.
- **"Vary this" opens on the whole closet** on purpose — it works from one saved
  outfit, not from "what's in play".
- Surfaces: closet-root row (always visible, `data-rack`) → `renderClosetRack`
  (`closetRack` flag, same shape as Worn/Hamper — ⚠️ **every shelf flag must be
  cleared together** in `switchTab`, `closetBack`, `clRootJump` and each shelf
  handler, or two shelves fight) · the pool chip in the suggester · the pull/push
  line on the item photo view.

**Round D "Where You Were" (2026-07-25, r14 → r21) — SHIPPED, and then largely
UNBUILT again. Read this whole entry before touching weather/season code; the
deletions are the most important part.** Selftest 91 → 136 → **124** (the drop
is deliberate). Every round was browser-run green.

**The arc, honestly:** r14 shipped her ask (log where I was + flag
season/weather contradictions) PLUS a third thing she never asked for — an
engine that GUESSED where she'd been from outfit anomalies. r15–r18 were four
same-day patch rounds, each fixing a real flaw in that guessing layer
(own-spread bars, span+density clustering, null-day hygiene, signal
separation, no-proposal-no-flag). Then she said: *"this whole feature set
feels like a mess."* It was, and the diagnosis was specific — every bug she
hit was in the guessing layer or its UI; the parts she'd actually asked for
had needed zero patches. **r19 deleted the guessing layer wholesale.**
⚠️ **Do not rebuild it "to help."** A wrong guess costs more trust than
hand-entry costs taps (locked, 2026-07-25). If a future round wants trip
detection, that is a product conversation, not an implementation detail.

**WHAT'S GONE (r19)** — `buildDayWxAnomalies`, `itemTempCenter`,
`_clusterAwayDays`, trip guesses, per-day anomalies, home marks
(`WXA_HOME_KEY`, `homeRanges`, `isMarkedHome`), `#wxAuditSheet` +
`openSeasonAuditSheet` + `openWxDaysView` + `openWxSeasonEdit`, the
health-check row, the calendar-kind flag, and 9 tuned constants. ⚠️ The kv key
`"wxaudit_home"` may still hold data on the live DB — it is an unread orphan,
deliberately not migrated.

**WHAT SURVIVES, and why it's the good part:**

① **WHERELOG (hand-entry, the only source of travel truth)** —
`kvData("wherelog")` = `[{from,to,name,lat,lon}]`, edited in Settings → "Where
you've been" (`openWhereSheet`/`_renderWhereSheet`/`_saveWhere`/
`removeWhereEntry`/`whereListHtml`, `js/18-weather.js`).
**`awayRanges(log?, caps?)`** (`js/06-home.js`) is the single reader: dated
trips' `locations` ∪ wherelog, wherelog last so it wins on overlap. ⚠️ A trip
with **several locations that all lack `from`/`to` yields NO ranges** —
unassignable. `awayRangeFor(date, ranges)` is the lookup.
② **LOCATION-TRUE WEATHER** — `mergeWxDays(log, fetched, {today, keepAfter,
away, loc, floor})` is pure and owns the merge. `backfillWxLog()` does a
second pass, one `fetchWeatherRange` per away range, merged `{away:1, loc}`.
⚠️ **An away merge ignores the 15-day forecast guard** — on a day she was
elsewhere the home reading is wrong however recent. `correctAwayWeather(r)`
does one new range; **`revertAwayWeather(r)`** (r19) is its mirror and is
mandatory on delete/undo — without it a correction outlives the answer that
justified it, leaving days stranded with another climate's temperatures. It
re-applies any surviving overlapping range afterwards.
③ **NULL-DAY HYGIENE (r17, load-bearing)** — Open-Meteo returns `null` for
days it has no reading and `Math.round(null)` is **0**, so archive gaps were
stored as hard freezes, poisoning bands + profiles + everything downstream at
once. `_wxDay(daily, i)` (`js/18-weather.js`) drops nulls at the source in all
three fetch zones; `isNullWxDay`/`purgeNullWxDays` clear stored artifacts on
backfill, and every derivation filters them. **Never write a weather entry
without this guard.**
④ **SEASON BANDS** — `seasonBands(log?)` → per season
`{p10,p25,median,p75,p90,n}` of maxT over **non-away** days;
`SEASON_BAND_MIN`(15) or null (consumers fall back to calendar). Memoized on
wxlog object identity (`_seasonBands`/`_seasonBandsFor`). ⚠️
**`SEASON_BAND_TRIM`(35°F) around the median is load-bearing** — untagged away
days sit in the log as home weather, and a warm-December fixture dragged
Winter p90 27°→84°, silently disarming the detector for exactly the days that
poisoned it.
⑤ **DERIVED SEASONS** — `effectiveSeasonOf(date, log?, bands?)`: an `away` day
counts as the home season its **temperature** resembles.
**`derivedSeasonSet(i, wearRows?, log?, bands?)`** (r20) derives from wear
history **ignoring any explicit tag** — that's what lets every item be asked
what its evidence says. Counts distinct **DAYS**, needs
`SEASON_DERIVE_MIN_DAYS`(3), keeps seasons ≥`SEASON_DERIVE_SHARE`(15%),
returns canonical `SEASONS` order so two answers compare by value.
`itemSeasonSet` keeps its contract (**explicit always wins**) and delegates
for the fallback.
⑥ **`similarDays` INCLUSION** — arg is `ranges` (was `trips`), takes
`awayRanges()` objects. A date is excluded only if it's in a range **and**
`log[date].away` is unset (known-away, uncorrectable). Corrected away days
flow through carrying `loc`, appended to the tile.
⑦ **THE ONE FLAG (r19, her criterion)** —
`buildSeasonWxFlags({pool,wearRows,log,bands,dismissed})` returns a **plain
array**. Per Available item with an explicit season and ≥`WX_PROFILE_MIN`(5)
weather-matched wear-days: `pieceCommonRange` = **[p25,p75]** of worn maxT;
each tagged season's general range = its band **[p10,p90]**.
⚠️ **Overlap with ANY tagged season → no flag, full stop.** This kills
unactionable flags *structurally* rather than by suppression, and needs no
tuned margins — two earlier margin constructions both got this wrong and she
reported both. Then `fit` = seasons whose general range overlaps
`pieceCommon`; `missing` = fit − claimed; **no missing → no flag**; `dir` =
hot/cold/between. Dismissals: `kv "wxaudit_ok"` =
`{itemId: JSON.stringify(items.season)}` so editing the season re-arms it.
`wxAuditFlags()` memoizes on a length-stamp; ⚠️ **that stamp cannot see an
in-place season edit**, so `_wxAudit` is nulled explicitly in `saveField`
(season), `correctAwayWeather`, `revertAwayWeather`, `addFlagSeason`,
`dismissWxFlag`.
⑧ **SURFACES (two, both where she already looks)** — the item **details** view
(beside "Usually worn"): one sentence + `＋ Add <season>` (`addFlagSeason`,
**appends, never replaces**) / `Edit season…` / `It's fine` (`dismissWxFlag`);
plus a "Worn like X" line under the Season row when it adds something. And
**Closet Review**: `season_check` row compares what she SET against what the
history shows, queueing only genuine disagreements. ⚠️ Its `guess` is the
**UNION** (`seasonCompareMerged`), never the derived set alone — accepting a
narrower derivation would silently delete a season she chose, and "worn like
Winter" means she hasn't worn it in summer *yet*. `REVIEW_FIELDS` gained an
optional **`saveKey`** so a row can edit a column it isn't named after.
⑨ **TEMPERATURE-ELIGIBLE SUGGESTIONS** — `inSeasonWx(i, season, wx)` +
`WXA_RESCUE_MARGIN`(5) in `js/12-looks.js`, used by `suggestOutfits`' slot
pool, `swapSuggestionPiece`, `addSuggestionLayer`. **Rescue-only: widens the
pool, never narrows it.** ⚠️ Still true of `inSeasonWx` itself, but NO LONGER
true of the suggester overall — the rack (2026-07-26 r7) narrows the default
pool. Approved knowingly; what makes it different from the December bug below is
that the rack is labelled, counted, and one tap from being widened. Fixes a real pre-existing flaw — a December trip
somewhere warm asked for "Winter" and filtered the sundress out *before*
scoring could see the 84° forecast.

⚠️ **SHEET STACKING (r19, cost her a day of "the button does nothing")** —
every sheet wrapper is `z-index: 301`, so **DOM ORDER in index.html decides
the stack**. `#whereSheet` sat *after* `#fieldSheet`, so "Edit season" opened
the field sheet UNDERNEATH it and looked completely dead. `#whereSheet` now
precedes `#fieldSheet`. **Any sheet that hosts a field edit must be declared
BEFORE `#fieldSheet`; keep `#fieldSheet` last among sheets.**


**Round C deferred list (2026-07-25, r9→r10) — SHIPPED.** The two items she'd
answered "yes, next round" to, built straight after Round C.
① **PALETTE** — `buildPaletteStats(pool?, wearRows?)` / `renderStatsPalettePage()` /
`statsView "palette"`; row in Looks Stats beside Closet vs Life. Share of pieces
OWNED per colour family vs share WORN, two stacked bars + a row per family sorted
by the gap, tapping into that colour's grid. ⚠️ **Unit is PIECE-DAYS** (each piece
once per day it went out) — the only unit comparable to a per-item closet share;
rows would double-count and wear-DAYS would flatter accent colours worn one piece
at a time. **Never call it "wears" in the UI.** Colourless pieces excluded from
both sides. Keeps its funnel (its pool IS `statsPool()`); links across to the
Colors report card, which answers a different question — Palette is about
**proportion** (is the mix you own the mix you wear), the report card is about
**per-piece performance**. They can disagree and both be right.
② **WHAT'S MISSING** — `buildThinSpots(pool?, wearRows?)` / `buildMileage(pool?)` /
`renderStatsMissingPage()` / `statsView "missing"`. **Thin spots:** per context over
`GAP_MIN_CTX_DAYS`(5), count level-covering Available pieces PER SLOT and report the
thinnest (`GAP_SLOT_FLOOR`=3); a context is only as served as its binding slot, and
dresses count toward Tops AND Bottoms. **Mileage:** `MILEAGE_MIN_DAYS`(25)+ wear-days
desc with age + $/wear — **explicitly not a wear-out prediction** (no durability
model exists; the note says so). Read-only: the before-you-buy manual-entry check
stays rejected. Uses the **full Available closet, not `statsPool()`**, and hides the
funnel to match (r11 fix). `contextFormalityLevel` gained an optional `wearRows` arg
so the new functions are genuinely injectable.

**Round C "Memory + Payback" (2026-07-25, r1→r8) — SHIPPED, all 9 steps.**
Reviewed and built the same day; one deploy per step. Selftest 52 → **80 cases,
written but NOT RUN** (no browser this session — run `migration/selftest.html`).

① **WEATHER MEMORY** — `kvData("wxlog")` had been written daily since 2026-07-20
and **read by nothing**. Now: `backfillWxLog()` reconstructs weather for the whole
wear history in ONE existing `fetchWeatherRange(lat,lon,start,end)` call (it already
splits the forecast window from the ERA5 archive); idempotent, and ERA5 **overwrites
entries older than 15 days** because those were forecasts when logged. Window
`WXLOG_DAYS` 400 → **1200**. `similarDays(wx, {contexts,limit,excludeDays,log,dayMap,
today,trips})` scores past wear-days `|Δmax| + 0.5|Δmin| + WX_WET_PENALTY(8)` on a
wet/dry mismatch, **cuts anything over `WX_SIM_CUT`(15)** (a bad match is worse than
none), drops the last 14 days and **all dated-trip days**, dedupes by look.
`wxMemoryRowHtml(wx, contexts, {compact})` + `wireWxMemory(root)` render the
"You've dressed for this before" strip in the **suggester** (above `#sgPreview`)
and the **Tomorrow card** (`compact:true`). `itemWxProfile(id)` → 10th/90th
percentile of maxT, needs `WX_PROFILE_MIN`(5) days, shows as "Usually worn 45°–62°"
on the item photo view. Entry: a one-time Home card (`WX_BACKFILL_KEY`,
`WX_SNOOZE_KEY`, gated on `wears.length > 100`) — **that card is the real entry
point**; the Settings "Weather history" card is only the re-run hatch.

② **MILESTONES** — `milestoneFor(rows)` returns at most one of six rungs, in order:
`first` · `paidoff` (crossed under $1/wear; gifts excluded) · `rescued`
(`MILESTONE_RESCUE_DAYS`=180) · `round` (`MILESTONE_ROUNDS` 10/25/50/100) ·
`completeset` (every Available pair of Shoes worn this year, 3+ pairs) · `streak`
(beats `kv "beststreak"`, min 5). **One per log, each key once ever** — seen-set in
`kv "milestones"`; the cap is deliberate and was built in from the start.
`logCelebration(rows, {defer})` computes + commits; `flushMilestone()` is drained by
`openPostLogSheet`'s `close()` so a toast never lands under an open sheet (it
replaces "Logged ✓" but **never** the Undo chip). `unmarkLastMilestone()` runs in
`undoLoggedWears` so a mis-tap can't permanently spend "first outing". Wired at all
five wear-create sites.

③ **WEEKLY RHYTHM** — `weeklyRhythm(wearRows?)` → `Map(dow → {contexts, n})`, up to
`RHYTHM_MAX_CTX`(2) above the existing `RHYTHM_MIN_DAYS`(3) floor; `rhythmFor(date,
rhythm?)`. `weekdayTopContext` now just reads it, so there's **one** derivation.
Week planner shows unplanned days' usual contexts muted+italic; `openDayPlanSheet`
names them and seeds the FIRST entry with them — **the tap is the acceptance,
nothing about the rhythm is ever auto-saved**. `weekRhythmBlockHtml()` = the "Your
week" strip in Looks Stats (`data-sa="looks:contexts"`); renders "" when no weekday
clears the floor. ⚠️ There is no `presetContexts` arg — the sheet derives it itself.

④ **HOME ATTENTION HIERARCHY** (unparked from 2026-07-19) — catch-up / laundry /
backup / weather-offer compete for **ONE** slot in that priority order; the rest
fold into a "N more things ›" line (`_homeAttnOpen`, session-only). In trip mode the
dash is the one thing, so all four fold. **The log CTA and the Tomorrow card are
deliberately NOT in the group** — they're the daily loop, not interruptions.

⑤ **CLOSET KEYWORD SEARCH** — it had been gone since the filter unification
(`openSearch()` is still just the funnel). `closetSearchQ` (null = not searching) +
`itemMatchesText(i, q)` (**multi-term AND** over `CLOSET_SEARCH_FIELDS` + tags) +
`closetSearchMatches(q)`. Magnifier `#clKeyword` in `clToolbar`, beside the funnel;
live results into `#clSearchResults`. **Scope is always the whole lens, never the
folder you're standing in** — search means search my closet, the funnel narrows.
Rides the surviving `searchResults` plumbing; `siblingItems()` walks the results and
`closetBack()` closes the search before unwinding the folder stack. The pickers'
`_capPickFilter` was repointed at the same matcher.

⑥ ~~**MENDING**~~ — ⚠️ **REMOVED 2026-07-26 r8.** Offered 12 features to cut she
kept 11 and dropped this one; the original entry's own reasoning ("she will never
run a mending audit") turned out to apply to the feature itself. Gone: `MEND_TAG`,
`isMending`, `setMending`, `mendLineHtml`, `_scopedMending`, `renderClosetMend`,
`closetMend` and the three suggester exclusions. ⚠️ The **`"mend"` tag may still
sit on items in the live DB** — an unread orphan, deliberately not migrated off,
so the data survives if it's ever wanted back. Nothing reads it, so a tagged piece
is suggestible again; a selftest case pins that this is harmless.

⑦ **YEAR IN PIXELS** — `statsView "pixels"` / `renderStatsPixelsPage()` /
`pixelDayLevels(year)` / `statsPixelsYear`. 53×7 `.pxgrid`, each day shaded by
derived formality as a 0.22→1.0 opacity ramp of `var(--accent)`; empty on
`var(--panel)`. Cells are a **fixed 11px** with sideways scroll — `1fr` columns
would be circular against the cells' own width. Pool is the whole year, so it uses
`statsToolbar(..., hideFilter=true)` like Rotation.

⑧ **ON THIS DAY on Home** — `onThisDayHtml(dateStr)` extracted from the calendar day
view and reused; renders "" without a prior year, and sits **below** the folding
group (delight, not attention).

⑨ **TAXONOMY RENAME GUARD** — `TAXONOMY_LOCKED_SUBCATS` =
`keys(WORKOUT_SLOTS) ∪ GEAR_CAND_SUBCATS`; renaming one now needs an explicit
confirm naming the consequence. **Doc correction: `LAUNDRY_LOADS` was never at
risk** — it's keyed on `color_family`, which the taxonomy editor never touches.

**"Rotation drill-in + wears-by-day" (2026-07-24 r1) — SHIPPED.** Two asks.
① **`countByDay(rows, keyFn)`** (beside `ctxArr`) + an app-wide audit enforcing
**a wear is a DAY, never a row** — see the Known gotchas entry, which is the
rule to read before adding any "N wears" number. Fixed: `wearCountInRange` /
`wearCountMapInRange` (the ranged branch counted raw rows, so the stats
Most/Least Worn and CPW lists double-counted inside any date range),
`contextWearCounts` / `contextTopItems` / `contextTopLooks` / `topContextsByWearCount`
/ `contextOptions` / `itemContexts` (**the worst of them — a 5-piece look stamped
"Church" counted as 5 outings**, so the Contexts page and every context-ordered
picker were inflated by pieces-per-outfit), `buildGapStats`, `buildWrappedStats`'
context shares, and `calMostWorn` (printed "N days" over a row count).
`contextFormalityStats` now averages one level per DAY (mean of that day's
pieces) so a 6-piece day can't outvote a 2-piece day. `buildWrappedStats`'
`totalWears` → `pieceDays` (it was item-days, not wears; unused in the UI).
Settings' data card says "N wear records" — a table size, deliberately not a
wear count. ② **Rotation drill-in**: the Stats "Rotation" bar is now tappable
(`.rot-open` → `statsView = "rotation"`, `renderStatsRotationPage`) — same 30d/90d/1y
window chips, plus a **Worn / Not worn** segmented toggle over the two sides of
the same number, each a real item grid (worn = freshest first with in-window
wear-days; not worn = coldest first, never-worn leading). `buildRotationStats`
now also returns `pool` / `wornIds` / `counts` so the page can't drift from the
headline. The page passes `statsToolbar(..., hideFilter=true)` — its denominator
is deliberately the **full Available closet, not `statsPool()`**, so a funnel
that silently changed nothing would lie. Selftest 52/52 (4 new).

**"Laundry Control" round (2026-07-22 r1) — SHIPPED.** Seven asks from one
message (planned by Fable, built by Sonnet same day). ① Fixed `planRewearFlags`
ignoring a real wash: it now skips planned days on/before `items.last_washed`,
not just the `PLAN_LAUNDRY` sentinel. ② Trip dash "N of M pieces in the hamper"
now opens the scoped hamper page (`closetHamper=true`) instead of jumping
straight to the wash sheet. ③ **Wash-load sheet reworked**: selection moved
from load-name Set (`_lnSel`) to an item-id Set (`_lnSelIds`); load chips
(`_lnActiveLoads`) are pre-selectors that reveal a tappable `itemGridView`
thumbnail grid of every hamper item in that load — "I need to see what is in
the load," not just trust the color mapping. A parallel "Also worn, not dirty
yet" section (`_lnWornPool`, honors `_lnPool`) offers worn-tray pieces of the
same color families, **pre-selected ON by default** (user decision — matches
"everything of that color went in"). ④ **Per-item tolerance override**: `tol:
<n>` sentinel tag (same pattern as `layer`/`no-suggest`), `tolTagValue()`/
`setWearToleranceOverride()`, checked first in `wearTolerance()`. Item photo
view: wash date is now tappable → `openFieldEdit(id, "last_washed")` (added
as a real `FIELD_CONFIGS` entry; `saveField` clears `laundry_state` on a
re-date, same as `stampWash`); dirty items get an explicit "Washed on…"
action; a `N/T wears since wash` line shows the count being overridden;
"Wears per wash: N ✎" opens `openTolEdit()` (routes the tag through the field
sheet via a custom `_fieldOnSave`, same trick as the Add form's
`openAddFieldEdit`). ⑤ Dark-mode PWA status bar fixed
(`apple-mobile-web-app-status-bar-style` → `black-translucent`) + manifest
`background_color`/`theme_color` → paper `#f8f4ee` (were still pre-redesign
white). ⑥ App icons regenerated from the inline SVG favicon (oxblood + hanger)
via `rsvg-convert`, `?v=2` cache-bust on both the apple-touch-icon link and
the manifest icon `src`s — **iOS bakes the icon at install time, tell her to
delete + re-add the home-screen app**. ⑦ Trip dash gained a **"✎ Build"** chip
beside "✨ Suggest" (`openBuilder(null, null, {capsuleId, date: PLAN_BUCKET})`
— same plumbing as the plan view's Build button). Selftest 48/48 (3 new: tag
override, tag edge cases, rewear-reset fixture).

## What this is

A personal, single-user wardrobe tracker. **Plain static files served straight
off GitHub Pages** — `index.html` + `css/styles.css` + `js/01…20-*.js`, loaded
by ordered `<script src>` tags. No build step, no framework, no bundler, no JS
libraries, no CDN scripts; what's committed is what runs. It talks to Supabase
using the **REST API and Storage API via plain `fetch`** — do **not** add
supabase-js or any library. If something seems to need a library, ask the user
first. (It was all one 16k-line `index.html` until 2026-07-25 r13; see
**File layout** below.)

## Hard constraints (do not break)

- **No build step, no framework, no bundler, no libraries, no CDN scripts.**
  What's in the repo is what runs. This is the constraint that actually
  matters — it survived the 2026-07-25 file split unchanged.
  ⚠️ **The "keep it one file" rule is GONE (2026-07-25, user decision).** It was
  never an intentional choice — it "just happened" and then got written down
  here as law. `index.html` is now 278 lines of markup pointing at
  `css/styles.css` + `js/01…20-*.js` via plain `<script src>` tags. Don't
  re-consolidate, and don't cite the old rule to refuse a new file.
- **No service worker, still** — offline caching is already handled by the
  snapshot + photo byte cache, and a SW would silently serve stale modules.
- Plain `fetch` only for all Supabase calls.
- Mobile-first; the user mostly uses this on a phone and takes photos with it.
- Only the publishable (anon) key ever appears in client code — it's safe to
  ship because RLS scopes everything to the signed-in user. The **secret key
  must never** be added or committed.

## File layout (since the 2026-07-25 r13 split)

`index.html` = `<head>` + body markup + ordered `<script src>` tags, ~278 lines.
Everything else moved out **untouched** — the split was cut-and-paste at the
existing `/* ==== */` section banners and verified byte-identical, so no logic,
naming or ordering changed. ~14,600 lines of JS across 20 files:

| file | lines | what's in it |
|---|---|---|
| `js/01-config.js` | 100 | `APP_VERSION`, `WHATS_NEW`, keys, `TAXONOMY`, ladders, `store` |
| `js/02-api.js` | 240 | `api`/`rest`, signed URLs, `photoUrl` byte cache, `compressImage` |
| `js/03-state.js` | 447 | globals, `loadData`, derived helpers, kv store, day plans |
| `js/04-laundry.js` | 181 | derived dirty state, tolerances, overrides |
| `js/05-dom.js` | 133 | `$`/`$$`, `esc`, toast, sheets, scroll helpers |
| `js/06-home.js` | 884 | launcher, attention group, Tomorrow card, weather memory |
| `js/07-closet.js` | 121 | lens/folder rendering |
| `js/08-trip-mode.js` | 877 | trip mode, dashboards, recap, rhythm, milestones |
| `js/09-item-detail.js` | 1321 | photo + details views, `FIELD_CONFIGS`, field sheet |
| `js/10-search.js` | 190 | keyword search + filter plumbing |
| `js/11-add-item.js` | 328 | Add form, `_addState` |
| `js/12-looks.js` | 2804 | looks lenses, formulas, **exclusions + the suggester** |
| `js/13-grid-bar.js` | 440 | density picker, select mode, bulk actions |
| `js/14-calendar.js` | 1028 | month/day views, logging pickers |
| `js/15-stats.js` | 2343 | every stats view + report cards + review |
| `js/16-capsules.js` | 1175 | capsules, trips, per-day planner |
| `js/17-builder.js` | 692 | Build-a-Look canvas |
| `js/18-weather.js` | 311 | Open-Meteo, geocoding, `_wxCache` |
| `js/19-wiring.js` | 798 | `switchTab`, `wireEvents`, delegation |
| `js/20-rack.js` | 300 | **the rack** — derivation, nudges, rack screen |
| `js/21-boot.js` | 183 | snapshot, freshness, auth, `init()` |

**Load order is the contract.** Top-level `const`/`let` in classic scripts share
one global lexical scope, which is why the split needed zero code changes — but
it also means a file can only use a binding from a file loaded *earlier* at
**load time**. Function bodies are fine (they run after `init()`), top-level
statements are not. The numeric prefixes exist so the order can't be shuffled by
accident; adding a file means inserting a tag in the right place.

⚠️ `js/12-looks.js` and `js/15-stats.js` are still big (2.8k / 2.3k) because the
cut only followed existing banners. Splitting the suggester out of `looks.js` is
a clean follow-up — it just needs judgment about where the boundary is, which
the banners don't mark.

## Architecture

**Current state: 2026-07-25 r13. Full rework from v25.**
The old v25 is preserved at git tag `v25-full` and `archive/index_v25_full.html`.
Do not use v25 as a reference for current UI code.

**EDITORIAL REDESIGN (2026-07-21 r13) — SHIPPED.** Implemented from a Claude
Design handoff bundle (`claude.ai/design`, a reskin of r10). Presentation only —
zero schema/logic change. ① **Palette**: white/periwinkle → warm paper
(`--bg #f8f4ee`) + deep oxblood (`--accent #6b2737`). New tokens `--gold`/
`--gold-soft`, `--panel`/`--panel2` (thumb wells / segmented headers),
`--surface2` (sheet expands), `--grabber`, `--shadow-sm`/`-md`. **Every
hardcoded `#fff`/`#f4f4f7`/`#faf9f8` is now a token** — that's what makes
theming work, so never reintroduce a literal light color; reach for a token.
② **`--serif`** = the display face for headings (login wordmark, `.bar h1`,
`.fname.big`, `.cap-name`, `.ch-name`, `.sheet-hdr h2`, `.stats-sec-hdr .t`,
placeholder/empty-state `b`). It is **`Georgia, 'Times New Roman', serif` —
system fonts only**. The mock loaded Newsreader from Google Fonts; that was
rejected as an external asset + third-party request per the single-file rule
(user decision 2026-07-21). **Do not add a webfont link.**
③ **`--on-accent`** = text/icon color for anything filled with `var(--accent)`.
Exists because dark mode *lightens* the accent to `#c07f8c`, where cream text is
~2.3:1. Light `#fffdfb`, dark `#1a1512` (~7:1). The mock tried this as a
`@media dark { .btn { color: … } }` override and **lost the cascade** to the
later base rules — a token is the only thing that works here. Anything NOT on
the accent (heart stroke over photos, packed tick on green, `.cal-act` on fixed
greys, the color-swatch check) deliberately keeps literal white.
④ **DARK MODE via `prefers-color-scheme`** — reverses the 2026-07-17 "dark mode
REJECTED" call (user re-approved 2026-07-21; that line in the polish entry below
is superseded). Photos get `filter: brightness(.94)`.
⑤ **Themes**: `currentTheme()`/`applyTheme(t)` write `html[data-theme]` +
`store("wardrobe.theme")`; `applyTheme` runs FIRST in `init()`. Two themes —
`editorial` (default, oxblood) and `sage` (green), each with its own dark block.
Settings → Appearance picker. A third theme = add a `html[data-theme="x"]` block
+ its dark twin + a `.theme-opt` button; nothing else.
⑥ Motion/polish: `:active` press-scale on primary buttons, `:focus-visible`
rings, `.screen.active` fade-in, sheet transition on `cubic-bezier(.32,.72,0,1)`
+ backdrop blur, `.sk*` skeleton loaders (replaced the `.spin` on `retryLoad`),
tabbar icon scale, thicker donut ring.
⑦ `smoothScrollTop()` extracted from the header-tap handler (was inline) and
reused by the tab bar: **re-tapping the ACTIVE tab scrolls to top**. Still
hand-eased — body is the scroll container, `behavior:"smooth"` on it is
unreliable and `scrollingElement.scrollTo` is a no-op (see Known gotchas).
⑧ `haptic()` on primary taps — a **no-op on iOS Safari** (no Vibration API), so
it does nothing on the user's actual device; the `:active` transforms carry the
feedback. Kept for Android/desktop Chrome.

**Batch of user asks (2026-07-21, r5→r7) — SHIPPED.**
① **Sticky Tomorrow pick**: the generated combo persists in `kvData("tmpick")`
(`TM_PICK_KEY`, `{date:{idx:[itemIds]}}`, today+future only) instead of a
volatile in-memory cache — a refresh no longer loses a pick she liked. `↻`
re-rolls (`tomorrowGenPieces(..., force)`); tapping the strip calls
`openTomorrowRevise` (opens the suggester with that combo in front, and
`#sgClose` writes the revised combo back via `_sugg.tmPick`).
② **"home" formality bucket**: `outfitBucket` returns `"home"` when a look has
NO shoes ("no shoes = worn at home"), superseding the derived level; a manual
`formality_override` still wins. It's a bucket, NOT a 9th ladder level —
`BUCKET_RANGES.home = 2` for the places that need a number. Adds a Home folder
to the Formality lens.
③ Looks grid tiles lead with wear count.
④ **"Worn" tray**: `isWornNotDirty`/`wornItems`/`_scopedWorn` = worn since
`last_washed` but under tolerance (the pile on the chair). Closet-root
`👕 Worn · N` row → `closetWorn` full-page view (`renderClosetWorn`, subtitle
`wears/tolerance`), wired into `closetBack`/`siblingItems`/`switchTab` exactly
like `closetHamper`.
⑤ Closet Review gained an `image` field (first in `REVIEW_FIELDS`) so photoless
items surface; `replaceItemPhoto` advances the deal when it fires from review.
⑥ **EDITABLE TAXONOMY** — `TAXONOMY` is no longer a const: `TAXONOMY_DEFAULT`
holds the shipped shape, `let TAXONOMY`/`let CATEGORIES` are rebuilt by
`applyTaxonomyOverride()` from `kvData("taxonomy")` = `{cats, meta}` (called at
the end of `loadData` AND after snapshot hydration — both, or the boot render
uses stale lists). Settings → "Edit categories & types" → `openTaxonomySheet`:
rename/add/remove categories + subcategories with live item counts; renames
bulk-PATCH items via `retagItems(match, patch)` (PostgREST column filter, no id
list); delete only offered at zero usage. `meta` carries a renamed
subcategory's `SUBCAT_FORMALITY`/`WEAR_TOLERANCE` defaults to the new name.
⚠️ Renaming does NOT update `WORKOUT_SLOTS`/`GEAR_CAND_SUBCATS` (still keyed on
the shipped names) — renaming a Workout subcat silently breaks workout mode.
Round C Step 9 adds a warn-on-rename guard. **`LAUNDRY_LOADS` is NOT affected** —
it's keyed on `color_family`, not subcategory (corrected 2026-07-25; the taxonomy
editor never touches color families).

**Partners / rhythm / rotation (2026-07-21 r10) — SHIPPED.** Three derived-only
adds, harvested from external design docs (ChatGPT/Gemini specs the user
brought — everything else in them was already shipped or blocked by the
single-file/no-library constraints; the native-iOS half is permanently out of
reach). ① `itemPartners(itemId, limit, wearRows?)` — top co-wear partners keyed
on the shared **wear DAY**, not shared look membership (what left the closet
together > what got saved); `PARTNER_MIN_DAYS`=2 so one memorable outfit isn't a
habit. Rendered by `partnersRowHtml` as a "Usually worn with" thumb strip in the
item-details top card; `[data-partner]` tiles `openItem` (already in closet, so
no `_itemReturn` needed). ② `wearRhythm(itemId, wearRows?)` → `{avg, longest,
wearDays}` over DISTINCT wear days, null under 3 (two wears = one gap = noise);
shown as a `det-sub` under "Worn N days" via `humanGap`. ③ `buildRotationStats
(days, pool?, wearRows?, today?)` + `rotationBlockHtml`/`wireRotationChips` —
share of the Available closet worn in a trailing window, `ROTATION_WINDOWS`
30/90/365 chips (session-only `statsRotationDays`), first block in Clothing
Stats. ⚠️ Its denominator is the **full Available closet, NOT `statsPool()`** —
deliberate, so an active stats filter can't flatter the number. All four
functions take injectable args and are covered in selftest (44/44).

**Round B "Formulas" (2026-07-21, r3→r4) — FIRST SLICE SHIPPED.** Discover the
outfit SHAPES she rebuilds, then re-cook them. All derived, nothing stored.
`formulaKeyFor(items)` = canonical `"Slot:Subcategory + …"` signature (sorted;
null unless there's a dress OR a top+bottom; null-slot pieces — bras/swim —
never count); `formulaLabel(key)` renders it in dressing order (`FORMULA_SLOT_ORDER`);
`buildFormulas(pool)` groups WORN looks by key, keeping shapes with
`FORMULA_MIN_LOOKS`=2+ distinct looks and `FORMULA_MIN_WEARS`=6+ wears (a single
much-worn look is just that look). Surfaced as the **"Formulas" Looks lens**
(first tab) through the existing folder machinery — `folderRowsHtml`/
`folderOutfits`/`folderLabel` all have a Formulas branch, folder key = the raw
signature. Payoff: a formula's folder page has **"✨ New outfit from this
formula"** → `openSuggestSheet(null,null,null,shapeKey)`; `suggestOutfits`'
10th arg `shapeKey` hard-filters each slot's pool to `formulaShapeMap(key)`
(slots the shape doesn't name go EMPTY so the silhouette holds; a two-top shape
may fill the layer slot from its own tops), and `swapSuggestionPiece` stays
inside the shape. ⚠️ Still TODO for Round B: naming/saving formulas to `kv` and builder
slot-seeding. **The formula chip in the suggester shipped 2026-07-26 r9** —
`topFormulas()` (memoised on outfit+wear counts) + `suggestShapeChipsHtml()`;
tapping the active chip CLEARS it, since a chip that can only be turned on is a
trap. Hidden in workout and "Vary this" modes, which already answer "what
shape?" more strongly.

**Round A "Tomorrow" (2026-07-20, r1→r2) is FULLY SHIPPED** (decisions in
ROADMAP.md's Round A section — do not re-litigate). Three parts:
① **Activity/gear rework** (r1, no migration): `GEAR_WORKOUT_TAG`/`GEAR_RAIN_TAG`
sentinel tags (`isWorkoutGear`/`isRainGear`/`setWorkoutGear`/`setRainGear`,
item-detail SUGGESTIONS toggles). `suggestOutfits` gained an 8th arg
`activity` — `"workout"` filters the pool to `isWorkoutGear` and bypasses
`formalityOk` (the tag IS cohesion); normal mode now explicitly drops the whole
Workout category and gates `gear:rain` behind `wmoIsWet(wx.code)` (boosted +2
when wet). `WORKOUT_SLOTS` maps Workout subcats to real slots (bras/swim →
null = never suggested). Sheet: 🏋️ Workout chip (`_sugg.activity`, mutually
exclusive with formality/context asks, clears locks on flip); empty-state
`suggestGearDoorHtml` → `openGearTagSheet` (one-pass tagging + a "Gear-only"
toggle that sets `formality [1]` via `setGearOnlyFormality`/`isGearOnly` so the
existing pure-Utility isolation keeps gear off normal days). **Level 1 renamed
"Function"→"Utility"** (labels only; stored bucket key `"function"` unchanged).
② **kv store** (r2): new `kv` table (`migration/kv_store.sql`, CONFIRMED RUN
2026-07-20) → `kvData` Map loaded in `loadData`, `kvSet(key,value)` optimistic
upsert (POST `Prefer: resolution=merge-duplicates`), included in the snapshot.
③ **Day plans + Tomorrow** (r2): `dayPlan(date)` reads `kvData("dayplan")` =
`{date: [{contexts:[], outfit:id|null}]}` — ordered ENTRIES (one outfit across
contexts = one multi-context entry; an outfit change = 2 entries; outfit null =
context set, look TBD). `saveDayPlan`+`pruneDayPlan` (past 7d/future 30d window,
pure for selftest). `entrySuggestLevel` (dressier context wins) / `entryActivity`
(Workout context → activity mode) drive suggestions. `openDayPlanSheet(date)` =
the editor (context multi-select + Pick/✨Suggest/✎Build per entry, reuses the
suggester/builder via a `planCtx={kv:true,date,entryIdx,level,activity}` — see
`data-swear`/`finishBuilder`/`builderCancel` kv branches). `wearPlannedEntry`
logs an entry stamping ALL its contexts. Home (suppressed in trip mode):
`tomorrowCardHtml` (all-day, planned looks or a cached `tomorrowGenPieces`
generated combo + 📌 Keep), `todayPlanRowsHtml` (one-tap Wear-it), `planAheadRowHtml`
→ `openWeekPlanSheet` (7-day overview). Calendar day view (today/future, non-trip):
planned-look Wear-it rows + a 📅 Plan button. `loadHomeWeather` now fetches
today+tomorrow in one call (`_homeWx.wx2`) and logs the day's weather to
`kvData("wxlog")` (≤1 write/day, 400d window) as groundwork for style-twins.

**LAUNDRY v1 + Trips (2026-07-15, r1→r4) is FULLY SHIPPED** (decisions in
ROADMAP.md's laundry section — do not re-litigate). `migration/items_laundry.sql`
(adds `items.last_washed` + `items.laundry_state`) **CONFIRMED RUN on the live
DB 2026-07-18** (REST column probe) — laundry is fully live. The
`LAUNDRY_READY()` gate (checks the column exists on loaded rows) stays in the
code as harmless belt-and-suspenders; read paths never needed a gate (absent
column = null = clean). Core model (LAUNDRY section, after the derived helpers): dirty
is **derived, never stored** — distinct wear-days since `last_washed` ≥
`WEAR_TOLERANCE[subcategory]` (category fallback; Infinity = shoes/outerwear
never dirty); **null `last_washed` = clean** (tracking is opt-in by behavior).
`laundryState()` = one pass over wears → Map(item_id→Set(dates)); build ONCE per
bulk scan and pass into `isDirty`/`dirtySince`/`suggestibleClean` (items×wears
perf). One-time overrides in `items.laundry_state`: `'hamper'` (dirty until next
wash stamp) and `'extra:<n>'` ("one more wear" — stores the wear-day count at
set time, self-expires when a newer wear lands; NO wear-path bookkeeping).
`stampWash(ids, date)` stamps ONLY dirty items (an under-tolerance jean wasn't
in the physical hamper). Surfaces: suggester "🧺 Clean only" chip (Season row,
default on; pool filter in `suggestOutfits` cleanOnly param + swap/add-layer;
locked/seed exempt by construction; items dirty `LAUNDRY_RESUGGEST_DAYS`=7+
re-enter badged so the pool can't starve); `openLaundrySheet` (closet-root
"🧺 Hamper · N/empty" row, `[data-laundry]` — ALWAYS visible once migrated, r5)
with load chips from her real sorting (`LAUNDRY_LOADS`: Whites/Cools/Warms +
All together, keyed on color_family) + back-datable date — when NO item has a
`last_washed` yet the sheet instead offers the one-time bootstrap "Mark whole
closet washed" (`#lnStart`, stamps Available finite-tolerance items; fixes the
day-one chicken-and-egg where an empty hamper hid the only entry point); 🧺 tile badge via `itemGridView` (informational — pickers
never filter); item photo view `laundryLineHtml` (One more wear / Washed / To
hamper); wear-again "🧺 in the wash" tag; Home `.laun-row` **previous-day
confirm strip** (most recent logged day ≤3 back; thumbs pre-marked with derived
🧺/↩︎, tap = `flipLaundry` override, ✓ = `LAUNDRY_CONFIRM_KEY` and writes
nothing) which becomes the **"Done laundry lately?" prompt** when the hamper is
stale (`LAUNDRY_STALE_DAYS`=7; "Not yet" snoozes `LAUNDRY_SNOOZE_DAYS`=3 via
`LAUNDRY_SNOOZE_KEY`) — her deliberate, laundry-only exception to "no nudges".
Trips: `planRewearFlags` rewear budget on plan day cards (counts planned
wear-days per piece since trip start / last laundry day, flags past-tolerance);
`PLAN_LAUNDRY = "__laundry__"` sentinel INSIDE a day's plan array (invisible to
look rendering — `planActiveLooks` drops unknown ids) toggled by the day card's
🧺 chip; capsule detail "wash before you pack" hamper count. **The bucket chip
icon changed 🧺→🪣 so 🧺 means laundry app-wide.**

**"Bucket + Visibility polish" (2026-07-11 r1) is FULLY SHIPPED:** ① photoless
items render a muted tee-glyph placeholder everywhere (`PHOTO_PLACEHOLDER`
data-URI SVG applied by `loadPhotoNode` when `data-photo` is empty or the URL
fails; `outfitPieces`/`layoutCanvasHtml`/`lookHeroBlock` no longer drop
photoless pieces; the builder accepts photoless items — `builderPool`'s
image_path filter removed). ② Calendar day-view SOLO-item collage cells are
tappable (`calOutfitCollageHtml(ids, outfit, tappable)` → `data-cal-item` →
`openItemFrom`); look cards still open the look first (user call). ③ Look-
details piece rows carry a `.det-piece-thumb` thumbnail that opens the item
(`data-piece-open`, checked BEFORE `data-occ-item` in the looks delegation);
the rest of the row still edits formality. ④ Empty status filter now means
**Available only** (`itemMatchesFilter` default — Storage no longer counts in
Style Stats unless explicitly picked in the funnel). ⑤ Archived looks purged
from Most Worn Looks, stats main-page counts, context Top Looks, the Home
Looks-tile count, `outfitsForItem` (item's looks list), and trip-plan day
cards (`planActiveLooks`) — archived looks appear ONLY in the Archive lens and
on the calendar. ⑥ **Trip/capsule OUTFIT BUCKET** — see CAPSULES entry.
r2 routed `thumbHtml`/review-card/det-thumb empties through the tee placeholder
(and `.empty` CSS tints via `background-color`, never the `background:`
shorthand — it kills the `center/contain` the placeholder needs). r3 QoL:
`contextOptions()` sorts by global wear frequency (all context pickers);
`.cltoolbar` + `.cal-day-header` are sticky under the app header (`--hdr-h`
var); tapping the header scrolls to top (NOTE: **body is the scroll
container**, not window — `window.scrollTo` is a no-op app-wide; the header
tap animates `document.body.scrollTop` with a setTimeout loop because rAF
stalls in hidden documents).
**"Feels Professional" polish round (2026-07-17 r1) is FULLY SHIPPED** (decisions
in ROADMAP.md's polish section; dark mode was REJECTED here but that is
SUPERSEDED — it shipped in the 2026-07-21 r13 redesign above). All
perceived-quality, no features/schema: ① **PWA install** — `manifest.json` +
`icon-180/512.png` (repo-root files, the approved one-file exceptions),
apple-touch-icon + standalone metas, SVG data-URI favicon. ② **Sheet motion** —
`showSheet(id)`/`hideSheet(id)` helpers (slide-up/down + backdrop fade; wrapper
`hidden` stays the source of truth, `hideSheet` delays `hidden=true` ~240ms) —
**never toggle a sheet wrapper's `.hidden` directly**; drag-dismiss hands its
offset to `hideSheet` for continuity. ③ **Freshness** — `visibilitychange`
handler: >5 min hidden (or date rollover) + `uiCanRefetch()` (no sheet open, no
builder/add/review/pick/select) → silent `loadData()` +
`rerenderRootAfterRefresh()` (roots only: home / closet-sans-detail /
looks-sans-look / calendar / stats-sans-review). ④ **Snapshot instant-boot** —
`saveDataSnapshot()` after every `loadData` into Cache Storage
(`DATA_CACHE`/`SNAPSHOT_KEY`, 7d max age, user-id-checked); `bootApp` hydrates
from it before any network and fails silently if fresh fetch dies;
`handleSignedOut` clears it. ⑤ **Update toast** — `checkForNewVersion()`
Range-fetches own index.html, compares `<meta name="app-version">` (MUST stay
in lockstep with `APP_VERSION` — deploy skill bumps both) → "Update available"
toast; reload via `location.replace(+query)` because plain reload can re-serve
the stale cached copy. ⑥ **Scroll** — `scrollToTop()`/`getScrollTop()`/
`restoreScroll(y)` (body is the scroll container; the 9 dead `window.scrollTo`
calls were converted); `makeScreenReturn` thunks restore origin scroll;
`_detailEntryScroll`/`_lookEntryScroll` restore grid/list position on plain
back (captured only when `detailId`/`lookId` was null, so sibling prev/next
keeps the original). ⑦ **Photo fade-in** — `loadPhotoNode` decodes off-DOM then
fades (`.ph-fade`/`.ph-in`); `_shownPhotos` Set skips the fade on re-renders
(no added flicker). ⑧ Papercuts: tabular-nums body-wide, desktop ≥700px frame
(app + all fixed chrome capped at 640px), login email prefill
(`wardrobe.lastEmail`), `prefers-reduced-motion` guard.

**Usability batch 2026-07-19 r5+r6 (from the "how would you improve
usability/professionalism now" review; user picked 3/4/5/6+keyboard+finder,
PARKED Home attention-slot hierarchy + in-app confirm sheets — see
Back-burner):** r5 ① `outfitIncomplete(o)` (no dress/swimsuit AND no
top+bottom; shoes NEVER required — "no shoes = worn at home" is her rule;
workout subcats count as top/bottom) + health-check "Incomplete looks" row →
`openIncompleteLooksSheet` review list with per-look deconstruct.
② zero-state door: level-starved capsule suggestions render
`suggestLevelDoorHtml` — up to 8 closet pieces covering the level with
one-tap add-to-capsule then re-roll. r6 ③ `WHATS_NEW` const (deploy skill
refreshes it with APP_VERSION) + `maybeShowWhatsNew()` in bootApp (first run
of a new version toasts the changelog; `wardrobe.seenVersion`).
④ `api()` network-failure copy is honest about data ("You're offline — that
didn't save"). ⑤ `.cb-x`/`.laun-ok` get ::after hit-area expansion (~44px).
⑥ review-card price input `inputmode=decimal`. Selftest 31/31.

**Fix pack 2026-07-19 r4 (user-reported, same day):** ① one-piece looks are
outlawed — `createLookFromItems` guards <2 (saveBuilder already did); existing
strays surface in the data health check with a bulk fix that DECONSTRUCTS them
(wears survive as solo wears). ② `deconstructLook(id)` + a "Deconstruct look"
row on the look details page ("not really a look" — keeps every wear, drops
the grouping; shares `deconstructLookCore` with deleteLook/health check).
③ tops-vs-layers: `layerPieceOf` picks the LAST flagged top (the ow-slot one)
so labels don't swap when the base is also layer-flagged; combo generation
skips stacking two layerable tops. ④ **suggester `targetLevel` is now a HARD
filter** in the engine + swap + add-layer — a "Dressed Up" ask returns
fewer/zero results (starvation note explains) instead of silently falling
back to casual (the capsule-mode bug she hit). Selftest 31/31.

**"Loop Resilience + Payoff" round (2026-07-18→19, through 2026-07-19 r3) is
FULLY SHIPPED** (spec in ROADMAP.md's section — decisions locked from the
2026-07-18 product review). Pieces: **suggester** — ⃠ per-piece session bans
(`_sugg.banned`, `banSuggestionPiece`; `_suggPool()` now ALWAYS returns the
effective pool minus bans), pool-starvation note (`suggestStarvationNote`),
per-sheet-open variety salt (`_saltFor`, `SUGGEST_SALT`=0.35, added in
`scoreCombo`); **Home** — catch-up strip (`catchupHtml`/`missedDays`/
`skipDay`, `SKIP_DAYS_KEY` store set pruned 30d; "Log →" jumps to that day's
wear-again chooser) + backup-staleness row (30d, taps `downloadBackup` which
re-renders the CURRENT screen); **Stats** — "Closet vs Life" gap page
(`buildGapStats` pure: wear share vs formality-eligible closet share per
context, 5+ wears noise floor; `statsView "gap"`) and "Year in Review"
(`buildWrappedStats(year)` pure + `renderStatsWrapped` card stack, year
chips, gift-free all-time CPW champions, dead weight, `longestStreak`;
`statsView "wrapped"`); **trips** — offer dismissal now once per TRIP.
**Data safety (r7, same series):** Settings Data card (`downloadBackup` JSON
export + `runDataHealthCheck` with one-tap fixes for dangling rows),
`migration/backup_photos.py` (full offline backup) + `restore_backup.py`
(disaster recovery, refuses non-empty tables without --force), both stdlib-
only; `migration/backup/` + `.env` gitignored.

**"Trip Mode + Tap Tax" round (2026-07-18, r1→r6) is FULLY SHIPPED** (spec +
locked decisions in ROADMAP.md's trip-mode section — do not re-litigate; the
"no nudges" rule is SOFT as of this round). No schema changes. Key pieces:
**TRIP MODE** — `tripModeId` (`TRIP_MODE_KEY` in `store`, restored in `init`,
validated at end of `loadData`); phases DERIVED from capsule dates via
`tripPhase(c)` (pack ≤`PACK_LEAD_DAYS`=3 before start · trip · unpack
≤`UNPACK_GRACE_DAYS`=3 after end; undated capsule = "capsule mode", no
phases). `enterTripMode`/`exitTripMode` (also set/clear `activeCapsuleId`;
the shared `scopeBannerHtml()` banner's ✕ EXITS THE MODE — one mental model).
Home: `tripDashHtml` takeover (day counter, today's planned looks +
`planWoreIt` one-tap, `_planWx` weather via `loadTripHomeWx`, suitcase hamper
row, remaining-days strip, ✨/plan/packing chips) + `tripOfferHtml` auto-offer
banner (per-day dismissable, `TRIP_OFFER_KEY`); wiring in `wireTripDash`.
Scoping: wear-again chooser + `openSuggestSheet` default pool + calendar
pickers (`_pickTripScope`, "✈️ Suitcase only" chip escape) + `builderPool`.
`tripWearContext(date)` auto-stamps `TRIP_CONTEXT`="Travel" on EVERY
wear-create POST during trip dates (post-log sheet shows it pre-selected);
`tripPlanSync(outfitId, date)` records logged looks into that day's plan;
`tripMissingPieces` offers add-to-capsule (post-log row + toast chip); Add
Item pre-ticks the trip capsule; laundry sheet takes a pool (`_lnPool`) —
trip laundry washes only the suitcase. **UNPACK/RECAP** — `tripRecapData(c)`
(pure derivation: worn vs dead-weight, most-worn, repeated look — retroactive
for any past dated trip) + `openTripRecap(cid, {unpack})` (worn→hamper via
`flipLaundry` overrides, End trip mode); dashboard unpack-phase row +
capsule-detail "Trip recap" button on past trips. **FILTER+SORT (A3/A2)** —
sort lives IN `openFilterSheet` (`sortable: true` on closet/calendar/capsule
pickers; title "Filter & sort"); the 3 standalone sort popovers are GONE.
⚠️ Sort keys renamed: `"category"` = the composite (was misleadingly keyed
"color"), `"colorfam"` = NEW true color sort; `gridSortKey()` maps legacy
stored `"color"`→`"category"` — never write key "color" again. One-tap clear:
`funnelBtnHtml(id, state, onClear)` renders an adjacent ✕ when active
(`_funnelClearFns` registry + one capture-phase listener in `wireEvents`;
closet/looks/stats toolbars registered manually). **PICKER TOGGLE (B)** —
`builder.pickAll` ("all" = the bottom RAIL over the whole `builderPool()`
with category jump chips, zero folder depth; "browse" = classic drill),
toggled via `setBuilderPickAll` (🗂/▦ buttons in rail hdr + picker hdr),
persisted `wardrobe.pickmode.builder`, capsule/trip scope defaults to all.
**A1/E4** — `openPostLogSheet`'s `close()` re-renders the calendar day/Home
beneath it (the "set context twice" bug); `openLogWear` + `logWearToday`
refresh photo-view stat strip / day view too. **A4** — ✨ "Suggest new" tile
at the front of the wear-again strip, TODAY only (past-date suggestions
rejected by user).

**Report Cards (2026-07-10) shipped in `2026-07-10 r2`→`r3`** — r2 shipped Brand
& Retailer report cards; r3 (same day) generalized the engine to 7 dimensions
(+ subcategory, price bracket, purchase year, color, acquisition) and added the
Workhorses/Declutter smart lists, the capsule-picker suggested strip, and the
item-detail workhorse badge. See the STYLE STATS entry below for
`buildItemPerf`/`buildReportStats`/`renderStatsReportPage`/
`renderStatsReportDetailPage`.

**"Weather + Loop Polish" v3 (2026-07-09) is FULLY SHIPPED in `2026-07-09 r1`**
(decisions locked in ROADMAP.md's v3 section): the W7 "Today" tile was REMOVED
(user call) and weather moved INTO the suggester (`scoreCombo` wx override,
`WX_HOT_F`/`WX_COLD_F` constants, sheet weather chip, trip-plan `_planWx`) ·
`wears.formality_for` is now DERIVED at log time (`deriveWearFormality`), never
asked — the post-log sheet is context-only · weekday-context suggestion chip
(`weekdayTopContext`) · look-log dup guard + Undo parity · Home "✓ Logged today"
row · Wear-again strip reserves 2 liked-but-neglected slots · suggester
lock-a-piece (🔒) + add/remove Layer · calendar "On this day" row · both nav-audit
items closed (`openItemFrom(id, browseCtx)` snapshot/restore). No schema changes.

**"Hearts + Filters Everywhere" v2 is FULLY SHIPPED, all 8 waves (W0–W7), through
`2026-07-06 r7`.** The 2026-06 "Unified Experience" build (W0–W5) and filter
unification Phases 2+3 are also fully shipped. **▶ NEXT UP:** nothing scheduled —
the agreed next round is the palette page + shopping gap / replacement watch (see
ROADMAP.md's Round C deferred list); ask the user before starting new work.

Top-of-`<script>` config, then logically grouped sections:

- **CONFIG** — `SUPABASE_URL`, `SUPABASE_KEY`, `BUCKET`, `APP_VERSION`, `TAXONOMY`,
  `COLOR_FAMILIES`, `OCCASION_LADDER` (8 levels), `FORMALITY_BUCKETS`, `BUCKET_RANGES`,
  `SUBCAT_FORMALITY`, `CAT_FORMALITY`, `CONTEXTS`, image/encode constants.
- **SESSION** — `store` safe wrapper (probes localStorage once, falls back to in-memory
  Map). Always use `store`/`saveSession`/`loadSession`, never raw localStorage.
- **FETCH HELPERS** — `authRequest`, `api` (authed fetch + transparent 401 retry),
  `rest` (PostgREST wrapper), `uploadPhoto`/`deletePhoto`/`signedUrl`/`signedUrlBatch`,
  `prewarmUrlCache()` (batch-signs all item photos after loadData, fire-and-forget).
- **IMAGE COMPRESSION** — `compressImage(file)`: canvas downscale to 1200px, WebP
  q0.82, JPEG fallback if browser can't encode WebP.
- **STATE + DERIVED** — `items`, `wears`, `outfits`, `outfit_items`, `capsules`,
  `capsule_items`, `exclusions` loaded via `loadData()`. Helpers: `wearCount`,
  `lastWorn`, `costPerWear`, `daysSince`, `money`, `esc`.
- **HOME LAUNCHER** — `renderHome()`: Stylebook calm tile grid (5 tiles). Below the
  grid: the `log-cta` ("Log today's wear" → `openWearAgainChooser`) when nothing is
  logged today, else a **"✓ Logged today · <contexts|n items>" row** (`.logged-row`)
  that taps into today's calendar day view (v3 — habit feedback + evening-outfit
  shortcut). The v2 "Today" tile was REMOVED in v3; what remains of it is
  `getHomeLocation()` (keyless `navigator.geolocation`, cached in `store` under
  `HOME_LOC_KEY`/`HOME_LOC_TTL`) + `loadHomeWeather()` (`_homeWx`, one fetch/day),
  which now feed the suggestion sheet's weather chip instead.
- **CLOSET** — `renderCloset()`/`openItem()`/`openItemDetails()`. Status-lens
  switcher. `siblingItems()` derives the current list for prev/next item nav.
- **ITEM DETAIL** — two-view: `openItem()` (photo + nav bar) → `openItemDetails()`
  (edit view). Field sheet (`#fieldSheet`) driven by `FIELD_CONFIGS`/`openFieldEdit()`.
  `_fieldEditItem`/`_fieldOnSave` dual-mode (DB save vs. callback). Photo view shows
  a **"★ Workhorse" badge line** (`workhorseBadgeHtml`, 2026-07-10) under the stat
  strip when the item has 5+ wears and idx ≥ 1.5 vs subcategory peers
  (`buildItemPerf(items)` — full-closet baseline, not the stats-filtered pool).
- **ADD ITEM** — `renderAdd()`/`_renderAddBody()`/`saveNewItem()`. State in `_addState`.
- **SEARCH** — `openSearch()`/`renderSearch()`/`runSearch()`. Keyword + 6 filter rows.
- **LOOKS** — `renderLooks()` + 3-view look detail keyed by `lookView`:
  `openLook()` (clean canvas + bottom action toolbar: Details/Formality/Duplicate/
  Calendar/Archive/Delete, plus a **heart toggle** in the toolbar's right slot) →
  `openLookDetails()` (metadata page: wear/pieces/cost, formality, season, per-piece
  formality, notes) → `openLookWears()` ("When You Wore It" — every wear date; tap a
  day → `openContextSheet` to set that wear's context). `looksBack()` walks
  wears→details→canvas, then `leaveLook()` — the single canvas-level exit (also used
  by archive + delete): consumes `_lookReturn` if the look was opened from another
  screen (see `openLookFrom` in Known gotchas), else `renderLooks()` (list, stays
  filtered if scoped). `duplicateLook()`/`archiveLook()`.
  Lens switcher: **Formality · Season · Context · Capsule · Liked · Recent · All ·
  Archived** (8 tabs — `.lens` row scrolls horizontally, doesn't shrink labels).
  `activeOutfits()`/`archivedOutfits()` derive from `effectiveArchived(o)` (`o.archived`
  OR any piece is status Archive — no cascade PATCH, no column; auto- vs
  manually-archived shows a one-line note on canvas/details, the Archive/Unarchive
  button only ever reads/writes `o.archived`). `layoutCanvasHtml(o, wrapCls)` /
  `lookHeroBlock(o)` render arrangements.
  **Hearts**: `outfits.rating === 1` = liked (`toggleLikeLook(id)`, PATCH 1↔null, no
  other values used). Primary hearting moment is `openPostLogSheet` (shown whenever
  logged wears share an `outfit_id`) and a `.cal-heart-btn` on calendar day-view look
  cards — not just browsing. `.otile-heart` badges liked-look tiles everywhere
  (`outfitGridHtml`, all look pickers). `outfitContextMap()` (one pass over wears →
  Map(outfit_id→Set(contexts)); `outfitContexts(o)` is the single-look convenience)
  backs the Context lens folders — use the map for whole-list scans, never a
  per-outfit scan (perf: outfits × wears).
- **BUILD-A-LOOK** — Stylebook canvas on `#tab-builder`. `openBuilder(outfitId?, seedItemId?)`.
  Pointer drag+resize; `builder` global state. `saveBuilder()` writes `outfits.layout` JSONB.
  "+ Clothing" picker: category/subfolder browsing is full-screen (`renderBuilderPicker`);
  once at an item list (`builderInItemMode` → subfolder or flat category) it switches to a
  bottom item rail over the visible canvas (`renderBuilderRail`, `.bld-rail`); rail taps
  `addPieceToBuilder(id, true)` keep it open. Migration: `migration/outfit_layout.sql`.
  **Wear-sync after piece edits** (2026-07-08): `saveBuilder` checks `wearSyncCandidate(id)`
  (most recent wear date ≤14d whose outfit-linked wear rows ≠ current piece set).
  Same-day mismatch → `syncWearsToLook(id, date)` runs silently (toast notes it);
  1–14 days old → offer chip on the toast ("Update that wear →"). Sync deletes that
  day's wear rows for swapped-out pieces and inserts rows for swapped-in ones,
  copying context/formality from a surviving group row (tags follow the swap).
  State-based, not delta-based — re-saving an unchanged look still offers the fix,
  which is also the repair path for wears left stale before this shipped. Older
  wears are history and never touched. **Dup-merge follow-up**: when an EDITED
  look merges into an existing duplicate, the same policy applies to the edited
  look's latest wear — same-day is re-pointed to the survivor automatically
  (`repointWears` + `syncWearsToLook`); ≤14d is offered inside `openMergeFollowUp`,
  a post-merge sheet that also asks the old look's fate (Keep / Archive / Delete —
  delete inlined, not `deleteLook`, to skip its `leaveLook()` navigation; wears FK
  is SET NULL so history survives). Sheet skipped in trip-plan (`planCtx`) saves.
- **OUTFIT SUGGESTIONS** — `suggestOutfits(targetLevel?, seedItemId?, capsulePool?,
  season?, wx?, lockedIds?)`. Slot-filling engine (Top/Dress + Bottom + Shoes +
  optional Outerwear). **By design there is NO unworn/last-worn weighting** in
  SCORING — ⚠️ but since 2026-07-26 r7 the default POOL is the rack, which is
  built partly from recency, so recency now enters through pool construction.
  That is deliberate and approved; see the RACK entry. Slots
  random-sample and scoring is only "match" signals: formality cohesion (hard filter
  via `formalityOk`), exclusions (hard), loud-color penalty, pattern-clash penalty
  (`isPatterned`), and a capped SOFT boost for color-pair + item-pair affinity learned
  from saved outfits (`buildSuggestIndexes` → `_colorPairFreq`/`_itemPairFreq`;
  **liked looks (`o.rating===1`) count double**). Returns 8 via softmax (temp 0.8)
  with diversity-aware selection so arrowing/swiping swaps pieces.
  **Weather (v3):** when `wx` (`{maxT,minT,code}`) is present it OVERRIDES the
  season layer heuristic in `scoreCombo` — hot (`maxT ≥ WX_HOT_F`, 78°F) penalizes
  layers/heavy tops, cold (`≤ WX_COLD_F`, 50°F) boosts layers, precipitation
  (`wmoIsWet`) boosts Boots / penalizes Sandals. Sheet weather = `loadHomeWeather()`
  (`_homeWx`, one fetch/day, geolocation) or the plan day's `_planWx`; shown as a
  toggleable chip in the Season row (`_sugg.useWx`, `_suggWx()`).
  **Lock-a-piece (v3):** 🔒 chip per piece (`_sugg.locked` Set) — locked pieces pin
  their slot and survive every regenerate; locked+seed ids are exempt from the
  per-item diversity cap. **"+ Layer" / "× Layer"** (`comboLayerPiece`/
  `addSuggestionLayer`) adds/removes a compatible layer on the current combo.
  Pieces are tappable (open item); swipe slides (`sg-anim-*`). A row of
  **Context chips** (`topContextsByWearCount`) sits above the formality chips —
  picking one sets `_sugg.targetLevel` from `contextFormalityLevel(context)` (mode of
  that context's `formality_for` wears, min 3 to trust; else `CONTEXT_FORMALITY_SEED`).
  Entry points: item detail shuffle button, Looks tab +, capsule "Suggest an outfit".
  Sheet state in `_sugg` (incl. `activeContext`).
  **"Wear this today" logs AS AN OUTFIT** (`wearSuggestedCombo`, r2): create-or-merge
  a real look via `saveComboAsOutfit` (item-set dedup + layout), wears get its
  `outfit_id` + derived formality, soft dup guard per day, post-log sheet shows the
  heart. Undo removes the wear rows only (the created look stays; dedup reabsorbs it).
- **EXCLUSIONS** — `exclusions` table stores item pairs that shouldn't appear together.
  `buildExcludeSet()` → `_excludeSet` (Set of "a:b" canonical pairs). `isExcluded(a,b)`,
  `addExclusion(a,b,reason)`. Loaded in `loadData()`.
- **CAPSULES** — `renderCapsules()` dispatches by `capsuleView` (list/detail/form/pick/**plan**).
  Two modes: Capsule + Trip (packing checklist, weather strip). The add-items picker
  (`renderCapsulePicker`) opens with a **"★ Suggested" workhorse strip**
  (`capsulePickSuggestHtml`, 2026-07-10): up to 12 in-season (trip start-date season
  when set, else current), Available, idx ≥ 1.2, 3+-wear items; hidden while
  searching or category-drilled; tiles are `data-pick` so `togglePick` (now `$$` —
  an item can appear in strip AND grid) selects in both places. "Plan outfits from this" sets
  `activeCapsuleId` (scopes Closet + Looks). "Suggest an outfit" opens suggestion sheet scoped to
  capsule members.
  **Trip by-day planner** (`capsuleView="plan"`, `renderCapsulePlan()`): one card per trip date
  with that day's weather (`_planWx` from `buildTripWeather`). Per day: Assign a saved Look
  (`openPlanLookPicker`, scoped to `outfitFullyInCapsule`), Suggest (`openSuggestSheet(null,cid,
  {capsuleId,date})` — season = trip date, saves combo via `saveComboAsOutfit`), or Build
  (`openBuilder(null,null,{capsuleId,date})` — picker scoped to capsule via `builderPool()`).
  Saving in any of those calls `addPlanLook`. Plans live in `capsules.plan` JSONB (intentions,
  NOT wears — `migration/capsule_plan.sql`); "Wore it" (`planWoreIt`) converts a day to a real
  wear. `finishBuilder(id,msg)` routes a builder save back to the plan when `builder.planCtx` set.
  **Outfit bucket (2026-07-11 r1):** `PLAN_BUCKET = "bucket"` is a RESERVED key in the same
  `capsules.plan` JSONB — a pool of planned looks not tied to a day. The plan view (now reachable
  for ALL capsules: dated trips get "Plan outfits by day", undated capsules get a "Planned
  outfits" button, same `data-cap-byday`/`openTripPlan`) renders the bucket card first with its
  own ＋ Look / ✨ Suggest / ✎ Build actions — all the existing plan plumbing works because they
  just pass `date = PLAN_BUCKET` (`planDayLabel` special-cases the label; `planCtxSeasonDate`
  anchors season to trip start / today since the bucket has no date; suggest button reads "Add
  to bucket"). Day cards get a **"🪣 From bucket"** chip (was 🧺 until 2026-07-15 — 🧺 now means laundry) (`openBucketAssignSheet`) — assigning
  KEEPS the look in the bucket (one outfit can cover several days); bucket tiles show
  "✓ planned" once used somewhere. `planActiveLooks(c, date)` is the render-side reader — it
  drops deleted AND archived looks (raw ids stay in the JSONB; unarchiving restores them).
- **CALENDAR** — `renderCalendar()` dispatches month/day views. Day view: outfit groups,
  swipe-left actions (Copy/Move/Delete). "+ Clothing" / "+ Look" log pickers, both with
  a filter funnel (`pickerFilter`/`PICKER_FILTER_DIMS` for +Clothing, `calLookFilter`/
  `LOOKS_FILTER_DIMS` for +Look). Footer also has a **"↻ Wear again"** button
  (`openWearAgainChooser`, see DAILY LOOP). Above the footer, an **"On this day"** row
  (v3, `.otd-row`) shows the most recent prior YEAR with wears on the same date
  (mini collage + contexts); tap navigates the day view to that date.
- **STYLE STATS** — `renderStats()` dispatches main/field/grid/outfits/contexts/
  context-detail/gap/wrapped/**rotation**/report/report-detail/review views.
  **Report Cards** (2026-07-10):
  main-page "Report Cards" section → `renderStatsReportPage()` over
  the 7 dimensions in `REPORT_DIMS` (brand, retailer, subcategory, price bracket,
  purchase year, color_family, acquisition). Engine: `buildItemPerf(pool)` computes
  per-item {count, months, exp, idx} — idx = actual wears / expected wears, where
  expected = peer wear-rate (subcategory rate, category fallback when the subcat
  slice is under 5 items) × months observed. Tenure runs from purchase_date
  (→ first wear → created_at fallback), clamped to the earliest logged wear
  anywhere (pre-logging months would deflate rates). `buildReportStats(field)`
  groups per-item perf by the dim's `keyFn`. Per group: wears/mo, median $/wear +
  total spend (gifts excluded from cost stats, still counted for engagement), duds
  (never worn, or archived with < `REPORT_DUD_WEARS`=3 wears). **Ranked dims**
  (brand/retailer/color/acquisition): idx sort + Best/Worst bar; groups under
  `REPORT_MIN_ITEMS`=3 items list unranked. **Canonical dims**: subcategory
  (taxonomy order under category `sf-label` headers, `showIdx:false` — the index
  is ×1.0 by construction there; the payoff is best/worst WITHIN the group, per
  user decision 2026-07-10), price (bracket order), year (newest first; current
  year's duds say "still proving out"/"too soon"). Pool = `reportPool()` —
  statsPool but `{ noStatusDefault: true }` so archived items stay in (dud rate
  needs them). Detail page: KPI card (subcategory swaps the vs-Similar KPI for
  Duds), Best performers / Underperformers grids (worst = never-worn by price
  desc, then lowest index), "All items" → grid with `statsFromReport` so back
  returns to the detail page (wired in `statsNavBack` + `statsRebuild`). No
  date-range button (metrics are inherently all-time / tenure-normalized); the
  filter funnel + acquisition range apply. **Workhorses / Declutter smart lists**
  (`buildSmartList` keys, a TOGGLE_GROUPS pair, rows in Clothing Stats):
  Workhorses = idx desc among 3+-wear items; Declutter = owned 6+ months, not in
  any liked look (`likedLookItemIds()` shield), never worn (longest-owned first)
  or idx < 0.5 and untouched 90+ days — transparent sort, no composite score.
  Filter sheet (funnel icon). Range button. Closet Review
  deals items one card at a time; inline field picker on the deal card (no sheet-hop
  for most fields). `reviewPool()` is **Available-only** (Storage + Archive excluded).
  Deal card is sized to fit one phone screen: horizontal card (96px photo + info
  beside it), single-line formality chips, one-row action bar. Looks Stats section
  has three rows: Most Worn Looks, Liked Looks (→ `likedNeglectedOutfits()`: liked +
  never-worn-or-60d+), and Contexts (→ `renderStatsContextsPage`: wears-by-context,
  `contextFormalityStats` avg/spread, tap through to `renderStatsContextDetailPage`'s
  top items + top looks for that context — both range-scoped via `rangeStart()`).
- **DAILY LOOP** — `logWearToday(id)`: one-tap wear log from item photo view (no modal).
  Soft dup-wear guard (skips the POST + offers "Log again →" if already logged today);
  `logLookOnDay` has the same guard per look/day (v3). POSTs immediately; toast shows
  "Wear logged" + **Undo** + "Add context →" chips (`toast()` accepts an array of
  `{label,fn}` action chips; `undoLoggedWears(rows)` is the shared Undo — back-dated
  logs and look logs get Undo too, the latter via the post-log sheet's close toast).
  **`wears.formality_for` is DERIVED, never asked (v3):** every wear-create path
  writes `deriveWearFormality(itemIds)` (level(s) all pieces share → median, else
  rounded avg of per-piece minimums); manual correction = the look's formality edit.
  `openPostLogSheet(wearRows[], {presetCtx, undoable})`: context multi-select +
  **heart toggle** (shown whenever the wears share an `outfit_id` — the PRIMARY
  hearting moment). A **weekday-context suggestion chip** (v3,
  `weekdayTopContext(date)` → "✨ Church · usual for Sundays", ≥3 distinct days to
  trust, `_ctxSuggest`) sits above the context chips — one tap selects, never
  auto-saved. Sheet fires after solo item log, look wear, and (single-ask) after
  `makeLookFromDay`/`saveCalClothingLogAsLook` create a look, pre-seeded from any
  context already on the day's rows. `_logItemId` (module-global) tells
  `renderContextPicker` which item's frequent contexts to sort first. `openLogWear(id)`
  (back-dated log) reachable via quick-actions "Log on a date…" and a 500ms long-press
  on the item photo view's Log button. Home's `.log-cta` (or, once logged, the
  `.logged-row`) and the calendar day-view footer's "↻ Wear again" both open
  `openWearAgainChooser(date)` — a horizontal strip of 12 candidate looks
  (`wearAgainCandidates()` → `{list, neglectedIds}`: worn last 14 days ∪ liked ∪
  most-worn this season, with **2 slots reserved for in-season liked-but-neglected
  looks** badged "it's been a while", v3) before falling back to +Clothing/+Look;
  tapping a look calls `logLookOnDay`. `createLookFromItems(itemIds, {name})` is the
  shared create-or-merge (dedup via `findDuplicateOutfit`) behind both
  `makeLookFromDay` and the +Clothing picker's "Log as look" button
  (`saveCalClothingLogAsLook`, shown once ≥2 items are picked).
- **TABS + WIRING** — `switchTab(name)`, `wireEvents()`, `init()` IIFE.
  Active tabs: home · closet · looks · calendar · stats.
  Capsules is a Home-tile screen (not in bottom nav). Search/Add are non-tab screens.

## Closet model

**Status is a cross-cutting lens, not a category.** A tee is always under Tops.
`closetLens` (Available/Storage/Archive/All) scopes the category folder list.
Status changes happen on the item detail move bar only.

- `closetLens` — current lens, default "Available"
- `closetCat` — null = root | category name
- `closetSub` — null = subcategory list | name | `"__other__"` | `"__all__"`
- `searchResults` — null = browsing | array = search-result grid
- `detailId` — item id in detail view (null = none)

`closetBack()` pops the stack: details view → photo view; then `_reviewMode` → review
deal; `_fromBuilder` → restore builder; **`_itemReturn` → return to origin screen**;
else: grid → subcategory list → category list → root.

**Item-detail back is app-wide via `_itemReturn`** (a restore thunk). Item detail always
renders into the closet screen, so any NON-closet entry point opens via `openItemFrom(id)`,
which captures the active screen (`makeItemReturn`) and brings the closet forward without
`switchTab`. `closetBack` invokes the thunk (`restoreTab(tab)` re-renders that tab from its
preserved view-state). `switchTab` clears `_itemReturn` (a real tab tap abandons the return).
The builder is the one exception — it needs a full state stash, so it keeps `_fromBuilder`.
Plain closet-grid taps use bare `openItem` (origin IS closet → default back). Migrated entry
points: stats (`openItemFromStats`), look piece tap, suggestion piece tap, capsule item tap.

**Look-detail back mirrors this via `_lookReturn`** (added 2026-07-07 r2). Non-Looks entry
points open via `openLookFrom(id)` (`makeScreenReturn("looks")` — the generalized capture
behind `makeItemReturn`); `leaveLook()` consumes the thunk on back/archive/delete. Migrated:
calendar day-view look cards, both stats look grids, capsule looks, trip-plan day cards.
`restoreTab("looks")` re-opens `lookId` (per `lookView`) instead of `renderLooks()`, so
item-back from a look-canvas piece lands on the LOOK, and the two thunks compose:
calendar → look → piece → back → look → back → calendar. `switchTab` clears both returns.
Builder round-trips (`builderCancel`/`finishBuilder`) route through `switchTab("looks")`
and intentionally abandon origin.

## Data model

Canonical definition: **`schema.sql`** in repo root. Six tables, all RLS-scoped to
`auth.uid()`:

- `items`: id, user_id, name, category, subcategory, brand, retailer, color_family
  (single), price, purchase_date, date_is_guess, acquisition (New|Secondhand|Gift),
  size, fabric (text[]), season (text[]), **formality** (smallint[] of 1–8 levels), status
  (Available|Storage|Archive), tags (text[] — includes `"no-suggest"` tag), url,
  order_no, receipt_url, official_name, notes, image_path, created_at.
- `wears`: id, user_id, item_id, outfit_id (nullable), worn_on (date),
  context (text[] — named contexts, multi-select; seed list `CONTEXT_SEED` + any
  custom ones, derived via `contextOptions()`), formality_for (smallint 1–8,
  nullable — DERIVED at log time via `deriveWearFormality`, never asked (v3);
  manual override lives on the look), created_at.
- `outfits`: id, user_id, name, context, notes, image_path, formality_override
  (text — bucket key, nullable), **layout** (JSONB `{item_id,x,y,s}[]`),
  **rating** (smallint, CHECK 1–5, nullable — `rating === 1` means "liked" (hearts);
  other values unused/reserved), **archived** (boolean default false — manually-set
  flag; browse/pickers actually key off the DERIVED `effectiveArchived(o)`, which is
  also true when any piece's status is Archive), created_at.
  Join table: `outfit_items(outfit_id, item_id, user_id)`.
- `capsules`: id, user_id, name, kind (capsule|packing|travel), start_date,
  end_date, notes, locations (JSONB `{name,lat,lon,from,to}[]`), created_at.
  Join table: `capsule_items(capsule_id, item_id, user_id, packed bool)`.
- `exclusions`: id, user_id, item_a (uuid), item_b (uuid), reason (text),
  created_at. Normalized: `item_a < item_b`. RLS own_rows.
- Photos: private `wardrobe` bucket, path `<user_id>/<uuid>.<ext>`. Display = signed URLs.

**Migrations applied to live DB** (run via Supabase SQL editor):
- `migration/formality_schema.sql` — adds `items.formality`, `wears.formality_for`,
  `outfits.rating`, `exclusions` table.
- `migration/formality_multiselect.sql` — converts `items.formality smallint → smallint[]`
  (drops CHECK constraint, wraps existing values in arrays).
- `migration/outfit_layout.sql` — adds `outfits.layout`.
- `migration/capsule_weather.sql` — adds `capsules.locations`.
- `migration/capsule_items_packed.sql` — adds `capsule_items.packed`.
- `migration/wears_context_array.sql` — converts `wears.context text → text[]` (multi-select).
- `migration/outfit_archived.sql` — adds `outfits.archived` (boolean). Applied 2026-06-28.
- `migration/capsule_plan.sql` — adds `capsules.plan` (jsonb) for trip per-day outfit
  planning (`{ "<date>": ["<outfitId>", ...] }`). **Run before using the by-day planner.**
- `migration/merge_duplicate_outfits.sql` — DATA cleanup (not schema): collapses outfits
  with identical item-sets into one survivor, re-pointing wears. Survivor = non-archived >
  has-layout > oldest. Idempotent. Pairs with the save-time dedup guard in `saveBuilder`
  (`findDuplicateOutfit`/`itemSetKey`). Run once after deploying 2026-06-28 r5.
- `migration/items_laundry.sql` — adds `items.last_washed` (date) + `items.laundry_state`
  (text override: `'hamper'` | `'extra:<n>'`). **CONFIRMED RUN 2026-07-18** (verified
  via anon-key REST column probe; `LAUNDRY_READY()` gate stays as belt-and-suspenders).
- `migration/kv_store.sql` — new `kv` table (`user_id, key, value jsonb`, PK
  (user_id,key), RLS own_rows) for small app state (Round A day plans + wxlog).
  **CONFIRMED RUN 2026-07-20** (anon-key REST probe returned 200).

## Design model

**Formality (1–8, multiselect set):**
1. Function (workout, hiking, rain) · 2. Very Casual (home, errands) · 3. Casual
(chorus rehearsal, casual lunch) · 4. Polished Casual (date nights, matinees, parties) ·
5. Smart Casual (normal work day) · 6. Dressed Up (cocktail, weddings, evening) ·
7. Business Professional (interviews, conferences) · 8. Formal (black tie).

`items.formality` is `smallint[]` (a set, not a range). `itemFormalitySet(i)` is the
source of truth — returns the explicit array, or imputes from name keywords + subcat
seed (`SUBCAT_FORMALITY`) + co-occurrence nudge. `itemFormality(i)` returns the minimum
of the set for backward-compat display/grouping.

Suggestions: outfit valid at level L iff every piece's set contains L (pool-filtered
before combo generation). Pure-Function items (`set == [1]`) never mix with non-function
items — enforced by `formalityOk(its)`. L8 (Formal) is soft — no isolation.

`OCCASION_HINTS` parallel array holds the context descriptions shown in chip UI.

Migration: `migration/formality_multiselect.sql` — drops old CHECK constraint, converts
`smallint → smallint[]`. Applied 2026-06-26.

**`outfitBucket(o)`:** checks `o.formality_override` first, then derives from
`itemFormality()` averages across pieces. `o._bucket` is a session cache — clear it
(set null) when any piece's formality changes.

**Outfit suggestions:** slot-filling (Top/Dress + Bottom + Shoes + optional Outerwear).
Cardigans slot as "Outerwear" via `suggestSlot(i)`. **Intentionally random within things
that plausibly match — no unworn/rotation bias.** Hard filters: formality cohesion
(`formalityOk`), exclusions. Soft penalties only: 2+ loud colors, 2+ patterned pieces
(`isPatterned`). Soft boost: color-pair + item-pair affinity learned from saved outfits
(`buildSuggestIndexes`, capped). Slots random-sample; softmax (temp 0.8) + diversity-aware
batch selection. Capsule-scoped mode via `openSuggestSheet(null, capsuleId)`. A seeded item
(item-detail shuffle) persists across the batch by design. Suggestion/builder pieces are
tappable to open the item (builder restores in-progress look via `_fromBuilder`).

**Sentinel tags in `items.tags`** (managed via `setItemTag(id, tag, bool)`):
- **`NO_SUGGEST_TAG = "no-suggest"`** — `isNoSuggest(i)`/`setNoSuggest`. Excluded from all suggestions.
- **`LAYER_TAG = "layer"`** — `isLayer(i)`/`setLayer`. A Top flagged as layerable (e.g. a
  button-up) is eligible for the Outerwear/layer slot in `suggestOutfits` as well as the
  Top slot (combos guard against an item being its own layer). Toggle in item detail
  SUGGESTIONS card, shown only when `category === "Tops"`.

**Contexts** — 13 named occasions stamped on wears/outfits (not items). Formality
ranges: Function/garden (1) · WFH (1) · Errands (1–2) · Friends/rehearsal (2) ·
Campus (3) · Conference (3) · Date night (2–4) · Symphony (3–4) · Church (3–4) ·
Shower/holiday party (4) · Funeral (4, dark tones rule) · Wedding guest (4–5) ·
Gala/chorus concert (5, all-black rule).

**Taxonomy** (category → subcategories):
- Tops: Tee shirts, Graphic tees, Long-sleeve tees, Sleeveless, Blouses, Sweaters, Cardigans, Sweatshirts
- Bottoms: Jeans, Pants, Shorts, Skirts, Leggings/Joggers, Tights
- Dresses: Short, Long, Cocktail
- Outerwear: Blazers, Jackets, Coats
- Shoes: Boots, Sandals, Flats, Heels, Sneakers
- Workout: Workout tops, Active shorts, Sports bras, Swimwear

**Color families** (single per item): Green, Teal, Blue, Purple, Maroon, Pink, Red,
Orange, Yellow, Beige, Brown, White, Gray, Black, Metallic.

## Migration

**The full data reset is DONE (user confirmed 2026-07-18)** — the live data is
real, not provisional; treat it as the irreplaceable asset it is.
`migration/RESET_PLAN.md` is historical.
`migration/` holds throwaway importers (NOT shipped; libraries OK there).
`migration/.env` (gitignored) holds the service-role key + Airtable token.
`schema.sql` (repo root) = canonical target state.

Airtable base "CLOTHING BASE CURRENT" (`appK4hX9DJYTGFGYb`) is the source of truth.
476 items + 3,995 wears + 1,543 outfits imported 2026-06-18.

Migrations are run by the user in the Supabase SQL editor. **Never deploy UI that
writes a new column/table before its migration is confirmed.**

## Conventions

- **`APP_VERSION`** format: `YYYY-MM-DD rN`. New day = `r1`; same day = increment `rN`.
  Currently `2026-07-26 r11`. ⚠️ The version lives in **THREE** places that must
  stay in lockstep — the deploy skill does all three, the selftest pins all three:
  1. `APP_VERSION` in `js/01-config.js`;
  2. `<meta name="app-version">` in `index.html` (read by `checkForNewVersion`,
     which Range-fetches the first 2KB of the deployed page — a mismatch means a
     phantom "Update available" toast, or never seeing a real one);
  3. the **`?v=` on all 22 `js/`+`css/` tags** (21 until 2026-07-26 r6 added
     `js/20-rack.js` and renumbered boot to `21-boot.js`). Miss one and Pages
     serves a fresh `index.html` beside a stale module — a half-updated app,
     which is worse than an un-updated one.
- Comment non-obvious logic only — match the surrounding density.
- Fixed product choices live as constants at the top of `js/01-config.js`
  (`TAXONOMY`, `COLOR_FAMILIES`, `OCCASION_LADDER`, `CONTEXTS`) — change them there.
- All item photos use **`background-size: contain`** everywhere. Never `cover`/`fill`.

## Filtering

**Canonical filter predicates** (single source of truth): `matchesFormality(i, level)`
(numeric 1–8) and `matchesSeason(i, season)` (DERIVED via `itemSeasonSet`; unknown
season = no match). **Status is always read via `itemStatus(i)`** (null → "Available");
an empty status filter means **Available only** (`itemMatchesFilter` default, tightened
2026-07-11 r1 — it used to only exclude Archive, which let Storage into Style Stats;
explicitly picking statuses in the funnel brings Storage/Archive back; pickers/builder
pass `{ noStatusDefault: true }` because they have their own status chips). `STATUSES`
no longer includes Wishlist. `inSeason()` (suggestions) is intentionally separate —
unknown = all-season-eligible.

**Unified filter sheet (Phase 2) is SHIPPED**: `openFilterSheet(state, { onApply, title,
dims })` + `itemMatchesFilter(i, state, opts)` / `outfitMatchesFilter(o, state)` drive
Closet, Stats, and Looks. Per-surface dim lists (`CLOSET_FILTER_DIMS` etc., ~line 2869)
and per-surface `newFilterState()` clones (`closetFilter`/`statsFilter`/`looksFilter`).
The standalone Search screen is retired (`openSearch` now opens the closet funnel).
`outfitMatchesFilter` semantics: ALL-pieces for formality/capsule/status, ANY-piece for
the rest (plus outfit-only `liked`, since `itemMatchesFilter` never sees it — see
`FILTER_UNIFICATION.md` Phase 3, now SHIPPED). **Phase 3 (pickers: builder, calendar
+Clothing/+Look, capsule add-items, trip plan picker) is SHIPPED** — every picker uses
the shared `funnelBtnHtml(id, state)` button+badge.

## Known gotchas

- **⚠️ A full-width `<button>` needs an explicit `width`. `display:block` is not
  enough** (2026-07-26). Form controls size to their content regardless of
  `display`, so `.log-cta` — the app's primary action — rendered as a **181px
  stub in a 390px column** for months, and `.logged-row` (also the laundry,
  backup and planned rows) at 259px. Neither rule set `width`. Both now use
  `width: calc(100% - 32px)`, matching their 16px side margins; that's the idiom
  `.otd-row` and `.trip-dash .td-laun` already used, and `.btn`/`.btn-sec`/
  `.sheet-action-btn` set `width:100%`. **Any new full-width BUTTON needs one of
  those.** A `<div>` in the same position would have been fine, which is exactly
  why this hid so long. It was invisible to CSS reading and obvious within five
  seconds of rendering the app — **render the screens and look at them.**
- **One glyph, one meaning, app-wide** (2026-07-26, user-reported: "the little
  shuffle button means two different things in two different places"). `↻` had
  come to mean "wear again" (show me looks I already own) in the calendar
  footer, "reshuffle" (generate a new combo) in the suggester, and a per-piece
  swap — two of those are opposites, which makes a one-tap control require
  recall. **`↻` is retired; `✨` is the single mark for "make something new"**
  (suggest, reshuffle, re-roll, per-piece swap) and history actions carry a
  plain word ("Wear again"). Weather refresh is an inline SVG and unaffected.
  A selftest case fails if `↻` reappears in any `js/` module.
- **`svgElement.hidden = bool` does not reflect to the DOM attribute** in this
  app's runtime (2026-07-21 r14) — unlike on a div/button, it silently sets a
  same-named JS expando that reads back correctly (`el.hidden === true`) but
  never touches `getAttribute("hidden")`, so the global
  `[hidden]{display:none!important}` rule never fires and the element stays
  visible regardless. Toggling an inline `<svg>` icon's visibility from JS
  must use `svg.toggleAttribute("hidden", bool)` instead. Every OTHER
  `.hidden =` in the codebase targets a div/button/span, where it works fine —
  this only bites bare `<svg>` elements.
- **No hardcoded colors in new UI** (2026-07-21 r13). The redesign routed every
  literal through a token so the two themes × light/dark all work. A new
  `background: #fff` or `color: #fff` looks fine while you're building and then
  glows on a dark screen. Use `--surface`/`--panel`/`--panel2`/`--bg2` for
  fills, and **`var(--on-accent)` for text or strokes sitting on
  `var(--accent)`** — never literal white there, because the accent lightens in
  dark mode. Headings use `var(--serif)`, which is **system fonts only**; adding
  a webfont `<link>` breaks the single-file rule.
- **A `@media (prefers-color-scheme: dark)` block near the TOP of the stylesheet
  cannot override a later base rule at equal specificity** (2026-07-21 r13). The
  design handoff's dark-mode text-color override sat at line ~75 and silently
  lost to `.btn { color: … }` at line ~165. Theme-varying values belong in a
  **custom property** on `:root` (which is why `--on-accent` exists), not in a
  media-query rule that races the cascade.
- **Bottom sheets open/close ONLY via `showSheet(id)`/`hideSheet(id)`** (2026-07-17)
  — never set a sheet wrapper's `.hidden` directly. `hideSheet` animates first and
  flips `hidden=true` ~240ms later, so code that *reads* `.hidden` right after a
  close sees `false`; the wrapper ids list in `uiCanRefetch()` must gain any NEW
  sheet wrapper added later.
- **`#toast` overlays bottom-fixed controls and must stay tap-transparent**
  (2026-07-21 r12). It's `position:fixed` at `bottom: nav-h + safe-b + 18px`,
  **z-index 50** — the same band as `.stats-toggle-float` (z-index 18) and close
  to `#itemBar`/`.lk-actbar` (25). It used to set `pointer-events:auto` on the
  whole pill when it had action chips, and its handler returns early on a
  non-chip tap — so a lingering toast made the Most/Least Worn toggle look
  broken (tap the chip → that action fired; tap elsewhere → nothing). Rule:
  **`pointer-events` stays `none` on the pill; only `.toast-chip` opts back
  in.** `positionToast()` additionally lifts the toast clear of
  `.stats-toggle-float`; it's called from `toast()` AND from
  `renderStatsGridPage` so it self-corrects from both directions. Any NEW
  bottom-fixed control in that band needs the same consideration.
- **⚠️ A WEAR IS A DAY. Never count wear ROWS** (2026-07-24 r1). One outfit
  logged on one day writes one `wears` row **per piece**, so `rows.length` reads
  a 5-piece look as 5 wears — and the context stamped on it as 5 outings. Every
  "N wears" number must dedupe on `worn_on`. Use **`countByDay(rows, keyFn)`**
  (next to `ctxArr`): `keyFn` returns the keys a row contributes to, and each key
  counts a given `worn_on` at most once. Already day-based and safe to copy:
  `wearCount`, `outfitWornCount`, `buildItemPerf`'s `itemWearIndex`. The only
  legitimate row count left is the Settings backup card ("N wear records" —
  deliberately relabeled, it's a table size, not a wear count).
- **A stats page's funnel must match its pool — both directions** (2026-07-25 r11,
  user-reported). `statsToolbar(..., hideFilter)` and the pool argument are ONE
  decision, and getting them out of step lies to her either way: "What's missing"
  hid the funnel but still passed `statsPool()` (invisible filter silently
  narrowing the page), and "Closet vs Life" showed a funnel while `buildGapStats()`
  ignored `statsFilter` entirely (decorative funnel). Rule: **whole-wardrobe pages
  pass no pool AND `hideFilter=true`** (Rotation, What's missing, Closet vs Life,
  Year in pixels); **filtered pages pass `statsPool()` and show the funnel**
  (Palette, field/report pages). Never mix.
- **Every `statsView = "grid"` entry point owns ALL the back-nav flags** (2026-07-25
  r11, user-reported "back goes too far"). `statsNavBack` picks the return target
  from `statsFromReport` / `statsFromPalette` / `statsFromField`, falling through to
  `main`. A new drill-in that sets only its own flag lands correctly but leaves the
  others stale for the NEXT drill-in — so every grid entry must set its own flag
  true and the rest false. There are four such sites; grep `statsView = "grid"`.
- **`effectiveArchived` is memoised** (2026-07-26 r11) — it walks every piece of
  every look and runs from `activeOutfits()` on every Looks render, every look
  picker and several stats paths. `buildOutfitIndexes()` clears the map, so
  anything reloading data is safe; the two OPTIMISTIC mutations that don't go
  through it — `archiveLook` (incl. its rollback) and `saveField(id,"status")` —
  call `invalidateArchivedCache()` explicitly. Any new path that flips
  `o.archived` or an item's status must too.
- **Never call `wearCountInRange` inside a sort comparator** (2026-07-21 r11) —
  it filters the whole `wears` array per call, so a comparator makes it
  items × wears × log(items) (~34M row reads on the real closet, ~1s of frozen
  UI). Use `wearCountMapInRange()` — one pass, `Map(item_id → count)`. Both count
  distinct wear DAYS in every range mode (the ranged branch counted raw rows
  until 2026-07-24 r1; the selftest pins the agreement).
- **Drilling in must reset scroll; re-rendering must NOT** (2026-07-25 r12,
  user-reported "clicking into stats starts in the middle of the page"). Body is
  one scroll container shared by every screen, so a short child page inherits a
  long parent's offset. `switchTab` resets it; nothing else used to. The trap:
  `renderCloset()`/`renderStats()`/`renderCapsules()` are each called BOTH to
  navigate and to refresh in place (after a log, an undo, a filter change), so a
  bare `scrollToTop()` inside them yanks the page out from under her. Two
  patterns, use the right one: **Stats** compares `_statsLastView` to `statsView`
  inside `renderStats()` (the wrapper around `_renderStatsView()`) — view changed
  = navigation, same view = re-render. **Everything else** uses the per-surface
  stack `navDeeper(surface)` / `navShallower(surface)` / `navResetScroll(surface)`
  called at the *navigation handler*, never inside a render. ⚠️ `navShallower`
  deliberately does not just call `restoreScroll(y)` — that early-returns on 0 and
  would strand you at the child's offset when the parent was at the top.
- **Screen-top scrolling**: use `scrollToTop()` (instant) / `smoothScrollTop()`
  (animated, for deliberate "take me up" taps — header, re-tapping the active
  tab) / `getScrollTop()` / `restoreScroll(y)`. `window.scrollTo` AND
  `document.scrollingElement.scrollTo` are both no-ops (body is the scroll
  container), and `behavior:"smooth"` on body is unreliable — that's why
  `smoothScrollTop` hand-eases `scrollTop` on a setTimeout loop (rAF stalls in
  hidden documents). Back-nav scroll restore: `makeScreenReturn` thunks carry
  it; plain closet/look back uses `_detailEntryScroll`/`_lookEntryScroll`.
- **`localStorage` in restricted contexts**: `data:` URL open throws "Storage is
  disabled". `store` wrapper handles it — never use `localStorage` directly.
- **WebP encode**: `canvas.toBlob(..., 'image/webp')` silently returns PNG on some
  browsers. `compressImage` checks `blob.type === 'image/webp'` and falls back to JPEG.
- **Private photos need signed URLs** — never use a public bucket URL. Batch-sign via
  `POST /storage/v1/object/sign/{bucket}` with `{paths, expiresIn}`; full URL =
  `` `${SUPABASE_URL}/storage/v1${row.signedURL}` ``.
- **Photo bytes are cached locally (Supabase egress guard, added 2026-07-06 r8).**
  Signed URLs change every session so the browser HTTP cache never hits — every session
  used to re-download every photo (triggered a Supabase egress-quota email 2026-07-02).
  `photoUrl(path)` (the ONLY thing `loadPhotoNode` calls now) checks the Cache Storage
  API (`PHOTO_CACHE`, keyed by stable `image_path` via `photoCacheKey`) before any
  network; misses fetch the signed URL once and store the bytes; serves `blob:` URLs
  (`_blobUrlCache` per session, `_photoPending` dedupes concurrent grid renders).
  Eviction: `deletePhoto` → `evictPhotoCache` (photo replace/remove both flow through
  it); `prunePhotoCache()` after `loadData` drops entries no item references. Falls
  back to plain signed URLs where `caches` is unavailable. If photo display ever
  changes, route it through `photoUrl`, never raw `signedUrl`.
- **`prewarmUrlCache()`** — call after `loadData()` fire-and-forget. IntersectionObserver
  finds URLs cached on scroll.
- **`loadPhotoNode` sets `backgroundColor = "transparent"`** — lets white/transparent
  garment PNGs show cleanly on tile backgrounds.
- **GitHub Pages caches hard** — hard-refresh (`Cmd+Shift+R`) after deploy.
- **⚠️ The tab-bar gap is an iOS 26 bug. Do not try to fix it in CSS.** In the
  installed (standalone) app on iOS 26, the layout viewport is short at the bottom
  by exactly the *top* safe-area inset: iOS deducts the status-bar inset from the
  viewport height as if the web view sat below the Dynamic Island, while also
  placing it at y=0 and reporting `safe-area-inset-top` normally. Counted twice.
  Measured 2026-07-22, iPhone 14 Pro: `screen.height` 852, `innerHeight` 793,
  inset-top 59, inset-bottom 34. So anything at `bottom: 0` renders 59pt above the
  physical edge, and the page canvas keeps painting that strip — which is why the
  gap always matches the *body* background, never the bar's.
  - `env(safe-area-inset-bottom)` is **not** the cause. `--safe-b` is 0 and that is
    correct; zeroing it changes nothing about the gap.
  - **Fixed elements are clipped to the layout viewport, even though the canvas
    paints past it.** Tried and reverted in r5: `.tabbar { bottom: calc(-1 * 59px) }`
    positioned the bar perfectly (`rect.bottom` 852 = the physical edge) and then
    rendered *nothing at all* — the bar vanished. A `::after` shim extending the
    background downward fails identically. There is no CSS route into that strip.
  - Remaining options if it's ever worth revisiting: revert
    `apple-mobile-web-app-status-bar-style` to `default` (system lays the web view
    out inside the safe area and paints the bands itself — costs the edge-to-edge
    dark status bar), or wait for the WebKit fix (reportedly Safari 26.1).
  - Her standing call: live with the gap. Don't re-litigate it without new evidence.
  - A temporary on-device diagnostics readout lived in Settings for r4/r5 —
    `git show 5b11943` if numbers are ever needed again.
- **Status is a lens, not a category** — always change status on the item detail move bar.
- **`closetBack()` priority stack**: `detailView==="details"` → photo view; `_reviewMode`
  → review deal card; `_fromBuilder` → restore builder; `_itemReturn` → origin screen
  (`restoreTab`); `detailId` set → closet grid; `searchResults` → sub → cat → root.
- **Open an item from a non-closet screen via `openItemFrom(id, browseCtx?)`** (never
  bare `switchTab("closet")` + `openItem`) so back returns to the origin, not the
  closet. To make sibling prev/next nav browse the item's category, pass
  `{cat, sub}` as `browseCtx` — NEVER pre-set `closetCat`/`closetSub` at the call
  site: `openItemFrom` snapshots the closet browse state and restores it when the
  return thunk fires (v3 nav-audit fix). Builder `_fromBuilder` path is the exception.
- **Open a look from a non-Looks screen via `openLookFrom(id)`** (never bare
  `switchTab("looks")` + `openLook`) — same rule for looks (`_lookReturn`/`leaveLook`).
- **`looksBack()` checks `lookId` BEFORE `looksSearchQ`** — a look can sit on top of a
  lingering search; back must exit the look first (then `renderLooks()` restores the
  search results). Don't reorder.
- **`closetSub` special values**: `"__other__"` = no recognized subcategory;
  `"__all__"` = flat grid of whole category. Handle both in `categoryGrid()`.
- **`[hidden]` vs CSS specificity**: always include `[hidden] { display: none !important }`
  in global styles or `display:flex` on an ID beats the built-in hidden behavior.
- **Grid bar `position:fixed`** above tab bar. Add `has-gridbar` class to `#app` so
  `.tabbody` gets padding; else the grid's bottom row hides behind the bar.
- **Select mode DOM surgery**: `toggleSelect(id)` updates just the tile + calls
  `updateGridBar()` directly — no full re-render — to avoid photo-URL flicker.
- **Bulk PATCH via PostgREST**: `PATCH /items?id=in.("id1","id2")` — IDs must be
  quoted strings inside `in.()`.
- **`store.getItem` / `store.setItem`** (not `.get/.set`) — mirrors localStorage API.
- **Item photo view**: `detail-photo` class on `#app` hides the tab bar via CSS.
  `#itemBar` (z-index 25, bottom:0) replaces it. Add in `openItem()`; remove in
  `renderCloset()`, `closetBack()` (photo exit), and `switchTab()`.
- **`FIELD_CONFIGS`** maps field key → `{label, type, opts?, filter?}`. Types: `color`,
  `multi`, `single`, `formality`, `text`, `price`, `typeahead`, `date`. Add new fields here
  before wiring in `openItemDetails`. Current fields: name, purchase_date (date), color_family,
  fabric (filter), size, season, brand (typeahead), status, formality, price, url,
  retailer (typeahead), acquisition. Name is tappable in the detail header (rename);
  `saveField` blocks empty name and clears `date_is_guess` when `purchase_date` is set.
  Capsule membership is NOT a `FIELD_CONFIGS` field — it's a join table, edited via
  `openCapsuleAssign`/`saveItemCapsules` (item detail) and `_addState.capsules` (Add form).
- **Field sheet dual-mode**: `_fieldEditItem` = item OR `_addState`; `_fieldOnSave` = null
  (save to DB) or callback fn (Add form). Clear both in `closeFieldSheet()`.
- **Add Item state**: `_addState`, `_addPhotoBlob`, `_addPhotoUrl`. `#moveSheet` reused for
  category with `_addCatMode = true` guard.
- **Formality is 1–8**: `OCCASION_LADDER` has 8 entries (see Design model).
  `itemFormalitySet(i)` is the source of truth (explicit array or imputed);
  `itemFormality(i)` = min of the set, for display/grouping compat.
  Function items (set == [1]) must never mix with non-Function — enforced by `formalityOk(its)`.
- **`openOccasionEdit(itemId, onSaved)`**: single-tap pick (tap again to deselect).
  Always clears all `o._bucket` caches so looks re-derive.
- **Exclusions**: `_excludeSet` is a Set of `"<smaller-id>:<larger-id>"` strings.
  `isExcluded(a,b)` normalizes order before lookup. Loaded in `loadData()`, rebuilt via
  `buildExcludeSet()`.
- **Capsule suggestions**: `openSuggestSheet(null, capsuleId)` scopes the pool to
  `capsuleItems(capsuleId).filter(i => itemStatus(i) === "Available")`. `_suggPool()`
  reads `_sugg.capsuleId` to supply this on every regenerate/level-filter inside the sheet.
- **Calendar day-view logging**: `renderCalendarDay` does `body.onclick = null` to clear
  stale picker delegation. Both `openCalAddClothing` and `openCalAddLook` set `body.onclick`;
  they always terminate via `renderCalendarDay(body)` which clears it.
- **Calendar copy/move**: implemented in the `[data-calact]` handler in `renderCalendarDay`.
  Opens `#logSheet` with a date picker; copy = duplicate rows, move = copy + DELETE originals.
- **Item photo replace**: `replaceItemPhoto` reuses the Add pipeline; new uuid filename
  avoids cache collisions. `removeItemPhoto` nulls `image_path`. No in-app crop/rotate.
- **`layoutCanvasHtml(o, wrapCls)`**: single source for outfit thumbnails everywhere.
  Returns positioned `.ocpiece` divs or `null` (no usable layout). Falls back to grid
  collage on `null`. Pass through for any new outfit-thumbnail surface.
- **Build-a-look canvas**: `builder` global is `null` except on `#tab-builder`.
  `switchTab` clears it + `builder-mode` class. Normalized geometry (center fractions).
  Move/resize/select = DOM surgery only (no re-render). Touch needs `touch-action:none`
  on `.bCanvas` and `.bpiece`. `outfits.layout` write needs `migration/outfit_layout.sql`.
- **Trip weather (Open-Meteo)**: geocoding (`geocoding-api.open-meteo.com`), forecast
  (`api.open-meteo.com`, today−92d→+15d), ERA5 archive (`archive-api.open-meteo.com`).
  Far-future dates use 3-yr historical average (gray "avg" card). `_wxCache` 10-min TTL.
- **`activeCapsuleId`** scopes Closet (`lensItems()` returns only capsule members) AND
  Looks (`looksScopedOutfits()` keeps only wearable looks). Does **not** clear on tab switch.
  Set by `planFromCapsule(id)` — from the capsule detail ("Plan outfits from this") OR from
  the **closet root** "Filter by capsule or trip" button (`openClosetCapsuleFilter`, shown
  when not already scoped). Cleared only by banner ✕ (`[data-cap-clear]`) or deleting the capsule.
- **Capsules: nested-button gotcha** — inner tap targets inside `.gtile` must be `<div>`,
  not `<button>`. Parser hoists nested buttons as siblings; `.gtile .pack-tick` won't match.
- **`capsule_items.packed`**: inserts omit it (pre-migration safe); only `togglePack()`
  PATCHes it. Needs `migration/capsule_items_packed.sql` before using tick feature.
- **`[data-sv]` on stats field pages** must use `:not([data-sf])` to avoid filter chips
  (which carry both attributes) also triggering grid navigation. Same for donut highlight.
- **`statsRebuild()`** handles grid state transitions then calls `renderStats()`.
  `wireStatsToolbar()` wires `#stBack` + `#stFilter` — call at end of every stats render.
- **Stats date range** only affects wear-count lists (most/least worn, never worn).
  CPW uses all-time `wearCount`. `wearCountInRange(itemId)` for range-aware counts.
- **Closet Review inline editing**: `_rvPending` holds the pending value for the current
  card. `renderReviewInline(fieldKey)` returns chip HTML. Resets on every `reviewAfterEdit()`
  or `reviewSkip()`. Category/subcategory fall through to sheet-based editing.
- **`siblingItems()`** derives the current browsing context list (searchResults → sub →
  cat → lensItems) for item prev/next navigation in `openItem()`.

## Back-burner (not in current round)

- Reorder capsules (needs an `order` column)
- Crop/rotate photo editor
- ~~Outfit feedback~~ → hearts scheduled in ROADMAP v2 Wave 3 (👎 still rejected)
- ~~Outfit of the day on Home~~ → scheduled in ROADMAP v2 Wave 7
- Capsule-scoped suggestions improvements: variety seeding, multi-anchor, constraints
- ~~Wear-logging loop overhaul~~ → scheduled in ROADMAP v2 Waves 1+5

**Shipped 2026-06-27 r3:**
- Multi-exclude UI (r4) — `openExcludeSheet` lists every unordered PAIR among the shown pieces as a
  toggle row (`.ex-pair`, `data-expair="<a:b>"`); user ticks the specific clashing pairs (A×B without
  A×C). Already-excluded pairs render locked. Each ticked pair → its own exclusion. NOT subset-pairwise.
- Context typeahead — `renderContextPicker` "+ Add…" input live-filters `contextOptions()` + tap to
  pick/create. `_ctxAddOpen` tracks the expanded state (reset in every picker opener).
- `wears.formality_for` capture — `openPostLogSheet` now also fires after suggestion "Wear today",
  calendar +Clothing (`saveCalClothingLog`), and calendar +Look (`logLookOnDay`).
- Guessed-value indication — `REVIEW_FIELDS` season + formality carry `guess`/`guessLabel`;
  `renderReviewDeal` pre-fills the derived value and shows a `.rv-guess-hint` that clears on edit.
  `date_is_guess` intentionally NOT routed to review (would flood the queue).
- Builder subcat drill + scoped search (Phase 3a) — confirmed already implemented in `builderPickContent`.
- Auto-refresh trip weather — `_wxAutoTimer` re-fetches every `WX_TTL` while a trip detail is open
  (cleared in `renderCapsules` + `switchTab`); manual ↻ button (`[data-wx-refresh]`) in Locations header.

## Deploy

Commit `index.html` → push to `origin/main` → Pages deploys in ~1–2 min. See the
`deploy-wardrobe` skill. Repo: aluke0311/wardrobe_app. Live:
https://aluke0311.github.io/wardrobe_app/

## Local preview

`.claude/launch.json` runs `python3 -m http.server 4173` for the Claude preview
panel (the port is passed explicitly as of 2026-07-09 — it used to default to 8000
while the panel proxied 4173). Auth/data only fully work against the real
`https://` deploy; locally you get the login screen, but the whole script parses
and pure helpers are testable from the console. ⚠️ The panel's browser caches
index.html — always load with a fresh query string (`/?v=<anything>`).

**Self-test harness (2026-07-18): `migration/selftest.html`** — open
`http://localhost:4173/migration/selftest.html?v=<bust>` in the preview browser;
it loads the app in an iframe and asserts the derivation logic (trip phases,
sort keys incl. the legacy `"color"` mapping, laundry dirty/overrides,
formality, recap math, exclusions, version-lockstep). Summary line = `N/N
passed` — currently **161/161** (2026-07-26 r11, RUN GREEN). The count went 124 → 131 → 152 over 2026-07-26; it had earlier DROPPED from 136 when r19 deleted the guessing layer and its cases — a shrinking suite can be a good sign, say so plainly rather than padding. **It is a deploy gate for logic
changes** (skipped for CSS/copy/version-only deploys, which get a JavaScriptCore
parse-check instead) — the trigger list is step 0 of the `deploy-wardrobe`
skill. **Add a test whenever a session's ad-hoc console verification proves
something worth keeping true.** ⚠️ `ta(name, asyncFn)` is the async variant
(added 2026-07-26 for the kv conflict cases); `run()` awaits every pending one
before rendering, since an assertion landing after the summary is drawn would be
silently dropped. **Async cases that stub a global (e.g. `rest`) MUST be
`await`ed one at a time** — run concurrently they observe each other's stubs,
which is exactly how the first three failed. Gotchas baked in: app globals are top-level
const/let (invisible on `contentWindow` — the harness injects an eval-bridge
Proxy), and Sets passed into app code must be created in the IFRAME's realm
(`W.Set`) or `instanceof Set` fails. The iframe is parked **off-screen**, not
`display:none` — a display:none subtree has no layout, so every
`getBoundingClientRect()` in it returns 0 and layout assertions silently pass
on zeros (2026-07-26). Layout regressions are testable because of this; the
full-width-button case measures detached nodes in a 390px host.

⚠️⚠️ **THE GATE ITSELF WAS BROKEN FROM THE FILE SPLIT UNTIL 2026-07-26 — read
this before "improving" the harness's loading.** The 2026-07-25 fix (re-fetch
every module with `cache:"reload"` so mid-session edits are visible) was
requesting **`/migration/js/*.js`** — the harness lives at `/migration/`, so
every one of those 21 relative fetches was a 404. `fetch()` does not throw on
404, so it looked like it worked, and nothing was ever refreshed. Since
`index.html`'s tags carry `?v=<APP_VERSION>` and that only changes on deploy,
**every edit made without a version bump kept the same URL and the iframe
replayed the cached copy.** Measured: a freshly edited `js/14-calendar.js`,
correct on disk and on the wire, with the iframe still executing the previous
copy and 129 cases passing against it. Three things now stop it recurring, and
all three matter:
① fetches are **`/`-prefixed** and **throw on `!r.ok`**, so a 404 can never be
silent again; ② the iframe no longer trusts cache semantics at all — the harness
rewrites index.html with a **per-run token on every `js/`+`css/` URL** and hands
it over via **`srcdoc`** plus an injected **`<base href="/">`** (without the
base, relative URLs resolve against `/migration/` and the app loads nothing); ③
a case asserts every live function's `toString()` is a substring of the
freshly-fetched file — divergence means the iframe is stale.

⚠️ **A test that has never been executed is not a test — and a test that
can't fail is worse, because it reports success.** Two real instances: the
harness sat at 89/90 for a round of deploys because the r11 `statsNavBack` case
drove a re-render with no data behind it; and the r1 (2026-07-26) icon and
sheet-registry cases both passed **vacuously against 404 bodies** for a full
deploy. When you add a case, run it AND prove it can fail — mutate the thing
it guards and watch it go red, in the same session.
