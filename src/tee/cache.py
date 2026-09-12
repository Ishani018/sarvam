"""On-disk response cache keyed by a hash of the full canonical request.

Reruns must cost nothing. The key covers every parameter that could change the
response -- model, mode, language, and the audio's own sha256 -- so a cache hit
is only ever returned for a byte-identical request.

Raw response bodies are kept alongside the parsed result. When the extractor
misbehaves the first question is always what the API actually returned,
including whether numbers came back in Devanagari or Latin numerals.
"""

from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def request_key(payload: dict[str, Any]) -> str:
    """Stable hash of a request. Sorted keys so dict order never matters."""
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False,
                           separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass
class CacheEntry:
    key: str
    value: dict[str, Any]
    hit: bool


class ResponseCache:
    def __init__(self, dir: str | Path, raw_dir: str | Path, enabled: bool = True):
        self.dir = Path(dir)
        self.raw_dir = Path(raw_dir)
        self.enabled = enabled

    def _path(self, key: str) -> Path:
        # Shard by prefix so the directory stays navigable at corpus scale.
        return self.dir / key[:2] / f"{key}.json"

    def get(self, key: str) -> dict[str, Any] | None:
        if not self.enabled:
            return None
        p = self._path(key)
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return None  # a truncated write should re-fetch, not crash

    def put(self, key: str, value: dict[str, Any]) -> None:
        if not self.enabled:
            return
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(p)  # atomic, so an interrupted run leaves no half-entry

    def put_raw(self, key: str, body: bytes, suffix: str = ".json") -> Path:
        """Log the unparsed response body for post-hoc debugging."""
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        p = self.raw_dir / f"{key}{suffix}"
        p.write_bytes(body)
        return p

    def put_audio(self, key: str, audio: bytes) -> Path:
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        p = self.raw_dir / f"{key}.wav"
        p.write_bytes(audio)
        return p


def b64decode(data: str) -> bytes:
    return base64.b64decode(data)
