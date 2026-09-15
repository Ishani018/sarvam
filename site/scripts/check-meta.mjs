/**
 * Assert the built HTML carries absolute social URLs.
 *
 * This exists because the bug it catches shipped. `og:image` was written as
 * `/og-card.png`, which is correct-looking source, and `base: "./"` rewrote it
 * to `./og-card.png` in dist/. Reading index.html said one thing and the
 * deployed file said another, so the check has to read the BUILT output --
 * that is the whole point of it.
 *
 * A document-relative og:image is not a hard error to a validator; scrapers
 * just inconsistently fail to fetch it, and the link previews as bare text.
 * There is no runtime signal, which is exactly why it needs a build-time one.
 *
 * Run by `npm run check:meta`, and as part of `npm run build`.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILT = join(SITE, "dist", "index.html");

if (!existsSync(BUILT)) {
  console.error("no dist/index.html -- run the build first");
  process.exit(1);
}

const html = readFileSync(BUILT, "utf8");
const problems = [];

/** Tags whose value a scraper must be able to fetch without a base URL. */
const ABSOLUTE = [
  ['property="og:url"', "og:url"],
  ['property="og:image"', "og:image"],
  ['name="twitter:image"', "twitter:image"],
];

for (const [attr, name] of ABSOLUTE) {
  const m = html.match(
    new RegExp(`<meta[^>]*${attr.replace(/"/g, '"')}[^>]*content="([^"]*)"`));
  if (!m) {
    problems.push(`${name} is missing from the built HTML`);
    continue;
  }
  const value = m[1];
  if (value.includes("%SITE_ORIGIN%")) {
    problems.push(`${name} still contains the %SITE_ORIGIN% token: ${value}`);
  } else if (!/^https:\/\/[^/]+\//.test(value)) {
    problems.push(
      `${name} is not an absolute https URL: ${value}\n` +
      `      Scrapers are inconsistent about resolving relative image URLs; ` +
      `the link then previews as bare text.`);
  }
}

// One origin, not several: a card served from a host the page does not claim
// as its canonical URL is the other way this goes quietly wrong.
const origins = [...html.matchAll(
  /<meta[^>]*(?:og:url|og:image|twitter:image)[^>]*content="(https:\/\/[^/"]+)/g)]
  .map((m) => m[1]);
const distinct = [...new Set(origins)];
if (distinct.length > 1) {
  problems.push(`social tags point at ${distinct.length} different origins: ${distinct.join(", ")}`);
}

// And the image it names has to exist in the same build.
if (!existsSync(join(SITE, "dist", "og-card.png"))) {
  problems.push("og-card.png is not in dist/ -- run `npm run card`");
}

if (problems.length) {
  console.error("meta check failed:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`  meta: absolute social URLs on ${distinct[0]}, og-card.png present`);
