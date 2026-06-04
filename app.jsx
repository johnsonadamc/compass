// app.jsx — DYNAMO core: state, throttle momentum, craving, tap behavior.
const { useState, useRef, useEffect, useCallback } = React;
const D = window.DYNAMO;

const W = 440, H = 920;
const KINDLE = [...new Set(window.TRUCKS.flatMap(t => [t.open, t.close]))].sort((a,b)=>a-b);

function App() {
  const tweaks = { palette: "noir", emblem: "roundel", speed: true, momentum: true };

  const [t, setT] = useState(12.0);
  const [day, setDay] = useState(0);
  const [craving, setCraving] = useState(0);
  const [cardId, setCardId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [watched, setWatched] = useState(() => new Set(window.TRUCKS.filter(t => t.favorite).map(t => t.id)));
  const [now, setNow] = useState(0);
  const [scale, setScale] = useState(1);
  const [heading, setHeading] = useState(0);
  const [range, setRange] = useState(2);   // miles shown at the outer rim
  const [navId, setNavId] = useState(null);
  const [navProgress, setNavProgress] = useState(0);
  const [arrived, setArrived] = useState(false);
  const [compassLive, setCompassLive] = useState(false);

  const dragRef = useRef(false);
  const velRef = useRef(0);
  const lastRef = useRef({ t: 12, tm: 0 });
  const snapRef = useRef(null);
  const navWalkRef = useRef(false);
  const vibeRef = useRef(-1);

  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit(); window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // animation + momentum loop
  useEffect(() => {
    let raf, prev = performance.now();
    const tick = (ts) => {
      const dt = Math.min(40, ts - prev); prev = ts;
      setNow(ts);
      // simulated walk toward a locked truck (real build: driven by GPS watchPosition)
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
              const near = KINDLE.reduce((p,c)=>Math.abs(c-nt)<Math.abs(p-nt)?c:p, KINDLE[0]);
              snapRef.current = Math.abs(near-nt) < 0.55 ? near : Math.round(nt*4)/4;
              velRef.current = 0;
            }
            return nt;
          });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

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
        const near = KINDLE.reduce((p,c)=>Math.abs(c-cur)<Math.abs(p-cur)?c:p, KINDLE[0]);
        snapRef.current = Math.abs(near-cur) < 0.5 ? near : cur;
        return cur;
      });
    }
  }, [tweaks.momentum]);

  // craving match
  const stations = window.CRAVINGS;
  const matchOf = useCallback((truck) => {
    const tag = stations[D.clamp(craving,0,stations.length-1)].tag;
    return tag == null ? 1 : (truck.cravings.includes(tag) ? 1 : 0);
  }, [craving]);

  // single tap -> open detail card
  const onTapBody = (id) => { setCardId(id); setSelectedId(id); };
  const toggleWatch = (id) => setWatched((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // navigation (GUIDE ME) — simulated approach; real build swaps in geolocation
  const startNav = (id) => { setNavId(id); setNavProgress(0); setArrived(false); vibeRef.current = -1; navWalkRef.current = true; setCardId(null); setSelectedId(id); };
  const stopNav = () => { navWalkRef.current = false; setNavId(null); setNavProgress(0); setArrived(false); };

  // device compass (real on phones; manual rim-drag elsewhere)
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
      setCompassLive(true);
    } catch (err) { /* sensor unavailable — manual heading still works */ }
  };

  const fieldR = Math.min(W, H*0.48) * 0.45;
  const fieldCx = W/2, fieldCy = H*0.47;

  const cardTruck = window.TRUCKS.find(x => x.id === cardId);
  const navTruck = navId ? window.TRUCKS.find(x => x.id === navId) : null;
  const navPlan = navTruck ? D.planFor(navTruck, day) : null;
  const navDist = navPlan ? navPlan.dist * (1 - navProgress * 0.93) : 0;
  const openCount = window.TRUCKS.filter(tr => D.powerAt(tr, t, day) > 0.5).length;

  // day pips: a watched truck is out & within 1.2mi that day

  return (
    <div className={"stage pal-" + tweaks.palette} style={{ width: W, height: H, transform: `scale(${scale})` }}>
      <div className="paper" />
      <div className="frame-rule" />

      {/* header */}
      <header className="hdr">
        <div className="hdr-power">FUEL</div>
        <div className="hdr-titles">
          <div className="hdr-mark">FUEL</div>
          <div className="hdr-sub">SET THE HOUR. FIND THE FOOD.</div>
        </div>
        <div className="hdr-count">
          <span className="hdr-count-n">{openCount}</span>
          <span className="hdr-count-k">OPEN<br/>NOW</span>
        </div>
      </header>

      {/* cuisine lens — slim, under the header */}
      <window.LensStrip craving={craving} onCraving={setCraving} />

      <window.Field t={t} day={day} fieldR={fieldR} cx={fieldCx} cy={fieldCy}
        matchOf={matchOf} shape={tweaks.emblem} selectedId={selectedId} watched={watched}
        onTapBody={onTapBody} onTapField={() => setSelectedId(null)}
        speed={tweaks.speed} now={now} trucks={window.TRUCKS}
        heading={heading} onHeading={setHeading} range={range} onRange={setRange}
        navId={navId} navProgress={navProgress} />

      {/* compass readout — tap to use device sensor; drag the dial to rotate */}
      <button className={"compass-chip" + (compassLive ? " live" : "")} onClick={enableCompass}>
        <span className="cc-rose">✣</span>
        <span className="cc-deg">{Math.round(heading)}°</span>
        <span className="cc-state">{compassLive ? "LIVE" : "MANUAL"}</span>
      </button>

      {range < 1.98 && (
        <button className="zoom-chip" onClick={() => setRange(2)}>{range.toFixed(range<1?2:1)} MI · RESET</button>
      )}

      {/* navigation banner */}
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

      <window.WatchTab count={watched.size} onOpen={() => setLedgerOpen(true)} />

      <window.Console t={t} day={day} onDay={setDay}
        onScrub={onScrub} onScrubEnd={onScrubEnd} dragRef={dragRef} />

      {cardTruck && <window.TruckCard truck={cardTruck} t={t} day={day} watched={watched}
        onClose={() => { setCardId(null); setSelectedId(null); }} onWatch={toggleWatch} onGuide={startNav} />}

      <window.AlertsLedger open={ledgerOpen} watched={watched} day={day} t={t}
        trucks={window.TRUCKS} onClose={() => setLedgerOpen(false)}
        onPick={(id) => { setLedgerOpen(false); onTapBody(id); }} onWatch={toggleWatch} />

    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
