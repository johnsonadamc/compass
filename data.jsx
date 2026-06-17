// data.jsx — DYNAMO content + machine model (date-aware occurrence/recurrence).
// Exposes window.DYNAMO, window.TRUCKS, window.CRAVINGS, window.DAYS,
//           window.EVENTS, window.EVENT_CATEGORIES, window.CITIES, window.DEFAULT_CITY.
//
// ── SCHEDULE MODEL (read this before touching dates) ──────────────────────────
// Every entity (truck, and event after eventToEntity) binds to REAL dates, not
// weekday slots. There is NO Tuesday-baseline, NO WEEK_OFFSET, NO week[] array.
//   locations:  [{ name, bearing, dist, latLng:{lat,lng} }]
//   occurrences: [{ date:"YYYY-MM-DD", start, end, loc }]  — explicit dated appearances.
//                A one-off self-expires once its date falls behind day 0. An explicit
//                occurrence on a date OVERRIDES any recurrence for that date.
//   recurrence:  [{ weekdays:[…], start, end, loc, from?, until? }] — weekly patterns,
//                optionally bounded by from/until ("YYYY-MM-DD", inclusive).
//   exceptions:  ["YYYY-MM-DD"] — dates on which a matching recurrence is CANCELLED.
//                Exceptions suppress recurrence ONLY; an explicit occurrence still wins.
//   loc = index into locations[] (default 0). start/end are decimal hours.
//
// WEEKDAY CONVENTION: JS Date.getDay() — 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu,
// 5=Fri, 6=Sat. Every weekday number in recurrence[].weekdays uses THIS scale.
// Do not reintroduce any other baseline.
//
// planFor() resolves a day index → DAYS[day] → real ISO date + real weekday, then
// matches occurrences (explicit) before recurrence (pattern) at RENDER time. It
// returns the same { open, close, name, bearing, dist } | null contract the rest of
// the engine (powerAt/statusAt/bodyPos/upcomingWindows, field.jsx, the cards) expects.

const DAY_START = 7;   // 7:00
const DAY_END = 24;    // 24:00 (midnight)

function fmtTime(t) {
  let h = Math.floor(t);
  const m = Math.round((t - h) * 60);
  const h24 = ((h % 24) + 24) % 24;   // 24 -> 0 (midnight), keeps 7–23 unchanged
  const ampm = h24 >= 12 ? "PM" : "AM";
  let hh = h24 % 12; if (hh === 0) hh = 12;
  return { hh, mm: String(m).padStart(2, "0"), ampm, label: `${hh}:${String(m).padStart(2,"0")} ${ampm}` };
}
const fmtHourShort = (h) => { const x = ((h % 24) + 24) % 24; return `${(x % 12) || 12}${x >= 12 ? "P" : "A"}`; };
const fmtHM = (t) => { const f = fmtTime(t); return `${f.hh}:${f.mm}${f.ampm[0].toLowerCase()}`; };

// Format a Date's LOCAL calendar day as "YYYY-MM-DD". Built from local getters —
// NOT toISOString(), which converts to UTC and can roll the date back a day.
// Zero-padded so lexical string comparison (from/until bounds) is correct.
const isoOf = (dt) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;

// WEEKDAYS is indexed by Date.getDay() (0=Sun … 6=Sat) — matches recurrence weekdays.
const WEEKDAYS = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
// Full names for the NIGHTMOVES static date label (e.g. "SATURDAY, JUN 20"). Built from
// LOCAL getters on the computed Date — NOT toLocaleDateString (which is locale/TZ-dependent).
const FULL_WEEKDAYS = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
const MONTHS_ABBR = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

/* ---- CITY CONFIG ----
   Each city supplies a label and a center lat/lng used as:
     1. the anchor for deriving seed entity coordinates
     2. the fallback "user position" when geolocation is denied/unavailable
   Adding a new city: add one entry here and set DEFAULT_CITY. */
const CITIES = {
  pensacola: {
    label: "Pensacola, FL",
    hubLabel: "GARDEN & PALAFOX",
    center: { lat: 30.4097, lng: -87.2169 },
    timezone: "America/Chicago",
  },
  // Per-mode anchor for OFFLINE//NIGHTMOVES — the festival GROUNDS (Hunter Amphitheater /
  // Maritime Park), not downtown. Used as the GPS-off fallback origin for the dial and the
  // hub label; with real GPS the dial still centers on the user (planFor recomputes from
  // their position). Same Central timezone as the city, so the date/clock machinery is shared.
  nightmoves: {
    label: "Night Moves · Maritime Park",
    hubLabel: "MARITIME PARK",
    center: { lat: 30.402925442829346, lng: -87.21825896737549 },
    timezone: "America/Chicago",
  },
};
const DEFAULT_CITY = "pensacola";

/* Default outer-ring distance in miles. Drives the initial zoom level, the
   pinch-zoom bounds (proportional), and emblem-size scaling in field.jsx.
   Change this one value to shift all rim-related behaviour together. */
const DEFAULT_RIM_MI = 5;

// Get current date/time in an IANA timezone without depending on the device locale.
function nowInCity(tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", hour12: false, weekday: "short",
    minute: "numeric",
  }).formatToParts(new Date());
  const get = (type) => parseInt(parts.find(p => p.type === type)?.value || "0", 10);
  const weekdayStr = parts.find(p => p.type === "weekday")?.value || "Sun";
  const wdMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  return {
    year: get("year"), month: get("month"), day: get("day"),
    hour: get("hour"), minute: get("minute"),
    weekday: wdMap[weekdayStr] ?? 0,
  };
}

const cityNow = nowInCity(CITIES[DEFAULT_CITY].timezone);
// Real current hour as decimal (quarter-hour precision) for throttle initialization.
const todayHour = cityNow.hour + Math.round(cityNow.minute / 15) * 0.25;
// Real unclamped hour for "happening right now" truth (not clamped to DAY_START).
const realNowHour = cityNow.hour + cityNow.minute / 60;

// Rolling 7-day window from today's real Central date; uses Date arithmetic so
// month and year boundaries are handled correctly by the JS engine.
const DAYS = Array.from({ length: 7 }, (_, d) => {
  const dt = new Date(cityNow.year, cityNow.month - 1, cityNow.day + d);
  const wd = dt.getDay(); // 0=Sun … 6=Sat
  return {
    idx: d,
    key: d === 0 ? "TODAY" : WEEKDAYS[wd],
    weekday: WEEKDAYS[wd],
    date: dt.getDate(),
    iso: isoOf(dt),  // "YYYY-MM-DD" real Central calendar date — what planFor matches on
    wd,              // real weekday (getDay convention) — what recurrence matches on
    today: d === 0,
  };
});

// ---- FESTIVAL day set (independent of the rolling-7 DAYS) ----
// The STATIC demo festival runs the current-or-upcoming Fri/Sat/Sun, computed LIVE from
// the real Central date so the prototype never goes stale. Friday anchors the weekend that
// CONTAINS today (when today is Fri/Sat/Sun → that day lights live) or FOLLOWS it (Mon–Thu →
// upcoming, nothing live yet). Same getDay (0=Sun) convention + LOCAL-getter isoOf as DAYS.
// Each entry mirrors a DAYS entry's shape; `today` flags the entry whose real date == real
// today. The shared live-now rule (isLiveNow / liveStatusAt) keys off this `today` flag —
// for the rolling DAYS array days[day].today is true iff day===0, so the rule is byte-
// identical there; for FESTIVAL_DAYS it stays correct without any per-mode branch.
const FEST_TODAY_ISO = DAYS[0].iso;
// Mon→+4 … Thu→+1, Fri→0, Sat→-1, Sun→-2 (offset from today to the weekend's Friday).
const FEST_FRI_OFFSET = 5 - (cityNow.weekday === 0 ? 7 : cityNow.weekday);
const FESTIVAL_DAYS = Array.from({ length: 3 }, (_, i) => {
  const dt = new Date(cityNow.year, cityNow.month - 1, cityNow.day + FEST_FRI_OFFSET + i);
  const wd = dt.getDay();
  const iso = isoOf(dt);
  const today = iso === FEST_TODAY_ISO;
  return { idx: i, key: today ? "TODAY" : WEEKDAYS[wd], weekday: WEEKDAYS[wd],
           date: dt.getDate(), iso, wd, today };
});

// ---- NIGHTMOVES day (single fixed festival day; no day-dial) ----
// Night Moves is a one-day festival. The day is LOCKED (no selector); the engine still needs
// an internal day, so NIGHTMOVES_DAYS is a 1-entry array indexed by the locked day=0. It is
// the upcoming Saturday (including today if today is Saturday), computed LIVE so the demo
// never expires. Same shape/`today` semantics as DAYS/FESTIVAL_DAYS — so planFor + the
// live-status rule (isLiveNow keys off `today`) work unchanged: acts light live ONLY when
// real-today IS this Saturday, neutral/scheduled otherwise. `label` is the static UI string.
const NM_SAT_OFFSET = (6 - cityNow.weekday + 7) % 7;   // Sat→0 (today), Sun→+6, Wed→+3 …
const NIGHTMOVES_DAYS = [(() => {
  const dt = new Date(cityNow.year, cityNow.month - 1, cityNow.day + NM_SAT_OFFSET);
  const wd = dt.getDay();
  const iso = isoOf(dt);
  const today = iso === FEST_TODAY_ISO;
  return { idx: 0, key: today ? "TODAY" : WEEKDAYS[wd], weekday: WEEKDAYS[wd],
           date: dt.getDate(), iso, wd, today,
           label: `${FULL_WEEKDAYS[wd]}, ${MONTHS_ABBR[dt.getMonth()]} ${dt.getDate()}` };
})()];

/* ---- GEO MATH ----
   Haversine + bearing: convert real lat/lng pairs to distance (miles) and
   compass bearing. geoDestination is the inverse — used offline to derive
   seed latLngs from estimated bearing/dist around the anchor. */
const GEO_R_MI = 3958.8; // mean earth radius, miles

// Great-circle distance between two points, in miles.
function haversineMi(lat1, lng1, lat2, lng2) {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const dφ = (lat2 - lat1) * Math.PI / 180;
  const dλ = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  return GEO_R_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Initial compass bearing (degrees, 0=N clockwise) from point A to point B.
function geoBearing(lat1, lng1, lat2, lng2) {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const dλ = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(dλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Destination point given start lat/lng, bearing (degrees), and distance (miles).
// Used to derive seed latLngs from estimated bearing/dist; not needed at runtime.
function geoDestination(lat, lng, bearing, dist) {
  const δ = dist / GEO_R_MI;
  const θ = bearing * Math.PI / 180;
  const φ1 = lat * Math.PI / 180, λ1 = lng * Math.PI / 180;
  const φ2 = Math.asin(Math.sin(φ1)*Math.cos(δ) + Math.cos(φ1)*Math.sin(δ)*Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ)*Math.sin(δ)*Math.cos(φ1), Math.cos(δ)-Math.sin(φ1)*Math.sin(φ2));
  return { lat: φ2 * 180 / Math.PI, lng: λ2 * 180 / Math.PI };
}

/* TRUCKS — real Pensacola entities (replaced the seed set). Each has locations[]
   (named stops w/ bearing+dist+latLng) and a recurrence[] weekly pattern (weekdays use
   getDay: 0=Sun…6=Sat); FLOURISH PIZZA roams, so it carries dated occurrences[] instead
   of recurrence (past dates self-expire — kept honestly). Businesses that run two
   concurrent stalls are split into separate entities (GREEK'S, SUT-SHI), because planFor
   returns one window per entity per day. latLng values are UNVERIFIED placeholders
   (estimated geometry around the anchor) — each carries its real street address in a
   trailing "// UNVERIFIED — <address>" comment so a later session can replace the
   placeholder with a real geocode by find-and-replace. NOT verified addresses. */
const TRUCKS = [
  { id:"globetrotter", name:"GLOBETROTTER STREET FOOD", cuisine:"Global / Other", glyph:"global", price:2,
    cravings:["global"], blurb:"Street food — dumplings & handhelds.",
    favorite:false,
    locations:[
      { name:"Odd Colony Brewing", bearing:0, dist:0.2,
        latLng:{ lat:30.412595, lng:-87.216900 } }, // UNVERIFIED — 260 N Palafox, Pensacola FL 32502
    ],
    recurrence:[
      { weekdays:[1,2,3,4,5], start:17, end:21, loc:0 },  // Mon–Fri 5p–9p
      { weekdays:[6],         start:11, end:21, loc:0 },  // Sat 11a–9p
    ] },

  { id:"greeks-hillcrest", name:"GREEK'S — HILLCREST", cuisine:"Global / Other", glyph:"global", price:2,
    cravings:["global"], blurb:"Greek / Mediterranean.",
    favorite:false,
    locations:[
      { name:"Hillcrest", bearing:70, dist:4.0,
        latLng:{ lat:30.429485, lng:-87.153809 } }, // UNVERIFIED — 3960 Spanish Trl, Pensacola FL
    ],
    recurrence:[
      { weekdays:[1,2,3,4,5], start:10.5, end:19.5, loc:0 },  // Mon–Fri 10:30a–7:30p
      { weekdays:[6],         start:11,   end:19,   loc:0 },  // Sat 11a–7p
    ] },

  { id:"greeks-pace", name:"GREEK'S — PACE", cuisine:"Global / Other", glyph:"global", price:2,
    cravings:["global"], blurb:"Greek / Mediterranean.",
    favorite:false,
    locations:[
      { name:"Pace on Woodbine", bearing:40, dist:13.5,
        latLng:{ lat:30.559293, lng:-87.071051 } }, // UNVERIFIED — 5367 Woodbine Rd, Milton FL 32571
    ],
    recurrence:[
      { weekdays:[2,3,4,5,6], start:11, end:19.5, loc:0 },  // Tue–Sat 11a–7:30p
    ] },

  { id:"brownbagger", name:"BROWN BAGGER", cuisine:"Burgers / BBQ", glyph:"burgers", price:2,
    cravings:["burgers"], signature:"Wagyu burger", blurb:"Wagyu burgers, fries & tenders in brown bags.",
    favorite:false,
    locations:[
      { name:"Brown Bagger", bearing:30, dist:1.8,
        latLng:{ lat:30.432260, lng:-87.201793 } }, // UNVERIFIED — 2435 N 12th Ave, Pensacola FL 32503
    ],
    recurrence:[
      { weekdays:[2,3,4,0,1], start:11, end:20, loc:0 },  // Tue,Wed,Thu,Sun,Mon 11a–8p
      { weekdays:[5,6],       start:11, end:21, loc:0 },  // Fri,Sat 11a–9p
    ] },

  { id:"misu", name:"MI SU", cuisine:"Burgers / BBQ", glyph:"burgers", price:2,
    cravings:["burgers"], blurb:"Hearty burgers & fried chicken sandwiches.",
    favorite:false,
    locations:[
      { name:"Nolita's Parlor & Eatery", bearing:5, dist:0.5,
        latLng:{ lat:30.416909, lng:-87.216169 } }, // UNVERIFIED — 9 E Gregory St, Pensacola FL 32502
    ],
    recurrence:[
      { weekdays:[2,3,4], start:16, end:21, loc:0 },  // Tue–Thu 4p–9p
      { weekdays:[5,6],   start:11, end:21, loc:0 },  // Fri,Sat 11a–9p (closed Sun/Mon)
    ] },

  { id:"sutshi-lunch", name:"SUT-SHI (LUNCH)", cuisine:"Asian", glyph:"asian", price:2,
    cravings:["asian"], blurb:"Sushi takeaway — lunch service.",
    favorite:false,
    locations:[
      { name:"SUT-SHI", bearing:40, dist:13,
        latLng:{ lat:30.553756, lng:-87.076460 } }, // UNVERIFIED — 5432 US-90, Pace FL 32571
    ],
    recurrence:[
      { weekdays:[3,4,5], start:11, end:14, loc:0 },  // Wed,Thu,Fri 11a–2p
    ] },

  { id:"sutshi-dinner", name:"SUT-SHI (DINNER)", cuisine:"Asian", glyph:"asian", price:2,
    cravings:["asian"], blurb:"Sushi takeaway — dinner service.",
    favorite:false,
    locations:[
      { name:"SUT-SHI", bearing:40, dist:13,
        latLng:{ lat:30.553756, lng:-87.076460 } }, // UNVERIFIED — 5432 US-90, Pace FL 32571
    ],
    recurrence:[
      { weekdays:[2],     start:17, end:20, loc:0 },  // Tue 5p–8p
      { weekdays:[3,4,5], start:17, end:20, loc:0 },  // Wed,Thu,Fri 5p–8p
    ] },

  { id:"flourish", name:"FLOURISH PIZZA", cuisine:"Global / Other", glyph:"global", price:2,
    cravings:["global"], blurb:"Wood-fired pizza, roaming.",
    favorite:false,
    locations:[
      { name:"Gary's Brewery & Biergarten", bearing:10, dist:2.3,
        latLng:{ lat:30.442482, lng:-87.210195 } }, // UNVERIFIED — 208 Newman Ave, Pensacola FL
      { name:"Alga Beer Co.", bearing:30, dist:1.8,
        latLng:{ lat:30.432260, lng:-87.201793 } }, // UNVERIFIED — 2435 N 12th Ave (East Hill), Pensacola FL
      { name:"Hitzman Park", bearing:35, dist:3.5,
        latLng:{ lat:30.451190, lng:-87.183196 } }, // UNVERIFIED — 3221 Langley Ave (Scenic Heights), Pensacola FL
    ],
    occurrences:[
      { date:"2026-06-03", start:17, end:21, loc:0 },
      { date:"2026-06-04", start:17, end:21, loc:0 },
      { date:"2026-06-06", start:16, end:20, loc:1 },
      { date:"2026-06-07", start:16, end:19, loc:2 },
      { date:"2026-06-13", start:16, end:20, loc:1 },
      { date:"2026-06-14", start:12, end:17, loc:0 },
      { date:"2026-06-16", start:16, end:20, loc:1 },
      { date:"2026-06-24", start:17, end:21, loc:0 },
      { date:"2026-06-25", start:16, end:20, loc:1 },
      { date:"2026-06-27", start:16, end:19, loc:2 },
      { date:"2026-06-30", start:16, end:20, loc:1 },
    ] },
];

const CRAVINGS = [
  { id:"all",      label:"ALL",               glyph:"all",      tag:null },
  { id:"tacos",    label:"Tacos / Handhelds", glyph:"tacos",    tag:"tacos" },
  { id:"burgers",  label:"Burgers / BBQ",     glyph:"burgers",  tag:"burgers" },
  { id:"asian",    label:"Asian",             glyph:"asian",    tag:"asian" },
  { id:"seafood",  label:"Seafood",           glyph:"seafood",  tag:"seafood" },
  { id:"sweets",   label:"Sweets / Treats",   glyph:"sweets",   tag:"sweets" },
  { id:"coffee",   label:"Coffee / Drinks",   glyph:"coffee",   tag:"coffee" },
  { id:"global",   label:"Global / Other",    glyph:"global",   tag:"global" },
];

/* ---- math ---- */
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const lerp  = (a,b,t) => a + (b - a) * t;
const smoothstep = (e0,e1,x) => { const t = clamp((x-e0)/(e1-e0),0,1); return t*t*(3-2*t); };

const DIRS = ["N","NE","E","SE","S","SW","W","NW"];
const compassDir = (bearing) => DIRS[Math.round(((bearing % 360) / 45)) % 8];

// Resolve an entity's plan on a given day index -> { open, close, name, bearing, dist }
// | null (not out that day). Binds the day index to its real Central calendar date via
// DAYS[day], then matches an explicit dated occurrence first, else a recurrence pattern.
// Runs at RENDER time (no load-time expansion). Optional userLat/userLng: when provided
// and the location has a latLng, bearing/dist are computed from real geography; otherwise
// falls back to stored estimated values. Returns the legacy { open, close, … } contract.
function planFor(entity, day, userLat, userLng, days = DAYS) {
  const dd = days[day]; if (!dd) return null;
  const { iso, wd } = dd;
  // (1) explicit dated occurrence wins (and overrides recurrence on its date)
  let hit = entity.occurrences ? entity.occurrences.find(o => o.date === iso) : null;
  // (2) else a recurrence: weekday matches, within [from,until], not an exception date
  if (!hit && entity.recurrence && !(entity.exceptions && entity.exceptions.includes(iso))) {
    hit = entity.recurrence.find(r =>
      r.weekdays.includes(wd) &&
      (!r.from  || iso >= r.from) &&
      (!r.until || iso <= r.until)
    ) || null;
  }
  if (!hit) return null;
  const loc = entity.locations[hit.loc || 0] || entity.locations[0];
  let bearing = loc.bearing, dist = loc.dist;
  if (userLat != null && userLng != null && loc.latLng) {
    dist    = haversineMi(userLat, userLng, loc.latLng.lat, loc.latLng.lng);
    bearing = geoBearing(userLat, userLng, loc.latLng.lat, loc.latLng.lng);
  }
  return { open: hit.start, close: hit.end, name: loc.name, bearing, dist };
}

// Flat list of all window start/end times across an entity's occurrences + recurrence.
// Used to build the throttle's snap points; keeps schedule-shape knowledge in the data
// layer so app.jsx never reads the model directly.
function windowTimes(entity) {
  const out = [];
  if (entity.occurrences) for (const o of entity.occurrences) out.push(o.start, o.end);
  if (entity.recurrence)  for (const r of entity.recurrence)  out.push(r.start, r.end);
  return out;
}

// power 0..1 over the service window on a day with soft ramps.
// `days` selects the day frame (DAYS for FOOD/EVENTS; FESTIVAL_DAYS for FESTIVAL) and is
// threaded straight to planFor; defaulting to DAYS keeps every existing caller identical.
function powerAt(truck, t, day, days = DAYS) {
  const p = planFor(truck, day, undefined, undefined, days); if (!p) return 0;
  const edge = 0.45;
  const a = smoothstep(p.open - edge, p.open + edge*0.5, t);
  const b = 1 - smoothstep(p.close - edge*0.5, p.close + edge, t);
  return clamp(Math.min(a, b), 0, 1);
}
function statusAt(truck, t, day, days = DAYS) {
  const p = planFor(truck, day, undefined, undefined, days); if (!p) return "off";
  const pow = powerAt(truck, t, day, days);
  if (pow <= 0.03) return t < p.open ? "soon" : "closed";
  if (t > p.open && t < p.open + 0.6) return "opening";
  if (t > p.close - 0.75 && t < p.close) return "closing";
  return "open";
}
// Shared "is this entity live RIGHT NOW" predicate — ONE rule for the dial ping, both
// cards, and the watchlist badge. True only when the VIEWED day is the real today
// (days[day].today) AND the entity is within an open window at the real clock. For the
// rolling DAYS array days[day].today is true iff day===0, so this is byte-identical to the
// prior inline `day===0 && powerAt(realNowHour,0)>0.5`; for a per-mode day set
// (FESTIVAL_DAYS) it keys off the real-today flag, so no false "now" appears on a festival
// day that is not actually today.
function isLiveNow(entity, day, days = DAYS) {
  const dd = days[day];
  return !!(dd && dd.today && powerAt(entity, realNowHour, day, days) > 0.5);
}
// Live status for a card's status line — now-relative claims ONLY on the real present day,
// computed against the real clock (realNowHour), NOT the scrubbed throttle. Mirrors the
// watchlist HAPPENING NOW rule. The "is it really today?" test is days[day].today (for the
// rolling DAYS array that is exactly day===0; for FESTIVAL_DAYS it is the festival day whose
// date == today). Returns a neutral statusAt token when viewing real today, or null on any
// other day (the caller then shows neutral viewed-day schedule info instead of a live claim).
function liveStatusAt(entity, day, days = DAYS) {
  const dd = days[day];
  if (!dd || !dd.today) return null;
  return statusAt(entity, realNowHour, day, days);
}
// bearing+dist -> field offset for the day (null if off)
// Optional userLat/userLng: threaded to planFor for geo-accurate bearing/dist.
function bodyPos(truck, fieldR, day, userLat, userLng, days = DAYS) {
  const p = planFor(truck, day, userLat, userLng, days); if (!p) return null;
  const rad = (p.bearing - 90) * Math.PI / 180;
  const rr = clamp(p.dist / DEFAULT_RIM_MI, 0, 1) * fieldR;
  return { x: Math.cos(rad)*rr, y: Math.sin(rad)*rr, r: rr };
}
const walkMin = (d) => Math.max(2, Math.round(d * 18));
// Conservative crow-flies drive estimate: ~25 mph local-roads average → whole minutes
// (floored at 1 so a short hop never reads "0 min"). An estimate, not a routed time.
const driveMin = (d) => Math.max(1, Math.round(d / 25 * 60));
// Shared travel readout for both cards (no food-vs-events branch): walk at/under 1 mi,
// drive beyond. Returns a display string carrying the mode word — e.g. "18 min walk" /
// "31 min drive". walkMin already floors at 2, so a walk never reads "0 min".
const travelEstimate = (distMi) => distMi <= 1.0
  ? `${walkMin(distMi)} min walk`
  : `${driveMin(distMi)} min drive`;
// Shared mileage display formatter: one decimal under 10 mi ("3.5"), whole number at/
// over 10 mi ("13"). Pure display — keep the "mi" unit at the call site.
const fmtMiles = (d) => d >= 10 ? `${Math.round(d)}` : d.toFixed(1);

// next upcoming windows for a truck from (day, t) forward — for alerts ledger
// Optional userLat/userLng: threaded to planFor so displayed dist/bearing are geo-accurate.
function upcomingWindows(truck, fromDay, fromT, max = 3, userLat, userLng, days = DAYS) {
  const out = [];
  for (let d = fromDay; d < days.length && out.length < max; d++) {
    const p = planFor(truck, d, userLat, userLng, days); if (!p) continue;
    if (d === fromDay && fromT >= p.close) continue; // already over today
    out.push({ day: d, ...p, live: d === fromDay && fromT >= p.open && fromT < p.close });
  }
  return out;
}

// ---- EVENTS vertical ----
// Events share the same date-aware schedule model as trucks. Each event has a single
// `location` and a recurrence[] (weekdays use getDay: 0=Sun…6=Sat) and/or occurrences[]
// (dated one-offs). eventToEntity() normalises an event into the shared entity interface
// (locations[] + recurrence/occurrences) so Field, DYNAMO math, and the watchlist work
// unchanged. The seed events are recurring placeholders; real dated events land later.

const EVENT_CATEGORIES = [
  { id:"all",        label:"ALL",                 glyph:"all",        tag:null },
  { id:"music",      label:"Music / Live",         glyph:"music",      tag:"music" },
  { id:"markets",    label:"Markets",              glyph:"markets",    tag:"markets" },
  { id:"arts",       label:"Arts / Culture",       glyph:"arts",       tag:"arts" },
  { id:"classes",    label:"Classes / Workshops",  glyph:"classes",    tag:"classes" },
  { id:"comedy",     label:"Comedy",               glyph:"comedy",     tag:"comedy" },
  { id:"nightlife",  label:"Nightlife",            glyph:"nightlife",  tag:"nightlife" },
  { id:"kids",       label:"Kids / Family",        glyph:"kids",       tag:"kids" },
];

// EVENTS — real Pensacola weekend events (Fri 6/12–Sun 6/14, 2026), dated occurrences[].
// Multi-day events carry one occurrence row per date. start/end are decimal hours; TRUE
// end times are kept even past the 24.0 throttle ceiling (2 late shows: Borgore 24.5,
// Beach Dogz 25) so they're correct once a post-midnight cycle extends the range — they
// display clipped (lit at midnight, no rendered close) until then. glyph === category.
// latLng values are UNVERIFIED placeholders (estimated geometry around the anchor); each
// carries its real street address in a "// UNVERIFIED — <address>" comment for later geocode.
const EVENTS = [
  { id:"ev-pumpkin-fest", name:"Half-Way to Pumpkin Fest", venue:"Coastal County Brewing Company", category:"markets", glyph:"markets",
    blurb:"Fall-flavored tap takeover — pumpkin stouts, spiced ciders, sours, games.", price:"Free entry",
    location:{ bearing:15, dist:6.1, latLng:{ lat:30.494974, lng:-87.190382 } }, // UNVERIFIED — 3041 E Olive Rd, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:12, end:21 }, { date:"2026-06-13", start:12, end:21 }, { date:"2026-06-14", start:12, end:18 } ] },
  { id:"ev-peach-fest", name:"Peach Festival", venue:"Gary's Brewery & Biergarten", category:"markets", glyph:"markets",
    blurb:"Family summer fest — local vendors, food trucks, petting zoo, craft beer, peach treats.", price:"Free",
    location:{ bearing:8, dist:2.4, latLng:{ lat:30.444097, lng:-87.211293 } }, // UNVERIFIED — 208 Newman Ave, Pensacola FL
    occurrences:[ { date:"2026-06-13", start:12, end:19 }, { date:"2026-06-14", start:12, end:18 } ] },
  { id:"ev-sports-cards", name:"Sports Cards & Collectible Show", venue:"Rest and Relax Inn", category:"markets", glyph:"markets",
    blurb:"Graded sports & Pokemon cards, packs, vintage finds, $1 bins. Door prizes.", price:"$2",
    location:{ bearing:358, dist:5.7, latLng:{ lat:30.492146, lng:-87.220241 } }, // UNVERIFIED — 7200 Plantation Rd, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:11, end:20 }, { date:"2026-06-13", start:10, end:18 } ] },
  { id:"ev-blue-levee", name:"Blue Levee", venue:"Hilton Pensacola Beach", category:"music", glyph:"music",
    blurb:"Blues, rock & country oceanfront with Jack Grimley on keys.", price:"Free",
    location:{ bearing:160, dist:8, latLng:{ lat:30.300890, lng:-87.171034 } }, // UNVERIFIED — 12 Via De Luna Dr, Pensacola Beach FL
    occurrences:[ { date:"2026-06-13", start:13, end:16 }, { date:"2026-06-14", start:13, end:16 } ] },
  { id:"ev-steam-kids", name:"Cooking with S.T.E.A.M.", venue:"The Makery", category:"kids", glyph:"kids",
    blurb:"Free weekly kids science/art activity — this week, ice cream in a bag.", price:"Free",
    location:{ bearing:25, dist:13.5, latLng:{ lat:30.586745, lng:-87.120980 } }, // UNVERIFIED — 4857 W Spencerfield Rd, Pace FL
    occurrences:[ { date:"2026-06-12", start:10, end:11 } ] },
  { id:"ev-healthy-cooking", name:"Healthy Cooking Class w/ LauraLee", venue:"Ever'man Cooperative Grocery & Cafe", category:"classes", glyph:"classes",
    blurb:"Mediterranean/anti-inflammatory cooking — ravioli in lemon parmesan butter.", price:"$5–10",
    location:{ bearing:270, dist:0.2, latLng:{ lat:30.409700, lng:-87.220256 } }, // UNVERIFIED — 315 W Garden St, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:11, end:12 } ] },
  { id:"ev-archaeology-biglagoon", name:"Archaeology Story Time", venue:"Big Lagoon State Park", category:"kids", glyph:"kids",
    blurb:"Story, hands-on activity & craft with a real archaeologist.", price:"$0–6",
    location:{ bearing:240, dist:13, latLng:{ lat:30.315490, lng:-87.405652 } }, // UNVERIFIED — 12301 Gulf Beach Hwy, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:13, end:14 } ] },
  { id:"ev-movies-cars", name:"20 Years of Movies: Cars", venue:"Pace Library", category:"kids", glyph:"kids",
    blurb:"20th-anniversary film screening with free popcorn.", price:"Free",
    location:{ bearing:40, dist:13, latLng:{ lat:30.553756, lng:-87.076460 } }, // UNVERIFIED — 4750 Pace Patriot Blvd, Pace FL
    occurrences:[ { date:"2026-06-12", start:14, end:16 } ] },
  { id:"ev-luau-night", name:"Dine to Donate: Luau Night", venue:"Gary's Brewery & Biergarten", category:"nightlife", glyph:"nightlife",
    blurb:"Luau-themed school fundraiser night — 15% of proceeds to Hellen Caro PTA.", price:"Free entry",
    location:{ bearing:8, dist:2.4, latLng:{ lat:30.444097, lng:-87.211293 } }, // UNVERIFIED — 208 Newman Ave, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:16, end:20 } ] },
  { id:"ev-wine-tastings", name:"Friday Night Wine Tastings", venue:"Bar Justa", category:"nightlife", glyph:"nightlife",
    blurb:"10 bottle-shop selections in the courtyard; $10 off your first bottle.", price:"Free tasting",
    location:{ bearing:215, dist:0.2, latLng:{ lat:30.407329, lng:-87.218825 } }, // UNVERIFIED — 120 S Baylen St, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:17, end:19 } ] },
  { id:"ev-parents-night-out", name:"June Parent’s Night Out", venue:"Hive & Honey Learning Co.", category:"kids", glyph:"kids",
    blurb:"Drop-off kids' night (pizza, games) so parents get an evening out.", price:"$30–35",
    location:{ bearing:0, dist:7, latLng:{ lat:30.511011, lng:-87.216900 } }, // UNVERIFIED — 25 E Nine Mile Rd, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:17, end:21 } ] },
  { id:"ev-sip-and-save", name:"Summer Sip & Save", venue:"Flip Flops on Palafox Vendor Mall", category:"markets", glyph:"markets",
    blurb:"Extended-hours flash sale with complimentary sips.", price:"Free",
    location:{ bearing:0, dist:3, latLng:{ lat:30.453119, lng:-87.216900 } }, // UNVERIFIED — 4406 N Palafox St, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:17, end:20 } ] },
  { id:"ev-john-hart", name:"John Hart Project", venue:"Paradise Bar and Grill", category:"music", glyph:"music",
    blurb:"Acclaimed Gulf Coast guitarist — blues-tinged classical/finger-style.", price:"Free",
    location:{ bearing:160, dist:8, latLng:{ lat:30.300890, lng:-87.171034 } }, // UNVERIFIED — 21 Via de Luna Dr, Pensacola Beach FL
    occurrences:[ { date:"2026-06-12", start:17.5, end:20 } ] },
  { id:"ev-archaeology-tryon", name:"Archaeology Storytime", venue:"Tryon Branch Library", category:"kids", glyph:"kids",
    blurb:"Story, activity & craft with a real archaeologist.", price:"Free",
    location:{ bearing:35, dist:3.5, latLng:{ lat:30.451190, lng:-87.183196 } }, // UNVERIFIED — 1200 Langley Ave, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:17.5, end:18.5 } ] },
  { id:"ev-plant-bingo", name:"Plant Bingo w/ The Vintage Greenhouse", venue:"Flip Flops on Palafox Vendor Mall", category:"classes", glyph:"classes",
    blurb:"7 rounds, win plants; propagation bar to start your own cuttings.", price:"$25+",
    location:{ bearing:0, dist:3, latLng:{ lat:30.453119, lng:-87.216900 } }, // UNVERIFIED — 4406 N Palafox St, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:18, end:20 } ] },
  { id:"ev-door-hanger", name:"Door Hanger Workshop", venue:"Maker's Loft", category:"classes", glyph:"classes",
    blurb:"Make a decorative door hanger; supplies included, prepay required.", price:"$45",
    location:{ bearing:5, dist:4, latLng:{ lat:30.467372, lng:-87.211046 } }, // UNVERIFIED — 5725 N Old Palafox Hwy, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:18, end:21 } ] },
  { id:"ev-movie-cemetery", name:"Movie in the Cemetery", venue:"St. Johns Cemetery", category:"kids", glyph:"kids",
    blurb:"Family-friendly outdoor movie with glow-in-the-dark games.", price:"Free",
    location:{ bearing:280, dist:1, latLng:{ lat:30.412212, lng:-87.233427 } }, // UNVERIFIED — 301 N G St, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:18.5, end:21 } ] },
  { id:"ev-bubba-n-them", name:"Bubba N’ Them", venue:"The Point Restaurant", category:"music", glyph:"music",
    blurb:"Longtime local bluegrass under the live oaks.", price:"Free",
    location:{ bearing:230, dist:15, latLng:{ lat:30.270013, lng:-87.409458 } }, // UNVERIFIED — 14340 Innerarity Point Rd, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:18.5, end:21.5 } ] },
  { id:"ev-civilized-natives", name:"Civilized Natives", venue:"Calvert's", category:"music", glyph:"music",
    blurb:"Live music at Calvert's.", price:"Free",
    location:{ bearing:80, dist:2.5, latLng:{ lat:30.415977, lng:-87.175580 } }, // UNVERIFIED — 670 Scenic Hwy, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:19, end:22 } ] },
  { id:"ev-nghtmre", name:"NGHTMRE", venue:"Vinyl Music Hall", category:"music", glyph:"music",
    blurb:"LA EDM/trap heavyweight (Gud Vibrations) touring MIND FULL.", price:"$30",
    location:{ bearing:185, dist:0.15, latLng:{ lat:30.407537, lng:-87.217119 } }, // UNVERIFIED — 2 S Palafox St, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:20, end:23 } ] },
  { id:"ev-kick-off-summer", name:"“Kick Off Summer” Party", venue:"The Country Gym", category:"nightlife", glyph:"nightlife",
    blurb:"Summer kickoff with live music, drink specials, beach wear.", price:"Free",
    location:{ bearing:40, dist:22, latLng:{ lat:30.653398, lng:-86.978989 } }, // UNVERIFIED — 5198 Willing St, East Milton FL
    occurrences:[ { date:"2026-06-12", start:19, end:23 } ] },
  { id:"ev-poetry-q-hull", name:"Poetry Reading with Quincy “Q” Hull", venue:"309 N 6th Ave", category:"arts", glyph:"arts",
    blurb:"Spoken-word birthday reading from the longtime Pensacola poet.", price:"Free",
    location:{ bearing:10, dist:0.7, latLng:{ lat:30.419677, lng:-87.214860 } }, // UNVERIFIED — 309 N 6th Ave, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:19, end:21 } ] },
  { id:"ev-karaoke-prost", name:"Karaoke at The Prost Office", venue:"The Prost Office Brewery", category:"nightlife", glyph:"nightlife",
    blurb:"Weekly craft-beer karaoke hosted by Crystal Clear Sounds.", price:"Free",
    location:{ bearing:40, dist:20, latLng:{ lat:30.631261, lng:-87.000667 } }, // UNVERIFIED — 6821 Caroline St, Milton FL
    occurrences:[ { date:"2026-06-12", start:19, end:22 } ] },
  { id:"ev-friday-night-swing", name:"Friday Night Swing with Seaside Swing-Outs", venue:"The Way You Move", category:"classes", glyph:"classes",
    blurb:"Beginner swing lesson then social dance; 18+, no partner needed.", price:"$5",
    location:{ bearing:15, dist:2, latLng:{ lat:30.437659, lng:-87.208211 } }, // UNVERIFIED — 918 Winton Ave, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:19, end:24 } ] },
  { id:"ev-horseshoe-kitty", name:"Horseshoe Kitty", venue:"Bamboo Willie's", category:"music", glyph:"music",
    blurb:"Live music at Bamboo Willie's beachside.", price:"Free",
    location:{ bearing:150, dist:8, latLng:{ lat:30.309411, lng:-87.149842 } }, // UNVERIFIED — 400 Quietwater Beach Rd Ste 14, Gulf Breeze FL
    occurrences:[ { date:"2026-06-12", start:20, end:23 } ] },
  { id:"ev-worldcup-orileys", name:"Team USA World Cup Watch Party", venue:"O'Riley's Irish Pub Downtown", category:"nightlife", glyph:"nightlife",
    blurb:"2026 World Cup on 18 screens, themed cocktails, vuvuzelas.", price:"Free",
    location:{ bearing:180, dist:0.25, latLng:{ lat:30.406082, lng:-87.216900 } }, // UNVERIFIED — 321 S Palafox St, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:20, end:23 } ] },
  { id:"ev-worldcup-mathieson", name:"World Cup Watch Party: USA vs. Paraguay", venue:"Mathieson Brewing Company", category:"nightlife", glyph:"nightlife",
    blurb:"USA vs Paraguay on the big screens; $5 game-day pints.", price:"Free",
    location:{ bearing:50, dist:0.8, latLng:{ lat:30.417142, lng:-87.206615 } }, // UNVERIFIED — 500 E Heinberg St, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:20, end:23 } ] },
  { id:"ev-borgore", name:"Borgore", venue:"Laguna's Beach Bar + Grill", category:"music", glyph:"music",
    blurb:"Dubstep/bass headliner on the beach.", price:"$35",
    location:{ bearing:160, dist:8.5, latLng:{ lat:30.294089, lng:-87.168170 } }, // UNVERIFIED — 460 Pensacola Beach Blvd, Pensacola Beach FL
    occurrences:[ { date:"2026-06-12", start:20, end:24.5 } ] },
  { id:"ev-riptide", name:"RIPTIDE Returns", venue:"Woodsie's Hilltop Bar", category:"music", glyph:"music",
    blurb:"High-energy rock/alt/metal, night two.", price:"Free",
    location:{ bearing:300, dist:4, latLng:{ lat:30.438633, lng:-87.275051 } }, // UNVERIFIED — 5204 Mobile Hwy, Pensacola FL
    occurrences:[ { date:"2026-06-12", start:21, end:24 } ] },
  { id:"ev-beach-dogz", name:"Beach Dogz", venue:"Islander Beach Bar", category:"music", glyph:"music",
    blurb:"Upper-deck beach rock with Gulf views.", price:"Free",
    location:{ bearing:160, dist:8, latLng:{ lat:30.300890, lng:-87.171034 } }, // UNVERIFIED — 43 Via Deluna Dr, Gulf Breeze FL
    occurrences:[ { date:"2026-06-12", start:21, end:25 } ] },
];

// ---- FESTIVAL vertical (STATIC — bounded multi-venue downtown music festival demo) ----
// DEMO / DUMMY DATA. STATIC is a FICTIONAL festival built to prove the bounded-festival
// direction. The four VENUE COORDINATES below are REAL (verified close-in downtown Pensacola)
// — that is deliberate: the festival's value is the dial pointing correctly BETWEEN nearby
// venues. Everything else — every act/vendor/special name, set time, blurb, price — is
// INVENTED prototype content (this is the explicit, clearly-labeled demo exception to the
// "don't invent data" rule; it does NOT apply to the real FOOD/EVENTS verticals). Festival
// dates are computed LIVE (FESTIVAL_DAYS) so the demo never goes stale. All windows are
// authored within the 17:00–24:00 throttle range (no past-midnight). Many acts deliberately
// SHARE a venue's coords on the same night — and the 4 market vendors share IDENTICAL
// Hunter Amphitheater coords — to exercise the co-location fan.
const FEST_ANCHOR = CITIES[DEFAULT_CITY].center;
// Fallback bearing/dist are derived from the city anchor (downtown) so the dial reads right
// even before geolocation; with YOU active, planFor recomputes from the real latLng.
const fGeo = (lat, lng) => ({ bearing: geoBearing(FEST_ANCHOR.lat, FEST_ANCHOR.lng, lat, lng),
                              dist:    haversineMi(FEST_ANCHOR.lat, FEST_ANCHOR.lng, lat, lng),
                              latLng:  { lat, lng } });
// Real, verified venue coordinates.
const FV_VINYL  = [30.412691, -87.215289];  // Vinyl Music Hall
const FV_HANDLE = [30.417892, -87.214080];  // The Handlebar
const FV_BETTY  = [30.416439, -87.223341];  // Betty's on Belmont
const FV_HUNTER = [30.403187, -87.217492];  // Hunter Amphitheater at Maritime Park
const FD = FESTIVAL_DAYS.map(d => d.iso);    // [FriISO, SatISO, SunISO] — computed live
const fOcc    = (di, start, end) => [{ date: FD[di], start, end }];          // single festival day
const fOccAll = (start, end)     => FD.map(iso => ({ date: iso, start, end })); // all three days

const FESTIVAL_CATEGORIES = [
  { id:"all",    label:"ALL",          glyph:"all",     tag:null },
  { id:"music",  label:"Music",        glyph:"music",   tag:"music" },
  { id:"food",   label:"Food & Drink", glyph:"burgers", tag:"food" },
  { id:"market", label:"Market",       glyph:"markets", tag:"market" },
];

const FESTIVAL = [
  // ===== MUSIC · Vinyl Music Hall (3 Fri / 2 Sat / 2 Sun — sequential sets, same coords) =====
  { id:"st-vinyl-f1", name:"Neon Tigers", venue:"Vinyl Music Hall", category:"music", glyph:"music",
    blurb:"Synth-pop openers, all hooks and neon.", price:"$20",
    location: fGeo(...FV_VINYL), occurrences: fOcc(0, 19, 20) },
  { id:"st-vinyl-f2", name:"The Saltwater Saints", venue:"Vinyl Music Hall", category:"music", glyph:"music",
    blurb:"Gulf-coast indie rock with a horn section.", price:"$20",
    location: fGeo(...FV_VINYL), occurrences: fOcc(0, 20, 21) },
  { id:"st-vinyl-f3", name:"DELTA STATIC (headliner)", venue:"Vinyl Music Hall", category:"music", glyph:"music",
    blurb:"The festival namesake — electro-rock headline set.", price:"$28",
    location: fGeo(...FV_VINYL), occurrences: fOcc(0, 21, 22) },
  { id:"st-vinyl-s1", name:"Marigold Avenue", venue:"Vinyl Music Hall", category:"music", glyph:"music",
    blurb:"Dream-pop quartet, lush and loud.", price:"$18",
    location: fGeo(...FV_VINYL), occurrences: fOcc(1, 20, 21) },
  { id:"st-vinyl-s2", name:"Cassette Future", venue:"Vinyl Music Hall", category:"music", glyph:"music",
    blurb:"Saturday headliner — analog synthwave.", price:"$26",
    location: fGeo(...FV_VINYL), occurrences: fOcc(1, 21, 22) },
  { id:"st-vinyl-u1", name:"Sunday Choir Club", venue:"Vinyl Music Hall", category:"music", glyph:"music",
    blurb:"Gospel-soul revue to close the weekend.", price:"$15",
    location: fGeo(...FV_VINYL), occurrences: fOcc(2, 18, 19) },
  { id:"st-vinyl-u2", name:"Low Tide Orchestra", venue:"Vinyl Music Hall", category:"music", glyph:"music",
    blurb:"Cinematic post-rock finale.", price:"$18",
    location: fGeo(...FV_VINYL), occurrences: fOcc(2, 19, 20) },

  // ===== MUSIC · The Handlebar (2 Fri / 1 Sat / 1 Sun) =====
  { id:"st-handle-f1", name:"Bicycle Thieves", venue:"The Handlebar", category:"music", glyph:"music",
    blurb:"Scrappy garage-punk trio.", price:"Free",
    location: fGeo(...FV_HANDLE), occurrences: fOcc(0, 20, 21) },
  { id:"st-handle-f2", name:"Velvet Hammers", venue:"The Handlebar", category:"music", glyph:"music",
    blurb:"Late-night blues-rock barnburner.", price:"Free",
    location: fGeo(...FV_HANDLE), occurrences: fOcc(0, 21, 22) },
  { id:"st-handle-s1", name:"The Porch Lights", venue:"The Handlebar", category:"music", glyph:"music",
    blurb:"Alt-country and pedal steel.", price:"Free",
    location: fGeo(...FV_HANDLE), occurrences: fOcc(1, 21, 22) },
  { id:"st-handle-u1", name:"Acoustic Sunday w/ Jonah Reed", venue:"The Handlebar", category:"music", glyph:"music",
    blurb:"Stripped-back singer-songwriter session.", price:"Free",
    location: fGeo(...FV_HANDLE), occurrences: fOcc(2, 18, 19) },

  // ===== MUSIC · Betty's on Belmont (1 Fri / 1 Sat) =====
  { id:"st-betty-f1", name:"DJ Half-Step", venue:"Betty's on Belmont", category:"music", glyph:"music",
    blurb:"Vinyl-only disco and soul 45s.", price:"$5",
    location: fGeo(...FV_BETTY), occurrences: fOcc(0, 19, 20.5) },
  { id:"st-betty-s1", name:"Midnight Belmont Revue", venue:"Betty's on Belmont", category:"music", glyph:"music",
    blurb:"Brass-funk dance party.", price:"$5",
    location: fGeo(...FV_BETTY), occurrences: fOcc(1, 20, 21.5) },

  // ===== MUSIC · Hunter Amphitheater main stage (1 Fri / 1 Sat) =====
  { id:"st-hunter-f1", name:"Harbor Lights (main stage)", venue:"Hunter Amphitheater at Maritime Park", category:"music", glyph:"music",
    blurb:"Waterfront main-stage headliner.", price:"$30",
    location: fGeo(...FV_HUNTER), occurrences: fOcc(0, 21, 22.5) },
  { id:"st-hunter-s1", name:"Sundown Symphonic (main stage)", venue:"Hunter Amphitheater at Maritime Park", category:"music", glyph:"music",
    blurb:"Pops orchestra over the bay.", price:"$30",
    location: fGeo(...FV_HUNTER), occurrences: fOcc(1, 20.5, 22) },

  // ===== FOOD & DRINK · festival-long specials at nearby spots (UNVERIFIED placeholder coords) =====
  { id:"st-fd-pourhouse", name:"Palafox Pour House — Festival Happy Hour", venue:"Palafox Pour House", category:"food", glyph:"burgers",
    blurb:"$4 drafts and frozen palomas all festival.", price:"$",
    location: fGeo(30.41050, -87.21600), occurrences: fOccAll(17, 20) }, // UNVERIFIED — downtown placeholder
  { id:"st-fd-tacocart", name:"Garden St. Taco Cart", venue:"Garden St. Taco Cart", category:"food", glyph:"burgers",
    blurb:"Street tacos and elotes by the route.", price:"$$",
    location: fGeo(30.41180, -87.21850), occurrences: fOccAll(18, 23) }, // UNVERIFIED — downtown placeholder
  { id:"st-fd-belmontbeer", name:"Belmont Beer Garden", venue:"Belmont Beer Garden", category:"food", glyph:"burgers",
    blurb:"Open-air taps next to Betty's.", price:"$$",
    location: fGeo(30.41610, -87.22260), occurrences: fOccAll(17, 24) }, // UNVERIFIED — near Betty's placeholder
  { id:"st-fd-maritime", name:"Maritime Coffee + Cocktails", venue:"Maritime Coffee + Cocktails", category:"food", glyph:"burgers",
    blurb:"Espresso martinis steps from the amphitheater.", price:"$$",
    location: fGeo(30.40450, -87.21760), occurrences: fOccAll(17, 22) }, // UNVERIFIED — near Hunter placeholder

  // ===== MARKET · 4 vendors clustered ON the Hunter Amphitheater grounds (IDENTICAL coords) =====
  { id:"st-mkt-vintage", name:"STATIC Makers Market — Vintage", venue:"Hunter Amphitheater grounds", category:"market", glyph:"markets",
    blurb:"Curated vintage clothing and ephemera.", price:"Free",
    location: fGeo(...FV_HUNTER), occurrences: fOccAll(17, 22) },
  { id:"st-mkt-craft", name:"STATIC Makers Market — Craft", venue:"Hunter Amphitheater grounds", category:"market", glyph:"markets",
    blurb:"Local makers: ceramics, prints, jewelry.", price:"Free",
    location: fGeo(...FV_HUNTER), occurrences: fOccAll(17, 22) },
  { id:"st-mkt-records", name:"STATIC Makers Market — Records", venue:"Hunter Amphitheater grounds", category:"market", glyph:"markets",
    blurb:"Crate-digging: vinyl, tapes, gear.", price:"Free",
    location: fGeo(...FV_HUNTER), occurrences: fOccAll(17, 22) },
  { id:"st-mkt-food", name:"STATIC Makers Market — Food Trucks", venue:"Hunter Amphitheater grounds", category:"market", glyph:"markets",
    blurb:"Rotating food-truck row on the green.", price:"Free",
    location: fGeo(...FV_HUNTER), occurrences: fOccAll(17, 22) },
];

// ---- NIGHTMOVES vertical (Night Moves Music Festival — bounded single-grounds demo) ----
// REAL festival content (NOT dummy data): real acts, real food/drink/vendor names, and REAL
// site geography (coords geocoded from the Maritime Park / Hunter Amphitheater site map).
// Single-grounds, single-day festival — everything sits within ~0.08 mi of the grounds anchor,
// so the mode runs a tight 0.25 mi rim. Fallback bearing/dist are derived from the FESTIVAL
// GROUNDS anchor (nmGeo) — not downtown — so the GPS-off dial reads right; with YOU active,
// planFor recomputes from the user's real position (on-site, the dial points from where they
// stand). The single festival day is computed LIVE (NIGHTMOVES_DAYS → the upcoming Saturday),
// and nmOcc injects that ISO into every occurrence so the demo never expires. Music acts share
// each stage's coords (the music-collapse shows one act per stage at the scrub time); the two
// stages sit on opposite sides (E vs W) so the live act ping-pongs as you scrub. Food/drink
// cluster at the food court, vendors at the vendor field (the co-location fan spreads each).
const NM_ANCHOR = CITIES.nightmoves.center;
const nmGeo = (lat, lng) => ({ bearing: geoBearing(NM_ANCHOR.lat, NM_ANCHOR.lng, lat, lng),
                               dist:    haversineMi(NM_ANCHOR.lat, NM_ANCHOR.lng, lat, lng),
                               latLng:  { lat, lng } });
// Real zone coordinates (user-provided, geocoded from the site map).
const NM_MAIN      = [30.403123791508083, -87.21736916633455];  // Main Stage (Hunter Amphitheater), E
const NM_DISCOVERY = [30.402621795891573, -87.21950345441736];  // Discovery Stage, W
const NM_FOOD      = [30.403426811287847, -87.21895080392181];  // Food court (zone 7), NW
const NM_VENDOR    = [30.402826581139315, -87.21888939831118];  // Vendor field (zone 10), W
const NM_ISO = NIGHTMOVES_DAYS[0].iso;                           // the computed festival-Saturday ISO
const nmOcc = (start, end) => [{ date: NM_ISO, start, end }];    // single fixed festival day

const NIGHTMOVES_CATEGORIES = [
  { id:"all",    label:"ALL",          glyph:"all",     tag:null },
  { id:"music",  label:"Music",        glyph:"music",   tag:"music" },
  { id:"food",   label:"Food & Drink", glyph:"burgers", tag:"food" },
  { id:"market", label:"Market",       glyph:"markets", tag:"market" },
];

const NIGHTMOVES = [
  // ===== MUSIC · Main Stage (E, 76°) — 6 acts, sequential sets, shared coords =====
  { id:"nm-mus-ben-loftin", name:"Ben Loftin", venue:"Main Stage", category:"music", glyph:"music",
    blurb:"Opening the Main Stage.", price:"Festival pass",
    location: nmGeo(...NM_MAIN), occurrences: nmOcc(15.75, 16.25) },
  { id:"nm-mus-wishy", name:"Wishy", venue:"Main Stage", category:"music", glyph:"music",
    blurb:"Live on the Main Stage.", price:"Festival pass",
    location: nmGeo(...NM_MAIN), occurrences: nmOcc(16.583, 17.166) },
  { id:"nm-mus-origami-angel", name:"Origami Angel", venue:"Main Stage", category:"music", glyph:"music",
    blurb:"Live on the Main Stage.", price:"Festival pass",
    location: nmGeo(...NM_MAIN), occurrences: nmOcc(17.583, 18.333) },
  { id:"nm-mus-joyce-manor", name:"Joyce Manor", venue:"Main Stage", category:"music", glyph:"music",
    blurb:"Live on the Main Stage.", price:"Festival pass",
    location: nmGeo(...NM_MAIN), occurrences: nmOcc(18.75, 19.583) },
  { id:"nm-mus-dashboard-confessional", name:"Dashboard Confessional", venue:"Main Stage", category:"music", glyph:"music",
    blurb:"Live on the Main Stage.", price:"Festival pass",
    location: nmGeo(...NM_MAIN), occurrences: nmOcc(20.083, 21.083) },
  { id:"nm-mus-japanese-breakfast", name:"Japanese Breakfast", venue:"Main Stage", category:"music", glyph:"music",
    blurb:"Headliner — closing the Main Stage.", price:"Festival pass",
    location: nmGeo(...NM_MAIN), occurrences: nmOcc(21.75, 23.25) },

  // ===== MUSIC · Discovery Stage (W, 254°) — 5 acts, fill the Main-stage gaps =====
  { id:"nm-mus-marigolds-apprentice", name:"Marigold's Apprentice", venue:"Discovery Stage", category:"music", glyph:"music",
    blurb:"Opening the Discovery Stage.", price:"Festival pass",
    location: nmGeo(...NM_DISCOVERY), occurrences: nmOcc(16.25, 16.583) },
  { id:"nm-mus-lights-with-fire", name:"Lights with Fire", venue:"Discovery Stage", category:"music", glyph:"music",
    blurb:"Live on the Discovery Stage.", price:"Festival pass",
    location: nmGeo(...NM_DISCOVERY), occurrences: nmOcc(17.166, 17.583) },
  { id:"nm-mus-kate-dineen", name:"Kate Dineen", venue:"Discovery Stage", category:"music", glyph:"music",
    blurb:"Live on the Discovery Stage.", price:"Festival pass",
    location: nmGeo(...NM_DISCOVERY), occurrences: nmOcc(18.333, 18.75) },
  { id:"nm-mus-ego-death", name:"Ego Death", venue:"Discovery Stage", category:"music", glyph:"music",
    blurb:"Live on the Discovery Stage.", price:"Festival pass",
    location: nmGeo(...NM_DISCOVERY), occurrences: nmOcc(19.583, 20.083) },
  { id:"nm-mus-mspaint", name:"MSPAINT", venue:"Discovery Stage", category:"music", glyph:"music",
    blurb:"Closing the Discovery Stage.", price:"Festival pass",
    location: nmGeo(...NM_DISCOVERY), occurrences: nmOcc(21.083, 21.75) },

  // ===== FOOD & DRINK (8) · Food court (NW) — shared coords, staggered closes =====
  { id:"nm-fd-pcola-rolla", name:"Pcola Rolla", venue:"Food Court", category:"food", glyph:"burgers",
    blurb:"Festival food vendor.", price:"$$",
    location: nmGeo(...NM_FOOD), occurrences: nmOcc(15.0, 22.0) },
  { id:"nm-fd-pretty-baked", name:"Pretty Baked", venue:"Food Court", category:"food", glyph:"burgers",
    blurb:"Festival food vendor.", price:"$$",
    location: nmGeo(...NM_FOOD), occurrences: nmOcc(15.0, 22.5) },
  { id:"nm-fd-parlor-doughnuts", name:"Parlor Doughnuts", venue:"Food Court", category:"food", glyph:"burgers",
    blurb:"Festival food vendor.", price:"$$",
    location: nmGeo(...NM_FOOD), occurrences: nmOcc(15.0, 21.75) },
  { id:"nm-fd-the-handlebar", name:"The Handlebar", venue:"Food Court", category:"food", glyph:"burgers",
    blurb:"Festival bar.", price:"$$",
    location: nmGeo(...NM_FOOD), occurrences: nmOcc(15.0, 23.25) },
  { id:"nm-fd-tame-coffee", name:"TAME Coffee", venue:"Food Court", category:"food", glyph:"burgers",
    blurb:"Festival coffee bar.", price:"$$",
    location: nmGeo(...NM_FOOD), occurrences: nmOcc(15.0, 23.0) },
  { id:"nm-fd-fresh-squeezed-lemonade", name:"Fresh Squeezed Lemonade", venue:"Food Court", category:"food", glyph:"burgers",
    blurb:"Festival drink stand.", price:"$",
    location: nmGeo(...NM_FOOD), occurrences: nmOcc(15.0, 22.5) },

  // ===== MARKET (7) · Vendor field (W) — IDENTICAL coords (the fan's stress test) =====
  { id:"nm-mkt-perfect-day-bookstore", name:"Perfect Day Bookstore", venue:"Vendor Field", category:"market", glyph:"markets",
    blurb:"Festival vendor.", price:"Free",
    location: nmGeo(...NM_VENDOR), occurrences: nmOcc(15.0, 20.0) },
  { id:"nm-mkt-fable-fashion-co", name:"Fable Fashion Co.", venue:"Vendor Field", category:"market", glyph:"markets",
    blurb:"Festival vendor.", price:"Free",
    location: nmGeo(...NM_VENDOR), occurrences: nmOcc(15.0, 19.75) },
  { id:"nm-mkt-lucys-retro", name:"Lucy's Retro", venue:"Vendor Field", category:"market", glyph:"markets",
    blurb:"Festival vendor.", price:"Free",
    location: nmGeo(...NM_VENDOR), occurrences: nmOcc(15.0, 20.25) },
  { id:"nm-mkt-mother-truckin-hat-bar", name:"The Mother Truckin Hat Bar", venue:"Vendor Field", category:"market", glyph:"markets",
    blurb:"Festival vendor.", price:"Free",
    location: nmGeo(...NM_VENDOR), occurrences: nmOcc(15.0, 20.25) },
  { id:"nm-mkt-scene-pensacola", name:"Scene Pensacola", venue:"Vendor Field", category:"market", glyph:"markets",
    blurb:"Festival vendor.", price:"Free",
    location: nmGeo(...NM_VENDOR), occurrences: nmOcc(15.0, 19.75) },
];

// Normalise an event into the shared entity interface so Field/DYNAMO helpers work
// unchanged. Events and trucks now share the date-aware model, so recurrence/occurrences/
// exceptions carry straight through; only the single `location` is wrapped into locations[].
// The original event is kept as _event for EventCard to read.
function eventToEntity(ev) {
  return {
    id: ev.id,
    name: ev.name,
    glyph: ev.glyph,
    cravings: [ev.category],   // matches EVENT_CATEGORIES tag
    locations: [{ name: ev.venue, bearing: ev.location.bearing, dist: ev.location.dist,
                  latLng: ev.location.latLng }],
    recurrence: ev.recurrence,
    occurrences: ev.occurrences,
    exceptions: ev.exceptions,
    _event: ev,
  };
}

window.DYNAMO = {
  DAY_START, DAY_END, DEFAULT_RIM_MI,
  fmtTime, fmtHourShort, fmtHM, clamp, lerp, smoothstep,
  compassDir, planFor, powerAt, statusAt, liveStatusAt, isLiveNow, bodyPos, walkMin, driveMin, travelEstimate, fmtMiles, upcomingWindows, windowTimes,
  eventToEntity, haversineMi, geoBearing, geoDestination,
  todayHour, realNowHour, FESTIVAL_DAYS, NIGHTMOVES_DAYS,
};
window.TRUCKS = TRUCKS;
window.CRAVINGS = CRAVINGS;
window.DAYS = DAYS;
window.EVENTS = EVENTS;
window.EVENT_CATEGORIES = EVENT_CATEGORIES;
window.FESTIVAL = FESTIVAL;
window.FESTIVAL_CATEGORIES = FESTIVAL_CATEGORIES;
window.NIGHTMOVES = NIGHTMOVES;
window.NIGHTMOVES_CATEGORIES = NIGHTMOVES_CATEGORIES;
window.CITIES = CITIES;
window.DEFAULT_CITY = DEFAULT_CITY;
