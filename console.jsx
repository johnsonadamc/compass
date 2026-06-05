// console.jsx — DYNAMO control console: time throttle + craving selector keys.
// Exposes window.Console.
const { useRef: useRefC, useEffect: useEffectC } = React;

/* TIME THROTTLE — a streamlined horizontal regulator. Drag/fling the handle;
   momentum is handled by the parent. Hours 7A→10P with bold Deco ticks. */
function Throttle({ t, onScrub, onScrubEnd, dragRef, label }) {
  const D = window.DYNAMO;
  const trackRef = useRefC(null);
  const span = D.DAY_END - D.DAY_START;
  const frac = (t - D.DAY_START) / span;

  const setFromX = (clientX) => {
    const el = trackRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const f = D.clamp((clientX - r.left) / r.width, 0, 1);
    onScrub(D.DAY_START + f * span);
  };

  useEffectC(() => {
    const move = (e) => {
      if (!dragRef.current) return;
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      setFromX(x); e.preventDefault();
    };
    const up = () => { if (dragRef.current) { dragRef.current = false; onScrubEnd && onScrubEnd(); } };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
  }, []);

  const hours = [7,9,11,13,15,17,19,21];
  const time = D.fmtTime(t);

  return (
    <div className="throttle">
      <div className="throttle-head">
        <span className="throttle-eyebrow">{label || "SERVICE HOUR"}</span>
        <span className="throttle-clock">
          <span className="clk-hh">{time.hh}:{time.mm}</span>
          <span className="clk-ap">{time.ampm}</span>
        </span>
      </div>

      <div className="throttle-track" ref={trackRef}
        onMouseDown={(e) => { dragRef.current = true; setFromX(e.clientX); }}
        onTouchStart={(e) => { dragRef.current = true; setFromX(e.touches[0].clientX); }}>
        {/* fill + speed lines */}
        <div className="throttle-fill" style={{ width: `${frac*100}%` }}>
          <div className="speedlines" />
        </div>
        {/* hour ticks */}
        <div className="throttle-ticks">
          {hours.map((h) => (
            <div key={h} className="t-tick" style={{ left: `${((h-D.DAY_START)/span)*100}%` }}>
              <span className="t-tick-line" />
              <span className="t-tick-num">{D.fmtHourShort(h)}</span>
            </div>
          ))}
        </div>
        {/* handle */}
        <div className="throttle-handle" style={{ left: `${frac*100}%` }}>
          <span className="handle-blade" />
        </div>
      </div>
    </div>
  );
}

/* CRAVING SELECTOR — a row of enamel keys. Active key glows vermillion. */
function Selector({ value, onChange }) {
  const D = window.DYNAMO;
  const DGlyph = window.DGlyph;
  const keys = window.CRAVINGS;
  return (
    <div className="selector">
      <div className="selector-eyebrow">ROUTE&nbsp;POWER&nbsp;TO</div>
      <div className="selector-keys">
        {keys.map((k, i) => (
          <button key={k.id} className={"key" + (i === value ? " active" : "")}
            onClick={() => onChange(i)} aria-label={k.label}>
            <span className="key-ico"><DGlyph name={k.glyph} size={17} /></span>
            <span className="key-label">{k.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* DAY DIAL — row of day keys above the throttle. Pip shows when a watched
   truck is out & nearby that day. */
function DayDial({ day, onDay }) {
  const days = window.DAYS;
  return (
    <div className="daydial">
      <div className="daydial-eyebrow">PLAN&nbsp;THE&nbsp;DAY</div>
      <div className="daydial-keys">
        {days.map((dd) => (
          <button key={dd.idx} className={"daykey" + (dd.idx === day ? " active" : "")}
            onClick={() => onDay(dd.idx)} aria-label={dd.weekday}>
            <span className="daykey-wd">{dd.key}</span>
            <span className="daykey-date">{dd.date}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* CUISINE LENS — slim icon-only strip under the header. Tap a mark to isolate
   that cuisine; tap it again to clear. Default = ALL (craving 0). */
function LensStrip({ craving, onCraving, categories }) {
  const D = window.DYNAMO;
  const DGlyph = window.DGlyph;
  const keys = categories || window.CRAVINGS;
  const active = keys[D.clamp(craving, 0, keys.length-1)];
  return (
    <div className="lens">
      <span className="lens-label">FILTER</span>
      <div className="lens-chips">
        {keys.map((k, i) => i === 0 ? null : (
          <button key={k.id} className={"lens-chip" + (i === craving ? " active" : "")}
            onClick={() => onCraving(i === craving ? 0 : i)} aria-label={k.label}>
            <DGlyph name={k.glyph} size={15} />
          </button>
        ))}
      </div>
      <span className="lens-active">{craving === 0 ? "ALL" : active.label}</span>
    </div>
  );
}

function ConsolePanel(props) {
  return (
    <div className="console">
      <DayDial day={props.day} onDay={props.onDay} />
      <div className="console-rule" />
      <Throttle t={props.t} onScrub={props.onScrub} onScrubEnd={props.onScrubEnd} dragRef={props.dragRef} label={props.throttleLabel} />
    </div>
  );
}

window.Console = ConsolePanel;
window.LensStrip = LensStrip;
