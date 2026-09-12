"""The hand-written dev fixtures must stay loadable and self-consistent."""

from tee.corpus import load_utterances
from tee.entities import extract

TYPES = ["account_number", "currency", "otp", "pin_code", "date"]


def test_fixtures_load():
    us = load_utterances("fixtures/utterances.jsonl")
    assert len(us) >= 12
    assert all(u.entities for u in us)


def test_every_fixture_gold_is_recoverable_from_its_own_text():
    for u in load_utterances("fixtures/utterances.jsonl"):
        found = extract(u.text, u.language, types=TYPES)
        for g in u.entities:
            same = [c.normalized for c in found if c.type == g.type]
            assert g.normalized in same, f"{u.id}: {g.type} {g.normalized} not in {same}"


def test_fixtures_cover_both_realizations_and_code_mixing():
    us = load_utterances("fixtures/utterances.jsonl")
    assert {u.realization for u in us} >= {"digits", "words"}
    assert any(u.meta.get("code_mixed") for u in us)
    assert any(len(u.entities) > 1 for u in us)
