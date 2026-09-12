SUMMARY: A single aggregate word error rate cannot tell you whether the account number survived, and on a collections call that is the only thing that matters.

Production voice agents in India run over the phone network: 8 kHz sampling, a
lossy codec, and packet loss on a bad line. The audio a model actually receives
in a collections or banking call bears little resemblance to a studio recording.

Public Indic ASR benchmarks report a single aggregate word error rate, measured
on clean audio. That number tells you roughly how often a word is wrong. It does
not tell you whether the account number was one of them.

The distinction matters because the errors are not interchangeable. A dropped
postposition is a cosmetic error. A wrong digit in an account number is a
transfer to the wrong account, an OTP that will not validate, a payment reminder
quoting the wrong amount. On a collections call one wrong digit is a failed
transaction, not a typo — and a word error rate of 0.05 is consistent with either
outcome.

Ginti measures the thing that breaks: whether the number survives.
