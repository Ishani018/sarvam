"""Typer CLI."""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Optional

import typer

from .asr import build_asr
from .audio import available_encoders
from .cache import ResponseCache
from .config import load_config
from .corpus import load_utterances, write_utterances
from .costs import BudgetExceeded, CostGuard
from .generate import generate as generate_corpus
from .pipeline import execute_run, make_run_id, plan_run
from .review import render_review
from .score import (
    aggregate, aggregate_wer, read_rows, score_utterance, write_rows,
)
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
def conditions(
    config: str = CONFIG,
    check: bool = typer.Option(
        False, "--check",
        help="Verify every declared codec exists in the local ffmpeg build."),
) -> None:
    """List the telephony conditions declared in the config."""
    cfg = load_config(config)
    encoders = available_encoders() if check else set()
    missing: list[tuple[str, str]] = []

    for c in cfg.conditions:
        chain = " -> ".join(op.op for op in c.chain)
        status = ""
        if check:
            needed = [getattr(op, "codec", None) for op in c.chain]
            absent = [n for n in needed if n and n not in encoders]
            status = "  [MISSING: " + ", ".join(absent) + "]" if absent else "  [ok]"
            missing.extend((c.name, n) for n in absent)
        typer.echo(f"{c.name:26s} {chain}{status}")
        if c.description:
            typer.echo(f"{'':26s} {c.description.strip()}")

    if check:
        typer.echo("")
        if missing:
            typer.echo(
                f"{len(missing)} condition(s) declare a codec this ffmpeg cannot "
                f"encode. Codec support is a build option, so this differs "
                f"between machines.", err=True)
            raise typer.Exit(1)
        typer.echo(f"all {len(cfg.conditions)} conditions runnable "
                   f"({len(encoders)} encoders available)")


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
    models: Optional[str] = typer.Option(
        None, "--models",
        help="Comma-separated ASR models, overriding config. Each one multiplies "
             "the ASR call count."),
    modes: Optional[str] = typer.Option(
        None, "--modes",
        help="Comma-separated ASR modes, overriding config: transcribe, "
             "verbatim. Each one multiplies the ASR call count."),
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

    if models:
        cfg.providers.asr.sarvam.models = [m.strip() for m in models.split(",")]
    if modes:
        # Validated through the model so a typo fails here, before anything is
        # synthesised, rather than as a 400 on the first real call.
        cfg.providers.asr.sarvam = cfg.providers.asr.sarvam.model_copy(
            update={"modes": [m.strip() for m in modes.split(",")]})
        cfg.providers.asr.sarvam = type(cfg.providers.asr.sarvam).model_validate(
            cfg.providers.asr.sarvam.model_dump())
    run_id = make_run_id()
    cache = ResponseCache(cfg.providers.cache.dir, cfg.providers.cache.raw_dir,
                          cfg.providers.cache.enabled)
    plan = plan_run(cfg, utterances, conds, run_id=run_id, cache=cache)

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

    guard = CostGuard(cfg.cost)
    tts = build_tts(cfg, cache, guard)
    asr_providers = build_asr(cfg, cache, guard, mock_error_rate=mock_error_rate)

    try:
        rows = execute_run(cfg, plan, tts, asr_providers, guard,
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
        typer.echo(f"  {a['asr_model']:12s} {a['condition']:16s} "
                   f"{a['entity_type']:16s} "
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


@app.command(name="modes")
def modes_cmd(
    results: list[Path] = typer.Argument(
        ..., help="One or more results JSONL files. The transcribe rows and the "
                  "verbatim rows are usually separate runs, so pass both."),
    out: Optional[Path] = typer.Option(None, "--out", help="Report path."),
) -> None:
    """Split transcribe misses into acoustic and rendering, per condition.

    Needs rows in both modes over the same audio. The two normally come from
    different runs -- the transcribe rows already exist -- so this takes
    several files and pairs across them. Misses with no verbatim twin are
    reported as unpaired rather than counted as either.
    """
    from .modes import render as render_modes, split_by_condition

    rows = [r for path_ in results for r in read_rows(path_)]
    modes_seen = sorted({r.asr_mode or "-" for r in rows})
    typer.echo(f"{len(rows)} row(s) from {len(results)} file(s); "
               f"modes present: {', '.join(modes_seen)}\n")
    report = render_modes(split_by_condition(rows))
    path = out or results[0].with_suffix(".modes.txt")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(report, encoding="utf-8")
    typer.echo(report)
    typer.echo(f"\nfull report: {path}")


@app.command()
def rescore(
    results: Path = typer.Argument(..., help="Results JSONL from a previous run."),
    config: str = CONFIG,
    out: Optional[Path] = typer.Option(None, "--out", help="Where to write (default: in place)."),
) -> None:
    """Re-score stored hypotheses against the current extractor. No API calls.

    Hypotheses and audio hashes are already on disk, so a fix to the extractor
    or the scorer can be applied to an existing run for free. Nothing about the
    recogniser's output changes -- only what this harness makes of it.
    """
    cfg = load_config(config)
    rows = read_rows(results)
    # Look in every place a corpus can live: the configured file, the corpora
    # directory, and the dev fixtures. Re-scoring must find the utterance the
    # row was produced from, whichever of those it came from.
    search = [Path(cfg.paths.corpus), *sorted(Path("corpora").glob("*.jsonl")),
              *sorted(Path("fixtures").glob("*.jsonl"))]
    corpus: dict[str, object] = {}
    for path in search:
        if path.exists():
            for u in load_utterances(path):
                corpus.setdefault(u.id, u)

    missing = sorted({r.utterance_id for r in rows} - set(corpus))
    if missing:
        typer.echo(
            f"cannot re-score: {len(missing)} utterance(s) are not in any corpus "
            f"file, e.g. {missing[:3]}", err=True)
        raise typer.Exit(1)

    before = sum(1 for r in rows for e in r.entities if e.hit)
    total = sum(len(r.entities) for r in rows)

    rescored = [
        score_utterance(
            corpus[r.utterance_id], r.hypothesis,
            condition=r.condition, run_id=r.run_id, asr_impl=r.asr_impl,
            asr_model=r.asr_model, asr_mode=r.asr_mode,
            entity_types=cfg.scoring.entity_types, wer_cfg=cfg.scoring.wer,
            audio_path=r.audio_path, audio_sha256=r.audio_sha256, error=r.error,
        )
        for r in rows
    ]
    after = sum(1 for r in rescored for e in r.entities if e.hit)

    dest = out or results
    write_rows(dest, rescored)
    typer.echo(f"re-scored {len(rows)} rows -> {dest}   (0 API calls)")
    typer.echo(f"entity hits: {before}/{total} -> {after}/{total}")

    misses = triage(rescored)
    counts: dict[str, int] = {}
    for m in misses:
        counts[m.bucket] = counts.get(m.bucket, 0) + 1
    typer.echo("triage: " + (", ".join(f"{k}={v}" for k, v in sorted(counts.items()))
                             or "no misses"))


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
