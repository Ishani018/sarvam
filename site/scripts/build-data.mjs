/**
 * Ginti site data build.
 *
 * Reads the harness outputs -- results/*.jsonl, corpora/*.jsonl, the conditions
 * config, and the per-file degradation manifests -- and emits a single
 * src/generated/data.json plus the subset of .wav files the page actually
 * plays. Nothing in the deployed bundle is hand-written: regenerate results,
 * re-run this, and the site is current.
 *
 * The harness source is deliberately NOT copied. This script reads from the
 * repo at build time; only site/dist/ is deployed.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync,
  rmSync, statSync, writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, "..");
const REPO = resolve(SITE, "..");

const PATHS = {
  results: join(REPO, "results"),
  corpora: join(REPO, "corpora"),
  fixtures: join(REPO, "fixtures"),
  config: join(REPO, "configs", "default.yaml"),
  content: join(SITE, "content"),
  outData: join(SITE, "src", "generated", "data.json"),
  outAudio: join(SITE, "public", "audio"),
};

/** How many utterances get the full listen-and-compare treatment. Each one
 *  costs (conditions x ~130 KB) of wav in the deployed bundle. */
const LISTEN_LIMIT = Number(process.env.GINTI_LISTEN_LIMIT ?? 6);

/** Below this many observations a cell is an anecdote, and the page must show
 *  the raw count without a rate or a success colour. A wall of 1.000 off n=1 is
 *  the fastest way to lose a reader who knows what they are looking at. */
const LOW_N = Number(process.env.GINTI_LOW_N ?? 10);

/** Missing audio is a hard failure by default: a listen section that silently
 *  drops players is worse than a build that refuses. Set this only for local
 *  work on a machine that does not have .tee/work/. */
const ALLOW_MISSING_AUDIO = process.env.GINTI_ALLOW_MISSING_AUDIO === "1";

const warnings = [];
const warn = (msg) => {
  warnings.push(msg);
  console.warn(`  [warn] ${msg}`);
};

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

const readJsonl = (file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));

const listJsonl = (dir) =>
  existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f))
    : [];

function loadRows() {
  const files = listJsonl(PATHS.results);
  if (!files.length) throw new Error(`no results/*.jsonl found in ${PATHS.results}`);
  const all = files.flatMap((f) =>
    readJsonl(f).map((r) => ({ ...r, _source: basename(f) })));

  // Mock and real rows must never be averaged together: one is a measurement,
  // the other is a fixture, and a blended hit rate is a fabricated number. If
  // any real row is present, mock rows are dropped outright.
  const real = all.filter((r) => r.asr_impl !== "mock");
  if (real.length && real.length !== all.length) {
    const dropped = [...new Set(all.filter((r) => r.asr_impl === "mock")
      .map((r) => r._source))];
    warn(
      `excluded ${all.length - real.length} mock row(s) from ${dropped.join(", ")}: ` +
      `real results are present and the two cannot be mixed`
    );
    console.log(`  results: ${real.length} rows from ${files.length} file(s) ` +
                `(${all.length - real.length} mock rows excluded)`);
    return dedupe(real);
  }
  console.log(`  results: ${all.length} rows from ${files.length} file(s)`);
  return dedupe(all);
}

/**
 * Keep one row per (utterance, condition, model, mode), preferring the newest
 * run.
 *
 * The corpus is prefix-stable by design, so a 5-utterance smoke run and a
 * 40-utterance run share their first five utterances verbatim. Globbing
 * results/ and summing therefore counted those five twice under every shared
 * condition -- 456 entities became 476, and the duplicated rows also dragged
 * the per-pair means around. Run ids are UTC timestamps, so the lexicographic
 * maximum is the most recent measurement of that cell.
 */
function dedupe(rows) {
  const best = new Map();
  for (const r of rows) {
    const key = [r.utterance_id, r.condition, r.asr_model ?? "-",
                 r.asr_mode ?? "-"].join("\u001f");
    const prev = best.get(key);
    if (!prev || String(r.run_id) > String(prev.run_id)) best.set(key, r);
  }
  const kept = [...best.values()];
  if (kept.length !== rows.length) {
    const dropped = rows.length - kept.length;
    warn(
      `dropped ${dropped} duplicate row(s): the same (utterance, condition, ` +
      `model, mode) measured in more than one run. The newest run wins. ` +
      `Counting both would weight the overlapping utterances twice.`
    );
    console.log(`  deduped: ${rows.length} -> ${kept.length} rows`);
  }
  return kept;
}

function loadUtterances() {
  // Corpora first, fixtures second: a generated corpus is the real test set and
  // fixtures are dev scaffolding. Ids never collide, so first wins is safe.
  const files = [...listJsonl(PATHS.corpora), ...listJsonl(PATHS.fixtures)];
  const byId = new Map();
  for (const f of files) {
    for (const u of readJsonl(f)) if (!byId.has(u.id)) byId.set(u.id, u);
  }
  console.log(`  corpora: ${byId.size} utterances from ${files.length} file(s)`);
  return byId;
}

function loadConfig() {
  const cfg = parseYaml(readFileSync(PATHS.config, "utf8"));
  return {
    conditions: cfg.conditions ?? [],
    audio: cfg.audio ?? {},
    providers: cfg.providers ?? {},
    scoring: cfg.scoring ?? {},
    cost: cfg.cost ?? {},
    seed: cfg.seed,
  };
}

function loadContent() {
  const out = {};
  if (!existsSync(PATHS.content)) return out;
  for (const f of readdirSync(PATHS.content).filter((n) => n.endsWith(".md"))) {
    const raw = readFileSync(join(PATHS.content, f), "utf8");
    // An optional leading "SUMMARY: ..." line is lifted out, so a section can
    // lead with one sentence in larger type and keep the argument skimmable.
    const m = /^SUMMARY:\s*(.+?)\n/.exec(raw);
    out[basename(f, ".md")] = m
      ? { summary: m[1].trim(), body: raw.slice(m[0].length).trim() }
      : { summary: null, body: raw.trim() };
  }
  console.log(`  content: ${Object.keys(out).length} markdown file(s)`);
  return out;
}

/** The recorded argv for each condition, lifted from one manifest that used it.
 *  This is what actually ran -- not a restatement of the config. */
function loadCommandsByCondition(rows) {
  // Manifests live in .tee/work/, which is scratch and exists only on the
  // machine that ran the harness. On any other checkout the previously emitted
  // data.json is the record, so carry its commands forward rather than
  // silently emitting a section that claims nothing was run.
  let previous = {};
  if (existsSync(PATHS.outData)) {
    try {
      const old = JSON.parse(readFileSync(PATHS.outData, "utf8"));
      for (const c of old.conditions ?? []) {
        if (c.commands?.length) {
          previous[c.name] = {
            commands: c.commands.map((cmd) => ({
              ...cmd, argv: (cmd.argv ?? []).map(shortenTempPath),
            })),
            tools: c.tools ?? {},
            seed: c.seed ?? null, durationS: c.durationS ?? null,
          };
        }
      }
    } catch { /* a malformed previous build is simply not reused */ }
  }

  const out = {};
  for (const r of rows) {
    if (!r.audio_path || out[r.condition]) continue;
    const manifest = join(REPO, `${r.audio_path}.manifest.json`);
    if (!existsSync(manifest)) continue;
    try {
      const m = JSON.parse(readFileSync(manifest, "utf8"));
      out[r.condition] = {
        commands: (m.commands ?? []).map((c) => ({
          argv: (c.argv ?? []).map(shortenTempPath),
          note: c.note,
          // Frame gating is done in Python, not shelled out; the page should
          // not present it as an ffmpeg invocation.
          isShell: c.argv?.[0] !== "<python>",
        })),
        tools: m.tools ?? {},
        seed: m.seed ?? null,
        durationS: m.output?.duration_s ?? null,
      };
    } catch (e) {
      warn(`unreadable manifest ${manifest}: ${e.message}`);
    }
  }

  let carried = 0;
  for (const [name, rec] of Object.entries(previous)) {
    if (!out[name]) { out[name] = rec; carried++; }
  }
  if (carried) {
    console.log(`  manifests: ${carried} condition(s) carried from the previous build`);
  }
  return out;
}

/**
 * Replace the per-run scratch directory in a recorded argv with just the
 * filename.
 *
 * The manifests record absolute paths inside a throwaway temp directory
 * (/var/folders/... on macOS, /tmp/... on Linux). Those are noise on the page,
 * and they publish the local filesystem layout of whoever ran the harness. The
 * filename is the part that identifies the step; the directory is meaningless
 * outside that one invocation, so dropping it loses nothing and the flags,
 * codecs and rates -- the parts a reader is checking -- are untouched.
 */
function shortenTempPath(arg) {
  if (typeof arg !== "string" || !arg.includes("/tee_degrade_")) return arg;
  return arg.slice(arg.lastIndexOf("/") + 1);
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

/** Character spans of each gold entity inside the reference sentence, so the
 *  page can mark the entity in place rather than printing it separately. */
function entitySpans(text, entities) {
  let cursor = 0;
  return entities.map((e) => {
    const at = text.indexOf(e.surface, cursor);
    if (at === -1) return { ...e, start: null, end: null };
    cursor = at + e.surface.length;
    return { ...e, start: at, end: at + e.surface.length };
  });
}

function hitRateMatrix(rows) {
  const bucket = new Map();
  for (const r of rows) {
    for (const e of r.entities) {
      const key = JSON.stringify([r.asr_model ?? "-", r.condition, e.type]);
      const cur = bucket.get(key) ?? { hits: 0, total: 0 };
      cur.hits += e.hit ? 1 : 0;
      cur.total += 1;
      bucket.set(key, cur);
    }
  }
  return [...bucket.entries()].map(([key, v]) => {
    const [model, condition, entityType] = JSON.parse(key);
    return {
      model, condition, entityType,
      hits: v.hits, total: v.total,
      rate: v.total ? v.hits / v.total : null,
      lowN: v.total < LOW_N,
    };
  });
}

function werAggregate(rows) {
  const bucket = new Map();
  for (const r of rows) {
    const key = JSON.stringify([r.asr_model ?? "-", r.condition]);
    const cur = bucket.get(key) ?? { sum: 0, n: 0 };
    cur.sum += r.wer;
    cur.n += 1;
    bucket.set(key, cur);
  }
  return [...bucket.entries()].map(([key, v]) => {
    const [model, condition] = JSON.parse(key);
    return { model, condition, wer: v.sum / v.n, n: v.n };
  });
}

/** Pick the listen set: deterministic, spread across entity types, biased
 *  toward utterances that fail somewhere. A demo in which everything survives
 *  demonstrates nothing. */
function pickListenSet(rows, limit) {
  const byUtt = new Map();
  for (const r of rows) {
    if (!byUtt.has(r.utterance_id)) byUtt.set(r.utterance_id, []);
    byUtt.get(r.utterance_id).push(r);
  }

  const scored = [...byUtt.entries()].map(([id, rs]) => {
    const types = [...new Set(rs.flatMap((r) => r.entities.map((e) => e.type)))].sort();
    return {
      id, rows: rs,
      primaryType: types[0] ?? "none",
      hasMiss: rs.some((r) => r.entities.some((e) => !e.hit)),
      nEntities: rs[0]?.entities.length ?? 0,
    };
  });

  // Round-robin across entity types, so no single type monopolises the section.
  const byType = new Map();
  for (const s of scored) {
    if (!byType.has(s.primaryType)) byType.set(s.primaryType, []);
    byType.get(s.primaryType).push(s);
  }
  for (const list of byType.values()) {
    list.sort((a, b) =>
      Number(b.hasMiss) - Number(a.hasMiss) ||
      b.nEntities - a.nEntities ||
      a.id.localeCompare(b.id));
  }

  const types = [...byType.keys()].sort();
  const picked = [];
  for (let round = 0; picked.length < limit; round++) {
    let added = false;
    for (const t of types) {
      const list = byType.get(t);
      if (round < list.length && picked.length < limit) {
        picked.push(list[round]);
        added = true;
      }
    }
    if (!added) break;
  }
  return picked;
}

const sha8 = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 8);

/** Peak amplitude envelope of a 16-bit PCM wav, as `buckets` integers 0-100.
 *
 *  Computed here rather than in the browser: decoding audio client-side to draw
 *  a picture would mean downloading and decoding every clip before the page
 *  could render one, for a visual that never changes. A hundred-odd small
 *  integers per clip costs nothing in the bundle.
 */
function waveformPeaks(buf, buckets = 120) {
  // Walk the RIFF chunk list rather than assuming a 44-byte header: ffmpeg
  // writes a LIST chunk ahead of data unless -bitexact is set.
  let offset = 12;
  let dataStart = -1, dataLen = 0, channels = 1, bits = 16;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(offset + 10);
      bits = buf.readUInt16LE(offset + 22);
    } else if (id === "data") {
      dataStart = offset + 8;
      dataLen = Math.min(size, buf.length - dataStart);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataStart < 0 || bits !== 16) return null;

  const samples = Math.floor(dataLen / 2 / channels);
  if (samples <= 0) return null;
  const per = Math.max(1, Math.floor(samples / buckets));
  const out = [];
  for (let b = 0; b < buckets; b++) {
    let peak = 0;
    const from = b * per;
    for (let i = from; i < Math.min(from + per, samples); i++) {
      const v = Math.abs(buf.readInt16LE(dataStart + i * channels * 2));
      if (v > peak) peak = v;
    }
    out.push(Math.round((peak / 32768) * 100));
  }
  return out;
}

/** Did this hypothesis render the entity as digits or as number words?
 *
 *  Derived, never asserted: the gold normalized value already holds the digit
 *  string, so if those digits appear in the hypothesis (ignoring Indian group
 *  separators) the model wrote digits; if the entity was scored a hit without
 *  them, it must have spelled the number out.
 */
function renderingOf(hypothesis, entity) {
  const digits = goldDigits(entity.expected);
  if (!digits) return "n/a";
  const hypDigits = hypothesis.replace(/[^0-9]/g, "");
  if (hypDigits.includes(digits)) return "digits";
  return entity.hit ? "words" : "absent";
}

/** The digit string a model would have to emit to have written this entity as
 *  numerals.
 *
 *  Currency gold is "INR:7674000.00", and stripping non-digits from that whole
 *  string yields 767400000 -- the decimal's trailing zeros -- which matches no
 *  hypothesis and silently mislabels every amount as spelled-out. Take the
 *  value after the currency code, and drop a zero fraction.
 */
function goldDigits(expected) {
  let v = String(expected ?? "");
  const colon = v.lastIndexOf(":");
  if (colon !== -1) v = v.slice(colon + 1);
  const m = v.match(/^(\d+)\.(\d+)$/);
  if (m) v = Number(m[2]) === 0 ? m[1] : m[1] + m[2];
  return v.replace(/\D/g, "");
}

/** One row per (utterance, condition, model): how the number was written on
 *  each side, and the WER that follows from that choice alone. */
function renderingTable(rows) {
  const byKey = new Map();
  for (const r of rows) {
    for (const e of r.entities) {
      const key = JSON.stringify([r.utterance_id, r.condition, e.type, e.expected]);
      if (!byKey.has(key)) {
        byKey.set(key, {
          utteranceId: r.utterance_id,
          condition: r.condition,
          entityType: e.type,
          expected: e.expected,
          reference: r.reference,
          referenceRendering: r.realization ?? null,
          models: [],
        });
      }
      byKey.get(key).models.push({
        model: r.asr_model ?? "-",
        mode: r.asr_mode ?? null,
        rendering: renderingOf(r.hypothesis, e),
        hit: e.hit,
        wer: r.wer,
        hypothesis: r.hypothesis,
      });
    }
  }
  const out = [...byKey.values()];
  for (const row of out) row.models.sort((a, b) => a.model.localeCompare(b.model));
  out.sort((a, b) =>
    a.utteranceId.localeCompare(b.utteranceId) ||
    a.condition.localeCompare(b.condition));
  return out;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Refuse to build a page that claims every entity survived when some did not.
 *
 * This is not hypothetical. "Every entity survived every condition" sat under
 * the result block, hardcoded, and stayed there when bursty loss started
 * costing 53 entities -- directly above a chart showing the line at 0.90. A
 * sentence the reader can falsify in three seconds does more damage than any
 * missing feature, so the build checks rather than trusting review.
 */
function assertNoStaleSurvivalClaim(data) {
  const rate = data.headline.hitRate;
  if (rate === null || rate >= 1) return;

  const CLAIMS = [
    /every entity (survived|was recovered)/i,
    /all entities (survived|were recovered)/i,
    /entities survived/i,
    /recovered correctly by both models/i,
    /(hit rate|entity accuracy) (does not|did not) move/i,
    /nothing .{0,30}moved the entity hit rate/i,
  ];

  const sources = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, f.name);
      if (f.isDirectory()) { if (f.name !== "generated") walk(full); }
      else if (/\.(tsx?|md)$/.test(f.name)) sources.push(full);
    }
  };
  walk(join(SITE, "src"));
  if (existsSync(PATHS.content)) walk(PATHS.content);

  const offences = [];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      // A comment explaining the check is not itself a claim.
      if (/^\s*(\*|\/\/|#)/.test(line)) return;
      for (const re of CLAIMS) {
        if (re.test(line)) offences.push(`${basename(file)}:${i + 1}  ${line.trim()}`);
      }
    });
  }

  if (offences.length) {
    throw new Error(
      `the measured hit rate is ${(rate * 100).toFixed(1)}% ` +
      `(${data.headline.hits}/${data.headline.entities}), but ` +
      `${offences.length} line(s) still claim every entity survived:\n\n` +
      offences.map((o) => `    ${o}`).join("\n") +
      `\n\n  Derive the sentence from the data or delete it. A claim the ` +
      `reader can falsify from the chart beside it is worse than no claim.`
    );
  }
}

/**
 * The repository this was built from, read from the git remote rather than
 * typed in, so a fork's page links to the fork. Null on a checkout with no
 * remote, and the link is then simply not rendered.
 */
function repoUrl() {
  try {
    const raw = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const m = raw.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
    return m ? `https://github.com/${m[1]}/${m[2]}` : null;
  } catch {
    return null;
  }
}

function build() {
  console.log("ginti: building site data");
  const rows = loadRows();
  const utterances = loadUtterances();
  const cfg = loadConfig();
  const content = loadContent();
  const commandsByCondition = loadCommandsByCondition(rows);

  const models = [...new Set(rows.map((r) => r.asr_model ?? "-"))].sort();
  const modes = [...new Set(rows.map((r) => r.asr_mode ?? "-"))].sort();
  const impls = [...new Set(rows.map((r) => r.asr_impl))].sort();
  const conditionsInResults = [...new Set(rows.map((r) => r.condition))];

  // Provenance. A page sent to the vendor whose API is under evaluation must
  // never present mock output as a measurement of anything.
  const isMock = impls.every((i) => i === "mock");
  if (isMock) {
    warn(
      "ALL result rows come from the offline mock ASR. These are NOT " +
      "measurements of any real system, and the page must say so."
    );
  } else if (impls.includes("mock")) {
    warn(`results mix real and mock rows (impls: ${impls.join(", ")})`);
  }

  const errorRows = rows.filter((r) => r.error);
  if (errorRows.length) {
    warn(`${errorRows.length} row(s) recorded a provider or pipeline error`);
  }

  // Declared vs exercised, so an unavailable condition is a stated fact rather
  // than a silent gap in the table.
  const conditions = cfg.conditions.map((c) => ({
    name: c.name,
    description: (c.description ?? "").trim(),
    chain: c.chain,
    exercised: conditionsInResults.includes(c.name),
    ...(commandsByCondition[c.name] ??
      { commands: [], tools: {}, seed: null, durationS: null }),
  }));
  const notExercised = conditions.filter((c) => !c.exercised).map((c) => c.name);
  if (notExercised.length) {
    warn(`declared but absent from results: ${notExercised.join(", ")}`);
  }

  // --- listen set + audio ---------------------------------------------------
  // The bundle is not cleared up front. .tee/work/ is scratch and lives only on
  // the machine that ran the harness, so on any other checkout the committed
  // bundle IS the source. Files are kept or copied, then anything unreferenced
  // is pruned at the end.
  mkdirSync(PATHS.outAudio, { recursive: true });
  const existingAudio = readdirSync(PATHS.outAudio).filter((f) => f.endsWith(".wav"));

  const picked = pickListenSet(rows, LISTEN_LIMIT);
  const missingAudio = [];
  const keep = new Set();
  let copied = 0;
  let reused = 0;
  let bytes = 0;

  const conditionOrder = (name) => {
    const i = cfg.conditions.findIndex((c) => c.name === name);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  const listen = picked.map((p) => {
    const utt = utterances.get(p.id);
    const first = p.rows[0];
    const text = utt?.text ?? first.reference;

    const byCondition = new Map();
    for (const r of p.rows) {
      if (!byCondition.has(r.condition)) byCondition.set(r.condition, []);
      byCondition.get(r.condition).push(r);
    }

    const conditionBlocks = [...byCondition.entries()]
      // Config order, so `clean` always reads first.
      .sort((a, b) => conditionOrder(a[0]) - conditionOrder(b[0]))
      .map(([condition, rs]) => {
        let audio = null;
        let sizeBytes = null;
        let peaks = null;
        const src = rs.find((r) => r.audio_path)?.audio_path;
        if (src) {
          const abs = join(REPO, src);
          if (existsSync(abs)) {
            const data = readFileSync(abs);
            // Content-hashed name: cache-safe, and identical audio is never
            // copied twice under two names.
            const name = `${p.id}--${condition}--${sha8(data)}.wav`;
            const dest = join(PATHS.outAudio, name);
            if (!existsSync(dest)) {
              copyFileSync(abs, dest);
              copied++;
              bytes += data.length;
            }
            keep.add(name);
            audio = `audio/${name}`;
            sizeBytes = data.length;
            peaks = waveformPeaks(data);
          } else {
            // Source gone, but this checkout may already carry the committed
            // bundle. The hash in the name cannot be recomputed without the
            // source, so match on the (utterance, condition) prefix.
            const prefix = `${p.id}--${condition}--`;
            const already = existingAudio.find((f) => f.startsWith(prefix));
            if (already) {
              keep.add(already);
              audio = `audio/${already}`;
              const abs2 = join(PATHS.outAudio, already);
              sizeBytes = statSync(abs2).size;
              peaks = waveformPeaks(readFileSync(abs2));
              reused++;
            } else {
              missingAudio.push(src);
            }
          }
        }
        return {
          condition,
          audio,
          sizeBytes,
          peaks,
          durationS: conditions.find((c) => c.name === condition)?.durationS ?? null,
          results: rs.map((r) => ({
            model: r.asr_model ?? "-",
            mode: r.asr_mode ?? null,
            hypothesis: r.hypothesis,
            wer: r.wer,
            error: r.error ?? null,
            entities: r.entities.map((e) => ({
              type: e.type,
              expected: e.expected,
              expectedSurface: e.expected_surface,
              found: e.found,
              foundSurface: e.found_surface,
              hit: e.hit,
              editDistance: e.edit_distance,
              // Digits or spelled out -- the finding, surfaced per transcript
              // so the listen section can mark it without recomputing.
              rendering: renderingOf(r.hypothesis, {
                expected: e.expected, hit: e.hit,
              }),
            })),
          })),
        };
      });

    return {
      utteranceId: p.id,
      language: utt?.language ?? first.language,
      text,
      gloss: utt?.gloss ?? null,
      templateId: utt?.template_id ?? first.template_id ?? null,
      realization: utt?.realization ?? first.realization ?? null,
      domain: utt?.domain ?? null,
      codeMixed: Boolean(utt?.meta?.code_mixed),
      entities: entitySpans(text, utt?.entities ?? []),
      conditions: conditionBlocks,
    };
  });

  // Prune anything the page no longer references, so a shrinking listen set
  // does not leave orphaned audio in the deployed bundle.
  let pruned = 0;
  for (const f of existingAudio) {
    if (!keep.has(f)) { rmSync(join(PATHS.outAudio, f)); pruned++; }
  }

  if (missingAudio.length) {
    const detail =
      `${missingAudio.length} audio file(s) referenced by results are not on disk:\n` +
      missingAudio.map((m) => `    ${m}`).join("\n") +
      `\n\n  The listen section is the centrepiece; shipping it with silent gaps` +
      `\n  is worse than not shipping. Neither .tee/work/ nor a matching file in` +
      `\n  site/public/audio/ was found. Run this build on the machine that ran` +
      `\n  the harness and commit site/public/audio/, or re-run the harness.` +
      `\n  To build anyway (no audio), set GINTI_ALLOW_MISSING_AUDIO=1.`;
    if (!ALLOW_MISSING_AUDIO) throw new Error(detail);
    warn(`BUILT WITHOUT AUDIO -- ${detail.split("\n")[0]}`);
  }

  if (listen.some((l) => l.gloss === null)) {
    warn(
      "some utterances have no English gloss; regenerate the corpus after " +
      "adding `gloss:` to src/tee/templates/<lang>.yaml"
    );
  }

  // --- runs -----------------------------------------------------------------
  const runs = [...new Set(rows.map((r) => r.run_id))].sort().map((runId) => {
    const rs = rows.filter((r) => r.run_id === runId);
    return {
      runId,
      source: rs[0]._source,
      asrImpls: [...new Set(rs.map((r) => r.asr_impl))].sort(),
      models: [...new Set(rs.map((r) => r.asr_model ?? "-"))].sort(),
      modes: [...new Set(rs.map((r) => r.asr_mode ?? "-"))].sort(),
      languages: [...new Set(rs.map((r) => r.language))].sort(),
      conditions: [...new Set(rs.map((r) => r.condition))],
      nUtterances: new Set(rs.map((r) => r.utterance_id)).size,
      nRows: rs.length,
      nEntities: rs.reduce((a, r) => a + r.entities.length, 0),
      nErrors: rs.filter((r) => r.error).length,
    };
  });

  const totalEntities = rows.reduce((a, r) => a + r.entities.length, 0);
  const totalHits = rows.reduce(
    (a, r) => a + r.entities.filter((e) => e.hit).length, 0);

  const data = {
    generatedAt: new Date().toISOString(),
    project: {
      name: "Ginti",
      script: "गिनती",
      tagline: "Does the number survive the phone line?",
      repo: repoUrl(),
    },
    provenance: {
      isMock,
      asrImpls: impls,
      warnings,
      sourceFiles: {
        results: listJsonl(PATHS.results).map((f) => basename(f)),
        corpora: listJsonl(PATHS.corpora).map((f) => basename(f)),
        config: basename(PATHS.config),
      },
    },
    runs,
    models,
    modes,
    conditions,
    entityTypes: [...new Set(rows.flatMap((r) => r.entities.map((e) => e.type)))].sort(),
    summary: {
      utterances: new Set(rows.map((r) => r.utterance_id)).size,
      rows: rows.length,
      entities: totalEntities,
      hits: totalHits,
      hitRate: totalEntities ? totalHits / totalEntities : null,
      conditions: conditionsInResults.length,
      models: models.length,
    },
    matrix: hitRateMatrix(rows),
    lowNThreshold: LOW_N,
    wer: werAggregate(rows),
    rendering: renderingTable(rows),
    // Derived so the prose can state what happened without anyone typing a
    // finding into a component. With one model, or none of these effects, the
    // page says less rather than saying something untrue.
    renderingStats: (() => {
      const rt = renderingTable(rows);
      const disagreements = rt.filter(
        (r) => new Set(r.models.map((m) => m.rendering)).size > 1).length;
      const seen = new Map();
      for (const r of rt) {
        for (const m of r.models) {
          const k = `${r.utteranceId}|${m.model}`;
          if (!seen.has(k)) seen.set(k, new Set());
          seen.get(k).add(m.rendering);
        }
      }
      const selfFlips = [...seen.values()].filter((v) => v.size > 1).length;
      const rewrote = rt.reduce((a, r) => a + r.models.filter(
        (m) => m.rendering !== r.referenceRendering
          && m.rendering !== "absent" && m.rendering !== "n/a").length, 0);
      return { pairs: rt.length, disagreements, selfFlips, rewrote,
               models: models.length };
    })(),
    werSpread: (() => {
      // The headline of the results section: how far WER moves on identical
      // audio, purely from how each side chose to write the number.
      const vals = rows.map((r) => ({ wer: r.wer, model: r.asr_model, id: r.utterance_id }));
      if (!vals.length) return null;
      const min = vals.reduce((a, b) => (b.wer < a.wer ? b : a));
      const max = vals.reduce((a, b) => (b.wer > a.wer ? b : a));
      return { min, max };
    })(),
    listen,
    method: {
      seed: cfg.seed,
      audio: cfg.audio,
      scoring: cfg.scoring,
      cost: cfg.cost,
      asr: cfg.providers?.asr ?? {},
      tts: cfg.providers?.tts ?? {},
      tools: Object.values(commandsByCondition)[0]?.tools ?? {},
    },
    content,
    // The headline pair. Both describe the same audio and disagree completely;
    // that disagreement is the argument, so it is derived here and never typed.
    // The controlled comparison: conditions that differ ONLY in whether loss
    // is clustered. Same nominal rate, same source audio, same codec chain.
    lossPairs: (() => {
      const cellsFor = (cond, type) => {
        const cs = hitRateMatrix(rows).filter(
          (m) => m.condition === cond && (!type || m.entityType === type));
        return {
          hits: cs.reduce((a, c) => a + c.hits, 0),
          total: cs.reduce((a, c) => a + c.total, 0),
        };
      };
      const werFor = (cond) => {
        const v = rows.filter((r) => r.condition === cond).map((r) => r.wer);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      };

      // Pair a bernoulli condition with the gilbert one at the same rate.
      const loss = cfg.conditions
        .map((c) => ({ c, op: c.chain.find((o) => o.op === "packet_loss") }))
        .filter((x) => x.op && conditionsInResults.includes(x.c.name));

      const pairs = [];
      for (const a of loss.filter((x) => (x.op.model ?? "bernoulli") === "bernoulli")) {
        for (const b of loss.filter((x) => x.op.model === "gilbert")) {
          if (a.op.rate !== b.op.rate) continue;
          if ((b.op.fill ?? "silence") !== (a.op.fill ?? "silence")) continue;
          pairs.push({
            rate: a.op.rate,
            meanBurstMs: b.op.mean_burst_ms ?? null,
            scattered: {
              condition: a.c.name, ...cellsFor(a.c.name, null),
              wer: werFor(a.c.name),
              accounts: cellsFor(a.c.name, "account_number"),
            },
            bursty: {
              condition: b.c.name, ...cellsFor(b.c.name, null),
              wer: werFor(b.c.name),
              accounts: cellsFor(b.c.name, "account_number"),
            },
          });
        }
      }
      // Widest gap first: that is the pair the page should lead with.
      pairs.sort((x, y) =>
        (y.scattered.hits / y.scattered.total - y.bursty.hits / y.bursty.total) -
        (x.scattered.hits / x.scattered.total - x.bursty.hits / x.bursty.total));
      return pairs;
    })(),

    headline: (() => {
      // WER is reported per model, pooled over conditions, because that is
      // where the variance actually is: across conditions it moves by about
      // 0.015, and between models by about 0.25 on identical audio. A range
      // over model-condition pairs blends the two and implies the phone line
      // is doing something it is not.
      const byModel = new Map();
      for (const r of rows) {
        const k = r.asr_model ?? "-";
        if (!byModel.has(k)) byModel.set(k, []);
        byModel.get(k).push(r.wer);
      }
      const werByModel = [...byModel.entries()]
        .map(([model, v]) => ({ model, wer: v.reduce((a, b) => a + b, 0) / v.length,
                                n: v.length }))
        .sort((a, b) => a.wer - b.wer);

      const byCondition = new Map();
      for (const r of rows) {
        const k = r.condition;
        if (!byCondition.has(k)) byCondition.set(k, []);
        byCondition.get(k).push(r.wer);
      }
      const werByCondition = [...byCondition.values()]
        .map((v) => v.reduce((a, b) => a + b, 0) / v.length);

      return {
        hits: totalHits,
        entities: totalEntities,
        hitRate: totalEntities ? totalHits / totalEntities : null,
        werByModel,
        werConditionMin: werByCondition.length ? Math.min(...werByCondition) : null,
        werConditionMax: werByCondition.length ? Math.max(...werByCondition) : null,
        conditions: conditionsInResults.length,
        declaredConditions: cfg.conditions.length,
        models: models.length,
        modes,
        languages: [...new Set(rows.map((r) => r.language))].sort(),
        utterances: new Set(rows.map((r) => r.utterance_id)).size,
      };
    })(),
    audioBundle: { files: copied, bytes },
  };

  assertNoStaleSurvivalClaim(data);

  mkdirSync(dirname(PATHS.outData), { recursive: true });
  writeFileSync(PATHS.outData, JSON.stringify(data, null, 2));

  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(
    `  audio: ${copied} copied (${kb(bytes)}), ${reused} reused from the ` +
    `committed bundle, ${pruned} pruned`);
  console.log(`  data.json: ${kb(statSync(PATHS.outData).size)}`);
  console.log(
    `  models=${models.join(",")} modes=${modes.join(",")} ` +
    `conditions=${conditionsInResults.length} ` +
    `utterances=${data.summary.utterances} listen=${listen.length}`);
  if (warnings.length) {
    console.log(`  ${warnings.length} warning(s) -> data.provenance.warnings`);
  }
}

build();
