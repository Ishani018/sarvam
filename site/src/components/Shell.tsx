import { useRef, useState, type ReactNode } from "react";
import { Reveal } from "./Reveal";
import type { ConditionDef } from "../types";

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
        <span className="detail__sign" aria-hidden="true">{open ? "−" : "+"}</span>
        {open ? "Hide the detail" : label}
      </button>
      <div className="detail__body" id={id} role="region">
        <div>{children}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Section
 * ---------------------------------------------------------------------- */

/**
 * Sections alternate ground so the page has rhythm rather than one continuous
 * column. The tone is passed rather than computed from position, because the
 * rhythm should follow the argument -- the two sections that carry a result sit
 * on the tinted panel -- and not the parity of an index.
 */
export function Section({
  id, no, title, summary, tone = "paper", wide = false, children,
}: {
  id: string; no: string; title: string;
  summary?: ReactNode;
  /** Which ground this section sits on. Warm and cool are two families off
   *  the same paper, far enough apart that scrolling reads as moving between
   *  rooms. Passed rather than computed from position, because the rhythm
   *  should follow the argument, not the parity of an index. */
  tone?: "paper" | "warm" | "warm-deep" | "cool" | "cool-deep";
  wide?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className={`sec sec--${tone}`} id={id}>
      <div className={`sec__inner ${wide ? "sec__inner--wide" : ""}`}>
        <Reveal className="sec__head">
          <div className="sec__rule" aria-hidden="true">
            <span className="sec__no">{no}</span>
            <span className="sec__line" />
          </div>
          <h2 className="sec__title">{title}</h2>
          {summary && <p className="sec__summary">{summary}</p>}
        </Reveal>
        <div className="sec__body">{children}</div>
      </div>
    </section>
  );
}

/** A labelled break inside a section, for the sub-parts of Results. */
export function Subhead({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <Reveal className="subhead">
      <h3>{children}</h3>
      {note && <p>{note}</p>}
    </Reveal>
  );
}

export function conditionSummary(conditions: ConditionDef[]) {
  const run = conditions.filter((c) => c.exercised).length;
  return { run, total: conditions.length };
}
