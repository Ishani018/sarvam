import { Reveal } from "./Reveal";
import { languageList } from "../lang";
import type { GintiData } from "../types";

/**
 * Exactly which Sarvam APIs this runs on, and what it does not touch.
 *
 * Two endpoints of a platform that has many. Saying so is better than letting
 * a reader infer that a page called "an evaluation of Sarvam" covers more of
 * it than it does -- and the omissions are also the roadmap, so they are worth
 * naming either way.
 *
 * Counts come from the run. Seconds and cost are estimates and say so: the
 * result rows carry no per-file duration, so audio is derived from text length
 * at the same characters-per-second the harness plans with, and the rate card
 * is what the docs quote rather than an invoice.
 */

const NOT_USED = [
  ["Sarvam-M and the chat LLM", "no generation, no reasoning, no agent loop"],
  ["Voice Agents", "no turn-taking, no barge-in, no dialogue state"],
  ["Translation and transliteration", "one language in, the same language out"],
  ["Dubbing and speaker cloning", "one synthesised voice throughout"],
  ["Doc AI and parsing", "no documents anywhere in this"],
];

export function WhatWasUsed({ data }: { data: GintiData }) {
  const u = data.usage;
  if (!u) return null;

  const inr = (n: number) => `${n.toFixed(0)} INR`;
  const mins = (s: number) => `${(s / 60).toFixed(0)} min`;

  return (
    <>
      <Reveal className="used">
        <div className="used__row">
          <div className="used__head">
            <h3 className="used__name">{u.tts.model}</h3>
            <span className="used__role">text to speech</span>
          </div>
          <div className="used__body">
            <p>
              Makes the test material. {u.tts.calls}{" "}
              {languageList(data.headline.languages)} sentences synthesised
              once at {u.tts.sampleRate ? `${(u.tts.sampleRate / 1000).toFixed(0)} kHz` : "source rate"}{" "}
              with speaker <b>{u.tts.speaker}</b>, then degraded by the pipeline
              here rather than by the API.
            </p>
            <p className="used__aside">
              Not under test. The endpoint will synthesise at 8&nbsp;kHz
              directly, and that is deliberately unused: it would move the
              telephony damage out of the measured chain and into the
              synthesiser.
            </p>
          </div>
          <dl className="used__nums">
            <div><dt>calls</dt><dd>{u.tts.calls}</dd></div>
            <div><dt>characters</dt><dd>{u.tts.chars.toLocaleString("en-IN")}</dd></div>
          </dl>
        </div>

        <div className="used__row">
          <div className="used__head">
            <h3 className="used__name">{u.asr.models.join(" · ")}</h3>
            <span className="used__role">speech to text</span>
          </div>
          <div className="used__body">
            <p>
              The thing under test. Every degraded file transcribed by both
              models in <b>{u.asr.modes.join(" and ")}</b> mode, over identical
              audio, so the only variable between two rows is the model or the
              damage.
            </p>
            <p className="used__aside">
              {u.asr.audioFiles} distinct audio files &mdash; one per utterance
              per condition &mdash; each posted once per model.
            </p>
          </div>
          <dl className="used__nums">
            <div><dt>calls</dt><dd>{u.asr.calls}</dd></div>
            <div><dt>audio files</dt><dd>{u.asr.audioFiles}</dd></div>
          </dl>
        </div>

        <div className="used__row used__row--total">
          <div className="used__head">
            <h3 className="used__name">Total</h3>
            <span className="used__role">both endpoints</span>
          </div>
          <div className="used__body">
            <p className="used__aside">
              Audio duration is estimated from text length at{" "}
              {u.charsPerSecond} characters per second, the same figure the
              harness plans with, because the result rows carry no per-file
              duration. Cost applies the published rate card
              {u.rates.asrInrPerAudioSecond !== null && (
                <> &mdash; {u.rates.asrInrPerAudioSecond} INR per audio second,{" "}
                  {u.rates.ttsInrPer1kChars} INR per 1,000 characters</>
              )}{" "}
              and is an estimate, not an invoice.
            </p>
          </div>
          <dl className="used__nums">
            <div><dt>API calls</dt><dd>{u.tts.calls + u.asr.calls}</dd></div>
            <div><dt>audio, est.</dt><dd>{mins(u.estimatedAudioSeconds)}</dd></div>
            <div><dt>cost, est.</dt><dd>{inr(u.estimatedCostInr)}</dd></div>
          </dl>
        </div>
      </Reveal>

      <Reveal className="used__split">
        <section>
          <h3 className="subhead-plain">What this does not touch</h3>
          <dl className="used__list">
            {NOT_USED.map(([what, why]) => (
              <div key={what}><dt>{what}</dt><dd>{why}</dd></div>
            ))}
          </dl>
        </section>

        <section>
          <h3 className="subhead-plain">What a next pass would add</h3>
          <dl className="used__list">
            <div>
              <dt>verbatim mode</dt>
              <dd>
                returns the words as spoken, with no number normalisation, so a
                miss can be attributed to mishearing rather than to rendering.
                The harness carries mode as an axis; the run has not been made.
              </dd>
            </div>
            <div>
              <dt>keyterm prompting on {u.asr.models[u.asr.models.length - 1]}</dt>
              <dd>
                priming the recogniser with expected terms acts directly on the
                metric this page reports, and measuring with and without it is
                its own axis.
              </dd>
            </div>
            <div>
              <dt>more than one language and one voice</dt>
              <dd>
                every utterance here is one synthesised speaker in{" "}
                {languageList(data.headline.languages)}. Accent, speaker and
                the other languages are unmeasured.
              </dd>
            </div>
          </dl>
        </section>
      </Reveal>
    </>
  );
}
