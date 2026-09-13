/**
 * Render public/favicon.svg to PNG at the sizes browsers ask for.
 *
 * Run by hand after changing the mark, not on every build: it needs a browser,
 * and the outputs are committed. `npm run icons`.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

const svg = readFileSync("public/favicon.svg", "utf8");
const b = await chromium.launch({ executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

for (const [name, size, pad, bg] of [
  ["favicon-16.png", 16, 0, "transparent"],
  ["favicon-32.png", 32, 0, "transparent"],
  // Apple wants an opaque square with the mark inset; it rounds the corners.
  ["apple-touch-icon.png", 180, 26, "#fcfaf7"],
]) {
  const p = await b.newPage({ viewport:{width:size,height:size}, deviceScaleFactor:1 });
  await p.setContent(`<!doctype html><style>
    html,body{margin:0;width:${size}px;height:${size}px;background:${bg}}
    div{position:absolute;inset:${pad}px}
    svg{width:100%;height:100%;display:block}
  </style><div>${svg}</div>`);
  await p.waitForTimeout(120);
  await p.screenshot({ path: resolve("public", name), omitBackground: bg === "transparent" });
  await p.close();
  console.log(name, size);
}
await b.close();
