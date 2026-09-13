import { DisagreementChart } from "./Charts";
import type { GintiData } from "../types";

/**
 * The finding, in the first screen.
 *
 * Everything here is read from the data. The pair shown is data.lossPairs[0] --
 * the widest gap between two conditions that differ only in whether the same
 * nominal packet loss is scattered or clustered. A pooled total across ten
 * conditions would average that catastrophe with the conditions that lost
 * nothing, which is why it sits in the small print below and not in the figures.
 */
export function Hero({ data }: { data: GintiData }) {
  const h = data.headline;
  const pair = data.lossPairs[0];
  const pct = (v: number | null) => (v === null ? "—" : v.toFixed(3));
  const worst = data.lossPairs.length
    ? Math.min(...data.lossPairs.map((p) => p.bursty.hits / p.bursty.total))
    : null;

  return (
    <section className="hero" id="top">
      <div className="hero__grid">
        <div className="hero__lead">
          <h1 className="hero__title">
            Ginti<span className="deva">गिनती</span>
          </h1>

          <p className="hero__thesis">
            {pair ? (
              <>
                At {(pair.rate * 100).toFixed(0)}% packet loss, an account number
                survives or does not depending entirely on whether the loss is{" "}
                <em className="keeps">scattered</em> or arrives in{" "}
                <em className="loses">bursts</em>.
              </>
            ) : (
              <>
                An entity-level evaluation of Indic speech recognition under
                telephony-grade audio degradation.
              </>
            )}
          </p>

          {pair && (
            <div className="verdict">
              <div className="verdict__side verdict__side--keep">
                <span className="verdict__k">scattered loss</span>
                <span className="verdict__n">
                  {pair.scattered.accounts.hits}
                  <i>/</i>
                  {pair.scattered.accounts.total}
                </span>
                <span className="verdict__cond">{pair.scattered.condition}</span>
              </div>

              <span className="verdict__vs" aria-hidden="true">vs</span>

              <div className="verdict__side verdict__side--lose">
                <span className="verdict__k">bursty loss</span>
                <span className="verdict__n">
                  {pair.bursty.accounts.hits}
                  <i>/</i>
                  {pair.bursty.accounts.total}
                </span>
                <span className="verdict__cond">{pair.bursty.condition}</span>
              </div>
            </div>
          )}

          {pair && (
            <p className="hero__sub">
              Account numbers recovered. Same sentences, same voice, same codec,
              same {(pair.rate * 100).toFixed(0)}% of frames dropped &mdash; the
              only difference is that the bursty condition drops them in runs
              averaging {pair.meanBurstMs ?? 100}&nbsp;ms. Word error rate moves{" "}
              {pct(pair.scattered.wer)} to {pct(pair.bursty.wer)} and would not
              tell you this happened.
            </p>
          )}
        </div>

        <div className="hero__figure">
          <DisagreementChart
            matrix={data.matrix} wer={data.wer} conditions={data.conditions}
            compact caption={false}
          />
        </div>
      </div>

      <div className="hero__foot">
        <p className="hero__scope">
          {h.hits} of {h.entities} entities recovered overall across{" "}
          {h.conditions} conditions
          {worst !== null && <> &middot; worst condition {worst.toFixed(3)}</>}{" "}
          &middot; {h.utterances} synthetic {h.languages.join(", ")} utterances
          &middot; {h.models} models &middot; {h.modes.join(" and ")} mode
          &middot; a calibration run, not a benchmark
        </p>
        <a className="hero__cue" href="#problem">
          <span>Read on</span>
          <svg viewBox="0 0 16 22" width="12" height="17" aria-hidden="true">
            <path d="M8 0 v18 M2 12 l6 6 l6 -6" fill="none"
                  stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </a>
      </div>
    </section>
  );
}
