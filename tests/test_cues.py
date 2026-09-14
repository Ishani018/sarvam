"""Cue survival: did the words that say what a number IS come through?

Hand-built rows, because the claim this module supports -- that burst loss
strips numbers of their type as well as their digits -- has to be measured
rather than illustrated, and a measurement whose correctness rests on a run
that has not been checked is not a measurement.

Reference and hypothesis are real Hindi here rather than placeholders: the
whole module works on tokens, and a test over "ref"/"hyp" would pass while the
canonicalizer was broken.
"""

from __future__ import annotations

from tee.cues import SHAPED_TYPES, analyse, cue_index, orphans, render
from tee.score import EntityScore, ScoreRow

FULL = "आपके खाते में चौदह सौ रुपये जमा हुए हैं"
NO_CUE = "आपके में चौदह सौ हुए हैं"          # रुपये, जमा and खाते all gone
NO_VALUE = "आपके खाते में रुपये जमा हुए हैं"  # the cue survived, the value did not


def row(*, cond="packet_loss_burst_5", ref=FULL, hyp=FULL, entities=()):
    return ScoreRow(
        run_id="r", utterance_id="u1", language="hi-IN", condition=cond,
        asr_impl="sarvam", asr_model="saaras:v3", asr_mode="verbatim",
        reference=ref, hypothesis=hyp, wer=0.0, entities=list(entities),
    )


def ent(hit, *, etype="currency", expected="INR:1400.00"):
    return EntityScore(type=etype, expected=expected, expected_surface="चौदह सौ",
                       hit=hit)


# --------------------------------------------------------------- cue index --

def test_cue_index_maps_a_token_to_every_type_it_identifies():
    idx = cue_index("hi-IN")
    assert "currency" in idx["रुपये"]
    assert "account_number" in idx["खाते"]
    # A financial context word is a currency cue even though it is not a
    # currency name; that is the point of the widened cue set.
    assert "currency" in idx["जमा"]


def test_currency_has_no_shape_to_fall_back_on():
    # Not a style assertion: it is why a lost currency cue is unrecoverable
    # while a lost account cue is not, and the report says so.
    assert "currency" not in SHAPED_TYPES
    assert {"account_number", "otp", "pin_code"} <= SHAPED_TYPES


# ---------------------------------------------------------- cue survival ----

def test_an_undamaged_row_keeps_every_cue():
    [c] = analyse([row(entities=[ent(True)])])
    assert c.cue_survival == 1.0
    assert c.orphans == 0


def test_a_lost_cue_is_counted_against_the_cues_not_the_words():
    [c] = analyse([row(hyp=NO_CUE, entities=[ent(False)])])
    assert c.cue_survival == 0.0
    # Ordinary words mostly survived, which is the comparison that makes the
    # cue figure mean anything.
    assert c.word_survival is not None and c.word_survival > 0.5


def test_cue_survival_is_a_multiset_not_a_set():
    # Two currency cues in, one out: half, not none and not all.
    ref = "चौदह सौ रुपये जमा"
    hyp = "चौदह सौ रुपये"
    [c] = analyse([row(ref=ref, hyp=hyp, entities=[ent(True)])])
    assert c.cue_total == 2 and c.cue_kept == 1
    assert c.cue_survival == 0.5


# -------------------------------------------------------------- orphans -----

def test_value_present_without_its_cue_is_an_orphan():
    rows = [row(hyp=NO_CUE, entities=[ent(False)])]
    [c] = analyse(rows)
    assert c.value_present == 1
    assert c.orphans == 1
    assert c.orphans_unrecovered == 1
    assert c.by_type["currency"] == 1

    [o] = orphans(rows)
    assert o.entity_type == "currency"
    assert o.cues_survived == 0
    assert o.extractor_recovered is False


def test_an_orphan_the_extractor_recovered_is_still_an_orphan():
    # The transcript stripped the value of its type. That this extractor got
    # there anyway is a separate fact, and the two are counted separately.
    rows = [row(hyp=NO_CUE, entities=[ent(True)])]
    [c] = analyse(rows)
    assert c.orphans == 1
    assert c.orphans_unrecovered == 0
    assert orphans(rows)[0].extractor_recovered is True


def test_a_lost_value_is_not_an_orphan():
    # Nothing to be orphaned: the number itself did not arrive. This is an
    # ordinary acoustic miss and belongs in the other report.
    rows = [row(hyp=NO_VALUE, entities=[ent(False)])]
    [c] = analyse(rows)
    assert c.value_present == 0
    assert c.orphans == 0
    assert orphans(rows) == []


def test_an_entity_the_reference_never_cued_is_not_an_orphan():
    # No cue word in the reference means the line destroyed nothing. Counting
    # this would attribute an extractor design choice to packet loss.
    bare = "चौदह सौ"
    rows = [row(ref=bare, hyp=bare, entities=[ent(False)])]
    [c] = analyse(rows)
    assert c.orphans == 0
    assert orphans(rows) == []


def test_rows_that_failed_are_skipped_entirely():
    bad = row(entities=[ent(False)])
    bad.error = "boom"
    empty = row(hyp="   ", entities=[ent(False)])
    assert analyse([bad, empty]) == []
    assert orphans([bad, empty]) == []


# ---------------------------------------------------------------- report ----

def test_the_report_separates_the_line_from_the_extractor():
    rows = [row(hyp=NO_CUE, entities=[ent(True)]),
            row(hyp=NO_CUE, entities=[ent(False)])]
    text = render(analyse(rows), orphans(rows))
    assert "CUE SURVIVAL" in text
    assert "2 of 2 recoverable values" in text
    assert "were not scored as" in text
    assert "no shape to fall back on" in text


def test_conditions_are_reported_separately():
    rows = [row(cond="clean", entities=[ent(True)]),
            row(cond="packet_loss_burst_5", hyp=NO_CUE, entities=[ent(False)])]
    stats = {c.condition: c for c in analyse(rows)}
    assert stats["clean"].cue_survival == 1.0
    assert stats["packet_loss_burst_5"].cue_survival == 0.0
