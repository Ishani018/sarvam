"""Pydantic config models, loaded from YAML.

Everything that shapes a run lives here so a run is reproducible from
``configs/*.yaml`` plus a seed. Conditions in particular are *data*: adding a
telephony condition must never require touching Python.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Annotated, Any, Literal

import yaml
from pydantic import BaseModel, Field, model_validator

# --------------------------------------------------------------------------
# Audio + degradation
# --------------------------------------------------------------------------


class AudioConfig(BaseModel):
    """Canonical audio format handed to ASR.

    Degraded files are resampled back up to ``sample_rate`` so that the only
    variable across conditions is the *damage*, not the container rate.
    """

    sample_rate: int = 16000
    channels: int = 1
    sample_format: Literal["s16le"] = "s16le"
    frame_ms: int = 20
    restore_rate: bool = True


class ResampleOp(BaseModel):
    op: Literal["resample"]
    rate: int


class CodecOp(BaseModel):
    op: Literal["codec"]
    codec: str
    container: str
    bitrate: str | None = None
    application: str | None = None
    rate: int | None = None


class PacketLossOp(BaseModel):
    """Frames the network never delivered.

    ``model`` picks how losses are distributed in time, which matters more than
    the rate. Independent per-frame loss at 5% is a scattered sprinkle of 20 ms
    dropouts with intact context on either side of every one. Real networks lose
    packets in runs, so real 5% loss is a handful of 100 ms holes -- long enough
    to swallow a whole digit. Both are kept so the same nominal rate can be
    compared under each.
    """

    op: Literal["packet_loss"]
    #: Target average loss rate, as a fraction of frames.
    rate: float = Field(ge=0.0, le=1.0)
    frame_ms: int = 20
    #: How a lost frame is concealed. "silence" punches a hole; "repeat" holds
    #: the previous good frame, which is what many jitter buffers actually do
    #: and is usually kinder to a recogniser.
    fill: Literal["silence", "repeat"] = "silence"
    #: "bernoulli": independent per frame. "gilbert": two-state Markov chain,
    #: losses arrive in runs.
    model: Literal["bernoulli", "gilbert"] = "bernoulli"
    #: Mean length of a loss burst, in milliseconds. Gilbert model only.
    mean_burst_ms: float = 100.0


class NoiseOp(BaseModel):
    op: Literal["noise"]
    snr_db: float
    source: Literal["pink", "brown", "white"] = "pink"


class GainOp(BaseModel):
    op: Literal["gain"]
    db: float


Transform = Annotated[
    ResampleOp | CodecOp | PacketLossOp | NoiseOp | GainOp,
    Field(discriminator="op"),
]


class Condition(BaseModel):
    name: str
    chain: list[Transform]
    description: str = ""


# --------------------------------------------------------------------------
# Providers
# --------------------------------------------------------------------------


#: The transcription modes Sarvam accepts. Only the first two are meaningful
#: for this harness; the rest are listed so a typo in config fails loudly.
AsrMode = Literal["transcribe", "verbatim", "translit", "codemix", "translate"]


class SarvamASRConfig(BaseModel):
    endpoint: str = "https://api.sarvam.ai/speech-to-text"
    #: Model is an axis, not a setting. v4 adds telephony-tuned handling and
    #: entity preservation, which is exactly what this harness measures, so it
    #: has to be compared against v3 rather than swapped in. Every extra model
    #: multiplies the ASR call count -- the dry run shows the total.
    models: list[str] = Field(default_factory=lambda: ["saaras:v3"])
    #: Mode is an axis too, for the same reason model is. "transcribe" applies
    #: Sarvam's own number normalization, so a miss may be the normalizer
    #: disagreeing rather than the audio failing; "verbatim" returns the words
    #: as spoken. Running both over identical audio is the only way to separate
    #: the two, so a run can carry several. Each one multiplies the ASR calls --
    #: the dry run shows the total.
    modes: list[AsrMode] = Field(default_factory=lambda: ["transcribe"])
    timeout_s: float = 120.0
    max_retries: int = 4
    backoff_base_s: float = 2.0
    #: Merged into the request body verbatim. An escape hatch for parameters
    #: added or renamed upstream, so a field-name change is a config edit
    #: rather than a code change.
    extra_params: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _accept_singular_mode(cls, data: Any) -> Any:
        """Accept the old scalar `mode:` and read it as a one-element axis.

        Every config and every cached response written before mode became an
        axis used the singular key. Silently rejecting it would strand them;
        silently ignoring it would run transcribe while the file says verbatim,
        which is worse. Specifying both is a contradiction, so it is an error.
        """
        if not isinstance(data, dict):
            return data
        if "mode" in data:
            if "modes" in data:
                raise ValueError(
                    "set either `mode` (one value) or `modes` (a list), not both")
            data = {**data, "modes": [data["mode"]]}
            data.pop("mode", None)
        return data

    @model_validator(mode="after")
    def _modes_are_distinct(self) -> "SarvamASRConfig":
        if not self.modes:
            raise ValueError("providers.asr.sarvam.modes must list at least one mode")
        if len(set(self.modes)) != len(self.modes):
            raise ValueError(f"duplicate ASR modes: {self.modes}")
        return self


class SarvamTTSConfig(BaseModel):
    endpoint: str = "https://api.sarvam.ai/text-to-speech"
    model: str = "bulbul:v3"
    speaker: str = "shubh"
    #: The API parameter is `speech_sample_rate`, default 24000. 8 kHz is
    #: supported natively but deliberately unused: synthesizing at telephony
    #: rate would move the independent variable out of degrade.py and into the
    #: TTS, and the whole point is to control the degradation ourselves.
    speech_sample_rate: int = 24000
    pace: float = 1.0
    timeout_s: float = 120.0
    max_retries: int = 4
    backoff_base_s: float = 2.0
    extra_params: dict[str, Any] = Field(default_factory=dict)


class ASRConfig(BaseModel):
    impl: Literal["mock", "sarvam"] = "mock"
    sarvam: SarvamASRConfig = Field(default_factory=SarvamASRConfig)


class TTSConfig(BaseModel):
    impl: Literal["mock", "sarvam"] = "mock"
    sarvam: SarvamTTSConfig = Field(default_factory=SarvamTTSConfig)


class CacheConfig(BaseModel):
    enabled: bool = True
    dir: Path = Path(".tee/cache")
    #: Raw, unparsed response bodies land here for post-hoc debugging.
    raw_dir: Path = Path(".tee/raw_responses")


class CostConfig(BaseModel):
    """Cost guard. A runaway loop burning the credit balance ends the project,
    so ``max_api_calls`` is enforced as a hard abort, not a warning."""

    max_api_calls: int = 500
    #: Estimates only -- Sarvam publishes per-second / per-character pricing that
    #: changes. Override in config once you have your real rate card.
    asr_inr_per_audio_second: float = 0.0
    tts_inr_per_1k_chars: float = 0.0
    currency: str = "INR"
    #: Cached hits do not count against the guard or the estimate.
    count_cached: bool = False


class ProvidersConfig(BaseModel):
    asr: ASRConfig = Field(default_factory=ASRConfig)
    tts: TTSConfig = Field(default_factory=TTSConfig)
    cache: CacheConfig = Field(default_factory=CacheConfig)


class PathsConfig(BaseModel):
    corpus: Path = Path("fixtures/utterances.jsonl")
    work_dir: Path = Path(".tee/work")
    out_dir: Path = Path("results")


class WERConfig(BaseModel):
    strip_punct: bool = True
    unicode_nfc: bool = True
    casefold: bool = True


class ScoringConfig(BaseModel):
    entity_types: list[str] = Field(
        default_factory=lambda: [
            "account_number",
            "currency",
            "otp",
            "pin_code",
            "date",
        ]
    )
    wer: WERConfig = Field(default_factory=WERConfig)


class Config(BaseModel):
    seed: int = 1337
    paths: PathsConfig = Field(default_factory=PathsConfig)
    audio: AudioConfig = Field(default_factory=AudioConfig)
    providers: ProvidersConfig = Field(default_factory=ProvidersConfig)
    cost: CostConfig = Field(default_factory=CostConfig)
    scoring: ScoringConfig = Field(default_factory=ScoringConfig)
    conditions: list[Condition] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique_condition_names(self) -> "Config":
        seen: set[str] = set()
        for c in self.conditions:
            if c.name in seen:
                raise ValueError(f"duplicate condition name: {c.name}")
            seen.add(c.name)
        return self

    def condition(self, name: str) -> Condition:
        for c in self.conditions:
            if c.name == name:
                return c
        known = ", ".join(c.name for c in self.conditions)
        raise KeyError(f"unknown condition {name!r}; known: {known}")

    def select_conditions(self, names: list[str] | None) -> list[Condition]:
        if not names:
            return list(self.conditions)
        return [self.condition(n) for n in names]


def load_config(path: str | Path = "configs/default.yaml", **overrides: Any) -> Config:
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    raw.update({k: v for k, v in overrides.items() if v is not None})
    return Config.model_validate(raw)


def api_key(env_var: str = "SARVAM_API_KEY") -> str:
    """Read the API key from the environment. Never from config, never logged."""
    key = os.environ.get(env_var, "").strip()
    if not key:
        raise RuntimeError(
            f"{env_var} is not set. Real providers need it; use --provider mock "
            f"(the default) to work offline."
        )
    return key
