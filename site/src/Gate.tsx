import { useEffect, useState, type ReactNode } from "react";
import { GATE } from "./gateConfig";
import { logEntry } from "./entryLog";
import { Mark } from "./components/Mark";

/**
 * SOFT GATE ONLY -- a doorbell, not a lock, and one anyone may ring.
 *
 * It used to ask for a username and password. Those are gone: they shipped in
 * the same bundle as the data they guarded, so they never kept anyone out who
 * had the link, and they cost every intended visitor a trip to find the email.
 * What is left does the only job that survived contact with reality -- a
 * forwarded link does not open straight onto the page -- and does it in one
 * click, or none.
 *
 * It is not an access boundary and the page should not be read as having one.
 * For a real gate, enforced before any of the bundle is served, use Vercel
 * Deployment Protection (DEPLOY.md).
 */

/** Read once at module load, before React can mount twice under StrictMode and
 *  before the URL is rewritten. Reading it inside the effect meant the second
 *  mount looked at a URL the first had already stripped. */
const BYPASS = (() => {
  try {
    return new URLSearchParams(location.search).get(GATE.bypassParam)
      === GATE.bypassValue;
  } catch {
    return false;
  }
})();

function remembered(): boolean {
  try {
    return localStorage.getItem(GATE.storageKey) === "1";
  } catch {
    return false; // private mode or blocked storage: ask again, it is one click
  }
}

function remember(): void {
  try {
    localStorage.setItem(GATE.storageKey, "1");
  } catch {
    /* ignore: the visitor is in for this page view either way */
  }
}

/** Drop the bypass key from the address bar, keeping everything else.
 *
 *  The hash is load-bearing on this page -- sections and the playground's
 *  deep links live there -- so this rebuilds the URL rather than assigning a
 *  bare pathname, which would silently drop it. */
function stripBypassParam(): void {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has(GATE.bypassParam)) return;
    url.searchParams.delete(GATE.bypassParam);
    const search = url.searchParams.toString();
    history.replaceState(
      null, "",
      `${url.pathname}${search ? `?${search}` : ""}${url.hash}`,
    );
  } catch {
    /* ignore: a visible key is untidy, not broken */
  }
}

export function Gate({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => remembered() || BYPASS);

  // The bypass path: entered before first paint, so there is no flash of the
  // landing screen on a link that was meant to skip it.
  useEffect(() => {
    if (!BYPASS) return;
    stripBypassParam();
    if (!remembered()) {
      remember();
      logEntry("key");
    }
  }, []);

  if (open) return <>{children}</>;

  const enter = () => {
    remember();
    logEntry("button");
    setOpen(true);
  };

  return (
    <div className="gate">
      <div className="gate__box">
        <h1 className="gate__title">
          <Mark className="gate__mark" size="1em" />
          <span>Ginti<span className="deva">गिनती</span></span>
        </h1>
        <p className="gate__hint">
          An open evaluation of whether numbers survive an Indian-language phone
          call.
        </p>
        <button type="button" onClick={enter} autoFocus>Enter demo</button>
      </div>
    </div>
  );
}
