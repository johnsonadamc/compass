# CLAUDE.md

Context for Claude Code working in this repository. Read this first, then read the
actual source files before editing — this doc gives intent and conventions; the
files are ground truth. **Business/strategy context lives in a separate `STRATEGY.md`**
(not needed for most build work).

---

## What this is

**OFFLINE** — a single-instrument discovery app for the local, physical,
time-windowed world. The whole UI is one circular **radar/compass dial**:

- **You** at the center. **Entities** placed around you: angle = compass bearing,
  distance-from-center = how far. Placement is computed from **real geographic
  coordinates** relative to the user's real (or fallback) location.
- A **time throttle** scrubs the day (**7:00–24:00 / midnight**). Entities ignite
  when their window opens, fade to ghosts when it closes. Initializes to the real
  current time (Central); scrubbing thereafter is manual.
- A **day dial** jumps across a rolling 7 days (built from the real Central date;
  day 0 = today). Some modes override this (festival modes — see "Per-mode config").
- A **lens** filters by category; matches flare, the rest recede.
- A **live compass layer** reorients the dial to device heading (real sensor on
  phones, manual grab-and-spin + flick-momentum elsewhere).
- **Guide Me** navigation homes a chosen entity toward center (simulated; real
  version uses GPS `watchPosition`). Works in all modes.
- A **watchlist + alerts ledger** (persisted, cross-mode) with a "HAPPENING NOW"
  section.

No tabs, no feed, no list. *What do I want* = set the lens; *when/where* = scrub the
hour / pick the day.

The brand is **OFFLINE** — "get off your phone, here's what's actually happening
around you, right now." **Live in production at `localoffline.online`** (Squarespace
domain, Vercel hosting — see "Deployment").

**Default landing mode is EVENTS** (`MODES[0].id` — no hardcoded default).

**Load-bearing brand consequence:** the promise is *what's actually true around you
right now*, so "happening now" must never lie — hence the live-status logic runs
against the real clock, not the exploratory scrub. Truthfulness of present-tense
claims is a first-class correctness property.

---

## The platform model (one engine, many modes)

One shared engine (dial, geometry, time-scrub, compass, nav, watchlist, status);
each **mode** (vertical) supplies its own data, categories, glyphs, copy.

**Modes currently implemented (4):**
- `EVENTS` — citywide local events. Default landing. Rolling-7-day, 5 mi rim.
- `FOOD` — food trucks (recurring weekly). Rolling-7-day, 5 mi rim.
- `FESTIVAL` — **STATIC**, a fictional multi-venue downtown festival. The *generic
  multi-venue concept* demo. 3-day dial, 1 mi rim, `festival:true`.
- `NIGHTMOVES` — **Night Moves Music Festival**, a REAL single-grounds, single-day
  festival (real lineup/vendors/site). The *credibility* demo. Single fixed day (no
  day-dial — a static date label instead), 0.25 mi rim, per-mode anchor on the
  festival grounds, `festival:true`.

### MODES array = single source of truth for navigation
`MODES` (in `app.jsx`), each entry roughly `{ id, label, sub, throttleLabel,
rimMi?, cityKey?, festival? }`. The wordmark, mode menu, throttle label, and default
landing all read from it. **EVENTS is `MODES[0]` (default).** Initial state is
`useState(MODES[0].id)` — never reintroduce a hardcoded default. The `sub` field is
carried but **not rendered** (subtitle was removed) — don't reintroduce it.
**Adding a vertical ≈ add one MODES entry + supply data/categories/glyphs.**

### Mode switching
Wordmark reads `OFFLINE//[MODE]` with a caret; tapping it opens a dropdown of modes
(in MODES order), selecting switches + closes. No segmented toggle.

### Modes are parallel, not merged — extend via the normalizer, never branch
Events, then both festival modes, were added as additive paths via a normalizer
(`eventToEntity()` in `data.jsx`) that converts a mode's entity into the **same
shared shape** (`locations[]`, `occurrences[]`/`recurrence[]`, `cravings[]`,
`_event`) the dial/math/watchlist already understand. So `field.jsx`, the
`window.DYNAMO` math, the cards, and the watchlist need **no per-mode branches**.
**Pattern, proven repeatedly:** resolve from the mode-correct `entities` list and the
shared engine functions; fix once, all modes inherit. Guide Me parity, live-status,
card distance/travel-time, the co-location fan, type-color, and music-collapse were
each ONE shared change. **Do not branch the engine on mode id where a shared path
works.** Gate festival-only behavior on the `festival` flag (see below), not string
checks.

---

## Per-mode config (rim, anchor, day model) — SHIPPED

Modes override engine defaults via the MODES entry; the engine **falls back to the
global default** when a mode doesn't specify, so EVENTS/FOOD are unaffected.

- **Rim:** `currentMode.rimMi ?? DEFAULT_RIM_MI` (5 mi). FESTIVAL = 1 mi, NIGHTMOVES
  = 0.25 mi. Pinch-zoom bounds scale proportionally from the active rim.
- **Anchor / center:** `CITIES[currentMode.cityKey || DEFAULT_CITY]`. NIGHTMOVES
  uses `cityKey:"nightmoves"` → centers on the festival grounds (hub label "MARITIME
  PARK") as the GPS-off fallback. **GPS-on still centers on the user** in every mode
  (so on-site, the dial points from where you stand). EVENTS/FOOD/FESTIVAL stay on
  the downtown Pensacola anchor. Timezone is shared Central across all modes.
- **Day model:** EVENTS/FOOD = rolling-7 (`DAYS[]`). FESTIVAL = a 3-day
  `FESTIVAL_DAYS` (computed upcoming Fri/Sat/Sun, evergreen). NIGHTMOVES = a 1-entry
  `NIGHTMOVES_DAYS` (computed upcoming Saturday, evergreen), the day **locked to 0**
  with **no day-dial** — `console.jsx` renders a static date label ("SATURDAY, <date>")
  in the dial's slot when a `dateLabel` prop is present, else the `DayDial`.
- **Festival flag:** `festival:true` on FESTIVAL + NIGHTMOVES. `isFestival =
  !!currentMode.festival` (app) + a `festival` prop (Field) gate the type-color tint,
  the music-collapse, and the ledger day-frame. **A future festival mode = set this
  one flag** (do NOT widen to `mode === "festival" || mode === "nightmoves"`).

**Evergreen dates (festival modes):** festival days are **computed live** from the
real Central date (upcoming Fri/Sat/Sun for FESTIVAL; upcoming Saturday — including
today if today is Saturday — for NIGHTMOVES), via local-getter `isoOf` (never
`toISOString`, which is UTC). Occurrence dates are injected from the computed ISO so
the demos **never expire**. Static date labels are built from fixed weekday/month
arrays (not `toLocaleDateString`).

---

## Geolocation & placement (SHIPPED — core of the app)

Real geography, not hardcoded relative coords.

- Each location carries **`latLng:{lat,lng}`**. Bearing/distance are computed at
  runtime from the user's position via `haversineMi` + `geoBearing` on
  `window.DYNAMO`. `planFor(entity, day, userLat, userLng, days)` computes from geo
  when a real position + `latLng` exist, else **falls back to stored estimated
  `bearing`/`dist`**.
- **`CITIES`** (in `data.jsx`) keyed by city: `{ label, hubLabel, timezone,
  center:{lat,lng} }`, with `DEFAULT_CITY` (`pensacola`) + the per-mode `nightmoves`
  anchor. The `center` doubles as fallback location and the origin for derived seed
  coords. **Adding a market = add a CITIES entry; don't hardcode Pensacola.**
- **Seed/placeholder coords** are DERIVED from estimated bearing/dist around the
  anchor (destination-point formula), labeled `// UNVERIFIED — <address>`. Real
  entities get real geocoded `latLng`s (right-click Maps → copy; no API).
- **Coord state:** trucks + citywide events still carry UNVERIFIED placeholders.
  **The 4 Night Moves venue coords are REAL** (geocoded from the site map +
  satellite): Main Stage `30.403124,-87.217369`; Discovery Stage
  `30.402622,-87.219503`; Food court `30.403427,-87.218951`; Vendor field
  `30.402827,-87.218889`; festival center anchor `30.402925,-87.218259`.

### YOU-hub tap = LOCATION ONLY (iOS two-prompt split — do NOT recombine)
- Location is requested on a deliberate **tap of the YOU hub** (not on load —
  auto-request was unreliable on mobile). Hub is a `<button>`; pointer/touch-down
  handlers `stopPropagation()` so the tap doesn't start a dial drag.
- **The hub tap requests GEOLOCATION ONLY.** Live compass is a SEPARATE gesture on
  the compass chip. They were once one tap, but on iOS the orientation permission
  modal orphaned the pending geolocation prompt (it stuck forever). WebKit's
  transient-activation model forbids two permission modals on one gesture. **A
  reliable two-tap beats an unreliable one-tap — do not recombine.** (Browser-sniffing
  a Chrome one-tap path was considered and rejected.)
- **iOS Safari hub-tap fix (SHIPPED):** the tap needs an explicit `onTouchEnd`
  handler driving activation, because `onTouchStart` `stopPropagation()` under
  `touch-action:none` suppresses iOS's synthesized click. `onTouchEnd` calls the
  handler directly, with a ~700ms timestamp guard (`tapGuardRef`) so Chrome's later
  ghost-click doesn't double-fire. Preserve the `onTouchEnd` path + the guard.
- **getCurrentPosition hardening (SHIPPED):** `{ enableHighAccuracy:false,
  timeout:10000, maximumAge:60000 }`. High-accuracy OFF deliberately (a multi-mile
  radar doesn't need GPS precision; wifi/cell is faster, returns indoors). Finite
  timeout kills the indefinite hang. The error callback is wrapped so a synchronous
  iOS throw still routes to the denied state. **The geolocation error callback must
  ALWAYS exist** — an empty/silent one was the original iOS bug.
- **Fallback when denied/unavailable:** silently center on the (mode's) anchor; the
  app never blanks. Hub shows "YOU" when located, else the anchor's `hubLabel` + "TAP
  TO LOCATE", becoming "LOCATION OFF · TAP TO RETRY" after a denial (`userPos` stays
  null so the anchor fallback holds).
- Requires HTTPS (Vercel provides). iOS geolocation + orientation both need HTTPS;
  orientation permission must come from a user gesture (the chip tap).

## Live compass (SHIPPED)

- **The compass chip activates live mode** (the hub no longer does). Dial rotates to
  device heading. iOS `webkitCompassHeading` (true north); Android
  `deviceorientationabsolute`, falling back to relative `deviceorientation` alpha.
- **Chip pulse cue:** once located but not live, the chip pulses a `--blue` halo
  (shares the `watchtab-pulse` keyframes, refactored to `color-mix(var(--blue))` so
  the watchlist badge + ledger dot palette-track). Stops the instant compass goes
  live. (The old center "TAP ✣ FOR LIVE" text was removed.)
- iOS `DeviceOrientationEvent.requestPermission()` must be called synchronously in
  the tap handler — the chip's own tap is that gesture.
- **Listener teardown:** orientation handler refs stored + removed (with matching
  capture flag) on toggle-off, so "manual" truly stops sensor tracking. Don't regress.
- Manual grab-and-spin has **flick-to-spin momentum** (isolated friction/velocity
  constants). Live compass overrides active momentum (sensor wins). Emblems rotate
  live during a spin (`spinning` class drops the emblem position transition).

## Real date & time (SHIPPED)

Real current date + time in Central (America/Chicago) regardless of device TZ.
`nowInCity(tz)` uses `Intl.DateTimeFormat` with the IANA zone (DST handled).
`DAYS[]` rebuilt from the real Central date, calendar-correct (`new Date(y,m-1,d+n)`),
day 0 = today. Each `DAYS[]` entry carries `iso` (`"YYYY-MM-DD"` via `isoOf()` from
LOCAL getters — NOT `toISOString()`) and `wd` (`getDay()`, 0=Sun). Throttle
initializes to the real Central hour (quarter-hour rounded, clamped 7–24) but does
not tick. `realNowHour` (unclamped real Central hour) is the source of truth for all
present-tense claims.

**Load-order caution (learned the hard way):** `data.jsx` computes date/city/data at
module-load. A forward reference (a `const` used before declaration) throws at parse,
prevents `window.DYNAMO` assignment, and **black-screens the whole app**. Keep
declaration order: format helpers (incl. `isoOf`, weekday/month name arrays) →
CITIES/DEFAULT_CITY → constants → `nowInCity` → cityNow/todayHour/realNowHour → DAYS
→ FESTIVAL_DAYS → NIGHTMOVES_DAYS → geo math → TRUCKS → EVENTS → FESTIVAL → NIGHTMOVES
→ `planFor`/`windowTimes`/`statusAt`/`liveStatusAt`/`isLiveNow` + travel/format
helpers.

## Schedule model (date-aware occurrence/recurrence — SHIPPED)

One shared model. Each entity carries:
- `locations:[{ name, bearing, dist, latLng }]`.
- `occurrences:[{ date:"YYYY-MM-DD", start, end, loc }]` — explicit dated
  appearances; a one-off self-expires past day 0; an occurrence overrides recurrence
  for its date.
- `recurrence:[{ weekdays:[…], start, end, loc, from?, until? }]` — weekly patterns,
  optionally bounded by inclusive `from`/`until`.
- `exceptions:["YYYY-MM-DD"]` — dates a matching recurrence is cancelled (occurrence
  on the same date still wins).
- `loc` indexes `locations[]` (default 0); `start`/`end` are decimal hours.

**WEEKDAY CONVENTION: JS `Date.getDay()` — 0=Sun…6=Sat.** Every `recurrence[].weekdays`
uses this; documented atop `data.jsx`. No Tuesday-baseline / offset.

`planFor` resolves `days[day]` → its `iso`/`wd` (where `days` is the mode's day array
— rolling `DAYS`, `FESTIVAL_DAYS`, or `NIGHTMOVES_DAYS`), matches a dated occurrence
first, else a recurrence, returning `{open, close, name, bearing, dist} | null`.
Matching is at **render time**. Throttle snap points come from
`DYNAMO.windowTimes(entity)`.

**Authoring notes:**
- **One window per entity per day** — `planFor` returns the first match. A same-day
  double-header is **two entities** (why SUT-SHI is Lunch+Dinner, Greek's is two
  locations). *Multi-window-per-day is a deferred engine cycle.* NOTE: festival music
  uses **act-as-entity** (each set is its own single-window entity) which sidesteps
  this entirely — the dial shows one act per stage per moment via the music-collapse
  (see below), so festivals do NOT need multi-window-per-day.
- Throttle now reaches **24:00**; windows past midnight (>24, e.g. a 24.5/25 end)
  remain authored with TRUE end times but their close is unreachable on the throttle
  (benign clip, no error). Past-midnight "now"-attribution is a separate future cycle.

## Live status (SHIPPED — present-tense claims honor the REAL clock, not the scrub)

Load-bearing. The dial is **exploratory** (scrub to any hour/day), but present-tense
status **must never follow the scrub**. Two ideas kept untangled:

- **Exploratory (follows the SCRUB — KEEP):** emblem lit vs ghost, the card's neutral
  schedule info, the header count. "What's open if I look at Saturday 6 PM."
- **Live "now" claims (follow the REAL clock — the day's `today` flag + `realNowHour`):**
  card status wording ("HAPPENING NOW" etc.) + the vermillion `.on` treatment; the
  blue `emblem-ping` (gated on facing-direction AND live-now); the header "NOW"
  word. (The clock-time readout was removed — header reads "2 ON NOW" / "2 ON" /
  "2 OPEN"; the count stays scrubbed.)

The shared rule is centralized as **`isLiveNow(entity, day, days)`** keyed off
`days[day].today` (true only when that day is the real today), replacing the old
inline `day===0 && …` checks across field/cards/header. `liveStatusAt` likewise takes
`days`. `null` ⇒ neutral schedule text, never a live claim, never blank. All modes
behave identically by construction. **When touching status, preserve:** (1) lit/ghost
+ schedule info stay scrubbed; (2) all "now" claims stay real-clock; (3) one shared
path, no per-mode branch. The `isLiveNow`/`liveStatusAt` equivalence to the old inline
logic was proven by harness across all day indices before shipping — preserve it.

## Co-location fan (SHIPPED — multiple entities at the same spot)

When 2+ entities resolve to the same/near-same dial position, they're **fanned by
ANGLE at the same radius** (symmetric about the true bearing, chord-sized step with
`FAN_MIN_STEP`/`FAN_MAX_TOTAL` clamps), then rotated, then a declump safety net runs.
(Root cause it fixed: a degenerate zero-vector declump at identical coords.) Invariants:
- **Render-only.** Touches only the emblem `x/y` (and label). The entity's TRUE
  `bearing`/`dist` (read by cards/travel/Guide Me via their own `planFor`) is
  unchanged. Cards never read `field`'s `x/y`.
- **Angle, not distance** — preserves the true distance ring (card mileage and dial
  agree).
- **Pre-rotation / dial-space** — a fanned cluster rotates as one rigid group.
- **Facing-ping fidelity** — the facing test keys off each emblem's TRUE rotated
  bearing, not the fanned position.
- **Deferred follow-ups:** label de-collision (text labels still smear when circles
  separate) and a spiral/dedupe layout for very dense / near-center clusters.
  **This is now the clearest remaining UX gap, surfaced hard by the dense single-grounds
  NIGHTMOVES data (esp. the vendor cluster at one coord).** See "Roadmap."

## Festival type-color tint (SHIPPED — festival modes only)

In festival modes, entity **type is shown by tinting the GLYPH** (state stays on the
ring). Three theme vars: `--fest-music #79BE6A` (green), `--fest-food #E3B340`
(amber), `--fest-market #AE83D2` (violet) — chosen distinct from each other and from
`--verm`(live) / `--blue`(facing) so type-color never reads as a state-color. Emblem
gets a `.type-<category>` class from the normalized `cravings[0]` tag, gated on
`isFestival`. **State always wins:** the tint is scoped to `.off:not(.ahead)` (a
ghost/closed, non-facing emblem) — the instant an act goes live (verm) or is faced
(blue ping), the state treatment owns the color. Live is never weakened. Tint lives
in the ghost (~0.5 opacity) channel; if it ever reads too muted, lifting *festival
type-ghost* opacity is a separate follow-up (do not touch the universal ghost
treatment). No CSS color outside these vars; no hardcoded hex.

## Festival music-collapse (SHIPPED — festival modes only)

At a shared **music** venue with multiple acts across a night, the dial shows **ONE**
emblem at the current scrub time `t`, swapping as you scrub — NOT all acts fanned.
This is a **render-layer selection** in `field.jsx`, NOT a multi-window engine change
(each act stays its own single-window entity; `planFor`/schedule/live-status
untouched). Per co-located music cluster at `t`:
- an act's window `[open, close)` contains `t` → show that act (its normal state
  treatment), others not drawn;
- else the next act later that day → show it as a **dim next-act ghost** (a SCHEDULE
  hint — neutral/dimmed, NO verm/ping/live badge; it must never route through a live
  path);
- else (after the last act) → show nothing there.
Single-act music venues are unaffected. **Markets and food are EXCLUDED** (they're
simultaneously open → they keep the fan; collapsing would wrongly hide them) — the
collapse is music-type-only, gated on `isFestival`. Window-contains-`t` is a pure
read of the already-resolved `pl.plan` (no engine re-call). Half-open `[open, close)`
prevents double-show at set boundaries. The collapsed emblem's identity **follows the
scrub** — tap/card/star/Guide Me resolve to the shown act by its surviving `id`; the
active Guide Me target (`navId`) is excluded from the collapse so it can't be dropped
mid-homing. **Deferred:** the next-act ghost is currently **nameless** (consistent
with the universal ghost-label rule); giving it a name+time is a separate follow-up
(it's the roadmap's "closed entities hint their next opening" item).

## Card travel time & distance (SHIPPED)

Both cards show distance via the same geo-aware `planFor(entity, day, userPos?.lat,
userPos?.lng)` path (real position when located, else estimate). Renders as
`<miles> mi · <travel estimate>` via `window.DYNAMO`: `driveMin = round(dist/25*60)`
(floored 1); `travelEstimate` ≤1.0 mi → "N min walk", >1.0 → "N min drive";
`fmtMiles` ≥10 → no decimal, else one decimal (applied everywhere mileage renders
except `field.jsx`'s ring-scale formatter). Crow-flies, no routing API.

---

## Categories & glyphs (SHIPPED)

14 custom Art Deco line-art glyphs, monochrome SVG on a 48×48 viewBox, stroke 2.4,
round caps, `currentColor`, in `glyphs.jsx` (parallel to the pre-existing 24×24
filled engine glyphs — don't clobber those). ALL is the default lens in every mode;
lens labels render ALL CAPS via CSS (data stays natural-case).

- **FOOD cravings:** `tacos` `burgers` `asian` `seafood` `sweets` `coffee` `global`
  (+ ALL).
- **EVENTS categories:** `music` `markets` `arts` `classes` `comedy` `nightlife`
  `kids` (+ ALL). (Known strain: 7-category citywide taxonomy is a bit narrow;
  expansion deferred.)
- **FESTIVAL / NIGHTMOVES categories:** `music` `food` `market` (+ ALL) — simpler
  festival taxonomy. Reuse existing glyphs: music→`music`, food→`burgers`,
  market→`markets`. Type-color tint applies (above).

## Event/festival name casing (SHIPPED)

Trucks store names UPPERCASE in data; events/festival names stored natural-case and
uppercased via CSS (`.ev-name` on the card title, same on dial labels). Keep
event/festival names natural-case in data; let CSS capitalize.

## Other shipped UI

- Per-mode subtitle removed; "FILTER" label removed from the lens strip; header
  clock-time readout removed; center "TAP ✣ FOR LIVE" hint removed (chip pulse
  instead). Browser tab `<title>` is just "OFFLINE".
- Truck card SIGNATURE cell is conditional (hidden when no `signature`).
- Watchlist: persisted to `localStorage` (`offline.watchlist.v1`, try/catch, never
  throws); cross-mode, grouped by type, current mode on top; "HAPPENING NOW" uses the
  live-now rule; badge count uses `allWatchedEntities.length` (resolved against live
  entities, so stale ids don't inflate it — don't regress to raw saved-id count).
  NIGHTMOVES + FESTIVAL entities resolve in the ledger.

---

## Deployment & workflow (how this repo is actually operated)

- **Live at `localoffline.online`** (Squarespace domain, Vercel hosting, auto-deploys
  the **`main`** branch on every push; SSL auto).
- **GitHub (`johnsonadamc/compass`) is the single source of truth.** Three copies
  sync only through it: Claude Code's sandbox (pushes), the user's Codespaces
  (pulls/tests), Vercel (deploys `main`).
- **Branch model:** `main` = live, **sacred — only tested work via merge, never
  direct commits** (a push to `main` deploys instantly). Work on a per-session
  feature branch off **current `main`**; verify with `git log HEAD..origin/main
  --oneline` (must be empty; if not, the branch is stale — rebase first).
- **Standard loop:** Claude Code builds on the branch → pushes → user pulls in
  Codespaces (`git fetch origin && git checkout <branch> && git pull`) and tests
  (`python3 -m http.server 8000`, hard-refresh, ALL modes, real phone for
  sensor/safe-area) → user merges. **PREFERRED merge (test-locally-then-push):**
  `git checkout main && git pull && git merge origin/<branch>` → serve & test locally
  → `git push` ONLY if clean → confirm `git log --oneline -1 origin/main`. (Use
  `git merge origin/<branch>` — the remote-tracking ref — not the bare branch name.)
  Delete merged branches (`git branch -d` + `git push origin --delete`).
- **Cache caveat (felt REPEATEDLY this session — it caused a black screen, a
  "missing mode," and a "trim didn't apply" false alarm):** the browser serves stale
  `.jsx`/`index.html` after a deploy, and can serve a fresh `data.jsx` with a stale
  `app.jsx` in the SAME load. **Always test cache-disabled** (DevTools → Network →
  Disable cache, reload with DevTools open) or in an incognito tab. "Works local,
  broken live" is almost always cache. **PWA/cache-busting is a roadmap item that
  would end this** — high value given how often it bit.
- **Codespaces working copy is effectively read-only — do NOT hand-edit files there.**
  A stray keystroke in a file (e.g. `awindow.CITIES`) created a load-breaking typo
  that masqueraded as "the change didn't work." If `git` shows `M <file>` you didn't
  intend, `git diff` it, then `git checkout -- <file>` to discard before pulling.
- **iOS permission caveat:** iOS caches a denied geolocation permission and won't
  re-prompt. Clear the site's location permission to re-test (a stuck permission once
  contaminated debugging — clear it before concluding the code is wrong).

## CRITICAL verification reality (do not skip)

**Claude Code's sandbox CANNOT render the app** — the CDN (React/Babel/fonts) is
blocked, so the page can't bootstrap. "Verified" can only mean *the logic/static
analysis looks right*, NEVER *it renders*. Black-screens have shipped from "success"
reports that never loaded the page. Therefore:
- Do static checks (`node --check` on a `.js` copy of non-JSX files; a `data.jsx`
  harness to assert resolver/date/equivalence behavior — harnesses caught real issues
  repeatedly this session), then **explicitly state you could NOT confirm a clean
  browser render** and the user must test.
- **Never** claim a clean render you didn't witness. The user's Codespaces load is the
  real gate. **Never merge a commit touching `data.jsx` or core load-time code without
  loading it in Codespaces first.** A runtime error in `data.jsx` white/black-screens
  everything — check the console (F12) for the first red error when debugging a blank.
- Note: `node --check` can't parse JSX files (Babel-only) — choking on a `<div>` is
  expected, not a real error.

## Working agreements for Claude Code

- **Read the file before editing.** This doc is intent; source is truth.
- **PLAN-FIRST for core/load-time/risky changes:** read everything, report a written
  plan + open questions, then STOP for approval before editing. This caught real bugs
  repeatedly (the zero-vector declump, the Greek's second-location trap, the iOS
  click suppression, the festival day-dial coexistence, the live-status equivalence).
  Pure data-only edits (e.g. trimming demo entities) don't need PLAN-FIRST but DO need
  a parse check + a guardrail against breaking the array literal.
- **One concern per commit.** Report branch + new HEAD hash after pushing.
- **Verify-then-report honestly.** Never report a render you didn't witness. Don't
  commit test scaffolding.
- **Preserve:** CSS-variable theming (never hardcode hex); `index.html` script load
  order; the responsive dvh/safe-area/computed-dial-size layout; MODES-driven nav +
  EVENTS-default order; the per-mode config pattern (rim/anchor/day via MODES +
  global fallback); the `festival` flag gating (not string checks); the capped/
  swipe-dismiss bottom sheets; the YOU-hub LOCATION-ONLY flow + iOS `onTouchEnd` fix
  + two-prompt split; the compass listener teardown + chip pulse; the real-date logic
  + date-aware schedule model (`getDay` 0=Sun); the **live-status rule** (`isLiveNow`/
  `realNowHour` + the day's `today` flag for "now" claims; lit/ghost + schedule info
  stay scrubbed); the facing-ping geometry + co-location-fan render-only/true-bearing
  invariants; the music-collapse render-layer invariants (selection-only, identity
  follows the scrub, markets excluded, `navId` excluded); the type-color "state wins"
  scoping; the shared travel/distance helpers; evergreen computed festival dates; and
  every other mode's behavior when working on one.
- **Keep engine/vertical separation** — neutral engine, content in mode config;
  extend via MODES + the normalizer, never branch the engine on mode id.
- **If you cannot push or hit an auth/permissions wall, STOP and tell the user. Do
  NOT read tokens/env/credential files or work around the credential boundary.**
- **Don't invent content/data** — names/hours/venues/coords come from the user or are
  marked unverified/derived. EXCEPTION: clearly-labeled fictional demo data (e.g.
  STATIC) may be authored as such; the Night Moves data is REAL and must not be
  altered/invented.
- For changes touching behavior the user cares about (dial feel, radius, naming, the
  no-list constraint, mode nav, what counts as "now"), confirm direction first.

---

## Current technical state & conventions

- **No build step.** `index.html` loads React 18 + ReactDOM + Babel standalone from
  CDN, then each component as `<script type="text/babel" src="...">`. **Load order in
  `index.html` matters** (globals, not ES modules; later depend on earlier): data →
  glyphs → field → console → sheet → card → eventcard → drawer → app. (`sheet.jsx`
  provides `useSwipeDismiss`; must load before sheet consumers.)
- **Serve over HTTP** for local dev (`python3 -m http.server 8000`), not `file://`.
  Production is HTTPS via Vercel (required for geolocation/compass).
- **CDN integrity hashes** on the React/Babel tags; update/remove if versions change.
- **Styling is one big `<style>` block in `index.html`**, driven by CSS custom
  properties (`--paper`, `--ink`, `--verm`, `--blue`, `--fest-music/food/market`,
  etc.). **Always theme via these vars — never hardcode hex.**
- **Mobile-first responsive.** Preserve `100dvh`/`100vh` fallback,
  `env(safe-area-inset-bottom)` + `viewport-fit=cover`, the `.frame-rule` inset
  border, and the computed dial radius (cap ~`w*0.46`). Mobile-chrome/safe-area can
  ONLY be verified on a phone.
- **Storage:** `localStorage` (watchlist). Fine for last-mode, etc.

## Data model (`data.jsx`)

### Trucks (FOOD) — REAL, 8 entities
`TRUCKS[]`: `id`, `name` (UPPERCASE), `cuisine`, `glyph`, `price` (1–3), `cravings[]`,
`signature?`, `blurb`, `favorite`, `locations[]`, schedule fields. The 8: Globetrotter,
Greek's–Hillcrest, Greek's–Pace, Brown Bagger, Mi Su, SUT-SHI (Lunch), SUT-SHI
(Dinner), Flourish Pizza. UNVERIFIED placeholder coords. `CRAVINGS[]` = filter chips
(`tag:null` = ALL).

### Events (EVENTS) — REAL, 30 entities (a weekend)
`EVENTS[]`: `id`, `name` (natural-case), `venue`, `category`, `glyph`, `blurb`,
`price`, `ticketUrl?`, `location`, schedule fields; `eventToEntity()` normalizes.
UNVERIFIED placeholder coords. Some windows run past 22:00 (now mostly reachable with
the 24:00 throttle; a couple end past 24:00 and stay clipped). Data skews to Friday
(Sat/Sun sparse — the "graceful empty states" case). `EVENT_CATEGORIES[]` drives the
lens.

### FESTIVAL (STATIC) — fictional demo, ~23 entities
`FESTIVAL[]` + `FESTIVAL_CATEGORIES[]`, exposed as `window.FESTIVAL` /
`window.FESTIVAL_CATEGORIES`. Multi-venue downtown concept; 3-day `FESTIVAL_DAYS`
(evergreen Fri/Sat/Sun); 1 mi rim. Clearly DUMMY/demo data.

### NIGHTMOVES — REAL, 22 entities (single grounds, single day)
`NIGHTMOVES[]` + `NIGHTMOVES_CATEGORIES[]`, exposed as `window.NIGHTMOVES` /
`window.NIGHTMOVES_CATEGORIES`. Night Moves Music Festival 2025 (Hunter Amphitheater /
Maritime Park). **11 music** (act-as-entity, across Main Stage + Discovery Stage —
the two stages sit on near-opposite dial bearings so the live act ping-pongs as you
scrub), **6 food/drink**, **5 market vendors**. REAL names + REAL coords (4 zone
coords above; food/drink at the food court, vendors at the vendor field — clusters
fanned). Single-day `NIGHTMOVES_DAYS` (evergreen upcoming Saturday), day locked, no
day-dial (static date label). `CITIES.nightmoves` anchor. This is REAL data — don't
alter. (Trimmed from 26 → 22 to reduce dial density; the deeper density fix —
smaller emblems / label de-collision — is deferred.)

### Shared / engine (`window.DYNAMO`)
Time/date: `nowInCity`, `cityNow`, `todayHour`/`realNowHour`, `DAYS`, `FESTIVAL_DAYS`,
`NIGHTMOVES_DAYS`. Geo: `haversineMi`, `geoBearing`, destination-point derivation,
`CITIES`, `DEFAULT_CITY`, `DEFAULT_RIM_MI`. Placement/status: `planFor`, `windowTimes`,
`powerAt`, `statusAt`, `liveStatusAt`, `isLiveNow`, `bodyPos`, `upcomingWindows`.
Travel/format: `walkMin`, `driveMin`, `travelEstimate`, `fmtMiles`.

---

## Data honesty (load-bearing product principle)

Real-world location/hours data decays fast; public sources are unreliable. The product
**shows confidence rather than faking certainty** (confirmed/scheduled/likely/
unverified — a principle, not yet a wired field). **Don't invent data** — except
clearly-labeled fictional demo content (STATIC). Night Moves data is REAL.

**Bearing-error insight (drives geocoding priority):** the same coord error is a tiny
bearing error far away but HUGE up close (a 150m error ≈ 1° at 5 mi but 30–90° two
blocks away). So precision matters MOST for nearby venues — "geocode the coords" is
the *nearby experience*, not cleanup. **This is most extreme at festival scale**
(0.25 mi rim) — which is exactly why the 4 Night Moves venue coords are real.

**Data pipeline (researched):** no clean first-party "events near me" API (Google
structured-data is a publishing schema; Places has no events). SerpApi `google_events`
(scraped, fragile, free tier for one city/week) could seed citywide events but fights
truthfulness (wants the confidence field first). Ticketed APIs (Eventbrite/Ticketmaster)
are first-party but miss the community long tail. Future: data out of `data.jsx` → a
JSON file (schema.org/Event-shaped) → SMS/aggregator pipeline.

---

## Roadmap / open work

**Highest-value now (surfaced hard by real festival data):**
- **Dial density / label de-collision.** The fan separates circles but labels still
  smear, worst at tight festival rims (the NIGHTMOVES vendor cluster). Likely needs
  smaller emblems when a cluster is large, label de-collision, and/or a spiral/dedupe
  layout. **The clearest remaining UX gap.**
- **PWA / cache-busting.** Stale-cache bit repeatedly this session. Ends the
  staleness pain, enables push (the alerts ledger is decorative without it), and is
  mandatory for festival offline use. High value.
- **Geocode the UNVERIFIED coords** (trucks + citywide events) — prioritize close-in
  downtown per the bearing-error insight.

**Deferred engine cycles (each its own PLAN-FIRST commit):**
- **Multi-window-per-day** — fold SUT-SHI back to one circle; must preserve the
  live-status rule (no false "now" in the midday gap). NOTE: festivals do NOT need
  this (act-as-entity + music-collapse already handle many sets per stage).
- **Throttle past midnight** — a couple of real event windows end >24:00 and stay
  clipped; opens a wraparound/day-attribution problem. (24:00 is shipped.)
- **Next-act ghost naming** — give the festival next-act ghost a name+time (currently
  nameless); = the "closed entities hint their next opening" item.

**Other open items:**
- Confidence field (confirmed/scheduled/likely/unverified) on entity data + card +
  watchlist.
- `DEFAULT_RIM_MI` (5 mi) retune for citywide (real venues span 6–25 mi).
- Graceful empty states (sparse Sat/Sun reads as "broken" not "quiet").
- Real GPS for Guide Me (`watchPosition`) — needs a phone. (Simulated parity DONE.)
- Card "social link" field (pairs with confidence field).
- Rush heat-band on the throttle (peak hours).
- Events-taxonomy expansion (sports/social, festival) if citywide continues.
- A favicon (404s — harmless).
- Eventual: Vite + React migration (off in-browser Babel); `window.DYNAMO` rename.

**Strategy / business context now lives in `STRATEGY.md`** — Night Moves pitch
direction, the festival B2B thesis, competitions/IP/accelerator threads. Not needed
for most build work; load it for product/business decisions.