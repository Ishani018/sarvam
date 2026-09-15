import { HeroDemo, heroDemoTakes } from "./HeroDemo";
import { diffValue, entityNoun, prettyValue } from "../entityDiff";
import { pickHeroExample } from "../conditionKind";
import { languageList } from "../lang";
import { heldThrough, readable } from "../conditionLabel";
import type { GintiData } from "../types";

/**
 * The finding first, then what produced it, then what it was built on.
 *
 * A technical reader arriving cold gives this about two seconds. The order is
 * what survives that: the result, one sentence saying what was measured and
 * under what conditions, the API surface as credit rather than padding, and a
 * way into the numbers.
 *
 * The headline credits before it criticises, and it does so because that is
 * what the table says: bandwidth limits, both telephony codecs and scattered
 * packet loss cost nothing at all. Only clustering does. A headline reading
 * "telephony degrades accuracy" would be the more dramatic sentence and would
 * be falsified by the first five rows of our own results.
 *
 * Every number here is derived. The drop, the conditions it holds through, the
 * sample size, the interval and the chips all come out of the results, so a
 * rerun that moves them moves the hero with it.
 */

export function Hero({ data }: { data: GintiData }) {
  const pair = data.lossPairs[0];
  const example = pickHeroExample(data.listen, data.conditions, data.primaryMode);
  const hasDemo = heroDemoTakes(data, example) !== null;

  const f = data.finding;
  const u = data.usage;

  // What the recogniser came through without losing anything, in the words an
  // engineer uses for it, derived from the declared chains.
  const held = f ? heldThrough(data.conditions, f.held) : [];
  // The ASR family, from the model strings themselves: "saaras:v3" -> "Saaras".
  const family = u?.asr.models[0]?.split(":")[0] ?? "the recogniser";
  const familyName = family.charAt(0).toUpperCase() + family.slice(1);

  return (
    <section className="hero" id="top">
      <div className="hero__inner">
        <div className={`hero__grid ${hasDemo ? "hero__grid--split" : ""}`}>
          <div className="hero__lead">
            {/* The problem, not the finding. The panel to the right shows
                a real rupee amount changing on a degraded line, which lands
                harder in three seconds than any figure; the H1 is free to say
                why the project exists instead. Static on purpose -- it is true
                whether or not a run has happened, so it renders with no data
                and leaves no hole when the guard below does not fire. */}
            <h1 className="hero__head">
              Voice agents read out account numbers and amounts over phone
              lines. <em>Nobody measures whether the digits survive.</em>
            </h1>

            {/* What Ginti is, always -- and the finding folded in when there
                is a run to fold. Splitting it this way means a build with no
                results still says what the thing does rather than dropping to
                a headline and a row of chips. */}
            <p className="hero__sub">
              Ginti measures it &mdash; an open eval harness for account
              numbers, amounts, OTPs and dates under real telephony.
              {f && f.points !== null && held.length > 0 && (
                <> {familyName} holds through {readable(held)}; bursty loss
                  costs it {f.points.toFixed(1)} points.</>
              )}
            </p>

            {f && f.ci && (
              <p className="hero__stat">
                n&nbsp;=&nbsp;{f.nPerCondition} entity observations per
                condition, {data.headline.models} models, {data.headline.utterances}{" "}
                {languageList(data.headline.languages)} utterances. 95% CI on the
                drop [{f.ci[0].toFixed(1)}, {f.ci[1].toFixed(1)}].
              </p>
            )}

            {u && <BuiltOn data={data} />}

            <div className="hero__cta">
              <a className="btn btn--primary" href="#results">See the results</a>
              <a className="btn btn--quiet" href="#why">Why it goes unnoticed</a>
            </div>
          </div>

          {hasDemo && example && (
            <div className="hero__aside">
              <HeroDemo data={data} ex={example} />
            </div>
          )}
        </div>

        {pair && <Verdict pair={pair} />}

        {!hasDemo && example && <HeroFailure ex={example} />}
      </div>
    </section>
  );
}

/**
 * The Sarvam surface this runs on, as credit rather than a feature list.
 *
 * Every chip is read from the usage block, which is read from the run: the
 * model strings are the ones actually sent, the endpoints the ones actually
 * posted to, the mode the one the rows carry. Nothing here can name a model the
 * harness does not call.
 */
function BuiltOn({ data }: { data: GintiData }) {
  const u = data.usage!;
  const path = (endpoint: string | null) => {
    if (!endpoint) return null;
    try { return new URL(endpoint).pathname; } catch { return endpoint; }
  };
  const asrPath = path(u.asr.endpoint);
  const ttsPath = path(u.tts.endpoint);

  return (
    <div className="built">
      <span className="built__label">Built on</span>
      <ul className="built__chips">
        {u.asr.models.map((m) => (
          <li className="built__chip built__chip--model" key={m}>{m}</li>
        ))}
        {asrPath && <li className="built__chip" key={asrPath}>{asrPath}</li>}
        {u.asr.modes.map((m) => (
          <li className="built__chip" key={`mode-${m}`}>mode={m}</li>
        ))}
        {u.tts.model && <li className="built__chip built__chip--model">{u.tts.model}</li>}
        {ttsPath && <li className="built__chip">{ttsPath}</li>}
      </ul>
    </div>
  );
}

/**
 * The controlled comparison, stated rather than implied.
 *
 * Two numbers side by side only make an argument if a reader knows what is held
 * constant between them, and the words that say so plainly -- the same fraction
 * of the sound is missing in both -- are cheaper than the words that say it
 * correctly ("2% packet loss, Gilbert-Elliott"). The exact fraction, the burst
 * length and the condition names are all in Results, where a reader who wants
 * them has already been told what they mean.
 */
function Verdict({ pair }: { pair: GintiData["lossPairs"][number] }) {
  const pct = (pair.rate * 100).toFixed(0);
  const ms = pair.meanBurstMs ?? 100;

  return (
    <div className="verdict">
      <p className="verdict__lead">
        Both of these are the same recording with the same{" "}
        <b>{pct}% of its sound removed</b>. The only difference is where the
        holes fall &mdash; a few milliseconds missing here and there, or the
        same total taken out in runs of about {ms}&nbsp;ms.
      </p>

      <div className="verdict__pair">
        <div className="verdict__side verdict__side--keep">
          <span className="verdict__k">the missing sound, spread out</span>
          <span className="verdict__n">
            {pair.scattered.hits}<i>/</i>{pair.scattered.total}
          </span>
          <span className="verdict__sub">numbers came back right</span>
        </div>
        <div className="verdict__side verdict__side--lose">
          <span className="verdict__k">the same sound, in clumps</span>
          <span className="verdict__n">
            {pair.bursty.hits}<i>/</i>{pair.bursty.total}
          </span>
          <span className="verdict__sub">numbers came back right</span>
        </div>
      </div>
    </div>
  );
}

/**
 * One real failure, typeset rather than boxed.
 *
 * A panel with a coloured left edge on a near-identical ground reads as an
 * alert, which is the wrong register for the strongest evidence on the page.
 * The pair of values carries it alone; the sentence it came from, the gloss
 * and the transcripts are all in the playground, where a reader who wants them
 * can hear the audio at the same time.
 */
function HeroFailure({ ex }: { ex: NonNullable<ReturnType<typeof pickHeroExample>> }) {
  const said = prettyValue(ex.expected);
  const heard = prettyValue(ex.found);
  const parts = diffValue(said, heard);

  return (
    <figure className="failure">
      <figcaption className="failure__lead">
        One of the numbers that did not survive, as the recogniser returned it:
      </figcaption>
      <div className="failure__pair">
        <span className="failure__said">{said}</span>
        <span className="failure__arrow" aria-hidden="true">→</span>
        <span className="failure__heard">
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
      <p className="failure__note">
        {ex.sameShape
          ? `One ${entityNoun(ex.entityType)} from this run. Right length, right shape, still a valid value — nothing downstream can tell it is the wrong one.`
          : `One ${entityNoun(ex.entityType)} from this run. Silently truncated, and what is left is still all digits.`}
      </p>
    </figure>
  );
}
