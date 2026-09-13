import { entityNoun } from "../entityDiff";
import type { ConditionDef } from "../types";

/* -------------------------------------------------------------------------
 * Pipeline diagram
 * ---------------------------------------------------------------------- */

/**
 * Flat and schematic. The one thing it has to carry is that the gold value is
 * fixed at the left edge, before any audio exists, and every later stage is
 * compared back to it -- which is what makes a miss attributable rather than a
 * disagreement between two fallible annotations.
 */
export function PipelineDiagram() {
  const steps = [
    { x: 0, label: "sample value", sub: "9234" },
    { x: 1, label: "build sentence", sub: "around it" },
    { x: 2, label: "synthesise", sub: "24 kHz TTS" },
    { x: 3, label: "degrade", sub: "8 kHz, codec, loss" },
    { x: 4, label: "transcribe", sub: "ASR" },
    { x: 5, label: "extract + compare", sub: "hit or miss" },
  ];
  const W = 148;
  const GAP = 22;
  const H = 54;
  const total = steps.length * W + (steps.length - 1) * GAP;

  return (
    <figure className="diagram">
      <svg
        /* One unit of slack each side so the outer boxes' strokes are not
           clipped when the svg is scaled to the container width. */
        viewBox={`-1 0 ${total + 2} 150`}
        width="100%"
        role="img"
        aria-label="Pipeline: a value is sampled first, a sentence is built around it, synthesised, degraded, transcribed, then the extracted entity is compared back to the original value."
      >
        {steps.map((s, i) => {
          const x = i * (W + GAP);
          return (
            <g key={s.label}>
              <rect className="dg-box" x={x} y={40} width={W} height={H} rx="10" />
              <text x={x + 12} y={64} className="dg-label">{s.label}</text>
              <text x={x + 12} y={82} className="dg-sub">{s.sub}</text>
              {i < steps.length - 1 && (
                <path
                  d={`M ${x + W + 4} ${40 + H / 2} L ${x + W + GAP - 4} ${40 + H / 2}`}
                  stroke="var(--rule-strong)" strokeWidth="1"
                  markerEnd="url(#gt-arrow)"
                />
              )}
            </g>
          );
        })}

        {/* The gold value is known before any audio exists. */}
        <path
          d={`M ${W / 2} 40 L ${W / 2} 20 L ${total - W / 2} 20 L ${total - W / 2} 40`}
          fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3"
          markerEnd="url(#gt-arrow-accent)"
        />
        <text x={total / 2} y={14} textAnchor="middle" className="dg-gold">
          gold value, fixed before any audio exists
        </text>

        <text x={0} y={126} className="dg-note">
          the only variable between conditions is the damage; the sentence, the
          voice and the gold value are identical
        </text>

        <defs>
          <marker id="gt-arrow" viewBox="0 0 8 8" refX="7" refY="4"
                  markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 1 L7 4 L0 7 z" fill="var(--rule-strong)" />
          </marker>
          <marker id="gt-arrow-accent" viewBox="0 0 8 8" refX="7" refY="4"
                  markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 1 L7 4 L0 7 z" fill="var(--accent)" />
          </marker>
        </defs>
      </svg>
    </figure>
  );
}

/* -------------------------------------------------------------------------
 * What gets scored
 * ---------------------------------------------------------------------- */

/**
 * The entity types this run actually scored, with the call each one shows up
 * on. Read from the results rather than listed by hand, so the page cannot
 * claim coverage the corpus does not have -- and so a type added to the
 * generator appears here without anyone remembering to add it.
 *
 * Why names of people and places are absent belongs in Known issues, which
 * already says it; repeating it here was the third time the page explained the
 * same omission.
 */
const WHERE: Record<string, string> = {
  account_number: "read back on a collections or servicing call",
  currency: "the amount in a payment confirmation",
  otp: "the code on a login or a transaction",
  pin_code: "the PIN a courier reads out at the door",
  date: "the due date on a reminder call",
};

export function ScoredTypes({ types }: { types: string[] }) {
  if (types.length === 0) return null;
  return (
    <div className="scored">
      <h4 className="scored__head">What counts as an entity here</h4>
      <dl className="scored__list">
        {types.map((t) => (
          <div key={t}>
            <dt>{entityNoun(t)}</dt>
            <dd>{WHERE[t] ?? "scored on exact normalised match"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Degradation conditions
 * ---------------------------------------------------------------------- */

/**
 * One block per declared condition, showing the commands that actually ran,
 * lifted from that run's manifest. Conditions with no data are shown too, and
 * marked, so the reader can see the shape of the method without mistaking a
 * described condition for a measured one.
 */
export function Conditions({
  conditions, notes,
}: { conditions: ConditionDef[]; notes: Record<string, string> }) {
  return (
    <div className="conds">
      {conditions.map((c) => (
        <section className="condblock" key={c.name}>
          <header className="condblock__head">
            <h3 className="condblock__name t-mono">{c.name}</h3>
            {c.exercised
              ? <span className="tag tag--hit">measured</span>
              : <span className="tag tag--pending">not yet measured</span>}
          </header>

          {c.description && <p className="condblock__desc">{c.description}</p>}
          {notes[c.name] && <p className="condblock__note">{notes[c.name]}</p>}

          <div className="condblock__chain">
            {c.chain.map((op, i) => (
              <span className="chip t-mono" key={i}>
                {Object.entries(op)
                  .map(([k, v]) => (k === "op" ? String(v) : `${k}=${v}`))
                  .join(" ")}
              </span>
            ))}
          </div>

          {c.commands.length > 0 ? (
            <pre className="cmd">
              {c.commands.map((cmd, i) => (
                <code key={i} className={cmd.isShell ? "" : "cmd--py"}>
                  {cmd.isShell
                    ? `$ ${cmd.argv.join(" ")}`
                    : `# ${cmd.argv.slice(1).join(" ")}`}
                  {"\n"}
                  <span className="cmd__note">{`    ${cmd.note}`}</span>
                  {"\n"}
                </code>
              ))}
            </pre>
          ) : (
            <p className="condblock__nocmd">
              No commands recorded: this condition has not been run, so there is
              no manifest to read them from.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
