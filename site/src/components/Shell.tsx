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
  const worst = h.werByModel[h.werByModel.length - 1];
  const best = h.werByModel[0];

  return (
    <section className="result" aria-labelledby="result-heading">
      <div className="wrap">
        <h2 id="result-heading" className="visually-hidden">The result</h2>

        <div className="result__pair">
          <div>
            <div className="result__k">entity hit rate</div>
            <div className="result__v result__v--teal">
              {h.hits} / {h.entities}
            </div>
            <div className="result__sub">
              every account number, amount, OTP and PIN code, every condition
            </div>
          </div>
          <div>
            {/* Sliced per model, not per condition. Across conditions WER moves
                by about 0.015; between models it moves by ten times that on
                byte-identical audio. A range spanning both would imply the
                phone line is doing something it is not. */}
            <div className="result__k">word error rate, per model</div>
            <div className="result__v result__v--rust result__v--pair">
              <span>{pct(best?.wer ?? null)}</span>
              <span className="result__vs">vs</span>
              <span>{pct(worst?.wer ?? null)}</span>
            </div>
            <div className="result__sub">
              {best?.model} against {worst?.model}, identical audio
            </div>
          </div>
        </div>

        <p className="result__says">
          Both numbers describe the same {h.entities} entities in the same
          recordings. Every entity survived every condition, and the two models
          still differ by{" "}
          {((worst?.wer ?? 0) - (best?.wer ?? 0)).toFixed(3)} in word error rate
          &mdash; not because one heard the audio better, but because they write
          numbers differently. Across the telephony conditions themselves word
          error rate moves only{" "}
          {pct(h.werConditionMin)}&ndash;{pct(h.werConditionMax)}.
        </p>

        <p className="result__scope">
          Scope: {h.utterances} synthetic {h.languages.join(", ")} utterances,{" "}
          {h.models} models, {h.conditions} of {h.declaredConditions} declared
          conditions, {h.modes.join(" and ")} mode only. A calibration run, not
          a benchmark.
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
      <nav className="nav" aria-label="Sections">
        <div className="wrap nav__inner">
          <span className="nav__mark">
            Ginti<span className="deva">गिनती</span>
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
          <div className="nav__progress" style={{ width: `${progress * 100}%` }} />
        </div>
      </nav>

      {/* On a wide screen the nav has room to be a table of contents, which
          also makes the length of the page legible at a glance. */}
      <aside className="rail" aria-label="Contents">
        <ol>
          {sections.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className={i === active ? "is-active" : undefined}
                 aria-current={i === active ? "true" : undefined}>
                <span className="rail__no">{s.no}</span>
                <span>{s.title}</span>
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
