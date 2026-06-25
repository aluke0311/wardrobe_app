---
name: product-review
description: Run a deep product/behavioral design review of the wardrobe app (or a slice of it) as an obsessive power user — find daily-use friction, predict how the user will actually behave over years, and propose derive-first improvements. Use when the user asks for a product review, UX/friction audit, "how would this annoy me", "make it feel better to use", power-user critique, or wants to plan the next round of quality-of-life work. Ends by collecting decisions, NOT by building.
---

# Product / behavioral design review

This is a **personal, single-user tool** for one user (the owner). Optimize for
**speed, low friction, and delight for an expert who uses it daily** — never for
onboarding, discoverability, learnability, multi-user, permissions, or scale beyond
one person's dataset. Assume the user knows every feature, every term, and where
everything lives, and will happily learn a faster workflow.

Think simultaneously like a **product designer, behavioral psychologist, obsessive
power user, staff engineer, and the user's future self who has used the app every
day for years.** Be opinionated. Challenge assumptions. Give a recommendation, not a
survey.

## Hard rule: review and decide BEFORE building

This skill produces an **analysis + a decision questionnaire**, then stops. **Do not
write feature code** during a review. The user explicitly wants to answer questions
first, then build in a later pass. Building prematurely is the main failure mode.

## Step 1 — Ground in the code first

Never review from memory. Read the real surfaces in `index.html` before opining:
the daily loop especially (wear-logging: `logWear`, `submitWear`,
`populateWearItems`; suggestions: `suggestOutfits`; `openItem`; `renderHome`; the
item form; Fill). Map functions with `grep -nE "function "`. Cite findings as
`function`/`file:line`. Read `CLAUDE.md`, `ROADMAP.md`, `schema.sql`, and the memory
files (`wardrobe-product-decisions`, `wardrobe-app-overview`) so you don't re-derive
locked decisions or re-propose done work.

## Step 2 — Build (and state) a mental model of the user

Before proposing anything, infer the user's behavior from the code + history and
**state your assumptions explicitly**: how they log, what metadata they actually
fill vs. skip (look at coverage — e.g. occasion ranges, null contexts), whether they
prune or accumulate, their tolerance for upkeep vs. capture, what they truly value
(usually the analytics — which depend on faithful logging). Revisit the model as
evidence accrues. The current model lives in `wardrobe-product-decisions.md` — start
from it.

## Step 3 — Apply the lenses (ask these repeatedly)

- What would annoy me after 6 months? Become tedious after 1,000 uses?
- What info will I wish I'd captured? What am I capturing that I'll never use?
- What can be inferred / prefilled / remembered / suggested / batched / decided for me?
- What repetitive action or context-switch can disappear?
- What would make me smile because it feels thoughtful?

Analyze across: **Friction** (taps, typing, scrolling, hidden state) · **Long-term
usage** (500+ items, thousands of wears, heavy-use and total-neglect periods, tired/
rushed/phone-in-poor-light logging) · **Behavioral predictions** (the user WILL
postpone metadata, skip logging, avoid long forms, abandon maintenance features,
gravitate to the fastest path, and build workarounds) · **Derive-first** (prefer
systems that adapt to behavior over asking for more work) · **Creative
personal-tool moves** (predictive defaults, resurfacing forgotten items, adaptive
shortcuts that exploit their own history) · **Architecture** (hidden state, conceptual
overlap, features that fight each other or rot from maintenance burden).

Respect the locked guardrails (see `ROADMAP.md` §0): single-user, heuristics-only
(no AI/server/Edge Functions), thumbnail outfits (no canvas), derive-first/
capture-light, one `index.html` + plain `fetch`. Flag anything that violates them
instead of proposing it.

## Step 4 — Output, in this structure

1. **My mental model of the user** — explicit, stated assumptions.
2. **Executive summary** — top ~10 highest-impact-on-daily-enjoyment improvements.
3. **Immediate improvements** — realistically < 2 hours each.
4. **High-leverage improvements** — more effort, big long-term payoff.
5. **Behavioral predictions** — what they'll forget, procrastinate, avoid, regret not
   tracking, stop using, and the shortcuts they'll crave.
6. **Questions for me** — every place multiple solutions are plausible. For each:
   why it matters + how different answers change the design + your recommended
   default. (See Step 5.)

For each concrete recommendation use: **Issue · Why it matters · Evidence from the
codebase · Proposed solution · Complexity (S/M/L) · Expected QoL improvement ·
Potential downsides.** Apply the full template to the top items; keep the long tail
terser. Prioritize what makes the app feel **faster, lighter, smarter, more
delightful every day.**

## Step 5 — Convert to a decision questionnaire, then stop

End by turning every open design choice into a **grouped questionnaire** the user can
rip through: each question gets options + your **bold recommended default**, so they
can answer "**defaults except…**" and list overrides. Group by theme (e.g. logging,
maintenance, suggestions, derivation). Keep choices mutually exclusive where you can.
Do **not** call AskUserQuestion for the whole review (it caps at 4 and forces choices
prematurely) — a written list is better for a power user; reserve AskUserQuestion for
a genuinely blocking fork.

## Step 6 — Persist the outcome (when decisions land)

Once the user answers, **capture decisions before building** so a fresh session can
execute:
- Add a phase/section to `ROADMAP.md` written execution-ready (locked decisions, any
  **open data-model/schema questions to resolve first**, build order, file-map
  pointers, function/line refs).
- Update the "NEXT UP" pointers in `CLAUDE.md` and the ROADMAP status header.
- Update memory: fold locked decisions + the refined user mental model into
  `wardrobe-product-decisions.md`, and refresh the status lines in
  `wardrobe-app-overview.md` + `MEMORY.md`.
- Note anything **parked by design** (a field/feature the user wants to rethink
  later from real usage) so it isn't half-built.

Then build in a later pass (or when the user says go), smallest keystone first —
usually whatever makes the daily logging loop a ≤1-gesture reflex, since the
analytics depend on it.
