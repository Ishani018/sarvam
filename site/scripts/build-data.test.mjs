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
import { droppedFraction, pickExemplar } from "./build-data.mjs";

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
