import { useEffect, useState } from "react";
import { Mark } from "./Mark";

export interface SectionDef { id: string; no: string; title: string; nav: string; }

/**
 * Reading position and which section is in view.
 *
 * The active section is the last one whose top has passed a line a third of the
 * way down the viewport. That is steadier than an IntersectionObserver when
 * sections differ wildly in length, which these do -- "Listen" is twenty times
 * the height of "Known issues".
 */
function useReadingPosition(sections: SectionDef[], heroId: string) {
  const [active, setActive] = useState(-1);
  const [progress, setProgress] = useState(0);
  const [pastHero, setPastHero] = useState(false);

  useEffect(() => {
    const update = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      setProgress(max > 0 ? Math.min(1, doc.scrollTop / max) : 0);

      const hero = document.getElementById(heroId);
      const bar = 64;
      setPastHero(hero ? hero.getBoundingClientRect().bottom <= bar : doc.scrollTop > 0);

      const line = doc.clientHeight / 3;
      let current = -1;
      sections.forEach((s, i) => {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= line) current = i;
      });
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [sections, heroId]);

  return { active, progress, pastHero };
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
           0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01
           1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95
           0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68
           0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0
           3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01
           8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}

/**
 * The header bar.
 *
 * Transparent over the hero and opaque with a hairline underneath once the
 * reader is past it, so the hero reads as full-bleed without the nav ever
 * floating over body copy it cannot be read against.
 */
export function Header({
  sections, heroId, repo,
}: { sections: SectionDef[]; heroId: string; repo: string | null }) {
  const { active, progress, pastHero } = useReadingPosition(sections, heroId);

  return (
    <header className={`hdr ${pastHero ? "hdr--stuck" : ""}`}>
      <div className="hdr__inner">
        <a className="hdr__mark" href="#top">
          <Mark className="hdr__logo" size="1.15em" />
          Ginti<span className="deva">गिनती</span>
        </a>

        <nav className="hdr__nav" aria-label="Sections">
          {sections.map((s, i) => (
            <a key={s.id} href={`#${s.id}`}
               className={i === active ? "is-active" : undefined}
               aria-current={i === active ? "true" : undefined}>
              {s.nav}
            </a>
          ))}
        </nav>

        {repo && (
          <a className="hdr__repo" href={repo} target="_blank" rel="noreferrer noopener">
            <GitHubMark />
            <span>Source</span>
          </a>
        )}
      </div>

      <div className="hdr__progress" role="presentation">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
    </header>
  );
}
