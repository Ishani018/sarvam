import { Reveal } from "./Reveal";
import type { GintiData } from "../types";

/**
 * The two readings of the same audio, side by side rather than averaged.
 *
 * `transcribe` applies the recogniser's own number normalisation; `verbatim`
 * returns the words as spoken. Byte-identical audio, two answers, and the
 * difference between them is not noise -- it is the whole question of whether
 * a miss was misheard or renamed.
 *
 * Which is why nothing on this page pools them. Every per-cell aggregation
 * carries mode in its key, the tables switch between them, and the single
 * numbers elsewhere are all one mode's, named here.
 *
 * With one mode in the results this renders nothing: a comparison of one thing
 * is not a comparison.
 *
 * The figures are measured over the cells every mode covers, not each mode's
 * own run. Verbatim is normally run on a subset -- the bursty conditions
 * first, because that is where the misses are -- and pooling each mode over
 * whatever it happens to cover would compare a hard subset against an easy
 * average and call the difference a mode effect. Where the coverage differs,
 * the caption says so instead of leaving the reader to assume it does not.
 */
export function ModeCompare({ data }: { data: GintiData }) {
  const modes = data.modeCompare;
  if (modes.length < 2) return null;

  const best = Math.max(...modes.map((m) => m.hitRate ?? 0), 0.0001);
  const pct = (x: number | null) => (x === null ? "—" : x.toFixed(3));
  const shared = modes[0].coverage.sharedCells;
  const widest = Math.max(...modes.map((m) => m.coverage.conditions.length));
  const narrower = modes.filter((m) => m.coverage.conditions.length < widest);
  const primary = modes.find((m) => m.isPrimary);

  return (
    <Reveal className="modecmp">
      {modes.map((m) => (
        <div className={`modecmp__row ${m.isPrimary ? "is-primary" : ""}`}
             key={m.mode}>
          <div className="modecmp__head">
            <h3>{m.mode}</h3>
            <span>
              {m.isPrimary
                ? "the API default, and what every other figure here describes"
                : "the same audio, without the number normalisation"}
            </span>
          </div>
          <div className="modecmp__track">
            <span style={{ width: `${((m.hitRate ?? 0) / best) * 100}%` }} />
          </div>
          <dl className="modecmp__nums">
            <div><dt>entities recovered</dt>
              <dd>{m.hits}<i>/{m.entities}</i></dd></div>
            <div><dt>hit rate</dt><dd>{pct(m.hitRate)}</dd></div>
            <div><dt>word error rate</dt><dd>{pct(m.wer)}</dd></div>
          </dl>
        </div>
      ))}
      <p className="figcap">
        The same recordings, transcribed twice. Both rows are measured over the{" "}
        {shared} (sentence, condition, model) cells that every mode covers, so
        they are comparable to each other and not to the per-condition tables
        above. Where verbatim recovers a value transcribe lost, the miss was
        the normaliser renaming the number rather than the line destroying it;
        where neither recovers it, the audio did not carry it.
        {narrower.length > 0 && (
          <>{" "}
            {narrower.map((m) => `${m.mode} was run on ${m.coverage.conditions.length} `
              + `of the ${widest} conditions`).join("; ")} &mdash; the rest of this
            section is {primary?.mode ?? "the default mode"} across all of them.
          </>
        )}
      </p>
    </Reveal>
  );
}
