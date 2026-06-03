# FOOD — a time-and-place discovery instrument

> Working title. The concept is settled; the name is not.

A single-instrument discovery app: a circular radar/compass dial where **you are
the center**, things are placed by **direction** (angle) and **proximity**
(distance), and a **time throttle** lets you scrub through the day to watch them
ignite when they open and fade when they close. No tabs, no feed, no list.

The first vertical is **food trucks** (Pensacola, FL). But the engine underneath
is domain-agnostic: it renders *any entity that has a location and a time
window* — food trucks, open houses, happy hours, transit departures, live sets.
The long-term shape is one engine, many thin vertical configs.

## Status

Interactive prototype. Built as static HTML + React loaded via CDN, transpiled
in-browser by Babel — **no build step yet**. Runs by opening it in any static
file server. A migration to a real build (Vite + React) is the intended first
production step (see `CLAUDE.md`).

## Run it locally / in a Codespace

The app must be served over HTTP (opening `index.html` via `file://` breaks the
`.jsx` script loading). From the repo root:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` (in a Codespace, click the forwarded-port
preview link that pops up for port 8000).

## Project structure

```
index.html          The one page. Loads React + Babel from CDN, then the
                    components below in order. Holds all global CSS + palettes.
app.jsx             App shell: state, orchestration, wiring of the pieces.
field.jsx           The dial — rings, spokes, compass, the "YOU" hub, and the
                    truck "emblems" placed by bearing + distance.
console.jsx         Bottom control panel — day dial, hour throttle, craving lens.
card.jsx            Truck detail bottom-sheet + the "Guide Me" nav banner.
drawer.jsx          Watchlist tab + alerts ledger.
glyphs.jsx          Geometric cuisine icons (the Deco glyph set).
data.jsx            CONTENT + MODEL: trucks, weekly schedules, geometry/time math.
                    This is the layer that becomes per-vertical config.
tweaks-panel.jsx    Dev-only controls (palette switching, tuning).
```

## Design language

1920s–30s Art Deco / machine-age meets a modern app. Bold geometric display
face for the logo and numerals; condensed all-caps grotesque for labels; italic
serif for flavor text. Palette: near-black ground, warm cream "paper" for active
surfaces, vermillion as the energy/active color, sky blue reserved for "watched"
items. Terse, mechanical tone of voice. See `CLAUDE.md` for specifics.

## A note on data honesty

Food-truck data rots fast and public sources are unreliable. This project does
not pretend otherwise: every location carries a **confidence level**
(confirmed / scheduled / likely / unverified) rather than a false certainty.
That honesty is a product principle, not a fallback.
