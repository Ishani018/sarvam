import type { ReactNode } from "react";

/**
 * A deliberately small Markdown renderer for the prose in content/.
 *
 * Not a dependency: the input is first-party text authored in this repo, and
 * the subset in use is headings, paragraphs, lists, blockquotes, fenced code,
 * plus inline code, bold, italic and links. A general parser would be more
 * capability than the content needs and one more thing in the bundle.
 *
 * It does NOT render raw HTML. Anything that looks like a tag is printed as
 * text, so content can never inject markup into the page.
 */

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;

function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const href = link[2];
      // Only http(s) and anchors; anything else is printed rather than linked.
      const safe = /^(https?:\/\/|#|\/)/.test(href);
      return safe
        ? <a key={key} href={href} rel="noreferrer">{link[1]}</a>
        : <span key={key}>{part}</span>;
    }
    return <span key={key}>{part}</span>;
  });
}

export function Markdown({ source, className }: { source?: string; className?: string }) {
  if (!source?.trim()) return null;

  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(<pre className="cmd" key={k++}><code>{body.join("\n")}</code></pre>);
      continue;
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const content = inline(h[2], `h${k}`);
      blocks.push(
        level <= 2
          ? <h3 className="subhead" key={k++}>{content}</h3>
          : <h4 className="md-h4" key={k++}>{content}</h4>,
      );
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul className="md-list" key={k++}>
          {items.map((it, n) => <li key={n}>{inline(it, `li${k}-${n}`)}</li>)}
        </ul>,
      );
      continue;
    }

    if (line.startsWith("> ")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        body.push(lines[i].slice(2));
        i++;
      }
      blocks.push(
        <blockquote className="note" key={k++}>
          {inline(body.join(" "), `bq${k}`)}
        </blockquote>,
      );
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|[-*]\s|>\s|```)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(<p key={k++}>{inline(para.join(" "), `p${k}`)}</p>);
  }

  return <div className={className ?? "prose"}>{blocks}</div>;
}
