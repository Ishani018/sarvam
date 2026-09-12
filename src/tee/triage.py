"""Miss triage: separate my bugs from real results.

The first real run is expected to be dominated by extractor errors. Only the
asr_error bucket is a finding; the other two are work items. Sorting misses
into those buckets is the whole point of the calibration run, so the
classifier's own uncertainty is surfaced rather than hidden -- anything it
cannot decide confidently is bucketed `uncertain` for human review.

The heuristic runs in this order, because each step presupposes the last:

  1. Is the gold recoverable from the REFERENCE text? If not, the gold value or
     the generated sentence is wrong -> gold_error. This is checked first
     because a bad gold makes the other two questions meaningless.
  2. Is the gold value actually present in the HYPOTHESIS? If it is, the ASR did
     its job and the extractor failed to find or normalize it
     -> extractor_error.
  3. Otherwise the hypothesis genuinely lost or mangled it -> asr_error.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Sequence

from .entities import extract, normalize_currency
from .numwords import (
    NumberParseError, folded_text, load_lexicon, parse_value, tokenize_spans,
)
from .score import EntityScore, ScoreRow, levenshtein

BUCKETS = ("gold_error", "extractor_error", "asr_error", "uncertain")

ALL_TYPES = ["account_number", "currency", "otp", "pin_code", "date"]


@dataclass
class Miss:
    row: ScoreRow
    entity: EntityScore
    bucket: str
    reason: str
    pattern: str
    uncertain: bool = False


def _gold_in_text(gold_type: str, gold_norm: str, text: str, language: str) -> bool:
    """Is this gold value recoverable from ``text`` under its own type?"""
    return any(
        c.normalized == gold_norm
        for c in extract(text, language, types=[gold_type])
    )


def _value_present_anyhow(gold_type: str, gold_norm: str, text: str,
                          language: str) -> tuple[bool, str, bool]:
    """Is the value in ``text`` at all, even if the extractor mistyped it?

    Three increasingly loose checks, because "the extractor failed" has three
    distinct shapes: right value under the wrong type, right digits present but
    never assembled into a candidate, and right magnitude parseable from a run
    the extractor did not treat as an amount.
    """
    everything = extract(text, language, types=ALL_TYPES)
    for c in everything:
        if c.normalized == gold_norm:
            return True, f"present in hypothesis but typed as {c.type!r}", False

    if gold_type in ("account_number", "otp", "pin_code"):
        digits_only = re.sub(r"\D", "", folded_text(text))
        if gold_norm and gold_norm in digits_only:
            # A short value substring-matching inside a longer number is weak
            # evidence -- "1234" appears inside plenty of account numbers -- so
            # short matches are flagged for review rather than counted as a
            # confirmed extractor bug.
            weak = len(gold_norm) < 6
            return True, (
                "digits present in hypothesis (likely fragmented across tokens) "
                "but not extracted"
                + ("; SHORT VALUE, match may be coincidental" if weak else "")
            ), weak

    if gold_type == "currency":
        want = gold_norm.split(":", 1)[1]
        # The amount written as digits, in any grouping. "76,74,000" folds to
        # 7674000 and the check is a substring of the hypothesis' digits.
        as_digits = want.split(".")[0]
        if as_digits and as_digits in re.sub(r"\D", "", folded_text(text)):
            return True, (
                "amount present in the hypothesis as digits but not extracted"
            ), False
        lex = load_lexicon(language)
        tokens = [t.text for t in tokenize_spans(text)]
        for i in range(len(tokens)):
            for j in range(i + 1, min(i + 9, len(tokens)) + 1):
                try:
                    # Lenient on purpose: this probe asks whether the value is
                    # recoverable by ANY reading, which is a different question
                    # from what the extractor is allowed to report.
                    v = parse_value(tokens[i:j], language, strict=False)
                except (NumberParseError, ValueError):
                    continue
                if normalize_currency(v).split(":", 1)[1] == want:
                    return True, "amount parseable from hypothesis but not extracted", False
    return False, "", False


def classify(row: ScoreRow, entity: EntityScore) -> Miss:
    lang = row.language

    if row.error:
        return Miss(row, entity, "uncertain",
                    f"the call itself failed: {row.error}",
                    f"call_error::{row.condition}", uncertain=True)

    if not _gold_in_text(entity.type, entity.expected, row.reference, lang):
        return Miss(row, entity, "gold_error",
                    "gold value is not recoverable from the reference sentence "
                    "either -- the sampler or the template is wrong",
                    f"gold_error::{entity.type}::{row.template_id}")

    present, why, weak = _value_present_anyhow(entity.type, entity.expected,
                                               row.hypothesis, lang)
    if present:
        return Miss(row, entity, "uncertain" if weak else "extractor_error", why,
                    f"{'uncertain' if weak else 'extractor_error'}::{entity.type}"
                    f"::{row.realization}::{row.template_id}",
                    uncertain=weak)

    if not row.hypothesis.strip():
        return Miss(row, entity, "uncertain",
                    "hypothesis is empty -- could be a provider failure rather "
                    "than a transcription failure",
                    f"empty_hypothesis::{row.condition}", uncertain=True)

    # An edit distance of 1 on a long digit string is a classic single-digit
    # substitution: a real ASR error, and the most interesting kind.
    dist = entity.edit_distance
    if entity.found is None:
        return Miss(row, entity, "asr_error",
                    "entity absent from the hypothesis entirely",
                    f"asr_error::{entity.type}::dropped::{row.condition}")
    return Miss(row, entity, "asr_error",
                f"hypothesis carries a different value (edit distance {dist})",
                f"asr_error::{entity.type}::d{dist}::{row.condition}")


def triage(rows: Iterable[ScoreRow]) -> list[Miss]:
    misses: list[Miss] = []
    for row in rows:
        for e in row.entities:
            if not e.hit:
                misses.append(classify(row, e))
    return misses


BUCKET_ORDER = {"extractor_error": 0, "gold_error": 1, "uncertain": 2, "asr_error": 3}


def render_report(rows: Sequence[ScoreRow], misses: Sequence[Miss]) -> str:
    total_entities = sum(len(r.entities) for r in rows)
    hits = sum(1 for r in rows for e in r.entities if e.hit)
    counts = Counter(m.bucket for m in misses)
    patterns = Counter(m.pattern for m in misses)

    out: list[str] = []
    out.append("=" * 78)
    out.append("TRIAGE REPORT")
    out.append("=" * 78)
    run_ids = sorted({r.run_id for r in rows})
    out.append(f"run(s)          {', '.join(run_ids)}")
    out.append(f"rows            {len(rows)}  "
               f"({len({r.utterance_id for r in rows})} utterances x "
               f"{len({r.condition for r in rows})} conditions)")
    impls = sorted({r.asr_impl for r in rows})
    models = sorted({r.asr_model or '-' for r in rows})
    modes = sorted({r.asr_mode or '-' for r in rows})
    out.append(f"asr             {', '.join(impls)}  model={', '.join(models)}  "
               f"mode={', '.join(modes)}")
    out.append("")
    out.append(f"entities        {total_entities}   hits {hits}   misses {len(misses)}"
               f"   hit rate {hits / total_entities if total_entities else 0:.3f}")
    out.append("")
    out.append("MISSES BY CAUSE")
    for bucket in sorted(counts, key=lambda b: BUCKET_ORDER.get(b, 9)):
        label = {
            "extractor_error": "extractor_error  (my bug -- fix me)",
            "gold_error": "gold_error       (my bug -- fix the generator)",
            "asr_error": "asr_error        (a real result)",
            "uncertain": "uncertain        (needs your eyes)",
        }[bucket]
        out.append(f"  {label:48s} {counts[bucket]:4d}")
    out.append("")
    if counts.get("extractor_error") or counts.get("gold_error"):
        out.append("  Extractor and gold errors are bugs, not findings. Only the")
        out.append("  asr_error count is a measurement.")
        out.append("")

    out.append("TOP PATTERNS")
    for pattern, n in patterns.most_common(15):
        out.append(f"  {n:4d}  {pattern}")
    out.append("")

    ordered = sorted(
        misses,
        key=lambda m: (BUCKET_ORDER.get(m.bucket, 9), -patterns[m.pattern],
                       m.pattern, m.row.utterance_id),
    )

    current = None
    for m in ordered:
        if m.bucket != current:
            current = m.bucket
            out.append("=" * 78)
            out.append(f"{m.bucket.upper()}   ({counts[m.bucket]} misses)")
            out.append("=" * 78)
        out.append("")
        out.append(f"[{m.row.utterance_id}] {m.row.condition}"
                   f"   type={m.entity.type}   realization={m.row.realization}"
                   f"   template={m.row.template_id}")
        out.append(f"  reason      {m.reason}")
        out.append(f"  reference   {m.row.reference}")
        out.append(f"  hypothesis  {m.row.hypothesis or '(empty)'}")
        out.append(f"  gold        {m.entity.expected}   (surface: {m.entity.expected_surface!r})")
        out.append(f"  extracted   {m.entity.found or '(nothing of this type)'}"
                   + (f"   (surface: {m.entity.found_surface!r})"
                      if m.entity.found_surface else ""))
        out.append(f"  edit dist   {m.entity.edit_distance}")
        if m.entity.candidates:
            out.append(f"  candidates  {m.entity.candidates}")
        if m.row.audio_path:
            out.append(f"  audio       {m.row.audio_path}")
    out.append("")
    return "\n".join(out)
