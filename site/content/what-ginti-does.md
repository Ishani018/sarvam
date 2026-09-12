The generator samples the value first — an account number, an amount, an OTP, a
PIN code, a date — and then builds a sentence around it. The correct answer is
therefore known by construction, before any audio exists.

That ordering is the point. A benchmark built by transcribing recordings and
annotating them afterwards has two fallible steps between the truth and the
score, and a disagreement between them is ambiguous: the model may have erred, or
the annotator may have. Here there is nothing to disagree with. The value that
went in is the value being looked for, so every miss is attributable.

Scoring is exact match on a normalised form, with no partial credit. Indic and
Latin numerals compare equal, `3,50,000` and *teen lakh pachaas hazaar* both
normalise to the same amount, and Indian digit grouping is handled as 2-2-3
rather than 3-3-3. But `50100234567890` and `50100234567891` are simply
different: character similarity would score that pair at 0.93, and it is a
transfer to a stranger.
