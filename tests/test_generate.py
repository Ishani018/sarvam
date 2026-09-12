"""Corpus generator: determinism, gold correctness, and magnitude coverage."""

import re
from collections import Counter

import pytest

from tee.entities import extract
from tee.generate import (
    SLOT_RE, generate, load_templates, sample_currency, CURRENCY_BUCKETS,
)
from tee.numwords import parse_value, tokenize

TYPES = ["account_number", "currency", "otp", "pin_code", "date"]


def test_same_seed_same_corpus():
    assert [u.model_dump() for u in generate("hi-IN", 20, 7)] == \
           [u.model_dump() for u in generate("hi-IN", 20, 7)]


def test_different_seed_different_corpus():
    assert generate("hi-IN", 20, 7)[0].text != generate("hi-IN", 20, 8)[0].text


def test_prefix_is_stable_across_sizes():
    """Generating 200 then 40 must give the same first 40, so a calibration run
    is a strict prefix of the full corpus."""
    big = generate("hi-IN", 60, 1337)
    small = generate("hi-IN", 20, 1337)
    assert [u.model_dump() for u in big[:20]] == [u.model_dump() for u in small]


def test_gold_matches_what_the_extractor_finds_in_the_reference():
    """The offline invariant that makes the calibration run interpretable: on
    clean reference text every gold entity must be recoverable. Any miss here
    is an extractor or gold bug, not an ASR result."""
    misses = []
    for u in generate("hi-IN", 300, 1337):
        found = extract(u.text, u.language, types=TYPES)
        for g in u.entities:
            same = [c for c in found if c.type == g.type]
            if not any(c.normalized == g.normalized for c in same):
                misses.append((u.id, u.template_id, g.type, g.normalized, u.text))
    assert not misses, f"{len(misses)} gold entities unrecoverable: {misses[:3]}"


def test_gold_is_not_built_by_parsing_the_sentence():
    """Gold comes from the sampler. Spot-check by confirming the word form
    independently parses back to the same value."""
    for u in generate("hi-IN", 120, 99):
        for e in u.entities:
            if e.type == "currency" and u.realization == "words":
                value = parse_value(tokenize(e.surface), u.language)
                assert f"INR:{value:.2f}" == e.normalized


def test_realizations_are_roughly_balanced():
    counts = Counter(u.realization for u in generate("hi-IN", 400, 1337))
    assert counts["digits"] + counts["words"] == 400
    assert 0.35 < counts["digits"] / 400 < 0.65


def test_currency_spans_magnitudes():
    """Hundreds through crores, plus values needing fractional modifiers. A
    corpus that only says "five hundred rupees" says nothing about lakh/crore."""
    values = []
    for u in generate("hi-IN", 400, 1337):
        for e in u.entities:
            if e.type == "currency":
                values.append(float(e.normalized.split(":")[1]))
    assert min(values) < 10_000
    assert max(values) > 10_000_000
    assert any(v % 1000 == 500 or v % 100_000 == 50_000 for v in values), \
        "no fractional-modifier values generated"


def test_fractional_bucket_produces_modifier_words():
    import random
    seen = set()
    for i in range(300):
        s = sample_currency(random.Random(i), "hi-IN")
        seen.update(s.word_form.split()[:1])
    assert {"साढ़े", "सवा", "पौने"} & seen


def test_templates_cover_code_mixing_and_multi_entity():
    ts = load_templates("hi-IN")
    assert sum(1 for t in ts.templates if t.code_mixed) >= 2
    multi = [t for t in ts.templates
             if len({m.group(1) for m in SLOT_RE.finditer(t.text)}) > 1]
    assert len(multi) >= 2


def test_every_slot_is_filled():
    for u in generate("hi-IN", 100, 5):
        assert not SLOT_RE.search(u.text), f"unfilled slot in {u.text}"


def test_two_entities_of_different_types_are_both_gold():
    ids = {t.id for t in load_templates("hi-IN").templates}
    assert "hi_acct_amount_01" in ids
    got = [u for u in generate("hi-IN", 100, 1337)
           if u.template_id == "hi_acct_amount_01"]
    assert got and {e.type for e in got[0].entities} == {"account_number", "currency"}


def test_unknown_language_raises_with_available_list():
    with pytest.raises(FileNotFoundError, match="have:"):
        load_templates("xx-YY")


def test_pin_codes_have_realistic_shape():
    for u in generate("hi-IN", 200, 1337):
        for e in u.entities:
            if e.type == "pin_code":
                assert len(e.normalized) == 6 and e.normalized[0] not in "09"


# --- English gloss ----------------------------------------------------------


def test_every_template_has_a_gloss_with_matching_slots():
    """A gloss whose slots drift from the text would leave an unfilled {slot}
    on the page, or silently drop the entity from the translation."""
    for t in load_templates("hi-IN").templates:
        assert t.gloss, f"{t.id} has no gloss"
        text_slots = sorted(m.group(0) for m in SLOT_RE.finditer(t.text))
        gloss_slots = sorted(m.group(0) for m in SLOT_RE.finditer(t.gloss))
        assert text_slots == gloss_slots, f"{t.id}: {text_slots} vs {gloss_slots}"


def test_gloss_carries_the_same_surface_not_a_translation():
    """The gloss exists so a non-Devanagari reader can locate the entity. If it
    translated the number words, the token would no longer be findable."""
    for u in generate("hi-IN", 60, 1337):
        assert u.gloss and not SLOT_RE.search(u.gloss), u.gloss
        for e in u.entities:
            assert e.surface in u.gloss, f"{u.id}: {e.surface!r} missing from gloss"


def test_adding_gloss_did_not_change_any_existing_utterance():
    """Results already on disk are keyed to these sentences. Regenerating with
    glosses must leave ids, text and gold values byte-identical."""
    us = generate("hi-IN", 40, 1337)
    assert us[0].id == "hi-IN-1337-00000"
    assert us[0].text == "आपका ओटीपी दो एक आठ चार है, इसे किसी के साथ साझा न करें"
    assert us[0].entities[0].normalized == "2184"
