import { GATE } from "./gateConfig";

/**
 * A record of each entry, kept in the visitor's own browser.
 *
 * Be clear about what this is and is not. The site is static by design: no
 * backend, no runtime API calls, nothing that phones home. So an entry log can
 * only be written where the visitor already is, which means it never reaches
 * anyone else. It answers "did this browser enter, when, and how" on the
 * machine doing the asking, and nothing more.
 *
 * Anything that actually reported entries would need a server to receive them
 * or a third-party analytics script to send them to, and both are excluded --
 * one by the deployment, the other by not wanting a page about telephony
 * privacy to ship a tracker. DEPLOY.md names the options if that changes.
 *
 * Read them from the console:  __ginti.entries()
 */

export type EntryVia = "key" | "button";

export interface Entry {
  /** ISO 8601, UTC. */
  at: string;
  via: EntryVia;
  /** document.referrer, or null when the browser sends none (a typed URL, a
   *  bookmark, or a referrer-policy that strips it). Null is a real answer
   *  here, not a missing one. */
  referrer: string | null;
  /** Path and hash at the moment of entry, so a deep link is distinguishable
   *  from the front door. The query is dropped: it carries the bypass key. */
  at_path: string;
}

function read(): Entry[] {
  try {
    const raw = localStorage.getItem(GATE.logKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Blocked storage, private mode, or something else's data under our key.
    return [];
  }
}

/** Append one entry, oldest dropped past the cap. Never throws: a gate that
 *  fails to open because logging failed would be the worst of both. */
export function logEntry(via: EntryVia): void {
  const entry: Entry = {
    at: new Date().toISOString(),
    via,
    referrer: document.referrer || null,
    at_path: `${location.pathname}${location.hash}`,
  };
  try {
    const next = [...read(), entry].slice(-GATE.logMax);
    localStorage.setItem(GATE.logKey, JSON.stringify(next));
  } catch {
    /* ignore: the log is a convenience, the gate is not */
  }
}

export function readEntries(): Entry[] {
  return read();
}

/** Console accessor, because a log nobody can find is not a log. */
declare global {
  interface Window { __ginti?: { entries: () => Entry[] } }
}
if (typeof window !== "undefined") {
  window.__ginti = { entries: readEntries };
}
