// sheet.jsx — shared swipe-to-dismiss hook for bottom sheets.
// Exposes window.useSwipeDismiss.
//
// Usage:
//   const { sheetRef, dragStyle, gripHandlers } = window.useSwipeDismiss(onClose);
//   <div className="sheet" ref={sheetRef} style={dragStyle}>
//     <div className="sheet-grip" {...gripHandlers} />
//     ...content
//   </div>
//
// gripHandlers should go on the non-scrollable handle area only.
// All three pointer handlers (down/move/up) go on the same element;
// setPointerCapture keeps tracking the pointer wherever it moves.

function useSwipeDismiss(onClose) {
  const { useRef, useState, useCallback } = React;
  const sheetRef = useRef(null);
  const drag = useRef(null);
  const [dy, setDy] = useState(0);
  const [releasing, setReleasing] = useState(false);

  const onPointerDown = useCallback((e) => {
    // ignore right-click / multi-touch second pointers
    if (e.button !== 0 && e.pointerType === "mouse") return;
    drag.current = { startY: e.clientY, t0: Date.now() };
    e.currentTarget.setPointerCapture(e.pointerId);
    setReleasing(false);
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!drag.current) return;
    const d = Math.max(0, e.clientY - drag.current.startY);
    setDy(d);
  }, []);

  const onPointerUp = useCallback((e) => {
    if (!drag.current) return;
    const { startY, t0 } = drag.current;
    drag.current = null;
    const deltaY = Math.max(0, e.clientY - startY);
    const vel = deltaY / Math.max(1, Date.now() - t0); // px/ms
    const sheetH = sheetRef.current ? sheetRef.current.offsetHeight : 400;

    setReleasing(true);
    if (deltaY > sheetH / 3 || vel > 0.5) {
      // fly off screen then close
      setDy(sheetH + 80);
      setTimeout(() => { setDy(0); setReleasing(false); onClose(); }, 260);
    } else {
      // spring back
      setDy(0);
      setTimeout(() => setReleasing(false), 320);
    }
  }, [onClose]);

  // Only apply inline transform when actually dragging or springing back,
  // so the CSS dyn-rise open animation plays freely on first render.
  const dragStyle = (dy === 0 && !releasing) ? undefined : {
    transform: `translateY(${dy}px)`,
    transition: releasing ? "transform 0.28s cubic-bezier(.2,.9,.25,1)" : "none",
    willChange: "transform",
  };

  const gripHandlers = { onPointerDown, onPointerMove, onPointerUp };

  return { sheetRef, dragStyle, gripHandlers };
}

window.useSwipeDismiss = useSwipeDismiss;
