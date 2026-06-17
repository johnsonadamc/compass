// field.jsx — DYNAMO dispatch field: hub, rings, spokes, emblems + live compass.
// Exposes window.Field.
const { useRef: useRefF } = React;

// ---- Flick-spin tuning — adjust these to change the feel ----
const DIAL_FLICK_THRESHOLD = 0.08;  // deg/ms  — minimum release speed to trigger spin momentum
const DIAL_MAX_VEL         = 0.40;  // deg/ms  — cap: hard flick stays playful, not wild
const DIAL_STALE_MS        = 100;   // ms      — ignore velocity if pointer was idle before release

function Emblem({ truck, t, pos, size, power, match, shape, selected, watched, onTap, speed, ahead, homing, approach, festival }) {
  const D = window.DYNAMO;
  const DGlyph = window.DGlyph;
  const live = power;
  const on = live > 0.5;
  const matched = match > 0.5;
  const energized = on && matched;
  const dim = !matched || !on;

  // Festival-mode glyph type tint (a neutral channel; the CSS applies it ONLY on a non-live,
  // non-facing ghost). Derived from the normalized category tag (music/food/market). Gated on
  // the `festival` flag so BOTH festival modes (STATIC + NIGHTMOVES) tint; EVENTS/FOOD get no
  // type-* class → byte-identical render.
  const typeClass = festival ? " type-" + (truck.cravings && truck.cravings[0] || "") : "";

  const cls = "emblem shape-" + shape
    + (energized ? " energized" : on ? " on" : " off")
    + (dim ? " dim" : "")
    // `ahead` is already facing-AND-live-now (real clock); gate only on lens `matched`,
    // NOT scrubbed `!dim`, so the pulse tracks the real clock independent of the scrub.
    + (ahead && matched ? " ahead" : "")
    + (homing ? " homing" : "")
    + typeClass;

  return (
    <button className={cls} style={{
      left: pos.x, top: pos.y, width: size, height: size,
      transform: "translate(-50%,-50%)",
      zIndex: homing ? 55 : selected ? 50 : Math.round(20 + live * 12),
      opacity: dim && !selected && !homing ? 0.5 : 1,
      "--pulse-dur": homing ? `${(1.05 - approach*0.72).toFixed(2)}s` : undefined,
    }} onClick={(e) => { e.stopPropagation(); onTap(truck.id); }} aria-label={truck.name}>

      {(homing || ahead) && <span className="emblem-ping" aria-hidden="true" />}

      {energized && speed && (
        <svg className="emblem-rays" viewBox="0 0 100 100" width={size*1.42} height={size*1.42}>
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return <line key={i} x1={50+Math.cos(a)*37} y1={50+Math.sin(a)*37}
              x2={50+Math.cos(a)*(43+(i%2?5:2))} y2={50+Math.sin(a)*(43+(i%2?5:2))}
              strokeWidth="2.2" strokeLinecap="round" />;
          })}
        </svg>
      )}

      {watched && <span className="emblem-fav" aria-hidden="true">★</span>}
      {watched && <span className="emblem-watch" aria-hidden="true" />}

      <span className="emblem-face">
        <DGlyph name={truck.glyph} size={size * 0.46} />
      </span>

      {selected && <span className="emblem-select" />}
    </button>
  );
}

function Field({ t, day, fieldR, cx, cy, matchOf, shape, selectedId, watched, onTapBody, onTapField,
                 speed, now, trucks, days, rim, festival, anchorLabel, heading, onHeading, range, onRange, navId, navProgress, userPos,
                 onFlick, spinning, compassLive, onTapHub, geoDenied }) {
  const D = window.DYNAMO;
  const list = trucks || window.TRUCKS;
  // Per-mode day frame + rim (FESTIVAL overrides); fall back to the globals so nothing
  // breaks if a caller omits them.
  const DAYSET = days || window.DAYS;
  const RIM = rim ?? D.DEFAULT_RIM_MI;
  const ringFracs = [0.25, 0.5, 1];
  const milesLabel = (mi) => (mi < 1 ? mi.toFixed(2).replace(/0$/,'') : mi % 1 === 0 ? mi.toFixed(0) : mi.toFixed(1));
  const compass = [["N",0],["E",90],["S",180],["W",270]];
  const R = fieldR;
  const hr = heading * Math.PI / 180;
  const rot = (x, y) => ({ x: x*Math.cos(-hr) - y*Math.sin(-hr), y: x*Math.sin(-hr) + y*Math.cos(-hr) });

  // ---- bezel gestures: drag to rotate heading, wheel/pinch to zoom ----
  const bezelRef = useRefF(null);
  const rotRef = useRefF(null);
  const pinchRef = useRefF(null);
  // Timestamp of the last touch-driven hub tap. iOS Safari (touch-action:none + the
  // touchstart stopPropagation) suppresses the synthesized click, so the hub activates
  // from onTouchEnd directly; this guards onClick against the ghost click that some
  // browsers still fire afterward (deterministic, no preventDefault on passive touch).
  const tapGuardRef = useRefF(0);
  const center = () => { const r = bezelRef.current.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; };
  const angOf = (cxp, cyp) => { const c = center(); return Math.atan2(cyp - c.y, cxp - c.x) * 180 / Math.PI; };

  const onDown = (e) => {
    onFlick(0); // cancel any active spin the instant the user grabs the dial
    if (e.touches && e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { d0: Math.hypot(dx, dy), r0: range }; return;
    }
    const p = e.touches ? e.touches[0] : e;
    rotRef.current = { a0: angOf(p.clientX, p.clientY), h0: heading, moved: false };
  };
  const onMove = (e) => {
    if (pinchRef.current && e.touches && e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
      // pinch out (bigger distance) => zoom in => smaller range
      onRange(D.clamp(pinchRef.current.r0 * (pinchRef.current.d0 / Math.hypot(dx,dy)), RIM * 0.25, RIM));
      e.preventDefault(); return;
    }
    if (!rotRef.current) return;
    const p = e.touches ? e.touches[0] : e;
    const now = performance.now();
    const a1 = angOf(p.clientX, p.clientY);
    let delta = a1 - rotRef.current.a0;
    // track instantaneous angular velocity for flick detection on release
    // heading = h0 - (a1 - a0), so dHeading/dt = -d(a1)/dt
    if (rotRef.current.prevT !== undefined) {
      const dtm = now - rotRef.current.prevT;
      if (dtm > 0) rotRef.current.lastVel = -(a1 - rotRef.current.prevA) / dtm;
    }
    rotRef.current.prevA = a1;
    rotRef.current.prevT = now;
    if (Math.abs(delta) > 1.5) rotRef.current.moved = true;
    onHeading(((rotRef.current.h0 - delta) % 360 + 360) % 360);
  };
  const onUp = () => {
    if (rotRef.current) {
      if (!rotRef.current.moved) onTapField();
      // flick detection: only if the pointer was still moving at release
      const vel = rotRef.current.lastVel ?? 0;
      const age = performance.now() - (rotRef.current.prevT ?? 0);
      if (Math.abs(vel) > DIAL_FLICK_THRESHOLD && age < DIAL_STALE_MS) {
        onFlick(Math.sign(vel) * Math.min(Math.abs(vel), DIAL_MAX_VEL));
      }
    }
    rotRef.current = null; pinchRef.current = null;
  };
  // scroll up = zoom in = smaller rim range
  const onWheel = (e) => { e.preventDefault(); onRange(D.clamp(range * (1 + e.deltaY*0.0016), RIM * 0.25, RIM)); };

  // ---- placement: gather → fan co-located clusters (angular, radius-preserved) → rotate → declump ----
  const uLat = userPos?.lat, uLng = userPos?.lng;
  // Phase 1 — gather each entity's TRUE dial-space polar (baseAng, r); defer rotation + x/y.
  let placed = list.map((truck) => {
    const plan = D.planFor(truck, day, uLat, uLng, DAYSET); if (!plan) return null;
    let dist = plan.dist;
    if (truck.id === navId) dist = dist * (1 - navProgress * 0.93);
    const r = D.clamp(dist/range, 0, 1) * R;
    const baseAng = (plan.bearing - 90);   // TRUE dial-space angle (deg), pre-rotation
    const size = D.lerp(31, 41, D.clamp(1 - plan.dist/RIM, 0, 1));
    return { truck, baseAng, fanAng: baseAng, r, size, plan, dist,
      power: D.powerAt(truck, t, day, DAYSET), match: matchOf(truck),
      // live-now pulse predicate: shared rule — real clock on the real today only (mirrors
      // the cards & watchlist). Kept separate from scrubbed `power` so the pulse never
      // follows the scrub — lit/ghost stays on `power`, the ping rides `liveNow`.
      liveNow: D.isLiveNow(truck, day, DAYSET) };
  }).filter(Boolean);

  // Phase 2/3 — co-located entities fan symmetrically about their TRUE bearing at the SAME radius.
  // RENDER-ONLY: only fanAng (→ x/y) changes; plan.bearing/dist stay true (the cards & Guide Me call
  // planFor themselves and never read these x/y). Fan is in dial-space (pre-rot), so a cluster rotates
  // as one rigid group under live compass / flick and never scatters when spinning. The homing truck
  // is excluded so the nav needle keeps pointing at its true bearing.
  // TUNABLES — device-dial-radius (R) dependent; tune on a real phone (R varies by screen):
  const FAN_PAD = 9;                          // px — co-location gap (matches the declump threshold)
  const FAN_TARGET_SEP = 46;                  // px — desired center-to-center separation after fanning
  const FAN_MIN_STEP = 8 * Math.PI / 180;     // rad — floor so far-out clusters still visibly split
  const FAN_MAX_TOTAL = 110 * Math.PI / 180;  // rad — cap on total spread (denser clusters pack tighter)
  const ptOf = (pl) => { const a = pl.baseAng * Math.PI/180; return { x: Math.cos(a)*pl.r, y: Math.sin(a)*pl.r }; };

  // ---- FESTIVAL music-cluster time-collapse (render-layer only; runs BEFORE the fan) ----
  // At a shared music venue, only ONE act is relevant at the current scrub time t. Among
  // co-located MUSIC entities (same dial position, same festival day — placed already only
  // holds entities scheduled today), keep just one and drop the rest, so the cluster of 1
  // never fans: the act whose window [open,close) contains t (the current set), else the
  // next act starting later today (a dim ghost — before doors / changeover gaps), else
  // nothing (after the last set). This is pure SELECTION: the survivor renders with its
  // normal state treatment (lit/verm/ping if live per the real-clock rule; off-ghost +
  // type tint otherwise) — no engine/schedule/live-status touch, no new CSS. Markets and
  // food are NOT music → never collapsed (they keep the fan). Single-act music venues
  // (group of 1) are untouched. navId is never dropped (an active Guide Me keeps its needle).
  if (festival) {
    const typeOf = (pl) => pl.truck.cravings && pl.truck.cravings[0];   // "music" | "food" | "market"
    const winHas = (pl) => pl.plan.open <= t && t < pl.plan.close;      // half-open: no double-show at set boundaries
    const music = placed.filter((pl) => typeOf(pl) === "music" && pl.truck.id !== navId);
    const drop = new Set();
    const claimed = new Array(music.length).fill(false);
    for (let i = 0; i < music.length; i++) {
      if (claimed[i]) continue;
      const grp = [music[i]]; const pi = ptOf(music[i]); claimed[i] = true;
      for (let j = i + 1; j < music.length; j++) {
        if (claimed[j]) continue;
        const pj = ptOf(music[j]);
        if (Math.hypot(pj.x - pi.x, pj.y - pi.y) < (music[i].size + music[j].size) / 2 + FAN_PAD) { grp.push(music[j]); claimed[j] = true; }
      }
      if (grp.length < 2) continue;                                     // single-act venue → unaffected
      const inWin = grp.filter(winHas);
      let keepId = null;
      if (inWin.length) keepId = inWin.reduce((a, b) => b.plan.open > a.plan.open ? b : a).truck.id;        // current set (latest-started)
      else { const up = grp.filter((pl) => pl.plan.open > t);
             if (up.length) keepId = up.reduce((a, b) => b.plan.open < a.plan.open ? b : a).truck.id; }     // next set up (earliest)
      for (const pl of grp) if (pl.truck.id !== keepId) drop.add(pl.truck.id);   // keepId null → drop the whole cluster
    }
    if (drop.size) placed = placed.filter((pl) => !drop.has(pl.truck.id));
  }

  const fannable = placed.filter(pl => pl.truck.id !== navId);
  const clustered = new Array(fannable.length).fill(false);
  for (let i = 0; i < fannable.length; i++) {
    if (clustered[i]) continue;
    const group = [i]; const pi = ptOf(fannable[i]);
    for (let j = i+1; j < fannable.length; j++) {
      if (clustered[j]) continue;
      const pj = ptOf(fannable[j]);
      if (Math.hypot(pj.x-pi.x, pj.y-pi.y) < (fannable[i].size+fannable[j].size)/2 + FAN_PAD) group.push(j);
    }
    if (group.length > 1) {
      group.forEach(k => clustered[k] = true);
      group.sort((a,b) => fannable[a].truck.id < fannable[b].truck.id ? -1 : 1); // deterministic, stable per frame
      const N = group.length;
      const rMean = group.reduce((s,k) => s + fannable[k].r, 0) / N;
      // chord sizing: separate ~FAN_TARGET_SEP px at radius rMean, floored, total spread capped.
      let step = rMean > 1 ? 2 * Math.asin(Math.min(1, FAN_TARGET_SEP/(2*rMean))) : FAN_MIN_STEP;
      step = Math.max(step, FAN_MIN_STEP);
      if ((N-1)*step > FAN_MAX_TOTAL) step = FAN_MAX_TOTAL/(N-1);
      group.forEach((k, idx) => { fannable[k].fanAng = fannable[k].baseAng + (idx - (N-1)/2) * step * 180/Math.PI; });
    }
  }

  // Phase 4 — rotate by heading. Fanned angle drives the emblem x/y; the TRUE angle drives the
  // facing-ping (trueX/trueY), so the ping stays tied to true bearing regardless of the fan.
  for (const pl of placed) {
    const fr = pl.fanAng * Math.PI/180, trr = pl.baseAng * Math.PI/180;
    const f = rot(Math.cos(fr)*pl.r, Math.sin(fr)*pl.r);
    const tp = rot(Math.cos(trr)*pl.r, Math.sin(trr)*pl.r);
    pl.x = f.x; pl.y = f.y; pl.trueX = tp.x; pl.trueY = tp.y;
  }

  // Phase 5 — existing pixel-declump safety net for incidental cross-venue near-misses. No longer
  // hits the degenerate zero-direction case: the fan separates coincident points first.
  for (let it = 0; it < 7; it++) {
    for (let i = 0; i < placed.length; i++) for (let j = i+1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      if (a.truck.id === navId || b.truck.id === navId) continue;
      const dx = b.x-a.x, dy = b.y-a.y; const d = Math.hypot(dx,dy) || 0.01;
      const min = (a.size+b.size)/2 + 9;
      if (d < min) { const push=(min-d)/2, ux=dx/d, uy=dy/d; a.x-=ux*push; a.y-=uy*push; b.x+=ux*push; b.y+=uy*push; }
    }
  }
  const navPl = placed.find(pl => pl.truck.id === navId);

  return (
    <div className={"field" + (spinning ? " spinning" : "")} style={{ left: cx, top: cy, transform: `translate(-50%,-50%)` }}
      ref={bezelRef}
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
      onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp} onWheel={onWheel}>

      <svg className="field-svg" width={R*2+96} height={R*2+96}
        viewBox={`${-R-48} ${-R-48} ${R*2+96} ${R*2+96}`}>
        {Array.from({ length: 24 }).map((_, i) => {
          const a = (i/24)*Math.PI*2; const major = i%6===0;
          return <line key={"s"+i} x1={Math.cos(a)*26} y1={Math.sin(a)*26}
            x2={Math.cos(a)*R} y2={Math.sin(a)*R} className={major?"spoke major":"spoke"} />;
        })}
        {ringFracs.map((frac, i) => { const r = frac*R;
          return <g key={"r"+i}>
            <circle cx="0" cy="0" r={r} className={"ring"+(i===ringFracs.length-1?" outer":"")} />
            {i===ringFracs.length-1 && <circle cx="0" cy="0" r={r-3.5} className="ring outer2" />}
          </g>; })}
        {Array.from({ length: 48 }).map((_, i) => {
          const a = (i/48)*Math.PI*2; const major = i%4===0;
          const r0 = R-(major?9:5), r1 = R;
          return <line key={"t"+i} x1={Math.cos(a)*r0} y1={Math.sin(a)*r0} x2={Math.cos(a)*r1} y2={Math.sin(a)*r1} className="tick" />;
        })}
        {/* navigation needle */}
        {navPl && <line x1="0" y1="0" x2={navPl.x} y2={navPl.y} className="nav-needle" />}
      </svg>

      {/* facing wedge — points to top (the direction you're heading) */}
      <div className="facing" aria-hidden="true" />

      {/* ring mileage labels (reflect current zoom range) */}
      {ringFracs.map((frac, i) => (<div key={i} className="ring-label" style={{ top: -(frac*R) }}>{milesLabel(frac*range)} MI</div>))}

      {/* compass letters (rotate with heading) */}
      {compass.map(([d, deg]) => {
        const rad = (deg-90)*Math.PI/180; const rr = R - 22;
        const p = rot(Math.cos(rad)*rr, Math.sin(rad)*rr);
        return <div key={d} className={"compass" + (d==="N"?" north":"")} style={{ left: p.x, top: p.y }}>{d}</div>;
      })}

      {/* HUB = YOU — tap to request location (live compass is the compass chip's own gesture) */}
      <button type="button"
        className={"hub" + (compassLive ? " live" : "")}
        // onClick covers desktop; the ~700ms guard ignores the ghost click that follows a
        // touch tap so we never double-activate.
        onClick={() => { if (Date.now() - tapGuardRef.current < 700) return; onTapHub(); }}
        onMouseDown={e => e.stopPropagation()}
        onTouchStart={e => e.stopPropagation()}
        // iOS Safari suppresses the synthesized click here, so activate from touchend directly.
        // stopPropagation keeps the dial-drag guard; the timestamp de-dupes the trailing click.
        onTouchEnd={e => { e.stopPropagation(); tapGuardRef.current = Date.now(); onTapHub(); }}
        aria-label={userPos ? "location active" : "tap to activate location"}>
        <span className="hub-pulse" aria-hidden="true" />
        <svg viewBox="0 0 80 80" width="46" height="46">
          <circle cx="40" cy="40" r="37" className="hub-ring1" />
          <circle cx="40" cy="40" r="29" className="hub-ring2" />
          <circle cx="40" cy="40" r="20" className="hub-ring3" />
          <circle cx="40" cy="40" r="8.5" className="hub-core" />
          <line x1="3" y1="40" x2="20" y2="40" className="hub-bar" />
          <line x1="60" y1="40" x2="77" y2="40" className="hub-bar" />
        </svg>
        {userPos
          ? <div className="hub-label">YOU</div>
          : <div className="hub-label hub-label-anchor">{anchorLabel || window.CITIES[window.DEFAULT_CITY].hubLabel}</div>}
        {!userPos &&
          // denied/unavailable → quiet note (not a silent failure); a tap retries the request.
          // Once located, the compass chip's own blue pulse signals the "go live" step (no center hint).
          <div className="hub-tap-invite">{geoDenied ? "LOCATION OFF · TAP TO RETRY" : "TAP TO LOCATE"}</div>}
      </button>

      {placed.map((pl) => {
        // facing-ping keys off the TRUE rotated position (trueX/trueY), not the fanned x/y —
        // a co-location nudge must not shift what the ping fires on (true bearing only).
        const angDeg = Math.atan2(pl.trueY, pl.trueX) * 180/Math.PI;       // true screen angle
        const ahead = Math.abs(((angDeg + 90) % 360 + 360) % 360 - 0) < 22 || Math.abs(((angDeg+90)%360+360)%360 - 360) < 22;
        const isNav = pl.truck.id === navId;
        return <Emblem key={pl.truck.id} truck={pl.truck} t={t} pos={{x:pl.x,y:pl.y,r:pl.r}} size={pl.size}
          power={pl.power} match={pl.match} shape={shape} festival={festival}
          selected={selectedId===pl.truck.id} watched={watched.has(pl.truck.id)}
          onTap={onTapBody} speed={speed} now={now}
          ahead={ahead && pl.liveNow} homing={isNav} approach={isNav?navProgress:0} />;
      })}

      {placed.map((pl) => {
        if (pl.power < 0.5 || pl.match < 0.5) return null;
        const rr = Math.max(1, Math.hypot(pl.x, pl.y));
        const off = pl.size*0.5 + 12;
        const dir = rr > R*0.52 ? -1 : 1;
        const lx = (rr<6?0:(pl.x/rr)*off*dir), ly = (rr<6?off:(pl.y/rr)*off*dir);
        return <div key={pl.truck.id} className="emblem-label"
          style={{ left: D.clamp(pl.x+lx,-R+34,R-34), top: D.clamp(pl.y+ly,-R+14,R-14) }}>{pl.truck.name}</div>;
      })}
    </div>
  );
}

window.Field = Field;
