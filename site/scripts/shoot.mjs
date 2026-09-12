/** Screenshot the built site at desktop and narrow widths. Dev tool only. */
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright";

const DIST = resolve(process.argv[2] ?? "dist");
const OUT = resolve(process.argv[3] ?? "shots");
const TAG = process.argv[4] ?? "";

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".woff": "font/woff", ".woff2": "font/woff2",
  ".wav": "audio/wav", ".svg": "image/svg+xml",
};

const server = createServer((req, res) => {
  let p = join(DIST, decodeURIComponent(req.url.split("?")[0]));
  if (!existsSync(p) || p.endsWith("/")) p = join(DIST, "index.html");
  res.setHeader("content-type", TYPES[extname(p)] ?? "application/octet-stream");
  res.end(readFileSync(p));
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

for (const [name, width, height] of [["desktop", 1440, 1000], ["narrow", 390, 844]]) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  // Bypass the soft gate; it is not what these shots are for.
  await page.addInitScript(() => {
    try { sessionStorage.setItem("ginti.gate", "1"); } catch { /* ignore */ }
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  const pre = TAG ? `${TAG}-` : "";
  await page.screenshot({ path: join(OUT, `${pre}${name}-full.png`), fullPage: true });

  for (const id of ["listen", "degradation", "what", "results", "issues"]) {
    const el = page.locator(`#${id}`);
    if (await el.count()) {
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      await el.screenshot({ path: join(OUT, `${pre}${name}-${id}.png`) });
    }
  }
  await ctx.close();
}

// The gate itself, once, at desktop.
if (!TAG) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT, "gate.png") });
  await ctx.close();
}

await browser.close();
server.close();
console.log(`shots -> ${OUT}`);
