"""The run pipeline: synthesize -> degrade -> transcribe -> score.

Structured so the cost of a run can be computed without performing it. The plan
is built first, printed by --dry-run, and only then executed.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Sequence

from .asr import ASRProvider, MockASR
from .audio import sha256_file
from .cache import ResponseCache
from .config import Condition, Config
from .corpus import Utterance
from .costs import CostGuard
from .degrade import apply_condition, derive_seed
from .score import ScoreRow, score_utterance
from .tts import TTSProvider

log = logging.getLogger("tee.pipeline")


@dataclass
class RunPlan:
    run_id: str
    utterances: list[Utterance]
    conditions: list[Condition]
    tts_calls: int
    asr_calls: int
    tts_chars: int
    estimated_audio_seconds: float
    estimated_cost: float
    currency: str
    max_api_calls: int
    asr_impl: str
    tts_impl: str
    asr_model: str | None
    asr_mode: str | None

    @property
    def total_calls(self) -> int:
        return self.tts_calls + self.asr_calls

    @property
    def over_budget(self) -> bool:
        return self.total_calls > self.max_api_calls

    def render(self) -> str:
        lines = [
            "DRY RUN -- no API calls made, nothing spent",
            "",
            f"  run id            {self.run_id}",
            f"  utterances        {len(self.utterances)}",
            f"  conditions        {len(self.conditions)}"
            f"  ({', '.join(c.name for c in self.conditions)})",
            f"  languages         {', '.join(sorted({u.language for u in self.utterances}))}",
            "",
            f"  TTS provider      {self.tts_impl}",
            f"  ASR provider      {self.asr_impl}"
            + (f"  model={self.asr_model} mode={self.asr_mode}"
               if self.asr_impl != "mock" else ""),
            "",
            f"  TTS calls         {self.tts_calls}  ({self.tts_chars} chars)",
            f"  ASR calls         {self.asr_calls}",
            f"  total API calls   {self.total_calls}   (cap: {self.max_api_calls})",
            f"  est. audio        {self.estimated_audio_seconds:.0f}s"
            f" ({self.estimated_audio_seconds / 60:.1f} min)",
            f"  est. cost         ~{self.estimated_cost:.2f} {self.currency}",
        ]
        if self.estimated_cost == 0:
            lines.append(
                "                    (rate card not configured -- set "
                "cost.asr_inr_per_audio_second and cost.tts_inr_per_1k_chars)"
            )
        if self.over_budget:
            lines += [
                "",
                f"  *** ABORT: {self.total_calls} calls exceeds max_api_calls "
                f"({self.max_api_calls}).",
                "      Raise cost.max_api_calls or narrow --conditions / --limit.",
            ]
        return "\n".join(lines)


def make_run_id(prefix: str = "run") -> str:
    return f"{prefix}-{dt.datetime.now(dt.UTC).strftime('%Y%m%dT%H%M%SZ')}"


def plan_run(
    cfg: Config,
    utterances: Sequence[Utterance],
    conditions: Sequence[Condition],
    run_id: str | None = None,
    chars_per_second: float = 14.0,
) -> RunPlan:
    """Cost a run without performing it.

    Audio duration is estimated from text length, since the audio does not
    exist yet. It is an estimate and labelled as one.
    """
    tts_chars = sum(len(u.text) for u in utterances)
    seconds_each = [max(1.0, len(u.text) / chars_per_second) for u in utterances]
    asr_seconds = sum(seconds_each) * len(conditions)

    tts_calls = len(utterances)
    asr_calls = len(utterances) * len(conditions)
    cost = (
        tts_chars / 1000.0 * cfg.cost.tts_inr_per_1k_chars
        + asr_seconds * cfg.cost.asr_inr_per_audio_second
    )
    return RunPlan(
        run_id=run_id or make_run_id(),
        utterances=list(utterances),
        conditions=list(conditions),
        tts_calls=tts_calls,
        asr_calls=asr_calls,
        tts_chars=tts_chars,
        estimated_audio_seconds=asr_seconds,
        estimated_cost=cost,
        currency=cfg.cost.currency,
        max_api_calls=cfg.cost.max_api_calls,
        asr_impl=cfg.providers.asr.impl,
        tts_impl=cfg.providers.tts.impl,
        asr_model=cfg.providers.asr.sarvam.model,
        asr_mode=cfg.providers.asr.sarvam.mode,
    )


def execute_run(
    cfg: Config,
    plan: RunPlan,
    tts: TTSProvider,
    asr: ASRProvider,
    guard: CostGuard,
    on_progress: Callable[[str], None] | None = None,
) -> list[ScoreRow]:
    """Run the plan, returning one score row per (utterance, condition)."""
    work = Path(cfg.paths.work_dir) / plan.run_id
    rows: list[ScoreRow] = []
    total = len(plan.utterances) * len(plan.conditions)
    done = 0

    for utt in plan.utterances:
        udir = work / utt.id
        clean = udir / "source.wav"

        try:
            tts_result = tts.synthesize(utt.text, utt.language, clean)
        except Exception as exc:  # noqa: BLE001 - recorded, not swallowed
            log.error("TTS failed for %s: %s", utt.id, exc)
            for cond in plan.conditions:
                rows.append(_error_row(cfg, plan, utt, cond.name, f"tts: {exc}"))
            continue

        for cond in plan.conditions:
            done += 1
            out = udir / f"{cond.name}.wav"
            try:
                deg = apply_condition(
                    tts_result.path, out, cond, cfg.audio,
                    seed=derive_seed(cfg.seed, utt.id, cond.name),
                )
                hint = utt.text if isinstance(asr, MockASR) else None
                hyp = asr.transcribe(out, utt.language, hint=hint)
                rows.append(score_utterance(
                    utt, hyp.text,
                    condition=cond.name,
                    run_id=plan.run_id,
                    asr_impl=asr.name,
                    asr_model=hyp.model,
                    asr_mode=hyp.mode,
                    entity_types=cfg.scoring.entity_types,
                    wer_cfg=cfg.scoring.wer,
                    audio_path=str(out),
                    audio_sha256=deg.sha256,
                ))
            except Exception as exc:  # noqa: BLE001
                log.error("%s/%s failed: %s", utt.id, cond.name, exc)
                rows.append(_error_row(cfg, plan, utt, cond.name, str(exc)))

            if on_progress:
                on_progress(f"[{done}/{total}] {utt.id} {cond.name}  {guard.summary()}")

    return rows


def _error_row(cfg: Config, plan: RunPlan, utt: Utterance, condition: str,
               error: str) -> ScoreRow:
    """A failed call is recorded as an explicit error, never as an empty
    transcript -- an empty transcript scores as a total entity miss and would
    show up in the report as a real finding."""
    return score_utterance(
        utt, "", condition=condition, run_id=plan.run_id,
        asr_impl=cfg.providers.asr.impl,
        entity_types=cfg.scoring.entity_types, wer_cfg=cfg.scoring.wer,
        error=error,
    )
