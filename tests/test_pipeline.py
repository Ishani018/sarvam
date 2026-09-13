"""The run pipeline and its dry-run cost planning."""

import pytest

from tee.asr import MockASR
from tee.cache import ResponseCache
from tee.config import load_config
from tee.corpus import load_utterances
from tee.costs import BudgetExceeded, CostGuard
from tee.pipeline import execute_run, plan_run
from tee.tts import MockTTS


@pytest.fixture
def small(cfg):
    return load_utterances("fixtures/utterances.jsonl")[:3]


def test_plan_counts_calls_exactly(cfg, small):
    conds = cfg.select_conditions(["clean", "g711_ulaw", "packet_loss_5"])
    p = plan_run(cfg, small, conds)
    assert p.tts_calls == 3
    assert p.asr_calls == 9
    assert p.total_calls == 12


def test_calibration_run_shape_is_40_and_120_per_model():
    """The run specified for phase 2: 40 utterances, 3 conditions, one model."""
    from tee.generate import generate
    cfg = load_config("configs/default.yaml")
    conds = cfg.select_conditions(["clean", "g711_ulaw", "packet_loss_5"])
    p = plan_run(cfg, generate("hi-IN", 40, 1337), conds, asr_models=["saaras:v3"])
    assert (p.tts_calls, p.asr_calls) == (40, 120)


def test_each_extra_model_multiplies_the_asr_calls_not_the_tts_calls():
    """Audio is synthesized and degraded once and reused across models, so a
    model comparison costs ASR calls only -- and compares over identical bytes."""
    from tee.generate import generate
    cfg = load_config("configs/default.yaml")
    conds = cfg.select_conditions(["clean", "g711_ulaw", "packet_loss_5"])
    utts = generate("hi-IN", 40, 1337)
    one = plan_run(cfg, utts, conds, asr_models=["saaras:v3"])
    two = plan_run(cfg, utts, conds, asr_models=["saaras:v3", "saaras:v4"])
    assert two.tts_calls == one.tts_calls == 40
    assert two.asr_calls == 240
    # The dry run shows the arithmetic, not just the total, so a reader can see
    # which axis is multiplying the bill before they approve it.
    out = two.render()
    assert "saaras:v3, saaras:v4   (x2)" in out
    assert "40 utterances x 3 conditions x 2 models x 1 modes  =  240" in out


def test_default_config_compares_v3_and_v4():
    cfg = load_config("configs/default.yaml")
    assert cfg.providers.asr.sarvam.models == ["saaras:v3", "saaras:v4"]


def test_multiple_models_produce_one_row_each_over_identical_audio(cfg, small, tmp_path):
    from tee.asr import MockASR as M
    cfg = cfg.model_copy(deep=True)
    cfg.paths.work_dir = tmp_path / "work"
    conds = cfg.select_conditions(["clean"])
    plan = plan_run(cfg, small, conds, run_id="tm", asr_models=["a", "b"])
    a, b = M(), M(error_rate=0.5)
    a.name, b.name = "a", "b"
    rows = execute_run(cfg, plan, MockTTS(), [a, b], CostGuard(cfg.cost))
    assert len(rows) == len(small) * 2
    # Same audio for both models: that is what makes the comparison fair.
    assert len({r.audio_sha256 for r in rows}) == len(small)


def test_plan_flags_over_budget(cfg, small):
    cfg = cfg.model_copy(deep=True)
    cfg.cost.max_api_calls = 5
    p = plan_run(cfg, small, cfg.select_conditions(["clean", "g711_ulaw"]))
    assert p.over_budget
    assert "ABORT" in p.render()


def test_dry_run_render_states_nothing_was_spent(cfg, small):
    p = plan_run(cfg, small, cfg.select_conditions(["clean"]))
    text = p.render()
    assert "no API calls made, nothing spent" in text
    assert "TTS calls" in text and "ASR calls" in text


def test_end_to_end_on_mocks(cfg, small, tmp_path):
    cfg = cfg.model_copy(deep=True)
    cfg.paths.work_dir = tmp_path / "work"
    conds = cfg.select_conditions(["clean", "g711_ulaw"])
    plan = plan_run(cfg, small, conds, run_id="t1")
    guard = CostGuard(cfg.cost)
    rows = execute_run(cfg, plan, MockTTS(), [MockASR()],
                       guard, on_progress=None)

    assert len(rows) == 6
    assert {r.condition for r in rows} == {"clean", "g711_ulaw"}
    # A verbatim mock must score a perfect hit rate; anything less is a bug in
    # the extractor or the scorer, not a result.
    assert all(e.hit for r in rows for e in r.entities), \
        [(r.utterance_id, e.expected, e.found) for r in rows for e in r.entities if not e.hit]
    assert all(r.wer == 0.0 for r in rows)
    assert all(r.audio_sha256 for r in rows)


def test_mock_run_spends_nothing(cfg, small, tmp_path):
    cfg = cfg.model_copy(deep=True)
    cfg.paths.work_dir = tmp_path / "work"
    plan = plan_run(cfg, small, cfg.select_conditions(["clean"]), run_id="t2")
    guard = CostGuard(cfg.cost)
    execute_run(cfg, plan, MockTTS(), [MockASR()], guard)
    assert guard.api_calls == 0 and guard.estimated_cost == 0.0


def test_corrupted_mock_produces_scorable_misses(cfg, small, tmp_path):
    cfg = cfg.model_copy(deep=True)
    cfg.paths.work_dir = tmp_path / "work"
    plan = plan_run(cfg, small, cfg.select_conditions(["clean"]), run_id="t3")
    rows = execute_run(cfg, plan, MockTTS(), [MockASR(error_rate=1.0)],
                       CostGuard(cfg.cost))
    assert any(not e.hit for r in rows for e in r.entities)


def test_provider_failure_is_recorded_not_swallowed(cfg, small, tmp_path):
    class Boom:
        name = "boom"

        def transcribe(self, audio_path, language, hint=None):
            raise RuntimeError("HTTP 500")

    cfg = cfg.model_copy(deep=True)
    cfg.paths.work_dir = tmp_path / "work"
    plan = plan_run(cfg, small, cfg.select_conditions(["clean"]), run_id="t4")
    rows = execute_run(cfg, plan, MockTTS(), [Boom()], CostGuard(cfg.cost))
    assert len(rows) == 3
    assert all(r.error and "HTTP 500" in r.error for r in rows)


def test_dry_run_does_not_charge_for_tts_already_in_the_cache(cfg, tmp_path):
    """Re-running new CONDITIONS against an already-synthesised corpus is
    almost entirely free: TTS is keyed on the text alone. Counting those as
    spend overstates the bill and can trip the guard into refusing a run that
    costs nothing."""
    from tee.cache import ResponseCache, request_key
    from tee.generate import generate

    cfg = cfg.model_copy(deep=True)
    cfg.providers.tts.impl = "sarvam"
    cfg.providers.asr.impl = "sarvam"
    utts = generate("hi-IN", 10, 1337)
    conds = cfg.select_conditions(["packet_loss_burst_5"])
    cache = ResponseCache(tmp_path / "c", tmp_path / "r")

    cold = plan_run(cfg, utts, conds, asr_models=["saaras:v3"], cache=cache)
    assert cold.tts_cached == 0
    assert cold.tts_calls == 10
    assert cold.total_calls == 10 + 10  # 10 TTS + 10 ASR

    sarvam = cfg.providers.tts.sarvam
    for u in utts:
        cache.put(request_key({
            "provider": "sarvam-tts", "endpoint": sarvam.endpoint,
            "text": u.text, "target_language_code": u.language,
            "model": sarvam.model, "speaker": sarvam.speaker,
            "pace": sarvam.pace,
            "speech_sample_rate": sarvam.speech_sample_rate,
            **sarvam.extra_params,
        }), {"path": "x", "sha256": "y"})

    warm = plan_run(cfg, utts, conds, asr_models=["saaras:v3"], cache=cache)
    assert warm.tts_cached == 10
    assert warm.total_calls == 10, "only the ASR calls remain"
    assert warm.estimated_cost < cold.estimated_cost
    assert "already cached" in warm.render()


def test_asr_calls_are_never_predicted_as_cached(cfg, tmp_path):
    """ASR keys include the audio checksum, and degraded audio for a condition
    that has not run yet does not exist. Claiming an ASR cache hit at plan time
    would be a guess."""
    from tee.cache import ResponseCache
    from tee.generate import generate

    cfg = cfg.model_copy(deep=True)
    cfg.providers.asr.impl = "sarvam"
    cfg.providers.tts.impl = "sarvam"
    p = plan_run(cfg, generate("hi-IN", 5, 1337),
                 cfg.select_conditions(["packet_loss_burst_5", "noisy_line_snr5"]),
                 asr_models=["saaras:v3", "saaras:v4"],
                 cache=ResponseCache(tmp_path / "c", tmp_path / "r"))
    assert p.asr_calls == 5 * 2 * 2
