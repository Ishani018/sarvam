"""What a number *is*, and whether the line carried it.

Every measurement on this project so far asks whether the digits survived. A
number in speech carries two things, though, and only one of them is digits:

    "आपके खाते में चौदह सौ रुपये जमा हुए हैं"
     ^^^^^^^^^^^^              ^^^^^^^^^^^^
     what kind of number        what kind of number
                   ^^^^^^^^^^
                   the number itself

Burst loss does not know the difference. It removes 20 ms windows, and the
words that say "this is money" are as destructible as the words that say
"fourteen hundred". When the value survives and its cue does not, the transcript
contains a correct number that nothing in it identifies -- and any consumer
parsing that transcript by context, which is every consumer, cannot type it
either.

This module measures that directly, and deliberately does not go through the
extractor to do it. Two figures:

  cue survival    of the type-identifying words in the reference, how many
                  appear in the hypothesis -- reported against the survival
                  rate of ordinary words, so "cues are destroyed" can be
                  compared with "everything is destroyed" rather than asserted

  orphaned values a gold value that IS recoverable from the hypothesis while
                  no cue for its type survives. The number came through and
                  its meaning did not.

An orphan is a fact about the transcript, not a verdict on the extractor: it is
counted whether or not this extractor happened to recover the entity anyway,
and the report says which. That separation matters, because the two numbers
answer different questions -- how often the line strips a number of its
identity, and how often our extractor needs the cue to do its job.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Iterable, Sequence

from .entities import extract
from .numwords import canonicalize, folded_text, load_lexicon, tokenize_spans
from .score import ScoreRow

#: Types whose gold value can be recovered from a bare digit run by shape
#: alone. `currency` is deliberately absent: any length can be an amount, so
#: the extractor has no shape to fall back on and the cue is load-bearing.
#: See SHAPES in entities.py -- this mirrors it by intent, not by import,
#: because the question here is "is this type identifiable without context",
#: which is a property of the type rather than of one extractor.
SHAPED_TYPES = frozenset({"account_number", "otp", "pin_code"})


def cue_index(language: str) -> dict[str, frozenset[str]]:
    """Canonical cue token -> the entity types it identifies.

    One token can serve several types ("कोड" is an OTP cue, and the second
    half of "पिन कोड"), so the value is a set rather than a single type.
    """
    lex = load_lexicon(language)
    out: dict[str, set[str]] = {}
    for tok in lex.currency_cues:
        out.setdefault(tok, set()).add("currency")
    # The extractor treats the symbol as a currency cue without going through
    # the lexicon (see _currency_cue), so this index has to as well or a
    # transcript that wrote ₹ would be scored as having lost the cue.
    for sym in ("₹", "rs"):
        out.setdefault(canonicalize(sym), set()).add("currency")
    for etype, toks in lex.entity_cues.items():
        for tok in toks:
            out.setdefault(tok, set()).add(etype)
    return {k: frozenset(v) for k, v in out.items()}


def _canon_tokens(text: str, language: str) -> list[str]:
    return [canonicalize(t.text) for t in tokenize_spans(folded_text(text))]


def _cued(cues: Counter, index: dict[str, frozenset[str]], etype: str) -> bool:
    """Does this bag of cue tokens identify ``etype`` at all?"""
    return any(etype in index[t] for t in cues)


def _cues_in(tokens: Sequence[str], index: dict[str, frozenset[str]]) -> Counter:
    """Cue tokens present, as a multiset. A sentence may carry the same cue
    twice and losing one of them is half a loss, not none."""
    return Counter(t for t in tokens if t in index)


@dataclass(frozen=True)
class Orphan:
    """A value that survived the line without the words that say what it is."""

    utterance_id: str
    condition: str
    model: str
    entity_type: str
    expected: str
    #: Cues for this type that the reference carried, and how many survived.
    cues_expected: int
    cues_survived: int
    #: Whether the extractor still produced this entity. An orphan the
    #: extractor recovered is a fact about the transcript; one it did not is
    #: also a fact about the extractor's cue dependence.
    extractor_recovered: bool


@dataclass
class ConditionCues:
    condition: str
    #: Cue tokens in the reference, and how many of them reached the hypothesis.
    cue_total: int = 0
    cue_kept: int = 0
    #: The same for every other token, as the baseline the cue rate is read
    #: against.
    word_total: int = 0
    word_kept: int = 0
    #: Gold entities whose value is recoverable from the hypothesis.
    value_present: int = 0
    orphans: int = 0
    orphans_unrecovered: int = 0
    by_type: Counter = field(default_factory=Counter)

    @property
    def cue_survival(self) -> float | None:
        return self.cue_kept / self.cue_total if self.cue_total else None

    @property
    def word_survival(self) -> float | None:
        return self.word_kept / self.word_total if self.word_total else None

    @property
    def orphan_rate(self) -> float | None:
        return self.orphans / self.value_present if self.value_present else None


def _recoverable_values(text: str, language: str) -> frozenset[str]:
    """Every normalized value the hypothesis yields, under any type.

    Any type, not just the gold's: the whole point is that a value can be
    present while its type is not readable, in which case the extractor has
    typed it as something else. Computed once per row -- it is the expensive
    call in this module and it does not depend on the entity.
    """
    return frozenset(c.normalized for c in extract(text, language, types=None))


def analyse(rows: Iterable[ScoreRow]) -> list[ConditionCues]:
    """Per-condition cue survival and orphan counts."""
    by_cond: dict[str, ConditionCues] = {}
    for row in rows:
        if row.error or not row.hypothesis.strip():
            continue
        index = cue_index(row.language)
        ref = _canon_tokens(row.reference, row.language)
        hyp = _canon_tokens(row.hypothesis, row.language)

        cues_ref = _cues_in(ref, index)
        cues_hyp = _cues_in(hyp, index)
        # Multiset intersection: two of a cue in the reference and one in the
        # hypothesis is one survivor, not two and not none.
        kept = cues_ref & cues_hyp

        words_ref = Counter(t for t in ref if t and t not in index)
        words_kept = words_ref & Counter(t for t in hyp if t and t not in index)

        agg = by_cond.setdefault(row.condition, ConditionCues(row.condition))
        agg.cue_total += sum(cues_ref.values())
        agg.cue_kept += sum(kept.values())
        agg.word_total += sum(words_ref.values())
        agg.word_kept += sum(words_kept.values())

        present = _recoverable_values(row.hypothesis, row.language)
        for e in row.entities:
            if e.expected not in present:
                continue
            agg.value_present += 1
            if not _cued(cues_ref, index, e.type):
                # The reference never identified this entity by a cue word, so
                # there was nothing for the line to destroy. Not an orphan.
                continue
            # Identifiability is a question about the type, not about one word:
            # a transcript that answers रुपये with ₹, or खाते with खाता, still
            # says what the number is. Requiring the same token back would
            # count the recogniser's own vocabulary as damage -- and does, on
            # clean audio, which is why the report prints clean alongside.
            if _cued(cues_hyp, index, e.type):
                continue
            agg.orphans += 1
            agg.by_type[e.type] += 1
            if not e.hit:
                agg.orphans_unrecovered += 1

    return sorted(by_cond.values(), key=lambda c: c.condition)


def orphans(rows: Iterable[ScoreRow]) -> list[Orphan]:
    """Every orphaned value, for reading one at a time."""
    out: list[Orphan] = []
    for row in rows:
        if row.error or not row.hypothesis.strip():
            continue
        index = cue_index(row.language)
        cues_ref = _cues_in(_canon_tokens(row.reference, row.language), index)
        cues_hyp = _cues_in(_canon_tokens(row.hypothesis, row.language), index)
        kept = cues_ref & cues_hyp
        present = _recoverable_values(row.hypothesis, row.language)
        for e in row.entities:
            want = {t for t in cues_ref if e.type in index[t]}
            if not want or _cued(cues_hyp, index, e.type):
                continue
            if e.expected not in present:
                continue
            expected = sum(cues_ref[t] for t in want)
            survived = 0
            out.append(Orphan(
                utterance_id=row.utterance_id,
                condition=row.condition,
                model=row.asr_model or "-",
                entity_type=e.type,
                expected=e.expected,
                cues_expected=expected,
                cues_survived=survived,
                extractor_recovered=e.hit,
            ))
    return out


def render(stats: Sequence[ConditionCues], found: Sequence[Orphan]) -> str:
    out: list[str] = []
    out.append("=" * 78)
    out.append("CUE SURVIVAL")
    out.append("=" * 78)
    out.append("")
    out.append("Of the words that say what a number IS, how many reach the")
    out.append("transcript -- against the survival rate of every other word, so")
    out.append("the two can be compared rather than one asserted.")
    out.append("")
    out.append(f"  {'condition':28s} {'cues':>12s} {'other words':>12s} "
               f"{'orphaned':>12s}")
    out.append("  " + "-" * 68)
    for c in stats:
        cue = f"{c.cue_survival:.3f}" if c.cue_survival is not None else "-"
        word = f"{c.word_survival:.3f}" if c.word_survival is not None else "-"
        orph = (f"{c.orphans}/{c.value_present}"
                if c.value_present else "-")
        out.append(f"  {c.condition:28s} {cue:>12s} {word:>12s} {orph:>12s}")
    out.append("")

    total_orphans = sum(c.orphans for c in stats)
    unrecovered = sum(c.orphans_unrecovered for c in stats)
    present = sum(c.value_present for c in stats)
    out.append(f"{total_orphans} of {present} recoverable values reached the "
               f"transcript with no")
    out.append(f"surviving word identifying their type. Of those, {unrecovered} "
               f"were not scored as")
    out.append("hits: the rest this extractor recovered by other means. The "
               "first number is")
    out.append("a property of the line; the second is this extractor's "
               "dependence on cues.")
    out.append("")

    by_type = Counter()
    for c in stats:
        by_type.update(c.by_type)
    if by_type:
        out.append("ORPHANS BY TYPE")
        for etype, n in by_type.most_common():
            shape = "" if etype in SHAPED_TYPES else "   (no shape to fall back on)"
            out.append(f"  {n:4d}  {etype}{shape}")
        out.append("")

    if found:
        out.append("=" * 78)
        out.append(f"ORPHANED VALUES  ({len(found)})")
        out.append("=" * 78)
        for o in sorted(found, key=lambda x: (x.entity_type, x.condition,
                                              x.utterance_id)):
            mark = "recovered anyway" if o.extractor_recovered else "MISSED"
            out.append("")
            out.append(f"[{o.utterance_id}] {o.condition}  model={o.model}")
            out.append(f"  type        {o.entity_type}   gold {o.expected}")
            out.append(f"  cues        0 of {o.cues_expected} survived")
            out.append(f"  extractor   {mark}")
    out.append("")
    return "\n".join(out)
