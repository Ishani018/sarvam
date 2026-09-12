"""Entity hit rate scoring.

Primary metric is entity hit rate per (type, language, condition). An entity is
a hit only if its normalized form matches the gold exactly. There is no partial
credit on purpose: a wrong digit in an account number is a total failure, and
character-level similarity would report 0.9 for a transfer to the wrong account.

Secondary metric is plain WER, so numbers here are comparable to published
Indic ASR benchmarks.

The confusion log -- what each missed entity actually became -- is the output
with the most information in it. A systematic 3->2 lakh confusion under packet
loss is a finding; the aggregate hit rate that hides it is not.
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any, Iterable, Sequence

from pydantic import BaseModel, Field

from .config import WERConfig
from .corpus import Entity, Utterance
from .entities import ExtractedEntity, extract


def levenshtein(a: Sequence, b: Sequence) -> int:
    """Edit distance over any sequence -- characters for entities, tokens for WER."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


_PUNCT = re.compile(r"[^\w\sऀ-ॿ]", re.UNICODE)


def normalize_for_wer(text: str, cfg: WERConfig) -> list[str]:
    t = unicodedata.normalize("NFC", text) if cfg.unicode_nfc else text
    if cfg.strip_punct:
        t = _PUNCT.sub(" ", t)
    if cfg.casefold:
        t = t.casefold()
    return t.split()


def wer(reference: str, hypothesis: str, cfg: WERConfig | None = None) -> float:
    cfg = cfg or WERConfig()
    ref = normalize_for_wer(reference, cfg)
    hyp = normalize_for_wer(hypothesis, cfg)
    if not ref:
        return 0.0 if not hyp else 1.0
    return levenshtein(ref, hyp) / len(ref)


# --------------------------------------------------------------------------
# Result rows
# --------------------------------------------------------------------------


class EntityScore(BaseModel):
    type: str
    expected: str
    expected_surface: str
    hit: bool
    #: Nearest same-type candidate in the hypothesis, or None if the extractor
    #: found nothing of this type at all. The two cases mean different things:
    #: a wrong value is usually ASR, nothing at all is often the extractor.
    found: str | None = None
    found_surface: str | None = None
    edit_distance: int | None = None
    candidates: list[str] = Field(default_factory=list)


class Confusion(BaseModel):
    type: str
    expected: str
    got: str | None
    got_surface: str | None
    edit_distance: int | None


class ScoreRow(BaseModel):
    """One row per (utterance, condition). Tidy: aggregation is a pure function
    over these, so the report phase never needs to re-run anything."""

    run_id: str
    utterance_id: str
    language: str
    condition: str
    asr_impl: str
    asr_model: str | None = None
    asr_mode: str | None = None
    reference: str
    hypothesis: str
    wer: float
    entities: list[EntityScore] = Field(default_factory=list)
    confusions: list[Confusion] = Field(default_factory=list)
    audio_path: str | None = None
    audio_sha256: str | None = None
    realization: str | None = None
    template_id: str | None = None
    error: str | None = None

    @property
    def hits(self) -> int:
        return sum(1 for e in self.entities if e.hit)

    @property
    def total(self) -> int:
        return len(self.entities)


def _nearest(gold: Entity, candidates: list[ExtractedEntity]) -> ExtractedEntity | None:
    if not candidates:
        return None
    return min(candidates, key=lambda c: levenshtein(gold.normalized, c.normalized))


def score_utterance(
    utterance: Utterance,
    hypothesis: str,
    *,
    condition: str,
    run_id: str,
    asr_impl: str,
    entity_types: Iterable[str],
    wer_cfg: WERConfig | None = None,
    asr_model: str | None = None,
    asr_mode: str | None = None,
    audio_path: str | None = None,
    audio_sha256: str | None = None,
    error: str | None = None,
) -> ScoreRow:
    """Compare a hypothesis against one utterance's gold entities."""
    wanted = set(entity_types)
    found = extract(hypothesis, utterance.language, types=wanted)

    scores: list[EntityScore] = []
    confusions: list[Confusion] = []

    for gold in utterance.entities:
        if gold.type not in wanted:
            continue
        same_type = [c for c in found if c.type == gold.type]
        hit = any(c.normalized == gold.normalized for c in same_type)
        near = _nearest(gold, same_type)
        dist = (
            levenshtein(gold.normalized, near.normalized) if near is not None else None
        )
        scores.append(EntityScore(
            type=gold.type,
            expected=gold.normalized,
            expected_surface=gold.surface,
            hit=hit,
            found=None if hit else (near.normalized if near else None),
            found_surface=None if hit else (near.surface if near else None),
            edit_distance=0 if hit else dist,
            candidates=[c.normalized for c in same_type],
        ))
        if not hit:
            confusions.append(Confusion(
                type=gold.type,
                expected=gold.normalized,
                got=near.normalized if near else None,
                got_surface=near.surface if near else None,
                edit_distance=dist,
            ))

    return ScoreRow(
        run_id=run_id,
        utterance_id=utterance.id,
        language=utterance.language,
        condition=condition,
        asr_impl=asr_impl,
        asr_model=asr_model,
        asr_mode=asr_mode,
        reference=utterance.text,
        hypothesis=hypothesis,
        wer=wer(utterance.text, hypothesis, wer_cfg),
        entities=scores,
        confusions=confusions,
        audio_path=audio_path,
        audio_sha256=audio_sha256,
        realization=utterance.realization,
        template_id=utterance.template_id,
        error=error,
    )


# --------------------------------------------------------------------------
# Serialization and aggregation
# --------------------------------------------------------------------------


def write_rows(path: str | Path, rows: Iterable[ScoreRow]) -> int:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with p.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row.model_dump(), ensure_ascii=False))
            fh.write("\n")
            n += 1
    return n


def read_rows(path: str | Path) -> list[ScoreRow]:
    rows: list[ScoreRow] = []
    with Path(path).open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(ScoreRow.model_validate_json(line))
    return rows


def aggregate(rows: Sequence[ScoreRow]) -> list[dict[str, Any]]:
    """Hit rate per (language, condition, entity type). Pure function over rows."""
    buckets: dict[tuple[str, str, str], list[int]] = {}
    for row in rows:
        for e in row.entities:
            key = (row.language, row.condition, e.type)
            hits, total = buckets.setdefault(key, [0, 0])
            buckets[key] = [hits + int(e.hit), total + 1]

    out = []
    for (lang, cond, etype), (hits, total) in sorted(buckets.items()):
        out.append({
            "language": lang,
            "condition": cond,
            "entity_type": etype,
            "hits": hits,
            "total": total,
            "hit_rate": hits / total if total else 0.0,
        })
    return out


def aggregate_wer(rows: Sequence[ScoreRow]) -> list[dict[str, Any]]:
    buckets: dict[tuple[str, str], list[float]] = {}
    for row in rows:
        buckets.setdefault((row.language, row.condition), []).append(row.wer)
    return [
        {"language": lang, "condition": cond,
         "wer": sum(v) / len(v), "n": len(v)}
        for (lang, cond), v in sorted(buckets.items())
    ]
