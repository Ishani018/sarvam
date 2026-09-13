SUMMARY: Packet loss is modelled as independent per-frame loss, which is gentler than real networks; read these figures as a floor on the damage.

Packet loss is modelled two ways, and both are declared at matching rates so
they can be compared directly.

`bernoulli` loses each 20 ms frame independently. At 5% that is a scattered
sprinkle of single-frame dropouts with intact context either side of every one —
a gentler test than any real network.

`gilbert` is a two-state Markov chain: a good state where frames arrive and a bad
state where they do not, parameterised by a target average loss rate and a mean
burst length. At the same nominal 5% it removes the same number of frames in
roughly a fifth as many holes, each about 100 ms — long enough to swallow a
syllable, which in these sentences is often a whole digit.

That pairing is the point. If a number survives scattered loss but not bursty
loss at the same rate, the model was recovering from surrounding context rather
than from the audio, and the earlier result was easier than it looked.

Concealment is a second variable. `fill: silence` punches a hole; `fill: repeat`
holds the last frame that actually arrived, which is what many jitter buffers do
and is usually kinder to a recogniser. Both are declared.

Bursty loss is a much noisier per-file measure than independent loss: at 2% with
100 ms bursts a single four-second utterance contains only a burst or two, so
individual files vary widely even though the process is unbiased over a corpus.

Noise is added before the codec rather than after, which matches the physical
order: a noisy room first, then the phone line. Its level is set against the
measured RMS of each utterance, so the signal-to-noise ratio is exact rather than
nominal.

Dropped frames are filled with silence rather than concealed. A real jitter
buffer would attempt packet loss concealment, interpolating over the gap, which
typically sounds better and sometimes recognises better. Silence is the
worst-case handling.
