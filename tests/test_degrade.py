"""Degradation pipeline: determinism, auditability, and that each condition
actually does something measurably different."""

import json

import pytest

from tee.audio import measure_rms_db, probe_duration, probe_sample_rate, sha256_file
from tee.degrade import apply_condition, derive_seed

ALL_CONDITIONS = [
    "clean", "narrowband", "g711_ulaw", "gsm_fr", "opus_low",
    "packet_loss_2", "packet_loss_5", "packet_loss_10", "noisy_line",
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
