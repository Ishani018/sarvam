"""Indic number words -> values. The hardest part of the project, so this is
the densest test file.

The recurring trap is western grouping: a parser that reads "three lakh fifty
thousand" as 3 * 1000 + ... or that treats lakh as 10^6 produces plausible-
looking numbers that are silently wrong, which is exactly the failure this
harness exists to detect.
"""

from decimal import Decimal

import pytest

from tee.numwords import (
    NumberParseError,
    canonicalize,
    fold_digits,
    load_lexicon,
    parse_digit_sequence,
    parse_value,
    tokenize,
)


def val(text: str, lang: str = "hi-IN") -> int:
    return int(parse_value(tokenize(text), lang))


def digits(text: str, lang: str = "hi-IN") -> str:
    return parse_digit_sequence(tokenize(text), lang)


# --------------------------------------------------------------------------
# Indian grouping -- lakh and crore, never thousand/million
# --------------------------------------------------------------------------


@pytest.mark.parametrize("text,want", [
    ("तीन लाख पचास हज़ार", 350_000),
    ("एक लाख", 100_000),
    ("दस लाख", 1_000_000),
    ("एक करोड़", 10_000_000),
    ("दो करोड़ पचास लाख", 25_000_000),
    ("पचास हज़ार", 50_000),
    ("नौ सौ निन्यानवे", 999),
    ("तीन सौ पचास", 350),
    ("पाँच हज़ार तीन सौ", 5_300),
    ("एक लाख तीन सौ पचास", 100_350),
    ("सैंतालीस हज़ार", 47_000),
    ("निन्यानवे", 99),
])
def test_hindi_magnitudes(text, want):
    assert val(text) == want


@pytest.mark.parametrize("text,want", [
    ("three lakh fifty thousand", 350_000),
    ("one lakh twenty five thousand", 125_000),
    ("two crore fifty lakh", 25_000_000),
    ("nine hundred", 900),
    ("three hundred fifty", 350),
    ("twenty one thousand", 21_000),
    ("ninety nine", 99),
])
def test_indian_english_magnitudes(text, want):
    assert val(text, "en-IN") == want


def test_lakh_is_not_a_million():
    """The specific western-grouping bug this project is about."""
    assert val("तीन लाख") == 300_000
    assert val("तीन लाख") != 3_000_000
    assert val("एक करोड़") == 10_000_000


# --------------------------------------------------------------------------
# Fractional modifiers -- extremely common in spoken amounts
# --------------------------------------------------------------------------


@pytest.mark.parametrize("text,want", [
    ("साढ़े तीन लाख", 350_000),    # sade: +0.5
    ("साढ़े चार हज़ार", 4_500),
    ("सवा लाख", 125_000),          # sawa: +0.25, bare scale implies 1
    ("सवा तीन लाख", 325_000),
    ("पौने दो लाख", 175_000),      # paune: -0.25
    ("पौने तीन करोड़", 27_500_000),
    ("डेढ़ लाख", 150_000),          # derh: standalone 1.5
    ("ढाई करोड़", 25_000_000),      # dhai: standalone 2.5
    ("ढाई हज़ार", 2_500),
])
def test_fractional_modifiers(text, want):
    assert val(text) == want


def test_modifier_without_scale():
    assert val("सवा") == 1  # int() of 1.25; the bare-modifier edge case
    assert parse_value(tokenize("सवा"), "hi-IN") == Decimal("1.25")


# --------------------------------------------------------------------------
# Numeral equivalence and romanization variance
# --------------------------------------------------------------------------


def test_indic_and_latin_numerals_are_equivalent():
    assert fold_digits("३५०००० ५६००३४") == "350000 560034"
    assert val("३,५०,०००") == val("3,50,000") == 350_000


def test_indian_digit_grouping_survives_tokenization():
    """2-2-3 grouping, not 3-3-3. Splitting on commas would give 3/50/000."""
    assert val("3,50,000") == 350_000
    assert val("1,25,00,000") == 12_500_000


@pytest.mark.parametrize("variants,want", [
    (["तीन लाख", "teen lakh", "theen lakh", "tin lakh"], 300_000),
    (["पचास हज़ार", "pachaas hazaar", "pachas hajar", "pacchas hazar"], 50_000),
    (["साढ़े तीन लाख", "sade teen lakh", "saadhe theen lakh"], 350_000),
])
def test_romanization_variance_collapses(variants, want):
    for v in variants:
        assert val(v) == want, v


def test_nukta_and_chandrabindu_fold():
    assert canonicalize("हज़ार") == canonicalize("हजार")
    assert canonicalize("पाँच") == canonicalize("पांच")
    assert val("पाँच हज़ार") == val("पांच हजार") == 5_000


def test_canonicalize_latin_rules():
    assert canonicalize("pachaas") == canonicalize("pacchas") == canonicalize("pachas")
    assert canonicalize("hazaar") == canonicalize("hajar")


# --------------------------------------------------------------------------
# Digit-sequence reading -- a different decoder, deliberately
# --------------------------------------------------------------------------


@pytest.mark.parametrize("text,want", [
    ("नौ दो तीन चार", "9234"),
    ("चार आठ एक नौ दो तीन", "481923"),
    ("पाँच शून्य एक शून्य", "5010"),
    ("५६००३४", "560034"),
])
def test_digit_sequence_hindi(text, want):
    assert digits(text) == want


@pytest.mark.parametrize("text,want", [
    ("four eight one nine two three", "481923"),
    ("double five six", "556"),
    ("triple seven one", "7771"),
    ("nine two three four", "9234"),
])
def test_digit_sequence_english(text, want):
    assert digits(text, "en-IN") == want


def test_repeat_words():
    assert digits("डबल पाँच सात एक") == "5571"
    assert digits("ट्रिपल नौ") == "999"


def test_two_digit_words_expand_literally():
    """Account numbers are read in groups: "पचास" inside a run means "50"."""
    assert digits("पचास दस") == "5010"


def test_the_two_decoders_disagree_on_purpose():
    """Same tokens, different readings. Picking the wrong one is a whole class
    of silent failure, which is why the entity type selects the decoder."""
    toks = tokenize("नौ दो तीन चार")
    assert parse_digit_sequence(toks, "hi-IN") == "9234"
    assert parse_value(toks, "hi-IN") == Decimal(4)  # last value wins


# --------------------------------------------------------------------------
# Code-mixing and lexicon structure
# --------------------------------------------------------------------------


def test_english_number_words_inside_hindi():
    assert val("three lakh fifty thousand") == 350_000
    assert digits("four eight one nine two three") == "481923"


def test_hindi_lexicon_enumerates_all_of_0_to_99():
    """Hindi 1-99 is not compositional; every value needs its own entry."""
    lex = load_lexicon("hi-IN")
    assert set(lex.units.values()) >= set(range(100))


def test_unknown_language_falls_back_to_english():
    assert val("three lakh", "kn-IN") == 300_000


def test_no_number_raises():
    with pytest.raises(NumberParseError):
        parse_value(tokenize("यहाँ कोई संख्या नहीं"), "hi-IN")


def test_devanagari_matras_survive_tokenization():
    """Python's \\w excludes combining marks, so a naive \\w+ tokenizer turns
    "तीन" into ["त", "न"] and loses the vowel."""
    assert tokenize("तीन लाख पचास हज़ार") == ["तीन", "लाख", "पचास", "हज़ार"]
