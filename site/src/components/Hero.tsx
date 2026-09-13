import { Mark } from "./Mark";
import { diffValue, entityNoun, prettyValue } from "../entityDiff";
import { pickHeroExample } from "../conditionKind";
import type { GintiData } from "../types";

/**
 * The title, two lines, and the two numbers, with space around them.
 *
 * The order is what a stranger needs, not what is most interesting. Line one
 * says what this is, in a situation anyone recognises; line two says what was
 * found. Led with the other way round, "came back wrong" is the result of an
 * experiment the reader has not been told exists -- wrong from what, recorded
 * by whom, counted against what.
 *
 * Everything else that used to live here -- the preamble, the packet mechanics,
 * the run metadata, the chart -- moved to where it is actually read: the
 * orientation section, Results, and the footer. A hero that needs studying is
 * not a hero.
 *
 * The dark ground is the one on the page. It gives a long document a spine and
 * makes the numbers the brightest thing a reader sees.
 */

/** Small numbers in words: a sentence meant to land in one glance should not
 *  open with a numeral. Only up to ninety-nine -- past that the words are
 *  longer than the thing they spell, and mixing the two in one phrase
 *  ("twenty-six of 114") reads worse than either. */
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

  // Every scored entity type, not account numbers alone. The question above is
  // about an amount, and the failure shown below is an amount; narrowing the
  // figures to account numbers would put a number on screen that does not
  // answer the sentence it sits under.
  const lost = pair ? pair.bursty.total - pair.bursty.hits : 0;
  const total = pair ? pair.bursty.total : 0;
  // Words only when both halves fit in words, or the phrase mixes the two.
  const pairInWords = lost <= 99 && total <= 99;
  const say = (n: number) => (pairInWords ? inWords(n) : String(n));

  return (
    <section className="hero" id="top">
      <div className="hero__inner">
        <h1 className="hero__title">
          <Mark className="hero__mark" size="1em" />
          <span>Ginti<span className="deva">गिनती</span></span>
        </h1>

        {/* Line one: what this is. It has to work with no prior knowledge, so
            it names a situation anyone recognises and no part of the method.
            An amount owed, deliberately: a bank's agent reads back the last
            four digits of an account, never the whole thing -- saying it aloud
            is the security problem the masking exists to avoid. What an agent
            does say in full is money, dates and reference numbers. */}
        <p className="hero__line">
          When a voice agent tells you how much you owe, does it get the number
          right?
        </p>

        {/* Line two: the finding. Only now does it have something to land
            against; on its own it was a result with no experiment attached. */}
        {pair && (
          <p className="hero__finding">
            <em>{say(lost)} of {say(total)}</em> numbers came back wrong &mdash;
            from audio that lost no more than audio where almost every number
            survived.
          </p>
        )}

        {pair && (
          <div className="verdict">
            <div className="verdict__side verdict__side--keep">
              <span className="verdict__k">damage spread out</span>
              <span className="verdict__n">
                {pair.scattered.hits}<i>/</i>{pair.scattered.total}
              </span>
            </div>
            <div className="verdict__side verdict__side--lose">
              <span className="verdict__k">damage in clumps</span>
              <span className="verdict__n">
                {pair.bursty.hits}<i>/</i>{pair.bursty.total}
              </span>
            </div>
          </div>
        )}

        {example && <HeroFailure ex={example} />}

        <a className="hero__cue" href="#why">
          <span>Why it goes unnoticed</span>
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
