"""Test utterance models and JSONL loaders."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable, Iterator, Literal

from pydantic import BaseModel, Field, field_validator

EntityType = Literal[
    "account_number",
    "currency",
    "otp",
    "pin_code",
    "person_name",
    "place_name",
    "date",
]

#: Entity types phase 1/2 can extract deterministically. Names need an NER model.
DETERMINISTIC_TYPES: frozenset[str] = frozenset(
    {"account_number", "currency", "otp", "pin_code", "date"}
)


class Entity(BaseModel):
    """A gold entity attached to a reference transcript.

    ``normalized`` is the only field scoring compares. It is produced by the
    corpus generator's sampler (phase 2) or hand-written (phase 1 fixtures) and
    must never be derived by running the extractor over ``surface`` -- that
    would make extractor bugs invisible.
    """

    type: EntityType
    surface: str
    normalized: str

    @field_validator("surface", "normalized")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must be non-empty")
        return v


class Utterance(BaseModel):
    id: str
    language: str
    text: str
    entities: list[Entity] = Field(default_factory=list)
    source: Literal["synthetic", "gramvaani", "indicvoices", "shrutilipi"]

    # Optional, phase-2 additions.
    #: English gloss with entity surfaces rendered exactly as they appear in
    #: `text`, so a reader who cannot read Devanagari can still see which token
    #: is the entity. Never a translation of the number words.
    gloss: str | None = None
    audio_path: str | None = None
    domain: str | None = None
    #: "digits" or "words" -- which rendering of the entities went into `text`.
    realization: Literal["digits", "words", "mixed"] | None = None
    template_id: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)

    def entities_of_type(self, *types: str) -> list[Entity]:
        return [e for e in self.entities if e.type in types]


def load_utterances(path: str | Path) -> list[Utterance]:
    return list(iter_utterances(path))


def iter_utterances(path: str | Path) -> Iterator[Utterance]:
    p = Path(path)
    with p.open("r", encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line or line.startswith("//"):
                continue
            try:
                yield Utterance.model_validate_json(line)
            except Exception as exc:  # pragma: no cover - error path
                raise ValueError(f"{p}:{lineno}: invalid utterance: {exc}") from exc


def write_utterances(path: str | Path, utterances: Iterable[Utterance]) -> int:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with p.open("w", encoding="utf-8") as fh:
        for u in utterances:
            fh.write(json.dumps(u.model_dump(exclude_none=True), ensure_ascii=False))
            fh.write("\n")
            n += 1
    return n
