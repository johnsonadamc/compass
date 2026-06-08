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
  **distance from center = how far away** it is. Placement is computed from
  **real geographic coordinates** relative to the user's real (or fallback)
  location — see "Geolocation & placement."
- A **time throttle** at the bottom scrubs through the day (7:00–22:00). As you
  scrub, entities **ignite** when their window opens and **fade to ghosts** when
  it closes. The throttle **initializes to the real current time** (Central);
  scrubbing thereafter is manual.
- A **day dial** jumps across a rolling 7 days; entities can roam (different
  spots/hours on different days). The 7-day window is built from the **real
  current date** in Central time — day 0 is genuinely today.
- A **lens** filters by category; matches flare, the rest recede.
- A **live compass layer** reorients the dial to the device heading (real sensor
  on phones, manual grab-and-spin drag elsewhere). The dial also has
  **flick-to-spin momentum**.
- **Guide Me** navigation homes a chosen entity toward center (currently
  simulated; real version uses GPS `watchPosition`). **Available on BOTH trucks
  and events.**
- A **watchlist + alerts ledger** tracks starred entities and their next windows.
  A **persisted, cross-mode collection** with a "HAPPENING NOW" section.

No tabs, no feed, no list. Two core questions map to two gestures: *what do I
want* = set the lens; *when/where can I get it* = scrub the hour / pick the day.

The brand is **OFFLINE** — "get off your phone, here's what's actually happening
around you, right now." **It is live in production at `localoffline.online`**
(domain via Squarespace Domains, hosting via Vercel — see "Deployment").

**Load-bearing consequence of the brand:** the app's entire promise is *what's
actually true around you right now*. So "happening now" must never lie — this is
why the live-status logic (see "Live status") is computed against the real clock,
not the exploratory dial scrub. Treat truthfulness of present-tense claims as a
first-class correctness property, not a UI detail.

---

## The platform model (one engine, many lenses)

OFFLINE is **one engine, many lenses (modes)**. A "mode" is a vertical: a
category of located, time-windowed things. The engine (dial, geometry,
time-scrub, compass, nav, watchlist, status) is shared; each mode supplies its
own data, categories, glyphs, and copy.

**Modes currently implemented:**
- `FOOD` — food trucks. Recurring weekly schedules.
- `EVENTS` — local events (concerts, markets, classes, comedy, etc.). Mostly
  dated one-off / multi-day occurrences, some weekly recurrences.

**Future modes** (same machinery): happy hours, open houses, markets, live music.

### The MODES array is the single source of truth for navigation
A `MODES` array (in `app.jsx`), each entry roughly `{ id, label, sub,
throttleLabel }`. The wordmark, mode menu, and throttle label read from it.
**Adding a new vertical should be close to: add one entry to MODES + supply its
data/categories/glyphs.** Don't hardcode "food vs events" logic where a
MODES-driven approach works. NOTE: the per-mode **subtitle line was removed** in
the minimization pass; MODES may still carry a `sub` field but it is no longer
rendered. Don't reintroduce the subtitle.

### How mode switching works (core navigation pattern)
The header wordmark reads `OFFLINE//[MODE]` with a small caret. **Tapping the
wordmark opens a dropdown menu of modes**; selecting one switches mode and closes
the menu. No segmented toggle. Preserve and extend this pattern.

### Food and Events are parallel, not merged
Events were added as a **separate, additive code path** — food-mode behavior must
keep working untouched. The clean mechanism is a normalizer (`eventToEntity()` in
`data.jsx`) that converts an event into the same entity shape (`locations[]`,
`recurrence[]`/`occurrences[]`, `cravings[]`, `_event`) the dial/math/watchlist
already understand (the shared date-aware schedule model — see "Schedule model")
— so `field.jsx`, the `window.DYNAMO` math, the cards, and the watchlist need no
food-vs-events branches. Prefer this normalize-to-a-common-entity approach for
future modes rather than branching the engine. **Pattern proven repeatedly this
cycle:** Guide Me parity and the live-status fix were each done as ONE shared
change that both verticals inherit, by resolving from the mode-correct `entities`
list and the shared engine functions rather than special-casing.

---

## Geolocation & placement (SHIPPED — core of the app)

Placement is **real geography**, not hardcoded relative coordinates.

- Each location (truck `locations[]` entry, event `location`) carries a
  **`latLng: { lat, lng }`**. Bearing and distance are **computed at runtime**
  from the user's position via haversine (`haversineMi`) + a bearing formula
  (`geoBearing`) on `window.DYNAMO`.
- `planFor(entity, day, userLat, userLng)` computes bearing/dist from geo when a
  real position + `latLng` are present, and **falls back to stored estimated
  `bearing`/`dist`** when they aren't. Backward-compatible.
- **City config:** `CITIES` (in `data.jsx`) keyed by city, each `{ label,
  hubLabel, timezone, center: {lat,lng} }`, with a `DEFAULT_CITY` (currently
  `pensacola`). The anchor (`center`) doubles as the fallback location and the
  origin used to derive seed `latLng`s. **Adding a market = add a CITIES entry.**
  Don't hardcode Pensacola anywhere else.
- **Seed coordinates are DERIVED from estimated bearing/dist around the anchor**
  (destination-point formula), labeled `DERIVED FROM ESTIMATED GEOMETRY — not
  verified`. NOT verified addresses. Real entities get real geocoded `latLng`s
  (right-click in Google Maps → copy coords; no API needed).
- **User location is requested on a deliberate tap of the YOU hub** (NOT on page
  load — auto-request was unreliable on mobile). The hub is a `<button>`; its
  pointer/touch-down handlers `stopPropagation()` so tapping it doesn't start a
  dial drag. The tap requests BOTH geolocation and device-orientation (compass).
- **Fallback when denied/unavailable:** silently center on the city anchor; the
  app never blanks. The YOU hub shows **"YOU"** when a real position is active,
  else the anchor's `hubLabel` (e.g. "GARDEN & PALAFOX") + a small "TAP TO LOCATE".
- **Rim radius** is a single constant `DEFAULT_RIM_MI` (currently **5 miles**) —
  the default zoom range; pinch-zoom bounds scale proportionally. No auto-scaling.
  **KNOWN ISSUE (real data exposed it):** a real regional feed spans far wider than
  5 mi — Pensacola-area venues run 6–25 mi (Pace, Milton, Navarre, Perdido, Gulf
  Breeze), so much of a real dataset piles at/over the rim. Retuning this is now a
  live UX decision, not a someday item (see "Roadmap").
- Requires HTTPS (Vercel provides it). iOS Geolocation + DeviceOrientation both
  require HTTPS and the orientation permission must come from a user gesture (the
  hub tap satisfies this).

## Live compass (SHIPPED)

- Tapping the YOU hub (or the compass chip) activates live mode: the dial rotates
  to the device heading. iOS uses `webkitCompassHeading` (true north). Android
  uses `deviceorientationabsolute` when available, falling back to relative
  `deviceorientation` `alpha`.
- iOS requires `DeviceOrientationEvent.requestPermission()` called synchronously
  within the tap handler — preserved.
- **Listener teardown:** orientation handler refs stored in a ref and removed
  (with the matching capture flag) on toggle-off, so switching back to "manual"
  truly stops sensor tracking. (Earlier bug: manual never stopped because the
  listener was never removed. Fixed — do not regress.)
- The **compass chip** is the live↔manual toggle after activation.
- Manual grab-and-spin has **flick-to-spin momentum** (a hard flick coasts ~3–4s;
  friction/max-velocity/threshold constants isolated). Live compass overrides any
  active momentum (sensor wins).
- **Emblems rotate live during a spin** (a `spinning` class drops the emblem
  `left`/`top` CSS transition during flick/compass so circles track with labels).

## Real date & time (SHIPPED — replaces the old fixed-date prototype)

Uses **real current date + time in Central (America/Chicago)** regardless of
device timezone:

- Timezone from `CITIES[DEFAULT_CITY].timezone`. `nowInCity(tz)` uses
  `Intl.DateTimeFormat` with the IANA zone for correct wall-clock date/hour
  (DST handled by the browser's IANA database).
- `DAYS[]` is rebuilt from the real Central date with calendar-correct math
  (`new Date(y, m-1, d+n)`). Day 0 = real today. **Each `DAYS[]` entry carries
  `iso` (`"YYYY-MM-DD"`, built by `isoOf()` from LOCAL getters — NOT
  `toISOString()`, which is UTC and rolls the date) and `wd` (`getDay()`
  weekday, 0=Sun…6=Sat).** These are what `planFor` matches schedule data against.
- The throttle **initializes** to the real Central hour (quarter-hour rounded,
  clamped 7–22). It does **not** tick — real time only seeds the initial handle;
  scrubbing is manual thereafter.
- `realNowHour` (the unclamped real Central hour) is the source of truth for all
  present-tense ("now") claims — see "Live status."

**Load-order caution (learned the hard way):** `data.jsx` runs first and computes
the date/city machinery at module-load time. A forward reference (using a `const`
before its declaration) throws during parse, prevents `window.DYNAMO` from being
assigned, and black-screens the whole app. Keep declaration order correct in
`data.jsx`: format helpers (incl. `isoOf`) → CITIES/DEFAULT_CITY → constants →
`nowInCity` → cityNow/todayHour/realNowHour → DAYS → geo math → TRUCKS →
`planFor`/`windowTimes`/`statusAt`/`liveStatusAt`.

## Schedule model (date-aware occurrence/recurrence — SHIPPED, replaced week[]/WEEK_OFFSET)

Trucks and events share ONE date-aware schedule model; the old positional
`week[]` array, the `e()` helper, `occurrences[].dayIdx`, `WEEK_OFFSET`, and
`AUTHOR_BASE_WD` are **all retired**. Each entity (truck, and event after
`eventToEntity`) carries:
- `locations: [{ name, bearing, dist, latLng }]` — unchanged shape.
- `occurrences: [{ date:"YYYY-MM-DD", start, end, loc }]` — explicit dated
  appearances. A one-off **self-expires** once its date falls behind day 0; an
  explicit occurrence on a date **overrides** recurrence for that date.
- `recurrence: [{ weekdays:[…], start, end, loc, from?, until? }]` — weekly
  patterns, optionally bounded by inclusive `from`/`until` ISO dates.
- `exceptions: ["YYYY-MM-DD"]` — dates on which a matching recurrence is
  **cancelled**. Exceptions suppress recurrence ONLY; an explicit occurrence on the
  same date still wins.
- `loc` indexes `locations[]` (default 0); `start`/`end` are decimal hours.

**WEEKDAY CONVENTION: JS `Date.getDay()` — 0=Sun, 1=Mon, …, 6=Sat.** Every
`recurrence[].weekdays` number uses this scale; documented loudly atop `data.jsx`.
Do not reintroduce a Tuesday-baseline or any offset.

`planFor` resolves `DAYS[day]` → its `iso`/`wd`, matches an explicit dated
`occurrences[]` row first, else a `recurrence[]` pattern (weekday in range, not
excepted), and returns the **same** `{open, close, name, bearing, dist} | null`
contract — so `powerAt`/`statusAt`/`bodyPos`/`upcomingWindows`, `field.jsx`, and
the cards are unchanged. Matching happens at **render time** (no load-time
expansion loop). Throttle snap points come from `DYNAMO.windowTimes(entity)`
(collects every occurrence/recurrence start/end) so `app.jsx` never reads the
model shape directly.

**Modeling notes for authoring real/test data:**
- One window per entity per day. A genuine same-day double-header (e.g. a 10 AM
  AND 2 PM showing) must be **two separate entities** — `planFor` returns the first
  match only.
- The 7:00–22:00 throttle cannot represent past-22:00 windows; late-night events
  (e.g. ending 23:45) are clipped. Extending the throttle toward midnight is an
  open decision (see "Roadmap").

## Live status (SHIPPED — present-tense claims honor the REAL clock, not the scrub)

This was a load-bearing correctness fix. The dial is **exploratory** (scrub to any
hour/day to see what's open), but **present-tense status must never follow the
scrub** — otherwise scrubbing to Saturday 10 AM falsely showed events as
"HAPPENING NOW." Two ideas were untangled and must stay untangled:

- **Exploratory state (follows the SCRUB — KEEP):** the emblem **lit vs ghost**
  on the dial, the card's neutral **schedule info**, and the header **count** all
  reflect the scrubbed `(t, day)`. This is correct: "what's open if I look at
  Saturday 6 PM."
- **Live "now" claims (follow the REAL clock — day 0 + `realNowHour` ONLY):**
  - The card status **wording** ("HAPPENING NOW" / "ENDING SOON" / etc.) and the
    vermillion **`.on` badge/status** treatment.
  - The dial's blue **`emblem-ping` pulse** — note this pulse is gated on
    **(facing direction) AND (live now)**; it pings only when an emblem is live on
    the real clock AND within the ~22° arc you're currently facing. (The
    facing-direction geometry is a separate, correct feature — do not touch it.)
  - The header "OPEN/ON NOW" wording — the word **"NOW" appears only** when
    viewing the real today at the real hour; otherwise it reads the viewed hour
    (e.g. "OPEN 6P"). The count itself stays scrubbed (exploratory readout).

The single shared rule lives in `data.jsx`:
```js
function liveStatusAt(entity, day) {
  if (day !== 0) return null;            // not the real today → no live claim
  return statusAt(entity, realNowHour, 0); // real clock, real today
}
```
`null` ⇒ the consumer shows **neutral schedule text** (e.g. "SAT · 6:00p–10:00p",
or "NOT SCHEDULED SAT"), never a live claim and never a blank line. The cards, the
watchlist "HAPPENING NOW", the live badge pulse, and the emblem ping all key off
this same `realNowHour` + day-0 predicate, so FOOD and EVENTS behave identically by
construction. **Food and event status thresholds were unified** onto the shared
`statusAt` tokens (the old bespoke event cutoffs are gone). When touching status,
preserve: (1) lit/ghost + schedule info stay scrubbed; (2) all "now" claims stay
real-clock; (3) one shared path, no food-vs-events branch.

---

## Categories & glyphs (SHIPPED)

Finalized taxonomy + 14 custom Art Deco line-art glyphs.

**FOOD cravings (id "label"):** `tacos` "Tacos / Handhelds" · `burgers`
"Burgers / BBQ" · `asian` "Asian" · `seafood` "Seafood" · `sweets`
"Sweets / Treats" · `coffee` "Coffee / Drinks" · `global` "Global / Other" —
plus ALL (default lens).

**EVENTS categories:** `music` "Music / Live" · `markets` "Markets" · `arts`
"Arts / Culture" · `classes` "Classes / Workshops" · `comedy` "Comedy" ·
`nightlife` "Nightlife" · `kids` "Kids / Family" — plus ALL (default lens).

- ALL is the default lens on load in both modes.
- **Glyphs:** 14 custom glyphs keyed by the ids above, monochrome SVG line art on
  a 48×48 viewBox, stroke-width 2.4, round caps/joins, using `currentColor`. They
  live in `glyphs.jsx` via a path **parallel** to the pre-existing engine glyphs
  (old glyphs render 24×24 filled; do not clobber them). Two event ids changed
  shape from the old set: `market`→`markets`, `class`→`classes`.

## UI minimization (SHIPPED)

- Removed the per-mode subtitle line.
- Removed the "FILTER" text label from the lens strip — glyphs stand alone; the
  active filter name still surfaces on selection.
- Watchlist tab: the live dot merged into the **count badge, which pulses (in
  `--blue`) when a saved item is currently live**.

## Card title / dial label casing (SHIPPED)

Event names render **ALL CAPS** to match trucks. Mechanism: **trucks store their
names uppercase in the data; events store names natural-case and are uppercased via
CSS.** A `.ev-name` class on the event card title applies `text-transform:
uppercase` (the shared `.card-name` rule is untouched), and the dial labels apply
the same. Event data stays natural-case (better for the watchlist / off-dial text).
**Convention going forward:** keep event names natural-case in data; let CSS
capitalize. (Minor latent inconsistency: trucks are uppercase-in-data, events are
CSS-uppercased — a trivial future cleanup is to store ALL names natural-case and let
CSS capitalize both. Not worth chasing now.)

## Watchlist (SHIPPED — persisted, cross-mode)

- **Persisted** to `localStorage` under `offline.watchlist.v1`; reads/writes in
  try/catch (corrupt/unavailable storage → empty, never throws). No accounts —
  per-device by design.
- **Cross-mode collection**, grouped by type, current mode's group on top; saved
  refs resolve to live entity data each open (no frozen snapshots).
- **"HAPPENING NOW"** section surfaces saved items currently within an open window
  (uses `realNowHour` + day 0 — the canonical live-now rule; see "Live status").
- The star on each card adds/removes; the ledger opener carries the pulsing live
  badge.
- NOTE: **no confidence field on entity data yet** — the data-honesty ladder
  (confirmed/scheduled/likely/unverified) is a principle, not a wired field.
  Adding it is the natural next step once real data lands (see roadmap).

---

## Deployment & workflow (how this repo is actually operated)

- **Live in production at `localoffline.online`** (apex + `www`). Domain at
  **Squarespace Domains**; hosted on **Vercel**, which auto-deploys the **`main`**
  branch on every push. DNS: apex A record + `www` CNAME to the Vercel target.
  SSL auto-provisioned by Vercel.
- **GitHub (`johnsonadamc/compass`) is the single source of truth.** Three copies
  sync only through it: Claude Code's sandbox (pushes), the user's Codespaces
  (pulls/tests), and Vercel (deploys `main`).
- **Branch model:** `main` = live/published, **sacred — only receives tested work
  via merge, never direct commits** (a push to `main` deploys to the public domain
  instantly). Work happens on a **per-session feature branch**; Claude Code's web
  sessions spin up a fresh branch each time (e.g. `claude/...`). Fine **as long as
  the branch was created from current `main`** — every session verifies with
  `git log HEAD..origin/main --oneline` (must be empty). If it's NOT empty, the
  branch is stale: fast-forward/rebase onto `origin/main` before working.
- **The standard loop:** Claude Code builds on the branch → pushes → user pulls in
  Codespaces (`git fetch origin && git checkout <branch> && git pull`) and tests
  (`python3 -m http.server 8000`, hard-refresh, BOTH modes, real phone for
  sensor/safe-area) → user merges (`git checkout main && git pull && git merge
  <branch> && git push`) → Vercel auto-deploys → user confirms with
  `git log --oneline -1 origin/main`. Vercel **branch previews** let the user test a
  branch on a real phone before merging.
- **Each new session starts from a FRESH branch off current `main`.** Don't keep
  stacking new work on an old, already-merged feature branch.

## CRITICAL verification reality (do not skip)

**Claude Code's sandbox CANNOT load the app** — the CDN (React/Babel/fonts) is
blocked, so the page cannot bootstrap. Claude Code's "verified" can only mean
*"the logic/static analysis looks right,"* NEVER *"it renders."* Black-screen
crashes have shipped from reports of success that never loaded the page. Therefore:
- Claude Code does whatever static verification it can (incl. `node --check` on a
  `.js` copy, and — where feasible — loading `data.jsx` in a tiny harness to assert
  resolver behavior; a parity/behavior harness caught real issues this cycle), then
  **explicitly states it could NOT confirm a clean browser render** and that the
  user must test.
- It must **never claim the app renders cleanly** without having loaded it.
- The user's Codespaces load is the real gate. **Never merge a commit that touches
  `data.jsx` or core load-time code without loading it in Codespaces first.**
- A runtime error in `data.jsx` (loads first) white/black-screens everything —
  always check the console (F12) for the first red error when debugging a blank.

## Working agreements for Claude Code

- **Read the file before editing.** This doc is intent; source is truth.
- **For changes to core/load-time code or anything risky, work PLAN-FIRST**:
  read everything and report a written plan + open questions, then STOP and wait
  for approval before editing. (Geolocation, compass, date logic, the schedule
  model, and the live-status fix were all done this way and it caught real bugs —
  e.g. an orphaned `app.jsx` schedule reader and a `hit.close`/`hit.end` typo —
  before they shipped.)
- **One concern per commit.** Report branch + new HEAD hash after pushing.
- **Verify-then-report honestly** per the verification-reality section. Never
  report a clean render you didn't witness. Don't commit test scaffolding
  (`node_modules`, patched servers, screenshots).
- **Preserve:** CSS-variable theming (never hardcode hex), `index.html` script
  load order, the responsive dvh/safe-area/computed-dial-size layout, MODES-driven
  navigation, the capped/swipe-dismiss bottom sheets, the YOU-hub-tap activation
  flow, the compass listener teardown, the real-date logic & the date-aware
  schedule model (`getDay` 0=Sun convention), the **live-status rule**
  (`realNowHour`+day-0 for "now" claims; lit/ghost + schedule info stay scrubbed),
  the dial's facing-direction ping geometry, and food-mode behavior when working on
  events (and vice versa).
- **Keep the engine/vertical separation** — neutral engine, content in mode config;
  extend via MODES + the normalizer, not by branching the engine. Resolve from the
  mode-correct `entities` list rather than `window.TRUCKS` where both modes apply.
- **If you cannot push or hit an auth/permissions wall, STOP and tell the user. Do
  NOT read tokens, env vars, or credential files, or work around the credential
  boundary.** Commit and report the branch; the user pushes/merges.
- **Don't invent content/data** — entity names/hours/venues/coordinates come from
  the user (ground truth) or are explicitly marked unverified/derived.
- For changes touching behavior the user cares about (dial feel, radius, naming,
  the no-list constraint, mode navigation, what counts as "now"), confirm direction
  first.

---

## Current technical state & conventions

- **No build step.** `index.html` loads React 18 + ReactDOM + Babel standalone
  from CDN, then loads each component as `<script type="text/babel" src="...">`.
  Babel transpiles JSX in the browser. **Load order in `index.html` matters**
  (components are global, not ES modules; later files depend on earlier ones):
  data → glyphs → field → console → sheet → card → eventcard → drawer → app.
  (`sheet.jsx` provides `useSwipeDismiss`; must load before any sheet consumer.
  `tweaks-panel.jsx` was removed.) New files insert at the right point.
- **Must be served over HTTP** for local dev (`python3 -m http.server 8000`), not
  `file://`. Production is HTTPS via Vercel (required for geolocation/compass).
- **CDN integrity hashes** are on the React/Babel tags; update or remove if you
  change versions.
- **Styling is one big `<style>` block in `index.html`**, driven by CSS custom
  properties (`--paper`, `--ink`, `--verm`, `--blue`, etc.). **Always theme via
  these variables — never hardcode hex.**
- **Mobile-first responsive web app.** Preserve: `100dvh`/`100vh` fallback,
  `env(safe-area-inset-bottom)` padding + `viewport-fit=cover`, the `.frame-rule`
  inset border, and the **computed dial radius** (sized from available space; cap
  ~`w*0.46`). Mobile-chrome / safe-area behavior can ONLY be verified on a phone.
- **Storage:** `localStorage` in use (watchlist). Fine to use for last-mode, etc.

## Data model (`data.jsx`)

### Trucks (FOOD mode)
- `TRUCKS[]`: `id`, `name` (stored UPPERCASE), `cuisine`, `glyph` (a category
  glyph id), `price` (1–3), `cravings[]` (taxonomy ids), `signature`, `blurb`,
  `favorite`, `locations[]` (`{ name, bearing°, dist mi, latLng:{lat,lng} }`), and
  the date-aware schedule fields `recurrence[]` / `occurrences[]` / `exceptions[]`
  (weekdays `getDay` 0=Sun; `start`/`end` decimal hours; `loc` indexes
  `locations[]`). Seed trucks are recurring → `recurrence` only, DERIVED
  (unverified) `latLng`s.
- `CRAVINGS[]`: filter chips `{ id, label, glyph, tag }`; `tag:null` = ALL.

### Events (EVENTS mode)
- `EVENTS[]`: `id`, `name` (stored natural-case; CSS uppercases), `venue`,
  `category` (taxonomy id), `glyph` (category id — required; without it the card
  falls back to the generic glyph), `blurb`, `price` (string), optional
  `ticketUrl`, `location` (`{ bearing, dist, latLng }`), and the same date-aware
  schedule fields. `eventToEntity()` normalizes the single `location` into
  `locations[]`, maps `category` into `cravings:[category]`, and carries the
  schedule fields straight through.
- `EVENT_CATEGORIES[]`: parallel to CRAVINGS, drives the events lens.

### Current data state (IMPORTANT for next steps)
- **Live `EVENTS[]` = 7 throwaway SEED events + 26 estimated real Pensacola
  events** (added this cycle). The 26 are real names/venues/hours but their
  `latLng`s are **ESTIMATED from addresses, labeled UNVERIFIED** (not geocoded),
  and the one-off/monthly ones were **synthetically dated to a test weekend**
  (their dates are not genuine future dates). Recurring ones use truthful weekly
  `recurrence`.
- **The 7 seed events are still present** alongside the 26 (incl. a seed "Palafox
  Market" on a different day than the real one). **Stripping seed events/trucks is
  pending** — pairs naturally with judging dial density and landing real truck data.
- **Trucks are still all seed** (DERIVED coords, recurring). Real truck data is the
  founder's research task; coords/hours/names must come from the user.

### Shared / engine (`window.DYNAMO`)
- Time/date: `nowInCity`, `cityNow`, `todayHour`/`realNowHour`, `DAYS[]` (rolling
  7-day window, day 0 = today, Central; each entry carries `iso`/`wd`).
- Geo: `haversineMi`, `geoBearing`, destination-point derivation, `CITIES`,
  `DEFAULT_CITY`, `DEFAULT_RIM_MI`.
- Placement/status: `planFor` (geo-aware, date-aware occurrence/recurrence
  resolver), `windowTimes` (snap-point times), `powerAt`, `statusAt`,
  `liveStatusAt` (the real-clock/day-0 live rule), `bodyPos`, `walkMin`,
  `upcomingWindows`, plus format/math utils.

---

## Data honesty (load-bearing product principle)

Real-world location/hours data decays fast and public sources are unreliable. The
product **shows confidence rather than faking certainty**: confirmed / scheduled /
likely / unverified. Never present an unverified guess as fact. **Don't invent
data** — names, hours, venues, coordinates come from the user (ground truth) or are
explicitly marked unverified/derived. The 26 real-ish events and all seed data have
UNVERIFIED/DERIVED coordinates, labeled as such.

The planned real-data pipeline (not built): trucks/venues self-report via SMS → AI
parses freeform texts into structured occurrences → confidence labels → optional
community confirmation. The events vertical is more tractable because event data is
more public/stable and an aggregator already compiles it weekly; the intended path
is partnering with that aggregator, not scraping.

---

## Roadmap / open work

**Immediate next (highest leverage):**
- **Get real, verified data in.** The engine is fully real (placement, time,
  glyphs, honest live-status); the *data* is the make-or-break gap. Real food
  trucks (founder research → Claude Code prompt to add entries) and real geocoded
  `latLng`s + real hours are the first true test of the premise.
- **Strip seed data** (7 seed events still mixed with the 26; all seed trucks) —
  small commit; do it alongside landing real data so the dial shows only real
  entities (and judge density honestly).
- **Confidence field.** Add confirmed/scheduled/likely/unverified to entity data
  and surface it (card + watchlist "HAPPENING NOW"). Hollow without real data; do
  it alongside/after the first real entries.

**Surfaced by real data this cycle (now concrete decisions, not someday items):**
- **Label collision / dial density.** With realistic data, dial labels overlap into
  an unreadable smear near the rim. First real instrument-design problem: declutter
  / collision-avoidance / spiral-out / tap-to-disambiguate. Likely highest-value UX
  work once real data lands.
- **`DEFAULT_RIM_MI` (5 mi) retune.** A real regional feed spans 6–25 mi; most
  venues pile at the edge. Decide the default zoom / scaling behavior.
- **Throttle to midnight.** The 7:00–22:00 range clips nightlife (a whole category).
  Extending the upper bound touches the throttle min/max, tick labels, and the
  real-time init clamp — a deliberate engine change, its own commit.

**Other open items:**
- Real GPS for Guide Me (`watchPosition`): live as-the-crow-flies distance that
  shrinks as the user physically moves, no turn-by-turn, until arrival. (Simulated
  parity for events is DONE; this is the real-tracking build — needs a phone to
  test.)
- Rush heat-band on the throttle (peak hours).
- Graceful empty states when few entities are open (real weekend-only data leaves
  weekdays sparse).
- Closed entities hint their next opening rather than only ghosting.
- Data should live outside `data.jsx` (a JSON file, then the SMS/aggregator
  pipeline) — editing code to change hours doesn't scale.
- PWA / Add to Home Screen (prerequisite for real push notifications).
- A favicon (currently 404s — harmless).
- Eventual: Vite + React migration (off in-browser Babel); `window.DYNAMO` rename.
  Each its own isolated, confirmed commit.