import { useState } from "react";
import { AudioPlayer } from "./AudioPlayer";
import { Waveform } from "./Charts";
import { Reveal } from "./Reveal";
import type { ConditionDef, ListenEntry, ListenEntity, ListenCondition } from "../types";

/**
 * The same sentence, clean and degraded, with what every model returned
 * underneath.
 *
 * One card per utterance. The clean take is pinned on the left as the control
 * and the reader picks which damage to hear against it, rather than scrolling
 * past ten players per sentence: the comparison is the point, and a stack of
 * ten cannot be compared.
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

/** One take: the player, the damage, and every model's transcript of it. */
function Take({
  c, hint, role,
}: { c: ListenCondition; hint: string; role: "control" | "damaged" }) {
  const lost = c.results.some((r) => r.entities.some((e) => !e.hit));
  return (
    <div className={`take take--${role} ${lost ? "take--lost" : ""}`}>
      <div className="take__head">
        <span className="take__role">
          {role === "control" ? "control" : "degraded"}
        </span>
        <span className="take__cond">{c.condition}</span>
        {lost
          ? <span className="tag tag--miss">entity lost</span>
          : <span className="tag tag--hit">entity kept</span>}
      </div>

      <AudioPlayer src={c.audio} label={c.condition} hint={hint} />
      {/* Gaps punched by packet loss are visible here as well as audible.
          Peaks are precomputed at build time. */}
      <Waveform peaks={c.peaks} label={c.condition} />

      <div className="take__hyps">
        {c.results.map((r) => {
          const miss = r.entities.find((e) => !e.hit);
          return (
            <div className="hyp" key={r.model}>
              <div className="hyp__head">
                <span className="hyp__model">{r.model}</span>
                <span className="hyp__wer">wer {r.wer.toFixed(2)}</span>
              </div>
              <p className="hyp__text deva">{r.hypothesis || "(empty)"}</p>
              <div className="hyp__foot">
                {r.entities.map((e, i) => (
                  <span key={i} className={`pill ${e.hit ? "pill--hit" : "pill--miss"}`}>
                    <span className="pill__t">{e.type}</span>
                    <span className="pill__v">{e.hit ? e.expected : (e.found ?? "nothing")}</span>
                  </span>
                ))}
                {miss && (
                  <span className="hyp__want">
                    wanted <b>{miss.expected}</b>
                  </span>
                )}
                {r.error && <span className="hyp__err">{r.error}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Utterance({ u, describe }: {
  u: ListenEntry; describe: (n: string) => string;
}) {
  const clean = u.conditions.find((c) => c.condition === "clean");
  const others = u.conditions.filter((c) => c !== clean);
  // Open on the first take that actually loses something, so the card shows the
  // interesting comparison before the reader has to hunt for it.
  const firstLoss = others.find((c) =>
    c.results.some((r) => r.entities.some((e) => !e.hit)));
  const [pick, setPick] = useState(
    (firstLoss ?? others[0])?.condition ?? "");
  const chosen = others.find((c) => c.condition === pick) ?? others[0];

  return (
    <Reveal as="section" className="utt">
      <header className="utt__head">
        <div className="utt__meta">
          <span className="utt__id">{u.utteranceId}</span>
          {u.domain && <span className="utt__chip">{u.domain}</span>}
          {u.realization && <span className="utt__chip">written as {u.realization}</span>}
          {u.codeMixed && <span className="utt__chip">code-mixed</span>}
        </div>

        <p className="utt__text deva">{marked(u.text, u.entities)}</p>
        {u.gloss && <p className="utt__gloss">{marked(u.gloss, u.entities)}</p>}

        <dl className="utt__gold">
          {u.entities.map((e, i) => (
            <div key={i}>
              <dt>{e.type}</dt>
              <dd>{e.normalized}</dd>
            </div>
          ))}
        </dl>
      </header>

      {others.length > 0 && (
        <div className="utt__picker" role="group" aria-label="Choose a condition">
          {others.map((c) => {
            const lost = c.results.some((r) => r.entities.some((e) => !e.hit));
            return (
              <button key={c.condition} type="button"
                      className={`pick ${c.condition === chosen?.condition ? "is-on" : ""} ${lost ? "pick--lost" : ""}`}
                      aria-pressed={c.condition === chosen?.condition}
                      onClick={() => setPick(c.condition)}>
                {c.condition}
              </button>
            );
          })}
        </div>
      )}

      <div className="utt__takes">
        {clean && <Take c={clean} hint={describe(clean.condition)} role="control" />}
        {chosen && <Take c={chosen} hint={describe(chosen.condition)} role="damaged" />}
      </div>
    </Reveal>
  );
}

export function ListenSection({ listen, conditions }: Props) {
  const describe = (name: string) =>
    conditions.find((c) => c.name === name)?.description ?? "";

  return (
    <div className="listen">
      {listen.map((u) => (
        <Utterance key={u.utteranceId} u={u} describe={describe} />
      ))}
    </div>
  );
}
