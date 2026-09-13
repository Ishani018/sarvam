import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * Transport: two takes, one playhead
 * ---------------------------------------------------------------------- */

const fmt = (s: number) =>
  Number.isFinite(s)
    ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
    : "--:--";

/**
 * Plays the clean take and the damaged take against one shared position.
 *
 * A/B swaps which one is audible without moving the playhead, so the reader
 * compares the two rather than remembering the first while the second plays.
 * Both elements are kept loaded; only the active one runs.
 */
function useAB(cleanSrc: string | null, dmgSrc: string | null) {
  const cleanRef = useRef<HTMLAudioElement | null>(null);
  const dmgRef = useRef<HTMLAudioElement | null>(null);
  const [side, setSide] = useState<"clean" | "damaged">("clean");
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [duration, setDuration] = useState(NaN);

  const active = useCallback(
    () => (side === "clean" ? cleanRef.current : dmgRef.current), [side]);
  const other = useCallback(
    () => (side === "clean" ? dmgRef.current : cleanRef.current), [side]);

  // A new utterance or condition means new audio: stop, and rewind, or the
  // playhead sits somewhere in the middle of a clip the reader never started.
  useEffect(() => {
    [cleanRef.current, dmgRef.current].forEach((el) => {
      if (el) { el.pause(); el.currentTime = 0; }
    });
    setPlaying(false);
    setAt(0);
  }, [cleanSrc, dmgSrc]);

  useEffect(() => {
    const el = active();
    if (!el) return;
    const onTime = () => setAt(el.currentTime);
    const onMeta = () => setDuration(el.duration);
    const onEnd = () => { setPlaying(false); setAt(0); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    if (Number.isFinite(el.duration)) setDuration(el.duration);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [active, cleanSrc, dmgSrc]);

  const toggle = () => {
    const el = active();
    if (!el) return;
    if (el.paused) void el.play(); else el.pause();
  };

  const flip = () => {
    const from = active();
    const to = other();
    if (!from || !to) { setSide((s) => (s === "clean" ? "damaged" : "clean")); return; }
    const t = from.currentTime;
    const wasPlaying = !from.paused;
    from.pause();
    to.currentTime = Math.min(t, Number.isFinite(to.duration) ? to.duration : t);
    setSide((s) => (s === "clean" ? "damaged" : "clean"));
    if (wasPlaying) void to.play();
  };

  const seek = (frac: number) => {
    const el = active();
    if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = frac * el.duration;
    setAt(el.currentTime);
  };

  const pos = Number.isFinite(duration) && duration > 0 ? at / duration : 0;
  return { cleanRef, dmgRef, side, setSide, playing, at, duration, pos,
           toggle, flip, seek };
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

export function Playground({ listen, conditions }: {
  listen: ListenEntry[]; conditions: ConditionDef[];
}) {
  const byName = useMemo(
    () => new Map(conditions.map((c) => [c.name, c])), [conditions]);

  // Default to a broken example rather than a working one: the reader came to
  // see a failure, and a playground that opens on a perfect result reads as a
  // claim that nothing goes wrong.
  const fallback = useMemo<Sel>(() => {
    for (const u of listen) {
      for (const c of u.conditions) {
        const def = byName.get(c.condition);
        if (def && kindOf(def) === "bursty" && lostIn(c)) {
          return { u: u.utteranceId, c: c.condition, m: "all" };
        }
      }
    }
    const first = listen[0];
    const firstDamaged = first?.conditions.find((c) => c.condition !== "clean");
    return {
      u: first?.utteranceId ?? "",
      c: firstDamaged?.condition ?? first?.conditions[0]?.condition ?? "",
      m: "all",
    };
  }, [listen, byName]);

  const [sel, setSel] = useState<Sel>(() => ({ ...fallback, ...INITIAL_HASH }));

  const utt = listen.find((u) => u.utteranceId === sel.u) ?? listen[0];
  const damagedConds = utt?.conditions.filter((c) => c.condition !== "clean") ?? [];
  const clean = utt?.conditions.find((c) => c.condition === "clean");
  const chosen =
    damagedConds.find((c) => c.condition === sel.c) ?? damagedConds[0];

  const models = useMemo(
    () => [...new Set(listen.flatMap((u) =>
      u.conditions.flatMap((c) => c.results.map((r) => r.model))))].sort(),
    [listen]);
  const shown = sel.m === "all" ? models : models.filter((m) => m === sel.m);

  // The hash follows what is actually on screen, not what was asked for: a
  // stale link naming a condition this run does not have still produces a
  // shareable URL for what the reader ended up seeing.
  const live: Sel = {
    u: utt?.utteranceId ?? "",
    c: chosen?.condition ?? "",
    m: sel.m,
  };
  useEffect(() => { if (live.u && live.c) writeHash(live); },
    [live.u, live.c, live.m]);

  // A link pasted into a new tab lands at the top of the page; take it to the
  // section it was pointing at. Once, and only for a hash that was actually in
  // the URL on arrival.
  useEffect(() => {
    if (restoredScroll || Object.keys(INITIAL_HASH).length === 0) return;
    restoredScroll = true;
    document.getElementById("listen")?.scrollIntoView({ block: "start" });
  }, []);

  const ab = useAB(clean?.audio ?? null, chosen?.audio ?? null);
  const groups = useMemo(
    () => groupByKind(conditions, damagedConds.map((c) => c.condition)),
    [conditions, damagedConds]);

  const openKind = chosen ? kindOf(byName.get(chosen.condition)!) : null;
  const [expanded, setExpanded] = useState<string | null>(openKind);
  useEffect(() => { setExpanded(openKind); }, [openKind]);

  if (!utt || !chosen) return null;

  const active = ab.side === "clean" ? clean : chosen;
  const damagedLost = lostIn(chosen);

  return (
    <div className="pg">
      {/* ---- utterance selector -------------------------------------- */}
      <div className="pg__bar">
        <span className="pg__lab">Sentence</span>
        <div className="pg__utts" role="group" aria-label="Choose a sentence">
          {listen.map((u) => {
            const broken = u.conditions.some(lostIn);
            const on = u.utteranceId === utt.utteranceId;
            return (
              <button key={u.utteranceId} type="button"
                      className={`utb ${on ? "is-on" : ""}`}
                      aria-pressed={on}
                      onClick={() => setSel((s) => ({ ...s, u: u.utteranceId }))}>
                <span className="utb__types">
                  {u.entities.map((e) => entityNoun(e.type)).join(" + ")}
                </span>
                <span className="utb__id">{u.utteranceId.slice(-5)}</span>
                {broken && <span className="utb__dot" title="has failures" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- condition selector, grouped ----------------------------- */}
      <div className="pg__bar">
        <span className="pg__lab">Damage</span>
        <div className="pg__kinds">
          {groups.map((g) => {
            const open = expanded === g.kind;
            const holds = g.names.includes(chosen.condition);
            return (
              <div className={`kind ${open ? "is-open" : ""} ${holds ? "is-holding" : ""}`}
                   key={g.kind}>
                <button type="button" className="kind__head"
                        aria-expanded={open}
                        onClick={() => setExpanded(open ? null : g.kind)}>
                  <span className="kind__name">{g.label}</span>
                  <span className="kind__n">{g.names.length}</span>
                </button>
                {open && (
                  <div className="kind__body">
                    <p className="kind__blurb">{g.blurb}</p>
                    <div className="kind__opts">
                      {g.names.map((n) => {
                        const c = damagedConds.find((x) => x.condition === n);
                        const broken = lostIn(c);
                        return (
                          <button key={n} type="button"
                                  className={`opt ${n === chosen.condition ? "is-on" : ""} ${broken ? "opt--broken" : ""}`}
                                  aria-pressed={n === chosen.condition}
                                  onClick={() => setSel((s) => ({ ...s, c: n }))}>
                            {n}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- model toggle -------------------------------------------- */}
      <div className="pg__bar">
        <span className="pg__lab">Model</span>
        <div className="pg__models" role="group" aria-label="Choose models">
          {[...models, "all"].map((m) => (
            <button key={m} type="button"
                    className={`seg ${sel.m === m ? "is-on" : ""}`}
                    aria-pressed={sel.m === m}
                    onClick={() => setSel((s) => ({ ...s, m }))}>
              {m === "all" ? "both, side by side" : m}
            </button>
          ))}
        </div>
      </div>

      {/* ---- the sentence -------------------------------------------- */}
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

      {/* ---- transport ----------------------------------------------- */}
      <div className="pg__deck">
        <div className="pg__transport">
          <button type="button" className="pg__play" onClick={ab.toggle}
                  aria-label={ab.playing ? "Pause" : "Play"}>
            {ab.playing ? (
              <svg viewBox="0 0 10 12" width="11" height="13" aria-hidden="true">
                <rect x="0" y="0" width="3.2" height="12" fill="currentColor" />
                <rect x="6.8" y="0" width="3.2" height="12" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 10 12" width="11" height="13" aria-hidden="true">
                <path d="M0 0 L10 6 L0 12 Z" fill="currentColor" />
              </svg>
            )}
          </button>

          <div className="pg__ab" role="group" aria-label="Which take is audible">
            <button type="button"
                    className={`ab ${ab.side === "clean" ? "is-on" : ""}`}
                    onClick={() => { if (ab.side !== "clean") ab.flip(); }}>
              A &middot; clean
            </button>
            <button type="button"
                    className={`ab ${ab.side === "damaged" ? "is-on" : ""}`}
                    onClick={() => { if (ab.side !== "damaged") ab.flip(); }}>
              B &middot; {chosen.condition}
            </button>
            <button type="button" className="ab ab--swap" onClick={ab.flip}
                    title="Swap without moving the playhead">
              swap
            </button>
          </div>

          <span className="pg__time">{fmt(ab.at)} / {fmt(ab.duration)}</span>
        </div>

        <div className="pg__scrub" role="presentation"
             onClick={(e) => {
               const box = e.currentTarget.getBoundingClientRect();
               ab.seek((e.clientX - box.left) / box.width);
             }}>
          <span style={{ transform: `scaleX(${ab.pos})` }} />
        </div>

        <p className="pg__hint">
          Playing <b>{active?.condition}</b>. Swap keeps the playhead where it
          is, so the same instant is heard both ways.
        </p>

        {/* ---- waveforms, aligned ------------------------------------ */}
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

        {clean?.audio && <audio ref={ab.cleanRef} src={clean.audio} preload="auto" />}
        {chosen.audio && <audio ref={ab.dmgRef} src={chosen.audio} preload="auto" />}
      </div>

      {/* ---- what came back ------------------------------------------ */}
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
    </div>
  );
}
