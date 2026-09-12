"""Synthetic corpus generator with gold entities attached by construction.

This is the point of synthetic data: the answer is known at generation time, so
there is no NER and no hand annotation. Gold `normalized` values are computed
from the *sampled value*, never by parsing the rendered sentence -- round
tripping through the extractor to build gold would make a bug in the extractor
invisible, which is precisely the bug class phase 2 exists to find.

Every utterance renders its entities either entirely as digits or entirely as
spoken words, roughly half and half, and records which. TTS pronounces
"3,50,000" and "तीन लाख पचास हज़ार" differently, so both paths have to be
measured separately.
"""

from __future__ import annotations

import datetime as dt
import random
import re
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Callable

import yaml
from pydantic import BaseModel

from .corpus import Entity, Utterance
from .entities import normalize_currency, normalize_date, normalize_digit_string
from .numwords import (
    digits_to_words,
    format_indian_grouping,
    load_lexicon,
    value_to_words,
)

TEMPLATE_DIR = Path(__file__).parent / "templates"
SLOT_RE = re.compile(r"\{(\w+?)(?::(\w+))?\}")


class Template(BaseModel):
    id: str
    text: str
    domain: str | None = None
    code_mixed: bool = False
    notes: str | None = None

    def slots(self) -> list[tuple[str, str]]:
        """[(entity_type, slot_key)] in order of appearance."""
        return [(m.group(1), m.group(2) or m.group(1)) for m in SLOT_RE.finditer(self.text)]


class TemplateSet(BaseModel):
    language: str
    templates: list[Template]


def load_templates(language: str) -> TemplateSet:
    path = TEMPLATE_DIR / f"{language}.yaml"
    if not path.exists():
        have = ", ".join(sorted(p.stem for p in TEMPLATE_DIR.glob("*.yaml")))
        raise FileNotFoundError(f"no templates for {language!r}; have: {have}")
    return TemplateSet.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


# --------------------------------------------------------------------------
# Samplers -- each returns the value, its gold normalization, and both renderings
# --------------------------------------------------------------------------


@dataclass
class Sampled:
    type: str
    normalized: str
    digit_form: str
    word_form: str

    def surface(self, realization: str) -> str:
        return self.digit_form if realization == "digits" else self.word_form


def sample_account_number(rng: random.Random, language: str) -> Sampled:
    # Indian bank account numbers run roughly 11-16 digits, never leading zero.
    n = rng.choice([11, 12, 13, 14, 15, 16])
    digits = str(rng.randint(1, 9)) + "".join(str(rng.randint(0, 9)) for _ in range(n - 1))
    return Sampled("account_number", normalize_digit_string(digits), digits,
                   digits_to_words(digits, language))


def sample_otp(rng: random.Random, language: str) -> Sampled:
    digits = "".join(str(rng.randint(0, 9)) for _ in range(rng.choice([4, 6])))
    return Sampled("otp", normalize_digit_string(digits), digits,
                   digits_to_words(digits, language))


def sample_pin_code(rng: random.Random, language: str) -> Sampled:
    # Indian PIN codes are 6 digits and never start with 0 or 9.
    digits = str(rng.randint(1, 8)) + "".join(str(rng.randint(0, 9)) for _ in range(5))
    return Sampled("pin_code", normalize_digit_string(digits), digits,
                   digits_to_words(digits, language))


#: Currency magnitudes are spanned deliberately rather than drawn from one
#: uniform range. A benchmark that only ever says "five hundred rupees" tells
#: you nothing about whether lakh and crore survive the line.
CURRENCY_BUCKETS = ("hundreds", "thousands", "lakhs", "crores", "fractional")


def sample_currency(rng: random.Random, language: str) -> Sampled:
    bucket = rng.choice(CURRENCY_BUCKETS)
    lex = load_lexicon(language)

    if bucket == "fractional":
        # Values that can only be said naturally with a fractional modifier:
        # साढ़े तीन लाख, सवा दो करोड़, पौने चार हज़ार.
        delta, mod_word = rng.choice([
            (Decimal("0.5"), lex.modifier_words["0.5"]),
            (Decimal("0.25"), lex.modifier_words["0.25"]),
            (Decimal("-0.25"), lex.modifier_words["-0.25"]),
        ])
        scale = rng.choice([1000, 100_000, 10_000_000])
        base = rng.randint(2, 9)
        value = (Decimal(base) + delta) * scale
        word_form = f"{mod_word} {value_to_words(base, language)} {lex.scale_words[scale]}"
    else:
        amount = {
            "hundreds": lambda: rng.randint(1, 9) * 100 + rng.choice([0, rng.randint(1, 99)]),
            "thousands": lambda: rng.randint(1, 99) * 1000 + rng.choice([0, rng.randint(1, 999)]),
            "lakhs": lambda: rng.randint(1, 99) * 100_000 + rng.choice([0, rng.randint(1, 99) * 1000]),
            "crores": lambda: rng.randint(1, 20) * 10_000_000 + rng.choice([0, rng.randint(1, 99) * 100_000]),
        }[bucket]()
        value = Decimal(amount)
        word_form = value_to_words(int(amount), language)

    return Sampled("currency", normalize_currency(value),
                   format_indian_grouping(int(value)), word_form)


def sample_date(rng: random.Random, language: str) -> Sampled:
    lex = load_lexicon(language)
    base = dt.date(2026, 1, 1) + dt.timedelta(days=rng.randint(0, 700))
    month_word = lex.month_words[base.month]
    return Sampled(
        "date",
        normalize_date(base.year, base.month, base.day),
        f"{base.day:02d}/{base.month:02d}/{base.year}",
        f"{value_to_words(base.day, language)} {month_word} {value_to_words(base.year, language)}",
    )


SAMPLERS: dict[str, Callable[[random.Random, str], Sampled]] = {
    "account_number": sample_account_number,
    "otp": sample_otp,
    "pin_code": sample_pin_code,
    "currency": sample_currency,
    "date": sample_date,
}


# --------------------------------------------------------------------------
# Generation
# --------------------------------------------------------------------------


def generate(language: str, n: int, seed: int) -> list[Utterance]:
    """Generate ``n`` utterances. Fully seeded: same seed, same corpus."""
    tset = load_templates(language)
    rng = random.Random(seed)
    out: list[Utterance] = []

    for i in range(n):
        template = tset.templates[i % len(tset.templates)]
        # Per-utterance RNG derived from the index, so generating 200 and then
        # generating 40 gives the same first 40 utterances.
        urng = random.Random(f"{seed}:{language}:{i}")
        realization = "digits" if urng.random() < 0.5 else "words"

        values: dict[str, Sampled] = {}
        for etype, key in template.slots():
            if etype not in SAMPLERS:
                raise ValueError(
                    f"template {template.id} uses unknown entity type {etype!r}; "
                    f"known: {', '.join(sorted(SAMPLERS))}"
                )
            if key not in values:
                values[key] = SAMPLERS[etype](urng, language)

        text = template.text
        entities: list[Entity] = []
        for etype, key in template.slots():
            sampled = values[key]
            surface = sampled.surface(realization)
            text = text.replace(
                f"{{{key}}}" if key != etype else f"{{{etype}}}", surface, 1
            )
            entities.append(Entity(type=sampled.type, surface=surface,
                                   normalized=sampled.normalized))

        out.append(Utterance(
            id=f"{language}-{seed}-{i:05d}",
            language=language,
            text=text,
            entities=entities,
            source="synthetic",
            domain=template.domain,
            realization=realization,
            template_id=template.id,
            meta={"code_mixed": template.code_mixed},
        ))
    return out
