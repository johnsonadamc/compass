# STRATEGY.md

Business, product-strategy, and pitch context for **OFFLINE** (`localoffline.online`).
This is the doc for strategy conversations — it is NOT needed for most Claude Code
build work (that's `CLAUDE.md`). It captures live thinking so a strategy chat keeps
context across sessions. None of this is a build spec; it informs prioritization.

---

## The one-line thesis

The engine is essentially done. **The make-or-break is no longer code — it's
(a) proving a single customer will pay, and (b) data-sustainability.** Everything
below is downstream of getting one festival organizer to "yes" + a testimonial.

---

## What exists now (the pitch kit)

OFFLINE is live in production with **four switchable demos**, all on one shared
engine:

1. **EVENTS** — citywide local events (real Pensacola data, a weekend). The consumer
   app / portfolio proof-of-concept.
2. **FOOD** — food trucks (real Pensacola data). Same.
3. **FESTIVAL (STATIC)** — a *fictional* multi-venue downtown festival. The **generic
   multi-venue concept** demo: shows what the tool looks like spread across downtown
   venues. Honestly labeled as a concept, not a real event.
4. **NIGHTMOVES** — **Night Moves Music Festival 2025**, the REAL single-grounds,
   single-day festival, built from their actual lineup, vendors, and site geography,
   with the 4 real venue coordinates geocoded so the dial points correctly. The
   **credibility** demo: "here's your festival, in the tool."

This is a strong, unusual pitch position: most founders pitch a mockup or a deck.
This hands an organizer their phone and lets them scrub through an actual festival
night — and offers both "here's your real event" AND "here's where it goes if you
spread out."

---

## Why festival/B2B is the direction (the core thesis)

- The **citywide consumer app** is best understood as a portfolio piece and proof-of-
  concept, not (by itself) a business — consumer local-discovery has a low ceiling,
  and its only obvious monetization (ads / promoted placement) **breaks the dial's
  honesty**, which is the whole brand.
- The **bounded festival/venue mode (B2B, organizer-pays)** is the strongest
  commercial direction. At a festival the citywide problems VANISH: the organizer
  hands you authoritative finite data (no decay, no scraping), the site is small so
  dial scale is great, and the "get off your phone, look up" brand fits perfectly.
  Same engine, new mode via MODES + the normalizer.
- A music festival is an especially clean fit: stages = located entities, set times =
  the throttle, music/food/market = the lens.

## What building the real festival data taught us (this session)

- **Single-grounds festivals stress the GPS-placement model HARD** — the opposite of
  the multi-venue case. At Night Moves' scale everything sits within ~400 ft, so the
  bearing-error insight is extreme; we used 4 real geocoded zone coords + a tight
  0.25 mi rim + a per-mode anchor on the grounds. It works, but it surfaced **dial
  density / label-smear as the clearest remaining UX gap** (esp. the vendor cluster).
  A real festival has ~17 vendors at one spot — you can't hide them in production, so
  the real fix is smaller emblems / label de-collision, not trimming data.
- **Multi-venue festivals are where the dial SHINES** — venues spread across downtown
  is exactly "the compass points you from stage to stage," which is the product's
  reason to exist. The STATIC build already demonstrates this.
- Net: the tool is *more* compelling for a multi-venue festival than a single-grounds
  one — and (see below) Night Moves is going multi-venue.

---

## Pilot target: Night Moves

- **Night Moves** is a Pensacola nonprofit (flagship event: Night Moves Music Fest,
  part of the Pensacola Foo Foo Festival; a Foo Foo grant recipient; curated by/
  associated with **The Handlebar**). 2025 was a single-day, two-stage
  (Main + Discovery) indie/alt fest at **Hunter Amphitheater, Maritime Park**, ~2,000
  people, with food trucks + a vintage/makers market + community vendors.
- **MAJOR UPDATE (per an article dated April 30, 2026):** Night Moves Music Fest
  **2026 is expanding into a multi-day, citywide experience — Oct 30 through Nov 8,
  2026 — activating multiple downtown venues.** This confirms the multi-venue
  direction we'd bet on with STATIC. **As of mid-June there's been no further public
  news since that April announcement** (could mean heads-down execution, slipping
  timeline, or scaled-back plans — unknown).
- **Strategic read:** the citywide expansion they publicly committed to *creates* a
  much harder attendee-wayfinding problem (a whole downtown, 10 days, multiple
  venues) — and the OFFLINE dial is a direct answer to exactly that. The expansion
  doesn't just make the tool relevant; it makes the problem the tool solves urgent
  for them specifically.

### Pitch approach (current thinking — not yet executed)
- **Lead with the real 2025 NIGHTMOVES demo** for credibility ("I put your last
  festival in this — your bands, your vendors, your site"). No organizer can wave
  that away; it proves you did the work.
- **Then raise the multi-venue angle as the reason it matters now:** "I saw you're
  going citywide and multi-day in 2026 across downtown venues — that's exactly when a
  tool like this earns its keep, because now your attendees have to navigate a whole
  downtown, not one field. Here's what multi-venue looks like" → show STATIC as the
  honestly-labeled multi-venue *concept* (NOT a guess at their actual 2026 plan).
- **Do NOT build a speculative "Night Moves 2026" mock** — with no concrete venue/
  lineup intel, you'd be inventing their festival, and the moment a guessed venue is
  wrong you've shown you're guessing. STATIC already plays the multi-venue role
  honestly. Let the organizer tell you the real 2026 plan; build the specific mock
  (with real intel) only AFTER that conversation. The engine is ready to drop it in.
- **The ask:** price the FIRST one as a **near-cost pilot for the case study**, not a
  payday. Getting one organizer to "yes" + a testimonial is the asset.
- **Timing/urgency:** an Oct 30 fest means logistics/vendors/tech get locked over the
  summer — the window to pitch a pilot is **now-ish**, not September. The April-then-
  silence also gives a legitimate, non-creepy reason to reach out ("saw the 2026
  citywide expansion — congrats; built something that might help attendees navigate
  it").
- **Realistic money:** boutique/B2B — tens of thousands while proving it, low-six-
  figures if it works; the larger-ceiling story is the engine generalizing to
  conferences / fairs / markets / multi-venue events broadly.

### Engine items festival mode makes mandatory (status)
- **Throttle-to-midnight** — SHIPPED (24:00). (Past-midnight still deferred.)
- **Many sets per stage** — SOLVED differently than expected: act-as-entity +
  the music-collapse render layer, so multi-window-per-day is NOT required for
  festivals.
- **PWA / offline** — still open; mandatory for real festival use (bad cell service
  on-site) and ends the cache pain. High priority.
- **Dial density / label de-collision** — newly surfaced as critical by the dense
  single-grounds data; needed before a festival dial with real vendor counts reads
  cleanly.

---

## Other strategic threads (recorded, not yet acted on)

- **Design competitions** (Awwwards / CSS Design Awards / Core77 / Fast Company) — a
  legitimate fit that builds a recognition-moat. Enter showing the dial at its best
  (NOT over-dense — which makes the density/label work a prerequisite to entering
  well).
- **Accelerators** — NOT yet. Get a paying pilot first; then regional/vertical, not
  YC.
- **IP** — the mechanism is hard to patent and probably not worth it; prioritize a
  **TRADEMARK on "OFFLINE"** instead. Real decisions need an IP attorney — not yet
  engaged.
- **Through-line:** protect / award / accelerate are all downstream of the ONE thing
  not yet done — proving a single customer will pay.

---

## Data-sustainability (the other make-or-break)

The citywide consumer modes have a real data-decay problem (hours/venues go stale;
no clean first-party "events near me" API). Current operating decision: **citywide
data is on low simmer** — the founder drops in periodic Reddit-sourced event batches
and food-truck schedules via a strategy chat that transforms them into the data
format; no heavy ongoing investment there. The festival/B2B direction sidesteps this
entirely (organizer-supplied authoritative data), which is a core reason it's the
business and citywide is the portfolio piece.

Pipeline options researched: SerpApi `google_events` (scraped, fragile, free tier,
fights truthfulness — wants a confidence field first); ticketed APIs (first-party but
miss the long tail). Future shape: data out of `data.jsx` → a schema.org/Event-shaped
JSON file → an SMS/aggregator pipeline.

---

## How the founder works (context for any chat)

Non-technical founder who builds by directing Claude Code sessions and uses a chat
like this to (a) strategize and (b) interpret Claude Code output + write precise next
prompts for it. Firm workflow: GitHub is the single source of truth; Claude Code works
on a per-session branch; the founder tests in Codespaces and merges to `main` (which
auto-deploys to the public domain via Vercel). Claude Code's sandbox can't render the
app, so the founder's Codespaces load is the real gate. Core/load-time/risky changes
go PLAN-FIRST. (Full operational detail is in `CLAUDE.md`.)