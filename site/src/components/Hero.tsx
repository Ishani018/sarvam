import { DisagreementChart } from "./Charts";
import { diffValue, entityNoun, prettyValue } from "../entityDiff";
import { pickHeroExample } from "../conditionKind";
import type { GintiData } from "../types";

/**
 * The finding, in the first screen, in the order a stranger needs it.
 *
 * Plain-language stake first, then the name, then the one sentence that makes
 * the comparison, then the numbers, then a real failure. The technical framing
 * -- packet loss, Gilbert bursts, codecs -- is deliberately last: a reader who
 * already knows those words loses nothing by meeting them a line later, and a
 * reader who does not is otherwise lost before the title.
 *
 * Every figure is read from the data, including the example: it is chosen from
 * the run, not pinned by id, so it cannot become a claim the data stops
 * supporting.
 */
export function Hero({ data }: { data: GintiData }) {
  const h = data.headline;
  const pair = data.lossPairs[0];
  const example = pickHeroExample(data.listen, data.conditions);

  return (
    <section className="hero" id="top">
      <p className="hero__kicker">
        Voice agents in India read account numbers, OTPs and payment amounts
        down phone lines that drop audio. This measures how often the number
        comes back wrong.
      </p>

      <div className="hero__grid">
        <div className="hero__lead">
          <h1 className="hero__title">
            Ginti<span className="deva">गिनती</span>
          </h1>

          {pair ? (
            <p className="hero__stake">
              Take the same recording and damage it two ways, losing exactly the
              same amount of audio. One way, every account number still comes
              back. The other way,{" "}
              <em>{pair.bursty.accounts.total - pair.bursty.accounts.hits} of{" "}
              {pair.bursty.accounts.total} come back wrong.</em>
            </p>
          ) : (
            <p className="hero__stake">
              An entity-level evaluation of Indic speech recognition under
              telephony-grade audio degradation.
            </p>
          )}

          {pair && (
            <div className="verdict">
              <div className="verdict__side verdict__side--keep">
                <span className="verdict__k">damage spread out</span>
                <span className="verdict__n">
                  {pair.scattered.accounts.hits}
                  <i>/</i>
                  {pair.scattered.accounts.total}
                </span>
                <span className="verdict__cond">{pair.scattered.condition}</span>
              </div>

              <span className="verdict__vs" aria-hidden="true">vs</span>

              <div className="verdict__side verdict__side--lose">
                <span className="verdict__k">damage in clumps</span>
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
            <p className="hero__tech">
              Account numbers recovered, both models. Technically: {" "}
              {(pair.rate * 100).toFixed(0)}% of 20&nbsp;ms packets dropped in
              both cases &mdash; independently on the left, in runs averaging{" "}
              {pair.meanBurstMs ?? 100}&nbsp;ms on the right. Word error rate
              moves {pair.scattered.wer?.toFixed(3) ?? "—"} to{" "}
              {pair.bursty.wer?.toFixed(3) ?? "—"} and would not tell you this
              happened.
            </p>
          )}
        </div>

        <div className="hero__figure">
          {example && <HeroFailure ex={example} />}
          <DisagreementChart
            matrix={data.matrix} wer={data.wer} conditions={data.conditions}
            compact caption={false}
          />
        </div>
      </div>

      <div className="hero__foot">
        <p className="hero__scope">
          {h.hits} of {h.entities} entities recovered overall across{" "}
          {h.conditions} conditions &middot; {h.utterances} synthetic{" "}
          {h.languages.join(", ")} utterances &middot; {h.models} models
          &middot; {h.modes.join(" and ")} mode &middot; a calibration run, not
          a benchmark
        </p>
        <a className="hero__cue" href="#why">
          <span>Why this matters</span>
          <svg viewBox="0 0 16 22" width="12" height="17" aria-hidden="true">
            <path d="M8 0 v18 M2 12 l6 6 l6 -6" fill="none"
                  stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </a>
      </div>
    </section>
  );
}

/**
 * One real failure, compact: the sentence with the number marked, and what came
 * back with the damaged characters in rust.
 */
function HeroFailure({ ex }: { ex: ReturnType<typeof pickHeroExample> }) {
  if (!ex) return null;
  const said = prettyValue(ex.expected);
  const heard = prettyValue(ex.found);
  const parts = diffValue(said, heard);
  const noun = entityNoun(ex.entityType);

  // Mark the entity inside the sentence by searching the rendered string: the
  // offsets in the data are into the Hindi, and the gloss is a different string
  // of a different length.
  const mark = (s: string) => {
    const at = ex.surface ? s.indexOf(ex.surface) : -1;
    if (at === -1) return s;
    return (
      <>
        {s.slice(0, at)}
        <mark className="ent">{ex.surface}</mark>
        {s.slice(at + ex.surface.length)}
      </>
    );
  };

  return (
    <figure className="failure">
      <figcaption className="failure__cap">
        One of them, from this run &mdash;{" "}
        <span className="failure__meta">{ex.condition} &middot; {ex.model}</span>
      </figcaption>

      <p className="failure__said deva">{mark(ex.text)}</p>
      {ex.gloss && <p className="failure__gloss">{mark(ex.gloss)}</p>}

      <div className="failure__rows">
        <div className="failure__row">
          <span className="failure__k">said</span>
          <span className="failure__v">{said}</span>
        </div>
        <div className="failure__row">
          <span className="failure__k">heard</span>
          <span className="failure__v">
            {parts.map((p, i) =>
              p.kind === "same"
                ? <span key={i}>{p.text}</span>
                : p.kind === "wrong"
                  ? <span key={i} className="failure__bad">{p.text}</span>
                  : <span key={i} className="failure__gone"
                          title={`${p.text} never arrived`}>
                      {"·".repeat(p.text.length)}
                    </span>,
            )}
          </span>
        </div>
      </div>

      <p className="failure__note">
        {ex.sameShape ? (
          <>
            Right length, right shape, still a perfectly valid {noun}. Nothing
            downstream can tell it is the wrong one.
          </>
        ) : (
          <>
            Silently truncated &mdash; and what is left is still all digits, so
            it still reads as a {noun} to anything that receives it.
          </>
        )}
      </p>
    </figure>
  );
}
