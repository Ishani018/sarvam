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

export function kindOf(c: ConditionDef): Kind {
  const loss = lossOp(c);
  if (loss) return loss.model === "gilbert" ? "bursty" : "scattered";
  if (c.chain.some((o) => o.op === "noise")) return "noise";
  if (c.chain.some((o) => o.op === "codec" || o.op === "resample")) return "codec";
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
 * pinned by id: the first bursty-loss miss where the model returned a wrong
 * value rather than nothing, because a wrong value that still looks like an
 * account number is the failure worth showing. Account numbers are preferred --
 * they are the longest entities and the damage is most visible in them.
 *
 * Returns null if nothing in the run qualifies, and the hero then simply omits
 * the block rather than inventing one.
 */
export function pickHeroExample(
  listen: ListenEntry[], conditions: ConditionDef[],
): HeroExample | null {
  const byName = new Map(conditions.map((c) => [c.name, c]));
  const found: HeroExample[] = [];

  for (const u of listen) {
    for (const c of u.conditions) {
      if (kindOf(byName.get(c.condition) ?? ({ chain: [] } as never)) !== "bursty") continue;
      for (const r of c.results) {
        for (const e of r.entities) {
          if (e.hit || !e.found || !e.expected) continue;
          const gold = u.entities.find((g) => g.type === e.type);
          found.push({
            utteranceId: u.utteranceId,
            condition: c.condition,
            model: r.model,
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
