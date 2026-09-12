# telephony-entity-eval

Measures how much **entity accuracy** degrades when Indic speech passes through
telephony-grade audio conditions. Not word error rate: whether account numbers,
rupee amounts, OTPs, PIN codes and place names survive an 8 kHz lossy phone line.

Status: phase 2 (corpus generator + real providers). Offline-first — every
provider has a deterministic mock and is the default.

```bash
uv venv && uv pip install -e '.[dev]'
uv run pytest
uv run tee run --dry-run
```
