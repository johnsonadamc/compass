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

/* TRUCKS — each has locations[] (named stops w/ bearing+dist+latLng) and a recurrence[]
   weekly pattern (weekdays use getDay: 0=Sun…6=Sat). The seed trucks are genuinely
   recurring, so they carry recurrence only (no dated occurrences); real one-off dates
   arrive as occurrences[] later. latLng values are DERIVED FROM ESTIMATED GEOMETRY —
   not verified; replace with real geocoded coordinates once confirmed. */
const TRUCKS = [
  { id:"bao", name:"BAO & ARROW", cuisine:"Steamed buns", glyph:"asian", price:2,
    cravings:["asian"], signature:"Five-spice pork bao", blurb:"Pillowy buns, folded to order.",
    favorite:true,
    locations:[
      { name:"Palafox & Garden", bearing:350, dist:0.6,
        latLng:{ lat:30.418252, lng:-87.218649 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
      { name:"Seville Square",   bearing:300, dist:1.1,
        latLng:{ lat:30.417659, lng:-87.232888 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    ],
    recurrence:[
      { weekdays:[1,2,3,5], start:11, end:15, loc:0 },  // Mon,Tue,Wed,Fri @ Palafox & Garden
      { weekdays:[4],       start:11, end:15, loc:1 },  // Thu @ Seville Square
      { weekdays:[6],       start:12, end:16, loc:1 },  // Sat @ Seville Square
    ] },

  { id:"green", name:"VERDIGRIS", cuisine:"Grain bowls", glyph:"global", price:2,
    cravings:["global"], signature:"Charred broccolini bowl", blurb:"Market greens, big crunch.",
    favorite:false,
    locations:[
      { name:"Wright & Spring", bearing:312, dist:1.05,
        latLng:{ lat:30.419868, lng:-87.229996 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
      { name:"Bayfront Pkwy",   bearing:150, dist:1.4,
        latLng:{ lat:30.392152, lng:-87.205155 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    ],
    recurrence:[
      { weekdays:[1,2,3,4], start:10.5, end:16, loc:0 },  // Mon–Thu @ Wright & Spring
      { weekdays:[5],       start:10.5, end:16, loc:1 },  // Fri @ Bayfront Pkwy
      { weekdays:[6],       start:11,   end:15, loc:1 },  // Sat @ Bayfront Pkwy
    ] },

  { id:"gyro", name:"AEGEAN WHEELS", cuisine:"Greek gyros", glyph:"tacos", price:2,
    cravings:["tacos"], signature:"Lamb gyro, tzatziki", blurb:"Spit-roasted all day long.",
    favorite:false,
    locations:[
      { name:"12th & Cervantes", bearing:36, dist:1.3,
        latLng:{ lat:30.424921, lng:-87.204075 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    ],
    recurrence:[
      { weekdays:[1,2,3,4,5,6], start:11, end:21, loc:0 },  // Mon–Sat @ 12th & Cervantes
      { weekdays:[0],           start:12, end:20, loc:0 },  // Sun @ 12th & Cervantes
    ] },

  { id:"cluck", name:"CLUCK TRUCK", cuisine:"Nashville hot", glyph:"burgers", price:2,
    cravings:["burgers"], signature:"Hot honey tenders", blurb:"Brined 24 hrs, dredged loud.",
    favorite:false,
    locations:[
      { name:"Gregory & 9th",     bearing:80,  dist:1.55,
        latLng:{ lat:30.413593, lng:-87.191283 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
      { name:"Palafox & Romana",  bearing:110, dist:0.8,
        latLng:{ lat:30.405739, lng:-87.204285 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    ],
    recurrence:[
      { weekdays:[2,3], start:11, end:22, loc:0 },  // Tue,Wed @ Gregory & 9th
      { weekdays:[4,5], start:11, end:22, loc:1 },  // Thu,Fri @ Palafox & Romana
      { weekdays:[6],   start:12, end:22, loc:1 },  // Sat @ Palafox & Romana
      { weekdays:[0],   start:12, end:21, loc:0 },  // Sun @ Gregory & 9th
    ] },

  { id:"tacos", name:"BRASA", cuisine:"Al pastor tacos", glyph:"tacos", price:1,
    cravings:["tacos"], signature:"Al pastor + piña", blurb:"Trompo carved off the flame.",
    favorite:true,
    locations:[
      { name:"Palafox & Garden", bearing:120, dist:0.72,
        latLng:{ lat:30.404489, lng:-87.206437 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
      { name:"Seville Square",   bearing:200, dist:0.9,
        latLng:{ lat:30.39746,  lng:-87.222065 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    ],
    recurrence:[
      { weekdays:[1,2,3,4], start:11, end:22, loc:0 },  // Mon–Thu @ Palafox & Garden
      { weekdays:[5],       start:11, end:22, loc:1 },  // Fri @ Seville Square
      { weekdays:[6],       start:12, end:22, loc:1 },  // Sat @ Seville Square
      { weekdays:[0],       start:12, end:22, loc:0 },  // Sun @ Palafox & Garden
    ] },

  { id:"reel", name:"REEL CATCH", cuisine:"Gulf seafood", glyph:"seafood", price:3,
    cravings:["seafood"], signature:"Royal red shrimp roll", blurb:"Off the boat this morning.",
    favorite:false,
    locations:[
      { name:"Bayfront Marina", bearing:176, dist:1.1,
        latLng:{ lat:30.393818, lng:-87.215613 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    ],
    recurrence:[
      { weekdays:[2,3,4,5,6], start:17, end:22, loc:0 },  // Tue–Sat @ Bayfront Marina
      { weekdays:[0],         start:17, end:21, loc:0 },  // Sun @ Bayfront Marina
    ] },

  { id:"sugar", name:"SUGAR THEORY", cuisine:"Soft serve", glyph:"sweets", price:1,
    cravings:["sweets"], signature:"Brown-butter twist", blurb:"Churned in small batches.",
    favorite:false,
    locations:[
      { name:"Plaza Ferdinand", bearing:222, dist:0.55,
        latLng:{ lat:30.403784, lng:-87.223076 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    ],
    recurrence:[
      { weekdays:[1,2,3,4,5,6], start:12, end:22, loc:0 },  // Mon–Sat @ Plaza Ferdinand
      { weekdays:[0],           start:12, end:20, loc:0 },  // Sun @ Plaza Ferdinand
    ] },

  { id:"roast", name:"MERIDIAN ROASTERS", cuisine:"Coffee & buns", glyph:"coffee", price:1,
    cravings:["coffee"], signature:"Cardamom cold brew", blurb:"First light, first pour.",
    favorite:false,
    locations:[
      { name:"Intendencia & Jeff.", bearing:270, dist:0.9,
        latLng:{ lat:30.409699, lng:-87.232004 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
      { name:"Wright St Market",   bearing:300, dist:1.2,
        latLng:{ lat:30.418383, lng:-87.234342 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    ],
    recurrence:[
      { weekdays:[1,2,3,4,5], start:7, end:14, loc:0 },  // Mon–Fri @ Intendencia & Jeff.
      { weekdays:[6],         start:8, end:14, loc:1 },  // Sat @ Wright St Market
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
// bearing+dist -> field offset for the day (null if off)
// Optional userLat/userLng: threaded to planFor for geo-accurate bearing/dist.
function bodyPos(truck, fieldR, day, userLat, userLng) {
  const p = planFor(truck, day, userLat, userLng); if (!p) return null;
  const rad = (p.bearing - 90) * Math.PI / 180;
  const rr = clamp(p.dist / DEFAULT_RIM_MI, 0, 1) * fieldR;
  return { x: Math.cos(rad)*rr, y: Math.sin(rad)*rr, r: rr };
}
const walkMin = (d) => Math.max(2, Math.round(d * 18));

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
  compassDir, planFor, powerAt, statusAt, bodyPos, walkMin, upcomingWindows, windowTimes,
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
