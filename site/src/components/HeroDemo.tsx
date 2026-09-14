import { fmt, useAB } from "./useAB";
import { diffValue, entityNoun, prettyValue } from "../entityDiff";
import type { HeroExample } from "../conditionKind";
import type { GintiData, ListenCondition } from "../types";

/**
 * The argument, audible, in one interaction and before any scrolling.
 *
 * One sentence, two takes, one control. A reader presses swap and hears the
 * damage; underneath, the value each take returned. That is the whole page in
 * eight seconds, and it is the only thing on the right of the hero.
 *
 * Deliberately not a second hero: no waveforms, no condition picker, no model
 * toggle, no transcripts. All of that is in the playground and the link says
 * so. Everything here is derived -- the utterance is whichever one
 * pickHeroExample chose, which prefers a damaged take that returned a
 * same-length wrong value, since that is the failure worth hearing.
 */
/** The three things the demo needs, or null. Exported because the hero has to
 *  know whether the right column will have anything in it before it decides to
 *  be two columns -- a build with no bundled audio is one column, not one
 *  column and a hole. */
export function heroDemoTakes(data: GintiData, ex: HeroExample | null) {
  if (!ex) return null;
  const utt = data.listen.find((u) => u.utteranceId === ex.utteranceId);
  const clean = utt?.conditions.find((c) => c.condition === "clean");
  const dmg = utt?.conditions.find((c) => c.condition === ex.condition);
  if (!utt || !clean?.audio || !dmg?.audio) return null;
  return { utt, clean, dmg };
}

export function HeroDemo({ data, ex }: { data: GintiData; ex: HeroExample }) {
  const takes = heroDemoTakes(data, ex);
  const ab = useAB(takes?.clean.audio ?? null, takes?.dmg.audio ?? null);

  // No audio in this build means no demo. The hero still has its numbers.
  if (!takes) return null;
  const { utt, clean, dmg } = takes;

  // Model AND mode: the example was chosen from one mode's transcripts, so
  // the value shown beside it has to come from the same one.
  const valueFrom = (c: ListenCondition) =>
    c.results.find((r) => r.model === ex.model && (r.mode ?? "-") === ex.mode)
      ?.entities.find((e) => e.type === ex.entityType && e.expected === ex.expected);

  const heard = valueFrom(dmg);
  const parts = diffValue(prettyValue(ex.expected), prettyValue(ex.found));

  return (
    <figure className="demo">
      <figcaption className="demo__cap">
        One sentence from the run, both ways
      </figcaption>

      <p className="demo__deva deva">{utt.text}</p>

      <div className="demo__transport">
        <button type="button" className="demo__play" onClick={ab.toggle}
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

        <div className="demo__ab" role="group" aria-label="Which take is audible">
          <button type="button"
                  className={`dab ${ab.side === "clean" ? "is-on" : ""}`}
                  onClick={() => { if (ab.side !== "clean") ab.flip(); }}>
            clean line
          </button>
          <button type="button"
                  className={`dab ${ab.side === "damaged" ? "is-on" : ""}`}
                  onClick={() => { if (ab.side !== "damaged") ab.flip(); }}>
            bad line
          </button>
        </div>

        <span className="demo__time">{fmt(ab.at)} / {fmt(ab.duration)}</span>
      </div>

      <div className="demo__scrub" role="presentation"
           onClick={(e) => {
             const box = e.currentTarget.getBoundingClientRect();
             ab.seek((e.clientX - box.left) / box.width);
           }}>
        <span style={{ transform: `scaleX(${ab.pos})` }} />
      </div>

      <dl className="demo__vals">
        <div>
          <dt>the {entityNoun(ex.entityType)} spoken</dt>
          <dd>{prettyValue(ex.expected)}</dd>
        </div>
        <div className="demo__vals--keep">
          <dt>heard on a clean line</dt>
          <dd>{prettyValue(ex.expected)}</dd>
        </div>
        <div className="demo__vals--lose">
          <dt>heard on a bad line</dt>
          <dd>
            {parts.map((p, i) =>
              p.kind === "same"
                ? <span key={i}>{p.text}</span>
                : p.kind === "wrong"
                  ? <span key={i} className="demo__bad">{p.text}</span>
                  : <span key={i} className="demo__gone"
                          title={`${p.text} never arrived`}>
                      {"·".repeat(p.text.length)}
                    </span>,
            )}
          </dd>
        </div>
      </dl>

      <p className="demo__note">
        {heard && !heard.hit && ex.sameShape
          ? `Right length, right shape, still a valid ${entityNoun(ex.entityType)}. Nothing downstream can tell it is the wrong one.`
          : `Silently truncated, and what is left is still all digits.`}{" "}
        <a href={`#listen?u=${encodeURIComponent(ex.utteranceId)}&c=${encodeURIComponent(ex.condition)}&m=all`}>
          Hear all of them
        </a>
      </p>

      <audio ref={ab.cleanRef} src={clean.audio ?? undefined} preload="auto" />
      <audio ref={ab.dmgRef} src={dmg.audio ?? undefined} preload="auto" />
    </figure>
  );
}
