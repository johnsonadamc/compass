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
const DAY_END = 22;    // 22:00

function fmtTime(t) {
  let h = Math.floor(t);
  const m = Math.round((t - h) * 60);
  const ampm = h >= 12 ? "PM" : "AM";
  let hh = h % 12; if (hh === 0) hh = 12;
  return { hh, mm: String(m).padStart(2, "0"), ampm, label: `${hh}:${String(m).padStart(2,"0")} ${ampm}` };
}
const fmtHourShort = (h) => `${(h % 12) || 12}${h >= 12 ? "P" : "A"}`;
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

// recurrence: [{ weekdays:[…] (getDay 0=Sun…6=Sat), start, end }] — decimal hours.
// location.latLng values are DERIVED FROM ESTIMATED GEOMETRY — not verified;
// replace with real geocoded coordinates once confirmed.
const EVENTS = [
  { id:"ev-jazz", name:"JAZZ AT THE SQUARE", venue:"Seville Square",
    category:"music", glyph:"music", price:"Free",
    blurb:"Live jazz in the open air. Bring a blanket.",
    location:{ bearing:308, dist:1.1, latLng:{ lat:30.419501, lng:-87.231448 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    recurrence:[
      { weekdays:[2], start:18, end:21 },  // Tue
      { weekdays:[0], start:17, end:21 },  // Sun
    ] },

  { id:"ev-market", name:"PALAFOX MARKET", venue:"Palafox Street",
    category:"markets", glyph:"markets", price:"Free",
    blurb:"Local vendors, produce, and handmade goods.",
    location:{ bearing:350, dist:0.6, latLng:{ lat:30.418252, lng:-87.218649 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    recurrence:[{ weekdays:[1], start:8, end:14 }] },  // Mon

  { id:"ev-comedy", name:"STAND-UP NIGHT", venue:"The Handlebar",
    category:"comedy", glyph:"comedy", price:"$10",
    blurb:"Local comics. No cover if you buy a drink.",
    location:{ bearing:85, dist:0.9, latLng:{ lat:30.410834, lng:-87.201854 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    recurrence:[{ weekdays:[6], start:20, end:22 }] },  // Sat

  { id:"ev-yoga", name:"YOGA ON THE WATERFRONT", venue:"Bayfront Park",
    category:"classes", glyph:"classes", price:"Free",
    blurb:"Sunrise flow, mats provided.",
    location:{ bearing:176, dist:1.1, latLng:{ lat:30.393818, lng:-87.215613 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    recurrence:[{ weekdays:[0,2,4], start:7, end:8.5 }] },  // Sun,Tue,Thu

  { id:"ev-kids", name:"KIDS CRAFT HOUR", venue:"The Art Trail",
    category:"kids", glyph:"kids", price:"Free",
    blurb:"Drop-in craft projects for ages 4–10.",
    location:{ bearing:222, dist:0.55, latLng:{ lat:30.403784, lng:-87.223076 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    recurrence:[{ weekdays:[3,5], start:10, end:12 }] },  // Wed,Fri

  { id:"ev-rooftop", name:"ROOFTOP SETS", venue:"Commerce St. Bar",
    category:"nightlife", glyph:"nightlife", price:"$5",
    blurb:"DJ sets with a view of the bay.",
    location:{ bearing:112, dist:0.75, latLng:{ lat:30.405633, lng:-87.205231 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    recurrence:[{ weekdays:[0,6], start:21, end:22 }] },  // Sat,Sun

  { id:"ev-gallery", name:"GALLERY FIRST FRIDAY", venue:"Artel Gallery",
    category:"arts", glyph:"arts", price:"Free",
    blurb:"New show opening. Wine and small plates.",
    location:{ bearing:290, dist:0.8, latLng:{ lat:30.413659, lng:-87.229516 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    recurrence:[{ weekdays:[6], start:18, end:21 }] },  // Sat

  // ── EVENTS BATCH (date-aware model) ──
  // All events are single-venue → occurrence/recurrence rows omit `loc` (defaults to 0).
  // weekdays use JS getDay(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat.
  // glyph === category (matches the seed convention; eventToEntity reads ev.glyph).
  // latLng = ESTIMATED from named address vs the Garden & Palafox anchor — NOT geocoded, UNVERIFIED.
  // Dated occurrences are RE-DATED to the upcoming weekend (2026-06-12/-13/-14) FOR TESTING — synthetic dates.

  // ───────── WEEKLY (recurrence — truthful, no fake dates) ─────────

  { id:"ev-blues-on-the-blocks", name:"Blues on the Blocks", venue:"Five Sisters Blues Cafe", category:"music", glyph:"music",
    blurb:"Weekend-kickoff blues, every Friday.", price:"Free",
    location:{ bearing:315, dist:0.6, latLng:{ lat:30.4180, lng:-87.2235 } }, // ESTIMATED — 421 W Belmont St; UNVERIFIED
    recurrence:[ { weekdays:[5], start:18, end:21 } ] },

  { id:"ev-bottle-shop-wine", name:"Friday Night Wine Tastings on Baylen", venue:"The Bottle Shop", category:"nightlife", glyph:"nightlife",
    blurb:"Ten bottle-shop pours in the JUSTA BAR courtyard, every Friday.", price:"Free",
    location:{ bearing:215, dist:0.2, latLng:{ lat:30.4108, lng:-87.2188 } }, // ESTIMATED — 120 S Baylen St; UNVERIFIED
    recurrence:[ { weekdays:[5], start:17, end:19 } ] },

  { id:"ev-love-island-watch", name:"Love Island Watch Party", venue:"Margaritas Fusion", category:"nightlife", glyph:"nightlife",
    blurb:"Themed cocktails and episodes on the big screens, every Friday & Monday.", price:"Free",
    location:{ bearing:358, dist:5.7, latLng:{ lat:30.4950, lng:-87.2180 } }, // ESTIMATED — 7250 Plantation Rd; UNVERIFIED
    recurrence:[ { weekdays:[5,1], start:19, end:22 } ] }, // multi-weekday: Fri + Mon

  { id:"ev-healthy-cooking-coop", name:"Healthy Cooking Class w/ LauraLee", venue:"Ever'man Cooperative", category:"classes", glyph:"classes",
    blurb:"Weekly Mediterranean / anti-inflammatory dish demo.", price:"$5–$10",
    location:{ bearing:270, dist:0.2, latLng:{ lat:30.4128, lng:-87.2200 } }, // ESTIMATED — 315 W Garden St; UNVERIFIED
    recurrence:[ { weekdays:[5], start:11, end:12 } ] },

  { id:"ev-steam-kids", name:"Cooking with S.T.E.A.M.", venue:"The Makery (Pace)", category:"kids", glyph:"kids",
    blurb:"Free weekly science-meets-cooking activity for kids.", price:"Free",
    location:{ bearing:25, dist:13.5, latLng:{ lat:30.5950, lng:-87.1500 } }, // ESTIMATED — 4857 W Spencerfield Rd, Pace; UNVERIFIED — past rim
    recurrence:[ { weekdays:[5], start:10, end:11 } ] },

  { id:"ev-karaoke-prost", name:"Karaoke at The Prost Office", venue:"The Prost Office Brewery (Milton)", category:"nightlife", glyph:"nightlife",
    blurb:"Weekly karaoke with Crystal Clear Sounds, craft beer and bites.", price:"Free",
    location:{ bearing:40, dist:20, latLng:{ lat:30.6330, lng:-87.0400 } }, // ESTIMATED — 6821 Caroline St, Milton; UNVERIFIED — far past rim
    recurrence:[ { weekdays:[5], start:19, end:22 } ] },

  { id:"ev-palafox-market", name:"Palafox Market", venue:"Downtown Pensacola (MLK Plaza & Plaza Ferdinand)", category:"markets", glyph:"markets",
    blurb:"Award-winning farmers & makers market, 200+ local vendors, every Saturday.", price:"Free",
    location:{ bearing:180, dist:0.1, latLng:{ lat:30.4115, lng:-87.2168 } }, // ESTIMATED — downtown Palafox; UNVERIFIED
    recurrence:[ { weekdays:[6], start:9, end:14 } ] },

  { id:"ev-glenn-parker-band", name:"Glenn Parker Band", venue:"Five Sisters Blues Cafe", category:"music", glyph:"music",
    blurb:"Soulful live blues, every Saturday.", price:"Free",
    location:{ bearing:315, dist:0.6, latLng:{ lat:30.4180, lng:-87.2235 } }, // ESTIMATED — 421 W Belmont St; UNVERIFIED
    recurrence:[ { weekdays:[6], start:18, end:22 } ] },

  { id:"ev-dj-saturdays", name:"DJ Saturdays", venue:"O'Riley's Irish Pub Downtown", category:"nightlife", glyph:"nightlife",
    blurb:"Live DJ spinning crowd favorites late, every Saturday.", price:"Free",
    location:{ bearing:180, dist:0.25, latLng:{ lat:30.4095, lng:-87.2168 } }, // ESTIMATED — 321 S Palafox St; UNVERIFIED
    recurrence:[ { weekdays:[6], start:22, end:23.75 } ] }, // fully past the 22:00 throttle ceiling

  { id:"ev-storytime-am", name:"Storytime & Snacktime (Morning)", venue:"The Makery (Pace)", category:"kids", glyph:"kids",
    blurb:"Food-themed story plus a treat — 10 AM sitting, Saturdays.", price:"Free",
    location:{ bearing:25, dist:13.5, latLng:{ lat:30.5950, lng:-87.1500 } }, // ESTIMATED — 4857 W Spencerfield Rd, Pace; UNVERIFIED — past rim
    recurrence:[ { weekdays:[6], start:10, end:10.5 } ] }, // split from the 2 PM sitting (one window per entity per day)

  { id:"ev-storytime-pm", name:"Storytime & Snacktime (Afternoon)", venue:"The Makery (Pace)", category:"kids", glyph:"kids",
    blurb:"Food-themed story plus a treat — 2 PM sitting, Saturdays.", price:"Free",
    location:{ bearing:25, dist:13.5, latLng:{ lat:30.5950, lng:-87.1500 } }, // ESTIMATED — 4857 W Spencerfield Rd, Pace; UNVERIFIED — past rim
    recurrence:[ { weekdays:[6], start:14, end:14.5 } ] }, // companion to the 10 AM entry

  // ───────── DATED one-offs (re-dated to the upcoming weekend FOR TESTING) ─────────

  { id:"ev-bodysnatcher", name:"Bodysnatcher", venue:"Vinyl Music Hall", category:"music", glyph:"music",
    blurb:"Deathcore headliner with 200 Stab Wounds, Gates To Hell & Bodybox. All ages.", price:"$25+",
    location:{ bearing:185, dist:0.15, latLng:{ lat:30.4105, lng:-87.2169 } }, // ESTIMATED — 2 S Palafox St; UNVERIFIED
    occurrences:[ { date:"2026-06-12", start:18, end:22 } ] }, // one-off (orig Fri 6/5)

  { id:"ev-mushroom-cloud", name:"Mushroom Cloud", venue:"The Handlebar", category:"music", glyph:"music",
    blurb:"Heavy bass night with Hydyne, Matty Ice & Thaimex; live art and vendors. 18+.", price:"$30",
    location:{ bearing:40, dist:0.5, latLng:{ lat:30.4170, lng:-87.2120 } }, // ESTIMATED — 319 N Tarragona St; UNVERIFIED
    occurrences:[ { date:"2026-06-12", start:20, end:22 } ] }, // one-off; runs past 22

  { id:"ev-comedy-arceneaux", name:"Stand-Up Comedy Night: Tyler Arceneaux", venue:"Bagelheads", category:"comedy", glyph:"comedy",
    blurb:"Gulf Coast comics + headliner Tyler Arceneaux. BYOB, free parking.", price:"$5–$25",
    location:{ bearing:60, dist:1.1, latLng:{ lat:30.4205, lng:-87.2030 } }, // ESTIMATED — 916 E Gregory St; UNVERIFIED
    occurrences:[ { date:"2026-06-12", start:20.5, end:22 } ] }, // one-off

  { id:"ev-sourdough-101", name:"Sourdough 101 Beginners Class", venue:"The Makery (Pace)", category:"classes", glyph:"classes",
    blurb:"All-inclusive hands-on intro to sourdough; take home a starter and a loaf.", price:"$90",
    location:{ bearing:25, dist:13.5, latLng:{ lat:30.5950, lng:-87.1500 } }, // ESTIMATED — 4857 W Spencerfield Rd, Pace; UNVERIFIED — past rim
    occurrences:[ { date:"2026-06-12", start:18, end:20 } ] }, // one-off

  { id:"ev-didgeridoo-biglagoon", name:"Didgeridoo Down Under", venue:"Big Lagoon State Park", category:"kids", glyph:"kids",
    blurb:"Energetic interactive show blending Australian music, comedy and storytelling.", price:"$0–$6",
    location:{ bearing:240, dist:13, latLng:{ lat:30.3080, lng:-87.4050 } }, // ESTIMATED — Big Lagoon State Park; UNVERIFIED — past rim
    occurrences:[ { date:"2026-06-12", start:13, end:14 } ] }, // one-off

  { id:"ev-first-fridays-artwalk", name:"First Fridays Art Walk", venue:"Joe Hobbs Gallery", category:"arts", glyph:"arts",
    blurb:"Downtown gallery walk celebrating local artists and creative spaces.", price:"Free",
    location:{ bearing:150, dist:0.35, latLng:{ lat:30.4100, lng:-87.2130 } }, // ESTIMATED — 260 S Tarragona St; UNVERIFIED
    occurrences:[ { date:"2026-06-12", start:17.5, end:21 } ] }, // MONTHLY (really 1st Fri) — test-dated as single row

  { id:"ev-arts-market-first-fri", name:"Pensacola Arts Market: First Fridays", venue:"Gary's Brewery & Biergarten", category:"markets", glyph:"markets",
    blurb:"Open-air handmade art, vintage finds and baked goods with live music.", price:"Free",
    location:{ bearing:5, dist:2.5, latLng:{ lat:30.4480, lng:-87.2130 } }, // ESTIMATED — 208 Newman Ave; UNVERIFIED
    occurrences:[ { date:"2026-06-12", start:16, end:21 } ] }, // MONTHLY — test-dated as single row

  { id:"ev-kitten-yoga", name:"Kitten Yoga", venue:"East Bay Dog Spot (Gulf Breeze)", category:"classes", glyph:"classes",
    blurb:"Guided yoga surrounded by adoptable kittens; proceeds benefit the animal shelter.", price:"$25",
    location:{ bearing:120, dist:7.5, latLng:{ lat:30.3720, lng:-87.1050 } }, // ESTIMATED — 4645 Gulf Breeze Pkwy; UNVERIFIED — past rim
    occurrences:[ { date:"2026-06-13", start:15, end:16 } ] }, // one-off

  { id:"ev-boozy-sundae", name:"Boozy Sundae Decorating Class", venue:"Tipsy Scoop Barlour", category:"classes", glyph:"classes",
    blurb:"Build a boozy ice cream sundae downtown; keepsake glass + welcome drink. 21+.", price:"$35",
    location:{ bearing:5, dist:0.25, latLng:{ lat:30.4160, lng:-87.2168 } }, // ESTIMATED — 194 N Palafox St; UNVERIFIED
    occurrences:[ { date:"2026-06-13", start:16, end:17 } ] }, // one-off

  { id:"ev-sinatra-tribute", name:"Sinatra Tribute Dinner Show", venue:"La Sala Event Center (Navarre)", category:"music", glyph:"music",
    blurb:"Josh Sirten & The Tuxedo Cats perform Sinatra classics with dinner. 21+.", price:"$45",
    location:{ bearing:92, dist:20, latLng:{ lat:30.4020, lng:-86.8800 } }, // ESTIMATED — 3352 Hwy 87 S, Navarre; UNVERIFIED — far past rim
    occurrences:[ { date:"2026-06-13", start:18, end:22 } ] }, // one-off

  { id:"ev-family-fun-day", name:"Family Fun Day", venue:"Salt & Strength Fitness", category:"kids", glyph:"kids",
    blurb:"Community workout, shaved ice, bounce house, face painting and games.", price:"Free",
    location:{ bearing:12, dist:6, latLng:{ lat:30.4980, lng:-87.2050 } }, // ESTIMATED — 2501 E Olive Rd; UNVERIFIED — near/past rim
    occurrences:[ { date:"2026-06-13", start:9, end:12 } ] }, // one-off

  { id:"ev-summer-splash", name:"Summer Splash", venue:"Barrancas Ballfields (NAS Pensacola)", category:"kids", glyph:"kids",
    blurb:"Giant water slides, water-gun zone and toddler play area. Free for DoD cardholders.", price:"Free (DoD)",
    location:{ bearing:230, dist:7.5, latLng:{ lat:30.3550, lng:-87.3000 } }, // ESTIMATED — 80 Slemmer Ave, NAS; UNVERIFIED — past rim
    occurrences:[ { date:"2026-06-13", start:11, end:14 } ] }, // one-off

  { id:"ev-west-coast-swing", name:"Saturday Night West Coast Swing", venue:"Ragon Hall", category:"classes", glyph:"classes",
    blurb:"Workshops + social dance with Pensacola Swing Dance Society; free beginner track.", price:"$15–$35",
    location:{ bearing:40, dist:3.2, latLng:{ lat:30.4450, lng:-87.1800 } }, // ESTIMATED — 2600 Stratford Rd; UNVERIFIED
    occurrences:[ { date:"2026-06-13", start:18, end:22 } ] }, // MONTHLY — test-dated; really runs to 23.5 (clipped at 22)

  { id:"ev-improvable-cause", name:"Improvable Cause: Live Improv", venue:"Pensacola Little Theatre", category:"comedy", glyph:"comedy",
    blurb:"Monthly unscripted comedy built entirely from audience suggestions.", price:"$10",
    location:{ bearing:165, dist:0.4, latLng:{ lat:30.4085, lng:-87.2140 } }, // ESTIMATED — 108 E Main St; UNVERIFIED
    occurrences:[ { date:"2026-06-13", start:22, end:23.5 } ] }, // MONTHLY — test-dated; at the 22:00 throttle ceiling

  // ───────── MULTI-DAY (dated; Sunday leg is past the current window edge) ─────────

  { id:"ev-summer-cider-fest", name:"Summer Cider Fest", venue:"Coastal County Brewing Company", category:"nightlife", glyph:"nightlife",
    blurb:"Three-day tap takeover: build-your-own cider flights, a can release and live local music.", price:"Varies",
    location:{ bearing:15, dist:6.1, latLng:{ lat:30.4980, lng:-87.2000 } }, // ESTIMATED — 3041 E Olive Rd; UNVERIFIED — near/past rim
    occurrences:[
      { date:"2026-06-12", start:14, end:22 },
      { date:"2026-06-13", start:14, end:22 },
      { date:"2026-06-14", start:14, end:22 }, // one day past the current 7-day window edge — won't show until window rolls
    ] },
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
