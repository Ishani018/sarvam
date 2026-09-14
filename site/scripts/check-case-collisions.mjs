/**
 * Guard against filename collisions that only break on case-insensitive
 * filesystems.
 *
 * This container is Linux (case-sensitive); development happens on macOS
 * (case-insensitive by default). A collision introduced here is invisible here
 * and fatal there, so it has to be checked rather than noticed.
 *
 * Two distinct hazards:
 *
 *   1. Two paths differing only by case. Git tracks both; macOS and Windows can
 *      only hold one, so a checkout silently loses a file.
 *
 *   2. Two modules in one directory whose names differ only by case once the
 *      extension is stripped -- `gate.ts` and `Gate.tsx`. Both files coexist
 *      fine, but an extensionless import like `./Gate` probes `./Gate.ts`,
 *      which a case-insensitive filesystem happily answers with `gate.ts`, and
 *      the import resolves to the wrong module. This is the one that actually
 *      bit: it produced "No matching export in src/gate.ts for import Gate".
 */

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, extname, basename, join, relative } from "node:path";

const MODULE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const SKIP = new Set(["node_modules", ".git", "dist", ".vercel"]);

/** Every file under `root`, as repo-relative paths. */
function walk(root, dir = root, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(root, full, out);
    else out.push(relative(root, full));
  }
  return out;
}

/**
 * Prefer git's index -- it is the set that actually ships, and it sees files a
 * walk would miss on a case-insensitive filesystem, which is the whole point.
 * Fall back to walking when there is no checkout: a deploy that unpacks the
 * source without .git would otherwise fail this check with "Command failed:
 * git ls-files", which says nothing about the collision it is meant to catch.
 */
function listFiles() {
  try {
    return execFileSync("git", ["ls-files"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    console.log("  (no git checkout: walking the filesystem instead)");
    return walk(process.cwd());
  }
}

const files = listFiles();

const problems = [];

// 1. Whole-path case collisions.
const byLowerPath = new Map();
for (const f of files) {
  const k = f.toLowerCase();
  if (byLowerPath.has(k) && byLowerPath.get(k) !== f) {
    problems.push(
      `path case collision (a case-insensitive checkout keeps only one):\n` +
      `    ${byLowerPath.get(k)}\n    ${f}`);
  }
  byLowerPath.set(k, f);
}

// 2. Module stem collisions within a directory.
const byStem = new Map();
for (const f of files) {
  const ext = extname(f);
  if (!MODULE_EXT.has(ext)) continue;
  const k = `${dirname(f)}/${basename(f, ext).toLowerCase()}`;
  if (byStem.has(k) && byStem.get(k) !== f) {
    problems.push(
      `module name collision (an extensionless import can resolve to either\n` +
      `  on a case-insensitive filesystem):\n` +
      `    ${byStem.get(k)}\n    ${f}`);
  }
  byStem.set(k, f);
}

if (problems.length) {
  console.error(
    `\ncase-collision check failed (${problems.length} problem(s)).\n` +
    `These break on macOS and Windows but not on this Linux container.\n`);
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}
console.log(`  case check: ${files.length} tracked files, no collisions`);
