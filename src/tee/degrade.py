"""The telephony degradation pipeline.

Applies a named condition -- an ordered chain of transforms declared in YAML --
to a wav file. Results are reproducible: packet loss and noise are both driven
by a seed derived deterministically from (master seed, utterance id, condition),
so a rerun produces a byte-identical file regardless of run order.

Every ffmpeg/sox invocation is recorded and written to a ``.manifest.json``
sidecar next to the output, so any number in the final report can be traced back
to the exact commands that produced the audio.
"""

from __future__ import annotations

import hashlib
import logging
import random
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .audio import (
    CommandLog,
    audio_bitexact_flags,
    measure_rms_db,
    probe_duration,
    probe_sample_rate,
    run,
    sha256_file,
    tool_versions,
    write_manifest,
)
from .config import (
    AudioConfig,
    CodecOp,
    Condition,
    GainOp,
    NoiseOp,
    PacketLossOp,
    ResampleOp,
)

log = logging.getLogger("tee.degrade")


def derive_seed(master_seed: int, *parts: str) -> int:
    """Stable per-(utterance, condition) seed.

    Derived by hashing rather than by advancing a shared RNG, so parallel or
    reordered runs still produce identical audio.
    """
    payload = "\x1f".join([str(master_seed), *parts]).encode("utf-8")
    return int.from_bytes(hashlib.blake2b(payload, digest_size=8).digest(), "big")


@dataclass
class DegradeResult:
    path: Path
    condition: str
    seed: int
    sha256: str
    duration_s: float
    commands: list[dict]
    manifest_path: Path


# --------------------------------------------------------------------------
# Individual transforms. Each takes (src, dst) and returns nothing.
# --------------------------------------------------------------------------


def _resample(src: Path, dst: Path, op: ResampleOp, cl: CommandLog) -> None:
    run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y",
         "-i", str(src), "-ar", str(op.rate), "-ac", "1",
         "-c:a", "pcm_s16le", *audio_bitexact_flags(), str(dst)],
        log_to=cl,
        note=f"resample to {op.rate} Hz",
    )


def _codec(src: Path, dst: Path, op: CodecOp, cl: CommandLog, tmp: Path) -> None:
    """Encode to the target codec and decode straight back -- the round trip is
    the point; we want the codec's damage, not its bitstream."""
    encoded = tmp / f"enc_{op.codec}.{op.container}"
    argv = ["ffmpeg", "-hide_banner", "-nostdin", "-y",
            "-i", str(src)]
    if op.rate:
        argv += ["-ar", str(op.rate)]
    argv += ["-ac", "1", "-c:a", op.codec]
    if op.bitrate:
        argv += ["-b:a", op.bitrate]
    if op.application:
        argv += ["-application", op.application]
    argv += ["-f", op.container, *audio_bitexact_flags(), str(encoded)]
    run(argv, log_to=cl, note=f"encode {op.codec}")

    run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y",
         "-i", str(encoded), "-ac", "1", "-c:a", "pcm_s16le", *audio_bitexact_flags(), str(dst)],
        log_to=cl,
        note=f"decode {op.codec}",
    )


def _gain(src: Path, dst: Path, op: GainOp, cl: CommandLog) -> None:
    run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y",
         "-i", str(src), "-af", f"volume={op.db}dB",
         "-c:a", "pcm_s16le", *audio_bitexact_flags(), str(dst)],
        log_to=cl,
        note=f"gain {op.db} dB",
    )


def _noise(src: Path, dst: Path, op: NoiseOp, cl: CommandLog, tmp: Path, seed: int) -> None:
    """Additive background noise at an exact SNR.

    Two measurement passes rather than trusting anoisesrc's amplitude to map to
    a known RMS: measure the signal, generate noise, measure the noise, then set
    the gain that lands the ratio on target.
    """
    rate = probe_sample_rate(src)
    duration = probe_duration(src)
    signal_db = measure_rms_db(src, log_to=cl)

    noise_path = tmp / "noise.wav"
    # anoisesrc's seed makes this bit-reproducible; verified in tests.
    run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y",
         "-f", "lavfi",
         "-i", f"anoisesrc=d={duration:.4f}:c={op.source}:r={rate}:a=0.5"
               f":seed={seed % (2**31)}",
         "-ac", "1", "-c:a", "pcm_s16le", *audio_bitexact_flags(), str(noise_path)],
        log_to=cl,
        note=f"generate {op.source} noise (seed {seed % (2**31)})",
    )
    noise_db = measure_rms_db(noise_path, log_to=cl)

    # target_noise_db = signal_db - snr_db ; gain closes the gap.
    gain_db = (signal_db - op.snr_db) - noise_db
    run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y",
         "-i", str(src), "-i", str(noise_path),
         "-filter_complex",
         f"[1:a]volume={gain_db:.4f}dB[n];"
         f"[0:a][n]amix=inputs=2:duration=first:normalize=0[out]",
         "-map", "[out]", "-ac", "1", "-c:a", "pcm_s16le", *audio_bitexact_flags(), str(dst)],
        log_to=cl,
        note=f"mix noise at {op.snr_db} dB SNR (gain {gain_db:.2f} dB)",
    )


def _loss_plan(n_frames: int, op: PacketLossOp, seed: int) -> list[int]:
    """Which frame indices the network dropped.

    bernoulli: each frame is lost independently with probability ``rate``.

    gilbert: a two-state Markov chain. In the good state frames arrive, in the
    bad state they do not, and the parameters are derived from the two numbers
    an engineer actually has -- a target average loss rate and a mean burst
    length::

        r = P(bad -> good)  = 1 / (mean burst length in frames)
        p = P(good -> bad)  = r * rate / (1 - rate)

    which gives a stationary loss rate of p/(p+r) = rate and a mean run of 1/r
    frames, so the two models can be compared at the same nominal rate.

    Both are driven from one seeded RNG, so a rerun reproduces the plan exactly.
    """
    rng = random.Random(seed)
    dropped: list[int] = []

    if op.model == "bernoulli":
        for i in range(n_frames):
            if rng.random() < op.rate:
                dropped.append(i)
        return dropped

    burst_frames = max(1.0, op.mean_burst_ms / op.frame_ms)
    r = 1.0 / burst_frames
    # rate == 1 would mean never leaving the bad state; clamp so p stays finite.
    p = r * op.rate / max(1e-9, 1.0 - op.rate)

    bad = False
    for i in range(n_frames):
        if bad:
            dropped.append(i)
            if rng.random() < r:
                bad = False
        elif rng.random() < p:
            bad = True
    return dropped


def _burst_stats(dropped: list[int], frame_ms: int) -> tuple[int, float]:
    """(number of runs, mean run length in ms) over a sorted index list."""
    if not dropped:
        return 0, 0.0
    runs = 1
    for a, b in zip(dropped, dropped[1:]):
        if b != a + 1:
            runs += 1
    return runs, len(dropped) / runs * frame_ms


def _packet_loss(
    src: Path, dst: Path, op: PacketLossOp, cl: CommandLog, tmp: Path, seed: int
) -> None:
    """Drop whole audio frames, the way a jitter buffer would.

    Implemented as byte slicing over raw s16le rather than an ffmpeg filter
    graph: this is frame gating, not signal processing, and doing it here is the
    only way to guarantee a seed reproduces the output bit for bit.
    """
    rate_hz = probe_sample_rate(src)
    raw = tmp / "pl_in.raw"
    run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y",
         "-i", str(src), "-f", "s16le", "-acodec", "pcm_s16le",
         "-ac", "1", "-ar", str(rate_hz), *audio_bitexact_flags(), str(raw)],
        log_to=cl,
        note="export raw pcm for frame gating",
    )

    pcm = bytearray(raw.read_bytes())
    bytes_per_frame = int(rate_hz * op.frame_ms / 1000) * 2  # s16le mono
    n_frames = len(pcm) // bytes_per_frame if bytes_per_frame else 0

    dropped = _loss_plan(n_frames, op, seed)
    runs, mean_run_ms = _burst_stats(dropped, op.frame_ms)

    for idx in dropped:
        start = idx * bytes_per_frame
        if op.fill == "silence":
            pcm[start : start + bytes_per_frame] = b"\x00" * bytes_per_frame
        else:
            # "repeat": hold the last frame that actually arrived. Walking back
            # matters inside a burst -- repeating the frame immediately before
            # would copy a frame that was itself dropped.
            prev = idx - 1
            while prev in set(dropped) and prev >= 0:
                prev -= 1
            if prev < 0:
                pcm[start : start + bytes_per_frame] = b"\x00" * bytes_per_frame
            else:
                at = prev * bytes_per_frame
                pcm[start : start + bytes_per_frame] = bytes(
                    pcm[at : at + bytes_per_frame]
                )

    gated = tmp / "pl_out.raw"
    gated.write_bytes(bytes(pcm))
    actual = len(dropped) / n_frames if n_frames else 0.0
    cl.record(
        ["<python>", "frame_gate", f"model={op.model}", f"frames={n_frames}",
         f"dropped={len(dropped)}", f"target_rate={op.rate}",
         f"actual_rate={actual:.4f}", f"bursts={runs}",
         f"mean_burst_ms={mean_run_ms:.1f}", f"frame_ms={op.frame_ms}",
         f"fill={op.fill}", f"seed={seed}"],
        0,
        note=(f"dropped {len(dropped)}/{n_frames} frames in {runs} burst(s), "
              f"mean {mean_run_ms:.0f} ms, {op.model} model, fill={op.fill}"),
    )

    run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y",
         "-f", "s16le", "-ar", str(rate_hz), "-ac", "1", "-i", str(gated),
         "-c:a", "pcm_s16le", *audio_bitexact_flags(), str(dst)],
        log_to=cl,
        note="reassemble gated pcm",
    )


# --------------------------------------------------------------------------
# Chain driver
# --------------------------------------------------------------------------


def apply_condition(
    src: str | Path,
    dst: str | Path,
    condition: Condition,
    audio: AudioConfig,
    *,
    seed: int,
    write_sidecar: bool = True,
) -> DegradeResult:
    """Run ``condition``'s chain over ``src``, writing ``dst``."""
    src = Path(src)
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    cl = CommandLog()

    with tempfile.TemporaryDirectory(prefix="tee_degrade_") as td:
        tmp = Path(td)
        cur = tmp / "step0.wav"
        shutil.copyfile(src, cur)

        for i, op in enumerate(condition.chain, 1):
            nxt = tmp / f"step{i}.wav"
            if isinstance(op, ResampleOp):
                _resample(cur, nxt, op, cl)
            elif isinstance(op, CodecOp):
                _codec(cur, nxt, op, cl, tmp)
            elif isinstance(op, GainOp):
                _gain(cur, nxt, op, cl)
            elif isinstance(op, NoiseOp):
                _noise(cur, nxt, op, cl, tmp, seed)
            elif isinstance(op, PacketLossOp):
                _packet_loss(cur, nxt, op, cl, tmp, seed)
            else:  # pragma: no cover - guarded by the discriminated union
                raise ValueError(f"unknown transform: {op!r}")
            cur = nxt

        # Normalize the container so ASR sees one rate across all conditions and
        # only the damage varies.
        if audio.restore_rate:
            final = tmp / "final.wav"
            run(
                ["ffmpeg", "-hide_banner", "-nostdin", "-y",
                 "-i", str(cur), "-ar", str(audio.sample_rate),
                 "-ac", str(audio.channels), "-c:a", "pcm_s16le", *audio_bitexact_flags(), str(final)],
                log_to=cl,
                note=f"restore canonical {audio.sample_rate} Hz",
            )
            cur = final

        shutil.copyfile(cur, dst)

    digest = sha256_file(dst)
    duration = probe_duration(dst)
    manifest_path = dst.with_suffix(dst.suffix + ".manifest.json")
    if write_sidecar:
        write_manifest(
            manifest_path,
            {
                "condition": condition.name,
                "description": condition.description,
                "chain": [op.model_dump() for op in condition.chain],
                "seed": seed,
                "input": {"path": str(src), "sha256": sha256_file(src)},
                "output": {"path": str(dst), "sha256": digest, "duration_s": duration},
                "audio": audio.model_dump(),
                "tools": tool_versions(),
                "commands": cl.as_list(),
            },
        )

    return DegradeResult(
        path=dst,
        condition=condition.name,
        seed=seed,
        sha256=digest,
        duration_s=duration,
        commands=cl.as_list(),
        manifest_path=manifest_path,
    )
