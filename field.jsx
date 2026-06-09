// field.jsx — DYNAMO dispatch field: hub, rings, spokes, emblems + live compass.
// Exposes window.Field.
const { useRef: useRefF } = React;

// ---- Flick-spin tuning — adjust these to change the feel ----
const DIAL_FLICK_THRESHOLD = 0.08;  // deg/ms  — minimum release speed to trigger spin momentum
const DIAL_MAX_VEL         = 0.40;  // deg/ms  — cap: hard flick stays playful, not wild
const DIAL_STALE_MS        = 100;   // ms      — ignore velocity if pointer was idle before release

function Emblem({ truck, t, pos, size, power, match, shape, selected, watched, onTap, speed, ahead, homing, approach }) {
  const D = window.DYNAMO;
  const DGlyph = window.DGlyph;
  const live = power;
  const on = live > 0.5;
  const matched = match > 0.5;
  const energized = on && matched;
  const dim = !matched || !on;

  const cls = "emblem shape-" + shape
    + (energized ? " energized" : on ? " on" : " off")
    + (dim ? " dim" : "")
    // `ahead` is already facing-AND-live-now (real clock); gate only on lens `matched`,
    // NOT scrubbed `!dim`, so the pulse tracks the real clock independent of the scrub.
    + (ahead && matched ? " ahead" : "")
    + (homing ? " homing" : "");

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
                 speed, now, trucks, heading, onHeading, range, onRange, navId, navProgress, userPos,
                 onFlick, spinning, compassLive, onTapHub, geoDenied }) {
  const D = window.DYNAMO;
  const list = trucks || window.TRUCKS;
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
      onRange(D.clamp(pinchRef.current.r0 * (pinchRef.current.d0 / Math.hypot(dx,dy)), D.DEFAULT_RIM_MI * 0.25, D.DEFAULT_RIM_MI));
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
  const onWheel = (e) => { e.preventDefault(); onRange(D.clamp(range * (1 + e.deltaY*0.0016), D.DEFAULT_RIM_MI * 0.25, D.DEFAULT_RIM_MI)); };

  // ---- placement (with heading rotation + declump) ----
  const uLat = userPos?.lat, uLng = userPos?.lng;
  const placed = list.map((truck) => {
    const plan = D.planFor(truck, day, uLat, uLng); if (!plan) return null;
    let dist = plan.dist;
    if (truck.id === navId) dist = dist * (1 - navProgress * 0.93);
    const rr = D.clamp(dist/range, 0, 1) * R;
    const baseAng = (plan.bearing - 90);
    const rad = baseAng * Math.PI/180;
    const raw = rot(Math.cos(rad)*rr, Math.sin(rad)*rr);
    const size = D.lerp(31, 41, D.clamp(1 - plan.dist/D.DEFAULT_RIM_MI, 0, 1));
    return { truck, x: raw.x, y: raw.y, r: rr, size, plan, dist,
      power: D.powerAt(truck, t, day), match: matchOf(truck),
      // live-now pulse predicate: real clock on the real day only (mirrors the cards
      // & watchlist). Kept separate from scrubbed `power` so the pulse never follows
      // the scrub — lit/ghost stays on `power`, the ping rides `liveNow`.
      liveNow: day === 0 && D.powerAt(truck, D.realNowHour, 0) > 0.5 };
  }).filter(Boolean);
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
          : <div className="hub-label hub-label-anchor">{window.CITIES[window.DEFAULT_CITY].hubLabel}</div>}
        {!userPos &&
          // denied/unavailable → quiet note (not a silent failure); a tap retries the request.
          // Once located, the compass chip's own blue pulse signals the "go live" step (no center hint).
          <div className="hub-tap-invite">{geoDenied ? "LOCATION OFF · TAP TO RETRY" : "TAP TO LOCATE"}</div>}
      </button>

      {placed.map((pl) => {
        const angDeg = Math.atan2(pl.y, pl.x) * 180/Math.PI;       // screen angle
        const ahead = Math.abs(((angDeg + 90) % 360 + 360) % 360 - 0) < 22 || Math.abs(((angDeg+90)%360+360)%360 - 360) < 22;
        const isNav = pl.truck.id === navId;
        return <Emblem key={pl.truck.id} truck={pl.truck} t={t} pos={{x:pl.x,y:pl.y,r:pl.r}} size={pl.size}
          power={pl.power} match={pl.match} shape={shape}
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
