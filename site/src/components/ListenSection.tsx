import { AudioPlayer } from "./AudioPlayer";
import { Waveform } from "./Charts";
import type { ConditionDef, ListenEntry, ListenEntity } from "../types";

/**
 * The same sentence, clean and degraded, with what every model returned
 * underneath.
 *
 * The entity is marked inside the sentence rather than printed beside it. The
 * English gloss carries the identical surface string rather than a translation,
 * so a reader who cannot read Devanagari can still find the entity in both
 * lines.
 */

interface Props {
  listen: ListenEntry[];
  conditions: ConditionDef[];
}

/**
 * Mark each gold entity in place.
 *
 * Surfaces are located by searching the string being rendered, not by the
 * character offsets in the data. Those offsets are into the Hindi sentence, and
 * the gloss is a different string of a different length -- reusing them there
 * underlines whatever happens to sit at the same offset ("code 375", "log in").
 * The gloss carries the identical surface by construction, so a search finds it
 * in both.
 */
function marked(text: string, entities: ListenEntity[]) {
  const found = entities
    .map((e) => ({ e, at: text.indexOf(e.surface) }))
    .filter((x) => x.at !== -1)
    .sort((a, b) => a.at - b.at);

  const out: React.ReactNode[] = [];
  let cursor = 0;
  found.forEach(({ e }, i) => {
    // Re-search from the cursor so repeated surfaces mark distinct occurrences.
    const start = text.indexOf(e.surface, cursor);
    if (start === -1 || start < cursor) return;
    if (start > cursor) out.push(text.slice(cursor, start));
    out.push(
      <mark className="ent" key={`e${i}`} title={`${e.type} = ${e.normalized}`}>
        {e.surface}
      </mark>,
    );
    cursor = start + e.surface.length;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function RenderingMark({ rendering }: { rendering?: string }) {
  if (rendering !== "digits" && rendering !== "words") return null;
  return (
    <span className={`rend rend--${rendering}`}>
      returned {rendering === "digits" ? "digits" : "number words"}
    </span>
  );
}

export function ListenSection({ listen, conditions }: Props) {
  const describe = (name: string) =>
    conditions.find((c) => c.name === name)?.description ?? "";

  return (
    <>
      {listen.map((u) => (
        <article className="utt" key={u.utteranceId}>
          <header className="utt__head">
            <span className="utt__id">
              {u.utteranceId}
              {u.templateId && <> &middot; {u.templateId}</>}
              {u.realization && <> &middot; written as {u.realization}</>}
              {u.codeMixed && <> &middot; code-mixed</>}
            </span>
            <p className="utt__text deva">{marked(u.text, u.entities)}</p>
            {u.gloss && <p className="utt__gloss">{marked(u.gloss, u.entities)}</p>}
            <dl className="utt__gold">
              {u.entities.map((e, i) => (
                <div key={i}>
                  <dt>{e.type}</dt>
                  <dd className="t-mono">{e.normalized}</dd>
                </div>
              ))}
            </dl>
          </header>

          <div className="utt__grid">
            {u.conditions.map((c) => (
              <section className="cond cond--card" key={c.condition}>
                <AudioPlayer
                  src={c.audio}
                  label={c.condition}
                  hint={describe(c.condition)}
                />
                {/* Gaps punched by packet loss are visible here as well as
                    audible. Peaks are precomputed at build time. */}
                <Waveform peaks={c.peaks} label={c.condition} />

                {c.results.map((r) => (
                  <div className="hyp" key={r.model}>
                    <div className="hyp__head">
                      <span className="hyp__model t-mono">{r.model}</span>
                      {r.entities.map((e, i) => (
                        <span
                          key={i}
                          className={`tag ${e.hit ? "tag--hit" : "tag--miss"}`}
                          title={`${e.type}: expected ${e.expected}`}
                        >
                          {e.hit ? "kept" : "lost"} {e.type}
                        </span>
                      ))}
                    </div>
                    <p className="hyp__text deva">{r.hypothesis || "(empty)"}</p>
                    <div className="hyp__foot">
                      {r.entities.map((e, i) => (
                        <RenderingMark key={i} rendering={e.rendering} />
                      ))}
                      {r.entities.some((e) => !e.hit) && (
                        <span className="hyp__got">
                          got <span className="t-mono">
                            {r.entities.find((e) => !e.hit)?.found ?? "nothing"}
                          </span>
                        </span>
                      )}
                      {r.error && <span className="hyp__err">{r.error}</span>}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </article>
      ))}
    </>
  );
}
