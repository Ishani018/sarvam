"""Entity extraction from hypotheses, and the normalizers scoring compares."""

import pytest

from tee.entities import (
    NullNameExtractor,
    extract,
    normalize_currency,
    normalize_date,
    normalize_digit_string,
)


def find(text, lang, etype):
    return {e.normalized for e in extract(text, lang) if e.type == etype}


# --------------------------------------------------------------------------
# Normalizers
# --------------------------------------------------------------------------


def test_normalize_digit_string_strips_everything_but_digits():
    assert normalize_digit_string("5010-0234 5678") == "501002345678"
    assert normalize_digit_string("५६००३४") == "560034"


def test_normalize_currency_is_fixed_precision():
    assert normalize_currency(350000) == "INR:350000.00"
    assert normalize_currency("350000.00") == "INR:350000.00"
    assert normalize_currency(350000) == normalize_currency(350000.0)


def test_normalize_date_handles_partials():
    assert normalize_date(2026, 3, 14) == "2026-03-14"
    assert normalize_date(None, 3, 14) == "--03-14"
    assert normalize_date(2026, 3, None) == "2026-03"


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------


def test_account_number_from_digits_with_cue():
    assert "50100234567890" in find(
        "आपके खाते 50100234567890 में पैसे जमा हुए", "hi-IN", "account_number")


def test_otp_from_spoken_digits():
    assert "481923" in find("आपका ओटीपी चार आठ एक नौ दो तीन है", "hi-IN", "otp")


def test_pin_code_from_spoken_digits():
    assert "560034" in find(
        "पिन कोड पाँच छह शून्य शून्य तीन चार", "hi-IN", "pin_code")


def test_currency_from_words_and_from_digits():
    assert "INR:350000.00" in find(
        "खाते में साढ़े तीन लाख रुपये जमा हुए", "hi-IN", "currency")
    assert "INR:350000.00" in find("₹3,50,000 जमा हुए", "hi-IN", "currency")


def test_adjacent_entities_do_not_steal_each_others_cues():
    """The regression that motivated cue scanning stopping at other numbers:
    the ₹ two tokens later was claiming the account number as an amount."""
    text = "आपके खाते 50100234567890 में ₹3,50,000 जमा हुए हैं"
    assert find(text, "hi-IN", "account_number") == {"50100234567890"}
    assert find(text, "hi-IN", "currency") == {"INR:350000.00"}


def test_magnitude_expression_is_never_an_account_number():
    """"खाते" sits in the lookbehind window, but a lakh expression is an
    amount, not a digit string read aloud."""
    text = "खाते में साढ़े तीन लाख रुपये जमा हुए"
    assert find(text, "hi-IN", "account_number") == set()
    assert find(text, "hi-IN", "currency") == {"INR:350000.00"}


def test_code_mixed_hindi_english():
    assert "481923" in find(
        "आपका OTP four eight one nine two three hai", "hi-IN", "otp")
    assert "INR:350000.00" in find(
        "khaate mein three lakh fifty thousand rupees jama hue", "hi-IN", "currency")


def test_two_entity_types_in_one_sentence():
    text = "आपके खाते 50100234567890 में ₹3,50,000 जमा हुए हैं"
    got = {e.type for e in extract(text, "hi-IN")}
    assert {"account_number", "currency"} <= got


@pytest.mark.parametrize("text,want", [
    ("15/03/2024 को भुगतान", "2024-03-15"),
    ("15 मार्च 2024 को भुगतान", "2024-03-15"),
    ("payment on 15 march 2024", "2024-03-15"),
])
def test_date_extraction(text, want):
    assert want in find(text, "hi-IN", "date")


def test_year_inside_a_date_is_not_a_stray_otp():
    assert find("15 मार्च 2024 को भुगतान", "hi-IN", "otp") == set()


def test_indic_numerals_extract_identically_to_latin():
    a = find("पिन कोड ५६००३४ है", "hi-IN", "pin_code")
    b = find("पिन कोड 560034 है", "hi-IN", "pin_code")
    assert a == b == {"560034"}


def test_types_filter_is_respected():
    text = "आपके खाते 50100234567890 में ₹3,50,000 जमा हुए हैं"
    got = {e.type for e in extract(text, "hi-IN", types=["currency"])}
    assert got == {"currency"}


def test_nothing_extracted_from_entity_free_text():
    assert extract("नमस्ते आप कैसे हैं", "hi-IN") == []


def test_name_extractor_is_a_stub_that_finds_nothing():
    """Deliberate: reporting 0% name accuracy with no extractor would look
    like a result. Name types are excluded from scoring instead."""
    assert NullNameExtractor().extract_names("राम शर्मा बेंगलुरु में", "hi-IN") == []


# --- regressions from run-20260912T174319Z ----------------------------------


def test_unrecognised_word_inside_a_number_emits_nothing_not_a_partial():
    """A number split by a word the lexicon cannot read must not surface as a
    confident partial value. Reporting 500000 here is how an extractor bug
    becomes a published finding about the recogniser."""
    text = "आपके खाते में पाँच लाख XYZQ हज़ार रुपये क्रेडिट हुए हैं"
    assert find(text, "hi-IN", "currency") == set()


def test_566000_is_extracted_now_that_the_variant_is_known():
    text = "आपके खाते में पाँच लाख छयासठ हज़ार रुपये क्रेडिट हुए हैं।"
    assert "INR:566000.00" in find(text, "hi-IN", "currency")


def test_amount_with_no_currency_word_is_still_found():
    """The recogniser routinely drops रुपये: the template says "{amount} रुपये
    की शेष राशि" and the transcript comes back "{amount} की शेष राशि"."""
    text = "आपके खाते में 76,74,000 की शेष राशि है।"
    assert "INR:7674000.00" in find(text, "hi-IN", "currency")


def test_equidistant_cues_emit_both_types():
    """खाते two tokens back, शेष two forward. Letting the digit type win the
    tie dropped the amount entirely."""
    text = "आपके खाते में 76,74,000 की शेष राशि है।"
    types = {e.type for e in extract(text, "hi-IN")}
    assert "currency" in types
