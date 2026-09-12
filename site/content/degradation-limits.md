Packet loss is modelled as an independent probability per 20 ms frame. Real
networks do not lose packets that way — loss arrives in bursts, and a burst that
removes four consecutive frames does far more damage to a digit than four
isolated frames scattered across an utterance. The figures here should be read as
a floor on the damage, not an estimate of it. A Gilbert-Elliott burst model would
be the correct next step.

Noise is added before the codec rather than after, which matches the physical
order: a noisy room first, then the phone line. Its level is set against the
measured RMS of each utterance, so the signal-to-noise ratio is exact rather than
nominal.

Dropped frames are filled with silence rather than concealed. A real jitter
buffer would attempt packet loss concealment, interpolating over the gap, which
typically sounds better and sometimes recognises better. Silence is the
worst-case handling.
