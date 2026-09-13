import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Reveal a block once, the first time it comes into view.
 *
 * Deliberately restrained: a short rise and fade, no stagger, no scale, no
 * direction-aware variants. It exists to give the page a sense of being
 * assembled as you read it, and anything more assertive would read as
 * decoration on a page whose whole argument is that it is not decorated.
 *
 * Respects prefers-reduced-motion by rendering revealed from the first frame,
 * and renders revealed if IntersectionObserver is missing, so content is never
 * gated on an effect running.
 */
export function Reveal({
  children, as: Tag = "div", className = "", delay = 0,
}: {
  children: ReactNode;
  as?: "div" | "section" | "li" | "figure";
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!el || still || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={`reveal ${shown ? "is-in" : ""} ${className}`.trim()}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}

/** Whether a node has been scrolled into view -- for charts that draw in. */
export function useInView<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!el || still || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, inView };
}
