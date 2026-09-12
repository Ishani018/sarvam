"""Manual review sample: a flat side-by-side file to read top to bottom."""

from __future__ import annotations

import random
from typing import Sequence

from .score import ScoreRow


def render_review(rows: Sequence[ScoreRow], n: int = 30, seed: int = 0) -> str:
    """Sample ``n`` rows, biased to include misses, and lay them out for eyeballing.

    Deliberately includes hits as well: a review that only shows failures cannot
    tell you whether the hits are real or whether the scorer is being generous.
    """
    rng = random.Random(seed)
    misses = [r for r in rows if any(not e.hit for e in r.entities)]
    hits = [r for r in rows if r not in misses]

    want_miss = min(len(misses), (n * 2) // 3)
    sample = rng.sample(misses, want_miss) if misses else []
    remaining = min(len(hits), n - len(sample))
    sample += rng.sample(hits, remaining) if hits else []
    rng.shuffle(sample)

    out = [
        "=" * 78,
        f"MANUAL REVIEW SAMPLE -- {len(sample)} of {len(rows)} rows",
        f"({want_miss} with at least one miss, {remaining} clean)",
        "=" * 78,
        "",
        "Read top to bottom. The audio path is on each row so anything that",
        "looks wrong can be listened to directly.",
        "",
    ]

    for i, row in enumerate(sample, 1):
        flag = "MISS" if any(not e.hit for e in row.entities) else "ok"
        out.append("-" * 78)
        out.append(f"{i:3d}. [{flag}] {row.utterance_id}  cond={row.condition}  "
                   f"lang={row.language}  realization={row.realization}  "
                   f"template={row.template_id}")
        out.append(f"     reference   {row.reference}")
        out.append(f"     hypothesis  {row.hypothesis or '(empty)'}")
        out.append(f"     wer         {row.wer:.3f}")
        for e in row.entities:
            mark = "HIT " if e.hit else "MISS"
            out.append(f"     [{mark}] {e.type:16s} gold={e.expected}")
            if not e.hit:
                out.append(f"            {'':16s} got ={e.found or '(nothing)'}"
                           f"  dist={e.edit_distance}")
        if row.error:
            out.append(f"     ERROR       {row.error}")
        out.append(f"     audio       {row.audio_path or '(none)'}")
    out.append("-" * 78)
    out.append("")
    return "\n".join(out)
