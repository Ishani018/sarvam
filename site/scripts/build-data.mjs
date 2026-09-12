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
    return real;
  }
  console.log(`  results: ${all.length} rows from ${files.length} file(s)`);
  return all;
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
    out[basename(f, ".md")] = readFileSync(join(PATHS.content, f), "utf8");
  }
  console.log(`  content: ${Object.keys(out).length} markdown file(s)`);
  return out;
}

/** The recorded argv for each condition, lifted from one manifest that used it.
 *  This is what actually ran -- not a restatement of the config. */
function loadCommandsByCondition(rows) {
  const out = {};
  for (const r of rows) {
    if (!r.audio_path || out[r.condition]) continue;
    const manifest = join(REPO, `${r.audio_path}.manifest.json`);
    if (!existsSync(manifest)) continue;
    try {
      const m = JSON.parse(readFileSync(manifest, "utf8"));
      out[r.condition] = {
        commands: (m.commands ?? []).map((c) => ({
          argv: c.argv,
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
  return out;
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
      // Below this, a rate is an anecdote and the page must show it as one.
      // A green 1.000 off a single sample is actively misleading.
      lowN: v.total < 5,
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

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

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
  rmSync(PATHS.outAudio, { recursive: true, force: true });
  mkdirSync(PATHS.outAudio, { recursive: true });

  const picked = pickListenSet(rows, LISTEN_LIMIT);
  let copied = 0;
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
            audio = `audio/${name}`;
            sizeBytes = data.length;
          } else {
            warn(`missing audio referenced by results: ${src}`);
          }
        }
        return {
          condition,
          audio,
          sizeBytes,
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

  if (listen.some((l) => l.gloss === null)) {
    warn(
      "no English gloss available: the corpus has no `gloss` field. Add one to " +
      "src/tee/templates/<lang>.yaml and regenerate, or the listen section " +
      "ships Hindi with no translation."
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
    wer: werAggregate(rows),
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
    audioBundle: { files: copied, bytes },
  };

  mkdirSync(dirname(PATHS.outData), { recursive: true });
  writeFileSync(PATHS.outData, JSON.stringify(data, null, 2));

  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`  audio: ${copied} file(s), ${kb(bytes)} into public/audio/`);
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
