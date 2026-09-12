import { Gate } from "./Gate";
import { ResultsMatrix } from "./components/ResultsMatrix";
import { RenderingTable } from "./components/RenderingTable";
import raw from "./generated/data.json";
import type { GintiData } from "./types";

const data = raw as unknown as GintiData;

/** Sections are numbered like a paper; the nav is the table of contents. */
const SECTIONS = [
  { id: "problem", no: "01", title: "The problem" },
  { id: "what", no: "02", title: "What Ginti does" },
  { id: "degradation", no: "03", title: "How the degradation works" },
  { id: "listen", no: "04", title: "Listen for yourself" },
  { id: "results", no: "05", title: "Results" },
  { id: "method", no: "06", title: "Method" },
  { id: "issues", no: "07", title: "Known issues" },
];

function Section({ id, no, title, intro, children }: {
  id: string; no: string; title: string;
  intro?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <section className="section" id={id}>
      <div className="wrap">
        <div className="section__head">
          <span className="section__no">{no}</span>
          <h2 className="section__title">{title}</h2>
          {intro && <div className="section__intro prose">{intro}</div>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** Placeholder for sections not yet built, so the page rhythm and nav are real
 *  while the remaining steps land. */
function Pending({ what }: { what: string }) {
  return <p className="t-dim prose" style={{ fontSize: "var(--t-15)" }}>{what}</p>;
}

function Masthead() {
  const run = data.runs[0];
  const modes = [...new Set(data.runs.flatMap((r) => r.modes))];
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

        <dl className="facts">
          <div>
            <dt className="facts__k">utterances</dt>
            <dd className="facts__v">{data.summary.utterances}</dd>
          </div>
          <div>
            <dt className="facts__k">conditions run</dt>
            <dd className="facts__v">
              {data.summary.conditions} of {data.conditions.length}
            </dd>
          </div>
          <div>
            <dt className="facts__k">models</dt>
            <dd className="facts__v">{data.models.join("\n")}</dd>
          </div>
          <div>
            <dt className="facts__k">mode</dt>
            <dd className="facts__v">{modes.join(", ")}</dd>
          </div>
          <div>
            <dt className="facts__k">entities scored</dt>
            <dd className="facts__v">{data.summary.entities}</dd>
          </div>
          <div>
            <dt className="facts__k">run</dt>
            <dd className="facts__v" style={{ fontSize: "var(--t-12)" }}>
              {run?.runId ?? "—"}
            </dd>
          </div>
        </dl>
      </div>
    </header>
  );
}

/** Provenance banners. These are load-bearing: the page is sent to the vendor
 *  being evaluated, so it must never let mock output or a five-utterance sample
 *  read as a measurement. */
function Provenance() {
  const n = data.summary.utterances;
  const small = n < 40;
  return (
    <div className="wrap">
      {data.provenance.isMock && (
        <div className="banner">
          <strong>These are not measurements.</strong> Every row in this build
          comes from the offline mock recogniser, which returns canned output
          without contacting any API. Nothing here describes the behaviour of a
          real system.
        </div>
      )}
      {!data.provenance.isMock && small && (
        <div className="banner">
          <strong>Sample size: {n} utterances.</strong> This is a pipeline
          calibration run, not a benchmark. It is large enough to show how the
          measurement behaves and far too small to support any claim about
          recognition accuracy. Per-cell rates are withheld below wherever
          n &lt; {data.lowNThreshold}.
        </div>
      )}
    </div>
  );
}

export function App() {
  // Derived, not typed in: the widest WER gap actually observed in the run.
  const spread = data.werSpread;
  const stats = data.renderingStats;
  return (
    <Gate>
      <nav className="nav">
        <div className="wrap nav__inner">
          <span className="nav__mark">Ginti<span className="deva">गिनती</span></span>
          <div className="nav__links">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`}>{s.title}</a>
            ))}
          </div>
        </div>
      </nav>

      <Masthead />
      <Provenance />

      <Section id="problem" no="01" title="The problem" intro={
        <p>
          Voice agents in India run over 8&nbsp;kHz phone lines with lossy
          codecs. Public Indic ASR benchmarks report a single aggregate word
          error rate on clean studio audio. That says nothing about whether the
          account number survived. On a collections call, one wrong digit is a
          failed transaction, not a typo.
        </p>
      }>
        <Pending what="Section prose lands with the content pass." />
      </Section>

      <Section id="what" no="02" title="What Ginti does" intro={
        <p>
          The generator picks the number first and builds the sentence around
          it, so the correct answer is known by construction. Every miss is
          therefore attributable, rather than a disagreement between two
          fallible annotations.
        </p>
      }>
        <Pending what="Pipeline diagram lands in the explainer pass." />
      </Section>

      <Section id="degradation" no="03" title="How the degradation works" intro={
        <p>
          Nine conditions are declared; {data.summary.conditions} have been run.
          Each is a chain of transforms, and the page shows the commands that
          actually executed rather than a restatement of the config.
        </p>
      }>
        <Pending what="Per-condition explainers land in the explainer pass." />
      </Section>

      <Section id="listen" no="04" title="Listen for yourself" intro={
        <p>
          The same sentence, clean and degraded, with what each model returned
          underneath.
        </p>
      }>
        <Pending what="Audio player and listen section land next." />
      </Section>

      <Section id="results" no="05" title="Results" intro={
        <>
          <p>
            The headline is about the metric, not about accuracy. On identical
            audio, word error rate moves from{" "}
            <span className="t-mono">{spread.min.wer.toFixed(3)}</span> to{" "}
            <span className="t-mono">{spread.max.wer.toFixed(3)}</span> purely
            because of how the number was written &mdash; digits on one side,
            spelled out on the other. Entity hit rate does not move at all.
          </p>
          <p>
            A single aggregate word error rate cannot tell you whether the
            account number survived. That argument holds at this sample size in
            a way that no performance claim would.
          </p>
        </>
      }>
        <h3 className="subhead">Entity hit rate</h3>
        <ResultsMatrix
          matrix={data.matrix}
          conditions={data.conditions}
          entityTypes={data.entityTypes}
          models={data.models}
          lowNThreshold={data.lowNThreshold}
        />

        <div className="prose" style={{ marginBottom: "1.5rem" }}>
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
          rendering={data.rendering}
          wer={data.wer}
          models={data.models}
        />

        <div className="note note--warn" style={{ marginTop: "2rem" }}>
          This is an observation about output formatting and about what word
          error rate measures. It is not a claim about recognition accuracy.
          Every entity in this run was recovered correctly by both models.
        </div>
      </Section>

      <Section id="method" no="06" title="Method" intro={
        <p>
          The corpus is seeded and prefix-stable, so the identical test set can
          be regenerated from a language, a count and a seed.
        </p>
      }>
        <Pending what="Run metadata and exact API parameters land with the content pass." />
      </Section>

      <Section id="issues" no="07" title="Known issues">
        <Pending what="Pulled from content/known-issues.md in the content pass." />
      </Section>

      <footer className="footer">
        <div className="wrap footer__grid">
          <span>Built {new Date(data.generatedAt).toISOString().slice(0, 16).replace("T", " ")}Z</span>
          <span>
            from {data.provenance.sourceFiles.results.join(", ")}
          </span>
          <span>{data.summary.rows} result rows</span>
        </div>
      </footer>
    </Gate>
  );
}
