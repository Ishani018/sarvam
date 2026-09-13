import subprocess
from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def tone_wav(tmp_path_factory) -> Path:
    """A short deterministic 16 kHz mono wav to degrade."""
    d = tmp_path_factory.mktemp("audio")
    p = d / "tone.wav"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
         "-i", "sine=frequency=300:duration=2:sample_rate=16000",
         "-ac", "1", "-c:a", "pcm_s16le", "-bitexact", str(p)],
        check=True, capture_output=True,
    )
    return p


@pytest.fixture(scope="session")
def cfg():
    from tee.config import load_config
    return load_config("configs/default.yaml")


@pytest.fixture
def utterances():
    """A couple of real corpus rows, for arithmetic that only needs a count."""
    from tee.corpus import Utterance
    return [
        Utterance(id="hi-IN-1-00000", language="hi-IN", source="synthetic",
                  text="आपके खाते 65335720185281 में 5,00,000 रुपये जमा हुए हैं"),
        Utterance(id="hi-IN-1-00001", language="hi-IN", source="synthetic",
                  text="लॉगिन करने के लिए 5584 कोड दर्ज करें"),
    ]
