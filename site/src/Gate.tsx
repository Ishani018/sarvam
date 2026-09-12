import { useState, type ReactNode } from "react";
import { GATE } from "./gateConfig";

/**
 * SOFT GATE ONLY -- a doorbell, not a lock. The credentials live in the client
 * bundle and anyone who opens devtools can read them, along with all the data
 * behind this screen. It exists so a forwarded link is not casually openable.
 * For a real gate, use Vercel Deployment Protection (see DEPLOY.md).
 */
export function Gate({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem(GATE.sessionKey) === "1";
    } catch {
      return false; // private mode / blocked storage: ask again
    }
  });
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState(false);

  if (open) return <>{children}</>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (user === GATE.username && pass === GATE.password) {
      try { sessionStorage.setItem(GATE.sessionKey, "1"); } catch { /* ignore */ }
      setOpen(true);
    } else {
      setError(true);
    }
  };

  return (
    <div className="gate">
      <form className="gate__box" onSubmit={submit}>
        <h1 className="gate__title">Ginti<span className="deva">गिनती</span></h1>
        <p className="gate__hint">This page is not public. Enter the credentials you were sent.</p>

        <div className="gate__field">
          <label className="gate__label" htmlFor="u">username</label>
          <input id="u" value={user} autoComplete="username" autoFocus
                 onChange={(e) => { setUser(e.target.value); setError(false); }} />
        </div>
        <div className="gate__field">
          <label className="gate__label" htmlFor="p">password</label>
          <input id="p" type="password" value={pass} autoComplete="current-password"
                 onChange={(e) => { setPass(e.target.value); setError(false); }} />
        </div>
        <button type="submit">Enter</button>
        {error && <p className="gate__error">Not recognised.</p>}
      </form>
    </div>
  );
}
