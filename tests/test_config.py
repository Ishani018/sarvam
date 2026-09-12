import pytest

from tee.config import Config, api_key, load_config


def test_default_config_loads(cfg):
    assert cfg.seed == 1337
    assert cfg.audio.sample_rate == 16000
    assert cfg.providers.asr.impl == "mock", "offline mock must be the default"
    assert cfg.providers.tts.impl == "mock", "offline mock must be the default"


def test_duplicate_condition_names_rejected():
    with pytest.raises(Exception):
        Config.model_validate({
            "conditions": [
                {"name": "x", "chain": [{"op": "resample", "rate": 8000}]},
                {"name": "x", "chain": [{"op": "resample", "rate": 8000}]},
            ]
        })


def test_unknown_condition_raises_with_helpful_message(cfg):
    with pytest.raises(KeyError, match="unknown condition"):
        cfg.condition("does_not_exist")


def test_select_conditions(cfg):
    picked = cfg.select_conditions(["clean", "g711_ulaw"])
    assert [c.name for c in picked] == ["clean", "g711_ulaw"]
    assert len(cfg.select_conditions(None)) == len(cfg.conditions)


def test_api_key_absent_raises_not_silently_empty(monkeypatch):
    monkeypatch.delenv("SARVAM_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="SARVAM_API_KEY"):
        api_key()


def test_cost_guard_present(cfg):
    assert cfg.cost.max_api_calls > 0
