"""Indic number-word parsing.

Two decoders, chosen by what the number *is*, not by how it looks:

* :func:`parse_value` -- magnitude reading, for currency. Indian grouping:
  (crore)(lakh)(thousand)(hundred)(0-99). "तीन लाख पचास हज़ार" -> 350000.
* :func:`parse_digit_sequence` -- digit-by-digit reading, for OTPs, account
  numbers and PIN codes. "नौ दो तीन चार" -> "9234", "डबल पाँच" -> "55".

The same tokens mean different things under the two decoders, which is why the
entity type has to pick one. Reading an account number as a magnitude, or an
amount as a digit string, is a whole class of silent failure.
"""

from __future__ import annotations

import re
import unicodedata
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Iterable, NamedTuple

import yaml

LEXICON_DIR = Path(__file__).parent

#: Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada,
#: Malayalam digit blocks -> ASCII. Indic and Latin numerals must compare equal.
_INDIC_DIGIT_BASES = [
    0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66, 0x0BE6, 0x0C66, 0x0CE6, 0x0D66,
]
_DIGIT_MAP = {
    chr(base + d): str(d) for base in _INDIC_DIGIT_BASES for d in range(10)
}

_NUKTA = "़"
_CHANDRABINDU = "ँ"
_ANUSVARA = "ं"
_VIRAMA = "्"

#: Unaspirated stop -> its aspirated partner. Hindi gemination is written either
#: as a doubled consonant (सत्तर) or as stop + aspirate (अट्ठानवे), and ASR output
#: varies between the geminated and ungeminated spelling of the same numeral.
_ASPIRATE = {
    "क": "ख", "ग": "घ", "च": "छ", "ज": "झ", "ट": "ठ",
    "ड": "ढ", "त": "थ", "द": "ध", "प": "फ", "ब": "भ",
}

_GEMINATE_RE = re.compile(
    "([" + "".join(_ASPIRATE) + "क-ह])" + _VIRAMA + "([क-ह])")


def _degeminate(word: str) -> str:
    """Collapse written gemination: सत्तर == सतर, अट्ठानवे == अठानवे.

    The Devanagari counterpart of the Latin doubled-consonant rule already
    applied below. A consonant followed by virama and either itself or its
    aspirated partner is reduced to the second consonant.
    """
    def sub(m: re.Match) -> str:
        first, second = m.group(1), m.group(2)
        if second == first or _ASPIRATE.get(first) == second:
            return second
        return m.group(0)

    prev = None
    out = word
    while out != prev:
        prev = out
        out = _GEMINATE_RE.sub(sub, out)
    return out

_LATIN_VOWEL_RULES = [("aa", "a"), ("ee", "i"), ("ii", "i"), ("oo", "u"), ("uu", "u")]


def fold_digits(text: str) -> str:
    """Map any Indic numeral to its ASCII equivalent."""
    return "".join(_DIGIT_MAP.get(ch, ch) for ch in text)


def canonicalize(word: str) -> str:
    """Collapse spelling variance so lexicon lookups are forgiving.

    Devanagari: strip nukta (हज़ार == हजार) and fold chandrabindu to anusvara
    (पाँच == पांच). Latin: fold long vowels and doubled consonants
    (pachaas == pacchas == pachas), and z -> j (hazaar == hajar).

    Applied to both sides of every lookup, so the lexicon never has to enumerate
    every possible romanization.
    """
    w = unicodedata.normalize("NFC", word).strip().lower()
    w = w.replace(_NUKTA, "").replace(_CHANDRABINDU, _ANUSVARA)
    # Decompose so a precomposed nukta letter (ज़, ड़) also loses its nukta.
    w = unicodedata.normalize("NFD", w).replace(_NUKTA, "")
    w = unicodedata.normalize("NFC", w)
    if re.search(r"[\u0900-\u097f]", w):
        # Numeral spellings vary in three regular ways in real ASR output, and
        # all three are folded here so the lexicon need not enumerate them:
        # gemination (सत्तर/सतर), the छिया/छया alternation, and व/ब in the
        # nineties (निन्यानवे/निन्यानबे).
        w = _degeminate(w)
        w = w.replace("िय", "य")
        w = w.replace("नब", "नव")
    if re.search(r"[a-z]", w):
        w = w.replace("z", "j")
        for src, dst in _LATIN_VOWEL_RULES:
            w = w.replace(src, dst)
        w = re.sub(r"(.)\1+", r"\1", w)  # pacchas -> pachas
    w = w.strip(".-_'।")
    return w


class Lexicon:
    """A language's number vocabulary, indexed by canonicalized form."""

    def __init__(self, data: dict):
        self.language: str = data.get("language", "")
        self.units: dict[str, int] = {}
        #: Reverse index, value -> primary (first-listed) spelling. Used by the
        #: corpus generator to render a sampled number as spoken words.
        self.unit_words: dict[int, str] = {}
        for value, words in (data.get("units") or {}).items():
            for w in words:
                self.units.setdefault(canonicalize(str(w)), int(value))
            if words:
                self.unit_words.setdefault(int(value), str(words[0]))

        self.scales: dict[str, int] = {}
        self.scale_words: dict[int, str] = {}
        for entry in data.get("scales") or []:
            for w in entry["words"]:
                self.scales.setdefault(canonicalize(w), int(entry["value"]))
            if entry["words"]:
                self.scale_words.setdefault(int(entry["value"]), str(entry["words"][0]))

        self.fraction_values: dict[str, Decimal] = {}
        for entry in data.get("fraction_values") or []:
            for w in entry["words"]:
                self.fraction_values.setdefault(canonicalize(w), Decimal(str(entry["value"])))

        self.modifiers: dict[str, Decimal] = {}
        self.modifier_words: dict[str, str] = {}
        for entry in data.get("modifiers") or []:
            for w in entry["words"]:
                self.modifiers.setdefault(canonicalize(w), Decimal(str(entry["delta"])))
            if entry["words"]:
                self.modifier_words.setdefault(str(entry["delta"]), str(entry["words"][0]))

        self.repeats: dict[str, int] = {}
        for entry in data.get("repeat_words") or []:
            for w in entry["words"]:
                self.repeats.setdefault(canonicalize(w), int(entry["times"]))

        self.months: dict[str, int] = {}
        self.month_words: dict[int, str] = {}
        for value, words in (data.get("months") or {}).items():
            for w in words:
                self.months.setdefault(canonicalize(str(w)), int(value))
            if words:
                self.month_words.setdefault(int(value), str(words[0]))

        self.currency_cues = {canonicalize(w) for w in data.get("currency_cues") or []}
        self.paise_cues = {canonicalize(w) for w in data.get("paise_cues") or []}
        self.decimal_cues = {canonicalize(w) for w in data.get("decimal_cues") or []}
        self.entity_cues = {
            k: {canonicalize(w) for w in v}
            for k, v in (data.get("entity_cues") or {}).items()
        }

    def merge_fallback(self, other: "Lexicon") -> None:
        """Add ``other``'s entries where this lexicon has none. setdefault
        semantics throughout: the primary language always wins."""
        for attr in ("units", "scales", "fraction_values", "modifiers",
                     "repeats", "months", "unit_words", "scale_words",
                     "modifier_words", "month_words"):
            mine = getattr(self, attr)
            for k, v in getattr(other, attr).items():
                mine.setdefault(k, v)
        for attr in ("currency_cues", "paise_cues", "decimal_cues"):
            getattr(self, attr).update(getattr(other, attr))
        for key, words in other.entity_cues.items():
            self.entity_cues.setdefault(key, set()).update(words)

    def is_number_word(self, token: str) -> bool:
        c = canonicalize(token)
        return (
            c in self.units or c in self.scales
            or c in self.fraction_values or c in self.modifiers
            or c in self.repeats
        )


def _lang_key(language: str) -> str:
    """"hi-IN" -> "hi". Falls back to English for languages with no lexicon."""
    base = (language or "").split("-")[0].lower()
    return base if (LEXICON_DIR / f"{base}.yaml").exists() else "en"


def _read_lexicon(key: str) -> Lexicon:
    path = LEXICON_DIR / f"{key}.yaml"
    return Lexicon(yaml.safe_load(path.read_text(encoding="utf-8")))


@lru_cache(maxsize=None)
def load_lexicon(language: str) -> Lexicon:
    """Load a language's lexicon, with English merged in as a fallback.

    Code-mixed Indian speech puts English number words inside Hindi sentences
    ("aapka OTP four eight one nine hai"), so a Hindi-only lexicon would simply
    not see half the numbers in a realistic corpus. The primary language always
    wins on conflicts.
    """
    key = _lang_key(language)
    lex = _read_lexicon(key)
    if key != "en":
        lex.merge_fallback(_read_lexicon("en"))
    return lex


def available_languages() -> list[str]:
    return sorted(p.stem for p in LEXICON_DIR.glob("*.yaml"))


#: Token separators. Deliberately a separator list rather than a \w+ match:
#: Python's re classifies Devanagari vowel signs as combining marks, which \w
#: excludes, so "तीन" would tokenize as ["त", "न"] and silently lose its vowel.
_SEPARATORS = frozenset(
    " \t\n\r\f\v\u0964\u0965!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"
    "\u2013\u2014\u2026\u201c\u201d\u2018\u2019\u00ab\u00bb"
)
_CURRENCY_SYMBOLS = frozenset("\u20b9$")


def tokenize(text: str) -> list[str]:
    """Split into word, digit-run and currency-symbol tokens.

    Digit group separators are stripped first so "3,50,000" survives as one
    token: Indian grouping is 2-2-3, not 3-3-3, and splitting on commas would
    shatter it into 3 / 50 / 000.
    """
    return [t.text for t in tokenize_spans(text)]


class Token(NamedTuple):
    text: str
    start: int
    end: int


def tokenize_spans(text: str) -> list[Token]:
    """Tokenize, keeping each token's character span in the *folded* text.

    Spans are into the folded string (Indic digits mapped to ASCII, digit group
    separators removed), which is also what the extractor reports surfaces from,
    so offsets stay self-consistent.
    """
    folded = folded_text(text)
    tokens: list[Token] = []
    buf: list[str] = []
    buf_start = 0

    def flush(end: int) -> None:
        if not buf:
            return
        joined = "".join(buf)
        offset = buf_start
        for part in re.findall(r"\d+(?:\.\d+)?|\D+", joined):
            if part.strip():
                tokens.append(Token(part, offset, offset + len(part)))
            offset += len(part)
        buf.clear()

    for i, ch in enumerate(folded):
        if ch in _CURRENCY_SYMBOLS:
            flush(i)
            tokens.append(Token(ch, i, i + 1))
            buf_start = i + 1
        elif ch in _SEPARATORS:
            flush(i)
            buf_start = i + 1
        else:
            if not buf:
                buf_start = i
            buf.append(ch)
    flush(len(folded))
    return tokens


def folded_text(text: str) -> str:
    """NFC + Indic digits folded to ASCII + digit group separators removed."""
    t = fold_digits(unicodedata.normalize("NFC", text))
    return re.sub(r"(?<=\d)[,\u066c](?=\d)", "", t)


# --------------------------------------------------------------------------
# Magnitude reading (currency)
# --------------------------------------------------------------------------


class NumberParseError(ValueError):
    pass


def parse_value(
    tokens: Iterable[str], language: str, strict: bool = False,
) -> Decimal:
    """Parse number words as a magnitude, using Indian grouping.

    A sub-thousand group is built from two accumulators -- ``group`` for the
    hundreds already committed and ``small`` for the 0-99 remainder -- because
    "तीन सौ पचास" must add (300 + 50), while "twenty one" must add (20 + 1) and
    "पचास हज़ार" must replace. Collapsing these into one accumulator silently
    turns 350 into 50.

    Raises :class:`NumberParseError` if the tokens contain no number at all, or,
    under ``strict``, if the expression looks truncated.

    Strict mode exists because the dangerous failure is not a crash, it is a
    plausible wrong number. An unrecognised word inside a number expression --
    a spelling the lexicon does not carry -- used to be skipped silently, so
    "पाँच लाख छयासठ हज़ार" parsed as 500000 and was reported as a confident
    value. No lexicon will ever be complete against a live recogniser, so the
    parser has to detect that it has been handed something it cannot fully read
    and refuse. Two signals:

      * a scale with nothing in front of it ("लाख चौहत्तर हज़ार" -- the count
        was a word we failed to recognise), unless a fractional modifier
        supplies the count ("सवा लाख")
      * two values in a row with no scale between them ("76 74 लाख"), which is
        not a shape Indian grouping produces

    Callers that want a best-effort reading (date extraction, triage probes)
    leave strict off; entity extraction turns it on, so an unknown spelling
    surfaces as "found nothing" rather than as a wrong value attributed to the
    recogniser.
    """
    lex = load_lexicon(language)
    toks = [canonicalize(t) for t in tokens]

    total = Decimal(0)
    group = Decimal(0)     # hundreds committed within the current group
    small = Decimal(0)     # 0-99 remainder being built
    pending_mod = Decimal(0)
    saw_in_group = False
    saw_any = False
    prev_kind: str | None = None

    def group_value() -> Decimal:
        """The group's value, treating a bare scale ("सवा लाख") as 1 x scale."""
        base = group + small
        if not saw_in_group and base == 0:
            return Decimal(1)
        return base

    for tok in toks:
        if not tok:
            continue

        if tok in lex.modifiers:
            pending_mod = lex.modifiers[tok]
            saw_any = True
            prev_kind = "modifier"
            continue

        if tok in lex.fraction_values:
            small = lex.fraction_values[tok]
            saw_in_group = saw_any = True
            prev_kind = "value"
            continue

        if re.fullmatch(r"\d+(?:\.\d+)?", tok):
            if strict and prev_kind == "value":
                raise NumberParseError(
                    f"two values in a row with no scale between them "
                    f"({list(tokens)!r}); the expression cannot be read")
            small = Decimal(tok)
            saw_in_group = saw_any = True
            prev_kind = "value"
            continue

        if tok in lex.units:
            value = Decimal(lex.units[tok])
            # English composes tens+units ("twenty one"); Hindi never does, its
            # 1-99 are single words, so this branch simply never fires for hi.
            composing = (
                Decimal(20) <= small < Decimal(100)
                and small % 10 == 0 and 0 < value < 10
            )
            if composing:
                small += value
            else:
                if strict and prev_kind == "value":
                    raise NumberParseError(
                        f"two values in a row with no scale between them "
                        f"({list(tokens)!r}); the expression cannot be read")
                small = value
            saw_in_group = saw_any = True
            prev_kind = "value"
            continue

        if tok in lex.scales:
            scale = Decimal(lex.scales[tok])
            if strict and not saw_in_group and not pending_mod:
                # A scale with no count in front of it. Something that should
                # have been the count was not recognised.
                raise NumberParseError(
                    f"scale {tok!r} with no preceding value ({list(tokens)!r}); "
                    f"the count was probably a word the lexicon does not carry")
            base = group_value()
            if pending_mod:
                base += pending_mod
                pending_mod = Decimal(0)
            if scale >= 1000:
                # A new group opens: commit this one.
                total += base * scale
                group = small = Decimal(0)
                saw_in_group = False
            else:
                # "hundred" stays inside the group: तीन सौ पचास = 300 + 50.
                group = base * scale
                small = Decimal(0)
                saw_in_group = True
            saw_any = True
            prev_kind = "scale"
            continue

        # Not a number word: ends nothing. Windowing is the caller's job.

    tail = group + small
    if pending_mod:
        # A trailing modifier with no scale after it, e.g. "सवा" alone.
        tail = (tail if saw_in_group else Decimal(1)) + pending_mod
        saw_any = True
    total += tail

    if not saw_any:
        raise NumberParseError(f"no number found in {list(tokens)!r}")
    return total


# --------------------------------------------------------------------------
# Digit-sequence reading (OTP / account number / PIN code)
# --------------------------------------------------------------------------


def parse_digit_sequence(tokens: Iterable[str], language: str) -> str:
    """Read tokens as a literal digit string.

    Handles digit runs already rendered as numerals, digit-by-digit word
    reading, and repeat words ("डबल पाँच" -> "55"). Two-digit words are
    expanded literally ("पचास" -> "50") because that is how people read
    grouped account numbers aloud.
    """
    lex = load_lexicon(language)
    out: list[str] = []
    pending_repeat = 1

    for raw in tokens:
        tok = canonicalize(raw)
        if not tok:
            continue

        if tok in lex.repeats:
            pending_repeat = lex.repeats[tok]
            continue

        digits: str | None = None
        if tok.isdigit():
            digits = tok
        elif tok in lex.units:
            digits = str(lex.units[tok])
        elif tok in lex.scales and lex.scales[tok] in (100, 1000):
            # "नौ सौ" inside a digit run means "900"; keep the zeros.
            scale = lex.scales[tok]
            if out:
                digits = "0" * (len(str(scale)) - 1)
            else:
                digits = str(scale)

        if digits is None:
            continue

        out.append(digits * pending_repeat)
        pending_repeat = 1

    return "".join(out)


# --------------------------------------------------------------------------
# Formatting (the generator's direction: value -> text)
# --------------------------------------------------------------------------


def format_indian_grouping(n: int) -> str:
    """123456789 -> "12,34,56,789". Indian 2-2-3 grouping, not 3-3-3."""
    s = str(abs(int(n)))
    if len(s) <= 3:
        out = s
    else:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        out = ",".join(parts + [tail])
    return ("-" if n < 0 else "") + out


def value_to_words(n: int, language: str) -> str:
    """Render an integer as spoken words using Indian grouping."""
    lex = load_lexicon(language)
    n = int(n)
    if n == 0:
        return lex.unit_words[0]

    parts: list[str] = []
    for scale in (10_000_000, 100_000, 1000):
        if n >= scale:
            count, n = divmod(n, scale)
            parts.append(f"{_below_thousand_words(count, lex)} {lex.scale_words[scale]}")
    if n:
        parts.append(_below_thousand_words(n, lex))
    return " ".join(p for p in parts if p)


def _below_thousand_words(n: int, lex: Lexicon) -> str:
    parts: list[str] = []
    hundreds, rest = divmod(n, 100)
    if hundreds:
        parts.append(f"{lex.unit_words[hundreds]} {lex.scale_words[100]}")
    if rest:
        if rest in lex.unit_words:
            parts.append(lex.unit_words[rest])
        else:  # English-style tens + units
            tens, units = divmod(rest, 10)
            parts.append(lex.unit_words[tens * 10])
            if units:
                parts.append(lex.unit_words[units])
    return " ".join(parts)


def digits_to_words(digits: str, language: str) -> str:
    """Read a digit string aloud one digit at a time: "9234" -> "नौ दो तीन चार"."""
    lex = load_lexicon(language)
    return " ".join(lex.unit_words[int(d)] for d in str(digits) if d.isdigit())
