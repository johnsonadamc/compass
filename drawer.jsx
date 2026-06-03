// drawer.jsx — DYNAMO WATCHLIST tab + ALERTS LEDGER sheet.
// Exposes window.WatchTab and window.AlertsLedger.

function WatchTab({ count, onOpen }) {
  return (
    <button className="watchtab" onClick={onOpen} aria-label="watchlist">
      <span className="watchtab-star">★</span>
      <span className="watchtab-text">WATCHLIST</span>
      {count > 0 && <span className="watchtab-count">{count}</span>}
    </button>
  );
}

function AlertsLedger({ open, watched, day, t, trucks, onClose, onPick, onWatch }) {
  if (!open) return null;
  const D = window.DYNAMO;
  const DGlyph = window.DGlyph;
  const days = window.DAYS;
  const list = trucks.filter((tr) => watched.has(tr.id));

  return (
    <div className="ledger-scrim" onClick={onClose}>
      <div className="ledger" onClick={(ev) => ev.stopPropagation()}>
        <div className="card-step" />
        <div className="ledger-head">
          <div>
            <div className="ledger-title">WATCHLIST</div>
            <div className="ledger-sub">UPCOMING WINDOWS NEAR YOU</div>
          </div>
          <button className="ledger-close" onClick={onClose} aria-label="close">✕</button>
        </div>

        {list.length === 0 ? (
          <div className="ledger-empty">
            <div className="ledger-empty-star">☆</div>
            <div className="ledger-empty-t">No trucks watched yet</div>
            <div className="ledger-empty-s">Tap a station, then ★ WATCH to track when it's powered up near you.</div>
          </div>
        ) : (
          <div className="ledger-list">
            {list.map((tr) => {
              const next = D.upcomingWindows(tr, day, t, 3);
              const isWatched = watched.has(tr.id);
              return (
                <div key={tr.id} className="ld-row">
                  <button className="ld-badge" onClick={() => onPick(tr.id)} aria-label={tr.name}>
                    <DGlyph name={tr.glyph} size={22} />
                  </button>
                  <div className="ld-main">
                    <div className="ld-name" onClick={() => onPick(tr.id)}>{tr.name}</div>
                    {next.length === 0 ? (
                      <div className="ld-none">Not out in the next 7 days</div>
                    ) : (
                      <div className="ld-windows">
                        {next.map((w, i) => (
                          <div key={i} className={"ld-win" + (w.live ? " live" : "")}>
                            <span className="ld-day">{days[w.day].today ? "TODAY" : days[w.day].weekday}</span>
                            <span className="ld-time">{D.fmtHM(w.open)}–{D.fmtHM(w.close)}</span>
                            <span className="ld-dist">{w.dist.toFixed(1)}MI {D.compassDir(w.bearing)}</span>
                            <span className="ld-loc">{w.name}</span>
                            {w.live && <span className="ld-livedot">● LIVE</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="ld-star on" onClick={() => onWatch(tr.id)} aria-label="unwatch">★</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

window.WatchTab = WatchTab;
window.AlertsLedger = AlertsLedger;
