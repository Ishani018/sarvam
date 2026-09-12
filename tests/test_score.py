"""Scoring: exact-match hit rate, WER, and the confusion log."""

import pytest

from tee.config import WERConfig
from tee.corpus import Entity, Utterance
from tee.score import (
    ScoreRow, aggregate, levenshtein, read_rows, score_utterance, wer, write_rows,
)

TYPES = ["account_number", "currency", "otp", "pin_code", "date"]


def utt(text, entities, uid="u1", lang="hi-IN"):
    return Utterance(id=uid, language=lang, text=text, entities=entities,
                     source="synthetic")


def score(u, hyp, condition="clean"):
    return score_utterance(u, hyp, condition=condition, run_id="r1",
                           asr_impl="mock", entity_types=TYPES)


def test_exact_match_is_a_hit():
    u = utt("आपका ओटीपी 481923 है",
            [Entity(type="otp", surface="481923", normalized="481923")])
    row = score(u, "आपका ओटीपी 481923 है")
    assert row.entities[0].hit
    assert row.confusions == []


def test_one_wrong_digit_is_a_total_miss():
    """No partial credit: 0.9 similarity on an account number is a transfer to
    the wrong account."""
    u = utt("खाते 50100234567890 में",
            [Entity(type="account_number", surface="50100234567890",
                    normalized="50100234567890")])
    row = score(u, "खाते 50100234567891 में")
    assert not row.entities[0].hit
    assert row.entities[0].edit_distance == 1


def test_confusion_log_records_what_it_became():
    u = utt("साढ़े तीन लाख रुपये",
            [Entity(type="currency", surface="साढ़े तीन लाख",
                    normalized="INR:350000.00")])
    row = score(u, "साढ़े दो लाख रुपये")
    assert len(row.confusions) == 1
    c = row.confusions[0]
    assert c.expected == "INR:350000.00"
    assert c.got == "INR:250000.00"
    assert c.edit_distance and c.edit_distance > 0


def test_missing_entity_records_none_not_a_wrong_value():
    """Found-nothing and found-something-wrong mean different things: one
    usually points at the extractor, the other at the ASR."""
    u = utt("आपका ओटीपी 481923 है",
            [Entity(type="otp", surface="481923", normalized="481923")])
    row = score(u, "आपका संदेश प्राप्त हुआ")
    assert not row.entities[0].hit
    assert row.entities[0].found is None
    assert row.confusions[0].got is None


def test_spoken_and_digit_forms_both_hit():
    gold = [Entity(type="currency", surface="3,50,000", normalized="INR:350000.00")]
    u = utt("₹3,50,000 जमा हुए", gold)
    assert score(u, "₹3,50,000 जमा हुए").entities[0].hit
    assert score(u, "साढ़े तीन लाख रुपये जमा हुए").entities[0].hit


def test_indic_numerals_hit_against_latin_gold():
    u = utt("पिन कोड 560034",
            [Entity(type="pin_code", surface="560034", normalized="560034")])
    assert score(u, "पिन कोड ५६००३४").entities[0].hit


def test_name_types_are_not_scored_in_phase_2():
    u = utt("राम शर्मा को 481923 भेजा",
            [Entity(type="person_name", surface="राम शर्मा", normalized="राम शर्मा"),
             Entity(type="otp", surface="481923", normalized="481923")])
    row = score(u, "राम शर्मा को 481923 भेजा")
    assert [e.type for e in row.entities] == ["otp"]


# --- WER -------------------------------------------------------------------


def test_wer_basics():
    assert wer("a b c", "a b c") == 0.0
    assert wer("a b c", "a b d") == pytest.approx(1 / 3)
    assert wer("a b c", "") == 1.0


def test_wer_ignores_punctuation_and_case():
    assert wer("Ram, Sharma.", "ram sharma") == 0.0


def test_levenshtein():
    assert levenshtein("kitten", "sitting") == 3
    assert levenshtein("", "abc") == 3
    assert levenshtein("abc", "abc") == 0


# --- serialization / aggregation ------------------------------------------


def test_rows_round_trip(tmp_path):
    u = utt("आपका ओटीपी 481923 है",
            [Entity(type="otp", surface="481923", normalized="481923")])
    rows = [score(u, "आपका ओटीपी 481923 है"), score(u, "आपका ओटीपी 481924 है", "g711_ulaw")]
    p = tmp_path / "r.jsonl"
    assert write_rows(p, rows) == 2
    back = read_rows(p)
    assert [r.condition for r in back] == ["clean", "g711_ulaw"]
    assert back[0].entities[0].hit and not back[1].entities[0].hit


def test_aggregate_is_per_type_language_condition():
    u = utt("आपका ओटीपी 481923 है",
            [Entity(type="otp", surface="481923", normalized="481923")])
    rows = [score(u, "आपका ओटीपी 481923 है"),
            score(u, "आपका ओटीपी 481924 है", "g711_ulaw")]
    agg = {(a["condition"], a["entity_type"]): a["hit_rate"] for a in aggregate(rows)}
    assert agg[("clean", "otp")] == 1.0
    assert agg[("g711_ulaw", "otp")] == 0.0
