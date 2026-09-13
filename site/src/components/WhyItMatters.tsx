import { Reveal } from "./Reveal";
import type { GintiData } from "../types";

/**
 * The next question after the hero, not the same one.
 *
 * The hero establishes the setting -- a phone call, a bank, an account number
 * read back. A reader arriving here already has that, so this section does not
 * restate what a voice agent is or what it reads. It answers why the failure is
 * hard to see: the line does more damage than it sounds like, the standard
 * metric averages it away, and nobody publishes the number that would show it.
 *
 * Unnumbered, and between the hero and section 01: orientation, not part of the
 * argument. Numbering it would imply a reader has to have read it to follow
 * what comes after.
 */
export function WhyItMatters({ data }: { data: GintiData }) {
  const h = data.headline;
  const pair = data.lossPairs[0];

  return (
    <section className="why" id="why">
      <div className="why__inner">
        <Reveal className="why__head">
          <h2>Why this is hard to see</h2>
          <p>
            A voice agent that mishears a word can be forgiven. One that
            mishears a digit cannot &mdash; and nothing in the standard toolkit
            tells the two apart.
          </p>
        </Reveal>

        <div className="why__grid why__grid--3">
          <Reveal as="section" className="why__item">
            <h3>The line takes more than it sounds like</h3>
            <p>
              Audio travels in packets of about twenty milliseconds, and on a
              weak connection some never arrive. Twenty milliseconds is roughly
              one Hindi syllable &mdash; which, in a number read aloud, is
              usually a whole digit. The hole does not blur the digit. It
              removes it.
            </p>
            <p className="why__aside">
              This run puts synthesised speech through{" "}
              {h.conditions} such conditions using ffmpeg &mdash; real
              downsampling, real G.711 and G.726, real dropped frames &mdash;
              not a simulation of one.
            </p>
          </Reveal>

          <Reveal as="section" className="why__item" delay={60}>
            <h3>The usual metric averages it away</h3>
            <p>
              Word error rate is a mean over every word in the sentence. The
              account number is one word among thirty, so losing it moves the
              average about as much as dropping a postposition does &mdash; and
              a mean cannot tell you which of the two it was.
            </p>
            {pair && (
              <p className="why__aside">
                Section 05 has the case: entity accuracy falls{" "}
                {(((pair.scattered.hits / pair.scattered.total)
                  - (pair.bursty.hits / pair.bursty.total)) * 100).toFixed(0)}{" "}
                points while word error rate moves{" "}
                {pair.scattered.wer?.toFixed(3) ?? "—"} to{" "}
                {pair.bursty.wer?.toFixed(3) ?? "—"}.
              </p>
            )}
          </Reveal>

          <Reveal as="section" className="why__item" delay={120}>
            <h3>So nobody has the number</h3>
            <p>
              Indic ASR is benchmarked on clean read speech and scored on that
              average. Neither half of that describes a collections call. The
              result is that anyone deploying or buying an Indian-language voice
              agent is choosing on a figure that cannot answer the only question
              that matters to them.
            </p>
            <p className="why__aside">
              Ginti is the harness that produces the missing number, and it is
              open: the conditions, the corpus and the scoring are all in the
              repository. It is not a leaderboard.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
