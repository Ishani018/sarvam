Each condition is a named chain of transforms declared in YAML, applied with
ffmpeg and sox. Nothing is reimplemented in Python except packet-loss frame
gating, which is byte slicing over raw PCM and lives there precisely so a seed
reproduces the output bit for bit.

The commands below are not a restatement of the configuration. They are lifted
from the manifest written alongside each degraded file at the moment it was
produced, so what is printed here is what ran.

Seeds are derived by hashing the master seed with the utterance id and the
condition name, rather than by advancing a shared generator. Runs are therefore
byte-identical regardless of order or parallelism, and there is a test asserting
it.
