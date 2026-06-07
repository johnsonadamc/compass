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
  **distance from center = how far away** it is. Placement is now computed from
  **real geographic coordinates** relative to the user's real (or fallback)
  location — see "Geolocation & placement" below.
- A **time throttle** at the bottom scrubs through the day (7:00–22:00). As you
  scrub, entities **ignite** when their window opens and **fade to ghosts** when
  it closes. The throttle now **initializes to the real current time** (Central);
  scrubbing thereafter is manual.
- A **day dial** jumps across a rolling 7 days; entities can roam (different
  spots/hours on different days). The 7-day window is now built from the **real
  current date** in Central time — day 0 is genuinely today.
- A **lens** filters by category; matches flare, the rest recede. Categories and
  glyphs were overhauled this cycle (see "Categories & glyphs").
- A **live compass layer** reorients the dial to the device heading (real sensor
  on phones, manual grab-and-spin drag elsewhere). The dial also has
  **flick-to-spin momentum**.
- **Guide Me** navigation homes a chosen entity toward center (currently
  simulated; real version uses GPS `watchPosition`).
- A **watchlist + alerts ledger** tracks starred entities and their next windows.
  This is now a **persisted, cross-mode collection** with a "HAPPENING NOW"
  section — see "Watchlist."

No tabs, no feed, no list. Two core questions map to two gestures: *what do I
want* = set the lens; *when/where can I get it* = scrub the hour / pick the day.

The brand is **OFFLINE** — "get off your phone, here's what's actually happening
around you, right now." **It is live in production at `localoffline.online`**
(domain via Squarespace Domains, hosting via Vercel — see "Deployment").

---

## The platform model (one engine, many lenses)

OFFLINE is **one engine, many lenses (modes)**. A "mode" is a vertical: a
category of located, time-windowed things. The engine (dial, geometry,
time-scrub, compass, nav, watchlist) is shared; each mode supplies its own data,
categories, glyphs, and copy.

**Modes currently implemented:**
- `FOOD` — food trucks. Trucks with weekly recurring schedules.
- `EVENTS` — local events (concerts, markets, classes, comedy, etc.). Dated
  one-off / multi-day occurrences.

**Future modes** (same machinery): happy hours, open houses, markets, live music.

### The MODES array is the single source of truth for navigation
There is a `MODES` array (in `app.jsx`) where each entry is roughly
`{ id, label, sub, throttleLabel }`. The wordmark, the mode menu, and the
throttle label read from it. **Adding a new vertical should be close to: add one
entry to MODES + supply its data/categories/glyphs.** Keep it that way — do not
hardcode "food vs events" logic where a MODES-driven approach works.
NOTE: the per-mode **subtitle line was removed** in the minimization pass (see
"UI minimization"); MODES may still carry a `sub` field but it is no longer
rendered in the header. Don't reintroduce the subtitle.

### How mode switching works (core navigation pattern)
The header wordmark reads `OFFLINE//[MODE]` with a small caret. **Tapping the
wordmark opens a dropdown menu of modes**; selecting one switches mode and closes
the menu. There is no segmented toggle. This tap-the-wordmark-to-switch-lens
pattern is the established navigation for the whole app — preserve and extend it.

### Food and Events are parallel, not merged
Events were added as a **separate, additive code path** — food-mode behavior must
keep working untouched. The clean mechanism is a normalizer (`eventToEntity()` in
`data.jsx`) that converts an event into the same entity shape (`locations[]`,
`recurrence[]`/`occurrences[]`, `cravings[]`, `_event`) the dial/math/watchlist
already understand (the shared date-aware schedule model — see "Schedule model")
— so `field.jsx`, the `window.DYNAMO` math, and the watchlist need no changes.
Prefer this normalize-to-a-common-entity approach for future modes rather than
branching the engine.

---

## Geolocation & placement (SHIPPED — core of the app)

Placement is now **real geography**, not hardcoded relative coordinates.

- Each location (truck `locations[]` entry, event `location`) carries a
  **`latLng: { lat, lng }`**. Bearing and distance are **computed at runtime**
  from the user's position to each entity via haversine (`haversineMi`) + a
  bearing formula (`geoBearing`) on `window.DYNAMO`.
- `planFor(truck, day, userLat, userLng)` computes bearing/dist from geo when a
  real position + `latLng` are present, and **falls back to stored estimated
  `bearing`/`dist`** when they aren't. This keeps the engine backward-compatible.
- **City config:** `CITIES` (in `data.jsx`) is a named map keyed by city, each
  `{ label, hubLabel, timezone, center: {lat,lng} }`, with a `DEFAULT_CITY`
  (currently `pensacola`). The anchor (`center`) doubles as the fallback location
  and the origin used to derive seed `latLng`s. **Adding a market = add a CITIES
  entry.** Don't hardcode Pensacola anywhere else.
- **Seed coordinates are DERIVED from the old estimated bearing/dist around the
  anchor** (destination-point formula), and labeled in comments as
  `DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded
  coordinates`. They are NOT verified addresses. Real entities must get real
  geocoded `latLng`s (right-click in Google Maps → copy coords; no API needed).
- **User location is requested on a deliberate tap of the YOU hub** (NOT on page
  load — auto-request was unreliable on mobile). The hub is a `<button>`; its
  pointer/touch-down handlers `stopPropagation()` so tapping it doesn't start a
  dial drag. The tap requests BOTH geolocation and device-orientation (compass).
- **Fallback when location is denied/unavailable:** silently center on the city
  anchor; the app never blanks. The YOU hub shows **"YOU"** when a real position
  is active, and the anchor's `hubLabel` (e.g. "GARDEN & PALAFOX") plus a small
  "TAP TO LOCATE" invite when position is the fallback. (The label swap replaced
  an earlier crowded "EST POS"/"APPROX" indicator.)
- **Rim radius** is a single configurable constant `DEFAULT_RIM_MI` (currently
  **5 miles**) — the source of truth for the default zoom range; pinch-zoom
  bounds scale proportionally. No auto-scaling. Change this one constant to
  retune. (Note: seed entities cluster near center at 5mi because they're all
  close together; this resolves with real, spread-out coordinates.)
- Requires HTTPS (Vercel provides it). iOS Geolocation + DeviceOrientation both
  require HTTPS and the orientation permission must be requested from a user
  gesture (the hub tap satisfies this).

## Live compass (SHIPPED)

- Tapping the YOU hub (or the compass chip) activates live mode: the dial rotates
  to the device heading. iOS uses `webkitCompassHeading` (true north). Android
  uses `deviceorientationabsolute` (absolute/magnetic north) when available,
  falling back to relative `deviceorientation` `alpha`.
- iOS requires `DeviceOrientationEvent.requestPermission()` called synchronously
  within the tap handler — preserved.
- **Listener teardown:** the orientation handler references are stored in a ref
  and removed (with the matching capture flag) on toggle-off, so switching back
  to "manual" truly stops sensor tracking. (Earlier bug: manual never stopped the
  compass because the listener was never removed. Fixed — do not regress.)
- The **compass chip** remains the live↔manual toggle after activation.
- Manual grab-and-spin still works where there's no sensor, and has
  **flick-to-spin momentum** (a hard flick coasts ~3–4s then settles; tuning
  constants for friction/max-velocity/threshold are isolated). Live compass
  overrides/cancels any active momentum (sensor wins).
- **Emblems rotate live during a spin** (a `spinning` class drops the emblem
  `left`/`top` CSS transition during flick/compass so circles track with labels
  instead of snapping into place on stop).

## Real date & time (SHIPPED — replaces the old fixed-date prototype)

The old prototype pinned a fake date ("Tuesday the 23rd"). It now uses **real
current date + time in Central (America/Chicago)** regardless of device timezone:

- Timezone is read from `CITIES[DEFAULT_CITY].timezone`. `nowInCity(tz)` uses
  `Intl.DateTimeFormat` with the IANA zone to get correct wall-clock date/hour in
  Central (DST handled by the browser's IANA database).
- `DAYS[]` is rebuilt from the real Central date with calendar-correct math
  (`new Date(y, m-1, d+n)`), so month boundaries and weekday labels are correct.
  Day 0 = real today. **Each `DAYS[]` entry carries `iso` (`"YYYY-MM-DD"`, built by
  `isoOf()` from local getters — NOT `toISOString()`, which is UTC and rolls the
  date) and `wd` (real `getDay()` weekday 0=Sun…6=Sat). These are what `planFor`
  matches schedule data against.**
- **Schedule data binds to REAL dates, not weekday slots** (this replaced the old
  `week[]`/`WEEK_OFFSET`/`AUTHOR_BASE_WD` Tuesday-baseline machinery, now retired —
  see "Schedule model" below). `planFor(entity, day, …)` resolves `DAYS[day]` → its
  `iso`/`wd`, matches an explicit dated `occurrences[]` row first, else a weekly
  `recurrence[]` pattern, and returns the **same** `{open, close, name, bearing,
  dist} | null` contract — so `powerAt`/`statusAt`/`bodyPos`/`upcomingWindows`,
  `field.jsx`, and the cards are unchanged.
- The throttle **initializes** to the real Central hour (rounded to nearest
  quarter-hour, clamped to 7–22). It does **not** tick in real time — real time
  only seeds the initial handle position; scrubbing is manual thereafter.
- The watchlist "HAPPENING NOW" section reads the **real current hour**
  (`DYNAMO.realNowHour`), NOT the scrubbed throttle `t` — so it reflects what's
  actually live now even if the user scrubs the dial elsewhere. (Intentional
  divergence: the dial is exploratory; the watchlist is "what can I catch.")

**Load-order caution (learned the hard way):** `data.jsx` runs first and computes
the date/city machinery at module-load time. A forward reference there (using a
`const` before its declaration) throws during parse, which prevents
`window.DYNAMO` from being assigned, which black-screens the whole app. Keep
declaration order correct in `data.jsx`: format helpers (incl. `isoOf`) →
CITIES/DEFAULT_CITY → constants → `nowInCity` → cityNow/todayHour/realNowHour →
DAYS → geo math → TRUCKS → `planFor`/`windowTimes`.

## Schedule model (date-aware occurrence/recurrence — SHIPPED, replaced week[]/WEEK_OFFSET)

Trucks and events now share ONE date-aware schedule model; the old positional
`week[]` array, the `e()` helper, `occurrences[].dayIdx`, `WEEK_OFFSET`, and
`AUTHOR_BASE_WD` are **all retired**. Each entity (truck, and event after
`eventToEntity`) carries:
- `locations: [{ name, bearing, dist, latLng }]` — unchanged shape.
- `occurrences: [{ date:"YYYY-MM-DD", start, end, loc }]` — explicit dated
  appearances. A one-off **self-expires** once its date falls behind day 0, and an
  explicit occurrence on a date **overrides** recurrence for that date.
- `recurrence: [{ weekdays:[…], start, end, loc, from?, until? }]` — weekly
  patterns, optionally bounded by inclusive `from`/`until` ISO dates.
- `exceptions: ["YYYY-MM-DD"]` — dates on which a matching recurrence is
  **cancelled**. Exceptions suppress recurrence ONLY; an explicit occurrence on the
  same date still wins.
- `loc` indexes `locations[]` (default 0); `start`/`end` are decimal hours.

**WEEKDAY CONVENTION: JS `Date.getDay()` — 0=Sun, 1=Mon, …, 6=Sat.** Every
`recurrence[].weekdays` number uses this scale; it's documented loudly at the top of
`data.jsx`. Do not reintroduce a Tuesday-baseline or any other offset.

`planFor` does date matching at **render time** (no load-time expansion loop). The
throttle's snap points come from `DYNAMO.windowTimes(entity)` (collects every
occurrence/recurrence start/end) so `app.jsx` never reads the model shape directly.
The seed trucks/events are genuinely recurring, so they carry `recurrence` only (no
fabricated calendar dates); real dated one-offs land as `occurrences[]` later.

---

## Categories & glyphs (OVERHAULED this cycle)

The old craving/event categories were replaced with a finalized taxonomy, and 14
new custom Art Deco line-art glyphs were installed.

**FOOD cravings (id "label"):** `tacos` "Tacos / Handhelds" · `burgers`
"Burgers / BBQ" · `asian` "Asian" · `seafood` "Seafood" · `sweets`
"Sweets / Treats" · `coffee` "Coffee / Drinks" · `global` "Global / Other" —
plus ALL (default lens).

**EVENTS categories:** `music` "Music / Live" · `markets` "Markets" · `arts`
"Arts / Culture" · `classes` "Classes / Workshops" · `comedy` "Comedy" ·
`nightlife` "Nightlife" · `kids` "Kids / Family" — plus ALL (default lens).

- ALL is the default lens on load in both modes.
- **Glyphs:** 14 custom glyphs keyed by the ids above, monochrome SVG line art on
  a 48×48 viewBox, stroke-width 2.4, round caps/joins, using `currentColor` so
  they inherit CSS-variable theming (cream on chips, dark over the vermillion
  active blip). They live in `glyphs.jsx` via a rendering path **parallel** to the
  pre-existing engine glyphs (old glyphs render as 24×24 filled; do not clobber
  them). Two event ids changed shape from the old set: `market`→`markets`,
  `class`→`classes`.
- The seed entities were remapped onto the new taxonomy (some are loose fits,
  e.g. Nashville-hot-chicken → `burgers`) — acceptable because the seed is
  throwaway and will be replaced by real data.

## UI minimization (SHIPPED)

A deliberate declutter pass for the instrument aesthetic:
- Removed the per-mode subtitle line ("SET THE HOUR. FIND THE FOOD." etc.).
- Removed the "FILTER" text label from the lens strip — glyphs stand alone; the
  active filter name still surfaces on selection.
- Watchlist tab decluttered: the separate live dot was merged into the **count
  badge, which pulses (in `--blue`) when a saved item is currently live**.

## Watchlist (SHIPPED — persisted, cross-mode)

- **Persisted** to `localStorage` under a versioned key (`offline.watchlist.v1`);
  reads/writes wrapped in try/catch (corrupt/unavailable storage → empty, never
  throws). No user accounts — per-device by design.
- **Cross-mode collection**, grouped by type, current mode's group on top; saved
  refs resolve to live entity data each open (no frozen snapshots).
- **"HAPPENING NOW"** section at the top surfaces saved items currently within an
  open window (uses real current hour, not the scrubbed `t`). Shows all qualifying
  items regardless of confidence.
- The star on each card adds/removes; the ledger opener carries the pulsing live
  badge.
- NOTE: there is **no confidence field on entity data yet** — the data-honesty
  ladder (confirmed/scheduled/likely/unverified) is a principle but not a wired
  field. The watchlist currently shows items without a confidence label. Adding
  the field is the natural next step once real data lands (see roadmap).

---

## Deployment & workflow (how this repo is actually operated)

- **Live in production at `localoffline.online`** (apex + `www`). Domain
  registered at **Squarespace Domains**; hosted on **Vercel**, which auto-deploys
  the **`main`** branch on every push. DNS: apex A record + `www` CNAME to the
  Vercel-provided target (Squarespace Defaults preset was removed). SSL is
  auto-provisioned by Vercel.
- **GitHub (`johnsonadamc/compass`) is the single source of truth.** Three copies
  sync only through it: Claude Code's sandbox (pushes), the user's Codespaces
  (pulls/tests), and Vercel (deploys `main`).
- **Branch model:** `main` = live/published, **sacred — only receives tested work
  via merge, never direct commits** (a push to `main` deploys to the public domain
  instantly). Work happens on a **per-session feature branch**; Claude Code's web
  sessions tend to spin up a fresh branch each time (e.g. `claude/...`). That's
  fine **as long as the branch was created from current `main`** — every session
  should verify with `git log HEAD..origin/main --oneline` (must be empty). The
  most recent work branch was `claude/pensive-johnson-uiOh7`.
- **The standard loop:** Claude Code builds on the branch → pushes → user pulls in
  Codespaces (`git checkout <branch> && git pull`) and tests
  (`python3 -m http.server 8000`, hard-refresh, BOTH modes, real phone for
  sensor/safe-area) → user merges to `main` (`git checkout main && git pull &&
  git merge <branch> && git push`) → Vercel auto-deploys → user returns Codespaces
  to `main`. Vercel **branch previews** let the user test a branch on a real phone
  before merging, without touching `main`.

## CRITICAL verification reality (do not skip)

**Claude Code's sandbox CANNOT load the app** — the CDN (React/Babel/fonts) is
blocked there, so the page cannot bootstrap. This means Claude Code's "verified"
can only mean *"the logic/static analysis looks right,"* NEVER *"it renders."*
Two black-screen crashes have shipped from reports of success that never loaded
the page. Therefore:
- Claude Code must do whatever static verification it can, then **explicitly state
  it could NOT confirm a clean browser render** and that the user must test.
- It must **never claim the app renders cleanly** without having loaded it.
- The user's Codespaces load is the real gate. **Never merge a commit that touches
  `data.jsx` or core load-time code without loading it in Codespaces first.**
- A runtime error in `data.jsx` (loads first) white/black-screens everything —
  always check the browser console (F12) for the first red error when debugging a
  blank screen.

## Working agreements for Claude Code

- **Read the file before editing.** This doc is intent; source is truth.
- **For changes to core/load-time code or anything risky, work PLAN-FIRST**:
  read everything and report a written plan + open questions before editing.
  (Geolocation, the compass, and the date logic were all done this way and it
  caught real bugs before they shipped.)
- **One concern per commit.** Report branch + new HEAD hash after pushing.
- **Verify-then-report honestly** per the verification-reality section above.
  Never report a clean render you didn't witness. Don't commit test scaffolding
  (`node_modules`, patched servers, screenshots).
- **Preserve:** CSS-variable theming (never hardcode hex), `index.html` script
  load order, the responsive dvh/safe-area/computed-dial-size layout, MODES-driven
  navigation, the capped/swipe-dismiss bottom sheets, the YOU-hub-tap activation
  flow, the compass listener teardown, the real-date logic & the date-aware
  schedule model (occurrences/recurrence; `getDay` 0=Sun weekday convention), and
  food-mode behavior when working on events (and vice versa).
- **Keep the engine/vertical separation** — neutral engine, content in mode
  config; extend via MODES + the normalizer, not by branching the engine.
- **If you cannot push or hit an auth/permissions wall, STOP and tell the user.
  Do NOT read tokens, env vars, or credential files, or try to work around the
  credential boundary.** Commit and report the branch; the user pushes/merges.
- **Don't invent content/data** — entity names/hours/venues/coordinates come from
  the user (ground truth) or are explicitly marked unverified/derived.
- For changes that touch behavior the user cares about (dial feel, radius, naming,
  the no-list constraint, mode navigation), confirm direction first.

---

## Current technical state & conventions

- **No build step.** `index.html` loads React 18 + ReactDOM + Babel standalone
  from CDN, then loads each component as `<script type="text/babel" src="...">`.
  Babel transpiles JSX in the browser. **Load order in `index.html` matters**
  (components are global, not ES modules; later files depend on earlier ones):
  data → glyphs → field → console → sheet → card → eventcard → drawer → app.
  (`sheet.jsx` provides `useSwipeDismiss`; it must load before any sheet consumer.
  `tweaks-panel.jsx` was removed.) New files must be inserted at the right point.
- **Must be served over HTTP** for local dev (`python3 -m http.server 8000`), not
  `file://`. Production is HTTPS via Vercel (required for geolocation/compass).
- **CDN integrity hashes** are on the React/Babel tags; update or remove them if
  you change versions.
- **Styling is one big `<style>` block in `index.html`**, driven by CSS custom
  properties (`--paper`, `--ink`, `--verm`, `--blue`, etc.). **Always theme via
  these variables — never hardcode hex.**
- **Mobile-first responsive web app.** Preserve: `100dvh`/`100vh` fallback,
  `env(safe-area-inset-bottom)` padding + `viewport-fit=cover`, the `.frame-rule`
  inset border, and the **computed dial radius** (sized from available space
  between the measured top zone and the console; cap ~`w*0.46`). Mobile-chrome /
  safe-area behavior can ONLY be verified on a real phone.
- **Storage:** `localStorage` is in use (watchlist persistence). Fine to use for
  last-mode, etc.

## Data model (`data.jsx`)

### Trucks (FOOD mode)
- `TRUCKS[]`: `id`, `name`, `cuisine`, `glyph` (a category glyph id), `price`
  (1–3), `cravings[]` (new taxonomy ids), `signature`, `blurb`, `favorite`,
  `locations[]` (`{ name, bearing°, dist mi, latLng:{lat,lng} }`), and the
  date-aware schedule fields `recurrence[]` / `occurrences[]` / `exceptions[]` (see
  "Schedule model" — weekdays use `getDay` 0=Sun…6=Sat; `start`/`end` decimal
  hours; `loc` indexes `locations[]`). Seed trucks are recurring → `recurrence`
  only, with DERIVED (unverified) `latLng`s.
- `CRAVINGS[]`: filter chips `{ id, label, glyph, tag }`; `tag:null` = ALL.

### Events (EVENTS mode)
- `EVENTS[]`: `id`, `name`, `venue`, `category` (new taxonomy id), `blurb`,
  `price` (string), optional `ticketUrl`, `location` (`{ bearing, dist, latLng }`),
  and the same date-aware schedule fields (`recurrence[]` / `occurrences[]` /
  `exceptions[]`, `getDay` weekday convention). `eventToEntity()` normalizes the
  single `location` into `locations[]` and carries the schedule fields straight
  through into the shared entity shape.
- `EVENT_CATEGORIES[]`: parallel to CRAVINGS, drives the events lens.

### Shared / engine (`window.DYNAMO`)
- Time/date: `nowInCity`, `cityNow`, `todayHour`/`realNowHour`, `DAYS[]` (real
  rolling 7-day window, day 0 = today, Central; each entry carries `iso`/`wd`).
- Geo: `haversineMi`, `geoBearing`, destination-point derivation, `CITIES`,
  `DEFAULT_CITY`, `DEFAULT_RIM_MI`.
- Placement/status: `planFor` (geo-aware, date-aware occurrence/recurrence
  resolver), `windowTimes` (snap-point times), `powerAt`, `statusAt`, `bodyPos`,
  `walkMin`, `upcomingWindows`, plus format/math utils.

---

## Data honesty (load-bearing product principle)

Real-world location/hours data decays fast and public sources are unreliable. The
product **shows confidence rather than faking certainty**: confirmed / scheduled /
likely / unverified. Never present an unverified guess as fact. **Don't invent
data** — names, hours, venues, coordinates come from the user (ground truth) or
are explicitly marked unverified/derived. Seed data is real-ish but its hours and
DERIVED coordinates are NOT confirmed and are labeled as such.

The planned real-data pipeline (not built): trucks/venues self-report via SMS →
AI parses freeform texts into structured occurrences → confidence labels →
optional community confirmation. The events vertical is more tractable because
event data is more public/stable and an aggregator already compiles it weekly;
the intended path is partnering with that aggregator, not scraping.

---

## Roadmap / open work

**Immediate next (highest leverage):**
- **Get real, verified data in.** The engine is fully real (placement, time,
  glyphs); the *data* is still derived/estimated seed. Entering even a few real
  trucks/events with real geocoded `latLng`s and real hours is the make-or-break
  step and the first true test of the premise. (Founder task; then a Claude Code
  prompt to add the structured entries.)
- **Confidence field.** Add confirmed/scheduled/likely/unverified to entity data
  and surface it (esp. in the card and the watchlist "HAPPENING NOW"). Hollow
  without real data; do it alongside/after the first real entries.

**Other open items:**
- Real GPS for Guide Me (`watchPosition`).
- Rush heat-band on the throttle (peak hours).
- Graceful empty states when few entities are open.
- Closed entities hint their next opening rather than only ghosting.
- Revisit `DEFAULT_RIM_MI` (5mi) once real spread-out coordinates exist.
- Data should eventually live outside `data.jsx` (a JSON file, then the SMS/
  aggregator pipeline) — editing code to change a truck's hours doesn't scale.
- PWA / Add to Home Screen (prerequisite for any real push notifications).
- A favicon (currently 404s — harmless).
- Eventual: Vite + React migration (off in-browser Babel); `window.DYNAMO`
  rename to a neutral name. Each as its own isolated, confirmed commit.