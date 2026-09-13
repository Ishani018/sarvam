/**
 * Language tags, as a reader would say them.
 *
 * The results carry BCP-47 tags because that is what the config and the API
 * use, and "synthetic hi-IN utterances" is jargon on a page whose whole point
 * is to be legible to someone who is not already inside it. Derived rather
 * than mapped by hand so a run in a new language needs no code change, with
 * the tag itself as the fallback when the runtime cannot name it.
 */
export function languageName(tag: string): string {
  const base = tag.split("-")[0];
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(base) ?? tag;
  } catch {
    return tag;
  }
}

/** "Hindi", "Hindi and Tamil", "Hindi, Tamil and Bengali". */
export function languageList(tags: string[]): string {
  const names = [...new Set(tags.map(languageName))];
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
