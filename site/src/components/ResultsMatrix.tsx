import { conditionGroups } from "./Charts";
import type { ConditionDef, MatrixCell } from "../types";

/**
 * Entity hit rate, one table per model: entity type down the side, condition
 * across the top.
 *
 * Three distinct cell states, because "1.000", "1.000 from two samples" and
 * "never run" mean completely different things and a reader must not have to
 * infer which one they are looking at:
 *
 *   sufficient n  the rate, plainly, with the raw count beneath
 *   low n         NO rate at all -- count only, muted. A rate computed from one
 *                 or two observations is an anecdote, and printing 1.000 next
 *                 to it invites a conclusion the data cannot support
 *   not run       the condition is declared in the config but absent from this
 *                 run. Stated, never hidden, so coverage cannot be overread
 */

interface Props {
  matrix: MatrixCell[];
  conditions: ConditionDef[];
  entityTypes: string[];
  models: string[];
  lowNThreshold: number;
}

function Cell({ cell }: { cell: MatrixCell | undefined }) {
  if (!cell) return <span className="cell--norun">not run</span>;

  if (cell.lowN) {
    return (
      <span className="cell cell--lown">
        <span className="cell__rate">&mdash;</span>
        <span className="cell__n">{cell.hits}/{cell.total}</span>
      </span>
    );
  }

  const perfect = cell.hits === cell.total;
  return (
    <span className={`cell ${perfect ? "cell--ok" : "cell--miss"}`}>
      <span className="cell__rate">{cell.rate!.toFixed(3)}</span>
      <span className="cell__n">{cell.hits}/{cell.total}</span>
    </span>
  );
}

export function ResultsMatrix({
  matrix, conditions, entityTypes, models, lowNThreshold,
}: Props) {
  // Every declared condition gets a column, run or not: hiding the unrun ones
  // would quietly overstate coverage. Columns follow the same scattered-then-
  // clustered order as the chart and the ladder, so the misses gather on the
  // right instead of being scattered across the row by config order, and a
  // reader moving between the three does not have to re-learn the axis.
  const cols = [
    ...conditionGroups(conditions).flatMap((g) => g.items.map((c) => c.name)),
    ...conditions.filter((c) => !c.exercised).map((c) => c.name),
  ];
  const lookup = new Map(
    matrix.map((m) => [`${m.model}|${m.condition}|${m.entityType}`, m]));

  return (
    <>
      {models.map((model) => (
        <div key={model} className="tablewrap" style={{ marginBottom: "2.5rem" }}>
          <table>
            <caption>
              Entity hit rate &mdash; <span className="t-mono">{model}</span>.
              An entity counts as a hit only on exact normalised match.
            </caption>
            <thead>
              <tr>
                <th scope="col">entity type</th>
                {cols.map((c) => (
                  <th key={c} scope="col" style={{ textAlign: "right" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entityTypes.map((et) => (
                <tr key={et}>
                  <th scope="row" className="rowhead">{et}</th>
                  {cols.map((c) => (
                    <td key={c} className="cell-td" style={{ textAlign: "right" }}>
                      <Cell cell={lookup.get(`${model}|${c}|${et}`)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="key">
        <span className="key__item">
          <span className="key__sample cell cell--ok">
            <span className="cell__rate">0.943</span>
            <span className="cell__n">33/35</span>
          </span>
          <span>rate shown once n &ge; {lowNThreshold}</span>
        </span>
        <span className="key__item">
          <span className="key__sample cell cell--lown">
            <span className="cell__rate">&mdash;</span>
            <span className="cell__n">2/2</span>
          </span>
          <span>n &lt; {lowNThreshold}: count only, no rate</span>
        </span>
        <span className="key__item">
          <span className="key__sample cell--norun">not run</span>
          <span>declared, not yet measured</span>
        </span>
      </div>
    </>
  );
}
