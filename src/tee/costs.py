"""Cost guard.

Treated as a correctness requirement, not a nicety: a runaway loop that burns a
limited credit balance ends the project. The guard aborts the run rather than
warning, and cached calls are free so reruns never count against it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from .config import CostConfig

log = logging.getLogger("tee.cost")


class BudgetExceeded(RuntimeError):
    pass


@dataclass
class CostGuard:
    cfg: CostConfig
    api_calls: int = 0
    cached_calls: int = 0
    asr_seconds: float = 0.0
    tts_chars: int = 0
    estimated_cost: float = 0.0
    _log_every: int = field(default=10, repr=False)

    def _charge(self, cost: float) -> None:
        self.estimated_cost += cost

    def note_cached(self) -> None:
        self.cached_calls += 1

    def _spend_call(self, kind: str) -> None:
        self.api_calls += 1
        if self.api_calls > self.cfg.max_api_calls:
            raise BudgetExceeded(
                f"max_api_calls ({self.cfg.max_api_calls}) exceeded on a {kind} "
                f"call. Raise cost.max_api_calls in config if this is intended. "
                f"Spent so far: {self.summary()}"
            )
        if self.api_calls % self._log_every == 0:
            log.info("cost so far: %s", self.summary())

    def spend_asr(self, audio_seconds: float) -> None:
        self._spend_call("ASR")
        self.asr_seconds += audio_seconds
        self._charge(audio_seconds * self.cfg.asr_inr_per_audio_second)

    def spend_tts(self, chars: int) -> None:
        self._spend_call("TTS")
        self.tts_chars += chars
        self._charge(chars / 1000.0 * self.cfg.tts_inr_per_1k_chars)

    def summary(self) -> str:
        return (
            f"{self.api_calls} api calls "
            f"({self.cached_calls} served from cache), "
            f"{self.asr_seconds:.1f}s audio, {self.tts_chars} tts chars, "
            f"~{self.estimated_cost:.2f} {self.cfg.currency}"
        )

    def as_dict(self) -> dict:
        return {
            "api_calls": self.api_calls,
            "cached_calls": self.cached_calls,
            "asr_seconds": round(self.asr_seconds, 2),
            "tts_chars": self.tts_chars,
            "estimated_cost": round(self.estimated_cost, 4),
            "currency": self.cfg.currency,
            "max_api_calls": self.cfg.max_api_calls,
        }
