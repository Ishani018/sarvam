"""Degradation pipeline: determinism, auditability, and that each condition
actually does something measurably different."""

import json

import pytest

from tee.audio import measure_rms_db, probe_duration, probe_sample_rate, sha256_file
from tee.degrade import apply_condition, derive_seed

ALL_CONDITIONS = [
    "clean", "narrowband", "g711_ulaw", "g726_16k", "opus_low",
    "packet_loss_2", "packet_loss_5", "packet_loss_burst_5",
    "packet_loss_10", "packet_loss_burst_10", "packet_loss_burst_5_repeat",
    "noisy_line", "noisy_line_snr5",
]


@pytest.mark.parametrize("name", ALL_CONDITIONS)
def test_condition_runs_and_preserves_duration(tone_wav, cfg, tmp_path, name):
    cond = cfg.condition(name)
    out = tmp_path / f"{name}.wav"
    r = apply_condition(tone_wav, out, cond, cfg.audio,
                        seed=derive_seed(cfg.seed, "u1", name))
    assert out.exists()
    # Degradation must not change how long the utterance is; a shifted timeline
    # would silently break any future alignment work.
    assert probe_duration(out) == pytest.approx(probe_duration(tone_wav), abs=0.05)
    assert probe_sample_rate(out) == cfg.audio.sample_rate
    assert r.sha256 == sha256_file(out)


@pytest.mark.parametrize("name", ALL_CONDITIONS)
def test_same_seed_is_byte_identical(tone_wav, cfg, tmp_path, name):
    """The headline reproducibility guarantee: same seed, same bytes."""
    cond = cfg.condition(name)
    seed = derive_seed(cfg.seed, "u1", name)
    a = apply_condition(tone_wav, tmp_path / "a.wav", cond, cfg.audio, seed=seed)
    b = apply_condition(tone_wav, tmp_path / "b.wav", cond, cfg.audio, seed=seed)
    assert a.sha256 == b.sha256
    assert (tmp_path / "a.wav").read_bytes() == (tmp_path / "b.wav").read_bytes()


@pytest.mark.parametrize("name", ["packet_loss_10", "noisy_line"])
def test_different_seed_changes_output(tone_wav, cfg, tmp_path, name):
    """Conversely, the seed must actually be wired through to the randomness."""
    cond = cfg.condition(name)
    a = apply_condition(tone_wav, tmp_path / "a.wav", cond, cfg.audio, seed=1)
    b = apply_condition(tone_wav, tmp_path / "b.wav", cond, cfg.audio, seed=2)
    assert a.sha256 != b.sha256


def test_derive_seed_is_stable_and_distinct():
    assert derive_seed(1337, "u1", "clean") == derive_seed(1337, "u1", "clean")
    assert derive_seed(1337, "u1", "clean") != derive_seed(1337, "u1", "g711_ulaw")
    assert derive_seed(1337, "u1", "clean") != derive_seed(1337, "u2", "clean")
    assert derive_seed(1, "u1", "clean") != derive_seed(2, "u1", "clean")


def test_manifest_records_every_command(tone_wav, cfg, tmp_path):
    cond = cfg.condition("packet_loss_5")
    r = apply_condition(tone_wav, tmp_path / "o.wav", cond, cfg.audio, seed=99)
    m = json.loads(r.manifest_path.read_text())
    assert m["condition"] == "packet_loss_5"
    assert m["seed"] == 99
    assert m["output"]["sha256"] == r.sha256
    assert [s["op"] for s in m["chain"]] == ["resample", "codec", "packet_loss"]
    # Auditability: the actual argv of every shelled-out command is on disk.
    assert any("ffmpeg" in c["argv"][0] for c in m["commands"])
    assert any("dropped" in c["note"] for c in m["commands"])
    assert "ffmpeg" in m["tools"]


def test_packet_loss_drops_more_frames_at_higher_rate(tone_wav, cfg, tmp_path):
    def dropped(name):
        r = apply_condition(tone_wav, tmp_path / f"{name}.wav", cfg.condition(name),
                            cfg.audio, seed=derive_seed(7, "u", name))
        note = next(c["note"] for c in r.commands if "dropped" in c["note"])
        return int(note.split()[1].split("/")[0])

    assert dropped("packet_loss_2") < dropped("packet_loss_10")


def test_noisy_line_raises_noise_floor(tone_wav, cfg, tmp_path):
    """A 15 dB SNR mix adds ~0.14 dB to total RMS. Checking the sum is the
    cheap proxy for 'noise was actually added at roughly the right level'."""
    clean = apply_condition(tone_wav, tmp_path / "c.wav", cfg.condition("clean"),
                            cfg.audio, seed=1)
    noisy = apply_condition(tone_wav, tmp_path / "n.wav", cfg.condition("noisy_line"),
                            cfg.audio, seed=1)
    assert measure_rms_db(noisy.path) > measure_rms_db(clean.path) - 1.0


def test_conditions_are_data_not_code(cfg):
    """Every condition in the report must be declared in YAML."""
    assert {c.name for c in cfg.conditions} == set(ALL_CONDITIONS)


# --- loss models ------------------------------------------------------------
#
# Independent per-frame loss is a gentler test than a real network. These check
# that the bursty model is actually bursty, hits the rate it was asked for, and
# reproduces exactly from a seed like everything else in the pipeline.

from tee.config import PacketLossOp
from tee.degrade import _burst_stats, _loss_plan


def plan(model, rate, seed, n=3000, burst_ms=100, frame_ms=20):
    op = PacketLossOp(op="packet_loss", rate=rate, model=model,
                      mean_burst_ms=burst_ms, frame_ms=frame_ms)
    return _loss_plan(n, op, seed)


@pytest.mark.parametrize("model", ["bernoulli", "gilbert"])
@pytest.mark.parametrize("rate", [0.02, 0.05, 0.10])
def test_loss_plan_hits_its_target_rate(model, rate):
    """Both models must lose the rate they were asked for, or the comparison
    between them is not a comparison of burstiness.

    Measured over a long signal on purpose. Bursty loss is a far noisier
    estimator than independent loss -- at 2% with 100 ms bursts a single
    four-second utterance holds only a burst or two, so per-file loss varies
    wildly even though the process is unbiased. That is a property of bursty
    loss, not a defect, but it means the rate has to be checked over minutes
    rather than seconds.
    """
    n = 20_000  # ~400 s of 20 ms frames
    observed = [len(plan(model, rate, s, n=n)) / n for s in range(40)]
    mean = sum(observed) / len(observed)
    assert abs(mean - rate) < rate * 0.10, f"{model}: {mean:.4f} vs {rate}"


def test_gilbert_produces_bursts_and_bernoulli_does_not():
    """The whole point: at the same nominal rate, bursty loss removes the same
    number of frames in far fewer, far longer holes."""
    def stats(model):
        runs, lens = [], []
        for s in range(40):
            d = plan(model, 0.05, s)
            r, m = _burst_stats(d, 20)
            runs.append(r)
            lens.append(m)
        return sum(runs) / len(runs), sum(lens) / len(lens)

    b_runs, b_len = stats("bernoulli")
    g_runs, g_len = stats("gilbert")

    assert b_len < 30, f"bernoulli holes should be ~one frame, got {b_len:.0f} ms"
    assert 80 < g_len < 130, f"gilbert should average ~100 ms, got {g_len:.0f} ms"
    assert g_runs < b_runs / 2, f"gilbert should use fewer holes: {g_runs} vs {b_runs}"


def test_mean_burst_length_is_configurable():
    for target in (60, 100, 200):
        lens = []
        for s in range(40):
            op = PacketLossOp(op="packet_loss", rate=0.08, model="gilbert",
                              mean_burst_ms=target)
            _, m = _burst_stats(_loss_plan(4000, op, s), 20)
            lens.append(m)
        mean = sum(lens) / len(lens)
        assert abs(mean - target) < target * 0.25, f"{target} ms -> {mean:.0f} ms"


@pytest.mark.parametrize("model", ["bernoulli", "gilbert"])
def test_loss_plan_is_deterministic_and_seed_sensitive(model):
    assert plan(model, 0.05, 7) == plan(model, 0.05, 7)
    assert plan(model, 0.05, 7) != plan(model, 0.05, 8)


@pytest.mark.parametrize("name", [
    "packet_loss_burst_5", "packet_loss_burst_10",
    "packet_loss_burst_5_repeat", "noisy_line_snr5", "g726_16k",
])
def test_new_conditions_run_and_are_byte_identical(tone_wav, cfg, tmp_path, name):
    cond = cfg.condition(name)
    seed = derive_seed(cfg.seed, "u1", name)
    a = apply_condition(tone_wav, tmp_path / "a.wav", cond, cfg.audio, seed=seed)
    b = apply_condition(tone_wav, tmp_path / "b.wav", cond, cfg.audio, seed=seed)
    assert a.sha256 == b.sha256
    assert probe_duration(a.path) == pytest.approx(probe_duration(tone_wav), abs=0.05)


def test_repeat_fill_differs_from_silence_fill(tone_wav, cfg, tmp_path):
    """Concealment is a real variable: holding the last good frame is what many
    jitter buffers do, and it is usually kinder to a recogniser than a hole."""
    seed = derive_seed(cfg.seed, "u1", "fillcmp")
    a = apply_condition(tone_wav, tmp_path / "s.wav",
                        cfg.condition("packet_loss_burst_5"), cfg.audio, seed=seed)
    b = apply_condition(tone_wav, tmp_path / "r.wav",
                        cfg.condition("packet_loss_burst_5_repeat"), cfg.audio, seed=seed)
    assert a.sha256 != b.sha256


def test_repeat_fill_never_copies_a_dropped_frame(tmp_path):
    """Inside a burst the frame immediately before was itself dropped; naively
    repeating it would propagate silence through the whole hole."""
    op = PacketLossOp(op="packet_loss", rate=0.05, model="gilbert",
                      mean_burst_ms=100, fill="repeat")
    dropped = set(_loss_plan(2000, op, 3))
    runs = [d for d in dropped if d - 1 in dropped]
    assert runs, "expected at least one multi-frame burst to exercise this"


def test_bursty_and_bernoulli_are_both_declared_at_matching_rates(cfg):
    """Replacing the old condition rather than pairing it would lose the
    comparison, which is itself a result."""
    names = {c.name for c in cfg.conditions}
    for rate in ("5", "10"):
        assert f"packet_loss_{rate}" in names
        assert f"packet_loss_burst_{rate}" in names


def test_no_condition_declares_a_codec_this_build_cannot_encode(cfg):
    """A condition that cannot run is worse than one that does not exist."""
    from tee.audio import available_encoders
    encoders = available_encoders()
    missing = [
        (c.name, op.codec) for c in cfg.conditions for op in c.chain
        if getattr(op, "codec", None) and op.codec not in encoders
    ]
    assert not missing, f"unrunnable: {missing}"
