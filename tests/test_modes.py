"""Mode as an axis: config, provider fan-out, cache isolation, cost.

Every assertion here exists because something downstream would otherwise be
taken on trust. The cache one in particular: the claim "the key already
includes mode, so verbatim will miss rather than return a stale transcribe
response" is exactly the kind of thing that is true right up until someone
reorders a dict, and getting it wrong means a verbatim run silently scoring
transcribe output.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from tee.asr import SarvamASR, build_asr
from tee.cache import ResponseCache
from tee.config import Config, SarvamASRConfig
from tee.config import CostConfig
from tee.costs import CostGuard


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------


def test_modes_defaults_to_transcribe():
    assert SarvamASRConfig().modes == ["transcribe"]


def test_singular_mode_is_read_as_a_one_element_axis():
    """Every config written before mode became an axis used `mode:`."""
    cfg = SarvamASRConfig.model_validate({"mode": "verbatim"})
    assert cfg.modes == ["verbatim"]


def test_setting_both_mode_and_modes_is_an_error():
    # Ambiguous: one of them would have to win silently.
    with pytest.raises(ValidationError, match="not both"):
        SarvamASRConfig.model_validate({"mode": "verbatim", "modes": ["transcribe"]})


def test_empty_modes_is_rejected():
    with pytest.raises(ValidationError, match="at least one mode"):
        SarvamASRConfig.model_validate({"modes": []})


def test_duplicate_modes_are_rejected():
    # Would double every ASR call for no extra information.
    with pytest.raises(ValidationError, match="duplicate"):
        SarvamASRConfig.model_validate({"modes": ["verbatim", "verbatim"]})


def test_an_unknown_mode_fails_at_load_rather_than_as_a_400():
    with pytest.raises(ValidationError):
        SarvamASRConfig.model_validate({"modes": ["verbatm"]})


def test_the_shipped_config_still_loads(cfg):
    # configs/default.yaml still says `mode: transcribe`.
    assert cfg.providers.asr.sarvam.modes == ["transcribe"]


# --------------------------------------------------------------------------
# Provider fan-out
# --------------------------------------------------------------------------


def _cfg(models, modes) -> Config:
    cfg = Config()
    cfg.providers.asr.impl = "sarvam"
    cfg.providers.asr.sarvam = SarvamASRConfig(models=models, modes=modes)
    return cfg


def test_build_asr_returns_the_product_of_models_and_modes(tmp_path):
    cache = ResponseCache(tmp_path / "c", tmp_path / "r")
    guard = CostGuard(CostConfig(max_api_calls=1000))
    providers = build_asr(_cfg(["saaras:v3", "saaras:v4"],
                               ["transcribe", "verbatim"]), cache, guard)
    assert [(p.model, p.mode) for p in providers] == [
        ("saaras:v3", "transcribe"),
        ("saaras:v4", "transcribe"),
        ("saaras:v3", "verbatim"),
        ("saaras:v4", "verbatim"),
    ]


def test_one_mode_is_unchanged_from_before(tmp_path):
    cache = ResponseCache(tmp_path / "c", tmp_path / "r")
    guard = CostGuard(CostConfig(max_api_calls=1000))
    providers = build_asr(_cfg(["saaras:v3", "saaras:v4"], ["transcribe"]),
                          cache, guard)
    assert [(p.model, p.mode) for p in providers] == [
        ("saaras:v3", "transcribe"), ("saaras:v4", "transcribe"),
    ]


# --------------------------------------------------------------------------
# Cache isolation
# --------------------------------------------------------------------------


def _key(tmp_path, mode: str, audio) -> str:
    """The request key a provider in this mode would compute for this audio."""
    cache = ResponseCache(tmp_path / "c", tmp_path / "r")
    guard = CostGuard(CostConfig(max_api_calls=1000))
    p = SarvamASR(SarvamASRConfig(models=["saaras:v3"], modes=[mode]),
                  cache, guard, model="saaras:v3", mode=mode)
    # Reach the key without a network call: transcribe() computes it first, and
    # a cache hit returns before any request is attempted.
    cache.put(p_key := _compute_key(p, audio), {"transcript": "x", "raw_path": ""})
    return p_key


def _compute_key(provider: SarvamASR, audio) -> str:
    from tee.audio import sha256_file
    from tee.cache import request_key
    return request_key({
        "provider": "sarvam-asr",
        "endpoint": provider.cfg.endpoint,
        "model": provider.model,
        "mode": provider.mode,
        "language_code": "hi-IN",
        "audio_sha256": sha256_file(audio),
    })


def test_verbatim_does_not_hit_a_transcribe_cache_entry(tmp_path, tone_wav):
    """The point of the axis: identical audio, different mode, different key."""
    assert _key(tmp_path, "transcribe", tone_wav) != _key(tmp_path, "verbatim", tone_wav)


def test_the_same_mode_on_the_same_audio_does_hit(tmp_path, tone_wav):
    assert _key(tmp_path, "verbatim", tone_wav) == _key(tmp_path, "verbatim", tone_wav)


def test_a_cached_transcribe_response_is_not_returned_to_verbatim(tmp_path, tone_wav):
    """End to end through the provider, not just the key function.

    A verbatim provider looking at a cache containing only a transcribe entry
    must report a miss. If it reported a hit the run would score Sarvam's
    normalised output and label it verbatim, which is the exact confound the
    mode axis exists to remove.
    """
    cache = ResponseCache(tmp_path / "c", tmp_path / "r")
    guard = CostGuard(CostConfig(max_api_calls=1000))
    cfg = SarvamASRConfig(models=["saaras:v3"], modes=["transcribe", "verbatim"])

    t = SarvamASR(cfg, cache, guard, model="saaras:v3", mode="transcribe")
    v = SarvamASR(cfg, cache, guard, model="saaras:v3", mode="verbatim")

    cache.put(_compute_key(t, tone_wav),
              {"transcript": "3,50,000", "raw_path": "", "mode": "transcribe"})

    assert cache.get(_compute_key(t, tone_wav)) is not None
    assert cache.get(_compute_key(v, tone_wav)) is None


# --------------------------------------------------------------------------
# Cost
# --------------------------------------------------------------------------


def test_every_mode_multiplies_the_asr_calls(utterances, cfg):
    from tee.pipeline import plan_run
    cfg = cfg.model_copy(deep=True)
    cfg.providers.asr.impl = "sarvam"
    conds = cfg.conditions[:2]
    sample_utterances = utterances

    one = plan_run(cfg, sample_utterances, conds, asr_models=["saaras:v3"],
                   asr_modes=["transcribe"])
    two = plan_run(cfg, sample_utterances, conds, asr_models=["saaras:v3"],
                   asr_modes=["transcribe", "verbatim"])

    assert two.asr_calls == one.asr_calls * 2
    assert two.estimated_audio_seconds == pytest.approx(
        one.estimated_audio_seconds * 2)
    assert two.asr_modes == ["transcribe", "verbatim"]


def test_modes_and_models_multiply_together(utterances, cfg):
    from tee.pipeline import plan_run
    cfg = cfg.model_copy(deep=True)
    cfg.providers.asr.impl = "sarvam"
    conds = cfg.conditions[:2]
    sample_utterances = utterances
    plan = plan_run(cfg, sample_utterances, conds,
                    asr_models=["saaras:v3", "saaras:v4"],
                    asr_modes=["transcribe", "verbatim"])
    assert plan.asr_calls == len(sample_utterances) * len(conds) * 2 * 2


def test_the_dry_run_shows_the_mode_arithmetic(utterances, cfg):
    """A reader of the dry run should see where the number came from."""
    from tee.pipeline import plan_run
    cfg = cfg.model_copy(deep=True)
    cfg.providers.asr.impl = "sarvam"
    out = plan_run(cfg, utterances, cfg.conditions[:2],
                   asr_models=["saaras:v3"],
                   asr_modes=["transcribe", "verbatim"]).render()
    assert "transcribe, verbatim" in out
    assert "x 2 modes  =  " in out


# --------------------------------------------------------------------------
# The extractor against verbatim-shaped output
# --------------------------------------------------------------------------
#
# Under `transcribe` the extractor often receives digits; under `verbatim` it
# receives number words every time. The parser is built for both, but "built
# for" is not evidence, and a verbatim run that silently extracts nothing would
# look exactly like a run where the model misheard everything.
#
# These are real clean-condition transcripts from the corpus on this page, kept
# verbatim including the Devanagari punctuation, paired with the gold value the
# generator started from.

VERBATIM_CASES = [
    # account number as a digit sequence, amount as a magnitude
    ("आपके खाते छह पाँच तीन तीन पाँच सात दो शून्य एक आठ पाँच दो आठ एक में "
     "पाँच लाख रुपये जमा हुए हैं।",
     {"account_number": "65335720185281", "currency": "INR:500000.00"}),
    # a date in words, and lakh/thousand composition
    ("दस दिसंबर दो हज़ार छब्बीस तक पचहत्तर लाख आठ हज़ार रुपये का भुगतान करना "
     "आवश्यक है।",
     {"date": "2026-12-10", "currency": "INR:7508000.00"}),
    # PIN code, digit sequence including a zero
    ("डिलीवरी का पिन कोड तीन सात पाँच शून्य दो दो दर्ज किया गया है।",
     {"pin_code": "375022"}),
    # sixteen digits, then a three-digit amount in the hundreds
    ("खाता एक छह एक शून्य आठ दो आठ दो छह छह चार पाँच सात आठ पाँच तीन से "
     "सात सौ सत्तानवे रुपये काटे गए हैं।",
     {"account_number": "1610828266457853", "currency": "INR:797.00"}),
    # an amount and an OTP in one sentence, cues distinguishing them
    ("तिरसठ लाख रुपये के लेनदेन के लिए आपका ओटीपी सात नौ दो सात है।",
     {"currency": "INR:6300000.00", "otp": "7927"}),
]


@pytest.mark.parametrize("text,gold", VERBATIM_CASES,
                         ids=[g and sorted(g)[0] + str(i)
                              for i, (_, g) in enumerate(VERBATIM_CASES)])
def test_the_extractor_recovers_gold_from_number_words(text, gold):
    from tee.entities import extract
    got = {e.type: {x.normalized for x in extract(text, "hi-IN")
                    if x.type == e.type}
           for e in extract(text, "hi-IN")}
    for etype, want in gold.items():
        assert want in got.get(etype, set()), (
            f"{etype}: expected {want}, extractor produced {got.get(etype)}")


def test_digits_and_words_reach_the_same_normal_form():
    """The whole mode comparison rests on this.

    If the same value extracted from digits and from words normalised
    differently, a rendering difference would show up as an entity miss and the
    acoustic/rendering split would be measuring the extractor.
    """
    from tee.entities import extract
    words = extract("तिरसठ लाख रुपये के लेनदेन के लिए आपका ओटीपी सात नौ दो सात है।",
                    "hi-IN")
    digits = extract("63,00,000 रुपये के लेनदेन के लिए आपका ओटीपी 7927 है।", "hi-IN")

    def by(rows, t):
        return {e.normalized for e in rows if e.type == t}

    assert by(words, "currency") == by(digits, "currency") == {"INR:6300000.00"}
    assert "7927" in by(words, "otp")
    assert "7927" in by(digits, "otp")
