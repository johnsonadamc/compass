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

**Default landing mode is EVENTS** (changed this cycle from FOOD). The MODES array
order drives this — EVENTS is first, FOOD second — and the initial mode reads
`MODES[0].id` (no hardcoded default). See "Mode switching."

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
- `EVENTS` — local events (concerts, markets, classes, festivals, etc.). Default
  landing mode. Mostly dated one-off / multi-day occurrences.
- `FOOD` — food trucks. Recurring weekly schedules.

**Future modes** (same machinery): happy hours, open houses, markets, live music.
A bounded **festival/venue mode** is under active strategic consideration as the
likely commercial direction (see "Strategic direction" — this is product/business
context, not yet built).

### The MODES array is the single source of truth for navigation
A `MODES` array (in `app.jsx`), each entry roughly `{ id, label, sub,
throttleLabel }`. The wordmark, mode menu, throttle label, AND the default landing
mode all read from it. **EVENTS is MODES[0] (default); FOOD is second.** The
initial mode state is `useState(MODES[0].id)` — do NOT reintroduce a hardcoded
`"food"`/`"events"` default that fights the array order. **Adding a new vertical
should be close to: add one entry to MODES + supply its data/categories/glyphs.**
Don't hardcode "food vs events" logic where a MODES-driven approach works. NOTE:
the per-mode **subtitle line was removed** in the minimization pass; MODES may
still carry a `sub` field but it is no longer rendered. Don't reintroduce the
subtitle.

### How mode switching works (core navigation pattern)
The header wordmark reads `OFFLINE//[MODE]` with a small caret. **Tapping the
wordmark opens a dropdown menu of modes**; selecting one switches mode and closes
the menu. No segmented toggle. The dropdown lists modes in MODES order (EVENTS
first). Preserve and extend this pattern.

### Food and Events are parallel, not merged
Events were added as a **separate, additive code path** — food-mode behavior must
keep working untouched. The clean mechanism is a normalizer (`eventToEntity()` in
`data.jsx`) that converts an event into the same entity shape (`locations[]`,
`recurrence[]`/`occurrences[]`, `cravings[]`, `_event`) the dial/math/watchlist
already understand (the shared date-aware schedule model — see "Schedule model")
— so `field.jsx`, the `window.DYNAMO` math, the cards, and the watchlist need no
food-vs-events branches. Prefer this normalize-to-a-common-entity approach for
future modes rather than branching the engine. **Pattern proven repeatedly:**
Guide Me parity, the live-status fix, the dynamic card distance, the travel-time
display, the mileage formatter, and the co-location fan were each done as ONE
shared change that both verticals inherit, by resolving from the mode-correct
`entities` list and the shared engine functions rather than special-casing.

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
- **Seed/placeholder coordinates are DERIVED from estimated bearing/dist around
  the anchor** (destination-point formula), labeled `// UNVERIFIED — <address>`.
  NOT verified addresses. Real entities get real geocoded `latLng`s (right-click
  in Google Maps → copy coords; no API needed). **The current real trucks and
  real events all carry UNVERIFIED placeholder coords** — geocoding them for real
  is pending (see "Current data state" + "Roadmap").

### YOU-hub tap = LOCATION ONLY (the iOS two-prompt split — do not recombine)
- **User location is requested on a deliberate tap of the YOU hub** (NOT on page
  load — auto-request was unreliable on mobile). The hub is a `<button>`; its
  pointer/touch-down handlers `stopPropagation()` so tapping it doesn't start a
  dial drag.
- **The hub tap requests GEOLOCATION ONLY.** Live compass is a SEPARATE gesture on
  the compass chip (see "Live compass"). They were once fired together from one
  tap, but on iOS the device-orientation permission modal **orphaned the still-
  pending geolocation prompt**, so iOS silently dropped the location request (it
  stuck forever — "locating…" never called back). WebKit's transient-activation
  model means two permission modals can't share one user gesture. Splitting them so
  each permission owns its own clean gesture is the fix. **DO NOT recombine them
  into one tap.** (A reliable two-tap beats an unreliable one-tap. Browser-sniffing
  to give Chrome a one-tap path was considered and rejected — it forks the engine
  and reintroduces the iOS bug risk.)
- **iOS Safari hub-tap fix (SHIPPED):** the hub tap also needed an explicit
  `onTouchEnd` handler driving activation, because `onTouchStart` `stopPropagation()`
  under `touch-action: none` suppressed iOS's synthesized click — so on iOS the
  hub tap registered nothing. The fix: `onTouchEnd` calls the tap handler directly,
  with a ~700ms timestamp guard (`tapGuardRef`) so the later ghost-click on Chrome
  doesn't double-fire. `onTouchStart`/`onMouseDown` `stopPropagation()` (the drag
  guard) are preserved. This was a longstanding bug exposed once the prompt-split
  removed the incidental compass-prompt feedback that had masked it. **Do not
  remove the onTouchEnd path or the timestamp guard.**
- **Geolocation call hardening (SHIPPED):** `getCurrentPosition` uses
  `{ enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }`. High-accuracy
  is OFF deliberately — a 5-mile radar doesn't need GPS precision, and wifi/cell is
  faster and returns indoors. The finite timeout kills the indefinite-hang failure
  mode. The error callback is also wrapped so a synchronous iOS throw still routes
  to the denied state (never a silent dead tap).
- **Fallback when denied/unavailable:** silently center on the city anchor; the
  app never blanks. The YOU hub shows **"YOU"** when a real position is active,
  else the anchor's `hubLabel` (e.g. "GARDEN & PALAFOX") + a small "TAP TO LOCATE",
  which becomes **"LOCATION OFF · TAP TO RETRY"** after a denial (a quiet note —
  never a fully silent failure; `userPos` stays null so the anchor fallback holds).
  The geolocation error callback must ALWAYS exist — an empty/silent one was the
  original iOS bug that hid failures.
- **Rim radius** is a single constant `DEFAULT_RIM_MI` (currently **5 miles**) —
  the default zoom range; pinch-zoom bounds scale proportionally. No auto-scaling.
  **KNOWN ISSUE (real data confirmed it):** real Pensacola venues run 6–25 mi
  (Pace, Milton, Navarre, Perdido, Gulf Breeze, the beaches), so much of the real
  dataset piles at/over the rim. Retuning this is now a live UX decision (see
  "Roadmap").
- Requires HTTPS (Vercel provides it). iOS Geolocation + DeviceOrientation both
  require HTTPS and the orientation permission must come from a user gesture (the
  chip tap satisfies this for compass).

## Live compass (SHIPPED)

- **The compass chip activates live mode** (the YOU hub no longer does — it requests
  location only; see "Geolocation & placement" for why the two prompts were split).
  The dial rotates to the device heading. iOS uses `webkitCompassHeading` (true
  north). Android uses `deviceorientationabsolute` when available, falling back to
  relative `deviceorientation` `alpha`.
- **Chip pulse cue (SHIPPED):** once located but not yet live (`userPos` set AND
  `compassLive` false), the compass chip itself pulses a gentle `--blue` halo
  (reusing the `watchtab-pulse` keyframes, which were refactored to be
  `color-mix(var(--blue))`-driven rather than hardcoded — so the watchlist live
  badge and ledger "happening" dot share it and palette-track). This draws the eye
  to the "go live" step. The old center "TAP ✣ FOR LIVE" hint text was REMOVED in
  favor of the chip pulse. The pulse stops the instant `compassLive` becomes true.
- iOS requires `DeviceOrientationEvent.requestPermission()` called synchronously
  within the tap handler — preserved: the chip's own tap is that gesture (the chip
  owns compass activation, uncontended by the geolocation prompt).
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
`nowInCity` → cityNow/todayHour/realNowHour → DAYS → geo math → TRUCKS → EVENTS →
`planFor`/`windowTimes`/`statusAt`/`liveStatusAt` + the travel/format helpers
(`walkMin`, `driveMin`, `travelEstimate`, `fmtMiles`).

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
- **One window per entity per day.** A genuine same-day double-header (e.g. a
  truck open 11a–2p AND 5–8p, or two co-located events at one venue) must be
  **two separate entities** — `planFor` returns the first match only. This is why
  SUT-SHI is currently TWO entities (Lunch + Dinner) and Greek's is TWO entities
  (Hillcrest + Pace). **A multi-window-per-day engine change is planned** to fold
  SUT-SHI back into one circle (see "Roadmap / deferred engine cycles").
- The 7:00–22:00 throttle cannot represent past-22:00 windows; late-night events
  are clipped (the window's >22 snap point is simply never reachable, which is
  safe — it does not error). Real event data NOW contains many past-22:00 nightlife
  windows (kept with TRUE end times in the data so they're correct once the
  throttle extends). **Extending the throttle toward midnight is the planned next
  engine task** (see "Roadmap").

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
  - The dial's blue **`emblem-ping` pulse** — gated on **(facing direction) AND
    (live now)**; it pings only when an emblem is live on the real clock AND within
    the ~22° arc you're currently facing. (The facing-direction geometry is a
    separate, correct feature — do not touch it. NOTE: the co-location fan keys the
    facing test off each emblem's TRUE bearing, not its fanned render position — see
    "Co-location fan.")
  - The header wording — the word **"NOW" appears only** when viewing the real
    today at the real hour; otherwise it reads count-only. **The clock-time readout
    was REMOVED this cycle:** the header now reads e.g. "2 ON NOW" (real now) or
    just "2 ON" / "2 OPEN" (scrubbed) — no "8P"/"6P" time, since the throttle
    already shows the hour. The count itself stays scrubbed (exploratory readout).

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
construction. When touching status, preserve: (1) lit/ghost + schedule info stay
scrubbed; (2) all "now" claims stay real-clock; (3) one shared path, no
food-vs-events branch.

## Co-location fan (SHIPPED — multiple entities at the same spot)

When two+ entities resolve to the same/near-same dial position (e.g. Brown Bagger
+ Flourish's Alga Beer Co. stop share 2435 N 12th Ave; multiple events at one
venue), they would render as overlapping circles and only the top one was tappable.
**Root cause:** the existing pixel-declump loop had a degenerate zero-vector case —
at identical coords the repulsion direction was (0,0), so it pushed by nothing.

**Fix (in `field.jsx` placement pipeline):** entities are gathered as
`{baseAng, r, …}`, co-located clusters are detected by **rendered proximity on
pre-rotation coords** (threshold `(sizeA+sizeB)/2 + ~9px`), then each cluster is
**fanned by ANGLE at the SAME radius** (symmetric about the true bearing,
chord-sized step with `FAN_MIN_STEP`/`FAN_MAX_TOTAL` clamps), THEN rotated, THEN
the existing declump runs as a post-fan safety net. Key invariants:
- **Render-only.** The fan touches only the emblem's `x/y` (and its label). The
  entity's TRUE `bearing`/`dist` (what the cards, `travelEstimate`, `fmtMiles`, and
  Guide Me read via their own `planFor` calls) is unchanged. The cards never read
  `field`'s `x/y`.
- **Angle, not distance** — preserves the true distance ring (so card mileage and
  the dial agree).
- **Pre-rotation / dial-space** — a fanned cluster rotates as one rigid group under
  live compass / flick momentum, never scatters.
- **Facing-ping fidelity** — the facing test keys off each emblem's TRUE rotated
  bearing (`trueX/trueY`), not the fanned position.
- The fan constants (`FAN_TARGET_SEP`, `FAN_MIN_STEP`, `FAN_MAX_TOTAL`) are
  device-dial-radius-dependent tunables.
- **Deferred follow-ups:** label de-collision (text labels can still smear even
  when circles separate) and a spiral/dedupe layout for very dense or near-center
  clusters. See "Roadmap."

## Card travel time & distance (SHIPPED)

- Both cards show distance using the SAME geo-aware `planFor(entity, day,
  userPos?.lat, userPos?.lng)` path — real position drives it when YOU is active,
  the stored estimate otherwise. Card distance is now DYNAMIC (recomputes from the
  user's real position when located).
- Distance renders as **`<miles> mi · <travel estimate>`** via shared helpers in
  `window.DYNAMO`:
  - `walkMin(dist)` / `driveMin(dist)` — `driveMin = round(dist/25*60)` (~25 mph
    local roads), floored at 1.
  - `travelEstimate(dist)` — **≤ 1.0 mi → "N min walk"; > 1.0 mi → "N min drive"**
    (single distance threshold; you never see a 21-min walk).
  - `fmtMiles(dist)` — `dist >= 10 → round (no decimal); else one decimal`. Applied
    everywhere mileage renders (both cards, event upcoming rows, both watchlist
    rows) for consistency. (Intentionally NOT applied to `field.jsx`'s ring-scale
    label formatter, which has its own sub-1-mile precision.)
- These are crow-flies estimates (no routing API) — deliberately conservative.
  The event card dropped its compass-direction text in favor of the travel time
  (both cards now read "miles · time" identically — cleaner parity).

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
- **Lens labels render ALL CAPS** via `text-transform: uppercase` on the
  `.lens-active` readout (CSS-driven; label data stays natural-case). The readout
  is left-aligned (`flex: 1; text-align: left`) so single- and multi-line category
  names share a left edge.
- **KNOWN STRAIN (surfaced by real general-events data):** the 7-category events
  taxonomy is slightly too narrow for a general citywide feed — sports/World-Cup
  watch parties map awkwardly to `nightlife`, festivals to `markets`. Best-fit
  assignments are in use; a future taxonomy expansion (sports/social, festival)
  may be warranted if the citywide-events direction continues. (The bounded
  festival mode would have a simpler taxonomy — stages/food/vendors.)
- **Glyphs:** 14 custom glyphs keyed by the ids above, monochrome SVG line art on
  a 48×48 viewBox, stroke-width 2.4, round caps/joins, using `currentColor`. They
  live in `glyphs.jsx` via a path **parallel** to the pre-existing engine glyphs
  (old glyphs render 24×24 filled; do not clobber them).

## UI minimization (SHIPPED)

- Removed the per-mode subtitle line.
- Removed the "FILTER" text label from the lens strip — glyphs stand alone; the
  active filter name still surfaces on selection.
- Removed the header clock-time readout (count + "NOW" only; see "Live status").
- Removed the center "TAP ✣ FOR LIVE" hint (replaced by the compass-chip pulse).
- Watchlist tab: the live dot merged into the **count badge, which pulses (in
  `--blue`) when a saved item is currently live**.
- Browser tab `<title>` is just **"OFFLINE"** (was a tagline).

## Card title / dial label casing (SHIPPED)

Event names render **ALL CAPS** to match trucks. Mechanism: **trucks store their
names uppercase in the data; events store names natural-case and are uppercased via
CSS.** A `.ev-name` class on the event card title applies `text-transform:
uppercase` (the shared `.card-name` rule is untouched), and the dial labels apply
the same. Event data stays natural-case. Convention going forward: keep event names
natural-case in data; let CSS capitalize.

## Card signature cell (SHIPPED)

The truck card's SIGNATURE cell is now **conditional** — it only renders when the
truck has a `signature` value (label reads just "SIGNATURE", not "SIGNATURE DISH").
Trucks without a signature dish omit the whole cell cleanly (price still shows in
the cuisine line). A future "social link" field on the card was discussed but NOT
built (no handle data yet; pairs naturally with the confidence-field work).

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
- **Count resilience (FIXED this cycle):** the badge count was `watched.size` (raw
  saved-id count), which a stale/removed id would inflate. It now uses
  `allWatchedEntities.length` — the list resolved against LIVE entities — so
  unresolvable (removed/stale) ids are ignored and the badge agrees with the
  ledger. Do not regress to counting raw saved ids.
- NOTE: **no confidence field on entity data yet** — the data-honesty ladder
  (confirmed/scheduled/likely/unverified) is a principle, not a wired field.

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
  sensor/safe-area) → user merges. **PREFERRED safer merge (test-locally-then-push):**
  `git checkout main && git pull && git merge origin/<branch>` → serve & test
  locally → `git push` ONLY if clean → confirm `git log --oneline -1 origin/main`.
  This tests the combined state BEFORE it hits the public domain. (Note: a merge
  command of the form `git merge <branch>` can fail with "not something we can
  merge" if the local branch ref doesn't exist — use `git merge
  origin/<branch>` to merge the remote-tracking ref.)
- **Cache caveat (felt repeatedly):** browser cache — especially mobile Safari —
  serves stale `.jsx` after a deploy. "Works local, broken live" is almost always
  cache. Bust with a private/incognito tab or clear site data (iOS Settings →
  Safari → Advanced → Website Data). PWA/cache-busting is a roadmap item that would
  end this.
- **iOS permission caveat:** iOS caches a denied geolocation permission and won't
  re-prompt. To re-test, clear the site's location permission (Safari AA menu →
  Website Settings, or Settings → Privacy → Location Services). A stuck permission
  contaminated debugging this cycle — clear it before concluding the code is wrong.
- **Each new session starts from a FRESH branch off current `main`.** Don't keep
  stacking new work on an old, already-merged feature branch. Delete merged
  branches to avoid confusion.

## CRITICAL verification reality (do not skip)

**Claude Code's sandbox CANNOT load the app** — the CDN (React/Babel/fonts) is
blocked, so the page cannot bootstrap. Claude Code's "verified" can only mean
*"the logic/static analysis looks right,"* NEVER *"it renders."* Black-screen
crashes have shipped from reports of success that never loaded the page. Therefore:
- Claude Code does whatever static verification it can (incl. `node --check` on a
  `.js` copy, and — where feasible — loading `data.jsx` in a tiny harness to assert
  resolver behavior; harnesses caught real issues repeatedly), then **explicitly
  states it could NOT confirm a clean browser render** and that the user must test.
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
  model, the live-status fix, the co-location fan, and every real-data drop were
  done this way and it caught real bugs before they shipped — e.g. the degenerate
  zero-vector declump case, the Greek's "second location never renders" trap, the
  iOS synthesized-click suppression.)
- **One concern per commit.** Report branch + new HEAD hash after pushing.
- **Verify-then-report honestly** per the verification-reality section. Never
  report a clean render you didn't witness. Don't commit test scaffolding.
- **Preserve:** CSS-variable theming (never hardcode hex), `index.html` script
  load order, the responsive dvh/safe-area/computed-dial-size layout, MODES-driven
  navigation + the EVENTS-default order, the capped/swipe-dismiss bottom sheets,
  the YOU-hub-tap LOCATION-ONLY activation flow + the iOS `onTouchEnd` hub fix, the
  two-prompt split (do not recombine), the compass listener teardown + chip pulse,
  the real-date logic & the date-aware schedule model (`getDay` 0=Sun convention),
  the **live-status rule** (`realNowHour`+day-0 for "now" claims; lit/ghost +
  schedule info stay scrubbed), the dial's facing-direction ping geometry + the
  co-location fan's render-only/true-bearing invariants, the shared travel/distance
  helpers, and food-mode behavior when working on events (and vice versa).
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
  (`sheet.jsx` provides `useSwipeDismiss`; must load before any sheet consumer.)
  New files insert at the right point.
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

### Trucks (FOOD mode) — REAL DATA (8 entities)
- `TRUCKS[]`: `id`, `name` (stored UPPERCASE), `cuisine`, `glyph` (a category
  glyph id), `price` (1–3), `cravings[]` (taxonomy ids), `signature` (optional —
  card cell hidden when absent), `blurb`, `favorite`, `locations[]` (`{ name,
  bearing°, dist mi, latLng:{lat,lng} }`), and the date-aware schedule fields
  `recurrence[]` / `occurrences[]` / `exceptions[]`.
- **All seed trucks were STRIPPED and replaced with 8 real Pensacola trucks:**
  Globetrotter Street Food, Greek's–Hillcrest, Greek's–Pace, Brown Bagger, Mi Su,
  SUT-SHI (Lunch), SUT-SHI (Dinner), Flourish Pizza. Most are recurring
  (`recurrence`); Flourish is roaming (dated `occurrences`). **Greek's and SUT-SHI
  are each split into two entities** because of the one-window-per-day rule
  (Greek's = two simultaneous locations; SUT-SHI = lunch + dinner same day). All
  `latLng`s are **UNVERIFIED placeholders** (estimated bearing/dist around the
  anchor, tagged `// UNVERIFIED — <address>`) — real geocoding pending.
- `CRAVINGS[]`: filter chips `{ id, label, glyph, tag }`; `tag:null` = ALL.

### Events (EVENTS mode) — REAL DATA (30 entities, this weekend)
- `EVENTS[]`: `id`, `name` (stored natural-case; CSS uppercases), `venue`,
  `category` (taxonomy id), `glyph` (category id — required), `blurb`, `price`
  (string), optional `ticketUrl`, `location` (`{ bearing, dist, latLng }`), and the
  same date-aware schedule fields. `eventToEntity()` normalizes.
- **All seed events (33: 7 throwaway + 26 estimated) were STRIPPED and replaced
  with 30 real Pensacola events for the weekend of Fri 6/12–Sun 6/14 2026** (dated
  `occurrences`; multi-day events carry one row per date). All `latLng`s are
  UNVERIFIED placeholders. 9 occurrence rows have TRUE end times past 22:00
  (nightlife — currently clipped by the throttle until throttle-to-midnight ships).
  **Data skews heavily to Friday** (the source list was Friday-dense); Sat/Sun are
  sparse (mostly the multi-day festivals) — this makes the "graceful empty states"
  roadmap item concrete, and is partly a data-gathering artifact (balance future
  batches across days).
- `EVENT_CATEGORIES[]`: parallel to CRAVINGS, drives the events lens.

### Shared / engine (`window.DYNAMO`)
- Time/date: `nowInCity`, `cityNow`, `todayHour`/`realNowHour`, `DAYS[]`.
- Geo: `haversineMi`, `geoBearing`, destination-point derivation, `CITIES`,
  `DEFAULT_CITY`, `DEFAULT_RIM_MI`.
- Placement/status: `planFor`, `windowTimes`, `powerAt`, `statusAt`,
  `liveStatusAt`, `bodyPos`, `upcomingWindows`.
- Travel/format: `walkMin`, `driveMin`, `travelEstimate`, `fmtMiles`, plus other
  format/math utils.

---

## Data honesty (load-bearing product principle)

Real-world location/hours data decays fast and public sources are unreliable. The
product **shows confidence rather than faking certainty**: confirmed / scheduled /
likely / unverified. Never present an unverified guess as fact. **Don't invent
data** — names, hours, venues, coordinates come from the user (ground truth) or are
explicitly marked unverified/derived. ALL current real trucks and events have
UNVERIFIED placeholder coordinates, labeled as such.

**Bearing-error insight (important for geocoding priority):** the same coordinate
error produces a tiny bearing error for distant entities but a HUGE bearing error
for nearby ones. A 150m coord error is ~1° off at 5 miles but can be 30–90° off two
blocks away — i.e. the dial points the wrong way for exactly the close-in downtown
users the product serves best. So geocoding precision matters MOST for nearby
venues, and "geocode the coords" is not cleanup — it's the nearby experience.
Concentrate verified-coord effort on close-in venues; far ones tolerate rough
coords.

**Data pipeline options (researched this cycle):**
- There is **no clean first-party "events near me" API** — Google's structured-data
  is a publishing schema, not a feed; the Places API has no events; "Ask Maps" has
  no developer endpoint. Real-world local event data is genuinely fragmented (across
  Facebook, ticketing sites, venue pages) — which is why it's hard and why solving
  it has value.
- **SerpApi's `google_events` engine** (and similar: HasData, Apify) returns
  structured JSON of Google's aggregated event results — usable to seed/refresh the
  citywide events vertical. For one city pulled weekly this fits the FREE tier
  (~$0/mo). Caveats: it's SCRAPED (fragile to Google layout changes, terms gray
  area, accuracy is third-hand) — so it fights the truthfulness principle and wants
  the confidence field before being leaned on.
- **Ticketed-event APIs** (Eventbrite/Ticketmaster) are first-party and reliable
  but only cover their own inventory (miss the community long tail).
- Future: data should live OUTSIDE `data.jsx` (a JSON file modeled on
  schema.org/Event field names, then the SMS/aggregator pipeline) — editing code to
  change hours doesn't scale.

---

## Strategic direction (product/business context — NOT yet built)

This is live strategic thinking, recorded so a strategy chat keeps context. None of
it is implemented; it informs prioritization.

- **The engine is ~95% done; the make-or-break gap is DATA and data-sustainability,
  not code.** The citywide consumer app is best understood as a portfolio piece and
  proof-of-concept, not (by itself) a business — consumer local-discovery has a low
  ceiling and its only obvious monetization (ads/promoted placement) breaks the
  dial's honesty.
- **The strongest commercial direction is a BOUNDED festival/venue mode (B2B,
  organizer-pays).** At a festival the citywide problems VANISH: the organizer hands
  you authoritative finite data (no decay, no scraping), the site is small so the
  dial scale is perfect (no rim pileup), and the "get off your phone, look up" brand
  fits perfectly. Same engine, new mode via MODES + normalizer. A music festival is
  an especially clean fit: stages = located entities, set times = the throttle,
  music/food = the mode dropdown.
- **Concrete pilot target:** **Night Moves** (Pensacola one-day indie/alt music
  festival, ~2,000 people, two stages + food trucks + vintage market, run by a
  nonprofit curated by The Handlebar, a Foo Foo Fest grant recipient, fall/November
  timing). Plan: build a white-labeled demo (`nightmoves.online`) using last year's
  real lineup, pitch in late summer for the fall fest. Price the FIRST one as a
  near-cost pilot for the case study, not a payday — getting one organizer to "yes"
  + a testimonial is the asset. Realistic money: boutique/B2B (tens of thousands
  while proving it, low-six-figures if it works; the engine generalizing to
  conferences/fairs/markets is the larger-ceiling story).
- **Festival mode would make three already-roadmapped engine items MANDATORY:**
  throttle-to-midnight (festivals run late), multi-window-per-day (a stage hosts
  many sets/day — same change SUT-SHI needs), and PWA/offline (festivals have bad
  cell service).
- **Other surfaced threads:** design competitions (Awwwards / CSS Design Awards /
  Core77 / Fast Company — a legitimate fit, builds the recognition-moat; enter
  showing the dial at its best, not over-dense); accelerators (NOT yet — get a
  paying pilot first; then regional/vertical, not YC); IP (the mechanism is hard to
  patent and probably not worth it; prioritize a TRADEMARK on "OFFLINE"; real
  decisions need an IP attorney — not yet taken). The through-line: protect/award/
  accelerate are all downstream of ONE thing not yet done — proving a single
  customer will pay.

---

## Roadmap / open work

**Deferred engine cycles (chosen to be done properly, each its own PLAN-FIRST
commit):**
- **Multi-window-per-day.** Let one entity hold multiple windows on one day so
  SUT-SHI becomes ONE circle that lights for lunch, dims midday, lights for dinner
  (and the lunch/dinner split entities merge back into one named "SUT-SHI"). Touches
  `planFor` and its consumers (`statusAt`/`powerAt`/`windowTimes`/`liveStatusAt`/
  `bodyPos`/`upcomingWindows`) — the most load-bearing code. Must preserve the
  live-status rule through the change (no false "now" in the midday gap). This is
  also the change a festival stage (many sets/day) needs.
- **Throttle to midnight.** The 7:00–22:00 range clips nightlife (a whole category;
  9 real event windows currently run past it). Extending touches the throttle
  min/max, tick labels, and the real-time init clamp. Strongest near-term lever now
  that real nightlife data is loaded.

**Surfaced by real data (concrete decisions):**
- **Label collision / dial density.** The co-location fan separates overlapping
  CIRCLES, but text LABELS still smear at the rim with ~30 real events. Declutter /
  label de-collision is likely the highest-value UX work now. (Test honestly: is the
  EVENTS dial readable at current density?)
- **`DEFAULT_RIM_MI` (5 mi) retune.** Real venues span 6–25 mi; most pile at the
  edge. Decide the default zoom / scaling.
- **Graceful empty states.** Sparse days (e.g. the current Sat/Sun) read as
  "broken" rather than "quiet." Make a near-empty dial feel intentional.
- **Geocode real coordinates** (replace UNVERIFIED placeholders) — prioritize
  close-in downtown venues per the bearing-error insight. Highest-leverage data work.

**Other open items:**
- **Confidence field** (confirmed/scheduled/likely/unverified) on entity data,
  surfaced on the card + watchlist — matters most for trucks (least-verifiable) and
  before leaning on any scraped events feed.
- **PWA / Add to Home Screen** — ends the cache-staleness pain, prerequisite for
  real push notifications (the alerts ledger is decorative without it), and
  mandatory for festival offline use.
- Real GPS for Guide Me (`watchPosition`): live shrinking distance, no turn-by-turn
  — needs a phone to test. (Simulated parity is DONE.)
- Card "social link" field (discussed, not built — pairs with confidence field).
- Rush heat-band on the throttle (peak hours).
- Closed entities hint their next opening rather than only ghosting.
- Data out of `data.jsx` → JSON (schema.org/Event-shaped) → SMS/aggregator pipeline.
- A favicon (currently 404s — harmless).
- Events-taxonomy expansion (sports/social, festival) if citywide-events continues.
- Eventual: Vite + React migration (off in-browser Babel); `window.DYNAMO` rename.