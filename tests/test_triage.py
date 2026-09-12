"""Triage: the classifier has to separate my bugs from real results.

Each bucket gets a constructed case, because a classifier that can only ever
emit asr_error would look perfectly healthy on a run where everything is an
extractor bug -- which is exactly what the first real run is expected to be.
"""

import pytest

from tee.corpus import Entity, Utterance
from tee.score import score_utterance
from tee.triage import classify, render_report, triage

TYPES = ["account_number", "currency", "otp", "pin_code", "date"]


def row(text, entities, hyp, condition="clean", **kw):
    u = Utterance(id="u1", language="hi-IN", text=text, entities=entities,
                  source="synthetic", **kw)
    return score_utterance(u, hyp, condition=condition, run_id="r1",
                           asr_impl="mock", entity_types=TYPES)


def only_miss(r):
    misses = [e for e in r.entities if not e.hit]
    assert len(misses) == 1, f"expected exactly one miss, got {len(misses)}"
    return classify(r, misses[0])


# --- asr_error --------------------------------------------------------------


def test_wrong_value_in_hypothesis_is_an_asr_error():
    r = row("आपका ओटीपी 481923 है",
            [Entity(type="otp", surface="481923", normalized="481923")],
            "आपका ओटीपी 481924 है")
    m = only_miss(r)
    assert m.bucket == "asr_error"
    assert "edit distance 1" in m.reason


def test_entity_dropped_entirely_is_an_asr_error():
    r = row("आपका ओटीपी 481923 है",
            [Entity(type="otp", surface="481923", normalized="481923")],
            "आपका संदेश प्राप्त हुआ")
    m = only_miss(r)
    assert m.bucket == "asr_error"
    assert "absent" in m.reason


# --- extractor_error --------------------------------------------------------


def test_value_present_but_mistyped_is_an_extractor_error():
    """The ASR got it right; the extractor filed it under the wrong type."""
    r = row("पिन कोड 560034 दर्ज करें",
            [Entity(type="pin_code", surface="560034", normalized="560034")],
            "मेरा खाता 560034 है")
    m = only_miss(r)
    assert m.bucket == "extractor_error"
    assert "typed as" in m.reason


def test_digits_fragmented_across_tokens_is_an_extractor_error():
    """The ASR heard every digit but split the run around an interposed word.
    Adjacent digit tokens are merged into one run already; a word in between
    breaks that, and nothing reassembles across the gap."""
    r = row("पिन कोड 560034 दर्ज करें",
            [Entity(type="pin_code", surface="560034", normalized="560034")],
            "पिन कोड 5600 दर्ज 34 करें")
    m = only_miss(r)
    assert m.bucket == "extractor_error"
    assert "fragmented" in m.reason


def test_short_value_substring_match_is_flagged_uncertain_not_confirmed():
    """"1234" occurs inside plenty of account numbers; that is not evidence."""
    r = row("आपका ओटीपी 1234 है",
            [Entity(type="otp", surface="1234", normalized="1234")],
            "आपका खाता 9912345678901 है")
    m = only_miss(r)
    assert m.bucket == "uncertain" and m.uncertain
    assert "coincidental" in m.reason


def test_amount_parseable_but_not_extracted_is_an_extractor_error():
    """The amount is in the hypothesis, but the currency cue did not survive and
    a nearer account cue claimed the run, so no currency candidate was emitted."""
    r = row("आपको 3,50,000 रुपये मिले",
            [Entity(type="currency", surface="3,50,000",
                    normalized="INR:350000.00")],
            "आपका खाता 350000 है")
    m = only_miss(r)
    assert m.bucket == "extractor_error"
    assert "parseable" in m.reason


# --- gold_error -------------------------------------------------------------


def test_gold_not_recoverable_from_reference_is_a_gold_error():
    """Gold says 999999 but the sentence says 481923: the sampler or template
    is wrong, and the other two questions are meaningless until it is fixed."""
    r = row("आपका ओटीपी 481923 है",
            [Entity(type="otp", surface="999999", normalized="999999")],
            "आपका ओटीपी 481923 है")
    m = only_miss(r)
    assert m.bucket == "gold_error"
    assert "reference" in m.reason


def test_gold_error_is_checked_before_extractor_error():
    """Order matters: a bad gold would otherwise be reported as an ASR error
    and counted as a finding."""
    r = row("आपका ओटीपी 481923 है",
            [Entity(type="otp", surface="777777", normalized="777777")],
            "कुछ और")
    assert only_miss(r).bucket == "gold_error"


# --- uncertain --------------------------------------------------------------


def test_provider_failure_is_uncertain_not_an_asr_error():
    u = Utterance(id="u1", language="hi-IN", text="आपका ओटीपी 481923 है",
                  entities=[Entity(type="otp", surface="481923", normalized="481923")],
                  source="synthetic")
    r = score_utterance(u, "", condition="clean", run_id="r1", asr_impl="mock",
                        entity_types=TYPES, error="HTTP 500")
    m = classify(r, r.entities[0])
    assert m.bucket == "uncertain"
    assert m.uncertain


def test_empty_hypothesis_without_error_is_uncertain():
    r = row("आपका ओटीपी 481923 है",
            [Entity(type="otp", surface="481923", normalized="481923")], "")
    m = only_miss(r)
    assert m.bucket == "uncertain"


# --- report -----------------------------------------------------------------


def test_report_groups_and_counts():
    rows = [
        row("आपका ओटीपी 481923 है",
            [Entity(type="otp", surface="481923", normalized="481923")],
            "आपका ओटीपी 481924 है"),
        row("आपका ओटीपी 481923 है",
            [Entity(type="otp", surface="999999", normalized="999999")],
            "आपका ओटीपी 481923 है"),
    ]
    misses = triage(rows)
    assert {m.bucket for m in misses} == {"asr_error", "gold_error"}
    text = render_report(rows, misses)
    assert "TRIAGE REPORT" in text
    assert "asr_error" in text and "gold_error" in text
    assert "my bug" in text  # the buckets are labelled as bugs, not findings


def test_hits_produce_no_misses():
    r = row("आपका ओटीपी 481923 है",
            [Entity(type="otp", surface="481923", normalized="481923")],
            "आपका ओटीपी 481923 है")
    assert triage([r]) == []
