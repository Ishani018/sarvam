import { useEffect, useRef } from "react";

/**
 * A very faint moving ground behind the page.
 *
 * Three soft colour fields in the two existing accents, drifting slowly, with
 * their weighting nudged by scroll position so different parts of the page sit
 * in slightly different light. It is meant to register as depth, not as
 * decoration: at these opacities it is invisible if you look for it directly.
 *
 * It sits behind everything at z-index -1 and paints no text, so it cannot
 * affect contrast. Under prefers-reduced-motion it is not rendered at all --
 * not merely frozen -- since a static wash earns nothing.
 *
 * Scroll is written to a CSS custom property from a rAF-throttled listener
 * rather than driving React state: this repaints on every scroll frame and must
 * never re-render the tree.
 */
export function Ambient() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      const p = max > 0 ? Math.min(1, doc.scrollTop / max) : 0;
      el.style.setProperty("--p", p.toFixed(4));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const still = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (still) return null;

  return (
    <div className="amb" ref={ref} aria-hidden="true">
      <span className="amb__f amb__f--a" />
      <span className="amb__f amb__f--b" />
      <span className="amb__f amb__f--c" />
    </div>
  );
}
