// card.jsx — DYNAMO truck detail card (day-aware). Exposes window.TruckCard.
function TruckCard({ truck, t, day, watched, onClose, onWatch, onGuide }) {
  if (!truck) return null;
  const D = window.DYNAMO;
  const DGlyph = window.DGlyph;
  const days = window.DAYS;
  const plan = D.planFor(truck, day);
  // Live status: now-relative claim ONLY on real today @ the real clock (shared
  // engine rule, mirrors the watchlist). null on any other day → neutral schedule
  // info, no vermillion. Emblem lit/ghost on the dial stays scrubbed (field.jsx).
  const liveStatus = D.liveStatusAt(truck, day);
  const liveOn = day === 0 && plan && D.powerAt(truck, D.realNowHour, 0) > 0.5;
  const statusText = liveStatus ? {
    open:"OPEN NOW", opening:"JUST OPENED", closing:"CLOSING SOON",
    soon: plan ? `OPENS ${D.fmtTime(plan.open).label}` : "", closed:"CLOSED FOR THE DAY",
    off:"NOT OUT THIS DAY",
  }[liveStatus]
    : (plan ? `${days[day].weekday} · ${D.fmtHM(plan.open)}–${D.fmtHM(plan.close)}`
            : `NOT SCHEDULED ${days[day].weekday}`);
  const isWatched = watched.has(truck.id);
  const dirOf = (b) => D.compassDir(b);

  const { sheetRef, dragStyle, gripHandlers } = window.useSwipeDismiss(onClose);

  return (
    <div className="card-scrim" onClick={onClose}>
      <div className="card" ref={sheetRef} style={dragStyle} onClick={(ev) => ev.stopPropagation()}>
        <div className="card-step" />
        <div className="card-grip" {...gripHandlers} aria-hidden="true"><span className="grip-pill" /></div>
        <div className="card-body">
        <div className="card-head">
          <div className={"card-badge" + (liveOn ? " on" : "")}>
            <DGlyph name={truck.glyph} size={30} />
          </div>
          <div className="card-titles">
            <div className="card-name">{truck.name}</div>
            <div className="card-cuisine">{truck.cuisine} · {"$".repeat(truck.price)}</div>
          </div>
          <button className={"card-fav" + (isWatched ? " on" : "")} onClick={() => onWatch(truck.id)} aria-label="watch">★</button>
        </div>

        <div className={"card-status" + (liveOn ? " on" : "")}>
          <span className="card-status-dot" />{statusText}
        </div>

        {plan ? (
          <div className="card-grid">
            <div className="card-cell card-wide"><div className="cell-k">WHERE · {dirOf(plan.bearing)}</div>
              <div className="cell-v">{plan.name}</div></div>
            <div className="card-cell"><div className="cell-k">{days[day].today ? "TODAY" : days[day].weekday} HOURS</div>
              <div className="cell-v">{D.fmtHM(plan.open)}–{D.fmtHM(plan.close)}</div></div>
            <div className="card-cell"><div className="cell-k">DISTANCE</div>
              <div className="cell-v">{plan.dist.toFixed(1)} MI · {D.walkMin(plan.dist)} MIN</div></div>
            <div className="card-cell card-wide"><div className="cell-k">SIGNATURE · {"$".repeat(truck.price)}</div>
              <div className="cell-v">{truck.signature}</div></div>
          </div>
        ) : (
          <div className="card-grid"><div className="card-cell card-wide">
            <div className="cell-k">{days[day].weekday}</div>
            <div className="cell-v">Off the road — not serving this day.</div></div></div>
        )}

        <div className="card-blurb">{truck.blurb}</div>

        {/* week strip — which days it's out */}
        <div className="card-week">
          {days.map((dd) => {
            const pl = D.planFor(truck, dd.idx);
            return (
              <div key={dd.idx} className={"wk" + (dd.idx===day ? " sel" : "") + (pl ? " out" : " gone")}>
                <span className="wk-d">{dd.key === "TODAY" ? "TDY" : dd.key}</span>
                <span className="wk-bar" />
              </div>
            );
          })}
        </div>

        {plan && (
          <div className="card-timeline">
            <div className="tl-track">
              <div className="tl-win" style={{
                left: `${((plan.open - D.DAY_START)/(D.DAY_END-D.DAY_START))*100}%`,
                width: `${((plan.close - plan.open)/(D.DAY_END-D.DAY_START))*100}%` }} />
              {days[day].today && <div className="tl-now" style={{ left: `${((t - D.DAY_START)/(D.DAY_END-D.DAY_START))*100}%` }} />}
            </div>
            <div className="tl-axis"><span>7A</span><span>2P</span><span>10P</span></div>
          </div>
        )}

        <div className="card-actions">
          {plan && onGuide && (
            <button className="card-guide" onClick={() => onGuide(truck.id)}>✣&nbsp;&nbsp;GUIDE ME HERE</button>
          )}
          <button className={"card-watch" + (isWatched ? " on" : "")} onClick={() => onWatch(truck.id)}>
            {isWatched ? "★  WATCHING" : "☆  WATCH"}
          </button>
        </div>
        </div>{/* end card-body */}
      </div>
    </div>
  );
}
window.TruckCard = TruckCard;
