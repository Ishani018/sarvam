"""Separating mishearing from renaming.

Under ``transcribe`` Sarvam applies its own number normalization, so a missed
entity is ambiguous: the model may have misheard a digit, or it may have heard
it perfectly and written it in a form the extractor scored as different. Those
are completely different problems -- one is an acoustic limit, the other is a
formatting contract -- and a single hit rate cannot tell them apart.

``verbatim`` returns the words as spoken, with no normalization. Running both
modes over byte-identical audio makes the split observable: pair every miss
with its verbatim twin and ask whether the value was there all along.

    acoustic   wrong in verbatim too -- the audio genuinely did not carry it
    rendering  right in verbatim, wrong in transcribe -- the normalizer moved it
    unpaired   no verbatim row for this audio, so no claim is made

`unpaired` is deliberately a category rather than a default. Silently folding
unpairable misses into `acoustic` would inflate the more alarming number
exactly when the run was incomplete.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Iterable, Sequence

from .score import ScoreRow

TRANSCRIBE = "transcribe"
VERBATIM = "verbatim"

Kind = str  # "acoustic" | "rendering" | "unpaired"


@dataclass(frozen=True)
class MissSplit:
    """One transcribe miss, and what verbatim said about the same audio."""

    utterance_id: str
    condition: str
    model: str
    entity_type: str
    expected: str
    transcribe_found: str | None
    verbatim_found: str | None
    kind: Kind


@dataclass
class ConditionSplit:
    condition: str
    scored: int = 0
    hits: int = 0
    acoustic: int = 0
    rendering: int = 0
    unpaired: int = 0
    by_type: Counter = field(default_factory=Counter)

    @property
    def misses(self) -> int:
        return self.acoustic + self.rendering + self.unpaired

    @property
    def hit_rate(self) -> float | None:
        return self.hits / self.scored if self.scored else None

    @property
    def classified(self) -> int:
        """Misses we can actually attribute. The denominator for the split."""
        return self.acoustic + self.rendering


def _key(r: ScoreRow) -> tuple[str, str, str]:
    return (r.utterance_id, r.condition, r.asr_model or "-")


def classify_misses(rows: Sequence[ScoreRow]) -> list[MissSplit]:
    """Pair every transcribe miss with its verbatim twin and attribute it.

    Pairing is on (utterance, condition, model): the same audio through the
    same recogniser, differing only in mode. Anything else would compare
    different recordings and the answer would mean nothing.
    """
    verbatim: dict[tuple[str, str, str], ScoreRow] = {}
    for r in rows:
        if r.asr_mode == VERBATIM:
            verbatim[_key(r)] = r

    out: list[MissSplit] = []
    for r in rows:
        if r.asr_mode != TRANSCRIBE:
            continue
        twin = verbatim.get(_key(r))
        twin_by_type = {}
        if twin is not None:
            # A type can legitimately appear twice in one utterance; pair on
            # the expected value so the twin compared is the same entity.
            twin_by_type = {(e.type, e.expected): e for e in twin.entities}

        for e in r.entities:
            if e.hit:
                continue
            if twin is None:
                kind, vfound = "unpaired", None
            else:
                match = twin_by_type.get((e.type, e.expected))
                if match is None:
                    kind, vfound = "unpaired", None
                else:
                    kind = "rendering" if match.hit else "acoustic"
                    vfound = match.found
            out.append(MissSplit(
                utterance_id=r.utterance_id,
                condition=r.condition,
                model=r.asr_model or "-",
                entity_type=e.type,
                expected=e.expected,
                transcribe_found=e.found,
                verbatim_found=vfound,
                kind=kind,
            ))
    return out


def split_by_condition(rows: Sequence[ScoreRow]) -> list[ConditionSplit]:
    """The per-condition table. Ordered by how much rendering explains."""
    splits: dict[str, ConditionSplit] = {}
    for r in rows:
        if r.asr_mode != TRANSCRIBE:
            continue
        s = splits.setdefault(r.condition, ConditionSplit(condition=r.condition))
        s.scored += len(r.entities)
        s.hits += sum(1 for e in r.entities if e.hit)

    for m in classify_misses(rows):
        s = splits.setdefault(m.condition, ConditionSplit(condition=m.condition))
        setattr(s, m.kind, getattr(s, m.kind) + 1)
        s.by_type[(m.entity_type, m.kind)] += 1

    return sorted(splits.values(), key=lambda s: (-s.rendering, s.condition))


def render(splits: Iterable[ConditionSplit]) -> str:
    """A table, and a plain statement of what it shows."""
    splits = list(splits)
    if not splits:
        return ("No transcribe rows found. This report needs a run carrying "
                "both modes: `tee run --modes transcribe,verbatim`.")

    total = ConditionSplit(condition="ALL")
    for s in splits:
        total.scored += s.scored
        total.hits += s.hits
        total.acoustic += s.acoustic
        total.rendering += s.rendering
        total.unpaired += s.unpaired

    lines = [
        "Why entities missed under transcribe, checked against verbatim on the",
        "same audio.",
        "",
        f"  {'condition':28} {'scored':>7} {'hit':>7} "
        f"{'acoustic':>9} {'rendering':>10} {'unpaired':>9}",
        f"  {'-' * 28} {'-' * 7} {'-' * 7} {'-' * 9} {'-' * 10} {'-' * 9}",
    ]
    for s in splits:
        lines.append(
            f"  {s.condition:28} {s.scored:7d} {s.hits:7d} "
            f"{s.acoustic:9d} {s.rendering:10d} {s.unpaired:9d}")
    lines += [
        f"  {'-' * 28} {'-' * 7} {'-' * 7} {'-' * 9} {'-' * 10} {'-' * 9}",
        f"  {total.condition:28} {total.scored:7d} {total.hits:7d} "
        f"{total.acoustic:9d} {total.rendering:10d} {total.unpaired:9d}",
        "",
    ]

    if total.classified:
        pct = 100.0 * total.rendering / total.classified
        lines.append(
            f"  Of {total.classified} attributable misses, {total.rendering} "
            f"({pct:.0f}%) were right in verbatim and lost in normalization;")
        lines.append(
            f"  {total.acoustic} ({100 - pct:.0f}%) were wrong in both, so the "
            f"audio did not carry them.")
    else:
        lines.append("  No attributable misses: nothing missed, or nothing paired.")

    if total.unpaired:
        lines += [
            "",
            f"  {total.unpaired} miss(es) had no verbatim row for the same audio "
            f"and are not",
            "  attributed either way. They are not counted in the percentages "
            "above.",
        ]
    return "\n".join(lines)
