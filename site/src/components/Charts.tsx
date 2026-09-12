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
  const names = conditions.filter((c) => c.exercised).map((c) => c.name);
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

  const W = 640;
  const H = compact ? 170 : 220;
  const padL = 34;
  const padR = 12;
  const padT = 14;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

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
             `Entity hit rate stays flat at ${(hitAt[0].value ?? 0).toFixed(2)} ` +
             `across ${names.length} telephony conditions. Word error rate is ` +
             `also flat across conditions but separates by model: ` +
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
          <text key={n} className="ch-label" x={x(i)} y={H - 12} textAnchor="middle">
            {n}
          </text>
        ))}
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
        Both are rates over the same recordings, and neither line is moved much
        by the phone line. The gap that does exist is between the two models,
        on byte-identical audio, and it comes from how each writes numbers
        rather than from what either heard.
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
