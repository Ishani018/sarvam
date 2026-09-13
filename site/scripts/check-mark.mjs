/**
 * The mark exists twice -- as a React component and as a static favicon -- and
 * nothing in the build links them. This checks the geometry matches, so a
 * tweak to one cannot silently leave the browser tab showing the old shape.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsx = readFileSync(join(SITE, "src/components/Mark.tsx"), "utf8");
const svg = readFileSync(join(SITE, "public/favicon.svg"), "utf8");

const num = (src, name) => {
  const m = new RegExp(`const ${name} = ([\\d.]+)`).exec(src);
  if (!m) throw new Error(`Mark.tsx: could not find ${name}`);
  return Number(m[1]);
};
const xs = (() => {
  const m = /const X = \[([^\]]+)\]/.exec(tsx);
  if (!m) throw new Error("Mark.tsx: could not find X");
  return m[1].split(",").map((v) => Number(v.trim()));
})();

const want = {
  "stroke-width": num(tsx, "W"),
  top: num(tsx, "TOP"),
  bottom: num(tsx, "BOT"),
  breakTop: num(tsx, "BREAK_TOP"),
  breakBottom: num(tsx, "BREAK_BOT"),
};

const svgW = Number(/stroke-width="([\d.]+)"/.exec(svg)?.[1]);
const lines = [...svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="[\d.]+" y2="([\d.]+)"/g)]
  .map((m) => ({ x: Number(m[1]), y1: Number(m[2]), y2: Number(m[3]) }));

const fail = [];
if (svgW !== want["stroke-width"]) fail.push(`stroke-width ${svgW} vs ${want["stroke-width"]}`);
if (lines.length !== 6) fail.push(`expected 6 lines in favicon.svg, found ${lines.length}`);
xs.forEach((x, i) => {
  const l = lines[i];
  if (!l) return;
  if (Math.abs(l.x - x) > 1e-6) fail.push(`stroke ${i + 1} x ${l?.x} vs ${x}`);
});
const full = lines.slice(0, 4);
for (const [i, l] of full.entries()) {
  if (l.y1 !== want.top || l.y2 !== want.bottom) {
    fail.push(`stroke ${i + 1} runs ${l.y1}-${l.y2}, expected ${want.top}-${want.bottom}`);
  }
}
const [a, b] = lines.slice(4);
if (a && (a.y1 !== want.top || a.y2 !== want.breakTop)) {
  fail.push(`broken stroke top ${a.y1}-${a.y2}, expected ${want.top}-${want.breakTop}`);
}
if (b && (b.y1 !== want.breakBottom || b.y2 !== want.bottom)) {
  fail.push(`broken stroke bottom ${b.y1}-${b.y2}, expected ${want.breakBottom}-${want.bottom}`);
}

// The gap the caps actually leave, at the smallest size it is drawn.
const visible = (want.breakBottom - want.breakTop - want["stroke-width"]) * (16 / 64);
if (visible < 2) fail.push(`gap is ${visible.toFixed(2)}px at 16px -- widen it`);

if (fail.length) {
  console.error("\n  favicon.svg has drifted from Mark.tsx:\n");
  for (const f of fail) console.error(`    ${f}`);
  console.error("\n  Update public/favicon.svg, then re-run scripts/icons.mjs.\n");
  process.exit(1);
}
console.log(`  mark check: favicon matches Mark.tsx, gap ${visible.toFixed(2)}px at 16px`);
