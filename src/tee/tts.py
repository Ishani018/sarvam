"""TTS providers behind one interface: a deterministic offline mock and Sarvam.

Mock is the default everywhere. Real providers are opt-in via --provider sarvam
so that no amount of local development can spend credits by accident.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import httpx

from .audio import run, sha256_file
from .cache import ResponseCache, b64decode, request_key
from .config import SarvamTTSConfig, api_key
from .costs import CostGuard

log = logging.getLogger("tee.tts")


@dataclass
class TTSResult:
    path: Path
    text: str
    language: str
    cached: bool
    provider: str
    sha256: str
    request_key: str
    raw_path: Path | None = None


class TTSProvider(Protocol):
    name: str

    def synthesize(self, text: str, language: str, out_path: Path) -> TTSResult: ...


class ProviderError(RuntimeError):
    pass


# --------------------------------------------------------------------------
# Offline mock
# --------------------------------------------------------------------------


class MockTTS:
    """Synthesizes deterministic audio locally -- no network, no credits.

    The audio is not speech. It is a reproducible tone sequence derived from a
    hash of the text, long enough to be proportional to the text. That is
    sufficient for everything phase 2 tests: the degradation chain, the cache,
    the cost guard, the scoring path. Recognizing it is the mock ASR's job, and
    it does that from the reference rather than from the waveform.
    """

    name = "mock"

    def __init__(self, sample_rate: int = 24000, chars_per_second: float = 14.0):
        self.sample_rate = sample_rate
        self.chars_per_second = chars_per_second

    def synthesize(self, text: str, language: str, out_path: Path) -> TTSResult:
        key = request_key({"provider": "mock-tts", "text": text, "language": language,
                           "sample_rate": self.sample_rate})
        out_path.parent.mkdir(parents=True, exist_ok=True)
        seconds = max(1.0, len(text) / self.chars_per_second)
        digest = hashlib.blake2b(text.encode("utf-8"), digest_size=4).digest()
        freq = 180 + int.from_bytes(digest[:2], "big") % 220

        run([
            "ffmpeg", "-hide_banner", "-nostdin", "-y",
            "-f", "lavfi",
            "-i", f"sine=frequency={freq}:duration={seconds:.3f}"
                  f":sample_rate={self.sample_rate}",
            "-ac", "1", "-c:a", "pcm_s16le", "-bitexact", str(out_path),
        ])
        # The reference travels with the audio so the mock ASR can read it back
        # after the file has been through the degradation chain.
        out_path.with_suffix(".ref.json").write_text(
            json.dumps({"text": text, "language": language}, ensure_ascii=False),
            encoding="utf-8",
        )
        return TTSResult(out_path, text, language, cached=False, provider="mock",
                         sha256=sha256_file(out_path), request_key=key)


# --------------------------------------------------------------------------
# Sarvam
# --------------------------------------------------------------------------


class SarvamTTS:
    """Real Sarvam TTS (bulbul).

    Synthesizes at the configured (high) sample rate and lets degrade.py do the
    telephony damage, rather than asking the API for 8 kHz directly: the point
    is to control the degradation, not to outsource it.
    """

    name = "sarvam"

    def __init__(self, cfg: SarvamTTSConfig, cache: ResponseCache, guard: CostGuard):
        self.cfg = cfg
        self.cache = cache
        self.guard = guard

    def _payload(self, text: str, language: str) -> dict:
        return {
            "text": text,
            "target_language_code": language,
            "model": self.cfg.model,
            "speaker": self.cfg.speaker,
            "pace": self.cfg.pace,
            "speech_sample_rate": self.cfg.speech_sample_rate,
            **self.cfg.extra_params,
        }

    def synthesize(self, text: str, language: str, out_path: Path) -> TTSResult:
        payload = self._payload(text, language)
        key = request_key({"provider": "sarvam-tts", "endpoint": self.cfg.endpoint,
                           **payload})
        out_path.parent.mkdir(parents=True, exist_ok=True)

        cached = self.cache.get(key)
        if cached is not None and Path(cached["path"]).exists():
            self.guard.note_cached()
            return TTSResult(Path(cached["path"]), text, language, cached=True,
                             provider="sarvam", sha256=cached["sha256"],
                             request_key=key,
                             raw_path=Path(cached["raw_path"]) if cached.get("raw_path") else None)

        self.guard.spend_tts(len(text))
        body = _post_json(self.cfg.endpoint, payload, api_key(), self.cfg)
        raw_path = self.cache.put_raw(key, body)

        audio = _extract_audio(body, raw_path)
        out_path.write_bytes(audio)
        digest = sha256_file(out_path)
        self.cache.put(key, {"path": str(out_path), "sha256": digest,
                             "raw_path": str(raw_path), "model": self.cfg.model})
        return TTSResult(out_path, text, language, cached=False, provider="sarvam",
                         sha256=digest, request_key=key, raw_path=raw_path)


def _post_json(url: str, payload: dict, key: str, cfg: SarvamTTSConfig) -> bytes:
    """POST with backoff on 429/5xx. 4xx fails loudly -- a silently empty
    transcript is worse than a crash, because it scores as a total miss and
    looks like a real ASR failure."""
    headers = {"api-subscription-key": key, "Content-Type": "application/json"}
    last: Exception | None = None
    for attempt in range(cfg.max_retries + 1):
        try:
            resp = httpx.post(url, json=payload, headers=headers,
                              timeout=cfg.timeout_s)
            if resp.status_code == 429 or resp.status_code >= 500:
                raise _Retryable(f"HTTP {resp.status_code}: {resp.text[:300]}")
            if resp.status_code >= 400:
                raise ProviderError(f"HTTP {resp.status_code}: {resp.text[:500]}")
            return resp.content
        except (_Retryable, httpx.TransportError) as exc:
            last = exc
            if attempt == cfg.max_retries:
                break
            delay = cfg.backoff_base_s * (2 ** attempt)
            log.warning("TTS retry %d/%d in %.1fs: %s",
                        attempt + 1, cfg.max_retries, delay, exc)
            time.sleep(delay)
    raise ProviderError(f"TTS failed after {cfg.max_retries} retries: {last}")


def _extract_audio(body: bytes, raw_path: Path) -> bytes:
    """Pull audio bytes out of a TTS response.

    The documented shape is {"audios": ["<base64 wav>"]}. A raw audio body is
    accepted too, so a response-shape change surfaces as working audio rather
    than a crash -- but anything else fails loudly and names the raw body,
    because silently writing a zero-length wav would degrade into an
    entity-miss that looks like a real result.
    """
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        if body[:4] in (b"RIFF", b"OggS") or body[:3] == b"ID3":
            return body
        raise ProviderError(
            f"TTS returned neither JSON nor recognizable audio "
            f"(raw body at {raw_path})"
        ) from None

    audios = data.get("audios") if isinstance(data, dict) else None
    if not audios:
        keys = sorted(data) if isinstance(data, dict) else type(data).__name__
        raise ProviderError(
            f"TTS response has no non-empty 'audios' field (raw body at "
            f"{raw_path}); keys were: {keys}"
        )
    return b64decode(audios[0])


class _Retryable(Exception):
    pass


def build_tts(cfg, cache: ResponseCache, guard: CostGuard) -> TTSProvider:
    if cfg.providers.tts.impl == "sarvam":
        return SarvamTTS(cfg.providers.tts.sarvam, cache, guard)
    return MockTTS(sample_rate=cfg.providers.tts.sarvam.speech_sample_rate)
