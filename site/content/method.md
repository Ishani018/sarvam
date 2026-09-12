The corpus is fully seeded and prefix-stable: generating forty utterances and
generating five with the same seed produce the same first five. Anyone with the
language, the count and the seed can regenerate the identical test set, so a
disagreement about the results can be settled by rerunning them rather than by
argument.

Audio is synthesised at 24 kHz and degraded afterwards by this pipeline. The TTS
API will synthesise at 8 kHz directly, and that is deliberately not used:
generating at telephony rate would move the independent variable out of the
degradation chain and into the vendor's synthesiser.

Every API response is cached on disk under a hash of the full request, including
the audio's own checksum, so a rerun costs nothing and results are stable across
invocations. Raw response bodies are kept alongside the parsed values.
