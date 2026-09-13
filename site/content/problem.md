SUMMARY: A single aggregate word error rate cannot tell you whether the amount, the account number or the code survived, and on a collections call that is the only thing that matters.

Production voice agents in India run over the phone network: 8 kHz sampling, a
lossy codec, and packet loss on a bad line. The audio a model actually receives
in a collections or banking call bears little resemblance to a studio recording.

Public Indic ASR benchmarks report a single aggregate word error rate, measured
on clean audio. That number tells you roughly how often a word is wrong. It does
not tell you whether the one word carrying the money was one of them.

The distinction matters because the errors are not interchangeable. A dropped
postposition is a cosmetic error. A wrong digit is a reminder quoting the wrong
balance, an OTP that will not validate, a transfer to an account the caller
never named. On a collections call one wrong digit is a failed transaction, not
a typo — and a word error rate of 0.05 is consistent with either outcome.

Both directions of the call are in scope. An agent reads back the last four
digits of an account, never the whole number; what it says in full is money,
dates and reference numbers. Full account numbers and one-time codes travel the
other way, spoken by the caller. Either way a number has to cross a phone line
intact, which is the thing being measured.

Ginti measures the thing that breaks: whether the number survives.
