import type { ConditionDef, MatrixCell, WerRow } from "../types";

/* -------------------------------------------------------------------------
 * The disagreement chart
 * ---------------------------------------------------------------------- */

/**
 * Entity hit rate and word error rate over the same audio, on one pair of axes.
 *
 * This is the argument in one image: a flat line at the top and a flat line
 * across the middle, computed from identical recordings. Two series need two
 * colours, which is the only reason the second accent exists.
 *
 * Both series are plotted on 0..1 because both are rates. They are not
 * comparable in magnitude and the caption says so; what is legible is that one
 * does not move and the other sits nowhere near it.
 */
export function DisagreementChart({
  matrix, wer, conditions, compact = false,
}: {
  matrix: MatrixCell[];
  wer: WerRow[];
  conditions: ConditionDef[];
  compact?: boolean;
}) {
  // Split into two blocks at the one axis that matters: whether the loss is
  // clustered. Read left to right, the teal line holds through the first block
  // and drops at the boundary -- which is the finding, and is invisible in
  // config order where the two kinds of loss are interleaved.
  //
  // Within each block, conditions that drop no packets come first and the lossy
  // ones follow in rate order, so the whole loss ramp runs contiguously across
  // the boundary rather than being interrupted by the noisy line.
  const exercised = conditions.filter((c) => c.exercised);
  const lossOp = (c: ConditionDef) => c.chain.find((o) => o.op === "packet_loss");
  const isBursty = (c: ConditionDef) => lossOp(c)?.model === "gilbert";
  const byRate = (a: ConditionDef, b: ConditionDef) =>
    Number(lossOp(a)?.rate ?? 0) - Number(lossOp(b)?.rate ?? 0);
  const groups = [
    {
      label: "no loss, or loss scattered",
      items: exercised.filter((c) => !isBursty(c)).sort(byRate),
    },
    {
      label: "same loss, clustered into bursts",
      items: exercised.filter(isBursty).sort(byRate),
    },
  ].filter((g) => g.items.length);
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
  const padR = 26;
  const padT = 14;
  const padB = groupY + 18;
  const plotW = W - padL - padR;
  const plotH = compact ? 150 : 190;
  const H = padT + plotH + padB;

  const x = (i: number) =>
    padL + (names.length === 1 ? plotW / 2 : (i / (names.length - 1)) * plotW);
  const y = (v: number) => padT + (1 - v) * plotH;

  const path = (pts: Array<{ value: number | null }>) =>
    pts
      .map((p, i) => (p.value === null ? null : `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.value)}`))
      .filter(Boolean)
      .join(" ");

  return (
    <figure className="chart">
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
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line className="ch-grid" x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} />
            <text className="ch-label" x={padL - 7} y={y(g) + 3} textAnchor="end">
              {g.toFixed(2)}
            </text>
          </g>
        ))}
        <line className="ch-axis" x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} />

        <path className="ch-series-a" d={path(hitAt)} />
        {werByModel.map((m, mi) => (
          <path key={m.model} className="ch-series-b" d={path(m.points)}
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
                  x={x(names.length - 1) + 7} y={y(last.value) + 3}
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

        {/* Group rules, clear of the labels: the boundary between them is where
            clustering turns on, which is where the teal line drops. */}
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
      <figcaption className="result__scope">
        Conditions are split by whether packet loss is scattered or clustered,
        and ordered by loss rate within each half, so the loss ramp runs
        unbroken across the boundary. Entity accuracy holds through bandwidth
        loss, codecs and scattered packet loss, then falls where clustering
        begins. Word error rate does not track it, and separates by model rather
        than by condition.
      </figcaption>
    </figure>
  );
}

/* -------------------------------------------------------------------------
 * The condition ladder
 * ---------------------------------------------------------------------- */

/**
 * What each condition progressively takes away. Schematic, not a waveform: a
 * band of frequency, a quantisation grid, and gaps where frames were dropped.
 *
 * Derived from each condition's declared chain, so a new condition in the YAML
 * draws itself.
 */
export function ConditionLadder({ conditions }: { conditions: ConditionDef[] }) {
  const W = 420;
  const H = 22;

  const describe = (c: ConditionDef) => {
    const ops = c.chain.map((o) => String(o.op));
    const rate = c.chain.find((o) => o.op === "resample")?.rate as number | undefined;
    const loss = c.chain.find((o) => o.op === "packet_loss");
    return {
      band: rate === 8000 ? 0.5 : 1,      // 8 kHz keeps half the band
      quantised: ops.includes("codec"),
      lossRate: loss ? Number(loss.rate) : 0,
      noisy: ops.includes("noise"),
    };
  };

  return (
    <div className="ladder">
      {conditions.map((c) => {
        const d = describe(c);
        // Deterministic gap placement from the condition name, so the picture
        // is stable between builds and is obviously schematic.
        let seed = [...c.name].reduce((a, ch) => a + ch.charCodeAt(0), 0);
        const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        const bars = 60;
        return (
          <div className="ladder__row" key={c.name}>
            <span className={`ladder__name ${c.exercised ? "" : "ladder__name--off"}`}>
              {c.name}
            </span>
            <svg viewBox={`0 0 ${W} ${H}`} height={H} role="img"
                 aria-label={`${c.name}: ${c.description}`}>
              {Array.from({ length: bars }, (_, i) => {
                const dropped = d.lossRate > 0 && rnd() < d.lossRate * 3;
                const h = dropped ? 2 : H * d.band * (d.quantised ? 0.72 : 1);
                const fill = dropped
                  ? "var(--accent)"
                  : c.exercised ? "var(--ink-3)" : "var(--ink-4)";
                return (
                  <rect key={i} x={i * (W / bars)} width={W / bars - 1.5}
                        y={(H - h) / 2} height={Math.max(h, 2)}
                        fill={fill} opacity={d.noisy ? 0.75 : 1} />
                );
              })}
            </svg>
          </div>
        );
      })}
      <p className="result__scope" style={{ marginTop: "0.9rem" }}>
        Schematic. Bar height stands for retained bandwidth, shortened bars for
        codec quantisation, and rust marks frames the network dropped.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Waveform
 * ---------------------------------------------------------------------- */

/**
 * Peak envelope, precomputed at build time. Packet-loss gaps show up as bars
 * at zero, so the damage is visible as well as audible.
 */
export function Waveform({ peaks, label }: { peaks: number[] | null; label: string }) {
  if (!peaks?.length) return null;
  const W = 300;
  const H = 34;
  const bw = W / peaks.length;
  return (
    <svg className="wave" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
         role="img" aria-label={`Waveform of the ${label} audio`}>
      {peaks.map((p, i) => {
        const h = Math.max((p / 100) * H, 0.6);
        // A bucket at the floor is a hole in the audio, not quiet speech.
        const silent = p <= 1;
        return (
          <rect key={i} className={silent ? "gap" : undefined}
                x={i * bw} width={Math.max(bw - 0.4, 0.4)}
                y={(H - h) / 2} height={h} />
        );
      })}
    </svg>
  );
}
