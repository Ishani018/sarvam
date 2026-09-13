import { Mark } from "./Mark";
import { HeroDemo, heroDemoTakes } from "./HeroDemo";
import { diffValue, entityNoun, prettyValue } from "../entityDiff";
import { pickHeroExample } from "../conditionKind";
import { languageList } from "../lang";
import type { GintiData } from "../types";

/**
 * The title, two lines, the two numbers, and one failure you can hear.
 *
 * The order is what a stranger needs, not what is most interesting. Line one
 * says what this is, in a situation anyone recognises; line two says what was
 * found. Led with the other way round, "came back wrong" is the result of an
 * experiment the reader has not been told exists -- wrong from what, recorded
 * by whom, counted against what.
 *
 * Two columns where there is room: the argument in words on the left, the same
 * argument audible on the right. The right half used to be empty, which left
 * the strongest evidence on the page -- that the damage is hearable and the
 * number still changed -- below the fold behind a scroll.
 *
 * Every label below the first line has to survive a reader with no telecoms
 * vocabulary. No "packet loss", no "burst", no "condition" without the words to
 * cash them out sitting next to them.
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
  // Whether the right column has anything in it. A build with no bundled audio
  // is one column, not one column and a hole -- and in that build the failure
  // moves back into the left column, since nothing else is carrying it.
  const hasDemo = heroDemoTakes(data, example) !== null;

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
        <div className={`hero__grid ${hasDemo ? "hero__grid--split" : ""}`}>
          <div className="hero__lead">
            <h1 className="hero__title">
              <Mark className="hero__mark" size="1em" />
              <span>Ginti<span className="deva">गिनती</span></span>
            </h1>

            {/* Line one: what this is. It has to work with no prior knowledge,
                so it names a situation anyone recognises and no part of the
                method. An amount owed, deliberately: a bank's agent reads back
                the last four digits of an account, never the whole thing --
                saying it aloud is the security problem the masking exists to
                avoid. What an agent does say in full is money, dates and
                reference numbers. */}
            <p className="hero__line">
              When a voice agent tells you how much you owe, does it get the
              number right?
            </p>

            {/* Line two: the finding. Only now does it have something to land
                against; on its own it was a result with no experiment
                attached. */}
            {pair && (
              <p className="hero__finding">
                Ginti reads amounts, dates and reference numbers aloud in{" "}
                {languageList(data.headline.languages)}, puts the recording
                through a phone line and checks what comes back. On one kind of
                bad line <em>{say(lost)} of {say(total)}</em> came back wrong.
                On another that damaged the audio just as much, almost all of
                them survived.
              </p>
            )}

            {pair && <Verdict pair={pair} />}

            {/* The failure lives in the demo on the right when there is audio
                to play. Repeating it here would put the same two values on
                screen twice in one viewport. */}
            {!hasDemo && example && <HeroFailure ex={example} />}

          </div>

          {hasDemo && example && (
            <div className="hero__aside">
              <HeroDemo data={data} ex={example} />
            </div>
          )}
        </div>

        {/* Outside the grid, so it is the last thing in the hero on every
            width. Inside the left column it sat above the player on a phone,
            pointing down at a section that was not next. */}
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
