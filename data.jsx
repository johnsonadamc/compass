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
function planFor(entity, day, userLat, userLng) {
  const dd = DAYS[day]; if (!dd) return null;
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

// power 0..1 over the service window on a day with soft ramps
function powerAt(truck, t, day) {
  const p = planFor(truck, day); if (!p) return 0;
  const edge = 0.45;
  const a = smoothstep(p.open - edge, p.open + edge*0.5, t);
  const b = 1 - smoothstep(p.close - edge*0.5, p.close + edge, t);
  return clamp(Math.min(a, b), 0, 1);
}
function statusAt(truck, t, day) {
  const p = planFor(truck, day); if (!p) return "off";
  const pow = powerAt(truck, t, day);
  if (pow <= 0.03) return t < p.open ? "soon" : "closed";
  if (t > p.open && t < p.open + 0.6) return "opening";
  if (t > p.close - 0.75 && t < p.close) return "closing";
  return "open";
}
// Live status for a card's status line — now-relative claims ONLY on the real
// present day (day 0), computed against the real clock (realNowHour), NOT the
// scrubbed throttle. Mirrors the watchlist HAPPENING NOW rule. Returns a neutral
// statusAt token when viewing real today, or null on any other day (the caller
// then shows neutral viewed-day schedule info instead of a live claim).
function liveStatusAt(entity, day) {
  if (day !== 0) return null;
  return statusAt(entity, realNowHour, 0);
}
// bearing+dist -> field offset for the day (null if off)
// Optional userLat/userLng: threaded to planFor for geo-accurate bearing/dist.
function bodyPos(truck, fieldR, day, userLat, userLng) {
  const p = planFor(truck, day, userLat, userLng); if (!p) return null;
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
function upcomingWindows(truck, fromDay, fromT, max = 3, userLat, userLng) {
  const out = [];
  for (let d = fromDay; d < 7 && out.length < max; d++) {
    const p = planFor(truck, d, userLat, userLng); if (!p) continue;
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
  compassDir, planFor, powerAt, statusAt, liveStatusAt, bodyPos, walkMin, driveMin, travelEstimate, fmtMiles, upcomingWindows, windowTimes,
  eventToEntity, haversineMi, geoBearing, geoDestination,
  todayHour, realNowHour,
};
window.TRUCKS = TRUCKS;
window.CRAVINGS = CRAVINGS;
window.DAYS = DAYS;
window.EVENTS = EVENTS;
window.EVENT_CATEGORIES = EVENT_CATEGORIES;
window.CITIES = CITIES;
window.DEFAULT_CITY = DEFAULT_CITY;
