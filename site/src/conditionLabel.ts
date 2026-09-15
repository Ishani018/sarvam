import type { ConditionDef } from "./types";

/**
 * What a condition is, in the words an engineer would use for it.
 *
 * Derived from the declared chain rather than a name map, so a condition added
 * to the YAML gets a label without anyone editing this file, and so the
 * headline cannot credit the recogniser for surviving a codec the run never
 * applied. `clean` has no damage and returns null: it is the baseline, not an
 * achievement.
 */
export function damageLabel(c: ConditionDef): string | null {
  const out: string[] = [];
  const codec = c.chain.find((o) => o.op === "codec");
  const resample = c.chain.find((o) => o.op === "resample");
  const loss = c.chain.find((o) => o.op === "packet_loss");
  const noise = c.chain.find((o) => o.op === "noise");

  if (resample && Number(resample.rate) < 16000) {
    out.push(`${Number(resample.rate) / 1000} kHz`);
  }
  if (codec) {
    const name = String(codec.codec ?? "");
    const CODEC: Record<string, string> = {
      pcm_mulaw: "G.711", pcm_alaw: "G.711", g726: "G.726",
      adpcm_g726: "G.726", gsm: "GSM", libopus: "Opus", opus: "Opus",
    };
    out.push(CODEC[name] ?? name.toUpperCase());
  }
  if (noise) out.push("added noise");
  if (loss) {
    out.push(loss.model === "gilbert" ? "bursty packet loss" : "scattered packet loss");
  }
  return out.length ? out.join(" + ") : null;
}

/**
 * The damage the recogniser came through untouched, as a readable list.
 *
 * Deduplicated on the label rather than the condition name: 8 kHz alone and
 * 8 kHz + G.711 both contribute "8 kHz", and a headline that says it twice
 * reads as padding. Scattered loss is named last because it is the one a
 * reader will not expect to be free.
 */
export function heldThrough(conditions: ConditionDef[], names: string[]): string[] {
  const byName = new Map(conditions.map((c) => [c.name, c]));
  const parts: string[] = [];
  for (const n of names) {
    const def = byName.get(n);
    if (!def) continue;
    const label = damageLabel(def);
    if (!label) continue;
    for (const piece of label.split(" + ")) {
      if (!parts.includes(piece)) parts.push(piece);
    }
  }
  // Bandwidth and codecs first, loss last. The list is read as a crescendo --
  // "and it survives packet loss too" is the part a reader does not expect --
  // and rate order puts it wherever the run happened to land it.
  const rank = (x: string) => (x.includes("packet loss") ? 2 : x.includes("noise") ? 1 : 0);
  return parts.sort((a, b) => rank(a) - rank(b));
}

/**
 * The most labels the subhead will ever print.
 *
 * Four, not three, and not by eye: four is what the current run produces, so
 * the bound is "never longer than it is now". Three would drop scattered
 * packet loss, which is the contrast the whole project rests on -- a
 * recogniser surviving lost packets and then failing when the same loss
 * clusters. Change this number to change the bound; nothing else needs
 * touching.
 */
export const MAX_LABELS = 4;

/**
 * "a, b and c", with a hard ceiling on the length.
 *
 * A subhead that silently grows when a future run adds a condition is the same
 * class of problem as a hardcoded number that silently goes stale: correct
 * today, wrong later, and nothing in the build notices. The cap makes the
 * length a property of the code rather than of the data.
 */
export function readable(xs: string[], max = MAX_LABELS): string {
  const over = xs.length - max;
  const shown = over > 0 ? xs.slice(0, max) : xs;
  const tail = over > 0
    ? `${over} other condition${over === 1 ? "" : "s"}`
    : null;
  const parts = tail ? [...shown, tail] : shown;
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
