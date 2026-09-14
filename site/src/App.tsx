import { Gate } from "./Gate";
import { Header, type SectionDef } from "./components/Header";
import { Hero } from "./components/Hero";
import { ResultsMatrix } from "./components/ResultsMatrix";
import { RenderingTable } from "./components/RenderingTable";
import { Playground } from "./components/Playground";
import { Conditions, ScoredTypes } from "./components/Explainers";
import { LoopDiagram } from "./components/LoopDiagram";
import { pickHeroExample } from "./conditionKind";
import { prettyValue } from "./entityDiff";
import { WhatWasUsed } from "./components/WhatWasUsed";
import { CueSurvival } from "./components/CueSurvival";
import { ConditionLadder, ContrastBars, DisagreementChart } from "./components/Charts";
import { Detail, Section, Subhead } from "./components/Shell";
import { Reveal } from "./components/Reveal";
import { Ambient } from "./components/Ambient";
import { WhyItMatters } from "./components/WhyItMatters";
import { Markdown } from "./components/Markdown";
import { Mark } from "./components/Mark";
import { MethodTable } from "./components/MethodTable";
import { languageList } from "./lang";
import raw from "./generated/data.json";
import type { GintiData } from "./types";

const data = raw as unknown as GintiData;

/**
 * Plain-language notes per condition. Keyed by name: a condition with no note
 * renders without one, and a new condition in the config needs no code change.
 * Everything factual about a condition -- its chain, its commands, whether it
 * ran -- comes from the data, not from here.
 */
const CONDITION_NOTES: Record<string, string> = {
  clean:
    "The baseline. 16 kHz mono, untouched, so every other row can be read as a " +
    "difference from this one.",
  narrowband:
    "Resampled to 8 kHz and nothing else. Everything above 4 kHz is discarded, " +
    "by Nyquist. That band is where most of the energy distinguishing s from f, " +
    "or t from k, actually lives, which is why phones sound muffled and why " +
    "consonants become confusable before vowels do.",
  g711_ulaw:
    "8 kHz plus a mu-law encode and decode. Each 16-bit sample is mapped onto 8 " +
    "bits along a logarithmic curve, because hearing is roughly logarithmic: " +
    "quiet detail is preserved at the cost of precision in loud passages. It is " +
    "lossy and irreversible, and it is what most VoIP and Indian telephony " +
    "actually carries.",
  gsm_fr:
    "GSM full rate, the 2G mobile codec. Far more aggressive than G.711: it " +
    "models the vocal tract rather than the waveform, so what survives is what " +
    "the model thought speech should look like.",
  opus_low:
    "Opus at a low bitrate, as a VoIP or WebRTC leg under congestion would " +
    "negotiate. Modern and efficient, but at this bitrate it is still discarding " +
    "most of the signal.",
  packet_loss_2:
    "Audio travels in roughly 20 ms packets and some never arrive. Dropped " +
    "frames are zeroed, punching holes in the speech.",
  packet_loss_5:
    "20 ms is about the length of one short Hindi syllable, which makes this the " +
    "condition most likely to remove a digit outright rather than blur it.",
  packet_loss_10:
    "At this rate the holes start to overlap the same word. Loss here is " +
    "independent per frame; the bursty conditions below drop the same fraction " +
    "in runs instead, and that is where the entities are actually lost.",
  noisy_line:
    "Additive background noise at a set signal-to-noise ratio, applied before " +
    "the codec. That order is the physical one: a noisy room first, then the " +
    "phone line compresses the room and the speech together.",
};

/**
 * Sections are numbered like a paper. Listening comes before the codec chain
 * deliberately: hearing the damage makes the technical explanation land,
 * whereas reading the chain first is work with no payoff yet.
 *
 * `nav` is the short label for the header bar; `title` is the full one, which
 * the section heading itself carries.
 */
const SECTIONS: SectionDef[] = [
  { id: "why", no: "", title: "Why this exists", nav: "Why" },
  { id: "problem", no: "01", title: "The problem", nav: "Problem" },
  { id: "what", no: "02", title: "What Ginti does", nav: "Approach" },
  { id: "listen", no: "03", title: "Hear it break", nav: "Listen" },
  { id: "degradation", no: "04", title: "How the degradation works", nav: "Degradation" },
  { id: "results", no: "05", title: "Results", nav: "Results" },
  { id: "used", no: "06", title: "What this runs on", nav: "What was used" },
  { id: "method", no: "07", title: "Exact parameters", nav: "Parameters" },
  { id: "issues", no: "08", title: "Known issues", nav: "Issues" },
];

const md = (key: string) => data.content[key] ?? { summary: null, body: "" };

/** Provenance banner. Load-bearing: the page goes to the vendor being
 *  evaluated, so mock output must never read as a measurement. */
function Provenance() {
  if (!data.provenance.isMock) return null;
  return (
    <div className="banner">
      <div className="banner__inner">
        <strong>These are not measurements.</strong> Every row in this build
        comes from the offline mock recogniser, which returns canned output
        without contacting any API. Nothing here describes the behaviour of a
        real system.
      </div>
    </div>
  );
}

function Footer() {
  const repo = data.project.repo;
  const built = new Date(data.generatedAt)
    .toISOString().slice(0, 16).replace("T", " ");
  const runs = data.runs.map((r) => r.runId).join(", ");

  return (
    <footer className="foot">
      <div className="foot__inner">
        <div className="foot__brand">
          <span className="foot__mark">
            <Mark className="foot__logo" size="1em" />
            Ginti<span className="deva">गिनती</span>
          </span>
          <p>{data.project.tagline}</p>
          {repo && (
            <a className="foot__link" href={repo} target="_blank" rel="noreferrer noopener">
              {repo.replace("https://", "")}
            </a>
          )}
        </div>

        <dl className="foot__meta">
          <div><dt>scope</dt><dd>
            {data.headline.utterances} synthetic {languageList(data.headline.languages)}{" "}
            utterances, {data.headline.models} models,{" "}
            {data.headline.conditions} of {data.headline.declaredConditions}{" "}
            declared conditions, {data.headline.modes.join(" and ")} mode.
            A calibration run, not a benchmark.
          </dd></div>
          <div><dt>entities recovered</dt><dd>
            {data.headline.hits} of {data.headline.entities}
          </dd></div>
          <div><dt>built</dt><dd>{built}Z</dd></div>
          <div><dt>runs</dt><dd>{runs}</dd></div>
          <div><dt>result rows</dt><dd>{data.summary.rows}</dd></div>
          <div><dt>entities scored</dt><dd>{data.summary.entities}</dd></div>
          {data.audioBundle.files > 0 && (
            <div><dt>audio bundled</dt><dd>
              {data.audioBundle.files} files,{" "}
              {(data.audioBundle.bytes / 1e6).toFixed(1)} MB
            </dd></div>
          )}
          <div><dt>sources</dt><dd>{data.provenance.sourceFiles.results.join(", ")}</dd></div>
        </dl>
      </div>
    </footer>
  );
}

export function App() {
  const stats = data.renderingStats;
  const h = data.headline;
  const pair = data.lossPairs[0];
  // The diagram's first step shows a real value from the run rather than one
  // typed into the component, so it cannot drift from the corpus.
  const heroEx = pickHeroExample(data.listen, data.conditions);
  const heroValue = heroEx ? prettyValue(heroEx.expected) : null;

  return (
    <Gate>
      <Ambient />
      <Header sections={SECTIONS} heroId="top" repo={data.project.repo} />
      <Provenance />
      <Hero data={data} />
      <WhyItMatters data={data} />

      <Section id="problem" no="01" title="The problem"
               summary={md("problem").summary}>
        <ContrastBars werByModel={h.werByModel} hitRate={h.hitRate} />
        <Detail>
          <Markdown source={md("problem").body} />
        </Detail>
      </Section>

      <Section id="what" no="02" title="What Ginti does" tone="cool" wide
               summary={md("what-ginti-does").summary}>
        <LoopDiagram conditions={data.headline.conditions}
                     models={data.headline.models}
                     sample={heroValue} />
        <ScoredTypes types={data.entityTypes} />
        <Detail>
          <Markdown source={md("what-ginti-does").body} />
        </Detail>
      </Section>

      <Section id="listen" no="03" title="Hear it break" wide
               summary="One sentence, read aloud. Put it through a phone line and switch between the two takes on the same playhead.">
        <Playground listen={data.listen} conditions={data.conditions} />
      </Section>

      <Section id="degradation" no="04" title="How the degradation works" tone="warm" wide
               summary={md("degradation").summary}>
        <ConditionLadder conditions={data.conditions} matrix={data.matrix} />
        <Detail>
          <Markdown source={md("degradation").body} />
          <Conditions conditions={data.conditions} notes={CONDITION_NOTES} />
          <h4 className="minihead">What this model of the phone line leaves out</h4>
          <Markdown source={md("degradation-limits").body} />
        </Detail>
      </Section>

      <Section id="results" no="05" title="Results" tone="cool-deep" wide
               summary={
                 `Entity accuracy is unaffected by bandwidth, codecs and ` +
                 `scattered packet loss, and falls sharply once the same loss ` +
                 `arrives in bursts. Word error rate moves ` +
                 `${h.werConditionMin?.toFixed(3)}–${h.werConditionMax?.toFixed(3)} ` +
                 `across all of it and does not track the failure.`
               }>
        {pair && (
          <Reveal className="prose lede">
            <p>
              Both conditions drop {(pair.rate * 100).toFixed(0)}% of the
              20&nbsp;ms packets the audio travels in. The only difference is
              when: independently in one, and in runs averaging{" "}
              {pair.meanBurstMs ?? 100}&nbsp;ms in the other. Word error rate
              moves {pair.scattered.wer?.toFixed(3) ?? "—"} to{" "}
              {pair.bursty.wer?.toFixed(3) ?? "—"} across that and would not
              tell you anything had happened.
            </p>
          </Reveal>
        )}

        {pair && (
          <Reveal className="pairbox">
            {data.lossPairs.map((p) => {
              const s = p.scattered.hits / p.scattered.total;
              const b = p.bursty.hits / p.bursty.total;
              return (
                <div className="pairbox__row" key={p.rate}>
                  <span className="pairbox__rate">
                    {(p.rate * 100).toFixed(0)}% loss
                  </span>
                  {/* Both bars run the full 0..1 scale. What differs, and what
                      the eye actually compares, is the rust tail: the share of
                      entities the condition lost. */}
                  <div className="pairbox__bars">
                    {[
                      { v: s, side: p.scattered, kind: "keep" as const },
                      { v: b, side: p.bursty, kind: "lose" as const },
                    ].map((r) => (
                      <div className={`pairbox__bar pairbox__bar--${r.kind}`}
                           key={r.side.condition}>
                        <span className="pairbox__hit" style={{ width: `${r.v * 100}%` }} />
                        <span className="pairbox__miss" style={{ width: `${(1 - r.v) * 100}%` }} />
                        <b>{r.v.toFixed(3)}</b>
                        <i>{r.side.condition}</i>
                        <u>&mdash; {r.side.total - r.side.hits} lost</u>
                      </div>
                    ))}
                  </div>
                  <span className="pairbox__gap">
                    &minus;{((s - b) * 100).toFixed(1)} pts
                  </span>
                </div>
              );
            })}
            <p className="figcap">
              All entity types, both models, on a 0&ndash;1 scale; the rust tail
              is the share lost. Each pair differs only in whether the dropped
              frames are independent or clustered into runs averaging{" "}
              {pair.meanBurstMs ?? 100}&nbsp;ms.
            </p>
          </Reveal>
        )}

        <Reveal as="figure" className="bleedfig">
          <DisagreementChart
            matrix={data.matrix} wer={data.wer} conditions={data.conditions}
          />
        </Reveal>

        <Subhead note="An entity counts as a hit only on exact normalised match.">
          Entity hit rate by type and condition
        </Subhead>
        <ResultsMatrix
          matrix={data.matrix}
          conditions={data.conditions}
          entityTypes={data.entityTypes}
          models={data.models}
          lowNThreshold={data.lowNThreshold}
        />

        <Subhead note="Transcribe mode normalises numbers, but not to a fixed form.">
          How the models write numbers back
        </Subhead>
        <Reveal className="prose">
          <p>
            {stats.rewrote > 0 && (
              <>
                In {stats.rewrote} of {stats.pairs * stats.models} scored
                (utterance, condition, model) observations the model wrote the
                number in the opposite form to the reference.{" "}
              </>
            )}
            {stats.models > 1 && stats.disagreements > 0 && (
              <>
                The models disagreed with each other on {stats.disagreements} of{" "}
                {stats.pairs} pairs.{" "}
              </>
            )}
            {stats.selfFlips > 0 && (
              <>
                In {stats.selfFlips} case{stats.selfFlips === 1 ? "" : "s"} a
                single model changed its own rendering between the clean and
                degraded versions of the same utterance.{" "}
              </>
            )}
            Anything parsing a transcript for an account number has to handle
            both forms.
          </p>
        </Reveal>
        <RenderingTable
          rendering={data.rendering} wer={data.wer} models={data.models}
        />

        {data.cues && (
          <Subhead note="An orphan is a value that arrived with nothing left beside it to say what kind of number it is.">
            What the burst takes besides the digits
          </Subhead>
        )}
        <CueSurvival data={data} />

        <Reveal className="note note--warn">
          This part is an observation about output formatting, not about
          recognition accuracy: the model-to-model gap above comes from how each
          writes numbers. The entity losses under bursty packet loss are a
          separate effect, and a real one.
        </Reveal>
      </Section>

      <Section id="used" no="06" title="What this runs on" wide
               summary={
                 `Two Sarvam endpoints: bulbul:v3 makes the test material and ` +
                 `the saaras models are the thing under test. Everything ` +
                 `between them — the sentences, the damage, the scoring — is ` +
                 `the harness. Nothing here is evidence about the rest of the ` +
                 `platform.`
               }>
        <WhatWasUsed data={data} />
      </Section>

      <Section id="method" no="07" title="Exact parameters" tone="warm-deep"
               summary={md("method").summary}>
        <Detail label="Read how it is scored">
          <Markdown source={md("method").body} />
        </Detail>
        <MethodTable data={data} />
      </Section>

      <Section id="issues" no="08" title="Known issues"
               summary={md("known-issues").summary}>
        <Reveal className="prose">
          <Markdown source={md("known-issues").body} />
        </Reveal>
      </Section>

      <Footer />
    </Gate>
  );
}
