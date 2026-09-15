/**
 * Render card.html to the 1200x630 link preview PNG.
 *
 * Run after a build, since it screenshots the built card rather than the
 * source: `npm run card`. The output is committed, because the deployed site
 * has to serve it and the build machine does not run a browser.
 *
 * deviceScaleFactor stays at 1. The card is designed at exactly the size the
 * spec asks for, and a 2x capture would be a 2400x1260 file that every
 * consumer downsamples anyway -- more bytes for no more detail.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(SITE, "dist");
const OUT = join(SITE, "public", "og-card.png");

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".woff": "font/woff", ".woff2": "font/woff2",
  ".svg": "image/svg+xml", ".png": "image/png", ".wav": "audio/wav",
};

if (!existsSync(join(DIST, "card.html"))) {
  console.error("no dist/card.html -- run `npm run build` first");
  process.exit(1);
}

const server = createServer((req, res) => {
  let p = join(DIST, decodeURIComponent(req.url.split("?")[0]));
  if (!existsSync(p) || p.endsWith("/")) p = join(DIST, "card.html");
  res.setHeader("content-type", TYPES[extname(p)] ?? "application/octet-stream");
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM
    ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await browser.newContext({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`http://127.0.0.1:${port}/card.html`, { waitUntil: "networkidle" });
// Devanagari and the mono figures are self-hosted and load late; screenshotting
// before they land silently ships a card set in the fallback face.
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

if (errors.length) {
  console.error("card render errors:", errors);
  process.exit(1);
}

// The card must fill the frame exactly. A short card leaves a band of body
// background in the PNG; a tall one gets its footer cropped.
const box = await page.locator(".card").boundingBox();
if (!box || Math.round(box.width) !== 1200 || Math.round(box.height) !== 630) {
  console.error(`card is ${box && Math.round(box.width)}x${box && Math.round(box.height)}, expected 1200x630`);
  process.exit(1);
}

// And the CONTENT has to fit inside it.
//
// Harder to measure than it looks, and worth the comment, because two obvious
// metrics are both wrong here:
//
//   card.scrollHeight always reports an overflow, because the two blurred
//   accent fields are absolutely positioned past the bottom edge on purpose
//   and overflow:hidden exists to clip them;
//
//   the footer's distance from the bottom is always zero, because the pair is
//   `flex: 1` and absorbs every spare pixel, pinning the footer to the edge
//   whether the card fits comfortably or is one pixel from overflowing. For
//   the same reason the pair's own scrollHeight equals its clientHeight: a
//   stretched flex item reports the stretched size, not what it needs.
//
// So the grow is neutralised first, the natural heights are summed against the
// padding box, and it is put back. That number is the real answer, and it is
// what catches the footer running off the bottom -- which is what shipped on
// the first render.
const MIN_SPARE = 12;
const fit = await page.evaluate(() => {
  const card = document.querySelector(".card");
  const pair = card.querySelector(".card__pair");
  const grow = pair ? pair.style.flex : null;
  if (pair) pair.style.flex = "0 0 auto";

  const cs = getComputedStyle(card);
  const inner = card.clientHeight
    - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const rows = [...card.children].map((el) => ({
    name: el.className,
    h: el.getBoundingClientRect().height
       + parseFloat(getComputedStyle(el).marginTop)
       + parseFloat(getComputedStyle(el).marginBottom),
  }));
  const natural = rows.reduce((a, r) => a + r.h, 0);

  if (pair) pair.style.flex = grow ?? "";
  return { inner: Math.round(inner), natural: Math.round(natural),
           spare: Math.round(inner - natural), rows };
});

if (fit.spare < MIN_SPARE) {
  console.error(
    fit.spare < 0
      ? `card content is ${-fit.spare}px taller than the frame; it would ship cropped`
      : `card content leaves only ${fit.spare}px spare, under the ${MIN_SPARE}px `
        + `minimum; it is one font metric from cropping`);
  for (const r of fit.rows) console.error(`    ${r.name}: ${Math.round(r.h)}px`);
  process.exit(1);
}
console.log(`  content ${fit.natural}px in a ${fit.inner}px box, ${fit.spare}px spare`);

mkdirSync(dirname(OUT), { recursive: true });
await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1200, height: 630 } });

await ctx.close();
await browser.close();
server.close();

// The alt text lives in index.html, which is static, while the figure it
// describes is rendered from the data. Nothing else couples them, so a rerun
// that moves the number would leave the alt describing the previous card --
// the one stale-claim hazard this whole file otherwise avoids. Check it.
const drop = JSON.parse(
  readFileSync(join(SITE, "src/generated/data.json"), "utf8")).finding?.points;
if (drop != null) {
  const html = readFileSync(join(SITE, "index.html"), "utf8");
  const alt = html.match(/property="og:image:alt" content="([^"]*)"/)?.[1] ?? "";
  const figure = drop.toFixed(1);
  if (!alt.includes(figure)) {
    console.error(
      `og:image:alt in index.html does not mention ${figure} points, which is `
      + `what the card now shows. Update the alt text to match the image.`);
    process.exit(1);
  }
  console.log(`  og:image:alt agrees with the card (${figure} points)`);
}

const kb = (statSync(OUT).size / 1024).toFixed(0);
console.log(`og-card.png  1200x630  ${kb} KB  ->  public/og-card.png`);
