"""Thin, auditable wrappers over ffmpeg/sox.

Every external invocation goes through :func:`run` so the exact argv can be
recorded in a manifest. No DSP is reimplemented in Python -- the one exception
is packet-loss frame gating, which is byte slicing over raw PCM (see
``degrade.py``) and is done in Python precisely because it must be
bit-reproducible from a seed.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger("tee.audio")


class AudioToolError(RuntimeError):
    pass


@dataclass
class Invocation:
    """One recorded external command."""

    argv: list[str]
    returncode: int
    note: str = ""

    def as_dict(self) -> dict:
        return {"argv": self.argv, "returncode": self.returncode, "note": self.note}


@dataclass
class CommandLog:
    invocations: list[Invocation] = field(default_factory=list)

    def record(self, argv: list[str], returncode: int, note: str = "") -> None:
        self.invocations.append(Invocation(list(argv), returncode, note))

    def as_list(self) -> list[dict]:
        return [i.as_dict() for i in self.invocations]


def require_tools(*names: str) -> None:
    missing = [n for n in names if shutil.which(n) is None]
    if missing:
        raise AudioToolError(
            f"missing required binaries: {', '.join(missing)}. "
            f"Install with: apt-get install ffmpeg sox libsox-fmt-all"
        )


def run(argv: list[str], log_to: CommandLog | None = None, note: str = "") -> str:
    """Run a command, capture stderr, raise loudly on failure."""
    log.debug("exec: %s", " ".join(argv))
    proc = subprocess.run(argv, capture_output=True, text=True)
    if log_to is not None:
        log_to.record(argv, proc.returncode, note)
    if proc.returncode != 0:
        raise AudioToolError(
            f"command failed ({proc.returncode}): {' '.join(argv)}\n"
            f"{proc.stderr[-2000:]}"
        )
    return proc.stderr


def audio_bitexact_flags() -> list[str]:
    """Strip encoder strings and timestamps from output containers.

    Without this ffmpeg stamps its version into the WAV LIST/INFO chunk and the
    byte-identical determinism test becomes a test of the ffmpeg build. Must be
    placed as an *output* option (after -i), not a global one -- as a global
    flag ffmpeg silently ignores it and still writes the LIST chunk.
    """
    return ["-bitexact"]


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def tool_versions() -> dict[str, str]:
    out: dict[str, str] = {}
    for name, argv in (("ffmpeg", ["ffmpeg", "-version"]), ("sox", ["sox", "--version"])):
        if shutil.which(name) is None:
            out[name] = "MISSING"
            continue
        try:
            proc = subprocess.run(argv, capture_output=True, text=True)
            out[name] = (proc.stdout or proc.stderr).splitlines()[0].strip()
        except Exception:  # pragma: no cover
            out[name] = "UNKNOWN"
    return out


def probe_duration(path: str | Path) -> float:
    proc = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=nw=1:nk=1", str(path),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise AudioToolError(f"ffprobe failed on {path}: {proc.stderr[-500:]}")
    return float(proc.stdout.strip())


def probe_sample_rate(path: str | Path) -> int:
    proc = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=sample_rate",
            "-of", "default=nw=1:nk=1", str(path),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise AudioToolError(f"ffprobe failed on {path}: {proc.stderr[-500:]}")
    return int(proc.stdout.strip())


_RMS_RE = re.compile(r"RMS level dB:\s*(-?inf|-?\d+(?:\.\d+)?)", re.IGNORECASE)


def measure_rms_db(path: str | Path, log_to: CommandLog | None = None) -> float:
    """Overall RMS level in dBFS, via ffmpeg's astats filter."""
    stderr = run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-i", str(path),
         "-af", "astats=metadata=1:reset=0", "-f", "null", "-"],
        log_to=log_to,
        note="measure RMS",
    )
    matches = _RMS_RE.findall(stderr)
    if not matches:
        raise AudioToolError(f"could not parse RMS level from astats for {path}")
    value = matches[-1]
    if "inf" in value:
        return -120.0
    return float(value)


def write_manifest(path: str | Path, payload: dict) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def make_silence(path: str | Path, seconds: float, rate: int) -> None:
    """Used by the mock TTS provider so offline runs still produce real files."""
    run([
        "ffmpeg", "-hide_banner", "-nostdin", "-y",
        "-f", "lavfi", "-i", f"anullsrc=r={rate}:cl=mono",
        "-t", f"{seconds:.3f}", "-c:a", "pcm_s16le", str(path),
    ])


def available_encoders() -> set[str]:
    """Encoder names this ffmpeg build can actually use.

    Codec support is a build-time option and differs between machines: libgsm
    and AMR-NB are absent from stock macOS and many distro builds, so a
    condition can be declared in config and be unrunnable where it matters.
    Checking beats discovering it mid-run.
    """
    if shutil.which("ffmpeg") is None:
        return set()
    proc = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"],
                          capture_output=True, text=True)
    names: set[str] = set()
    for line in proc.stdout.splitlines():
        parts = line.split()
        # Rows look like " A....D libgsm  libgsm GSM (codec gsm)"
        if len(parts) >= 2 and len(parts[0]) == 6 and parts[0][0] in "AVS":
            names.add(parts[1])
            if "(codec " in line:
                names.add(line.split("(codec ", 1)[1].split(")", 1)[0].strip())
    return names
