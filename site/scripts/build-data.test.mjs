/**
 * Tests for the parts of the data build that make a judgement rather than a
 * copy. Run by `npm run check`.
 *
 * The exemplar picker earns a test because it cannot be checked by looking at
 * the page on most checkouts: the manifests it reads live in .tee/work/, which
 * exists only on the machine that ran the harness, so everywhere else the
 * commands are carried forward from the previous build and the picker never
 * runs at all.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  droppedFraction, hitRateMatrix, pickExemplar, renderingTable,
  sharedModeFigures, werAggregate,
} from "./build-data.mjs";

const note = (n) => ({ commands: [{ note: n }] });
const cand = (id, dropped, total) => ({
  id,
  manifest: note(dropped === null ? "encode pcm_mulaw"
    : `dropped ${dropped}/${total} frames`),
  frac: dropped === null ? null : dropped / total,
});

test("droppedFraction reads the count off the frame-gating note", () => {
  assert.equal(droppedFraction(note("dropped 10/200 frames")), 0.05);
  assert.equal(
    droppedFraction(note("dropped 43/183 frames in 10 burst(s), mean 86 ms")),
    43 / 183);
});

test("droppedFraction is null for a condition that drops nothing", () => {
  assert.equal(droppedFraction(note("encode pcm_mulaw")), null);
  assert.equal(droppedFraction({ commands: [] }), null);
  assert.equal(droppedFraction({}), null);
});

test("droppedFraction ignores a note with no frames at all", () => {
  // Guards the divide: a manifest recording 0/0 is meaningless, not 0%.
  assert.equal(droppedFraction(note("dropped 0/0 frames")), null);
});

test("a degenerate file is not shown when a typical one exists", () => {
  // The case that prompted this: a 5% condition whose first file by id
  // happened to drop nothing at all.
  const picked = pickExemplar([
    cand("00000", 0, 183),
    cand("00001", 9, 190),
    cand("00002", 10, 200),
    cand("00003", 11, 205),
    cand("00004", 15, 196),
  ]);
  assert.equal(picked.id, "00002");
});

test("the high tail is avoided as well as the low one", () => {
  const picked = pickExemplar([
    cand("00000", 15, 196),   // 7.7%, what the old first-by-id rule showed
    cand("00001", 10, 200),   // 5.0%
    cand("00002", 4, 196),    // 2.0%
  ]);
  assert.equal(picked.id, "00001");
});

test("ties break on utterance id, so the choice is stable between builds", () => {
  const picked = pickExemplar([
    cand("00009", 8, 100),
    cand("00002", 12, 100),   // equidistant from the median
    cand("00005", 10, 100),
    cand("00007", 12, 100),
  ]);
  assert.equal(picked.id, "00005");

  // With an even number of candidates the median is the lower of the two
  // middles, so that it is always a file that actually exists rather than an
  // average of two that do not. Here that is the 8% file.
  const evenCount = pickExemplar([
    cand("00009", 8, 100),
    cand("00002", 12, 100),
  ]);
  assert.equal(evenCount.id, "00009");
});

test("a condition that drops nothing keeps the first file in id order", () => {
  const picked = pickExemplar([
    cand("00007", null), cand("00001", null), cand("00004", null),
  ]);
  assert.equal(picked.id, "00001");
});

test("files with no loss recorded do not dilute a lossy condition", () => {
  // A manifest that failed to record its gating step must not be treated as
  // 0% and pull the median down.
  const picked = pickExemplar([
    cand("00000", null),
    cand("00001", 9, 190),
    cand("00002", 10, 200),
    cand("00003", 11, 205),
  ]);
  assert.equal(picked.id, "00002");
});

test("a single candidate is returned unchanged", () => {
  assert.equal(pickExemplar([cand("00000", 0, 183)]).id, "00000");
  assert.equal(pickExemplar([cand("00000", null)]).id, "00000");
});

/* -------------------------------------------------------------------------
 * Mode-aware aggregation
 *
 * The build used to refuse to run when two ASR modes were present, because the
 * per-cell aggregations keyed on (model, condition, type) and would average
 * transcribe and verbatim into one number. These tests are what that refusal
 * has been replaced with: they check that mode reaches the key, and that the
 * mode comparison is measured over cells both modes actually cover.
 * ---------------------------------------------------------------------- */

const row = (o = {}) => ({
  utterance_id: o.utt ?? "u1",
  condition: o.cond ?? "clean",
  asr_model: o.model ?? "saaras:v3",
  asr_mode: o.mode ?? "transcribe",
  language: "hi-IN",
  reference: o.ref ?? "संदर्भ",
  hypothesis: o.hyp ?? "अनुमान",
  wer: o.wer ?? 0.5,
  realization: o.realization ?? "words",
  entities: o.entities ?? [
    { type: "currency", expected: "INR:1400.00", expected_surface: "चौदह सौ",
      hit: o.hit ?? true, found: null, found_surface: null, edit_distance: 0 },
  ],
});

test("the matrix keys on mode, so two modes never pool into one cell", () => {
  const cells = hitRateMatrix([
    row({ mode: "transcribe", hit: true }),
    row({ mode: "verbatim", hit: false }),
  ]);
  assert.equal(cells.length, 2);
  const byMode = Object.fromEntries(cells.map((c) => [c.mode, c]));
  assert.equal(byMode.transcribe.rate, 1);
  assert.equal(byMode.verbatim.rate, 0);
  // The bug this replaces: one cell at 0.5, describing neither reading.
  assert.ok(!cells.some((c) => c.rate === 0.5));
});

test("word error rate keys on mode too", () => {
  const w = werAggregate([
    row({ mode: "transcribe", wer: 0.4 }),
    row({ mode: "verbatim", wer: 0.8 }),
  ]);
  assert.equal(w.length, 2);
  assert.deepEqual(w.map((r) => r.wer).sort(), [0.4, 0.8]);
});

test("rendering rows split by mode rather than stacking modes in `models`", () => {
  const rt = renderingTable([
    row({ mode: "transcribe" }),
    row({ mode: "verbatim" }),
  ]);
  assert.equal(rt.length, 2);
  assert.deepEqual(rt.map((r) => r.mode).sort(), ["transcribe", "verbatim"]);
  // Each row compares models WITHIN one mode; mixing them would put the row's
  // own premise -- whether the recogniser rewrites numbers -- on both sides.
  for (const r of rt) assert.equal(r.models.length, 1);
});

test("a single mode still produces one row per cell", () => {
  const cells = hitRateMatrix([row({ model: "saaras:v3" }), row({ model: "saaras:v4" })]);
  assert.equal(cells.length, 2);
  assert.deepEqual([...new Set(cells.map((c) => c.mode))], ["transcribe"]);
});

test("modes are compared over the cells both actually ran", () => {
  // transcribe ran two conditions, verbatim only the hard one. Pooling each
  // mode over its own rows would score transcribe on an easy average and
  // verbatim on a hard subset, and read the difference as a mode effect.
  const rows = [
    row({ mode: "transcribe", cond: "clean", hit: true }),
    row({ mode: "transcribe", cond: "burst", hit: false }),
    row({ mode: "verbatim", cond: "burst", hit: true }),
  ];
  const [t, v] = sharedModeFigures(rows, ["transcribe", "verbatim"], "transcribe");
  assert.equal(t.coverage.sharedCells, 1);
  assert.equal(t.entities, 1);
  assert.equal(t.hits, 0);          // the burst cell only
  assert.equal(v.hits, 1);
  assert.equal(t.coverage.ownCells, 2);
  assert.equal(v.coverage.ownCells, 1);
  assert.deepEqual(v.coverage.conditions, ["burst"]);
  assert.equal(t.isPrimary, true);
  assert.equal(v.isPrimary, false);
});

test("with no overlap at all the comparison is empty rather than invented", () => {
  const rows = [
    row({ mode: "transcribe", cond: "clean" }),
    row({ mode: "verbatim", cond: "burst" }),
  ];
  const figures = sharedModeFigures(rows, ["transcribe", "verbatim"], "transcribe");
  for (const f of figures) {
    assert.equal(f.coverage.sharedCells, 0);
    assert.equal(f.entities, 0);
    assert.equal(f.hitRate, null);
  }
});

test("one mode compares against itself without narrowing anything", () => {
  const rows = [row({ cond: "clean" }), row({ cond: "burst" })];
  const [only] = sharedModeFigures(rows, ["transcribe"], "transcribe");
  assert.equal(only.coverage.sharedCells, 2);
  assert.equal(only.entities, 2);
  assert.equal(only.isPrimary, true);
});
