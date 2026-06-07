// data.jsx — DYNAMO content + machine model (with weekly schedules & roaming).
// Exposes window.DYNAMO, window.TRUCKS, window.CRAVINGS, window.DAYS,
//           window.EVENTS, window.EVENT_CATEGORIES, window.CITIES, window.DEFAULT_CITY.

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

/* WEEK — day 0 is "today". Deterministic so the prototype is stable.
   Today = Tuesday the 23rd. */
const WEEKDAYS = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const BASE_WEEKDAY = 2;  // Tuesday
const BASE_DATE = 23;
const DAYS = Array.from({ length: 7 }, (_, d) => {
  const wd = (BASE_WEEKDAY + d) % 7;
  return {
    idx: d,
    key: d === 0 ? "TODAY" : WEEKDAYS[wd],
    weekday: WEEKDAYS[wd],
    date: ((BASE_DATE + d - 1) % 30) + 1,
    today: d === 0,
  };
});

/* Default outer-ring distance in miles. Drives the initial zoom level, the
   pinch-zoom bounds (proportional), and emblem-size scaling in field.jsx.
   Change this one value to shift all rim-related behaviour together. */
const DEFAULT_RIM_MI = 5;

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
  },
};
const DEFAULT_CITY = "pensacola";

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

/* schedule entry helper: e(locIdx, open, close) | null (off that day) */
const e = (loc, open, close) => ({ loc, open, close });

/* TRUCKS — each has locations[] (named stops w/ bearing+dist+latLng) and a 7-day week.
   latLng values are DERIVED FROM ESTIMATED GEOMETRY — not verified;
   replace with real geocoded coordinates once confirmed. */
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
    week:[ e(0,11,15), e(0,11,15), e(1,11,15), e(0,11,15), e(1,12,16), null, e(0,11,15) ] },

  { id:"green", name:"VERDIGRIS", cuisine:"Grain bowls", glyph:"global", price:2,
    cravings:["global"], signature:"Charred broccolini bowl", blurb:"Market greens, big crunch.",
    favorite:false,
    locations:[
      { name:"Wright & Spring", bearing:312, dist:1.05,
        latLng:{ lat:30.419868, lng:-87.229996 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
      { name:"Bayfront Pkwy",   bearing:150, dist:1.4,
        latLng:{ lat:30.392152, lng:-87.205155 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    ],
    week:[ e(0,10.5,16), e(0,10.5,16), e(0,10.5,16), e(1,10.5,16), e(1,11,15), null, e(0,10.5,16) ] },

  { id:"gyro", name:"AEGEAN WHEELS", cuisine:"Greek gyros", glyph:"tacos", price:2,
    cravings:["tacos"], signature:"Lamb gyro, tzatziki", blurb:"Spit-roasted all day long.",
    favorite:false,
    locations:[
      { name:"12th & Cervantes", bearing:36, dist:1.3,
        latLng:{ lat:30.424921, lng:-87.204075 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    ],
    week:[ e(0,11,21), e(0,11,21), e(0,11,21), e(0,11,21), e(0,11,21), e(0,12,20), e(0,11,21) ] },

  { id:"cluck", name:"CLUCK TRUCK", cuisine:"Nashville hot", glyph:"burgers", price:2,
    cravings:["burgers"], signature:"Hot honey tenders", blurb:"Brined 24 hrs, dredged loud.",
    favorite:false,
    locations:[
      { name:"Gregory & 9th",     bearing:80,  dist:1.55,
        latLng:{ lat:30.413593, lng:-87.191283 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
      { name:"Palafox & Romana",  bearing:110, dist:0.8,
        latLng:{ lat:30.405739, lng:-87.204285 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    ],
    week:[ e(0,11,22), e(0,11,22), e(1,11,22), e(1,11,22), e(1,12,22), e(0,12,21), null ] },

  { id:"tacos", name:"BRASA", cuisine:"Al pastor tacos", glyph:"tacos", price:1,
    cravings:["tacos"], signature:"Al pastor + piña", blurb:"Trompo carved off the flame.",
    favorite:true,
    locations:[
      { name:"Palafox & Garden", bearing:120, dist:0.72,
        latLng:{ lat:30.404489, lng:-87.206437 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
      { name:"Seville Square",   bearing:200, dist:0.9,
        latLng:{ lat:30.39746,  lng:-87.222065 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    ],
    week:[ e(0,11,22), e(0,11,22), e(0,11,22), e(1,11,22), e(1,12,22), e(0,12,22), e(0,11,22) ] },

  { id:"reel", name:"REEL CATCH", cuisine:"Gulf seafood", glyph:"seafood", price:3,
    cravings:["seafood"], signature:"Royal red shrimp roll", blurb:"Off the boat this morning.",
    favorite:false,
    locations:[
      { name:"Bayfront Marina", bearing:176, dist:1.1,
        latLng:{ lat:30.393818, lng:-87.215613 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    ],
    week:[ e(0,17,22), e(0,17,22), e(0,17,22), e(0,17,22), e(0,17,22), e(0,17,21), null ] },

  { id:"sugar", name:"SUGAR THEORY", cuisine:"Soft serve", glyph:"sweets", price:1,
    cravings:["sweets"], signature:"Brown-butter twist", blurb:"Churned in small batches.",
    favorite:false,
    locations:[
      { name:"Plaza Ferdinand", bearing:222, dist:0.55,
        latLng:{ lat:30.403784, lng:-87.223076 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    ],
    week:[ e(0,12,22), e(0,12,22), e(0,12,22), e(0,12,22), e(0,12,22), e(0,12,20), e(0,12,22) ] },

  { id:"roast", name:"MERIDIAN ROASTERS", cuisine:"Coffee & buns", glyph:"coffee", price:1,
    cravings:["coffee"], signature:"Cardamom cold brew", blurb:"First light, first pour.",
    favorite:false,
    locations:[
      { name:"Intendencia & Jeff.", bearing:270, dist:0.9,
        latLng:{ lat:30.409699, lng:-87.232004 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
      { name:"Wright St Market",   bearing:300, dist:1.2,
        latLng:{ lat:30.418383, lng:-87.234342 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    ],
    week:[ e(0,7,14), e(0,7,14), e(0,7,14), e(0,7,14), e(1,8,14), null, e(0,7,14) ] },
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

// resolve a truck's plan on a given day -> { open, close, name, bearing, dist } | null (off)
// Optional userLat/userLng: when provided and the location has a latLng, bearing and dist
// are computed from real geography; otherwise falls back to stored estimated values.
function planFor(truck, day, userLat, userLng) {
  const ent = truck.week[day]; if (!ent) return null;
  const loc = truck.locations[ent.loc] || truck.locations[0];
  let bearing = loc.bearing, dist = loc.dist;
  if (userLat != null && userLng != null && loc.latLng) {
    dist    = haversineMi(userLat, userLng, loc.latLng.lat, loc.latLng.lng);
    bearing = geoBearing(userLat, userLng, loc.latLng.lat, loc.latLng.lng);
  }
  return { open: ent.open, close: ent.close, name: loc.name, bearing, dist };
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
// Each event has a fixed location and an occurrences[] array (one entry per
// day it runs). occurrences replace the truck week[]/locations[] model for
// events only. eventToEntity() normalises an event into the truck interface
// so the existing Field, DYNAMO math, and watchlist code work unchanged.

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

// occurrences: [{ dayIdx (0-6), start, end }] — decimal hours, within DAY_START/DAY_END
// location.latLng values are DERIVED FROM ESTIMATED GEOMETRY — not verified;
// replace with real geocoded coordinates once confirmed.
const EVENTS = [
  { id:"ev-jazz", name:"JAZZ AT THE SQUARE", venue:"Seville Square",
    category:"music", glyph:"music", price:"Free",
    blurb:"Live jazz in the open air. Bring a blanket.",
    location:{ bearing:308, dist:1.1, latLng:{ lat:30.419501, lng:-87.231448 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    occurrences:[{ dayIdx:0, start:18, end:21 }, { dayIdx:5, start:17, end:21 }] },

  { id:"ev-market", name:"PALAFOX MARKET", venue:"Palafox Street",
    category:"markets", glyph:"markets", price:"Free",
    blurb:"Local vendors, produce, and handmade goods.",
    location:{ bearing:350, dist:0.6, latLng:{ lat:30.418252, lng:-87.218649 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    occurrences:[{ dayIdx:6, start:8, end:14 }] },

  { id:"ev-comedy", name:"STAND-UP NIGHT", venue:"The Handlebar",
    category:"comedy", glyph:"comedy", price:"$10",
    blurb:"Local comics. No cover if you buy a drink.",
    location:{ bearing:85, dist:0.9, latLng:{ lat:30.410834, lng:-87.201854 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    occurrences:[{ dayIdx:4, start:20, end:22 }] },

  { id:"ev-yoga", name:"YOGA ON THE WATERFRONT", venue:"Bayfront Park",
    category:"classes", glyph:"classes", price:"Free",
    blurb:"Sunrise flow, mats provided.",
    location:{ bearing:176, dist:1.1, latLng:{ lat:30.393818, lng:-87.215613 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    occurrences:[{ dayIdx:0, start:7, end:8.5 }, { dayIdx:2, start:7, end:8.5 }, { dayIdx:5, start:7, end:8.5 }] },

  { id:"ev-kids", name:"KIDS CRAFT HOUR", venue:"The Art Trail",
    category:"kids", glyph:"kids", price:"Free",
    blurb:"Drop-in craft projects for ages 4–10.",
    location:{ bearing:222, dist:0.55, latLng:{ lat:30.403784, lng:-87.223076 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    occurrences:[{ dayIdx:1, start:10, end:12 }, { dayIdx:3, start:10, end:12 }] },

  { id:"ev-rooftop", name:"ROOFTOP SETS", venue:"Commerce St. Bar",
    category:"nightlife", glyph:"nightlife", price:"$5",
    blurb:"DJ sets with a view of the bay.",
    location:{ bearing:112, dist:0.75, latLng:{ lat:30.405633, lng:-87.205231 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    occurrences:[{ dayIdx:4, start:21, end:22 }, { dayIdx:5, start:21, end:22 }] },

  { id:"ev-gallery", name:"GALLERY FIRST FRIDAY", venue:"Artel Gallery",
    category:"arts", glyph:"arts", price:"Free",
    blurb:"New show opening. Wine and small plates.",
    location:{ bearing:290, dist:0.8, latLng:{ lat:30.413659, lng:-87.229516 } }, // DERIVED FROM ESTIMATED GEOMETRY — not verified; replace with real geocoded coordinates
    occurrences:[{ dayIdx:4, start:18, end:21 }] },
];

// Normalise an event into the truck interface so Field/DYNAMO helpers work unchanged.
// The original event is kept as _event for EventCard to read.
// location.latLng is carried through so geo-based planFor works for events too.
function eventToEntity(ev) {
  return {
    id: ev.id,
    name: ev.name,
    glyph: ev.glyph,
    cravings: [ev.category],   // matches EVENT_CATEGORIES tag
    week: Array.from({ length: 7 }, (_, d) => {
      const occ = ev.occurrences.find(o => o.dayIdx === d);
      return occ ? { loc: 0, open: occ.start, close: occ.end } : null;
    }),
    locations: [{ name: ev.venue, bearing: ev.location.bearing, dist: ev.location.dist,
                  latLng: ev.location.latLng }],
    _event: ev,
  };
}

window.DYNAMO = {
  DAY_START, DAY_END, DEFAULT_RIM_MI,
  fmtTime, fmtHourShort, fmtHM, clamp, lerp, smoothstep,
  compassDir, planFor, powerAt, statusAt, bodyPos, walkMin, upcomingWindows,
  eventToEntity, haversineMi, geoBearing, geoDestination,
};
window.TRUCKS = TRUCKS;
window.CRAVINGS = CRAVINGS;
window.DAYS = DAYS;
window.EVENTS = EVENTS;
window.EVENT_CATEGORIES = EVENT_CATEGORIES;
window.CITIES = CITIES;
window.DEFAULT_CITY = DEFAULT_CITY;
