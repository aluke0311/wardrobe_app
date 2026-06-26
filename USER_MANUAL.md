# Wardrobe App — User Manual

Your personal closet, on your phone. Photograph what you own, log what you wear,
and let the app help you put outfits together. This guide walks through every
screen and the everyday loops.

> Live app: https://aluke0311.github.io/wardrobe_app/
> After an update, hard-refresh (pull down to reload, or Cmd+Shift+R on desktop).

---

## 1. The basics

**Signing in.** The app is just for you. Sign in once and it remembers you on
that device.

**Home screen.** Five tiles:

| Tile | What it opens |
|---|---|
| **Closet** | Everything you own, browsable by category |
| **Looks** | Saved outfits + outfit suggestions |
| **Calendar** | What you wore, day by day |
| **Capsules** | Curated sets and trip packing lists |
| **Style Stats** | Insights, and the Closet Review gap-filler |

**Bottom bar.** Home · Closet · Looks · Calendar · Stats are always one tap away.
(Capsules lives as a Home tile, and Search/Add open from inside the Closet.)

---

## 2. Adding an item

From the Closet, tap the **＋** in the top-right.

1. **Take or choose a photo.** On a phone this opens the camera. Shoot the
   garment flat or on a hanger — the app keeps the whole image visible (never
   crops), so transparent/white backgrounds look clean. Photos are auto-shrunk
   before upload, so don't worry about file size.
2. **Name it** and set **Category → Subcategory** (e.g. Tops → Blouses).
3. **Fill what you know** — color, brand, size, fabric, season, price, formality.
   Anything you skip you can add later (see **Closet Review**, §11).
4. **Save.** It lands in your Closet under that category.

You don't have to fill everything up front. The app can guess formality from the
item's type and name, and Closet Review will nudge you to fill the gaps over time.

---

## 3. Browsing your closet

The Closet is organized as **folders**: tap a category, then a subcategory, then
you get a grid of items.

**Status lens.** At the top you can switch between:

- **Available** — your active, wearable wardrobe (the default)
- **Storage** — off-season or boxed-up pieces
- **Archive** — things you've let go of but want to keep a record of
- **All** — everything at once

Status is a *lens*, not a category. A tee is always under Tops; the lens just
decides whether you currently see it.

**Grid density.** Pinch or use the grid control to show 2–5 items per row.

**Finding one thing fast.** Tap the magnifying glass to **Search** (§12).

**Selecting many at once.** Tap **Select** to enter multi-select. Now you can
**bulk edit** (set a field on all of them, including Formality), **move** them to
a different category, **delete**, or **add them to a capsule** in one go.

### Item detail

Tap any item to open its **photo view**. From here:

- **‹ X of Y ›** — page through the other items in the same folder without going back.
- **Suggest outfit** (the shuffle icon, top-right) — build an outfit around this piece (§8).
- **Add to Look** — drop this piece onto the Build-a-look canvas (§7).
- The bottom bar has four actions:
  - **Details** (pencil) — open the full edit view
  - **Move to folder** — change its category/subcategory
  - **Log wear** (calendar) — record that you wore it (§6)
  - **Delete**

---

## 4. Editing an item

From the photo view, tap **Details** (pencil). Every row is tappable to edit:

- **Attributes:** Color, Fabric, Size, Season, Brand, **Status**, Acquired, **Formality**
- **Pricing:** Price, Retailer (the app computes **$/Wear** and time-in-closet for you)
- **Link:** the product URL
- **Notes:** a free-text box for anything
- **Don't suggest in outfits:** flip this on for items you never want the
  suggestion engine to use (e.g. a costume piece, or something pilling out).
- **Replace / Remove Photo** at the bottom.

**Changing status** (Available / Storage / Archive) happens right here on the
**Status** row — that's how you put something into storage or archive it.

---

## 5. Formality — the heart of outfit matching

Every item carries a **set of formality levels** — all the occasions where you'd
actually wear it. The question for each level is simply: *"could I wear this
here? yes/no."* Tick every level that applies.

| # | Level | When |
|---|---|---|
| 1 | **Function** | workout, hiking, rain |
| 2 | **Very Casual** | home, errands |
| 3 | **Casual** | chorus rehearsal, casual lunch |
| 4 | **Polished Casual** | date nights, matinees, parties |
| 5 | **Smart Casual** | a normal work day |
| 6 | **Dressed Up** | cocktail parties, weddings, evening events |
| 7 | **Business Professional** | interviews, conferences |
| 8 | **Formal** | black tie |

It's a **set, not a range** — you can skip levels. Heels might be `6 · Dressed Up`
and `8 · Formal` but nothing in between. A versatile wrap dress might be `3`, `4`,
and `6`. A blazer might be `5`, `6`, `7`.

**Why it matters:** when you ask for an outfit at a given level, the app only
uses pieces whose set *includes that level* — so everything in the suggestion is
genuinely appropriate. Workout-only pieces (level 1 alone) never get mixed into
non-workout outfits.

**Untagged items still work** — the app guesses a sensible set from the garment
type, the name, and what you've historically worn it with. You confirm or adjust
those guesses in **Closet Review**.

---

## 6. Logging what you wore

Three ways, pick whichever fits the moment:

1. **From an item** — open it, tap **Log wear** (calendar icon), pick the date, Log.
2. **From the Calendar** — open a day, then **+ Clothing** to log loose pieces or
   **+ Look** to log a whole saved outfit at once (§9).
3. **As you build** — saving/wearing a Look records its pieces together.

Wear history powers your stats: cost-per-wear, most/least worn, and the
"closet vs. your life" gap.

---

## 7. Looks — your outfits

The **Looks** tab is your outfit library. Switch how it's grouped with the lens:

- **Formality** — folders by dress level
- **Season** — by when you've worn them
- **Recent** — most recently worn first
- **All** — everything, newest first

Tap a look to see its pieces, edit its formality, or **nudge pieces** (push the
items in a look up to a target formality level in one move).

### Build-a-look (the canvas)

Tap **＋ Build a look** (or **Add to Look** from any item). You get a blank canvas:

- Drag pieces around; pinch/drag a corner to resize.
- Arrange them into a flat-lay you like.
- **Save** — the arrangement is stored and becomes the look's thumbnail everywhere.

### Random look

The shuffle icon in the Looks toolbar surfaces a random saved outfit — handy when
you want inspiration from your own history.

---

## 8. Outfit suggestions

Let the app assemble an outfit for you. Open the suggestion sheet from:

- an **item's** Suggest-outfit (shuffle) button — builds *around* that piece,
- the **Looks** tab **＋**,
- or a **capsule's** "Suggest an outfit" (scoped to just that capsule's pieces).

Inside the sheet:

- **Pick a target level** (1–8) to aim the outfit at an occasion — or leave it
  open for an everyday mix.
- **‹ ›** pages through the generated options.
- Regenerating gives fresh combinations every time, so you're not stuck with the
  same three suggestions.

How it chooses: it fills slots (top/dress + bottom + shoes + optional layer),
keeps everything at the right formality, favors colors you've actually paired
before, and rotates in pieces you haven't worn lately. Anything you marked
**Don't suggest** is skipped.

**"These don't go together."** When two pieces clash, you can **exclude** that
pair so they never appear in the same suggestion again.

---

## 9. Calendar

A month grid of what you wore, with little outfit thumbnails on each day.

Tap a day to open **Day View**:

- Each logged outfit shows as a card with its pieces.
- Tap the notes line to jot context ("dinner with M").
- **Swipe a card left** for quick actions: **Copy** (repeat this outfit on another
  day), **Move** (re-date it), or **Delete**.
- **+ Clothing / + Look** at the bottom to log more for that day.
- Arrows page day-to-day; you can't log into the future.

---

## 10. Capsules & Trips

A **Capsule** is a hand-picked set of items — a seasonal edit, a color story, or a
trip's packing list.

- **Create one**, then add items (from the capsule, or bulk-add from the Closet).
- **Plan outfits from this** scopes your Closet *and* Looks to just that capsule's
  pieces, so you can see everything you can make from it.
- **Suggest an outfit** generates outfits using only capsule members.
- **Trips** add a **packing checklist** (tick items as packed) and a **weather
  strip** — give it locations and dates and it pulls the forecast (or seasonal
  averages for far-off dates) to help you pack right.

A banner shows when a capsule is scoping your view; tap its ✕ to return to your
full closet.

---

## 11. Style Stats & Closet Review

**Style Stats** turns your closet and wear history into insight:

- Totals and value, color breakdown, donut charts per field.
- Smart lists: most worn, never worn, best/worst cost-per-wear.
- A **filter** (funnel) and **date range** to slice any of it.
- **Closet vs. Your Life** — compares what you *own* at each formality level
  against what you actually *wear*, flagging where your closet skews.

**Closet Review** (inside Stats) is the gap-filler. It deals you one item at a
time that's missing a field (color, formality, season, price…), with the picker
right on the card — tap, confirm, next. It's the fastest way to enrich a closet
you imported or added quickly. For formality it shows the guessed levels so you
just confirm or adjust.

---

## 12. Search

From the Closet, tap the magnifying glass. You get a keyword box (matches names,
brands, notes, and category names) plus filter rows for **Color, Fabric, Size,
Season, Brand, Status**. Combine any of them, then **Search** for a result grid.
**Reset** clears it.

---

## 13. Tips & good habits

- **Photograph against a plain background.** The app shows the whole garment, so
  clean edges look best.
- **You don't have to be complete.** Add items fast, then let **Closet Review**
  walk you through the blanks on quiet evenings.
- **Tag formality generously.** The more honestly you mark every occasion a piece
  works for, the better the suggestions. Use the skip-levels freedom — heels at
  6 and 8 only is exactly right.
- **Log wears even roughly.** A few taps now is what makes cost-per-wear and the
  "what you actually reach for" insights real later.
- **Use capsules for trips.** The packing checklist + weather strip together beat
  a paper list.
- **After an app update,** hard-refresh so you get the latest version.
