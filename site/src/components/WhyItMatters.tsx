import { Reveal } from "./Reveal";
import type { GintiData } from "../types";

/**
 * The next question after the hero, not the same one.
 *
 * The hero establishes the setting -- a phone call, a voice agent, an amount
 * that has to be right. A reader arriving here already has that, so this
 * section does not restate it. It answers why the failure is
 * hard to see: the line does more damage than it sounds like, the standard
 * metric averages it away, and nobody publishes the number that would show it.
 *
 * Unnumbered, and between the hero and section 01: orientation, not part of the
 * argument. Numbering it would imply a reader has to have read it to follow
 * what comes after.
 */
export function WhyItMatters({ data }: { data: GintiData }) {
  const h = data.headline;

  // The clean take that scored worst on word error rate while returning every
  // entity exactly right. It is the cleanest available demonstration that the
  // metric is not measuring the thing: nothing was lost, and the score is
  // still terrible, because the model spelled the digits out and the reference
  // wrote them as digits.
  const perfectButPenalised = data.listen
    .flatMap((u) => (u.conditions.find((c) => c.condition === "clean")?.results ?? []))
    .filter((r) => r.entities.length > 0 && r.entities.every((e) => e.hit))
    .sort((a, b) => b.wer - a.wer)[0] ?? null;

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
            <h3>The usual metric counts the wrong thing</h3>
            <p>
              Word error rate treats every word alike. A dropped postposition
              and a wrong digit cost the same. Worse, a model that hears the
              number perfectly but spells the digits out, where the reference
              wrote them as digits, is charged an error for every digit &mdash;
              so the score collapses while the answer is right.
            </p>
            {perfectButPenalised && (
              <p className="why__aside">
                The worst case on this page: a transcript that returned every
                value exactly right and still scored{" "}
                {perfectButPenalised.wer.toFixed(2)} on word error rate. Nothing
                about that number tells you the amount survived.
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
