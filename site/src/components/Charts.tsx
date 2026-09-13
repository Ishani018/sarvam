import { useInView } from "./Reveal";
import type { ConditionDef, MatrixCell, WerRow } from "../types";

/* -------------------------------------------------------------------------
 * Shared condition ordering
 * ---------------------------------------------------------------------- */

const lossOp = (c: ConditionDef) => c.chain.find((o) => o.op === "packet_loss");
const isBursty = (c: ConditionDef) => lossOp(c)?.model === "gilbert";
const lossRate = (c: ConditionDef) => Number(lossOp(c)?.rate ?? 0);

/**
 * Split conditions at the one axis that matters -- whether the loss is
 * clustered -- and order by loss rate within each half.
 *
 * Read left to right, a series holds through the first block and moves at the
 * boundary, which is the finding. In config order the two kinds of loss are
 * interleaved and the boundary does not exist. Sorting by rate inside each half
 * keeps the whole loss ramp contiguous across it, rather than interrupted by
 * the noisy line.
 */
export function conditionGroups(conditions: ConditionDef[]) {
  const exercised = conditions.filter((c) => c.exercised);
  const byRate = (a: ConditionDef, b: ConditionDef) => lossRate(a) - lossRate(b);
  return [
    {
      label: "no loss, or loss scattered",
      short: "scattered",
      items: exercised.filter((c) => !isBursty(c)).sort(byRate),
    },
    {
      label: "same loss, clustered into bursts",
      short: "bursty",
      items: exercised.filter(isBursty).sort(byRate),
    },
  ].filter((g) => g.items.length);
}

/* -------------------------------------------------------------------------
 * The disagreement chart
 * ---------------------------------------------------------------------- */

/**
 * Entity hit rate and word error rate over the same audio, on one pair of axes.
 *
 * This is the argument in one image: one series that holds and then falls where
 * clustering begins, and another that does not move at all and separates by
 * model instead. Two series need two colours, which is why the second accent
 * exists.
 *
 * Both are plotted on 0..1 because both are rates. They are not comparable in
 * magnitude and the caption says so; what is legible is that one tracks the
 * damage and the other does not.
 */
export function DisagreementChart({
  matrix, wer, conditions, compact = false, caption = true,
}: {
  matrix: MatrixCell[];
  wer: WerRow[];
  conditions: ConditionDef[];
  compact?: boolean;
  caption?: boolean;
}) {
  const { ref, inView } = useInView<HTMLElement>();

  const groups = conditionGroups(conditions);
  const ordered = groups.flatMap((g) => g.items);
  const names = ordered.map((c) => c.name);
  if (names.length === 0) return null;

  const hitAt = names.map((n) => {
    const cells = matrix.filter((m) => m.condition === n);
    const hits = cells.reduce((a, c) => a + c.hits, 0);
    const total = cells.reduce((a, c) => a + c.total, 0);
    return { name: n, value: total ? hits / total : null, hits, total };
  });
  // One WER line per model rather than a pooled average: pooling hides that
  // the two models sit a quarter apart on identical audio, which is the larger
  // effect by an order of magnitude.
  const models = [...new Set(wer.map((w) => w.model))].sort();
  const werByModel = models.map((m) => ({
    model: m,
    points: names.map((n) => ({
      name: n,
      value: wer.find((w) => w.model === m && w.condition === n)?.wer ?? null,
    })),
  }));

  // Condition names are long, monospaced and there are ten of them, so the
  // labels lean. How far they then reach below the axis depends on the longest
  // one, and the group rule has to clear that -- measured rather than guessed,
  // or a new condition with a longer name silently draws over it.
  const LABEL_DEG = 38;
  const labelDrop =
    Math.max(...names.map((n) => n.length)) * 6 *
    Math.sin((LABEL_DEG * Math.PI) / 180);
  const groupY = labelDrop + 20;   // below the axis
  const W = 640;
  const padL = 34;
  const padR = 30;
  const padT = 16;
  const padB = groupY + 18;
  const plotW = W - padL - padR;
  const plotH = compact ? 158 : 196;
  const H = padT + plotH + padB;

  const x = (i: number) =>
    padL + (names.length === 1 ? plotW / 2 : (i / (names.length - 1)) * plotW);
  const y = (v: number) => padT + (1 - v) * plotH;

  const path = (pts: Array<{ value: number | null }>) =>
    pts
      .map((p, i) => (p.value === null ? null : `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.value)}`))
      .filter(Boolean)
      .join(" ");

  // The boundary between the two blocks, drawn as a full-height divider: it is
  // where the teal line drops, and a reader should see the two regions before
  // reading a single label.
  const boundary = groups.length > 1
    ? (x(groups[0].items.length - 1) + x(groups[0].items.length)) / 2
    : null;

  return (
    <figure className={`chart ${inView ? "is-drawn" : ""}`} ref={ref as never}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={
             `Entity hit rate across ${names.length} telephony conditions, ` +
             `ordered with scattered loss first and bursty loss last. It holds ` +
             `near ${(hitAt[0].value ?? 0).toFixed(2)} through the scattered ` +
             `conditions and falls to ` +
             `${Math.min(...hitAt.map((p) => p.value ?? 1)).toFixed(2)} under ` +
             `bursty loss. Word error rate stays flat across the whole range ` +
             `and separates by model instead: ` +
             werByModel.map((m) =>
               `${m.model} near ${(m.points[0].value ?? 0).toFixed(2)}`).join(", ") +
             `, on the same audio.`
           }>
        {/* The bursty half sits on a faint wash, so the two regimes read as
            regions rather than as ten interchangeable ticks. */}
        {boundary !== null && (
          <rect className="ch-region" x={boundary} y={padT}
                width={W - padR - boundary + 6} height={plotH} />
        )}

        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line className="ch-grid" x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} />
            <text className="ch-label" x={padL - 8} y={y(g) + 3} textAnchor="end">
              {g.toFixed(2)}
            </text>
          </g>
        ))}
        <line className="ch-axis" x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} />

        {boundary !== null && (
          <line className="ch-boundary" x1={boundary} x2={boundary}
                y1={padT} y2={y(0)} />
        )}

        <path className="ch-series-a" d={path(hitAt)} pathLength={1} />
        {werByModel.map((m, mi) => (
          <path key={m.model} className="ch-series-b" d={path(m.points)}
                pathLength={1}
                strokeDasharray={mi === 0 ? undefined : "5 3"} />
        ))}

        {hitAt.map((p, i) => p.value === null ? null : (
          <circle key={`a${i}`} className="ch-dot-a" cx={x(i)} cy={y(p.value)} r="3.5" />
        ))}
        {werByModel.flatMap((m, mi) => m.points.map((p, i) => p.value === null ? null : (
          <circle key={`b${mi}-${i}`} className="ch-dot-b"
                  cx={x(i)} cy={y(p.value)} r="3.5" />
        )))}

        {werByModel.map((m) => {
          const last = m.points[m.points.length - 1];
          return last.value === null ? null : (
            <text key={`l${m.model}`} className="ch-value"
                  x={x(names.length - 1) + 8} y={y(last.value) + 3}
                  fill="var(--accent)">{m.model.replace("saaras:", "")}</text>
          );
        })}

        {names.map((n, i) => (
          <text key={n} className="ch-label" x={x(i)} y={y(0) + 8}
                textAnchor="end"
                transform={`rotate(-${LABEL_DEG} ${x(i)} ${y(0) + 8})`}>
            {n}
          </text>
        ))}

        {/* Group rules, clear of the labels. */}
        {groups.length > 1 && (() => {
          let at = 0;
          return groups.map((g) => {
            const from = at;
            const to = at + g.items.length - 1;
            at += g.items.length;
            const x1 = x(from) - 6;
            const x2 = x(to) + 6;
            return (
              <g key={g.label}>
                <line className="ch-group" x1={x1} x2={x2}
                      y1={y(0) + groupY} y2={y(0) + groupY} />
                <text className="ch-group-label" x={(x1 + x2) / 2}
                      y={y(0) + groupY + 13} textAnchor="middle">{g.label}</text>
              </g>
            );
          });
        })()}
      </svg>

      <div className="chart__legend">
        <span>
          <span className="chart__swatch chart__swatch--a" />
          entity hit rate, pooled over models
        </span>
        <span>
          <span className="chart__swatch chart__swatch--b" />
          word error rate, one line per model
        </span>
      </div>

      {caption && (
        <figcaption className="figcap">
          Conditions are split by whether packet loss is scattered or clustered,
          and ordered by loss rate within each half, so the loss ramp runs
          unbroken across the boundary. Entity accuracy holds through bandwidth
          loss, codecs and scattered packet loss, then falls where clustering
          begins. Word error rate does not track it, and separates by model
          rather than by condition.
        </figcaption>
      )}
    </figure>
  );
}

/* -------------------------------------------------------------------------
 * The contrast, as a statement
 * ---------------------------------------------------------------------- */

/**
 * Two bars on the same 0..1 scale: how wrong the transcript is, against how
 * often the number in it is right.
 *
 * The point of the framing is that these are the same recordings. A reader who
 * only ever sees the first number concludes the system is unusable; a reader
 * who only ever sees the second concludes it is solved. Both are drawn from
 * data.headline, so neither can drift.
 */
export function ContrastBars({
  werByModel, hitRate,
}: {
  werByModel: Array<{ model: string; wer: number; n: number }>;
  hitRate: number | null;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  if (hitRate === null || werByModel.length === 0) return null;

  const rows = [
    ...werByModel.map((m) => ({
      key: m.model,
      label: "word error rate",
      note: m.model,
      value: Math.min(m.wer, 1),
      raw: m.wer,
      kind: "bad" as const,
    })),
    {
      key: "entity",
      label: "entity hit rate",
      note: "pooled over both models",
      value: hitRate,
      raw: hitRate,
      kind: "good" as const,
    },
  ];

  return (
    <div className={`contrast ${inView ? "is-in" : ""}`} ref={ref}>
      {rows.map((r) => (
        <div className={`contrast__row contrast__row--${r.kind}`} key={r.key}>
          <div className="contrast__meta">
            <span className="contrast__label">{r.label}</span>
            <span className="contrast__note">{r.note}</span>
          </div>
          <div className="contrast__track">
            <span className="contrast__fill"
                  style={{ transform: `scaleX(${r.value})` }} />
          </div>
          <span className="contrast__val">{r.raw.toFixed(3)}</span>
        </div>
      ))}
      <p className="figcap">
        The same recordings, scored two ways. Nearly every word is wrong and
        nearly every number is right, which is why word error rate is the wrong
        instrument for anything that has to read a number back to a customer.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * The condition ladder
 * ---------------------------------------------------------------------- */

/**
 * What each condition takes away, and what it costs.
 *
 * One row per condition: what the chain does, a schematic of the surviving
 * signal, and the measured entity hit rate for that condition. Everything is
 * derived from the declared chain and the result matrix, so a new condition in
 * the YAML draws its own row.
 */
export function ConditionLadder({
  conditions, matrix,
}: { conditions: ConditionDef[]; matrix: MatrixCell[] }) {
  const W = 360;
  const H = 26;

  const describe = (c: ConditionDef) => {
    const ops = c.chain.map((o) => String(o.op));
    const rate = c.chain.find((o) => o.op === "resample")?.rate as number | undefined;
    const loss = lossOp(c);
    return {
      band: rate === 8000 ? 0.5 : 1,      // 8 kHz keeps half the band
      quantised: ops.includes("codec"),
      lossRate: loss ? Number(loss.rate) : 0,
      bursty: isBursty(c),
      burstMs: loss ? Number(loss.mean_burst_ms ?? 0) : 0,
      noisy: ops.includes("noise"),
    };
  };

  const hitFor = (name: string) => {
    const cells = matrix.filter((m) => m.condition === name);
    const hits = cells.reduce((a, c) => a + c.hits, 0);
    const total = cells.reduce((a, c) => a + c.total, 0);
    return total ? { rate: hits / total, hits, total } : null;
  };

  const groups = conditionGroups(conditions);
  const unrun = conditions.filter((c) => !c.exercised);

  const row = (c: ConditionDef) => {
    const d = describe(c);
    const hit = hitFor(c.name);
    // Deterministic gap placement from the condition name, so the picture is
    // stable between builds and is obviously schematic.
    let seed = [...c.name].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const bars = 72;
    // A bursty condition drops the same fraction of bars as its scattered twin,
    // but in runs. The count is placed rather than sampled: at 72 bars a
    // Bernoulli draw lands anywhere from half to double the nominal rate, and
    // two rows that should differ only in clustering would differ in how much
    // was dropped -- which is exactly the comparison the picture exists to make.
    const runLen = d.bursty ? Math.max(2, Math.round(d.burstMs / 20)) : 1;
    // Exaggerated over the true rate so a 5% condition is legible at all; the
    // caption says the drawing is schematic.
    const wanted = Math.round(bars * Math.min(d.lossRate * 2.4, 0.6));
    const drops = new Array<boolean>(bars).fill(false);
    let placed = 0;
    for (let guard = 0; placed < wanted && guard < bars * 8; guard++) {
      const at = Math.floor(rnd() * (bars - runLen + 1));
      for (let k = 0; k < runLen && placed < wanted; k++) {
        if (!drops[at + k]) { drops[at + k] = true; placed++; }
      }
    }

    return (
      <li className="lad__row" key={c.name}>
        <div className="lad__id">
          <span className="lad__name">{c.name}</span>
          <span className="lad__desc">{c.description}</span>
        </div>

        <svg className="lad__viz" viewBox={`0 0 ${W} ${H}`} role="img"
             aria-label={`${c.name}: ${c.description}`}>
          {Array.from({ length: bars }, (_, i) => {
            const dropped = drops[i];
            const h = dropped ? 2 : H * d.band * (d.quantised ? 0.7 : 1);
            return (
              <rect key={i} x={i * (W / bars)} width={W / bars - 1.6}
                    rx={Math.min((W / bars - 1.6) / 2, 1.4)}
                    y={(H - h) / 2} height={Math.max(h, 2)}
                    className={dropped ? "lad__drop" : "lad__keep"}
                    opacity={d.noisy && !dropped ? 0.72 : 1} />
            );
          })}
        </svg>

        <div className="lad__score">
          {hit ? (
            <>
              <span className={`lad__rate ${hit.rate < 1 ? "is-down" : ""}`}>
                {hit.rate.toFixed(3)}
              </span>
              <span className="lad__n">{hit.hits}/{hit.total}</span>
            </>
          ) : (
            <span className="lad__unrun">not run</span>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="lad">
      {groups.map((g) => (
        <section className="lad__group" key={g.label}>
          <h3 className="lad__grouphead">
            <span>{g.label}</span>
            <span className="lad__groupn">{g.items.length}</span>
          </h3>
          <ul className="lad__list">{g.items.map(row)}</ul>
        </section>
      ))}

      {unrun.length > 0 && (
        <section className="lad__group lad__group--off">
          <h3 className="lad__grouphead">
            <span>declared, not yet measured</span>
            <span className="lad__groupn">{unrun.length}</span>
          </h3>
          <ul className="lad__list">{unrun.map(row)}</ul>
        </section>
      )}

      <p className="figcap">
        Schematic, not a waveform. Bar height stands for retained bandwidth,
        shortened bars for codec quantisation, and rust for frames the network
        dropped &mdash; scattered singly in the first group, in runs in the
        second. The rate on the right is measured.
      </p>
    </div>
  );
}
