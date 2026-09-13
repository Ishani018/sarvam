"""ASR providers behind one interface: a deterministic offline mock and Sarvam.

A note on Sarvam's ``mode`` parameter, because it bears directly on what this
harness measures. On saaras:v3+ the default mode "transcribe" applies number
normalization, so spoken "तीन लाख पचास हज़ार" comes back as "3,50,000" -- the
provider's own text normalizer is doing part of the job entities.py does. Mode
"verbatim" preserves the spoken words. A miss in transcribe mode can therefore
be the normalizer disagreeing rather than the audio failing, which is a
confound sitting on top of the research question. The mode is in config and
recorded on every result row so the two can be compared.
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import httpx

from .audio import probe_duration, sha256_file
from .cache import ResponseCache, request_key
from .config import SarvamASRConfig, api_key
from .costs import CostGuard
from .numwords import tokenize_spans

log = logging.getLogger("tee.asr")


@dataclass
class ASRResult:
    text: str
    language: str
    cached: bool
    provider: str
    request_key: str
    model: str | None = None
    mode: str | None = None
    raw_path: Path | None = None


class ASRProvider(Protocol):
    name: str

    def transcribe(self, audio_path: Path, language: str,
                   hint: str | None = None) -> ASRResult: ...


class ProviderError(RuntimeError):
    pass


# --------------------------------------------------------------------------
# Offline mock
# --------------------------------------------------------------------------


class MockASR:
    """Returns canned output without touching the network.

    ``hint`` is the reference transcript. Real providers must ignore it; it
    exists only so the offline mock can return something the rest of the
    pipeline can actually score. Without it a mock could only return a fixed
    string, and every downstream module would be untestable offline.

    With ``error_rate`` above zero the mock corrupts digits deterministically,
    seeded from the audio's sha256 -- so different conditions yield different
    corruptions and the scoring, confusion log and triage paths can be
    exercised without spending anything.
    """

    name = "mock"

    def __init__(self, error_rate: float = 0.0):
        self.error_rate = error_rate

    def transcribe(self, audio_path: Path, language: str,
                   hint: str | None = None) -> ASRResult:
        audio_sha = sha256_file(audio_path)
        key = request_key({"provider": "mock-asr", "audio_sha256": audio_sha,
                           "language": language, "error_rate": self.error_rate})

        text = hint
        if text is None:
            sidecar = audio_path.with_suffix(".ref.json")
            if sidecar.exists():
                text = json.loads(sidecar.read_text(encoding="utf-8"))["text"]
        if text is None:
            text = ""

        if self.error_rate > 0 and text:
            text = self._corrupt(text, audio_sha, language)

        return ASRResult(text=text, language=language, cached=False,
                         provider="mock", request_key=key, model="mock", mode="mock")

    def _corrupt(self, text: str, audio_sha: str, language: str) -> str:
        """Perturb digits, seeded by the audio hash so it is reproducible and
        differs per condition."""
        seed = int.from_bytes(hashlib.blake2b(
            audio_sha.encode(), digest_size=8).digest(), "big")
        rng = random.Random(seed)
        chars = list(text)
        for tok in tokenize_spans(text):
            if not tok.text.isdigit():
                continue
            for i in range(tok.start, tok.end):
                if i < len(chars) and rng.random() < self.error_rate:
                    chars[i] = str(rng.randint(0, 9))
        return "".join(chars)


# --------------------------------------------------------------------------
# Sarvam
# --------------------------------------------------------------------------


class SarvamASR:
    name = "sarvam"

    def __init__(self, cfg: SarvamASRConfig, cache: ResponseCache,
                 guard: CostGuard, model: str | None = None,
                 mode: str | None = None):
        self.cfg = cfg
        self.cache = cache
        self.guard = guard
        #: One instance per (model, mode), so a run can compare both as axes.
        self.model = model or cfg.models[0]
        self.mode = mode or cfg.modes[0]

    def transcribe(self, audio_path: Path, language: str,
                   hint: str | None = None) -> ASRResult:
        # hint is deliberately ignored: a real provider must never see the
        # reference, or the whole measurement is worthless.
        audio_sha = sha256_file(audio_path)
        key = request_key({
            "provider": "sarvam-asr",
            "endpoint": self.cfg.endpoint,
            "model": self.model,
            "mode": self.mode,
            "language_code": language,
            "audio_sha256": audio_sha,
        })

        cached = self.cache.get(key)
        if cached is not None:
            self.guard.note_cached()
            return ASRResult(text=cached["transcript"], language=language,
                             cached=True, provider="sarvam", request_key=key,
                             model=self.model, mode=self.mode,
                             raw_path=Path(cached["raw_path"]) if cached.get("raw_path") else None)

        self.guard.spend_asr(probe_duration(audio_path))
        body = self._post(audio_path, language)
        raw_path = self.cache.put_raw(key, body)

        try:
            data = json.loads(body)
        except json.JSONDecodeError as exc:
            raise ProviderError(
                f"ASR returned non-JSON (raw body at {raw_path}): {exc}") from exc

        transcript = data.get("transcript")
        if transcript is None:
            raise ProviderError(
                f"ASR response has no 'transcript' field (raw body at {raw_path}); "
                f"keys were: {sorted(data)}"
            )

        self.cache.put(key, {
            "transcript": transcript,
            "raw_path": str(raw_path),
            "model": self.model,
            "mode": self.mode,
            "language_code": language,
            "audio_sha256": audio_sha,
        })
        return ASRResult(text=transcript, language=language, cached=False,
                         provider="sarvam", request_key=key, model=self.model,
                         mode=self.mode, raw_path=raw_path)

    def _post(self, audio_path: Path, language: str) -> bytes:
        headers = {"api-subscription-key": api_key()}
        data = {"model": self.model, "language_code": language,
                **self.cfg.extra_params}
        # `mode` is only honoured on saaras:v3 and later. Sending it to a
        # legacy model is at best ignored and at worst a 400.
        if self.model.startswith("saaras"):
            data["mode"] = self.mode
        else:
            log.warning("model %s predates the `mode` parameter; not sending "
                        "mode=%s", self.model, self.mode)
        last: Exception | None = None
        for attempt in range(self.cfg.max_retries + 1):
            try:
                with audio_path.open("rb") as fh:
                    files = {"file": (audio_path.name, fh, "audio/wav")}
                    resp = httpx.post(self.cfg.endpoint, headers=headers,
                                      data=data, files=files,
                                      timeout=self.cfg.timeout_s)
                if resp.status_code == 429 or resp.status_code >= 500:
                    raise _Retryable(f"HTTP {resp.status_code}: {resp.text[:300]}")
                if resp.status_code >= 400:
                    # Fail loudly. An empty transcript would score as a total
                    # entity miss and be indistinguishable from a real result.
                    raise ProviderError(
                        f"HTTP {resp.status_code} from ASR: {resp.text[:500]}")
                return resp.content
            except (_Retryable, httpx.TransportError) as exc:
                last = exc
                if attempt == self.cfg.max_retries:
                    break
                delay = self.cfg.backoff_base_s * (2 ** attempt)
                log.warning("ASR retry %d/%d in %.1fs: %s",
                            attempt + 1, self.cfg.max_retries, delay, exc)
                time.sleep(delay)
        raise ProviderError(f"ASR failed after {self.cfg.max_retries} retries: {last}")


class _Retryable(Exception):
    pass


def build_asr(cfg, cache: ResponseCache, guard: CostGuard,
              mock_error_rate: float = 0.0) -> list[ASRProvider]:
    """One provider per (model, mode).

    Both are axes, so this is their product and the list it returns is what
    multiplies the ASR call count. Model varies fastest so that a run's output
    reads as one block per mode.
    """
    if cfg.providers.asr.impl == "sarvam":
        sarvam = cfg.providers.asr.sarvam
        return [SarvamASR(sarvam, cache, guard, model=m, mode=mode)
                for mode in sarvam.modes
                for m in sarvam.models]
    return [MockASR(error_rate=mock_error_rate)]


# TODO(phase 3): Keyterm Prompting. Saaras v4 can be primed with names, places,
# brands and technical terms, which acts directly on entity accuracy -- the
# metric this whole harness reports. Measuring with and without keyterms is a
# genuine extra axis. The request field name is not verified here (the docs host
# is unreachable from this environment); until it is, it can be passed through
# providers.asr.sarvam.extra_params without a code change.
