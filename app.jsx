// app.jsx — DYNAMO core: state, throttle momentum, craving, tap behavior.
const { useState, useRef, useEffect, useCallback, useMemo } = React;
const D = window.DYNAMO;

// All available modes — add new entries here to extend the menu automatically.
const MODES = [
  { id: "events",   label: "EVENTS",   sub: "SET THE HOUR. FIND THE FUN.",  throttleLabel: "EVENT HOUR"   },
  { id: "food",     label: "FOOD",     sub: "SET THE HOUR. FIND THE FOOD.", throttleLabel: "SERVICE HOUR" },
  // FESTIVAL is a bounded demo vertical (see data.jsx STATIC). rimMi overrides the global
  // DEFAULT_RIM_MI so the tight downtown venue cluster reads at ~1 mi; modes without rimMi
  // fall back to 5 mi. EVENTS stays MODES[0] (default landing + dropdown order unchanged).
  // `festival: true` is the GATE flag (not a data selector): both festival modes inherit the
  // glyph type-tint + the music time-collapse from it, so a future festival mode = one flag.
  { id: "festival",  label: "FESTIVAL",  sub: "SET THE TIME. FIND THE SET.", throttleLabel: "SET TIME", rimMi: 1.0, festival: true },
  // NIGHTMOVES — real single-grounds, single-day festival (Night Moves, Maritime Park). Tight
  // 0.25 mi rim; cityKey points the GPS-off anchor/hub-label at the festival grounds (not
  // downtown). festival: true → tint + collapse inherited.
  { id: "nightmoves", label: "NIGHTMOVES", sub: "SET THE TIME. FIND THE SET.", throttleLabel: "SET TIME", rimMi: 0.25, festival: true, cityKey: "nightmoves" },
];

function App() {
  const tweaks = { palette: "noir", emblem: "roundel", speed: true, momentum: true };

  const [mode, setMode] = useState(MODES[0].id); // default + dropdown order both follow MODES (single source)
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [t, setT] = useState(() => D.clamp(D.todayHour, D.DAY_START, D.DAY_END));
  const [day, setDay] = useState(0);
  const [craving, setCraving] = useState(0);
  const [cardId, setCardId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [watched, setWatched] = useState(() => {
    try {
      const raw = localStorage.getItem("offline.watchlist.v1");
      if (raw !== null) return new Set(JSON.parse(raw));
    } catch {}
    return new Set(window.TRUCKS.filter(t => t.favorite).map(t => t.id));
  });
  const [now, setNow] = useState(0);
  const [heading, setHeading] = useState(0);
  const [range, setRange] = useState(D.DEFAULT_RIM_MI);  // miles shown at the outer rim
  const [navId, setNavId] = useState(null);
  const [navProgress, setNavProgress] = useState(0);
  const [arrived, setArrived] = useState(false);
  const [compassLive, setCompassLive] = useState(false);
  const [spinning, setSpinning] = useState(false);
  // null = permission denied / unavailable → dial falls back to city anchor as user position
  const [userPos, setUserPos] = useState(null);
  // true once a location request is denied/unavailable — drives a quiet on-screen note
  // (a fully silent empty error handler was the original iOS bug that hid failures).
  const [geoDenied, setGeoDenied] = useState(false);

  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [topH, setTopH] = useState(185);
  const [safeBottom, setSafeBottom] = useState(0);
  const topZoneRef = useRef(null);

  const dragRef = useRef(false);
  const velRef = useRef(0);
  const lastRef = useRef({ t: 12, tm: 0 });
  const snapRef = useRef(null);
  const navWalkRef = useRef(false);
  const vibeRef = useRef(-1);
  const dialVelRef = useRef(0); // deg/ms — flick-spin momentum for the compass dial
  const orientationHandlersRef = useRef(null); // { abs, rel } — kept so we can removeEventListener by exact reference

  // Dial spin decay constants (tunable; source of truth for feel is in field.jsx)
  const DIAL_FRICTION = 0.976;  // velocity multiplier per 16ms frame — ~3.5s to stop (weighted-wheel feel)
  const DIAL_STOP_VEL = 0.002;  // deg/ms below which spin is cancelled

  // mode-derived data — computed once per mode change. FESTIVAL entities are EVENTS-shaped,
  // so the same eventToEntity normalizer absorbs them with no engine branch.
  const entities = useMemo(() =>
    mode === "food"       ? window.TRUCKS :
    mode === "festival"   ? window.FESTIVAL.map(D.eventToEntity) :
    mode === "nightmoves" ? window.NIGHTMOVES.map(D.eventToEntity) :
                            window.EVENTS.map(D.eventToEntity),
  [mode]);
  const activeCategories = mode === "food"       ? window.CRAVINGS :
                           mode === "festival"   ? window.FESTIVAL_CATEGORIES :
                           mode === "nightmoves" ? window.NIGHTMOVES_CATEGORIES :
                                                   window.EVENT_CATEGORIES;
  // Per-mode day frame: FESTIVAL has its 3-day Fri/Sat/Sun set, NIGHTMOVES its single fixed
  // festival day; FOOD/EVENTS use the rolling-7 DAYS. Threaded into the day-dial, Field, the
  // card, and the engine helpers.
  const activeDays = mode === "festival"   ? D.FESTIVAL_DAYS :
                     mode === "nightmoves" ? D.NIGHTMOVES_DAYS :
                                             window.DAYS;

  // Snap points: all window start/end times across all entities. windowTimes (data.jsx)
  // reads the schedule model so app.jsx stays ignorant of occurrences/recurrence shape.
  const KINDLE = useMemo(() => {
    const times = entities.flatMap(e => D.windowTimes(e));
    return [...new Set(times)].sort((a, b) => a - b);
  }, [entities]);

  // Close mode menu on any click outside the wordmark button.
  // Deferred one tick so the button's own opening click doesn't immediately re-close it.
  useEffect(() => {
    if (!modeMenuOpen) return;
    let close;
    const id = setTimeout(() => {
      close = () => setModeMenuOpen(false);
      document.addEventListener("click", close);
    }, 0);
    return () => {
      clearTimeout(id);
      if (close) document.removeEventListener("click", close);
    };
  }, [modeMenuOpen]);
  const rimOf = (m) => (MODES.find(x => x.id === m)?.rimMi) ?? D.DEFAULT_RIM_MI;
  const switchMode = (m) => {
    setMode(m);
    setCraving(0);
    setDay(0);            // day indices are per-mode (FESTIVAL has only 0–2); reset to avoid OOB
    setRange(rimOf(m));   // snap the zoom to the new mode's rim (FESTIVAL ~1 mi, others 5)
    setCardId(null);
    setSelectedId(null);
    setModeMenuOpen(false);
  };

  const currentMode = MODES.find(m => m.id === mode) || MODES[0];
  const activeRim = currentMode.rimMi ?? D.DEFAULT_RIM_MI;
  // Festival-type gate (drives the tint + music-collapse + ledger day-frame for ALL festival
  // modes via one flag — no brittle string check). Anchor label + the static single-day label
  // are per-mode config: NIGHTMOVES points at the festival grounds; others stay downtown / use
  // the day-dial.
  const isFestival = !!currentMode.festival;
  const activeAnchorLabel = window.CITIES[currentMode.cityKey || window.DEFAULT_CITY].hubLabel;
  const dateLabel = mode === "nightmoves" ? D.NIGHTMOVES_DAYS[0].label : null;

  // Geolocation and compass are activated together by a user tap on the YOU hub (see activateLive).
  // Auto-requesting on mount was unreliable on mobile (permission prompt often silently dropped).

  useEffect(() => {
    const fit = () => {
      setVp({ w: window.innerWidth, h: window.innerHeight });
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;bottom:env(safe-area-inset-bottom,0px);height:0;width:0;";
      document.body.appendChild(probe);
      const inset = parseFloat(getComputedStyle(probe).bottom) || 0;
      probe.remove();
      setSafeBottom(inset);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    const el = topZoneRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setTopH(el.offsetHeight));
    ro.observe(el);
    setTopH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  // animation + momentum loop
  useEffect(() => {
    let raf, prev = performance.now();
    const tick = (ts) => {
      const dt = Math.min(40, ts - prev); prev = ts;
      setNow(ts);
      if (navWalkRef.current) {
        setNavProgress((p) => {
          const np = Math.min(1, p + dt/7000);
          const ms = Math.floor(np*4);
          if (ms !== vibeRef.current) { vibeRef.current = ms; if (navigator.vibrate) navigator.vibrate(16); }
          if (np >= 1 && p < 1) { if (navigator.vibrate) navigator.vibrate([0,80,55,150]); navWalkRef.current = false; setArrived(true); }
          return np;
        });
      }
      if (!dragRef.current) {
        if (snapRef.current != null) {
          setT((cur) => {
            const nt = D.lerp(cur, snapRef.current, 0.18);
            if (Math.abs(nt - snapRef.current) < 0.01) { const s = snapRef.current; snapRef.current = null; return s; }
            return nt;
          });
        } else if (Math.abs(velRef.current) > 0.0004) {
          setT((cur) => {
            let nt = D.clamp(cur + velRef.current * dt, D.DAY_START, D.DAY_END);
            velRef.current *= 0.93;
            if (nt <= D.DAY_START || nt >= D.DAY_END) velRef.current = 0;
            if (Math.abs(velRef.current) <= 0.0004) {
              const near = KINDLE.length
                ? KINDLE.reduce((p,c) => Math.abs(c-nt) < Math.abs(p-nt) ? c : p, KINDLE[0])
                : nt;
              snapRef.current = KINDLE.length && Math.abs(near-nt) < 0.55 ? near : Math.round(nt*4)/4;
              velRef.current = 0;
            }
            return nt;
          });
        }
      }
      // dial flick-spin momentum — decays smoothly, overridden by live compass
      if (Math.abs(dialVelRef.current) > DIAL_STOP_VEL) {
        setHeading(h => ((h + dialVelRef.current * dt) % 360 + 360) % 360);
        dialVelRef.current *= Math.pow(DIAL_FRICTION, dt / 16);
        if (Math.abs(dialVelRef.current) < DIAL_STOP_VEL) {
          dialVelRef.current = 0;
          setSpinning(false);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [KINDLE]);

  const onScrub = useCallback((nt) => {
    const tm = performance.now();
    const dtm = tm - lastRef.current.tm || 16;
    velRef.current = D.clamp((nt - lastRef.current.t) / dtm, -0.012, 0.012);
    lastRef.current = { t: nt, tm };
    snapRef.current = null;
    setT(nt);
  }, []);
  const onScrubEnd = useCallback(() => {
    if (!tweaks.momentum) {
      velRef.current = 0;
      setT((cur) => {
        const near = KINDLE.length
          ? KINDLE.reduce((p,c) => Math.abs(c-cur) < Math.abs(p-cur) ? c : p, KINDLE[0])
          : cur;
        snapRef.current = KINDLE.length && Math.abs(near-cur) < 0.5 ? near : cur;
        return cur;
      });
    }
  }, [tweaks.momentum, KINDLE]);

  // category match (works for both trucks/cravings and events/EVENT_CATEGORIES)
  const matchOf = useCallback((entity) => {
    const tag = activeCategories[D.clamp(craving, 0, activeCategories.length-1)].tag;
    return tag == null ? 1 : (entity.cravings.includes(tag) ? 1 : 0);
  }, [craving, activeCategories]);

  useEffect(() => {
    try {
      localStorage.setItem("offline.watchlist.v1", JSON.stringify([...watched]));
    } catch {}
  }, [watched]);

  const onFlick = useCallback((vel) => { dialVelRef.current = vel; if (vel !== 0) setSpinning(true); }, []);

  const onTapBody = (id) => { setCardId(id); setSelectedId(id); };
  const toggleWatch = (id) => setWatched((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // navigation — simulated homing-toward-center, shared by food trucks and events
  // (entity-agnostic: operates on the selected entity id against the current-mode list)
  const startNav = (id) => { setNavId(id); setNavProgress(0); setArrived(false); vibeRef.current = -1; navWalkRef.current = true; setCardId(null); setSelectedId(id); };
  const stopNav = () => { navWalkRef.current = false; setNavId(null); setNavProgress(0); setArrived(false); };

  // When live compass activates, kill any active flick spin so sensor heading wins.
  // spinning tracks compassLive directly: sensor updates every frame, emblems must track live.
  useEffect(() => {
    if (compassLive) { dialVelRef.current = 0; setSpinning(true); }
    else { setSpinning(false); }
  }, [compassLive]);

  // Remove the stored orientation handlers and mark compass as off.
  const teardownCompass = () => {
    if (orientationHandlersRef.current) {
      window.removeEventListener("deviceorientationabsolute", orientationHandlersRef.current.abs, true);
      window.removeEventListener("deviceorientation",         orientationHandlersRef.current.rel, true);
      orientationHandlersRef.current = null;
    }
    setCompassLive(false);
  };

  // Build and register heading handlers, then set compassLive = true.
  // Android: prefer deviceorientationabsolute (true magnetic north); fall back to relative alpha.
  // iOS: uses webkitCompassHeading (already absolute). iOS requires requestPermission() from a
  // user gesture — this function must be called (even without await) within a gesture handler.
  const setupCompass = async () => {
    try {
      if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== "granted") return;
      }
    } catch { return; }

    // Tear down any existing handlers before re-registering.
    if (orientationHandlersRef.current) {
      window.removeEventListener("deviceorientationabsolute", orientationHandlersRef.current.abs, true);
      window.removeEventListener("deviceorientation",         orientationHandlersRef.current.rel, true);
    }

    // gotAbsolute: once the absolute event fires, the relative handler becomes a no-op.
    let gotAbsolute = false;
    const absHandler = (e) => {
      if (e.alpha == null) return;
      gotAbsolute = true;
      setHeading((360 - e.alpha + 360) % 360);
    };
    const relHandler = (e) => {
      if (gotAbsolute) return; // absolute event is available — ignore relative
      const h = e.webkitCompassHeading != null
        ? e.webkitCompassHeading
        : (e.alpha != null ? (360 - e.alpha + 360) % 360 : null);
      if (h != null) setHeading(h);
    };

    window.addEventListener("deviceorientationabsolute", absHandler, true);
    window.addEventListener("deviceorientation",         relHandler, true);
    orientationHandlersRef.current = { abs: absHandler, rel: relHandler };
    dialVelRef.current = 0;
    setCompassLive(true);
  };

  // Compass chip: toggle live ↔ manual. Hub tap is the initial activation; chip is the toggle.
  const enableCompass = () => {
    if (compassLive) { teardownCompass(); return; }
    setupCompass();
  };

  // Hub tap: request geolocation ONLY, so its permission prompt owns the user gesture
  // uncontended (firing DeviceOrientation.requestPermission in the same tap orphaned the
  // location prompt on iOS — the two modals collided). Live compass is a SEPARATE gesture
  // owned by the compass chip (enableCompass → setupCompass). Location stays a deliberate
  // tap (not on page load). If location is denied/unavailable, the chip still enables compass.
  const activateLive = () => {
    if (userPos) return;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGeoDenied(false);
          setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        // denied/unavailable/timeout (code 3) → userPos stays null so the silent anchor
        // fallback + hubLabel hold and manual drag still works; a quiet on-screen note
        // (not a fully silent failure) invites a retry tap.
        () => setGeoDenied(true),
        // enableHighAccuracy:false — a 5-mile radar doesn't need GPS-grade precision; wifi/cell
        // is faster, returns indoors, and hangs less. Finite timeout still routes a hang to error.
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
      );
    } else {
      setGeoDenied(true);
    }
  };

  const { w, h } = vp;
  const CONSOLE_ZONE = 26 + safeBottom + 124 + 10;
  const topEdge = topH + 16;
  const availH = h - topEdge - CONSOLE_ZONE;
  const fieldR = Math.max(80, Math.min(w * 0.46, availH / 2));
  const fieldCx = w / 2, fieldCy = topEdge + fieldR;

  // card lookup — truck in food mode, event entity in events mode
  const cardEntity = entities.find(x => x.id === cardId) || null;
  const navTruck = navId ? entities.find(x => x.id === navId) : null;
  const navPlan = navTruck ? D.planFor(navTruck, day, userPos?.lat, userPos?.lng, activeDays) : null;
  const navDist = navPlan ? navPlan.dist * (1 - navProgress * 0.93) : 0;
  // Header count stays SCRUBBED — it's the exploratory dial readout (how many are
  // lit at the hour you're viewing), not a live claim. So the word "NOW" only shows
  // when you're actually viewing real today at the real clock; otherwise label it
  // with the viewed hour ("OPEN 6P") so it never makes a false live claim.
  const openCount = entities.filter(e => D.powerAt(e, t, day, activeDays) > 0.5).length;
  // "NOW" is a present-tense claim → only when the VIEWED day is the real today (for the
  // rolling DAYS array activeDays[day].today ⟺ day===0, so FOOD/EVENTS are unchanged; for
  // FESTIVAL it is the festival day whose date == today).
  const viewingRealNow = !!activeDays[day]?.today && Math.abs(t - D.realNowHour) < 0.25;
  const openWord = mode === "food" ? "OPEN" : "ON";
  // "NOW" is the live-status truth-claim (real today + real hour only); the scrubbed
  // case drops the clock-time readout entirely — count-only, no false present-tense.
  const openLabel = viewingRealNow ? `${openWord}\nNOW` : openWord;

  // live badge: watched items open RIGHT NOW (real unclamped Central time, today = day 0)
  const allWatchedEntities = useMemo(() => {
    const trucks = (window.TRUCKS || []).filter(tr => watched.has(tr.id));
    const events = (window.EVENTS || []).filter(ev => watched.has(ev.id)).map(D.eventToEntity);
    const fest   = (window.FESTIVAL || []).filter(ev => watched.has(ev.id)).map(D.eventToEntity);
    const nm     = (window.NIGHTMOVES || []).filter(ev => watched.has(ev.id)).map(D.eventToEntity);
    return [...trucks, ...events, ...fest, ...nm];
  }, [watched]);
  const liveWatchedCount = allWatchedEntities.filter(e => D.powerAt(e, D.realNowHour, 0) > 0.5).length;

  return (
    <div className={"stage pal-" + tweaks.palette} style={{ "--console-h": "124px" }}>
      <div className="paper" />
      <div className="frame-rule" />

      <div className="top-zone" ref={topZoneRef}>
        <header className="hdr">
          <div className="hdr-primary">
            <div className="hdr-titles">
              <div className="hdr-wordmark-row">
                <button className="hdr-mark" onClick={() => setModeMenuOpen(o => !o)}
                  aria-haspopup="true" aria-expanded={modeMenuOpen}>
                  OFFLINE<span className="hdr-lens">//{currentMode.label}</span><span className={"hdr-caret" + (modeMenuOpen ? " open" : "")}>▾</span>
                </button>
                {modeMenuOpen && (
                  <div className="mode-menu" role="menu">
                    {MODES.map(m => (
                      <button key={m.id} className={"mode-menu-item" + (m.id === mode ? " active" : "")}
                        role="menuitem" onClick={() => switchMode(m.id)}>
                        //{m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="hdr-count">
              <span className="hdr-count-n">{openCount}</span>
              <span className="hdr-count-k">{openLabel}</span>
            </div>
          </div>
        </header>

        <window.LensStrip key={mode} craving={craving} onCraving={setCraving} categories={activeCategories} />

        <div className="chips-row">
          {range < activeRim * 0.99 && (
            <button className="zoom-chip" onClick={() => setRange(activeRim)}>{range.toFixed(range<1?2:1)} MI · RESET</button>
          )}
          <button className={"compass-chip" + (compassLive ? " live" : "") + (userPos && !compassLive ? " attn" : "")} onClick={enableCompass}>
            <span className="cc-rose">✣</span>
            <span className="cc-deg">{Math.round(heading)}°</span>
            <span className="cc-state">{compassLive ? "LIVE" : "MANUAL"}</span>
          </button>
        </div>
      </div>

      <window.Field t={t} day={day} fieldR={fieldR} cx={fieldCx} cy={fieldCy}
        matchOf={matchOf} shape={tweaks.emblem} selectedId={selectedId} watched={watched}
        onTapBody={onTapBody} onTapField={() => { setSelectedId(null); setModeMenuOpen(false); }}
        speed={tweaks.speed} now={now} trucks={entities} days={activeDays} rim={activeRim}
        festival={isFestival} anchorLabel={activeAnchorLabel}
        heading={heading} onHeading={setHeading} range={range} onRange={setRange}
        navId={navId} navProgress={navProgress} userPos={userPos} onFlick={onFlick}
        spinning={spinning} compassLive={compassLive} onTapHub={activateLive} geoDenied={geoDenied} />

      {navTruck && (
        <div className={"nav-banner" + (arrived ? " arrived" : "")}>
          <div className="nav-banner-main">
            <span className="nav-eyebrow">{arrived ? "ARRIVED AT" : "GUIDING TO"}</span>
            <span className="nav-name">{navTruck.name}</span>
          </div>
          <div className="nav-banner-readout">
            {arrived ? <span className="nav-dist">YOU'RE HERE</span>
              : <span className="nav-dist">{navDist.toFixed(2)} MI · {D.compassDir(navPlan.bearing)}</span>}
            <button className="nav-stop" onClick={stopNav}>{arrived ? "DONE" : "STOP"}</button>
          </div>
          <div className="nav-progress"><span style={{ width: `${navProgress*100}%` }} /></div>
        </div>
      )}

      <window.WatchTab count={allWatchedEntities.length} liveCount={liveWatchedCount} onOpen={() => setLedgerOpen(true)} />

      <window.Console t={t} day={day} onDay={setDay} days={activeDays} dateLabel={dateLabel}
        onScrub={onScrub} onScrubEnd={onScrubEnd} dragRef={dragRef}
        throttleLabel={currentMode.throttleLabel} />

      {cardEntity && mode === "food" && (
        <window.TruckCard truck={cardEntity} t={t} day={day} watched={watched} userPos={userPos}
          onClose={() => { setCardId(null); setSelectedId(null); }}
          onWatch={toggleWatch} onGuide={startNav} />
      )}

      {cardEntity && mode !== "food" && window.EventCard && (
        <window.EventCard entity={cardEntity} t={t} day={day} days={activeDays} watched={watched} userPos={userPos}
          onClose={() => { setCardId(null); setSelectedId(null); }}
          onWatch={toggleWatch} onGuide={startNav} />
      )}

      <window.AlertsLedger open={ledgerOpen} watched={watched}
        day={isFestival ? 0 : day} t={t}
        mode={mode} userPos={userPos} onClose={() => setLedgerOpen(false)}
        onPick={(id) => {
          setLedgerOpen(false);
          const isTruck = (window.TRUCKS || []).some(tr => tr.id === id);
          const isFest  = (window.FESTIVAL || []).some(ev => ev.id === id);
          const isNm    = (window.NIGHTMOVES || []).some(ev => ev.id === id);
          const targetMode = isTruck ? "food" : isFest ? "festival" : isNm ? "nightmoves" : "events";
          if (targetMode !== mode) { setMode(targetMode); setCraving(0); setDay(0); setRange(rimOf(targetMode)); setModeMenuOpen(false); }
          onTapBody(id);
        }}
        onWatch={toggleWatch} />

    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
