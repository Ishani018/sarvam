import { Mark } from "./Mark";
import { diffValue, entityNoun, prettyValue } from "../entityDiff";
import { pickHeroExample } from "../conditionKind";
import type { GintiData } from "../types";

/**
 * Three things, and space around them.
 *
 * The title, one sentence, and the two numbers. Everything that used to live
 * here -- the preamble, the packet mechanics, the run metadata, the chart --
 * moved to where it is actually read: the orientation section, Results, and
 * the footer. A hero that needs studying is not a hero.
 *
 * The dark ground is the one on the page. It gives a long document a spine and
 * makes the numbers the brightest thing a reader sees.
 */

/** Small numbers in words: a sentence meant to land in one glance should not
 *  open with a numeral. Above the range this covers, digits are fine. */
const WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
  "eighty", "ninety"];

function inWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n < 20) return WORDS[n];
  const t = TENS[Math.floor(n / 10)];
  return n % 10 ? `${t}-${WORDS[n % 10]}` : t;
}

export function Hero({ data }: { data: GintiData }) {
  const pair = data.lossPairs[0];
  const example = pickHeroExample(data.listen, data.conditions);
  const lost = pair ? pair.bursty.accounts.total - pair.bursty.accounts.hits : 0;

  return (
    <section className="hero" id="top">
      <div className="hero__inner">
        <h1 className="hero__title">
          <Mark className="hero__mark" size="1em" />
          <span>Ginti<span className="deva">गिनती</span></span>
        </h1>

        <p className="hero__line">
          {pair ? (
            <>
              <em>{inWords(lost)} of {inWords(pair.bursty.accounts.total)}</em>{" "}
              account numbers came back wrong &mdash; from a recording that lost
              no more audio than one where every single number survived.
            </>
          ) : (
            <>
              Whether the number survives the phone line. An entity-level
              evaluation of Indic speech recognition.
            </>
          )}
        </p>

        {pair && (
          <div className="verdict">
            <div className="verdict__side verdict__side--keep">
              <span className="verdict__k">damage spread out</span>
              <span className="verdict__n">
                {pair.scattered.accounts.hits}<i>/</i>{pair.scattered.accounts.total}
              </span>
            </div>
            <div className="verdict__side verdict__side--lose">
              <span className="verdict__k">damage in clumps</span>
              <span className="verdict__n">
                {pair.bursty.accounts.hits}<i>/</i>{pair.bursty.accounts.total}
              </span>
            </div>
          </div>
        )}

        {example && <HeroFailure ex={example} />}

        <a className="hero__cue" href="#why">
          <span>Why this matters</span>
          <svg viewBox="0 0 16 22" width="11" height="15" aria-hidden="true">
            <path d="M8 0 v18 M2 12 l6 6 l6 -6" fill="none"
                  stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                  strokeLinejoin="round" />
          </svg>
        </a>
      </div>
    </section>
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
      <figcaption className="failure__note">
        {ex.sameShape
          ? `One ${entityNoun(ex.entityType)} from this run. Right length, right shape, still a valid value — nothing downstream can tell it is the wrong one.`
          : `One ${entityNoun(ex.entityType)} from this run. Silently truncated, and what is left is still all digits.`}
      </figcaption>
    </figure>
  );
}
