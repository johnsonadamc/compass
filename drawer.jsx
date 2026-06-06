// drawer.jsx — OFFLINE WATCHLIST tab + ALERTS LEDGER sheet.
// Exposes window.WatchTab and window.AlertsLedger.

function WatchTab({ count, liveCount, onOpen }) {
  return (
    <button className="watchtab" onClick={onOpen} aria-label="watchlist">
      <span className="watchtab-star">★</span>
      <span className="watchtab-text">WATCHLIST</span>
      {count > 0 && <span className="watchtab-count">{count}</span>}
      {liveCount > 0 && <span className="watchtab-live" aria-label={liveCount + " live now"} />}
    </button>
  );
}

// Resolve all watched items from both food + events globals.
// Returns { foodItems, eventItems } — each an array of normalized entities.
function resolveWatched(watched) {
  const D = window.DYNAMO;
  const foodItems = (window.TRUCKS || []).filter(tr => watched.has(tr.id));
  const eventItems = (window.EVENTS || [])
    .filter(ev => watched.has(ev.id))
    .map(D.eventToEntity);
  return { foodItems, eventItems };
}

function HappeningNow({ items, t, userPos, onPick, onWatch }) {
  const D = window.DYNAMO;
  const DGlyph = window.DGlyph;
  const uLat = userPos?.lat, uLng = userPos?.lng;
  // day 0 = today always for "happening now"
  const live = items.filter(e => D.powerAt(e, t, 0) > 0.5);
  if (live.length === 0) return null;
  return (
    <div className="ledger-section">
      <div className="ledger-section-head happening-head">
        <span className="ledger-section-label">HAPPENING NOW</span>
        <span className="ledger-section-pip" />
      </div>
      <div className="ledger-list">
        {live.map(e => {
          const p = D.planFor(e, 0, uLat, uLng);
          return (
            <div key={e.id} className="ld-row ld-row-live">
              <button className="ld-badge" onClick={() => onPick(e.id)} aria-label={e.name}>
                <DGlyph name={e.glyph} size={22} />
              </button>
              <div className="ld-main">
                <div className="ld-name" onClick={() => onPick(e.id)}>{e.name}</div>
                {p && (
                  <div className="ld-windows">
                    <div className="ld-win">
                      <span className="ld-day">TODAY</span>
                      <span className="ld-time">{D.fmtHM(p.open)}–{D.fmtHM(p.close)}</span>
                      <span className="ld-dist">{p.dist.toFixed(1)}MI {D.compassDir(p.bearing)}</span>
                      <span className="ld-loc">{p.name}</span>
                      <span className="ld-livedot">● LIVE</span>
                    </div>
                  </div>
                )}
              </div>
              <button className="ld-star on" onClick={() => onWatch(e.id)} aria-label="unwatch">★</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ModeGroup({ label, items, day, t, userPos, onPick, onWatch }) {
  const D = window.DYNAMO;
  const DGlyph = window.DGlyph;
  const days = window.DAYS;
  const uLat = userPos?.lat, uLng = userPos?.lng;
  if (items.length === 0) return (
    <div className="ledger-section">
      <div className="ledger-section-head">
        <span className="ledger-section-label">{label}</span>
      </div>
      <div className="ld-group-empty">Nothing saved in {label.toLowerCase()} yet.</div>
    </div>
  );
  return (
    <div className="ledger-section">
      <div className="ledger-section-head">
        <span className="ledger-section-label">{label}</span>
        <span className="ledger-section-count">{items.length}</span>
      </div>
      <div className="ledger-list">
        {items.map(tr => {
          const next = D.upcomingWindows(tr, day, t, 3, uLat, uLng);
          return (
            <div key={tr.id} className="ld-row">
              <button className="ld-badge" onClick={() => onPick(tr.id)} aria-label={tr.name}>
                <DGlyph name={tr.glyph} size={22} />
              </button>
              <div className="ld-main">
                <div className="ld-name" onClick={() => onPick(tr.id)}>{tr.name}</div>
                {next.length === 0 ? (
                  <div className="ld-none">Not scheduled in the next 7 days</div>
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
    </div>
  );
}

function AlertsLedger({ open, watched, day, t, mode, userPos, onClose, onPick, onWatch }) {
  if (!open) return null;
  const { sheetRef, dragStyle, gripHandlers } = window.useSwipeDismiss(onClose);
  const { foodItems, eventItems } = resolveWatched(watched);
  const allItems = [...foodItems, ...eventItems];
  const totalCount = allItems.length;

  // current mode's group goes first
  const primaryLabel = mode === "events" ? "EVENTS" : "FOOD";
  const secondaryLabel = mode === "events" ? "FOOD" : "EVENTS";
  const primaryItems = mode === "events" ? eventItems : foodItems;
  const secondaryItems = mode === "events" ? foodItems : eventItems;

  return (
    <div className="ledger-scrim" onClick={onClose}>
      <div className="ledger" ref={sheetRef} style={dragStyle} onClick={(ev) => ev.stopPropagation()}>
        <div className="card-step" />
        <div className="ledger-drag-zone" {...gripHandlers}>
          <div className="card-grip" aria-hidden="true"><span className="grip-pill" /></div>
          <div className="ledger-head">
            <div>
              <div className="ledger-title">WATCHLIST</div>
              <div className="ledger-sub">SAVED ACROSS ALL MODES</div>
            </div>
            <button className="ledger-close" onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="close">✕</button>
          </div>
        </div>

        <div className="ledger-scroll">
          {totalCount === 0 ? (
            <div className="ledger-empty">
              <div className="ledger-empty-star">☆</div>
              <div className="ledger-empty-t">Nothing saved yet</div>
              <div className="ledger-empty-s">Tap any item on the dial, then ★ WATCH to track it here.</div>
            </div>
          ) : (
            <>
              <HappeningNow items={allItems} t={t} userPos={userPos} onPick={onPick} onWatch={onWatch} />
              <ModeGroup label={primaryLabel} items={primaryItems} day={day} t={t} userPos={userPos} onPick={onPick} onWatch={onWatch} />
              <ModeGroup label={secondaryLabel} items={secondaryItems} day={day} t={t} userPos={userPos} onPick={onPick} onWatch={onWatch} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

window.WatchTab = WatchTab;
window.AlertsLedger = AlertsLedger;
