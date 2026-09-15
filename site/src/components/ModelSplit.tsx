import { Reveal } from "./Reveal";
import type { GintiData } from "../types";

/** Key separator for the (condition, model) lookup. */
const SEP = "::";

/**
 * The two ASR models against each other, on byte-identical audio.
 *
 * Both models transcribe every file, so this comparison is free -- and nobody
 * outside the vendor has published it, which makes it the most interesting
 * number here to the people who shipped the newer model.
 *
 * Which is exactly why the interval is not optional. The direction is
 * consistent and the sample cannot carry a claim; printing the gap without
 * saying so would turn an observation into an assertion, and the first person
 * to recompute it would find the overlap. So the verdict sentence is derived
 * from whether the interval clears zero, not from the sign of the difference.
 */
export function ModelSplit({ data }: { data: GintiData }) {
  const ms = data.modelSplit;
  if (!ms || !ms.delta) return null;

  const [a, b] = ms.models;
  const pa = ms.bursty[a];
  const pb = ms.bursty[b];
  const cells = new Map(ms.cells.map((c) => [`${c.condition}${SEP}${c.model}`, c]));
  const conds = ms.burstyConditions;
  const pct = (x: number | null) => (x === null ? "—" : x.toFixed(3));
  const signed = (x: number) =>
    `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}`;

  // Every condition where the later model is at least as good, including the
  // ones where nothing moved: "never worse anywhere" is a weaker claim than
  // "better", and it is the one the data actually supports.
  const neverWorse = ms.cells.filter((c) => c.model === b).every((c) => {
    const other = cells.get(`${c.condition}${SEP}${a}`);
    return other ? (c.rate ?? 0) >= (other.rate ?? 0) : false;
  });

  return (
    <>
      <Reveal className="prose lede">
        <p>
          Both models see the same files, so the comparison costs nothing extra.
          Under bursty loss <b>{b}</b> recovers {pb.hits} of {pb.total} entities
          against <b>{a}</b>&rsquo;s {pa.hits} &mdash; {signed(ms.delta.points)}{" "}
          points.{" "}
          {ms.delta.separates
            ? "The interval clears zero, so this run does separate them."
            : `The interval does not clear zero: 95% CI [${signed(ms.delta.ci[0])}, ${signed(ms.delta.ci[1])}]. This run cannot tell them apart, and the honest reading is a direction rather than a result.`}
        </p>
      </Reveal>

      <Reveal className="msplit">
        <div className="msplit__rows">
          <div className="msplit__row msplit__row--head">
            <span>condition</span>
            <span>{a}</span>
            <span>{b}</span>
            <span>{b} &minus; {a}</span>
          </div>
          {conds.map((cond) => {
            const ca = cells.get(`${cond}${SEP}${a}`);
            const cb = cells.get(`${cond}${SEP}${b}`);
            if (!ca || !cb) return null;
            const d = ((cb.rate ?? 0) - (ca.rate ?? 0)) * 100;
            return (
              <div className="msplit__row" key={cond}>
                <span className="msplit__name">{cond}</span>
                <span className="msplit__v">
                  {pct(ca.rate)}<i>{ca.hits}/{ca.total}</i>
                </span>
                <span className="msplit__v">
                  {pct(cb.rate)}<i>{cb.hits}/{cb.total}</i>
                </span>
                <span className={`msplit__d ${d > 0 ? "is-up" : d < 0 ? "is-down" : ""}`}>
                  {d === 0 ? "—" : signed(d)}
                </span>
              </div>
            );
          })}
          <div className="msplit__row msplit__row--total">
            <span className="msplit__name">pooled</span>
            <span className="msplit__v">{pct(pa.rate)}<i>{pa.hits}/{pa.total}</i></span>
            <span className="msplit__v">{pct(pb.rate)}<i>{pb.hits}/{pb.total}</i></span>
            <span className={`msplit__d ${ms.delta.points > 0 ? "is-up" : ""}`}>
              {signed(ms.delta.points)}
            </span>
          </div>
        </div>
        <p className="figcap">
          Entity hit rate on identical audio, bursty conditions only &mdash;
          everywhere else both models sit at 1.000 and there is nothing to
          compare.{" "}
          {neverWorse && (
            <>Across every condition in the run {b} is never behind {a}, which
              is a consistent direction on a sample too small to call it a
              difference.{" "}</>
          )}
          Ranking two models on {pa.total} observations each is not what this is
          for; it is here because the comparison is the obvious next question
          and leaving it out would be the conspicuous omission.
        </p>
      </Reveal>
    </>
  );
}

/**
 * Bursty draws that produced no loss at all.
 *
 * A reader who finds this themselves concludes the pipeline is broken. Found
 * for them, with the count, it is the opposite: evidence the process is
 * genuinely stochastic, and a reason the headline number is a floor.
 */
export function DegenerateNote({ data }: { data: GintiData }) {
  const d = data.degenerateDraws.filter((x) => x.identical > 0);
  if (d.length === 0) return null;
  const total = d.reduce((a, x) => a + x.identical, 0);

  return (
    <Reveal className="note">
      <strong>{total} of the loss files carry no loss.</strong> A
      Gilbert&ndash;Elliott process at these rates sometimes draws no loss event
      across a six-second utterance, and when it does the output is
      byte-identical to the same chain without the loss step &mdash;{" "}
      {d.map((x) => `${x.identical}/${x.utterances} in ${x.condition}`).join(", ")}.
      Those files are still scored as loss conditions while carrying no damage,
      which can only pull the measured penalty toward zero. The drop above is a
      floor rather than an overstatement. Independent loss never degenerates
      this way: at these rates it drops something in every file.
    </Reveal>
  );
}
