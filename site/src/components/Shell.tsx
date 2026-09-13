import { useEffect, useRef, useState, type ReactNode } from "react";
import { DisagreementChart } from "./Charts";
import type { ConditionDef, GintiData } from "../types";

/* -------------------------------------------------------------------------
 * Result block
 * ---------------------------------------------------------------------- */

/**
 * The finding, above the fold.
 *
 * A reader opening a forwarded link will not scroll two thousand words to reach
 * section five, so the two numbers that make the argument come first. Every
 * figure is read from the data; the scope line immediately under them exists so
 * a number this narrow cannot be mistaken for a broader claim.
 */
export function ResultBlock({ data }: { data: GintiData }) {
  const h = data.headline;
  const pct = (v: number | null) => (v === null ? "—" : v.toFixed(3));

  // The controlled comparison, widest gap first: two conditions differing only
  // in whether the same nominal loss is scattered or clustered. A pooled total
  // across ten conditions would average this catastrophe with eight perfect
  // ones and hide the only thing the run actually found.
  const pair = data.lossPairs[0];

  return (
    <section className="result" aria-labelledby="result-heading">
      <div className="wrap">
        <h2 id="result-heading" className="visually-hidden">The result</h2>

        {pair ? (
          <>
            <p className="result__lede">
              At {(pair.rate * 100).toFixed(0)}% packet loss, account numbers
              survive or do not depending entirely on whether the loss is
              scattered or arrives in bursts.
            </p>

            <div className="result__pair">
              <div>
                <div className="result__k">
                  scattered loss &mdash; {pair.scattered.condition}
                </div>
                <div className="result__v result__v--teal">
                  {pair.scattered.accounts.hits} / {pair.scattered.accounts.total}
                </div>
                <div className="result__sub">
                  account numbers recovered, both models
                </div>
              </div>
              <div>
                <div className="result__k">
                  bursty loss &mdash; {pair.bursty.condition}
                </div>
                <div className="result__v result__v--rust">
                  {pair.bursty.accounts.hits} / {pair.bursty.accounts.total}
                </div>
                <div className="result__sub">
                  same rate, same audio, same codec
                </div>
              </div>
            </div>

            <p className="result__says">
              Independent per-frame loss leaves intact context either side of
              every 20&nbsp;ms hole, and the number comes through. Clustering the
              same {(pair.rate * 100).toFixed(0)}% into bursts averaging{" "}
              {pair.meanBurstMs ?? 100}&nbsp;ms removes about a syllable at a
              time, and in these sentences a syllable is a digit. Nothing else
              about the two conditions differs.
            </p>

            <p className="result__says result__says--quiet">
              Word error rate barely registers it: {pct(pair.scattered.wer)}{" "}
              against {pct(pair.bursty.wer)} over the same two conditions. Across
              all {h.conditions} conditions it moves{" "}
              {pct(h.werConditionMin)}&ndash;{pct(h.werConditionMax)} while the
              entity hit rate falls as far as{" "}
              {(Math.min(...data.lossPairs.map(
                (p) => p.bursty.hits / p.bursty.total))).toFixed(3)}.
            </p>
          </>
        ) : (
          <div className="result__pair">
            <div>
              <div className="result__k">entity hit rate</div>
              <div className="result__v result__v--teal">
                {h.hits} / {h.entities}
              </div>
            </div>
          </div>
        )}

        <p className="result__scope">
          Overall {h.hits} of {h.entities} entities recovered across{" "}
          {h.conditions} conditions &mdash; a total that averages the failures
          above with the conditions that lost nothing, which is why it is not the
          headline. Scope: {h.utterances} synthetic {h.languages.join(", ")}{" "}
          utterances, {h.models} models, {h.conditions} of{" "}
          {h.declaredConditions} declared conditions, {h.modes.join(" and ")}{" "}
          mode only. A calibration run, not a benchmark.
        </p>

        <DisagreementChart
          matrix={data.matrix} wer={data.wer} conditions={data.conditions} compact
        />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Disclosure
 * ---------------------------------------------------------------------- */

/**
 * Supporting prose, collapsed by default.
 *
 * A fresh reader should meet a short page. Nothing is remembered between
 * visits: the argument has to survive on the summaries alone, and anyone who
 * wants the detail can ask for it.
 */
export function Detail({ label = "Read the detail", children }: {
  label?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useRef(`d${Math.random().toString(36).slice(2, 8)}`).current;
  return (
    <div className={`detail ${open ? "detail--open" : ""}`}>
      <button className="detail__toggle" aria-expanded={open} aria-controls={id}
              onClick={() => setOpen((v) => !v)} type="button">
        {open ? "Hide the detail" : label} {open ? "−" : "+"}
      </button>
      <div className="detail__body" id={id} role="region">
        <div>{children}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Navigation
 * ---------------------------------------------------------------------- */

export interface SectionDef { id: string; no: string; title: string; }

/** Which section is in view, and how far down the page we are. */
function useReadingPosition(sections: SectionDef[]) {
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const update = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      setProgress(max > 0 ? Math.min(1, doc.scrollTop / max) : 0);

      // The section whose top has most recently passed a line a third of the
      // way down the viewport -- steadier than an IntersectionObserver when
      // sections differ wildly in length.
      const line = doc.clientHeight / 3;
      let current = 0;
      sections.forEach((s, i) => {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= line) current = i;
      });
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [sections]);

  return { active, progress };
}

export function Nav({ sections }: { sections: SectionDef[] }) {
  const { active, progress } = useReadingPosition(sections);
  const current = sections[active];

  return (
    <>
      {/* Reading position, at the very top edge of the viewport rather than
          under the bar: it is ambient, and it should not read as a border. */}
      <div className="progress" role="presentation">
        <div className="progress__bar" style={{ width: `${progress * 100}%` }} />
      </div>

      <nav className="nav" aria-label="Sections">
        <div className="wrap nav__inner">
          <span className="nav__mark">
            Ginti<span className="deva">गिनती</span>
            {/* Duplicated by the rail wherever the rail is visible. */}
            <span className="nav__pos">
              {current.no} / {String(sections.length).padStart(2, "0")}
            </span>
          </span>
          <div className="nav__links">
            {sections.map((s, i) => (
              <a key={s.id} href={`#${s.id}`}
                 className={i === active ? "is-active" : undefined}>
                {s.title}
              </a>
            ))}
          </div>
        </div>
      </nav>

      {/* On a wide screen the nav has room to be a table of contents, which
          also makes the length of the page legible at a glance. */}
      <aside className="rail" aria-label="Contents">
        <ol>
          {sections.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className={i === active ? "is-active" : undefined}
                 aria-current={i === active ? "page" : undefined}>
                <span className="rail__no">{s.no}</span>
                <span className="rail__title">{s.title}</span>
              </a>
            </li>
          ))}
        </ol>
      </aside>
    </>
  );
}

/* -------------------------------------------------------------------------
 * Section
 * ---------------------------------------------------------------------- */

export function Section({
  id, no, title, summary, children,
}: {
  id: string; no: string; title: string;
  summary?: ReactNode; children?: ReactNode;
}) {
  return (
    <section className="section" id={id}>
      <div className="wrap">
        <div className="section__head">
          <span className="section__no">{no}</span>
          <h2 className="section__title">{title}</h2>
          {summary && <p className="section__summary">{summary}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

export function conditionSummary(conditions: ConditionDef[]) {
  const run = conditions.filter((c) => c.exercised).length;
  return { run, total: conditions.length };
}
