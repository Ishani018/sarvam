"""Providers, cache and cost guard. Nothing here touches the network."""

import json

import pytest

from tee.asr import MockASR
from tee.cache import ResponseCache, request_key
from tee.config import CostConfig, load_config
from tee.costs import BudgetExceeded, CostGuard
from tee.tts import MockTTS


# --- cache ------------------------------------------------------------------


def test_request_key_is_order_independent_and_content_sensitive():
    assert request_key({"a": 1, "b": 2}) == request_key({"b": 2, "a": 1})
    assert request_key({"a": 1}) != request_key({"a": 2})


def test_key_covers_model_and_mode_so_a_config_change_refetches():
    base = {"audio_sha256": "abc", "language_code": "hi-IN", "model": "saaras:v3"}
    assert request_key({**base, "mode": "transcribe"}) != \
           request_key({**base, "mode": "verbatim"})
    assert request_key({**base, "mode": "transcribe"}) != \
           request_key({**base, "model": "saaras:v4", "mode": "transcribe"})


def test_cache_round_trip(tmp_path):
    c = ResponseCache(tmp_path / "c", tmp_path / "raw")
    assert c.get("k1") is None
    c.put("k1", {"transcript": "नमस्ते"})
    assert c.get("k1")["transcript"] == "नमस्ते"


def test_disabled_cache_never_returns(tmp_path):
    c = ResponseCache(tmp_path / "c", tmp_path / "raw", enabled=False)
    c.put("k1", {"transcript": "x"})
    assert c.get("k1") is None


def test_corrupt_cache_entry_refetches_instead_of_crashing(tmp_path):
    c = ResponseCache(tmp_path / "c", tmp_path / "raw")
    c.put("k1", {"transcript": "x"})
    c._path("k1").write_text("{not json")
    assert c.get("k1") is None


def test_raw_response_body_is_kept_for_debugging(tmp_path):
    c = ResponseCache(tmp_path / "c", tmp_path / "raw")
    p = c.put_raw("k1", b'{"transcript": "\\u0968\\u0969"}')
    assert p.exists() and b"transcript" in p.read_bytes()


# --- cost guard -------------------------------------------------------------


def test_guard_aborts_rather_than_warns():
    g = CostGuard(CostConfig(max_api_calls=2))
    g.spend_tts(10)
    g.spend_tts(10)
    with pytest.raises(BudgetExceeded, match="max_api_calls"):
        g.spend_tts(10)


def test_cached_calls_are_free():
    g = CostGuard(CostConfig(max_api_calls=1))
    for _ in range(50):
        g.note_cached()
    g.spend_asr(1.0)  # the one real call still fits
    assert g.api_calls == 1 and g.cached_calls == 50


def test_cost_estimate_uses_the_rate_card():
    g = CostGuard(CostConfig(max_api_calls=10, asr_inr_per_audio_second=0.1,
                             tts_inr_per_1k_chars=2.0))
    g.spend_asr(30.0)
    g.spend_tts(500)
    assert g.estimated_cost == pytest.approx(30 * 0.1 + 0.5 * 2.0)


# --- mock providers ---------------------------------------------------------


def test_mock_is_the_default_provider():
    cfg = load_config("configs/default.yaml")
    assert cfg.providers.asr.impl == "mock"
    assert cfg.providers.tts.impl == "mock"


def test_mock_tts_is_deterministic(tmp_path):
    a = MockTTS().synthesize("तीन लाख", "hi-IN", tmp_path / "a.wav")
    b = MockTTS().synthesize("तीन लाख", "hi-IN", tmp_path / "b.wav")
    assert a.sha256 == b.sha256


def test_mock_tts_length_tracks_text_length(tmp_path):
    short = MockTTS().synthesize("तीन", "hi-IN", tmp_path / "s.wav")
    long = MockTTS().synthesize("तीन लाख पचास हज़ार रुपये जमा हुए हैं" * 3,
                                "hi-IN", tmp_path / "l.wav")
    assert long.path.stat().st_size > short.path.stat().st_size


def test_mock_asr_returns_the_reference_verbatim_by_default(tmp_path):
    t = MockTTS().synthesize("आपका ओटीपी 481923 है", "hi-IN", tmp_path / "a.wav")
    assert MockASR().transcribe(t.path, "hi-IN").text == "आपका ओटीपी 481923 है"


def test_mock_asr_reads_the_sidecar_when_no_hint_is_given(tmp_path):
    t = MockTTS().synthesize("आपका ओटीपी 481923 है", "hi-IN", tmp_path / "a.wav")
    assert t.path.with_suffix(".ref.json").exists()
    assert MockASR().transcribe(t.path, "hi-IN", hint=None).text


def test_mock_asr_corruption_is_deterministic(tmp_path):
    t = MockTTS().synthesize("आपका ओटीपी 481923 है", "hi-IN", tmp_path / "a.wav")
    a = MockASR(error_rate=0.5).transcribe(t.path, "hi-IN").text
    b = MockASR(error_rate=0.5).transcribe(t.path, "hi-IN").text
    assert a == b


def test_mock_asr_corruption_only_touches_digits(tmp_path):
    t = MockTTS().synthesize("आपका ओटीपी 481923 है", "hi-IN", tmp_path / "a.wav")
    out = MockASR(error_rate=1.0).transcribe(t.path, "hi-IN").text
    assert "आपका ओटीपी" in out and out != "आपका ओटीपी 481923 है"
