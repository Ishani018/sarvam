/**
 * SOFT GATE ONLY. This is a doorbell, not a lock -- and it is now a doorbell
 * anyone may ring.
 *
 * There are no credentials any more. The gate asks for one click (or none, with
 * the bypass link below), so it stops a forwarded link opening straight into
 * the page and nothing more. Everything behind it ships in the same public
 * bundle regardless.
 *
 * For an actual access boundary, enforced before any of the bundle is served,
 * use Vercel Deployment Protection. See DEPLOY.md.
 */
export const GATE = {
  /** Where the entered state lives. localStorage, not session: a demo link is
   *  opened, closed and reopened, and being asked again each time is the
   *  friction this gate exists to not have. */
  storageKey: "ginti.gate",

  /** `?key=sarvam` enters with no click. Not a secret -- it is in this file and
   *  in the bundle -- just a way to send a link that opens straight onto the
   *  page. The value is checked so a stray `?key=` does not enter. */
  bypassParam: "key",
  bypassValue: "sarvam",

  /** Entry log. Local to the browser; see entryLog.ts for what that means. */
  logKey: "ginti.entries",
  logMax: 50,
} as const;
