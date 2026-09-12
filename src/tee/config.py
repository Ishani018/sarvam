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
    op: Literal["packet_loss"]
    rate: float = Field(ge=0.0, le=1.0)
    frame_ms: int = 20
    fill: Literal["silence", "hold"] = "silence"
    burst: int = 1


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


class SarvamASRConfig(BaseModel):
    endpoint: str = "https://api.sarvam.ai/speech-to-text"
    model: str = "saaras:v3"
    #: saaras:v3+ only. "transcribe" normalizes numbers to digits;
    #: "verbatim" preserves spoken number words. This materially changes what
    #: the entity extractor sees -- see README.
    mode: Literal["transcribe", "verbatim", "translit", "codemix", "translate"] = (
        "transcribe"
    )
    timeout_s: float = 120.0
    max_retries: int = 4
    backoff_base_s: float = 2.0


class SarvamTTSConfig(BaseModel):
    endpoint: str = "https://api.sarvam.ai/text-to-speech"
    model: str = "bulbul:v3"
    speaker: str = "shubh"
    sample_rate: int = 24000
    pace: float = 1.0
    timeout_s: float = 120.0
    max_retries: int = 4
    backoff_base_s: float = 2.0


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
