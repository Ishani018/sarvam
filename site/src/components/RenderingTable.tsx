import type { RenderingRow, WerRow } from "../types";

/**
 * How each side chose to write the number, and the word error rate that follows
 * from that choice alone.
 *
 * This is an observation about metrics and about output formatting. It is not a
 * claim about transcription accuracy, and at a small sample size it could not
 * be: in the calibration run every entity was recovered correctly by both
 * models, and only the spelling of the number differed.
 *
 * Two views, because the useful one changes with corpus size. At a handful of
 * utterances every row is worth reading. At forty across nine conditions the
 * full listing is several hundred rows of mostly-agreement, so the cross-tab
 * carries the shape and the listing narrows to the rows that disagree.
 */

interface Props {
  rendering: RenderingRow[];
  wer: WerRow[];
  models: string[];
}

/** Above this many rows, list only the disagreements. */
const FULL_LISTING_MAX = 24;

const FORMS = ["digits", "words", "absent"] as const;

function Tag({ value, warn }: { value: string; warn: boolean }) {
  return <span className={`tag ${warn ? "tag--warn" : "tag--hit"}`}>{value}</span>;
}

function disagrees(row: RenderingRow) {
  return new Set(row.models.map((m) => m.rendering)).size > 1;
}

export function RenderingTable({ rendering, wer, models }: Props) {
  const byModel = (row: RenderingRow, model: string) =>
    row.models.find((m) => m.model === model);

  const disagreeing = rendering.filter(disagrees);

  // One model, same utterance, different rendering once the codec is applied.
  const selfFlips = (() => {
    const seen = new Map<string, Set<string>>();
    for (const r of rendering) {
      for (const m of r.models) {
        const k = `${r.utteranceId}|${m.model}`;
        if (!seen.has(k)) seen.set(k, new Set());
        seen.get(k)!.add(m.rendering);
      }
    }
    return [...seen.entries()].filter(([, v]) => v.size > 1).map(([k]) => k);
  })();

  // Cross-tab: given how the reference wrote the number, how did each model?
  const crosstab = models.map((model) => {
    const cells: Record<string, Record<string, number>> = {};
    for (const r of rendering) {
      const ref = r.referenceRendering ?? "?";
      const got = byModel(r, model)?.rendering ?? "?";
      cells[ref] ??= {};
      cells[ref][got] = (cells[ref][got] ?? 0) + 1;
    }
    return { model, cells };
  });
  const refForms = [...new Set(rendering.map((r) => r.referenceRendering ?? "?"))].sort();

  const full = rendering.length <= FULL_LISTING_MAX;
  const listed = full
    ? rendering
    : [...disagreeing]
        .sort((a, b) => {
          const spread = (r: RenderingRow) => {
            const w = r.models.map((m) => m.wer);
            return Math.max(...w) - Math.min(...w);
          };
          return spread(b) - spread(a);
        })
        .slice(0, FULL_LISTING_MAX);

  return (
    <>
      <h3 className="subhead">Reference form against model form</h3>
      <div className="tablewrap">
        <table>
          <caption>
            Counts over {rendering.length} scored (utterance, condition) pairs.
            Rows are how the generator wrote the number; columns are how the
            model wrote it back.
          </caption>
          <thead>
            <tr>
              <th scope="col">model</th>
              <th scope="col">reference wrote</th>
              {FORMS.map((f) => (
                <th key={f} scope="col" style={{ textAlign: "right" }}>
                  model wrote {f}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {crosstab.flatMap(({ model, cells }) =>
              refForms.map((ref, i) => (
                <tr key={`${model}-${ref}`}>
                  <th scope="row" className="rowhead">{i === 0 ? model : ""}</th>
                  <td><Tag value={ref} warn={false} /></td>
                  {FORMS.map((f) => {
                    const n = cells[ref]?.[f] ?? 0;
                    const changed = n > 0 && f !== ref;
                    return (
                      <td key={f} className="num"
                          style={changed ? { color: "var(--accent)" } : undefined}>
                        {n === 0 ? <span className="t-dim">·</span> : n}
                      </td>
                    );
                  })}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <div className="key">
        <span className="key__item">
          <span className="key__sample num" style={{ color: "var(--accent)" }}>n</span>
          <span>model rewrote the number into the other form</span>
        </span>
      </div>

      {listed.length > 0 && <>
      <h3 className="subhead">
        {full ? "Every scored pair" : "Rows where the models disagreed"}
      </h3>
      <div className="tablewrap">
        <table>
          <caption>
            {full
              ? `All ${rendering.length} pairs.`
              : `${listed.length} of ${disagreeing.length} disagreements, widest word error rate gap first. ${rendering.length} pairs in total.`}
          </caption>
          <thead>
            <tr>
              <th scope="col">utterance</th>
              <th scope="col">condition</th>
              <th scope="col">entity</th>
              <th scope="col">reference</th>
              {models.map((m) => <th key={m} scope="col">{m}</th>)}
              {models.map((m) => (
                <th key={`${m}-w`} scope="col" style={{ textAlign: "right" }}>
                  wer {m.replace("saaras:", "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {listed.map((r) => {
              const warn = disagrees(r);
              return (
                <tr key={`${r.utteranceId}-${r.condition}-${r.entityType}`}>
                  <th scope="row" className="rowhead">{r.utteranceId.slice(-5)}</th>
                  <td className="t-mono t-dim nowrap">{r.condition}</td>
                  <td className="t-mono t-dim nowrap">{r.entityType}</td>
                  <td><Tag value={r.referenceRendering ?? "?"} warn={false} /></td>
                  {models.map((m) => {
                    const mm = byModel(r, m);
                    return (
                      <td key={m}>
                        {mm ? <Tag value={mm.rendering} warn={warn} />
                            : <span className="t-dim">&mdash;</span>}
                      </td>
                    );
                  })}
                  {models.map((m) => {
                    const mm = byModel(r, m);
                    return (
                      <td key={`${m}-w`} className="num"
                          style={(mm?.wer ?? 0) >= 1 ? { color: "var(--accent)" } : undefined}>
                        {mm ? mm.wer.toFixed(3) : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="key">
        {models.length > 1 && (
          <span className="key__item">
            <span className="key__sample"><Tag value="digits" warn /></span>
            <span>models disagreed ({disagreeing.length} of {rendering.length} pairs)</span>
          </span>
        )}
        {selfFlips.length > 0 && (
          <span className="key__item">
            <span className="key__sample" />
            <span>
              {selfFlips.length} case{selfFlips.length === 1 ? "" : "s"} where one
              model changed its own rendering between conditions
            </span>
          </span>
        )}
      </div>
      </>}

      <h3 className="subhead">Mean word error rate</h3>
      <div className="tablewrap">
        <table>
          <caption>
            Read alongside the entity hit rate above, not instead of it.
          </caption>
          <thead>
            <tr>
              <th scope="col">model</th>
              <th scope="col">condition</th>
              <th scope="col" style={{ textAlign: "right" }}>mean wer</th>
              <th scope="col" style={{ textAlign: "right" }}>n</th>
            </tr>
          </thead>
          <tbody>
            {wer.map((w) => (
              <tr key={`${w.model}-${w.condition}`}>
                <th scope="row" className="rowhead">{w.model}</th>
                <td className="t-mono t-dim">{w.condition}</td>
                <td className="num"
                    style={w.wer >= 1 ? { color: "var(--accent)" } : undefined}>
                  {w.wer.toFixed(3)}
                </td>
                <td className="num t-dim">{w.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
