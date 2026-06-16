// eventcard.jsx — Event detail card for OFFLINE//EVENTS mode.
// Exposes window.EventCard. Reuses the card shell and all card CSS.
function EventCard({ entity, t, day, days = window.DAYS, watched, userPos, onClose, onWatch, onGuide }) {
  if (!entity || !entity._event) return null;
  const D = window.DYNAMO;
  const DGlyph = window.DGlyph;
  const ev = entity._event;

  // Geo-aware: real distance/bearing from the user's position when YOU is active;
  // planFor falls back to the stored anchor estimate when userPos is null. `days` is the
  // active mode's day frame (DAYS for EVENTS; FESTIVAL_DAYS for FESTIVAL).
  const plan = D.planFor(entity, day, userPos?.lat, userPos?.lng, days);
  // Live status: shared engine rule — now-relative claim ONLY on real today @ the
  // real clock; null on any other day → neutral schedule info, no vermillion. Same
  // statusAt tokens as the food card (one threshold set — food/events parity).
  const liveStatus = D.liveStatusAt(entity, day, days);
  const on = D.isLiveNow(entity, day, days);
  const isWatched = watched.has(entity.id);

  const statusText = liveStatus ? {
    open:"HAPPENING NOW", opening:"JUST STARTED", closing:"ENDING SOON",
    soon: plan ? `STARTS ${D.fmtTime(plan.open).label}` : "", closed:"FINISHED",
    off:"NOT ON THIS DAY",
  }[liveStatus]
    : (plan ? `${days[day].weekday} · ${D.fmtHM(plan.open)}–${D.fmtHM(plan.close)}`
            : `NOT SCHEDULED ${days[day].weekday}`);

  // All upcoming occurrences (uses standard upcomingWindows since entity is normalised).
  // Trailing lat/lng matches drawer.jsx so upcoming distances are geo-aware too.
  const upcoming = D.upcomingWindows(entity, day, t, 4, userPos?.lat, userPos?.lng, days);

  const { sheetRef, dragStyle, gripHandlers } = window.useSwipeDismiss(onClose);

  return (
    <div className="card-scrim" onClick={onClose}>
      <div className="card" ref={sheetRef} style={dragStyle} onClick={(ev) => ev.stopPropagation()}>
        <div className="card-step" />
        <div className="card-grip" {...gripHandlers} aria-hidden="true"><span className="grip-pill" /></div>

        <div className="card-body">
        <div className="card-head">
          <div className={"card-badge" + (on ? " on" : "")}>
            <DGlyph name={entity.glyph} size={30} />
          </div>
          <div className="card-titles">
            <div className="card-name ev-name">{entity.name}</div>
            <div className="card-cuisine">{ev.venue} · {ev.price}</div>
          </div>
          <button className={"card-fav" + (isWatched ? " on" : "")}
            onClick={() => onWatch(entity.id)} aria-label="watch">★</button>
        </div>

        <div className={"card-status" + (on ? " on" : "")}>
          <span className="card-status-dot" />{statusText}
        </div>

        {/* occurrence grid */}
        <div className="card-grid">
          <div className="card-cell card-wide">
            <div className="cell-k">VENUE</div>
            <div className="cell-v">{ev.venue}</div>
          </div>
          {plan ? (
            <>
              <div className="card-cell">
                <div className="cell-k">{days[day].today ? "TODAY" : days[day].weekday} HOURS</div>
                <div className="cell-v">{D.fmtHM(plan.open)}–{D.fmtHM(plan.close)}</div>
              </div>
              <div className="card-cell">
                <div className="cell-k">DISTANCE</div>
                <div className="cell-v">{D.fmtMiles(plan.dist)} mi · {D.travelEstimate(plan.dist)}</div>
              </div>
            </>
          ) : (
            <div className="card-cell card-wide">
              <div className="cell-k">{days[day].weekday}</div>
              <div className="cell-v">Not scheduled this day.</div>
            </div>
          )}
          <div className="card-cell card-wide">
            <div className="cell-k">ADMISSION</div>
            <div className="cell-v">{ev.price}</div>
          </div>
        </div>

        <div className="card-blurb">{ev.blurb}</div>

        {/* occurrence strip — which days this event runs */}
        <div className="card-week">
          {days.map((dd) => {
            const pl = D.planFor(entity, dd.idx, undefined, undefined, days);
            return (
              <div key={dd.idx} className={"wk" + (dd.idx === day ? " sel" : "") + (pl ? " out" : " gone")}>
                <span className="wk-d">{dd.key === "TODAY" ? "TDY" : dd.key}</span>
                <span className="wk-bar" />
              </div>
            );
          })}
        </div>

        {/* today's timeline if there's an occurrence */}
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

        {/* upcoming windows if any */}
        {upcoming.length > 0 && (
          <div className="ev-upcoming">
            <div className="ev-upcoming-label">UPCOMING</div>
            {upcoming.map((w, i) => (
              <div key={i} className={"ev-win" + (w.live ? " live" : "")}>
                <span className="ev-win-day">{days[w.day].today ? "TODAY" : days[w.day].weekday}</span>
                <span className="ev-win-time">{D.fmtHM(w.open)}–{D.fmtHM(w.close)}</span>
                <span className="ev-win-dist">{D.fmtMiles(w.dist)} MI {D.compassDir(w.bearing)}</span>
                {w.live && <span className="ev-win-live">● LIVE</span>}
              </div>
            ))}
          </div>
        )}

        {ev.ticketUrl && (
          <a className="ev-ticket" href={ev.ticketUrl} target="_blank" rel="noopener noreferrer">
            ✣&nbsp;&nbsp;GET TICKETS
          </a>
        )}

        <div className="card-actions">
          {plan && onGuide && (
            <button className="card-guide" onClick={() => onGuide(entity.id)}>✣&nbsp;&nbsp;GUIDE ME HERE</button>
          )}
          <button className={"card-watch" + (isWatched ? " on" : "")} onClick={() => onWatch(entity.id)}>
            {isWatched ? "★  WATCHING" : "☆  WATCH"}
          </button>
        </div>
        </div>{/* end card-body */}
      </div>
    </div>
  );
}

window.EventCard = EventCard;
