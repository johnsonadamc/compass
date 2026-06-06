// app.jsx — DYNAMO core: state, throttle momentum, craving, tap behavior.
const { useState, useRef, useEffect, useCallback, useMemo } = React;
const D = window.DYNAMO;

// All available modes — add new entries here to extend the menu automatically.
const MODES = [
  { id: "food",   label: "FOOD",   sub: "SET THE HOUR. FIND THE FOOD.", throttleLabel: "SERVICE HOUR" },
  { id: "events", label: "EVENTS", sub: "SET THE HOUR. FIND THE FUN.",  throttleLabel: "EVENT HOUR"   },
];

function App() {
  const tweaks = { palette: "noir", emblem: "roundel", speed: true, momentum: true };

  const [mode, setMode] = useState("food"); // "food" | "events"
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [t, setT] = useState(12.0);
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
  // null = permission denied / unavailable → dial falls back to city anchor as user position
  const [userPos, setUserPos] = useState(null);

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

  // Dial spin decay constants (tunable; source of truth for feel is in field.jsx)
  const DIAL_FRICTION = 0.976;  // velocity multiplier per 16ms frame — ~3.5s to stop (weighted-wheel feel)
  const DIAL_STOP_VEL = 0.002;  // deg/ms below which spin is cancelled

  // mode-derived data — computed once per mode change
  const entities = useMemo(() =>
    mode === "food" ? window.TRUCKS : window.EVENTS.map(D.eventToEntity),
  [mode]);
  const activeCategories = mode === "food" ? window.CRAVINGS : window.EVENT_CATEGORIES;

  // Snap points: all open/close times across all entities (fixed for food; events vary less)
  const KINDLE = useMemo(() => {
    const times = entities.flatMap(e =>
      e.week.filter(Boolean).map(w => [w.open, w.close]).flat()
    );
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
  const switchMode = (m) => {
    setMode(m);
    setCraving(0);
    setCardId(null);
    setSelectedId(null);
    setModeMenuOpen(false);
  };

  const currentMode = MODES.find(m => m.id === mode) || MODES[0];

  // One-shot geolocation on mount. On deny/error/unavailable, userPos stays null
  // and planFor falls back to the city anchor (stored estimated bearing/dist).
  // Requires HTTPS in production; works on localhost in dev.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setUserPos(null),
    );
  }, []);

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
        if (Math.abs(dialVelRef.current) < DIAL_STOP_VEL) dialVelRef.current = 0;
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

  const onFlick = useCallback((vel) => { dialVelRef.current = vel; }, []);

  const onTapBody = (id) => { setCardId(id); setSelectedId(id); };
  const toggleWatch = (id) => setWatched((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // navigation — only available in food mode (events have fixed locations but no guide yet)
  const startNav = (id) => { setNavId(id); setNavProgress(0); setArrived(false); vibeRef.current = -1; navWalkRef.current = true; setCardId(null); setSelectedId(id); };
  const stopNav = () => { navWalkRef.current = false; setNavId(null); setNavProgress(0); setArrived(false); };

  // When live compass activates, kill any active flick spin so sensor heading wins.
  useEffect(() => { if (compassLive) dialVelRef.current = 0; }, [compassLive]);

  const enableCompass = async () => {
    if (compassLive) { setCompassLive(false); return; }
    try {
      if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== "granted") return;
      }
      const handler = (e) => {
        const h = e.webkitCompassHeading != null ? e.webkitCompassHeading : (e.alpha != null ? 360 - e.alpha : null);
        if (h != null) setHeading(h);
      };
      window.addEventListener("deviceorientation", handler, true);
      dialVelRef.current = 0; // cancel any spin before sensor takes over
      setCompassLive(true);
    } catch (err) { /* sensor unavailable */ }
  };

  const { w, h } = vp;
  const CONSOLE_ZONE = 26 + safeBottom + 124 + 10;
  const topEdge = topH + 16;
  const availH = h - topEdge - CONSOLE_ZONE;
  const fieldR = Math.max(80, Math.min(w * 0.46, availH / 2));
  const fieldCx = w / 2, fieldCy = topEdge + fieldR;

  // card lookup — truck in food mode, event entity in events mode
  const cardEntity = entities.find(x => x.id === cardId) || null;
  const navTruck = mode === "food" && navId ? window.TRUCKS.find(x => x.id === navId) : null;
  const navPlan = navTruck ? D.planFor(navTruck, day, userPos?.lat, userPos?.lng) : null;
  const navDist = navPlan ? navPlan.dist * (1 - navProgress * 0.93) : 0;
  const openCount = entities.filter(e => D.powerAt(e, t, day) > 0.5).length;
  const openLabel = mode === "food" ? "OPEN\nNOW" : "ON\nNOW";

  // live badge: watched items open right now (today = day 0) at current throttle time
  const allWatchedEntities = useMemo(() => {
    const trucks = (window.TRUCKS || []).filter(tr => watched.has(tr.id));
    const events = (window.EVENTS || []).filter(ev => watched.has(ev.id)).map(D.eventToEntity);
    return [...trucks, ...events];
  }, [watched]);
  const liveWatchedCount = allWatchedEntities.filter(e => D.powerAt(e, t, 0) > 0.5).length;

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
          <div className="hdr-sub">{currentMode.sub}</div>
        </header>

        <window.LensStrip key={mode} craving={craving} onCraving={setCraving} categories={activeCategories} />

        <div className="chips-row">
          {range < D.DEFAULT_RIM_MI * 0.99 && (
            <button className="zoom-chip" onClick={() => setRange(D.DEFAULT_RIM_MI)}>{range.toFixed(range<1?2:1)} MI · RESET</button>
          )}
          {userPos === null && <span className="pos-est-chip" title="Using estimated position — location access unavailable">EST POS</span>}
          <button className={"compass-chip" + (compassLive ? " live" : "")} onClick={enableCompass}>
            <span className="cc-rose">✣</span>
            <span className="cc-deg">{Math.round(heading)}°</span>
            <span className="cc-state">{compassLive ? "LIVE" : "MANUAL"}</span>
          </button>
        </div>
      </div>

      <window.Field t={t} day={day} fieldR={fieldR} cx={fieldCx} cy={fieldCy}
        matchOf={matchOf} shape={tweaks.emblem} selectedId={selectedId} watched={watched}
        onTapBody={onTapBody} onTapField={() => { setSelectedId(null); setModeMenuOpen(false); }}
        speed={tweaks.speed} now={now} trucks={entities}
        heading={heading} onHeading={setHeading} range={range} onRange={setRange}
        navId={navId} navProgress={navProgress} userPos={userPos} onFlick={onFlick} />

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

      <window.WatchTab count={watched.size} liveCount={liveWatchedCount} onOpen={() => setLedgerOpen(true)} />

      <window.Console t={t} day={day} onDay={setDay}
        onScrub={onScrub} onScrubEnd={onScrubEnd} dragRef={dragRef}
        throttleLabel={currentMode.throttleLabel} />

      {cardEntity && mode === "food" && (
        <window.TruckCard truck={cardEntity} t={t} day={day} watched={watched}
          onClose={() => { setCardId(null); setSelectedId(null); }}
          onWatch={toggleWatch} onGuide={startNav} />
      )}

      {cardEntity && mode === "events" && window.EventCard && (
        <window.EventCard entity={cardEntity} t={t} day={day} watched={watched}
          onClose={() => { setCardId(null); setSelectedId(null); }}
          onWatch={toggleWatch} />
      )}

      <window.AlertsLedger open={ledgerOpen} watched={watched} day={day} t={t}
        mode={mode} userPos={userPos} onClose={() => setLedgerOpen(false)}
        onPick={(id) => {
          setLedgerOpen(false);
          const isTruck = (window.TRUCKS || []).some(tr => tr.id === id);
          const targetMode = isTruck ? "food" : "events";
          if (targetMode !== mode) { setMode(targetMode); setCraving(0); setModeMenuOpen(false); }
          onTapBody(id);
        }}
        onWatch={toggleWatch} />

    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
