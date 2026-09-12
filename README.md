# telephony-entity-eval

Measures how much **entity accuracy** degrades when Indic speech passes through
telephony-grade audio conditions. Not word error rate: whether account numbers,
rupee amounts, OTPs, PIN codes and place names survive an 8 kHz lossy phone line.

Public Indic ASR benchmarks report a single aggregate WER on clean studio audio.
Production voice agents in India run over 8 kHz phone lines with lossy codecs,
and nobody publishes what happens to the numbers — which is the thing that
actually breaks a banking or collections call.

Status: **phase 2**. The pipeline runs end to end on mocks. The real calibration
run has not been performed.

## Quick start

```bash
uv venv && uv pip install -e '.[dev]'
export PYTHONPATH=src
uv run pytest

tee conditions                                    # list telephony conditions
tee generate --lang hi-IN --n 40 --seed 1337 --out corpora/hi.jsonl
tee run --corpus corpora/hi.jsonl --conditions clean,g711_ulaw,packet_loss_5 --dry-run
tee run --corpus corpora/hi.jsonl --conditions clean,g711_ulaw,packet_loss_5
tee triage results/<run_id>.jsonl
tee review results/<run_id>.jsonl --n 30
```

Requires `ffmpeg` and `sox` on PATH (`apt-get install ffmpeg sox libsox-fmt-all`).

## Offline by default

Every provider call goes through an interface with a real implementation and a
deterministic mock. **The mock is the default.** Real providers are opt-in via
`--provider sarvam`, which also prints the cost plan and asks for confirmation.

- `SARVAM_API_KEY` is read from the environment only. Never from config, never
  logged. `.env` is gitignored.
- Every real response is cached to disk keyed by a hash of the full canonical
  request, including the audio's sha256. Reruns cost nothing.
- Raw response bodies are written alongside the parsed result, so when the
  extractor misbehaves you can see exactly what came back.

## Cost guard

`cost.max_api_calls` is a hard abort, not a warning. `tee run --dry-run` prints
the call counts, audio seconds and estimated cost and exits without spending.

Fill in `cost.asr_inr_per_audio_second` and `cost.tts_inr_per_1k_chars` from your
rate card; until then the cost estimate reads 0.00 and says so.

## Two findings worth knowing before the first real run

**1. Sarvam's `mode` parameter partly does the extractor's job.** On `saaras:v3`
and later, the default `mode="transcribe"` applies *number normalization*: spoken
"तीन लाख पचास हज़ार" comes back as `3,50,000`. `mode="verbatim"` preserves the
spoken words.

This sits directly on top of the research question. In `transcribe` mode a miss
may be Sarvam's text normalizer disagreeing rather than the audio failing, so the
measurement is "did the audio survive *and* did their normalizer agree". The mode
is in config and recorded on every result row; running both is the way to
separate the two effects.

**2. Verified models and parameters:**

| | Current | Notes |
|---|---|---|
| ASR | `saaras:v3`, `saaras:v4` | v4 adds telephony-tuned handling and entity preservation; `saarika:v2.5` deprecated |
| TTS | `bulbul:v3` | speaker `shubh`, lowercase, case-sensitive; rate parameter is `speech_sample_rate`, default 24000 |

**The ASR model is an axis, not a setting.** v4 advertises exactly the two
things this harness measures — telephony robustness and entity preservation —
so it has to be *compared* against v3, not swapped in. `configs/default.yaml`
runs both; each model multiplies the ASR call count, and `--dry-run` prints the
total before anything is spent.

TTS synthesizes at 24 kHz. Sarvam supports 8 kHz natively and this deliberately
does not use it: synthesizing at telephony rate would move the independent
variable out of `degrade.py` and into the TTS.

## Design notes

**Conditions are data.** Adding a telephony condition means editing
`configs/default.yaml`, never Python. Each is an ordered chain of typed
transforms, and every ffmpeg/sox invocation is recorded to a `.manifest.json`
sidecar with tool versions and input/output hashes.

**Reproducibility.** Packet loss and noise are seeded from a hash of
`(master seed, utterance id, condition)` rather than a shared RNG, so runs are
byte-identical regardless of order or parallelism. There is a test asserting it.

**Two number decoders, chosen by entity type.** Amounts are read as magnitudes
with Indian grouping — `(crore)(lakh)(thousand)(hundred)(0-99)` — and OTPs and
account numbers are read digit by digit. The same tokens mean different things
under each, and picking the wrong one is a whole class of silent failure.
Fractional modifiers (साढ़े, सवा, पौने, डेढ़, ढाई) are supported because they
are common in real speech and omitting them manufactures misses that look like
ASR errors.

**Gold is never built by parsing generated text.** The corpus generator computes
`normalized` from the sampled value. Round-tripping through the extractor would
make extractor bugs invisible — the exact bug class phase 2 exists to find.

**The offline invariant.** Every gold entity must be recoverable from its own
clean reference text. 857/857 currently pass. This is what makes the triage
buckets meaningful: a miss in a real run is attributable, rather than being
ambiguous between "the line broke it" and "my extractor never handled it".

**No partial credit.** An entity is a hit only on exact normalized match. A
wrong digit in an account number is a total failure, and character similarity
would score a transfer to the wrong account at 0.9.

## Next axis: keyterm prompting

Saaras v4 supports **keyterm prompting** — priming the model with names, places,
brands and technical terms. That acts directly on entity accuracy, which is the
only thing this harness reports, so with/without keyterms is a real extra axis
and probably the most interesting result available after the model comparison.

Not built. The request field name is unverified here (`docs.sarvam.ai` is
unreachable from this environment), but it can be passed through
`providers.asr.sarvam.extra_params` without a code change once known.

Sarvam's BFSI voice-bot and IVR/contact-centre guides document their own
recommended configuration for this exact use case. The harness should be run
against those recommended settings rather than against guesses — worth reading
before the first paid run.

## Tooling for future sessions

Sarvam publishes an MCP server at `docs.sarvam.ai/_mcp/server` and ready-made
Agent Skills for its SDKs. Connecting those to a coding assistant stops it
guessing parameter names. Note that `docs.sarvam.ai` is blocked by the network
egress policy in this remote environment, so both need a session with egress.

Docs pages also serve clean Markdown by appending `.md` to any URL, and
section indexes at `<section>/llms.txt`.

## Not built yet

No report, plots, heatmaps or dashboard. No real dataset loaders (GramVaani,
IndicVoices, Shrutilipi). No NER, so `person_name` and `place_name` are a stub
interface and are excluded from scoring — reporting 0% accuracy for an extractor
that does not exist would read as a finding.
