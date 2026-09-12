import { Gate } from "./Gate";
import { ResultsMatrix } from "./components/ResultsMatrix";
import { RenderingTable } from "./components/RenderingTable";
import { ListenSection } from "./components/ListenSection";
import { Conditions, PipelineDiagram } from "./components/Explainers";
import { ConditionLadder, DisagreementChart } from "./components/Charts";
import { Detail, Nav, ResultBlock, Section } from "./components/Shell";
import { Markdown } from "./components/Markdown";
import { MethodTable } from "./components/MethodTable";
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
    "At this rate the holes start to overlap the same word. Note that loss here " +
    "is independent per frame, not bursty; see the limitations below.",
  noisy_line:
    "Additive background noise at a set signal-to-noise ratio, applied before " +
    "the codec. That order is the physical one: a noisy room first, then the " +
    "phone line compresses the room and the speech together.",
};

/**
 * Sections are numbered like a paper and the nav is the table of contents.
 *
 * Listening comes before the codec chain deliberately: hearing the damage makes
 * the technical explanation land, whereas reading the chain first is work with
 * no payoff yet.
 */
const SECTIONS = [
  { id: "problem", no: "01", title: "The problem" },
  { id: "what", no: "02", title: "What Ginti does" },
  { id: "listen", no: "03", title: "Listen for yourself" },
  { id: "degradation", no: "04", title: "How the degradation works" },
  { id: "results", no: "05", title: "Results" },
  { id: "method", no: "06", title: "Method" },
  { id: "issues", no: "07", title: "Known issues" },
];

const md = (key: string) => data.content[key] ?? { summary: null, body: "" };

function Masthead() {
  return (
    <header className="masthead">
      <div className="wrap">
        <h1 className="masthead__title">
          Ginti<span className="deva">गिनती</span>
        </h1>
        <p className="masthead__lede">
          Whether the number survives the phone line. An entity-level evaluation
          of Indic speech recognition under telephony-grade audio degradation.
        </p>
      </div>
    </header>
  );
}

/** Provenance banner. Load-bearing: the page goes to the vendor being
 *  evaluated, so mock output must never read as a measurement. */
function Provenance() {
  if (!data.provenance.isMock) return null;
  return (
    <div className="banner-wrap">
      <div className="wrap">
        <div className="banner">
          <strong>These are not measurements.</strong> Every row in this build
          comes from the offline mock recogniser, which returns canned output
          without contacting any API. Nothing here describes the behaviour of a
          real system.
        </div>
      </div>
    </div>
  );
}

export function App() {
  const stats = data.renderingStats;
  const h = data.headline;

  return (
    <Gate>
      <Nav sections={SECTIONS} />
      <Masthead />
      <Provenance />
      <ResultBlock data={data} />

      <Section id="problem" no="01" title="The problem"
               summary={md("problem").summary}>
        <Detail>
          <Markdown source={md("problem").body} />
        </Detail>
      </Section>

      <Section id="what" no="02" title="What Ginti does"
               summary={md("what-ginti-does").summary}>
        <PipelineDiagram />
        <Detail>
          <Markdown source={md("what-ginti-does").body} />
        </Detail>
      </Section>

      <Section id="listen" no="03" title="Listen for yourself"
               summary="The same sentence, clean and then over the phone line, with what each model returned underneath.">
        <ListenSection listen={data.listen} conditions={data.conditions} />
      </Section>

      <Section id="degradation" no="04" title="How the degradation works"
               summary={md("degradation").summary}>
        <ConditionLadder conditions={data.conditions} />
        <Detail>
          <Markdown source={md("degradation").body} />
          <Conditions conditions={data.conditions} notes={CONDITION_NOTES} />
          <h3 className="subhead">What this model of the phone line leaves out</h3>
          <Markdown source={md("degradation-limits").body} />
        </Detail>
      </Section>

      <Section id="results" no="05" title="Results"
               summary={
                 `Across the telephony conditions word error rate moves only ` +
                 `${h.werConditionMin?.toFixed(3)}\u2013${h.werConditionMax?.toFixed(3)} ` +
                 `and the entity hit rate not at all. The large gap is between ` +
                 `the two models on identical audio.`
               }>
        <DisagreementChart
          matrix={data.matrix} wer={data.wer} conditions={data.conditions}
        />

        <h3 className="subhead">Entity hit rate</h3>
        <ResultsMatrix
          matrix={data.matrix}
          conditions={data.conditions}
          entityTypes={data.entityTypes}
          models={data.models}
          lowNThreshold={data.lowNThreshold}
        />

        <div className="prose" style={{ margin: "2.5rem 0 1.5rem" }}>
          <p>
            Transcribe mode normalises numbers, but not to a fixed form.{" "}
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
        </div>
        <RenderingTable
          rendering={data.rendering} wer={data.wer} models={data.models}
        />

        <div className="note note--warn" style={{ marginTop: "2rem" }}>
          This is an observation about output formatting and about what word
          error rate measures. It is not a claim about recognition accuracy.
          Every entity in this run was recovered correctly by both models.
        </div>
      </Section>

      <Section id="method" no="06" title="Method"
               summary={md("method").summary}>
        <Detail>
          <Markdown source={md("method").body} />
          <h3 className="subhead">Exact parameters</h3>
          <MethodTable data={data} />
        </Detail>
      </Section>

      <Section id="issues" no="07" title="Known issues"
               summary={md("known-issues").summary}>
        <Markdown source={md("known-issues").body} />
      </Section>

      <footer className="footer">
        <div className="wrap footer__grid">
          <span>
            Built {new Date(data.generatedAt).toISOString().slice(0, 16).replace("T", " ")}Z
          </span>
          <span>from {data.provenance.sourceFiles.results.join(", ")}</span>
          <span>{data.summary.rows} result rows</span>
        </div>
      </footer>
    </Gate>
  );
}
