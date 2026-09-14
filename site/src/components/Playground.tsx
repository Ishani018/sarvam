import { useEffect, useMemo, useState } from "react";
import { fmt, useAB } from "./useAB";
import { diffValue, entityNoun, prettyValue } from "../entityDiff";
import { groupByKind, kindOf, lossOp } from "../conditionKind";
import type {
  ConditionDef, ListenCondition, ListenEntry, ListenEntity, ListenResult,
} from "../types";

/* -------------------------------------------------------------------------
 * Selection, and the URL it lives in
 * ---------------------------------------------------------------------- */

interface Sel { u: string; c: string; m: string; }

/**
 * The selection is kept in the location hash so a specific failure can be sent
 * to someone.
 *
 * The form is `#listen?u=...&c=...&m=...`: the leading `listen` keeps the
 * header's own `#listen` link working and makes the target obvious in a pasted
 * URL, and everything after the `?` is ours. Nothing here ever throws on a
 * malformed hash -- an unknown utterance or condition simply falls back to the
 * default, because a link that half-works is better than a blank section.
 */
const HASH_PREFIX = "listen?";

function readHash(): Partial<Sel> {
  if (typeof window === "undefined") return {};
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw.startsWith(HASH_PREFIX)) return {};
  const q = new URLSearchParams(raw.slice(HASH_PREFIX.length));
  const out: Partial<Sel> = {};
  for (const k of ["u", "c", "m"] as const) {
    const v = q.get(k);
    if (v) out[k] = v;
  }
  return out;
}

/**
 * The hash as it was when the page loaded, captured at import time.
 *
 * It has to be read before React mounts: the component writes the hash as soon
 * as it renders, so anything reading `location.hash` from inside an effect sees
 * our own write and cannot tell an inbound link from a fresh visit. Under
 * StrictMode that difference is the one between landing at the top of the page
 * and being thrown into the middle of it.
 */
const INITIAL_HASH = readHash();
let restoredScroll = false;

function writeHash(sel: Sel) {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams({ u: sel.u, c: sel.c, m: sel.m });
  const next = `#${HASH_PREFIX}${q.toString()}`;
  if (window.location.hash !== next) {
    // replaceState, not assignment: changing the hash directly would push a
    // history entry for every click of the condition picker.
    window.history.replaceState(null, "", next);
  }
}

/* -------------------------------------------------------------------------
 * Marking the entity inside a sentence
 * ---------------------------------------------------------------------- */

/**
 * Surfaces are located by searching the string being rendered, not by the
 * character offsets in the data. Those offsets are into the Hindi sentence, and
 * the gloss is a different string of a different length -- reusing them there
 * underlines whatever happens to sit at the same offset.
 */
function marked(text: string, entities: ListenEntity[]) {
  const found = entities
    .map((e) => ({ e, at: text.indexOf(e.surface) }))
    .filter((x) => x.at !== -1)
    .sort((a, b) => a.at - b.at);

  const out: React.ReactNode[] = [];
  let cursor = 0;
  found.forEach(({ e }, i) => {
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

/* -------------------------------------------------------------------------
 * Waveform with a playhead
 * ---------------------------------------------------------------------- */

function Wave({ peaks, pos, live, label, marksGaps }: {
  peaks: number[] | null; pos: number; live: boolean; label: string;
  /** Whether a bucket at the floor means a dropped frame in this condition.
   *  On a take with no packet loss it means the leading silence, and marking
   *  that in rust would show damage that did not happen. */
  marksGaps: boolean;
}) {
  if (!peaks?.length) {
    return <div className="pgwave pgwave--empty">no audio in this build</div>;
  }
  const W = 600;
  const H = 44;
  const bw = W / peaks.length;
  return (
    <svg className={`pgwave ${live ? "is-live" : ""}`} viewBox={`0 0 ${W} ${H}`}
         preserveAspectRatio="none" role="img"
         aria-label={`Waveform of the ${label} audio`}>
      {peaks.map((p, i) => {
        // A bucket at the floor is a hole in the audio, not quiet speech, and
        // it gets a visible mark rather than the 1px sliver its own amplitude
        // would earn -- the holes are the whole reason this waveform is here.
        const silent = marksGaps && p <= 1;
        const h = silent ? 4 : Math.max((p / 100) * H, 1);
        return (
          <rect key={i} className={silent ? "gap" : undefined}
                x={i * bw} width={Math.max(bw - 0.6, 0.4)} rx={Math.min(bw / 2, 1.2)}
                y={(H - h) / 2} height={h} />
        );
      })}
      <line className="pgwave__head" x1={pos * W} x2={pos * W} y1={0} y2={H} />
    </svg>
  );
}

/* -------------------------------------------------------------------------
 * One model's answer
 * ---------------------------------------------------------------------- */

function Answer({ r, damaged }: { r: ListenResult; damaged: boolean }) {
  return (
    <div className="ans">
      <div className="ans__head">
        <span className="ans__model">{r.model}</span>
        <span className="ans__wer">wer {r.wer.toFixed(2)}</span>
      </div>
      <p className="ans__text deva">{r.hypothesis || "(nothing returned)"}</p>
      <div className="ans__ents">
        {r.entities.map((e, i) => {
          const parts = e.hit
            ? null
            : diffValue(prettyValue(e.expected), prettyValue(e.found ?? ""));
          return (
            <div className={`ans__ent ${e.hit ? "is-hit" : "is-miss"}`} key={i}>
              <span className="ans__flag">{e.hit ? "kept" : "lost"}</span>
              <span className="ans__type">{entityNoun(e.type)}</span>
              <span className="ans__val">
                {e.hit || !parts
                  ? prettyValue(e.expected)
                  : parts.map((p, j) =>
                      p.kind === "same"
                        ? <span key={j}>{p.text}</span>
                        : p.kind === "wrong"
                          ? <span key={j} className="ans__bad">{p.text}</span>
                          : <span key={j} className="ans__gone"
                                  title={`${p.text} never arrived`}>
                              {"·".repeat(p.text.length)}
                            </span>)}
              </span>
              {!e.hit && (
                <span className="ans__want">wanted {prettyValue(e.expected)}</span>
              )}
            </div>
          );
        })}
      </div>
      {r.error && <p className="ans__err">{r.error}</p>}
      {!damaged && r.entities.every((e) => e.hit) && (
        <p className="ans__ok">Reference: every entity recovered here.</p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * The playground
 * ---------------------------------------------------------------------- */

const lostIn = (c: ListenCondition | undefined) =>
  !!c?.results.some((r) => r.entities.some((e) => !e.hit));

/** A small disclosure: a label that turns into its own content. */
function More({ label, open, onToggle, children }: {
  label: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className={`more ${open ? "is-open" : ""}`}>
      <button type="button" className="more__btn" aria-expanded={open}
              onClick={onToggle}>
        <span className="more__sign" aria-hidden="true">{open ? "−" : "+"}</span>
        {label}
      </button>
      {open && <div className="more__body">{children}</div>}
    </div>
  );
}

/**
 * The playground, revealed in stages.
 *
 * It opens on one thing: a sentence, its gold value, and a play button. The
 * only control offered is what kind of damage to do to it. Choosing one brings
 * in the A/B, which is the best thing in the section and gets the room to say
 * so. Models, waveforms, transcripts and the sentence picker are each one
 * disclosure away -- present for a reader who reaches, absent for one who has
 * not yet asked.
 */
export function Playground({ listen: allListen, conditions, mode }: {
  listen: ListenEntry[]; conditions: ConditionDef[];
  /** Which ASR mode's transcripts to show. Every result carries its mode, and
   *  with two modes run the same (utterance, condition, model) has two
   *  transcripts; picking whichever came first in the array would show one of
   *  them and label it with neither. */
  mode: string;
}) {
  const byName = useMemo(
    () => new Map(conditions.map((c) => [c.name, c])), [conditions]);

  const listen = useMemo(
    () => allListen.map((u) => ({
      ...u,
      conditions: u.conditions.map((c) => ({
        ...c,
        results: c.results.filter((r) => (r.mode ?? "-") === mode),
      })),
    })),
    [allListen, mode],
  );

  const models = useMemo(
    () => [...new Set(listen.flatMap((u) =>
      u.conditions.flatMap((c) => c.results.map((r) => r.model))))].sort(),
    [listen]);

  // Open on a sentence that has something to find. A playground whose default
  // sentence survives everything reads as a claim that nothing goes wrong.
  const firstBroken = useMemo(
    () => listen.find((u) => u.conditions.some(lostIn)) ?? listen[0],
    [listen]);

  const [sel, setSel] = useState<Sel>(() => ({
    u: firstBroken?.utteranceId ?? "",
    // No condition chosen: the reader picks the damage, and that choice is the
    // moment the section turns from a recording into a comparison.
    c: "",
    m: "all",
    ...INITIAL_HASH,
  }));

  const [showUtts, setShowUtts] = useState(false);
  const [showWaves, setShowWaves] = useState(false);
  const [showText, setShowText] = useState(false);
  const [pickedKind, setPickedKind] = useState<string | null>(null);

  const utt = listen.find((u) => u.utteranceId === sel.u) ?? listen[0];
  const damagedConds = utt?.conditions.filter((c) => c.condition !== "clean") ?? [];
  const clean = utt?.conditions.find((c) => c.condition === "clean");
  const chosen = sel.c ? damagedConds.find((c) => c.condition === sel.c) : undefined;

  const groups = useMemo(
    () => groupByKind(conditions, damagedConds.map((c) => c.condition)),
    [conditions, damagedConds]);

  // Within a kind, offer the harshest first: a reader clicking "bursty loss"
  // wants to hear what bursty loss does, not its mildest setting.
  const worstIn = (names: string[]) =>
    names.slice().sort((a, b) => {
      const la = lostIn(damagedConds.find((c) => c.condition === a)) ? 0 : 1;
      const lb = lostIn(damagedConds.find((c) => c.condition === b)) ? 0 : 1;
      return la - lb;
    })[0];

  const shown = sel.m === "all" ? models : models.filter((m) => m === sel.m);
  const ab = useAB(clean?.audio ?? null, chosen?.audio ?? null);

  useEffect(() => {
    if (utt?.utteranceId) writeHash({ u: utt.utteranceId, c: sel.c, m: sel.m });
  }, [utt?.utteranceId, sel.c, sel.m]);

  // A link pasted into a new tab lands at the top of the page; take it to the
  // section it was pointing at. Once, and only for a hash that was in the URL
  // on arrival -- an inbound link also arrives with a condition already chosen,
  // so open the comparison rather than the resting state.
  useEffect(() => {
    if (restoredScroll || Object.keys(INITIAL_HASH).length === 0) return;
    restoredScroll = true;
    document.getElementById("listen")?.scrollIntoView({ block: "start" });
  }, []);
  useEffect(() => {
    if (INITIAL_HASH.c) {
      const def = byName.get(INITIAL_HASH.c);
      if (def) setPickedKind(kindOf(def));
    }
  }, [byName]);

  if (!utt) return null;

  const damagedLost = lostIn(chosen);
  const active = ab.side === "clean" ? clean : chosen;
  const kindGroup = groups.find((g) => g.kind === pickedKind);

  return (
    <div className={`pg ${chosen ? "pg--compare" : ""}`}>
      {/* ---- the sentence under test ------------------------------- */}
      <div className="pg__sent">
        <p className="pg__deva deva">{marked(utt.text, utt.entities)}</p>
        {utt.gloss && <p className="pg__gloss">{marked(utt.gloss, utt.entities)}</p>}
        <dl className="pg__gold">
          {utt.entities.map((e, i) => (
            <div key={i}>
              <dt>{entityNoun(e.type)}</dt>
              <dd>{prettyValue(e.normalized)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* ---- transport --------------------------------------------- */}
      <div className="pg__deck">
        <div className="pg__transport">
          <button type="button" className="pg__play" onClick={ab.toggle}
                  aria-label={ab.playing ? "Pause" : "Play"}>
            {ab.playing ? (
              <svg viewBox="0 0 10 12" width="12" height="14" aria-hidden="true">
                <rect x="0" y="0" width="3.2" height="12" rx="1.2" fill="currentColor" />
                <rect x="6.8" y="0" width="3.2" height="12" rx="1.2" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 12 13" width="12" height="14" aria-hidden="true">
                <path d="M1.5 1 L10.5 6.5 L1.5 12 Z" fill="currentColor"
                      strokeWidth="2.4" stroke="currentColor" strokeLinejoin="round" />
              </svg>
            )}
          </button>

          {chosen ? (
            <div className="pg__ab" role="group" aria-label="Which take is audible">
              <button type="button"
                      className={`ab ${ab.side === "clean" ? "is-on" : ""}`}
                      onClick={() => { if (ab.side !== "clean") ab.flip(); }}>
                A &middot; clean
              </button>
              <button type="button"
                      className={`ab ${ab.side === "damaged" ? "is-on" : ""}`}
                      onClick={() => { if (ab.side !== "damaged") ab.flip(); }}>
                B &middot; damaged
              </button>
            </div>
          ) : (
            <span className="pg__nowplaying">the clean recording</span>
          )}

          <span className="pg__time">{fmt(ab.at)} / {fmt(ab.duration)}</span>
        </div>

        <div className="pg__scrub" role="presentation"
             onClick={(e) => {
               const box = e.currentTarget.getBoundingClientRect();
               ab.seek((e.clientX - box.left) / box.width);
             }}>
          <span style={{ transform: `scaleX(${ab.pos})` }} />
        </div>

        {chosen && (
          <p className="pg__hint">
            Hearing <b>{active?.condition}</b>. Switching keeps the playhead
            where it is, so the same instant is heard both ways.
          </p>
        )}

        {clean?.audio && <audio ref={ab.cleanRef} src={clean.audio} preload="auto" />}
        {chosen?.audio && <audio ref={ab.dmgRef} src={chosen.audio} preload="auto" />}
      </div>

      {/* ---- the one control: what damage ------------------------- */}
      <div className="pg__choose">
        <p className="pg__ask">
          {chosen ? "Try another kind of damage" : "Now put it through a phone line"}
        </p>
        <div className="pg__kinds" role="group" aria-label="Choose a kind of damage">
          {groups.map((g) => {
            const on = pickedKind === g.kind;
            const name = worstIn(g.names);
            const breaks = lostIn(damagedConds.find((c) => c.condition === name));
            return (
              <button key={g.kind} type="button"
                      className={`dmg ${on ? "is-on" : ""} ${breaks ? "dmg--breaks" : ""}`}
                      aria-pressed={on}
                      onClick={() => {
                        setPickedKind(g.kind);
                        setSel((p) => ({ ...p, c: name }));
                      }}>
                <span className="dmg__name">{g.label}</span>
                <span className="dmg__blurb">{g.blurb}</span>
              </button>
            );
          })}
          {chosen && (
            <button type="button" className="dmg dmg--reset"
                    onClick={() => { setPickedKind(null); setSel((p) => ({ ...p, c: "" })); }}>
              <span className="dmg__name">Back to clean</span>
            </button>
          )}
        </div>

        {/* The specific conditions inside the chosen kind, once there is more
            than one to choose between. */}
        {chosen && kindGroup && kindGroup.names.length > 1 && (
          <div className="pg__variants">
            <span className="pg__vlab">exactly which</span>
            {kindGroup.names.map((n) => {
              const broken = lostIn(damagedConds.find((c) => c.condition === n));
              return (
                <button key={n} type="button"
                        className={`opt ${n === chosen.condition ? "is-on" : ""} ${broken ? "opt--broken" : ""}`}
                        aria-pressed={n === chosen.condition}
                        onClick={() => setSel((p) => ({ ...p, c: n }))}>
                  {n}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- the verdict, once there is a comparison --------------- */}
      {chosen && (
        <div className={`pg__verdict ${damagedLost ? "is-lost" : "is-kept"}`}>
          <span className="pg__vk">{damagedLost ? "entity lost" : "entity kept"}</span>
          <p>
            {damagedLost
              ? `Under ${chosen.condition}, at least one model no longer returns the value that was said.`
              : `Under ${chosen.condition}, every model still returns the value that was said.`}
          </p>
        </div>
      )}

      {/* ---- everything else, on request --------------------------- */}
      {chosen && (
        <div className="pg__mores">
          <More label="See the waveforms" open={showWaves}
                onToggle={() => setShowWaves((v) => !v)}>
            <div className="pg__waves">
              <div className={`pg__wrow ${ab.side === "clean" ? "is-live" : ""}`}>
                <span className="pg__wlab">A clean</span>
                <Wave peaks={clean?.peaks ?? null} pos={ab.pos}
                      live={ab.side === "clean"} label="clean" marksGaps={false} />
              </div>
              <div className={`pg__wrow ${ab.side === "damaged" ? "is-live" : ""}`}>
                <span className="pg__wlab">B {chosen.condition}</span>
                <Wave peaks={chosen.peaks} pos={ab.pos}
                      live={ab.side === "damaged"} label={chosen.condition}
                      marksGaps={!!lossOp(byName.get(chosen.condition)!)} />
              </div>
            </div>
            <p className="figcap">
              {lossOp(byName.get(chosen.condition)!)
                ? "Rust marks frames the network dropped. "
                : "This condition drops no frames; it damages the ones that arrive. "}
              {byName.get(chosen.condition)?.description}
            </p>
          </More>

          <More label="See what each model returned" open={showText}
                onToggle={() => setShowText((v) => !v)}>
            <div className="pg__models" role="group" aria-label="Choose models">
              {[...models, "all"].map((m) => (
                <button key={m} type="button"
                        className={`seg ${sel.m === m ? "is-on" : ""}`}
                        aria-pressed={sel.m === m}
                        onClick={() => setSel((p) => ({ ...p, m }))}>
                  {m === "all" ? "both" : m}
                </button>
              ))}
            </div>

            <div className="pg__out">
              <div className="pg__col">
                <h4 className="pg__colhead">
                  <span className="pg__side">A</span> clean
                  <span className="tag tag--hit">reference</span>
                </h4>
                {shown.map((m) => {
                  const r = clean?.results.find((x) => x.model === m);
                  return r
                    ? <Answer key={m} r={r} damaged={false} />
                    : <p key={m} className="pg__none">{m}: not in this run</p>;
                })}
              </div>

              <div className={`pg__col ${damagedLost ? "pg__col--lost" : ""}`}>
                <h4 className="pg__colhead">
                  <span className="pg__side">B</span> {chosen.condition}
                  {damagedLost
                    ? <span className="tag tag--miss">entity lost</span>
                    : <span className="tag tag--hit">entity kept</span>}
                </h4>
                {shown.map((m) => {
                  const r = chosen.results.find((x) => x.model === m);
                  return r
                    ? <Answer key={m} r={r} damaged />
                    : <p key={m} className="pg__none">{m}: not in this run</p>;
                })}
              </div>
            </div>
          </More>
        </div>
      )}

      <More label={`Try another sentence (${listen.length})`} open={showUtts}
            onToggle={() => setShowUtts((v) => !v)}>
        <div className="pg__utts" role="group" aria-label="Choose a sentence">
          {listen.map((u) => {
            const broken = u.conditions.some(lostIn);
            const on = u.utteranceId === utt.utteranceId;
            return (
              <button key={u.utteranceId} type="button"
                      className={`utb ${on ? "is-on" : ""}`}
                      aria-pressed={on}
                      onClick={() => setSel((p) => ({ ...p, u: u.utteranceId }))}>
                <span className="utb__types">
                  {u.entities.map((e) => entityNoun(e.type)).join(" + ")}
                </span>
                <span className="utb__id">{u.utteranceId.slice(-5)}</span>
                {broken && <span className="utb__dot" title="has failures" />}
              </button>
            );
          })}
        </div>
      </More>
    </div>
  );
}
