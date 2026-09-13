/**
 * Character-level diff between the value that was said and the value that came
 * back, so a wrong digit can be pointed at rather than described.
 *
 * Plain LCS. These strings are account numbers, PINs and amounts -- tens of
 * characters at most -- so the quadratic table is free, and anything cleverer
 * would be harder to read than the thing it replaces.
 */

export type DiffKind = "same" | "wrong" | "missing";
export interface DiffPart { text: string; kind: DiffKind; }

function lcsTable(a: string, b: string) {
  const t: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    }
  }
  return t;
}

/**
 * Walk `found` against `expected`.
 *
 * Every character of `found` is emitted, marked as matching the expectation or
 * not. Characters of `expected` that never arrived are emitted as `missing`
 * placeholders in the position they were dropped from -- a truncated account
 * number is the commonest failure here, and without them the returned value
 * just looks short rather than wrong.
 */
export function diffValue(expected: string, found: string): DiffPart[] {
  // Equal lengths mean a substitution, and a positional comparison says so
  // exactly: digit three is wrong. Running LCS over those instead re-aligns
  // around whatever happens to match and reports a deletion plus an insertion,
  // which is true but reads as a different, messier failure than the one that
  // happened.
  if (expected.length === found.length) {
    const out: DiffPart[] = [];
    for (let k = 0; k < found.length; k++) {
      const kind: DiffKind = expected[k] === found[k] ? "same" : "wrong";
      const last = out[out.length - 1];
      if (last && last.kind === kind) last.text += found[k];
      else out.push({ text: found[k], kind });
    }
    return out;
  }

  const t = lcsTable(expected, found);
  const out: DiffPart[] = [];
  const push = (text: string, kind: DiffKind) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };

  let i = 0;
  let j = 0;
  while (i < expected.length && j < found.length) {
    if (expected[i] === found[j]) { push(found[j], "same"); i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) { push(expected[i], "missing"); i++; }
    else { push(found[j], "wrong"); j++; }
  }
  while (i < expected.length) push(expected[i++], "missing");
  while (j < found.length) push(found[j++], "wrong");
  return out;
}

/** How many characters of the expected value did not survive. */
export function lostChars(parts: DiffPart[]) {
  return parts.filter((p) => p.kind !== "same")
    .reduce((a, p) => a + p.text.length, 0);
}

/**
 * A gold value as a reader would recognise it.
 *
 * The scorer's normal form is deliberately unambiguous rather than readable --
 * `INR:797.00` cannot be confused with a bare 797 -- but in the one place the
 * page shows a value to a stranger rather than to a reviewer, the currency
 * should look like money. Everything else is passed through untouched.
 */
export function prettyValue(v: string): string {
  const m = /^([A-Z]{3}):(-?\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) return v;
  const sym = m[1] === "INR" ? "\u20b9" : `${m[1]} `;
  const paise = m[3] && Number(m[3]) !== 0 ? `.${m[3]}` : "";
  return `${sym}${m[2]}${paise}`;
}

/**
 * What to call an entity type in a sentence a stranger reads.
 *
 * `currency` is the scorer's name for the field; "a perfectly valid currency"
 * is not English. Types with no entry fall back to their own name with the
 * underscores taken out, so a new entity type reads acceptably until someone
 * writes it a better noun.
 */
const NOUNS: Record<string, string> = {
  account_number: "account number",
  currency: "rupee amount",
  otp: "one-time code",
  pin_code: "PIN code",
  date: "date",
};

export function entityNoun(type: string): string {
  return NOUNS[type] ?? type.replace(/_/g, " ");
}
