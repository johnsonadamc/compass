# CLAUDE.md

Context for Claude Code working in this repository. Read this first, then read
the actual source files before editing — this document gives intent and
conventions; the files are ground truth for current behavior.

---

## What this is

**OFFLINE** — a single-instrument discovery app for the local, physical,
time-windowed world. The whole UI is one circular **radar/compass dial**:

- **You** are at the center.
- **Entities** are placed around you: **angle = compass bearing** to the thing,
  **distance from center = how far away** it is.
- A **time throttle** at the bottom scrubs through the day (7:00–22:00). As you
  scrub, entities **ignite** when their window opens and **fade to ghosts** when
  it closes.
- A **day dial** jumps across a rolling 7 days; entities can roam (different
  spots/hours on different days).
- A **lens** filters by category; matches flare, the rest recede.
- A **live compass layer** reorients the dial to the device heading (real sensor
  on phones, manual grab-and-spin drag elsewhere).
- **Guide Me** navigation homes a chosen entity toward center (currently
  simulated; real version uses GPS `watchPosition`).
- A **watchlist + alerts ledger** tracks starred entities and their next windows.

No tabs, no feed, no list. Two core questions map to two gestures: *what do I
want* = set the lens; *when/where can I get it* = scrub the hour / pick the day.

The brand is **OFFLINE** — "get off your phone, here's what's actually happening
around you, right now." The name is settled. Domain: a single root (TBD at
launch, e.g. an `offline.*`); verticals live underneath as paths or subdomains —
never a domain per vertical.

---

## The platform model (important — this is now real, not hypothetical)

OFFLINE is **one engine, many lenses (modes)**. A "mode" is a vertical: a
category of located, time-windowed things. The engine (dial, geometry,
time-scrub, compass, nav, watchlist) is shared; each mode supplies its own data,
categories, glyphs, and copy.

**Modes currently implemented:**
- `FOOD` — food trucks (the original vertical). Trucks with weekly recurring
  schedules.
- `EVENTS` — local events (concerts, markets, classes, comedy, etc.). Dated
  one-off / multi-day occurrences.

**Future modes** (same machinery): happy hours, open houses, markets, live music.

### The MODES array is the single source of truth for navigation
There is a `MODES` array (in `app.jsx`) where each entry is roughly
`{ id, label, sub, throttleLabel }`. The wordmark, the mode menu, the subtitle,
and the throttle label all read from it. **Adding a new vertical should be close
to: add one entry to MODES + supply its data/categories/glyphs.** Keep it that
way — do not hardcode "food vs events" logic where a MODES-driven approach works.

### How mode switching works (core navigation pattern)
The header wordmark reads `OFFLINE//[MODE]` (e.g. `OFFLINE//EVENTS`) with a small
caret. **Tapping the wordmark opens a dropdown menu of modes**; selecting one
switches mode and closes the menu. There is no segmented toggle (it was removed).
This tap-the-wordmark-to-switch-lens pattern is the established, intended
navigation for the whole app — preserve and extend it, don't replace it.

### Food and Events are parallel, not merged
Events were deliberately added as a **separate, additive code path** — food-mode
behavior must keep working untouched. The clean mechanism is a normalizer
(`eventToEntity()` in `data.jsx`) that converts an event into the same entity
shape (`week[]`, `locations[]`, `cravings[]`, `_event`) the dial/math/watchlist
already understand — so `field.jsx`, the `window.DYNAMO` math, and the watchlist
needed no changes. Prefer this normalize-to-a-common-entity approach for future
modes rather than branching the engine.

---

## Legacy naming to clean up

Prototyped as "DYNAMO"; the helper namespace is still `window.DYNAMO`. The app is
now **OFFLINE**. When safe, rename `window.DYNAMO` to something neutral
(`window.ENGINE` / `window.DIAL`) — but it's referenced across every `.jsx` file,
so do it as one deliberate refactor and verify the app loads after. Not urgent.

---

## Current technical state & conventions

- **No build step.** `index.html` loads React 18 + ReactDOM + Babel standalone
  from CDN, then loads each component as `<script type="text/babel" src="...">`.
  Babel transpiles JSX in the browser. Fine for prototyping, not production-grade.
- **Components are global, not ES modules.** Each `.jsx` defines things on the
  global scope / `window`; later files depend on earlier ones. **Load order in
  `index.html` matters.** Current order: data → glyphs → field → console → card →
  eventcard → drawer → app. (The `tweaks-panel.jsx` dev panel was removed.)
  Respect the order; new files must be inserted at the right point.
- **Must be served over HTTP**, not `file://`. Use `python3 -m http.server 8000`.
- **CDN integrity hashes** are on the React/Babel tags; update or remove them if
  you change versions.
- **Styling is one big `<style>` block in `index.html`**, driven by CSS custom
  properties (`--paper`, `--ink`, `--verm`, `--blue`, etc.). **Always theme via
  these variables — never hardcode hex.**
- **Mobile-first responsive web app** (not a fixed phone mockup, not a native
  app). The `.stage` fills the viewport. Key responsive details already in place,
  do not regress them:
  - Uses `100dvh` (with `100vh` fallback) so the stage respects mobile browser
    chrome (Safari's toolbar).
  - Uses `env(safe-area-inset-bottom)` padding so the console clears the iOS home
    bar; `<meta viewport>` includes `viewport-fit=cover`.
  - A thin border (`.frame-rule`) hugs the viewport edge — keep it.
  - The dial radius is **computed from available space** between the measured top
    zone and the console (not a fixed size). Radius cap is ~`w * 0.46`. The top
    elements (header, lens, chips) live in a flowing `.top-zone`; the dial sizes
    into what's left so nothing overlaps.
- **Storage:** `localStorage`/`sessionStorage` are fine in this real repo. Use
  for watchlist persistence, last mode, etc. (watchlist persistence not yet done).

---

## Data model (`data.jsx`)

### Trucks (FOOD mode)
- `TRUCKS[]`: `id`, `name`, `cuisine`, `glyph`, `price` (1–3), `cravings[]`,
  `signature`, `blurb`, `favorite`, `locations[]` (`{ name, bearing°, dist mi }`),
  `week[]` (7 entries, day 0 = today; each `e(locIndex, openHour, closeHour)` or
  `null` for a day off; hours are decimal, e.g. `17.5` = 5:30pm).
- `CRAVINGS[]`: filter chips `{ id, label, glyph, tag }`; `tag:null` = ALL.
- Current seed is a small set of **real Pensacola trucks** (Brown Bagger, MI SU,
  Globetrotter, Flourish, Sut-Shi) with estimated geometry and unverified hours,
  flagged in comments. Don't treat hours/positions as confirmed.

### Events (EVENTS mode)
- `EVENTS[]`: `id`, `name`, `venue`, `category` (one of the EVENT_CATEGORIES),
  `blurb`, `price` (string, e.g. "Free" / "$25"), optional `ticketUrl`,
  location `{ bearing, dist }`, and `occurrences[]` — each
  `{ dayIdx, start, end }` (dayIdx 0–6 into DAYS; decimal hours). One-off events
  have one occurrence; multi-day have several. This replaces the truck
  `week[]`/`locations[]` for events only.
- `EVENT_CATEGORIES[]`: parallel to CRAVINGS — music, market, class, comedy,
  kids, nightlife, arts (+ all). Drives the lens in events mode.
- `eventToEntity()`: normalizes an event into the truck-like entity shape so the
  shared engine renders it unchanged.

### Shared
- `DAYS[]`: rolling 7-day window; day 0 = today (prototype pins a fixed date).
- Helpers on `window.DYNAMO`: `planFor`, `powerAt`, `statusAt`, `bodyPos`
  (`dist` clamped to a ~2-mile rim via `dist/2`), `walkMin`, `upcomingWindows`,
  plus time/format/math utilities. Event equivalents reuse these via the
  normalizer.

**Geometry:** the rim ≈ 2 miles; farther pins to the edge. Service radius / where
"YOU" is centered is still an open product decision — don't hardcode around it.

---

## Design language (keep consistent)

- **Aesthetic:** 1920s–30s Art Deco / machine-age, instrument-like. A precision
  dial, not a cute map.
- **Type:** Archivo Black (`--deco`, display/logo/numerals), Oswald (`--cond`,
  condensed all-caps labels), Josefin Sans (`--sans`, italic serif flavor).
- **Palette (noir default):** near-black ground (`--ink`), warm cream paper
  (`--paper`) for active surfaces, **vermillion** (`--verm`) = primary
  energy/active, **sky blue** (`--blue`) reserved *only* for "watched" items.
- **Wordmark:** `OFFLINE` dominant + `//[MODE]` as a smaller subordinate suffix
  in the accent color, with a caret indicating it's the mode switcher. Uppercase,
  Deco face. Header is kept calm and compact — one primary row (wordmark + live
  count) plus a single quiet subtitle line; avoid reintroducing header clutter.
- **Motion:** swift, diagonal throttle momentum, smooth glides when entities
  move, sonar pulses. Emblems have CSS position transitions — preserve them.
- **Tone:** terse, mechanical, confident. "SET THE HOUR. FIND THE FOOD." /
  "FIND THE FUN." (events). All-caps, clipped.
- **Bottom sheets** (truck card, event card, watchlist ledger) are **capped at
  ~90dvh**, have a visible grip handle, scroll internally via a `.card-body`
  wrapper, and **swipe-down-to-close** from the grip/header. They must NEVER grow
  to full-screen-untappable (that was a freeze bug — see below). Scrim tap also
  closes them.

---

## Data honesty (load-bearing product principle)

Real-world location/hours data decays fast and public sources are unreliable
(we got burned trusting stale web data — even an "available" source described a
venue that didn't exist yet). The product **shows confidence rather than faking
certainty**: confirmed / scheduled / likely / unverified. Never present an
unverified guess as fact. **Don't invent data** — truck/event names, hours,
venues come from the user (ground truth) or are explicitly marked unverified.
Seed data should be real and current, or labeled.

The planned real-data pipeline (not built): trucks/venues self-report via SMS →
AI parses freeform texts into structured occurrences → confidence labels →
optional community confirmation. The events vertical is more tractable because
event data is more public/stable and an aggregator already compiles it weekly;
the intended path is partnering with that aggregator, not scraping.

---

## Known open work / roadmap

**Watchlist redesign (next big design task, discussed, not built):** evolve the
watchlist from "starred items" into the app's cross-mode memory + proactive
layer:
- One saved collection spanning all modes, grouped by type, with the current
  mode's items on top.
- A "HAPPENING NOW NEAR YOU" section surfacing saved items that are live/nearby
  today (proactive when opened; true push needs a later PWA "Add to Home Screen"
  step — a static web app can't push notifications).
- A live badge on the watchlist tab when a saved item is on.

**Other open items:**
- Events filters/glyphs polish; confirm category set feels right.
- Rush heat-band on the throttle (peak hours).
- Graceful empty states when few entities are open.
- Give the YOU hub a tap action (recenter compass / reset zoom).
- Closed entities hint their next opening rather than only ghosting.
- Real GPS for Guide Me (`watchPosition`).
- Watchlist persistence via localStorage.
- Glyph gaps: burger/pizza/global stand-ins still in food seed data.
- Eventual: Vite + React migration (off in-browser Babel); `window.DYNAMO`
  rename. Do each as its own isolated, confirmed commit.

---

## Working agreements for Claude Code

- **Read the file before editing.** This doc is intent; source is truth.
- **After making changes, serve the app and confirm it RENDERS with no console
  errors — in BOTH food and events modes — before reporting success.** (We have
  shipped a black-screen crash because a change was committed without ever
  loading the page. Don't repeat that. A `props is not defined` / similar runtime
  error white/black-screens the whole app.)
- **One concern per commit**, so changes can be tested and reverted in isolation.
- **Preserve:** design tokens (CSS-vars only), load order, the responsive
  dvh/safe-area/computed-dial-size layout, the MODES-driven navigation, the
  capped/swipe-dismiss bottom sheets, and food-mode behavior when working on
  events (and vice versa).
- **Keep the engine/vertical separation** — neutral engine, content in the mode
  config; extend via MODES + a normalizer, not by branching the engine.
- **If you cannot push or hit an auth/permissions wall, STOP and tell the user.
  Do NOT read tokens, env vars, or credential files, or try to work around the
  credential boundary.** Commit and report the branch; the user pushes/merges.
- **Don't invent content/data.** Mark anything unverified.
- For changes that touch behavior the user cares about (dial feel, radius,
  naming, the no-list constraint, mode navigation), confirm direction first.

---

## Workflow notes (how this repo is actually operated)

- The user runs **Claude Code as web sessions**, which work in an isolated
  sandbox checkout. Commits only reach the user after the session **pushes** to
  `origin/<branch>` and the user **pulls** in their Codespace. Always push at the
  end of a session and report the branch + latest commit hash.
- Active work branch: `claude/nice-edison-HQiBz` (or its successor). `main` is the
  baseline — periodically the user merges the work branch into `main` via PR to
  reset a clean baseline. If something looks "reverted to an old version," the
  user is probably just sitting on `main`.
- The user tests in GitHub Codespaces (`git pull` -> `python3 -m http.server 8000`
  -> hard-refresh) and on a real phone via the forwarded `app.github.dev` URL.
  Mobile-chrome/safe-area behavior can ONLY be verified on the real phone.