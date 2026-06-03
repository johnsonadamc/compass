# CLAUDE.md

Context for Claude Code working in this repository. Read this first, then read
the actual source files before editing — this document gives intent and
conventions; the files are ground truth for current behavior.

---

## What this is

A single-instrument discovery app. The whole UI is one circular **radar/compass
dial**:

- **You** are at the center.
- **Entities** (currently food trucks) are placed around you: **angle = compass
  bearing** to the thing, **distance from center = how far away** it is.
- A **time throttle** at the bottom scrubs through the day (7:00–22:00). As you
  scrub, entities **ignite** when their service window opens and **fade to
  ghosts** when it closes.
- A **day dial** jumps across the next 7 days; entities roam (different
  spots/hours on different days; some go dark on days off).
- A **craving lens** filters by category; matches flare, the rest recede.
- A **live compass layer** reorients the dial to the device heading (real sensor
  on phones, manual drag elsewhere).
- **Guide Me** navigation homes a chosen entity toward center as you walk
  (currently simulated; real version uses GPS `watchPosition`).
- A **watchlist + alerts ledger** tracks starred entities and their next windows.

No tabs, no feed, no list. The two core questions map to two gestures: *what do
I want* = set the lens; *when/where can I get it* = scrub the hour / pick the day.

## The bigger idea (important for how you architect)

Underneath the food-truck skin, this is a **domain-agnostic engine**: it renders
*any entity that has a location and a time window*. Open houses (Sun 1–4),
happy hours, transit departures, live music sets — all the same data shape, the
same dial.

**The intended end state is one engine + thin per-vertical configs**, NOT five
separate apps. When you touch the architecture, bias toward *decoupling the
engine from the food-specific content*:

- The dial, geometry, time-scrub, compass, nav, and watchlist logic are **engine**.
- Trucks, cuisines, glyphs, schedules, and copy are **vertical config / content**.
- `data.jsx` is the seam between them and should evolve toward a clean config
  contract (an array of "entities with location + time-window + category +
  metadata") that any vertical can supply.

Do not scatter food-specific assumptions (the word "truck", "cuisine",
"craving") into the engine layer if it can be avoided. Prefer neutral terms
(entity, category) in engine code; keep food vocabulary in the food config.

## Legacy naming to clean up

The project was prototyped as "DYNAMO" and the helper namespace is still
`window.DYNAMO`. The current working name is **FOOD** (unsettled). When safe,
rename `window.DYNAMO` to something neutral (e.g. `window.DIAL` or
`window.ENGINE`) — but it's referenced across every `.jsx` file, so do it as a
single deliberate refactor, not piecemeal, and verify the app still loads after.

---

## Current technical state & conventions

- **No build step.** `index.html` loads React 18 + ReactDOM + Babel standalone
  from CDN, then loads each component as `<script type="text/babel" src="...">`.
  Babel transpiles JSX in the browser. This is fine for the prototype but slow
  and not production-grade.
- **Components are global, not ES modules.** Each `.jsx` file defines things on
  the global scope (or `window`) and later files depend on earlier ones. **Load
  order in `index.html` matters**: tweaks-panel → data → glyphs → field →
  console → card → drawer → app. Respect it.
- **Must be served over HTTP**, not `file://` (the `text/babel` script loading
  fails on `file://`). Use `python3 -m http.server 8000`.
- **CDN integrity hashes** are present on the React/Babel script tags; if you
  change CDN versions, update the hashes or remove them.
- **Styling is one big `<style>` block in `index.html`**, driven by CSS custom
  properties (`--paper`, `--ink`, `--verm`, `--blue`, etc.). Palettes are class
  variants on `.stage` (`.pal-noir`, `.pal-blueprint`). **Always theme via these
  CSS variables — never hardcode hex colors in components.**
- **Storage:** the prototype avoided browser storage because of the artifact
  sandbox. In this real repo, `localStorage`/`sessionStorage` are fine — use
  them for watchlist persistence, last-used palette, etc.

## First production task (recommended)

Migrate from in-browser Babel to **Vite + React** (keeps the same component code,
adds a real dev server, fast HMR, and a production build) — without changing the
visual output or design. Then proceed with feature work. Confirm with the user
before doing this, and do it as its own commit so there's a clean before/after.

---

## Data model (`data.jsx`)

This is the content + math layer and the future config seam. Current schema:

- `TRUCKS[]` — each truck has:
  - `id`, `name`, `cuisine`, `glyph` (key into the glyph set), `price` (1–3 tier)
  - `cravings[]` (category tags), `signature`, `blurb`, `favorite`
  - `locations[]` — named stops, each `{ name, bearing (compass °), dist (miles) }`
  - `week[]` — 7 entries, day 0 = today. Each is `e(locIndex, openHour, closeHour)`
    or `null` for a day off. `open`/`close` are decimal hours (e.g. `17.5` = 5:30pm).
- `CRAVINGS[]` — filter chips `{ id, label, glyph, tag }`; `tag:null` = "ALL".
- `DAYS[]` — the 7-day window; day 0 is "today" (prototype pins today = Tue 23rd).
- Helpers on `window.DYNAMO`: `planFor`, `powerAt` (0–1 ignite ramp over a
  window), `statusAt` (off/soon/opening/open/closing/closed), `bodyPos`
  (bearing+dist → x/y on the field; **`dist` is clamped to a 2-mile rim** via
  `dist/2`), `walkMin`, `upcomingWindows`, plus time/format/math utilities.

**Geometry note:** the dial rim represents ~2 miles. Anything farther pins to the
edge (misleading). The "service radius / where is YOU centered" is an unresolved
product decision — don't hardcode assumptions around it; the map-scale zoom
already varies the rim distance.

**Permanent vs. roaming entities** both model cleanly: a permanent resident has
one `locations[]` entry repeated every day; a roamer has multiple and the `week`
points at different ones per day. The roaming case is what the dial is *for*.

---

## Design language (keep this consistent)

- **Aesthetic:** 1920s–30s Art Deco / machine-age, instrument-like. A precision
  dial, not a cute map. Bold, geometric, confident.
- **Type:** Archivo Black (Deco display — logo, big numerals), Oswald (condensed
  grotesque — labels, all-caps, wide letter-spacing), Josefin Sans (italic serif
  flavor text). Defined as `--deco`, `--cond`, `--sans`.
- **Palette (default "noir"):** near-black ground (`--ink`), warm cream "paper"
  (`--paper`) for active/selected surfaces, **vermillion** (`--verm`) as the
  primary energy/active color, **sky blue** (`--blue`) reserved *only* for
  "watched" items. Don't spend blue on anything else.
- **Motion:** streamlined and swift — diagonal momentum on the throttle, smooth
  glides when entities roam between days, sonar-style pulses. Deco speed-line
  energy. Emblems already have CSS position transitions so they glide on zoom/day
  changes — preserve that.
- **Tone of voice:** terse, mechanical, confident. "SET THE HOUR. FIND THE FOOD."
  "PLAN THE DAY." "SERVICE HOUR." "GUIDE ME HERE." All-caps, clipped.

If you build new UI, match these tokens and this voice. When in doubt, fewer
words, more instrument.

---

## Data honesty (a product principle, not a detail)

Real-world location/hours data for this kind of entity is unreliable and decays
fast. The product **shows its confidence rather than faking certainty**:
confirmed / scheduled / likely / unverified. Build features that surface and
respect confidence; never present an unverified guess as fact in the UI. (This
principle came from getting burned by stale data — treat it as load-bearing.)

---

## Known open work (not yet built)

Design ideas already discussed, roughly in priority order:

1. **Rush heat-band** along the hour throttle showing peak open hours.
2. **Graceful empty states** when few/no entities are open (a quiet nudge +
   ghost preview of what's coming, instead of a dead dial).
3. **Give the YOU hub a tap action** (recenter compass / reset zoom to 2mi).
4. **Closed entities hint their return** — a dimmed truck shows a tick for its
   next opening, instead of only ghosting.
5. **Per-category color tinting** of glyphs so the field reads as a constellation
   of types (trades against strict Deco restraint — a taste call).
6. **Real GPS** — replace the simulated "Guide Me" walk with `watchPosition`;
   the UI shouldn't need to change.
7. **Watchlist persistence** via localStorage.
8. **Glyph set gaps:** burger, pizza, and a "global/street food" glyph are
   needed (currently reusing `drum`/`bao` as stand-ins in the seed data).

---

## Working agreements for Claude Code

- **Read the file before editing it.** This doc is intent; the source is truth.
- **Preserve the design tokens and load order.** Theme via CSS variables only.
- **Keep the engine/vertical separation in mind** on every structural change.
- **One concern per commit**, especially the Vite migration and the DYNAMO
  rename — keep them isolated and verify the app still loads after each.
- **Don't invent content/data.** Truck names, hours, and locations come from the
  user (ground truth) or are explicitly marked unverified. Don't fill gaps with
  plausible-sounding guesses.
- When a change spans behavior the user cares about (radius, naming, the no-list
  constraint), confirm direction before large refactors.