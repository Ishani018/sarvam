import { entityNoun } from "../entityDiff";
import type { ConditionDef } from "../types";

/* -------------------------------------------------------------------------
 * What gets scored
 * ---------------------------------------------------------------------- */

/**
 * The entity types this run actually scored, with who says each one out loud.
 * Read from the results rather than listed by hand, so the page cannot claim
 * coverage the corpus does not have -- and so a type added to the generator
 * appears here without anyone remembering to add it.
 *
 * The direction is named because it is not symmetric and it is easy to get
 * wrong. An agent reads back the last four digits of an account, never the
 * whole number: saying it aloud is the security problem the masking exists to
 * avoid. Full account numbers travel the other way, from the caller. Money,
 * dates and reference numbers are what an agent says in full. Both directions
 * are the same measurement problem -- a number has to survive a phone line --
 * which is why both are in the corpus.
 *
 * Why names of people and places are absent belongs in Known issues, which
 * already says it; repeating it here was the third time the page explained the
 * same omission.
 */
const WHERE: Record<string, string> = {
  account_number: "spoken by the caller, to identify the account",
  currency: "spoken by the agent: a balance, an instalment, an amount owed",
  otp: "spoken by the caller, to authorise a transaction",
  pin_code: "spoken by the customer to a courier at the door",
  date: "spoken by the agent: a due date on a reminder call",
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
