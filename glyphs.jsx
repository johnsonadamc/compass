// glyphs.jsx — DYNAMO bold geometric cuisine marks (filled, flat, Deco).
// Exposes window.DGlyph. Built inline at render so JSX always commits.
//
// Two rendering modes coexist:
//   Flat-fill (24×24 viewBox, fill={color}, stroke="none") — original engine/entity marks
//   Line-art  (48×48 viewBox, fill="none", stroke="currentColor") — new category glyphs

// Line-art glyph bodies keyed by id. Rendered with stroke-width 2.4,
// round caps/joins, currentColor — inherits CSS variable theming automatically.
const LINE_ART = {
  tacos: (<>
    <path d="M13.5 22 q3.5 -7 7 0 q3.5 -7 7 0 q3.5 -7 7 0"/>
    <path d="M9 22 H39"/>
    <path d="M9 22 A15 12 0 0 0 39 22"/>
    <path d="M14 22 Q24 27.5 34 22"/>
  </>),
  burgers: (<>
    <path d="M10 22 A15 11 0 0 1 38 22"/>
    <path d="M18 17 l1.8 -1.1"/>
    <path d="M23.1 15 h1.8"/>
    <path d="M28.4 15.9 l1.8 1.1"/>
    <path d="M10 26 q3.5 -3 7 0 q3.5 3 7 0 q3.5 -3 7 0 q3.5 3 7 0"/>
    <path d="M12 30 H36"/>
    <path d="M11 33 A20 7 0 0 0 37 33"/>
  </>),
  asian: (<>
    <path d="M9 27 H39"/>
    <path d="M11 27 Q24 41 37 27"/>
    <path d="M21 38 H27"/>
    <path d="M31 7 L18 25"/>
    <path d="M36 10 L23 26"/>
  </>),
  seafood: (<>
    <path d="M13 24 C16 18 28 18 33 24 C28 30 16 30 13 24 Z"/>
    <path d="M33 24 L41 18 L41 30 Z"/>
    <path d="M21 19 Q24 24 21 29"/>
    <circle cx="18" cy="22.5" r="1.4" fill="currentColor" stroke="none"/>
  </>),
  sweets: (<>
    <path d="M17 27 L24 41 L31 27"/>
    <circle cx="24" cy="20" r="8"/>
    <path d="M20.5 31 l2.5 -2"/>
    <circle cx="24" cy="10.5" r="1.9" fill="currentColor" stroke="none"/>
    <path d="M24 10 q2.5 -3 4.5 -2.4"/>
  </>),
  coffee: (<>
    <path d="M13 22 H35"/>
    <path d="M15 22 L17 37 Q18 39 20 39 L28 39 Q30 39 31 37 L33 22"/>
    <path d="M33 25 C39 25 39 34 33 34"/>
    <path d="M11 41 H37"/>
    <path d="M20 18 q-2 -3 0 -6"/>
    <path d="M28 18 q2 -3 0 -6"/>
  </>),
  global: (<>
    <circle cx="24" cy="20" r="11"/>
    <path d="M13 20 H35"/>
    <path d="M24 9 A5 11 0 0 0 24 31 A5 11 0 0 0 24 9"/>
    <path d="M14.5 14.5 Q24 18 33.5 14.5"/>
    <path d="M14.5 25.5 Q24 22 33.5 25.5"/>
    <path d="M24 31 V35"/>
    <path d="M19 39 L21 35 H27 L29 39 Z"/>
  </>),
  music: (<>
    <rect x="19" y="8" width="10" height="16" rx="5"/>
    <path d="M21 12 H27"/>
    <path d="M21 15 H27"/>
    <path d="M21 18 H27"/>
    <path d="M24 24 V34"/>
    <path d="M16 37 Q24 33 32 37"/>
  </>),
  markets: (<>
    <path d="M12 16 H36"/>
    <path d="M11 24 q3 4 6 0 q3 4 6 0 q3 4 6 0 q3 4 6 0"/>
    <path d="M11 24 L12 16"/>
    <path d="M37 24 L36 16"/>
    <path d="M18 16 L17.5 23.5"/>
    <path d="M24 16 V23.5"/>
    <path d="M30 16 L30.5 23.5"/>
    <path d="M14 24 V40"/>
    <path d="M34 24 V40"/>
    <path d="M12 40 H36"/>
  </>),
  arts: (<>
    <path d="M9 20 L24 10 L39 20"/>
    <path d="M10 22 H38"/>
    <path d="M15 24 V39"/>
    <path d="M21 24 V39"/>
    <path d="M27 24 V39"/>
    <path d="M33 24 V39"/>
    <path d="M12 39 H36"/>
    <path d="M9 42 H39"/>
  </>),
  classes: (<>
    <path d="M24 12 L41 18 L24 24 L7 18 Z"/>
    <path d="M16 20.5 V25 Q16 29 24 29 Q32 29 32 25 V20.5"/>
    <path d="M24 18 L37 22 V31"/>
    <circle cx="37" cy="32.2" r="1.6" fill="currentColor" stroke="none"/>
  </>),
  comedy: (<>
    <circle cx="24" cy="23" r="14"/>
    <path d="M16 20 Q19.5 16 23 20"/>
    <path d="M25 20 Q28.5 16 32 20"/>
    <path d="M15 26 Q24 41 33 26 Z"/>
    <path d="M20.5 32 Q24 35 27.5 32"/>
  </>),
  nightlife: (<>
    <path d="M12 12 L36 12 L24 28 Z"/>
    <path d="M17 16.5 H31"/>
    <path d="M28 12 L24.5 18"/>
    <circle cx="24" cy="19.3" r="1.8" fill="currentColor" stroke="none"/>
    <path d="M24 28 V38"/>
    <path d="M17 38 H31"/>
  </>),
  kids: (<>
    <path d="M24 8 L34 22 L24 36 L14 22 Z"/>
    <path d="M24 8 V36"/>
    <path d="M14 22 H34"/>
    <path d="M24 36 q-3 2.5 -1 5 q2 2.5 -1 5"/>
    <path d="M21 41 L25 39.2"/>
    <path d="M20.4 45.4 L24.4 43.6"/>
  </>),
};

function DGlyph({ name, size = 22, color = "currentColor", style }) {
  // Line-art glyphs (48×48 viewBox, stroke-based, currentColor)
  if (name in LINE_ART) {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none"
        stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
        style={{ display: "block", ...style }} aria-hidden="true">
        {LINE_ART[name]}
      </svg>
    );
  }

  // Original flat-fill glyphs (24×24 viewBox) — engine/entity marks
  let inner;
  switch (name) {
    case "bao":
      inner = <path d="M3.6 13.2c0-4.5 3.7-7.6 8.4-7.6s8.4 3.1 8.4 7.6c0 2.5-3.8 4.2-8.4 4.2s-8.4-1.7-8.4-4.2z" />;
      break;
    case "leaf":
      inner = <path d="M5 19.4C5 11 11 5.3 19.4 5c.2 8.4-5.8 14.2-14.4 14.4z" />;
      break;
    case "gyro":
      inner = <path d="M4.8 8 19.2 8 12 20.4z" />;
      break;
    case "drum":
      inner = (<g><circle cx="9" cy="9.4" r="4.6" /><path d="M11 11.4 18.4 18.8 16 21.2 8.6 13.8z" /></g>);
      break;
    case "taco":
      inner = <path d="M3.4 13a8.6 6.4 0 0 1 17.2 0z" />;
      break;
    case "fish":
      inner = (<g><path d="M2.6 12c3.2-5.2 9.6-5.2 12.8 0-3.2 5.2-9.6 5.2-12.8 0z" /><path d="M14.4 12 20.6 8v8z" /></g>);
      break;
    case "cone":
      inner = (<g><path d="M7 11.4 17 11.4 12 21z" /><path d="M7.2 11.6a4.8 4.8 0 0 1 9.6 0z" /></g>);
      break;
    case "bean":
      inner = <ellipse cx="12" cy="12" rx="7.4" ry="8" />;
      break;
    case "flame":
      inner = <path d="M12 3c3.2 4.1 5.2 6.2 5.2 9.2a5.2 5.2 0 0 1-10.4 0c0-2 .9-3.2 2-4.2 0 2 1 3.1 2 3.1.5-3-1-5 1.2-8z" />;
      break;
    case "note":
      inner = (
        <g>
          <ellipse cx="7.5" cy="16" rx="3.5" ry="2.5" transform="rotate(-10 7.5 16)" />
          <rect x="10.5" y="5" width="1.8" height="11" />
          <path d="M10.5 5 18.5 3v4l-8 2z" />
        </g>
      );
      break;
    case "tent":
      inner = (
        <g>
          <path d="M2 14 12 4 22 14z" />
          <path d="M5 13.5v7h2.5v-7zM16.5 13.5v7H19v-7z" />
        </g>
      );
      break;
    case "book":
      inner = (
        <g>
          <path d="M3 5v14h8V5H3z" />
          <path d="M13 5v14h8V5h-8z" />
        </g>
      );
      break;
    case "mask":
      inner = <path d="M4 12a8 6.5 0 0 1 16 0 8 4 0 0 0-16 0z" />;
      break;
    case "balloon":
      inner = (
        <g>
          <circle cx="12" cy="10" r="7.5" />
          <path d="M10.5 17 12 21.5 13.5 17z" />
        </g>
      );
      break;
    case "star6":
      inner = (
        <g>
          <path d="M12 3 20.5 17.5H3.5z" />
          <path d="M12 21 3.5 6.5h17z" />
        </g>
      );
      break;
    default: // "all" — celestial star
      inner = <path d="M12 3 13.5 10.5 21 12 13.5 13.5 12 21 10.5 13.5 3 12 10.5 10.5z" />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none"
      style={{ display: "block", ...style }} aria-hidden="true">
      {inner}
    </svg>
  );
}
window.DGlyph = DGlyph;
