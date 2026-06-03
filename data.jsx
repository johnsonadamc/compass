// data.jsx — DYNAMO content + machine model (with weekly schedules & roaming).
// Exposes window.DYNAMO (helpers), window.TRUCKS, window.CRAVINGS, window.DAYS.

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

/* schedule entry helper: e(locIdx, open, close) | null (off that day) */
const e = (loc, open, close) => ({ loc, open, close });

/* TRUCKS — each has locations[] (named stops w/ bearing+dist) and a 7-day week. */
const TRUCKS = [
  { id:"bao", name:"BAO & ARROW", cuisine:"Steamed buns", glyph:"bao", price:2,
    cravings:["savory","fresh"], signature:"Five-spice pork bao", blurb:"Pillowy buns, folded to order.",
    favorite:true,
    locations:[ {name:"Palafox & Garden", bearing:350, dist:0.6}, {name:"Seville Square", bearing:300, dist:1.1} ],
    week:[ e(0,11,15), e(0,11,15), e(1,11,15), e(0,11,15), e(1,12,16), null, e(0,11,15) ] },

  { id:"green", name:"VERDIGRIS", cuisine:"Grain bowls", glyph:"leaf", price:2,
    cravings:["fresh","savory"], signature:"Charred broccolini bowl", blurb:"Market greens, big crunch.",
    favorite:false,
    locations:[ {name:"Wright & Spring", bearing:312, dist:1.05}, {name:"Bayfront Pkwy", bearing:150, dist:1.4} ],
    week:[ e(0,10.5,16), e(0,10.5,16), e(0,10.5,16), e(1,10.5,16), e(1,11,15), null, e(0,10.5,16) ] },

  { id:"gyro", name:"AEGEAN WHEELS", cuisine:"Greek gyros", glyph:"gyro", price:2,
    cravings:["savory"], signature:"Lamb gyro, tzatziki", blurb:"Spit-roasted all day long.",
    favorite:false,
    locations:[ {name:"12th & Cervantes", bearing:36, dist:1.3} ],
    week:[ e(0,11,21), e(0,11,21), e(0,11,21), e(0,11,21), e(0,11,21), e(0,12,20), e(0,11,21) ] },

  { id:"cluck", name:"CLUCK TRUCK", cuisine:"Nashville hot", glyph:"drum", price:2,
    cravings:["savory","spicy"], signature:"Hot honey tenders", blurb:"Brined 24 hrs, dredged loud.",
    favorite:false,
    locations:[ {name:"Gregory & 9th", bearing:80, dist:1.55}, {name:"Palafox & Romana", bearing:110, dist:0.8} ],
    week:[ e(0,11,22), e(0,11,22), e(1,11,22), e(1,11,22), e(1,12,22), e(0,12,21), null ] },

  { id:"tacos", name:"BRASA", cuisine:"Al pastor tacos", glyph:"taco", price:1,
    cravings:["spicy","savory"], signature:"Al pastor + piña", blurb:"Trompo carved off the flame.",
    favorite:true,
    locations:[ {name:"Palafox & Garden", bearing:120, dist:0.72}, {name:"Seville Square", bearing:200, dist:0.9} ],
    week:[ e(0,11,22), e(0,11,22), e(0,11,22), e(1,11,22), e(1,12,22), e(0,12,22), e(0,11,22) ] },

  { id:"reel", name:"REEL CATCH", cuisine:"Gulf seafood", glyph:"fish", price:3,
    cravings:["seafood","savory"], signature:"Royal red shrimp roll", blurb:"Off the boat this morning.",
    favorite:false,
    locations:[ {name:"Bayfront Marina", bearing:176, dist:1.1} ],
    week:[ e(0,17,22), e(0,17,22), e(0,17,22), e(0,17,22), e(0,17,22), e(0,17,21), null ] },

  { id:"sugar", name:"SUGAR THEORY", cuisine:"Soft serve", glyph:"cone", price:1,
    cravings:["sweet"], signature:"Brown-butter twist", blurb:"Churned in small batches.",
    favorite:false,
    locations:[ {name:"Plaza Ferdinand", bearing:222, dist:0.55} ],
    week:[ e(0,12,22), e(0,12,22), e(0,12,22), e(0,12,22), e(0,12,22), e(0,12,20), e(0,12,22) ] },

  { id:"roast", name:"MERIDIAN ROASTERS", cuisine:"Coffee & buns", glyph:"bean", price:1,
    cravings:["caffeine"], signature:"Cardamom cold brew", blurb:"First light, first pour.",
    favorite:false,
    locations:[ {name:"Intendencia & Jeff.", bearing:270, dist:0.9}, {name:"Wright St Market", bearing:300, dist:1.2} ],
    week:[ e(0,7,14), e(0,7,14), e(0,7,14), e(0,7,14), e(1,8,14), null, e(0,7,14) ] },
];

const CRAVINGS = [
  { id:"all",      label:"ALL",    glyph:"all",   tag:null },
  { id:"spicy",    label:"SPICY",  glyph:"flame", tag:"spicy" },
  { id:"savory",   label:"SAVORY", glyph:"drum",  tag:"savory" },
  { id:"fresh",    label:"FRESH",  glyph:"leaf",  tag:"fresh" },
  { id:"seafood",  label:"SEA",    glyph:"fish",  tag:"seafood" },
  { id:"sweet",    label:"SWEET",  glyph:"cone",  tag:"sweet" },
  { id:"caffeine", label:"COFFEE", glyph:"bean",  tag:"caffeine" },
];

/* ---- math ---- */
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const lerp  = (a,b,t) => a + (b - a) * t;
const smoothstep = (e0,e1,x) => { const t = clamp((x-e0)/(e1-e0),0,1); return t*t*(3-2*t); };

const DIRS = ["N","NE","E","SE","S","SW","W","NW"];
const compassDir = (bearing) => DIRS[Math.round(((bearing % 360) / 45)) % 8];

// resolve a truck's plan on a given day -> { open, close, name, bearing, dist } | null (off)
function planFor(truck, day) {
  const ent = truck.week[day]; if (!ent) return null;
  const loc = truck.locations[ent.loc] || truck.locations[0];
  return { open: ent.open, close: ent.close, name: loc.name, bearing: loc.bearing, dist: loc.dist };
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
function bodyPos(truck, fieldR, day) {
  const p = planFor(truck, day); if (!p) return null;
  const rad = (p.bearing - 90) * Math.PI / 180;
  const rr = clamp(p.dist / 2, 0, 1) * fieldR;
  return { x: Math.cos(rad)*rr, y: Math.sin(rad)*rr, r: rr };
}
const walkMin = (d) => Math.max(2, Math.round(d * 18));

// next upcoming windows for a truck from (day, t) forward — for alerts ledger
function upcomingWindows(truck, fromDay, fromT, max = 3) {
  const out = [];
  for (let d = fromDay; d < 7 && out.length < max; d++) {
    const p = planFor(truck, d); if (!p) continue;
    if (d === fromDay && fromT >= p.close) continue; // already over today
    out.push({ day: d, ...p, live: d === fromDay && fromT >= p.open && fromT < p.close });
  }
  return out;
}

window.DYNAMO = {
  DAY_START, DAY_END, fmtTime, fmtHourShort, fmtHM, clamp, lerp, smoothstep,
  compassDir, planFor, powerAt, statusAt, bodyPos, walkMin, upcomingWindows,
};
window.TRUCKS = TRUCKS;
window.CRAVINGS = CRAVINGS;
window.DAYS = DAYS;
