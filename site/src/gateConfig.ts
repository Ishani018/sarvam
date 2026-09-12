/**
 * SOFT GATE ONLY. This is a doorbell, not a lock.
 *
 * The credentials below are in the client bundle and anyone who opens devtools
 * can read them. It exists to stop the link being opened casually by someone it
 * was forwarded to -- nothing more. It is deliberately not obfuscated, because
 * obfuscation would only imply a security property that is not there.
 *
 * For a real gate, use Vercel's Deployment Protection password. See DEPLOY.md.
 */
export const GATE = {
  username: "sarvam",
  password: "sarvam123",
  sessionKey: "ginti.gate",
} as const;
