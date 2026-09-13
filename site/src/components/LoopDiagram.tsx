import { useInView } from "./Reveal";

/**
 * The whole cycle, once, end to end.
 *
 * The old diagram showed six boxes in a row, which described what happens to
 * one recording and left a reader unable to picture the system. Three things
 * were missing and each one is load-bearing:
 *
 *   which steps are Sarvam's and which are ours -- the harness wraps around
 *   the API rather than replacing it, and a reader evaluating the API needs to
 *   see where its responsibility starts and stops;
 *
 *   that the gold value is fixed before any audio exists, which is what makes
 *   a miss attributable rather than a disagreement between two annotations;
 *
 *   that the loop runs once per condition per model, so the row of boxes is a
 *   single pass through something that repeats.
 *
 * Drawn as one SVG rather than divs so the return arrow and the gold rail can
 * cross the layout. Two treatments, not two colours for decoration: filled
 * teal is Sarvam's, outlined is ours.
 */
export function LoopDiagram({ conditions, models, sample }: {
  conditions: number; models: number;
  /** The first step's example value, from the run rather than typed here. */
  sample?: string | null;
}) {
  const { ref, inView } = useInView<HTMLElement>();

  // Subtitles are sized to the box: IBM Plex Mono advances 0.6em, so at 10px
  // eighteen characters is the most that fits inside the padding. Longer ones
  // do not wrap in SVG, they run across the next box.
  const STEPS = [
    { k: "ours", label: "sample a value", sub: `${sample ?? "a number"} first` },
    { k: "ours", label: "build a sentence", sub: "around that value" },
    { k: "sarvam", label: "synthesise", sub: "bulbul:v3, 24 kHz" },
    { k: "ours", label: "damage it", sub: "8 kHz, codec, loss" },
    { k: "sarvam", label: "transcribe", sub: "saaras:v3 \u00b7 v4" },
    { k: "ours", label: "extract the value", sub: "out of the words" },
    { k: "ours", label: "compare", sub: "exact match or not" },
  ] as const;

  const W = 1080;
  const BW = 138;          // box width
  const BH = 62;
  const GAP = (W - STEPS.length * BW) / (STEPS.length - 1);
  const TOP = 92;          // leaves room for the gold rail above
  const H = 250;
  const x = (i: number) => i * (BW + GAP);
  const mid = (i: number) => x(i) + BW / 2;

  // The gold rail runs from where the value is sampled to where it is compared.
  const railY = 44;
  const railFrom = mid(0);
  const railTo = mid(STEPS.length - 1);

  // The repeat bracket spans the steps that actually run once per condition
  // per model: damaging the audio through comparing it.
  const loopFrom = x(3);
  const loopTo = x(STEPS.length - 1) + BW;
  const loopY = TOP + BH + 34;

  return (
    <figure className={`loop ${inView ? "is-in" : ""}`} ref={ref as never}>
      <svg viewBox={`-4 0 ${W + 8} ${H}`} role="img"
           aria-label={
             `The cycle: a value is sampled and a sentence built around it, both ` +
             `ours; Sarvam's bulbul:v3 synthesises it; our ffmpeg pipeline damages ` +
             `it to telephony conditions; Sarvam's saaras models transcribe it; our ` +
             `extractor pulls the value back out and compares it to the one we ` +
             `started with. The gold value is fixed before any audio exists. The ` +
             `damage-to-compare stretch runs once per condition per model, ` +
             `${conditions} times ${models}.`
           }>
        {/* Gold rail: the value is known before audio exists and is what the
            last step compares against. */}
        <path className="loop__rail"
              d={`M ${railFrom} ${TOP} L ${railFrom} ${railY} L ${railTo} ${railY} L ${railTo} ${TOP}`} />
        <text className="loop__railtext" x={(railFrom + railTo) / 2} y={railY - 9}
              textAnchor="middle">
          the value is fixed here, before any audio exists
        </text>

        {STEPS.map((s, i) => (
          <g key={s.label} className={`loop__step loop__step--${s.k}`}
             style={{ transitionDelay: `${i * 70}ms` }}>
            <rect x={x(i)} y={TOP} width={BW} height={BH} rx="10" />
            <text className="loop__label" x={x(i) + 11} y={TOP + 26}>{s.label}</text>
            <text className="loop__sub" x={x(i) + 11} y={TOP + 44}>{s.sub}</text>
            {i < STEPS.length - 1 && (
              <path className="loop__arrow"
                    d={`M ${x(i) + BW + 3} ${TOP + BH / 2} L ${x(i + 1) - 4} ${TOP + BH / 2}`}
                    markerEnd="url(#loop-arrow)" />
            )}
          </g>
        ))}

        {/* The repeat: this stretch is not one pass. */}
        <path className="loop__bracket"
              d={`M ${loopFrom} ${loopY - 8} L ${loopFrom} ${loopY} L ${loopTo} ${loopY} L ${loopTo} ${loopY - 8}`} />
        <text className="loop__loops" x={(loopFrom + loopTo) / 2} y={loopY + 18}
              textAnchor="middle">
          repeated once per condition per model &mdash; {conditions} &times;{" "}
          {models} = {conditions * models} times for every sentence
        </text>

        <defs>
          <marker id="loop-arrow" viewBox="0 0 8 8" refX="7" refY="4"
                  markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 1 L7 4 L0 7 z" fill="var(--rule-strong)" />
          </marker>
        </defs>
      </svg>

      <div className="loop__key">
        <span><span className="loop__swatch loop__swatch--sarvam" /> Sarvam&rsquo;s API</span>
        <span><span className="loop__swatch loop__swatch--ours" /> the harness</span>
      </div>

      <figcaption className="figcap">
        The harness wraps the API rather than replacing it: it decides what is
        said, what the line does to it and whether the answer came back, and it
        asks Sarvam to speak and to listen. Because the value is chosen before
        the sentence exists, there is nothing to disagree with at the end &mdash;
        the number that went in is the number being looked for.
      </figcaption>
    </figure>
  );
}
