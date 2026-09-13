/**
 * The Ginti mark: five tally strokes, the fifth broken.
 *
 * Counting, and something lost out of the count. That is the project.
 *
 * Geometry, all in a 64-unit box:
 *   stroke weight 6.5, visual height 54.5 -- about 12% of height, which is
 *   1.6px when the mark is drawn at 16px, the smallest weight that survives
 *   rounding on a 1x display.
 *   five strokes on a 14.375 pitch, so the mark fills the box edge to edge and
 *   the four gaps are identical.
 *   the break in the fifth stroke is 20 units of centre-line, which the round
 *   caps close to 13.5 of visible gap -- 3.4px at 16px. It was 12 units first
 *   and vanished at favicon size.
 *
 * Colour comes from currentColor so CSS decides, with the broken stroke
 * optionally taking the accent. At 16px two colours muddy, so `duotone` is off
 * by default and the favicon uses the single-colour form.
 */
export function Mark({
  size = 24, duotone = false, className, title,
}: {
  size?: number | string;
  /** Draw the broken stroke in the rust accent. Legible from about 24px up. */
  duotone?: boolean;
  className?: string;
  /** Sets an accessible name; omit for a decorative mark beside a wordmark. */
  title?: string;
}) {
  const W = 6.5;
  const TOP = 8;
  const BOT = 56;
  const X = [3.25, 17.625, 32, 46.375, 60.75];
  // The break: centre-line ends, which the caps then close in by W/2 each side.
  const BREAK_TOP = 22;
  const BREAK_BOT = 42;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={W}
      strokeLinecap="round"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {X.slice(0, 4).map((x) => (
        <line key={x} x1={x} y1={TOP} x2={x} y2={BOT} />
      ))}
      <g stroke={duotone ? "var(--accent)" : undefined}>
        <line x1={X[4]} y1={TOP} x2={X[4]} y2={BREAK_TOP} />
        <line x1={X[4]} y1={BREAK_BOT} x2={X[4]} y2={BOT} />
      </g>
    </svg>
  );
}
