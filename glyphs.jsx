// glyphs.jsx — DYNAMO bold geometric cuisine marks (filled, flat, Deco).
// Exposes window.DGlyph. Built inline at render so JSX always commits.

function DGlyph({ name, size = 22, color = "currentColor", style }) {
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
