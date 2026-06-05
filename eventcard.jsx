// eventcard.jsx — Event detail card for OFFLINE//EVENTS mode.
// Exposes window.EventCard. Reuses the card shell and all card CSS.
function EventCard({ entity, t, day, watched, onClose, onWatch }) {
  if (!entity || !entity._event) return null;
  const D = window.DYNAMO;
  const DGlyph = window.DGlyph;
  const days = window.DAYS;
  const ev = entity._event;

  const plan = D.planFor(entity, day);
  const power = plan ? D.powerAt(entity, t, day) : 0;
  const on = power > 0.5;
  const isWatched = watched.has(entity.id);

  // Human-readable status for this event occurrence
  const statusText = (() => {
    if (!plan) return "NOT ON THIS DAY";
    if (power <= 0.03) return t < plan.open ? `STARTS ${D.fmtTime(plan.open).label}` : "FINISHED";
    if (t < plan.open + 0.5) return "JUST STARTED";
    if (t > plan.close - 0.5) return "ENDING SOON";
    return "HAPPENING NOW";
  })();

  // All upcoming occurrences (uses standard upcomingWindows since entity is normalised)
  const upcoming = D.upcomingWindows(entity, day, t, 4);

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
            <div className="card-name">{entity.name}</div>
            <div className="card-cuisine">{ev.venue} · {ev.price}</div>
          </div>
          <button className={"card-fav" + (isWatched ? " on" : "")}
            onClick={() => onWatch(entity.id)} aria-label="watch">★</button>
        </div>

        <div className={"card-status" + (on ? " on" : (!plan ? " off" : ""))}>
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
                <div className="cell-v">{plan.dist.toFixed(1)} MI · {D.compassDir(plan.bearing)}</div>
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
            const pl = D.planFor(entity, dd.idx);
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
                <span className="ev-win-dist">{w.dist.toFixed(1)} MI {D.compassDir(w.bearing)}</span>
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

        <button className={"card-watch" + (isWatched ? " on" : "")} onClick={() => onWatch(entity.id)}>
          {isWatched ? "★  WATCHING" : "☆  WATCH THIS EVENT"}
        </button>
        </div>{/* end card-body */}
      </div>
    </div>
  );
}

window.EventCard = EventCard;
