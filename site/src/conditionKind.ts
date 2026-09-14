import type { ConditionDef, ListenEntry } from "./types";

/**
 * What kind of damage a condition does, derived from its declared chain.
 *
 * The order of the tests is the point. A lossy condition is also a codec
 * condition and a noisy one is also a codec condition, but what a reader is
 * choosing between is the thing that was added last, so the most specific
 * damage wins. A new condition in the YAML classifies itself.
 */
export type Kind = "clean" | "codec" | "scattered" | "bursty" | "noise";

export const KIND_ORDER: Kind[] = ["clean", "codec", "scattered", "bursty", "noise"];

export const KIND_LABEL: Record<Kind, string> = {
  clean: "Clean",
  codec: "Bandwidth & codecs",
  scattered: "Scattered loss",
  bursty: "Bursty loss",
  noise: "Noise",
};

export const KIND_BLURB: Record<Kind, string> = {
  clean: "The undamaged reference.",
  codec: "8 kHz and the codecs a phone call actually runs through.",
  scattered: "Frames dropped independently, one here and one there.",
  bursty: "The same fraction dropped, but in runs — a real bad connection.",
  noise: "A noisy room or street, then the phone line on top.",
};

export function lossOp(c: ConditionDef) {
  return c.chain.find((o) => o.op === "packet_loss");
}

/** The rate below which a resample is the damage rather than a formality.
 *  Telephony is 8 kHz; anything at or above this is the corpus's own rate or
 *  better, and resampling to it takes nothing away. */
const WIDEBAND_HZ = 16000;

export function kindOf(c: ConditionDef): Kind {
  const loss = lossOp(c);
  if (loss) return loss.model === "gilbert" ? "bursty" : "scattered";
  if (c.chain.some((o) => o.op === "noise")) return "noise";
  if (c.chain.some((o) => o.op === "codec")) return "codec";
  // A resample is only damage if it narrows the band. The baseline condition
  // is declared as `resample: 16000` -- the corpus's own rate -- and reading
  // that as a codec put "clean" under "Bandwidth & codecs" everywhere the
  // page groups conditions.
  if (c.chain.some((o) => o.op === "resample"
        && Number(o.rate ?? WIDEBAND_HZ) < WIDEBAND_HZ)) return "codec";
  return "clean";
}

/** Group condition names by kind, in reading order, dropping empty groups. */
export function groupByKind(conditions: ConditionDef[], names: string[]) {
  const byName = new Map(conditions.map((c) => [c.name, c]));
  return KIND_ORDER.map((kind) => ({
    kind,
    label: KIND_LABEL[kind],
    blurb: KIND_BLURB[kind],
    names: names.filter((n) => {
      const c = byName.get(n);
      return c ? kindOf(c) === kind : false;
    }),
  })).filter((g) => g.names.length > 0);
}

/* -------------------------------------------------------------------------
 * The example shown in the hero
 * ---------------------------------------------------------------------- */

export interface HeroExample {
  utteranceId: string;
  condition: string;
  model: string;
  mode: string;
  entityType: string;
  expected: string;
  found: string;
  /** True when the value came back the right length -- a substitution, not a
   *  truncation. The two need different prose and only one is "plausible". */
  sameShape: boolean;
  /** The sentence as spoken, and the surface of the entity inside it. */
  text: string;
  gloss: string | null;
  surface: string;
}

/**
 * A real failure to put above the fold, chosen from the data rather than
 * pinned by id: a bursty-loss miss where the model returned a wrong value
 * rather than nothing, because a wrong value that still looks valid is the
 * failure worth showing. See `rank` below for the ordering -- a same-length
 * substitution beats a truncation, and no entity type is preferred.
 *
 * Returns null if nothing in the run qualifies, and the hero then simply omits
 * the block rather than inventing one.
 *
 * `mode` is required rather than defaulted: the whole point of carrying mode
 * is that a figure has to say which reading it came from, and a default here
 * would quietly reintroduce the pooling everything else now refuses.
 */
export function pickHeroExample(
  listen: ListenEntry[], conditions: ConditionDef[], mode: string,
): HeroExample | null {
  const byName = new Map(conditions.map((c) => [c.name, c]));
  const found: HeroExample[] = [];

  for (const u of listen) {
    for (const c of u.conditions) {
      if (kindOf(byName.get(c.condition) ?? ({ chain: [] } as never)) !== "bursty") continue;
      for (const r of c.results) {
        // One mode's transcripts. With two modes run, the same audio has two
        // answers and a failure shown without saying which reading produced it
        // is not a failure a reader can check.
        if ((r.mode ?? "-") !== mode) continue;
        for (const e of r.entities) {
          if (e.hit || !e.found || !e.expected) continue;
          const gold = u.entities.find((g) => g.type === e.type);
          found.push({
            utteranceId: u.utteranceId,
            condition: c.condition,
            model: r.model,
            mode: mode,
            entityType: e.type,
            expected: e.expected,
            found: e.found,
            sameShape: e.found.length === e.expected.length,
            text: u.text,
            gloss: u.gloss,
            surface: gold?.surface ?? "",
          });
        }
      }
    }
  }
  if (found.length === 0) return null;

  // A same-length substitution is the failure worth putting above the fold: a
  // value of the right shape that is simply the wrong number, which nothing
  // downstream can reject. A truncation is also a real failure, but it looks
  // broken, and showing one would undercut the point the block is making.
  // Longer expected values make the damage easier to see, so within a tier the
  // longest wins.
  const rank = (x: HeroExample) =>
    (x.found.length === x.expected.length ? 0 : 100) - Math.min(x.expected.length, 40);
  return found.sort((a, b) => rank(a) - rank(b))[0];
}
