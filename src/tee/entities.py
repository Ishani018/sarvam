"""Entity extraction and normalization from an ASR hypothesis.

Phase 2 scope: numbers, currency, OTPs, PIN codes and dates via deterministic
rules over the number lexicon. No model. Person and place names are a stub
interface (:class:`NameExtractor`) awaiting an NER model.

The normalizers here are also what the corpus generator uses to build gold
values -- but the generator calls them on the *sampled value*, never on the
generated sentence. Gold must never be produced by parsing text, or a bug in
this module becomes invisible in the results.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Iterable, Protocol, Sequence

from .numwords import (
    Lexicon,
    NumberParseError,
    Token,
    canonicalize,
    folded_text,
    load_lexicon,
    parse_digit_sequence,
    parse_value,
    tokenize_spans,
)

DIGIT_TYPES = ("account_number", "otp", "pin_code")

#: Shape constraints used when no cue word identifies a bare digit run.
SHAPES: dict[str, tuple[int, int]] = {
    "pin_code": (6, 6),
    "otp": (4, 6),
    "account_number": (9, 18),
}

CUE_LOOKBEHIND = 5
CUE_LOOKAHEAD = 3


@dataclass
class ExtractedEntity:
    """An entity found in a hypothesis. Distinct from the gold
    :class:`~tee.corpus.Entity`: this one carries provenance for debugging."""

    type: str
    surface: str
    normalized: str
    span: tuple[int, int]
    extractor: str = "rule"
    cue: str | None = None

    def as_dict(self) -> dict:
        return {
            "type": self.type,
            "surface": self.surface,
            "normalized": self.normalized,
            "span": list(self.span),
            "extractor": self.extractor,
            "cue": self.cue,
        }


# --------------------------------------------------------------------------
# Normalizers -- the canonical forms scoring compares
# --------------------------------------------------------------------------


def normalize_digit_string(value: str) -> str:
    """Digits only. Separators, spaces and Indic numerals all fold away."""
    return re.sub(r"\D", "", folded_text(str(value)))


def normalize_currency(amount: Decimal | int | float | str, code: str = "INR") -> str:
    """``INR:350000.00``. Fixed 2dp so 350000 and 350000.00 never differ."""
    return f"{code}:{Decimal(str(amount)).quantize(Decimal('0.01'))}"


def normalize_date(year: int | None, month: int, day: int | None) -> str:
    """ISO-8601, with partials allowed: ``2026-03-14``, ``--03-14``, ``2026-03``."""
    y = f"{year:04d}" if year is not None else "-"
    if day is None:
        return f"{y}-{month:02d}" if year is not None else f"--{month:02d}"
    if year is None:
        return f"--{month:02d}-{day:02d}"
    return f"{y}-{month:02d}-{day:02d}"


def normalize_name(value: str) -> str:
    import unicodedata

    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", value).strip()).casefold()


NORMALIZERS = {
    "account_number": normalize_digit_string,
    "otp": normalize_digit_string,
    "pin_code": normalize_digit_string,
    "person_name": normalize_name,
    "place_name": normalize_name,
}


# --------------------------------------------------------------------------
# Name extraction -- stub until an NER model is wired in
# --------------------------------------------------------------------------


class NameExtractor(Protocol):
    """Interface for person/place name extraction.

    TODO(phase 4): wire in an Indic NER model behind this. Keeping it a
    Protocol means score.py never learns whether names came from a model.
    """

    def extract_names(self, text: str, language: str) -> list[ExtractedEntity]: ...


class NullNameExtractor:
    """Finds nothing. The honest default: reporting 0% name accuracy because no
    extractor exists would look like a finding, so name types are excluded from
    scoring.entity_types instead."""

    def extract_names(self, text: str, language: str) -> list[ExtractedEntity]:
        return []


# --------------------------------------------------------------------------
# Rule-based extraction
# --------------------------------------------------------------------------


def _is_numberish(tok: str, lex: Lexicon) -> bool:
    return bool(re.fullmatch(r"\d+(?:\.\d+)?", tok)) or lex.is_number_word(tok)


def _number_runs(tokens: Sequence[Token], lex: Lexicon) -> list[tuple[int, int]]:
    """Maximal consecutive spans of number tokens (digits or number words)."""
    runs: list[tuple[int, int]] = []
    i = 0
    while i < len(tokens):
        if _is_numberish(tokens[i].text, lex):
            j = i
            while j < len(tokens) and _is_numberish(tokens[j].text, lex):
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1
    return runs


def _scan_cue(
    tokens: Sequence[Token], start: int, end: int, lex: Lexicon,
    match, behind: int = CUE_LOOKBEHIND, ahead: int = CUE_LOOKAHEAD,
) -> tuple[str, int] | None:
    """Look for a cue word around a run, stopping at any other number.

    The stop condition is what keeps "खाते 50100234567890 में ₹3,50,000" honest:
    without it the amount's lookbehind reaches past the account number to
    "खाते" and the amount is reported as an account number, or the account
    number's lookahead reaches the ₹ and it is reported as currency.
    """
    best: tuple[str, int] | None = None
    for k in range(start - 1, max(-1, start - behind - 1), -1):
        if _is_numberish(tokens[k].text, lex):
            break
        if match(tokens[k].text):
            best = (tokens[k].text, start - k)
            break
    for k in range(end, min(len(tokens), end + ahead)):
        if _is_numberish(tokens[k].text, lex):
            break
        if match(tokens[k].text):
            dist = k - end + 1
            if best is None or dist < best[1]:
                best = (tokens[k].text, dist)
            break
    return best


def _find_cue(tokens, start, end, cues, lex) -> tuple[str, int] | None:
    return _scan_cue(tokens, start, end, lex, lambda t: canonicalize(t) in cues)


def _currency_cue(tokens, start, end, lex: Lexicon) -> tuple[str, int] | None:
    return _scan_cue(
        tokens, start, end, lex,
        lambda t: t in ("₹", "Rs", "rs") or canonicalize(t) in lex.currency_cues,
    )


def _run_kind(run_text: Sequence[str], lex: Lexicon) -> str:
    """"magnitude" if the run uses scale words or fractional modifiers.

    A magnitude expression ("साढ़े तीन लाख") is a quantity, never a digit string
    read aloud, so it can never be an account number or an OTP. Without this
    distinction a nearby "खाते" cue turns every amount into an account number.
    """
    for t in run_text:
        c = canonicalize(t)
        if c in lex.scales or c in lex.modifiers or c in lex.fraction_values:
            return "magnitude"
    return "digits"


def _amount_from_digits(digits: str) -> Decimal | None:
    """An amount read out one digit at a time, or None if it cannot be one.

    Money is the only scored type with no characteristic length -- an account
    number is 9 to 18 digits, a PIN is 6, an amount is any of them -- so the
    shape fallback that rescues the others cannot rescue currency. When an
    amount is spoken digit by digit ("एक चार शून्य शून्य") the strict value
    parser refuses it, correctly: two values in a row with no scale between
    them is not a magnitude. The digits are still there, though, and a
    neighbouring cue still says they are money.

    The one shape constraint money does have is that it does not start with a
    zero. That rules out most account numbers and OTPs that happen to sit
    beside a financial word, at no cost to real amounts.
    """
    if not digits or (len(digits) > 1 and digits[0] == "0"):
        return None
    return Decimal(digits)


def extract(
    text: str,
    language: str,
    types: Iterable[str] | None = None,
    name_extractor: NameExtractor | None = None,
) -> list[ExtractedEntity]:
    """Extract every entity candidate from ``text``.

    Candidates are typed by cue word where one is present, and by digit-length
    shape otherwise. A bare 6-digit run with no cue is emitted as *both* a
    pin_code and an otp candidate -- scoring checks membership per gold type, so
    over-generating here is safer than guessing wrong and logging a false
    extractor miss.
    """
    wanted = set(types) if types else None
    lex = load_lexicon(language)
    folded = folded_text(text)
    tokens = tokenize_spans(text)
    out: list[ExtractedEntity] = []

    def want(t: str) -> bool:
        return wanted is None or t in wanted

    runs = _number_runs(tokens, lex)

    # A number expression broken by an unrecognised word shows up as two runs
    # separated by a short gap, the second beginning with a scale word:
    # "पाँच लाख [छयासठ] हज़ार". Neither half is the number, and emitting the
    # first half is exactly how an extractor bug becomes a reported ASR error.
    # Both halves are dropped.
    split_runs: set[int] = set()
    for i in range(len(runs) - 1):
        gap = runs[i + 1][0] - runs[i][1]
        if not 1 <= gap <= 2:
            continue
        nxt = tokens[runs[i + 1][0]]
        if canonicalize(nxt.text) in lex.scales:
            split_runs.add(i)
            split_runs.add(i + 1)

    for run_index, (start, end) in enumerate(runs):
        if run_index in split_runs:
            continue
        run = tokens[start:end]
        surface = folded[run[0].start : run[-1].end]
        span = (run[0].start, run[-1].end)
        run_text = [t.text for t in run]

        digits = parse_digit_sequence(run_text, language)
        try:
            # Strict: an expression this parser cannot fully read must not be
            # reported as a value. See parse_value's docstring.
            value: Decimal | None = parse_value(run_text, language, strict=True)
        except NumberParseError:
            value = None

        kind = _run_kind(run_text, lex)
        cur_cue = _currency_cue(tokens, start, end, lex)

        # What this run is worth as money. Usually the parsed magnitude; for a
        # digit-by-digit reading, which the strict parser refuses as a value,
        # the digits themselves. Only ever emitted with a currency cue beside
        # it -- an amount with no word saying it is money is not identifiable
        # as money, by this extractor or by anything else reading the
        # transcript, and pretending otherwise would hide that.
        amount = value
        if amount is None and kind == "digits":
            amount = _amount_from_digits(digits)

        # A magnitude expression is an amount, full stop -- never a digit string.
        if kind == "magnitude":
            if value is not None and want("currency"):
                out.append(ExtractedEntity(
                    "currency", surface, normalize_currency(value), span,
                    cue=cur_cue[0] if cur_cue else None,
                ))
            continue

        digit_cues = {
            etype: _find_cue(tokens, start, end, lex.entity_cues.get(etype, set()), lex)
            for etype in DIGIT_TYPES if want(etype)
        }
        digit_cues = {k: v for k, v in digit_cues.items() if v is not None}

        # Nearest cue wins between currency and the digit types. "खाते में
        # 13,00,00,000 रुपये" is an amount: रुपये is adjacent, खाते is two
        # tokens back. Within the digit types every cued type is emitted --
        # "पिन कोड" legitimately matches both pin_code and otp, and scoring
        # checks per gold type, so over-generating there is free.
        cur_dist = cur_cue[1] if cur_cue else None
        best_digit = min((v[1] for v in digit_cues.values()), default=None)

        # Nearest cue wins, but a tie emits both. "76,74,000 की शेष राशि" has
        # खाते two tokens back and शेष two tokens forward; letting the digit
        # type win a tie silently drops the amount entirely, and scoring checks
        # candidates per gold type, so over-generating on a tie costs nothing.
        emitted = False
        if (cur_dist is not None and amount is not None and want("currency")
                and (best_digit is None or cur_dist <= best_digit)):
            out.append(ExtractedEntity(
                "currency", surface, normalize_currency(amount), span, cue=cur_cue[0],
            ))
            # A magnitude beside a currency cue is money and nothing else, so
            # it closes the run. An amount read digit by digit is a weaker
            # claim -- the same digits are also the shape of an OTP -- so it is
            # emitted alongside the shape candidates rather than instead of
            # them. "आपका ओटी छः छः नौ चार" cost a real OTP hit when it
            # suppressed them: लेनदेन five tokens back is a currency cue, and
            # it belongs to a different number in the same sentence.
            emitted = value is not None

        if digit_cues and (cur_dist is None or best_digit <= cur_dist):
            for etype, cue in digit_cues.items():
                out.append(ExtractedEntity(etype, surface, digits, span, cue=cue[0]))
            emitted = True

        if emitted:
            continue

        # No cue: fall back to digit-length shape, emitting every type that fits.
        for etype, (lo, hi) in SHAPES.items():
            if want(etype) and lo <= len(digits) <= hi:
                out.append(ExtractedEntity(etype, surface, digits, span, cue=None))

    if want("date"):
        dates = _extract_dates(folded, tokens, lex)
        out.extend(dates)
        # A year inside a date is not a stray 4-digit OTP.
        spans = [d.span for d in dates]
        out = [
            e for e in out
            if e.type == "date"
            or not any(s <= e.span[0] and e.span[1] <= t for s, t in spans)
        ]

    if name_extractor is not None:
        out.extend(
            e for e in name_extractor.extract_names(text, language)
            if want(e.type)
        )

    return out


_NUMERIC_DATE = re.compile(r"\b(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{2,4})\b")


def _extract_dates(folded: str, tokens: Sequence[Token], lex: Lexicon) -> list[ExtractedEntity]:
    out: list[ExtractedEntity] = []

    for m in _NUMERIC_DATE.finditer(folded):
        day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if year < 100:
            year += 2000
        if 1 <= month <= 12 and 1 <= day <= 31:
            out.append(ExtractedEntity(
                "date", m.group(0), normalize_date(year, month, day), m.span(),
            ))

    # A month word with a number run either side. The runs are parsed as
    # magnitudes, not read digit-by-digit, so "चार मई दो हज़ार छब्बीस" gives
    # 4 May 2026 rather than a 4-digit string.
    runs = _number_runs(tokens, lex)
    ends_at = {end: (start, end) for start, end in runs}
    starts_at = {start: (start, end) for start, end in runs}

    for i, tok in enumerate(tokens):
        month = lex.months.get(canonicalize(tok.text))
        if month is None:
            continue

        def run_value(run: tuple[int, int] | None) -> int | None:
            if run is None:
                return None
            try:
                return int(parse_value([t.text for t in tokens[run[0]:run[1]]], lex.language))
            except (NumberParseError, ValueError):
                return None

        before, after = ends_at.get(i), starts_at.get(i + 1)
        day = year = None
        lo = hi = i

        bv, av = run_value(before), run_value(after)
        if bv is not None and 1 <= bv <= 31:
            day, lo = bv, before[0]
        if av is not None:
            if av >= 1000:
                year, hi = av, after[1] - 1
            elif day is None and 1 <= av <= 31:
                day, hi = av, after[1] - 1
        if day is not None and year is None and after is not None and av is not None \
                and av <= 31 and (nxt := starts_at.get(after[1] + 1)):
            nv = run_value(nxt)
            if nv is not None and nv >= 1000:
                year, hi = nv, nxt[1] - 1

        if day is not None:
            span = (tokens[lo].start, tokens[hi].end)
            out.append(ExtractedEntity(
                "date", folded[span[0]:span[1]], normalize_date(year, month, day), span,
            ))
    return out


def candidates_for(entities: Sequence[ExtractedEntity], etype: str) -> list[ExtractedEntity]:
    return [e for e in entities if e.type == etype]
