"""Typer CLI."""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Optional

import typer

from .asr import build_asr
from .cache import ResponseCache
from .config import load_config
from .corpus import load_utterances, write_utterances
from .costs import BudgetExceeded, CostGuard
from .generate import generate as generate_corpus
from .pipeline import execute_run, make_run_id, plan_run
from .review import render_review
from .score import aggregate, aggregate_wer, read_rows, write_rows
from .triage import render_report, triage
from .tts import build_tts

app = typer.Typer(add_completion=False, help=__doc__)

CONFIG = typer.Option("configs/default.yaml", "--config", "-c", help="Config YAML.")


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )


@app.command()
def conditions(config: str = CONFIG) -> None:
    """List the telephony conditions declared in the config."""
    cfg = load_config(config)
    for c in cfg.conditions:
        chain = " -> ".join(op.op for op in c.chain)
        typer.echo(f"{c.name:16s} {chain}")
        if c.description:
            typer.echo(f"{'':16s} {c.description.strip()}")


@app.command()
def generate(
    lang: str = typer.Option("hi-IN", "--lang", help="Template language."),
    n: int = typer.Option(200, "--n", help="Number of utterances."),
    seed: int = typer.Option(1337, "--seed"),
    out: Path = typer.Option(..., "--out", help="Output JSONL path."),
) -> None:
    """Generate a synthetic corpus with gold entities attached by construction."""
    utterances = generate_corpus(lang, n, seed)
    count = write_utterances(out, utterances)
    typer.echo(f"wrote {count} utterances to {out}")
    types: dict[str, int] = {}
    for u in utterances:
        for e in u.entities:
            types[e.type] = types.get(e.type, 0) + 1
    typer.echo("entities: " + ", ".join(f"{k}={v}" for k, v in sorted(types.items())))
    reals: dict[str, int] = {}
    for u in utterances:
        reals[u.realization or "?"] = reals.get(u.realization or "?", 0) + 1
    typer.echo("realization: " + ", ".join(f"{k}={v}" for k, v in sorted(reals.items())))


@app.command()
def run(
    config: str = CONFIG,
    corpus: Optional[Path] = typer.Option(None, "--corpus", help="Corpus JSONL."),
    conditions_opt: Optional[str] = typer.Option(
        None, "--conditions", help="Comma-separated subset of conditions."),
    provider: str = typer.Option(
        "mock", "--provider", help="mock | sarvam. Real providers are opt-in."),
    limit: Optional[int] = typer.Option(None, "--limit", help="First N utterances."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print the cost and exit."),
    mock_error_rate: float = typer.Option(
        0.0, "--mock-error-rate",
        help="Digit corruption rate for the mock ASR, to exercise scoring offline."),
    out: Optional[Path] = typer.Option(None, "--out", help="Results JSONL path."),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Synthesize, degrade, transcribe and score."""
    _setup_logging(verbose)
    cfg = load_config(config)
    if provider == "sarvam":
        cfg.providers.asr.impl = "sarvam"
        cfg.providers.tts.impl = "sarvam"

    utterances = load_utterances(corpus or cfg.paths.corpus)
    if limit:
        utterances = utterances[:limit]
    names = [c.strip() for c in conditions_opt.split(",")] if conditions_opt else None
    conds = cfg.select_conditions(names)

    run_id = make_run_id()
    plan = plan_run(cfg, utterances, conds, run_id=run_id)

    if dry_run:
        typer.echo(plan.render())
        raise typer.Exit(1 if plan.over_budget else 0)

    if plan.over_budget:
        typer.echo(plan.render())
        typer.echo("\nRefusing to start. Nothing was spent.", err=True)
        raise typer.Exit(1)

    if provider == "sarvam":
        typer.echo(plan.render())
        typer.echo("")
        typer.confirm(
            f"This will make up to {plan.total_calls} real API calls. Continue?",
            abort=True,
        )

    cache = ResponseCache(cfg.providers.cache.dir, cfg.providers.cache.raw_dir,
                          cfg.providers.cache.enabled)
    guard = CostGuard(cfg.cost)
    tts = build_tts(cfg, cache, guard)
    asr = build_asr(cfg, cache, guard, mock_error_rate=mock_error_rate)

    try:
        rows = execute_run(cfg, plan, tts, asr, guard,
                           on_progress=lambda m: typer.echo(m, err=True))
    except BudgetExceeded as exc:
        typer.echo(f"\nABORTED: {exc}", err=True)
        raise typer.Exit(1) from exc

    out_path = out or Path(cfg.paths.out_dir) / f"{run_id}.jsonl"
    write_rows(out_path, rows)
    typer.echo(f"\nwrote {len(rows)} rows to {out_path}")
    typer.echo(f"cost: {guard.summary()}")

    typer.echo("\nentity hit rate:")
    for a in aggregate(rows):
        typer.echo(f"  {a['condition']:16s} {a['entity_type']:16s} "
                   f"{a['hits']:3d}/{a['total']:3d}  {a['hit_rate']:.3f}")
    typer.echo("\nWER:")
    for a in aggregate_wer(rows):
        typer.echo(f"  {a['condition']:16s} {a['wer']:.3f}  (n={a['n']})")
    typer.echo(f"\nnext: tee triage {out_path}")


@app.command(name="triage")
def triage_cmd(
    results: Path = typer.Argument(..., help="Results JSONL from `tee run`."),
    out: Optional[Path] = typer.Option(None, "--out", help="Report path."),
) -> None:
    """Bucket every miss into extractor / gold / ASR error, and explain each."""
    rows = read_rows(results)
    misses = triage(rows)
    report = render_report(rows, misses)
    path = out or results.with_suffix(".triage.txt")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(report, encoding="utf-8")
    typer.echo(report[:4000])
    if len(report) > 4000:
        typer.echo(f"... (truncated)\n")
    typer.echo(f"full report: {path}")


@app.command()
def review(
    results: Path = typer.Argument(..., help="Results JSONL from `tee run`."),
    n: int = typer.Option(30, "--n", help="Rows to sample."),
    seed: int = typer.Option(0, "--seed"),
    out: Optional[Path] = typer.Option(None, "--out"),
) -> None:
    """Write a side-by-side sample to read top to bottom."""
    rows = read_rows(results)
    text = render_review(rows, n=n, seed=seed)
    path = out or results.with_suffix(".review.txt")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    typer.echo(f"wrote {path}")



def main() -> None:  # pragma: no cover
    app()


if __name__ == "__main__":  # pragma: no cover
    main()
