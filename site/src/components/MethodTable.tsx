import type { GintiData } from "../types";

/** Exact parameters of the run, read from config and run metadata. Nothing here
 *  is typed into the component; if a knob changes, this table changes. */
export function MethodTable({ data }: { data: GintiData }) {
  const asr = data.method.asr as Record<string, any> | undefined;
  const tts = data.method.tts as Record<string, any> | undefined;
  const audio = data.method.audio as Record<string, any> | undefined;
  const scoring = data.method.scoring as Record<string, any> | undefined;
  const tools = data.method.tools as Record<string, string> | undefined;

  const rows: Array<[string, React.ReactNode]> = [];
  const push = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "") return;
    rows.push([k, <span className="t-mono">{String(v)}</span>]);
  };

  push("speech-to-text endpoint", asr?.sarvam?.endpoint);
  push("models", data.models.join(", "));
  push("mode", data.modes.join(", "));
  push("text-to-speech endpoint", tts?.sarvam?.endpoint);
  push("tts model", tts?.sarvam?.model);
  push("tts speaker", tts?.sarvam?.speaker);
  push("tts sample rate", tts?.sarvam?.speech_sample_rate &&
    `${tts.sarvam.speech_sample_rate} Hz`);
  push("audio handed to asr", audio?.sample_rate &&
    `${audio.sample_rate} Hz mono ${audio.sample_format ?? ""}`);
  push("packet frame size", audio?.frame_ms && `${audio.frame_ms} ms`);
  push("corpus seed", data.method.seed);
  push("entity types scored", (scoring?.entity_types ?? []).join(", "));
  push("low-n threshold", `n < ${data.lowNThreshold} shows counts only`);
  for (const [k, v] of Object.entries(tools ?? {})) push(k, v);

  return (
    <>
      <div className="tablewrap">
        <table>
          <caption>Read from the run configuration and the degradation manifests.</caption>
          <thead>
            <tr>
              <th scope="col">parameter</th>
              <th scope="col">value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th scope="row" className="rowhead">{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="subhead">Runs on this page</h3>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th scope="col">run</th>
              <th scope="col">source</th>
              <th scope="col">conditions</th>
              <th scope="col" style={{ textAlign: "right" }}>utterances</th>
              <th scope="col" style={{ textAlign: "right" }}>rows</th>
              <th scope="col" style={{ textAlign: "right" }}>errors</th>
            </tr>
          </thead>
          <tbody>
            {data.runs.map((r) => (
              <tr key={r.runId}>
                <th scope="row" className="rowhead">{r.runId}</th>
                <td className="t-mono t-dim">{r.source}</td>
                <td className="t-mono t-dim">{r.conditions.join(", ")}</td>
                <td className="num">{r.nUtterances}</td>
                <td className="num">{r.nRows}</td>
                <td className="num" style={r.nErrors ? { color: "var(--accent)" } : undefined}>
                  {r.nErrors}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
