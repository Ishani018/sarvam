import { Reveal } from "./Reveal";
import { KIND_LABEL, kindOf, type Kind } from "../conditionKind";
import { entityNoun } from "../entityDiff";
import type { CueCondition, GintiData } from "../types";

/** "a, b and c" -- an Oxford-less list, because these are read as prose. */
function list(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** Entity nouns are singular ("one-time code"); counts here are usually not. */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * The second thing a burst takes.
 *
 * Every other measurement on this page asks whether the digits arrived. A
 * number in speech carries two things and only one of them is digits: "चौदह
 * सौ रुपये" is a value, and a word saying the value is money. Packet loss
 * removes 20 ms windows and does not know the difference.
 *
 * An *orphan* here is a value that reached the transcript with nothing left in
 * it to say what kind of number it is. It is a fact about the transcript, not
 * a verdict on the extractor -- counted whether or not ours recovered the
 * entity anyway, with the two reported separately, because they answer
 * different questions: how often the line strips a number of its identity, and
 * how much any cue-based parser downstream would suffer for it.
 *
 * Everything is derived from the cue sidecar. With no sidecar the section does
 * not render rather than approximating: the cue lexicon lives in the harness,
 * and a second copy of it in the site build would drift without anyone
 * noticing.
 */
export function CueSurvival({ data }: { data: GintiData }) {
  const cues = data.cues;
  if (!cues) return null;

  // One mode at a time. Transcribe is the honest default when both are
  // present: it is the mode every other number on this page comes from.
  const mode = "transcribe" in cues.byMode
    ? "transcribe" : Object.keys(cues.byMode)[0];
  const fig = cues.byMode[mode];
  if (!fig || fig.conditions.length === 0) return null;

  const kindByName = new Map(data.conditions.map((c) => [c.name, kindOf(c)]));
  const kindOfRow = (r: CueCondition): Kind => kindByName.get(r.condition) ?? "clean";

  // Ordered worst-first by orphan rate, because the claim is about which
  // conditions produce them, and a reader should not have to hunt.
  const rate = (r: CueCondition) =>
    r.valuePresent ? r.orphans / r.valuePresent : 0;
  const rows = [...fig.conditions].sort((a, b) => rate(b) - rate(a));
  const worst = Math.max(...rows.map(rate), 0.0001);

  const bursty = rows.filter((r) => kindOfRow(r) === "bursty");
  const inBursty = bursty.reduce((a, r) => a + r.orphans, 0);
  const clean = rows.filter((r) => kindOfRow(r) !== "bursty" && r.orphans === 0);

  // The cue figure only means something beside the ordinary-word figure and
  // beside clean, which is nowhere near 1.0: a recogniser answering रुपये with
  // ₹, or खाते with खाता, has not lost the cue but has not returned the word
  // either. The gap between the two columns is the part that is damage.
  const cleanRow = rows.find((r) => kindOfRow(r) === "clean")
    ?? [...rows].sort((a, b) => (b.cueSurvival ?? 0) - (a.cueSurvival ?? 0))[0];
  const worstBursty = bursty.length
    ? bursty.reduce((a, b) => ((a.cueSurvival ?? 1) <= (b.cueSurvival ?? 1) ? a : b))
    : null;

  // Currency cannot be typed by shape -- any length can be an amount -- so it
  // is the type a lost cue actually costs. That it shows zero here is the
  // finding's sharper half, not its absence: see below.
  const unshaped = Object.entries(fig.orphansByType)
    .filter(([t]) => !fig.shapedTypes.includes(t));
  const shaped = Object.entries(fig.orphansByType)
    .filter(([t]) => fig.shapedTypes.includes(t));

  const pct = (x: number | null) => (x === null ? "—" : x.toFixed(3));

  return (
    <>
      <Reveal className="prose lede">
        <p>
          A number read aloud carries two things, and only one of them is
          digits: an amount is a value <em>and</em> a word saying the value is
          money. Loss does not know the difference. Measured over the same
          transcripts, {fig.totals.orphans} values arrived intact with nothing
          left beside them to say what kind of number they were &mdash; and{" "}
          {inBursty} of those {fig.totals.orphans} fall in the{" "}
          {bursty.length === 1
            ? "one bursty condition"
            : `${bursty.length} bursty conditions`}.
          {clean.length > 0 && (
            <> {list(clean.map((r) => r.condition))} produced none.</>
          )}
        </p>
      </Reveal>

      <Reveal className="cue">
        <div className="cue__rows">
          {rows.map((r) => {
            const k = kindOfRow(r);
            const v = rate(r);
            return (
              <div className={`cue__row cue__row--${k}`} key={r.condition}>
                <span className="cue__name">
                  {r.condition}
                  <i>{KIND_LABEL[k]}</i>
                </span>
                <span className="cue__track">
                  <span className="cue__fill" style={{ width: `${(v / worst) * 100}%` }} />
                </span>
                <span className="cue__n">
                  {r.orphans}<i>/{r.valuePresent}</i>
                </span>
                <span className="cue__sur">
                  <b>{pct(r.cueSurvival)}</b>
                  <i>{pct(r.wordSurvival)}</i>
                </span>
              </div>
            );
          })}
        </div>

        <p className="figcap">
          Values that reached the transcript with no surviving word identifying
          their type, as a share of the values that arrived at all. The right
          pair is the survival rate of type-identifying words against the
          survival rate of every other word in the same sentence
          {cleanRow && cleanRow.cueSurvival !== null && (
            <> &mdash; and the clean row sits at {pct(cleanRow.cueSurvival)}, not
              at 1.0, because a recogniser that answers रुपये with ₹ has kept
              the cue without returning the word. The gap between the two
              columns is the part that is damage, not vocabulary</>
          )}.
          {cleanRow && worstBursty && cleanRow.cueSurvival !== null
            && worstBursty.cueSurvival !== null && (
            <> Cue survival falls from {pct(cleanRow.cueSurvival)} on clean
              audio to {pct(worstBursty.cueSurvival)} under{" "}
              {worstBursty.condition}.</>
          )}
        </p>
      </Reveal>

      <Reveal className="cue__split">
        <section>
          <h4 className="minihead">Which types a lost cue costs</h4>
          <p>
            A type with a characteristic length survives losing its cue: an
            eleven-digit run is still an account number with nothing around it.
            {shaped.length > 0 && (
              <>
                {" "}All {shaped.reduce((a, [, n]) => a + n, 0)} orphans here are
                of that kind &mdash;{" "}
                {list(shaped.map(([t, n]) => plural(n, entityNoun(t))))}{" "}
                &mdash; and {fig.totals.orphans - fig.totals.orphansUnrecovered}{" "}
                of them were recovered anyway from digit length alone.
              </>
            )}
          </p>
          <p>
            An amount has no such length. Any number of digits can be money, so
            when the word beside it dies there is nothing left to type it, and
            a parser reading that transcript cannot tell an amount from a
            reference number.
            {unshaped.length === 0 && mode === "transcribe" && (
              <> That this table shows no amounts is the point of the next
                paragraph, not evidence against it.</>
            )}
          </p>
        </section>

        <section>
          <h4 className="minihead">Why {mode} mode hides it</h4>
          <p>
            These figures come from <b>{mode}</b> mode, which applies the
            recogniser&rsquo;s own number normalisation: an amount comes back
            written <span className="mono">₹1400</span> whether or not the
            speaker&rsquo;s रुपये survived the line. The symbol is itself a cue,
            so the recogniser repairs the damage before the transcript is ever
            read, and the amount never appears as an orphan.
          </p>
          <p className="cue__note">
            That repair is real and useful, and it is also why this number is a
            floor rather than a measurement. The identifying word is destroyed
            at the rate shown above; what varies is whether anything downstream
            puts it back. A consumer reading raw words &mdash; or any mode that
            does not normalise &mdash; gets the untyped amount.
          </p>
        </section>
      </Reveal>
    </>
  );
}
