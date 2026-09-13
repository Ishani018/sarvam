"""The acoustic/rendering classifier.

The split is the finding of the verbatim work, so it gets tested against
hand-built rows where the right answer is known by construction rather than
against a run whose own correctness is the thing in question.
"""

from __future__ import annotations

from tee.modes import classify_misses, render, split_by_condition
from tee.score import EntityScore, ScoreRow


def row(mode, *, utt="u1", cond="clean", model="saaras:v3", entities=()):
    return ScoreRow(
        run_id="r", utterance_id=utt, language="hi-IN", condition=cond,
        asr_impl="sarvam", asr_model=model, asr_mode=mode,
        reference="ref", hypothesis="hyp", wer=0.0, entities=list(entities),
    )


def ent(hit, *, etype="account_number", expected="12345", found=None):
    return EntityScore(type=etype, expected=expected, expected_surface=expected,
                       hit=hit, found=found)


def test_right_in_verbatim_is_a_rendering_miss():
    rows = [
        row("transcribe", entities=[ent(False, found="1,23,45")]),
        row("verbatim", entities=[ent(True, found="12345")]),
    ]
    [m] = classify_misses(rows)
    assert m.kind == "rendering"
    assert m.transcribe_found == "1,23,45"
    assert m.verbatim_found == "12345"


def test_wrong_in_both_is_an_acoustic_miss():
    rows = [
        row("transcribe", entities=[ent(False, found="12346")]),
        row("verbatim", entities=[ent(False, found="12346")]),
    ]
    [m] = classify_misses(rows)
    assert m.kind == "acoustic"


def test_no_verbatim_row_is_unpaired_not_acoustic():
    """The alarming bucket must not absorb an incomplete run."""
    [m] = classify_misses([row("transcribe", entities=[ent(False)])])
    assert m.kind == "unpaired"


def test_a_verbatim_row_for_different_audio_does_not_pair():
    rows = [
        row("transcribe", cond="packet_loss_10", entities=[ent(False)]),
        row("verbatim", cond="clean", entities=[ent(True)]),
    ]
    [m] = classify_misses(rows)
    assert m.kind == "unpaired"


def test_pairing_is_per_model():
    rows = [
        row("transcribe", model="saaras:v3", entities=[ent(False)]),
        row("verbatim", model="saaras:v4", entities=[ent(True)]),
    ]
    [m] = classify_misses(rows)
    assert m.kind == "unpaired"


def test_two_entities_of_one_type_pair_on_their_expected_value():
    rows = [
        row("transcribe", entities=[ent(False, expected="111"),
                                    ent(False, expected="222")]),
        row("verbatim", entities=[ent(True, expected="111"),
                                  ent(False, expected="222")]),
    ]
    kinds = {m.expected: m.kind for m in classify_misses(rows)}
    assert kinds == {"111": "rendering", "222": "acoustic"}


def test_hits_are_not_classified():
    rows = [
        row("transcribe", entities=[ent(True)]),
        row("verbatim", entities=[ent(True)]),
    ]
    assert classify_misses(rows) == []


def test_verbatim_rows_are_never_themselves_classified():
    """Only transcribe misses are the subject; verbatim is the control."""
    rows = [row("verbatim", entities=[ent(False)])]
    assert classify_misses(rows) == []


def test_the_per_condition_table_counts_scored_and_hits_from_transcribe_only():
    rows = [
        row("transcribe", cond="clean", entities=[ent(True), ent(False, expected="9")]),
        row("verbatim", cond="clean", entities=[ent(True), ent(True, expected="9")]),
    ]
    [s] = split_by_condition(rows)
    assert (s.scored, s.hits, s.rendering, s.acoustic) == (2, 1, 1, 0)
    assert s.hit_rate == 0.5
    assert s.misses == 1


def test_conditions_are_ordered_by_how_much_rendering_explains():
    rows = [
        row("transcribe", utt="a", cond="quiet", entities=[ent(False)]),
        row("verbatim", utt="a", cond="quiet", entities=[ent(False)]),
        row("transcribe", utt="b", cond="loud",
            entities=[ent(False, expected="1"), ent(False, expected="2")]),
        row("verbatim", utt="b", cond="loud",
            entities=[ent(True, expected="1"), ent(True, expected="2")]),
    ]
    assert [s.condition for s in split_by_condition(rows)] == ["loud", "quiet"]


def test_render_states_the_split_in_words():
    rows = [
        row("transcribe", utt="a", entities=[ent(False, expected="1")]),
        row("verbatim", utt="a", entities=[ent(True, expected="1")]),
        row("transcribe", utt="b", entities=[ent(False, expected="2")]),
        row("verbatim", utt="b", entities=[ent(False, expected="2")]),
    ]
    out = render(split_by_condition(rows))
    assert "2 attributable misses" in out
    assert "1 (50%) were right in verbatim" in out


def test_render_says_so_when_there_is_nothing_to_report():
    assert "needs a run carrying" in render([])


def test_unpaired_misses_are_excluded_from_the_percentages():
    rows = [
        row("transcribe", utt="a", entities=[ent(False, expected="1")]),
        row("verbatim", utt="a", entities=[ent(True, expected="1")]),
        row("transcribe", utt="b", entities=[ent(False, expected="2")]),
    ]
    out = render(split_by_condition(rows))
    assert "Of 1 attributable misses, 1 (100%)" in out
    assert "not" in out and "attributed either way" in out
