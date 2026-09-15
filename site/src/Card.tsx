import { Mark } from "./components/Mark";
import { diffValue, entityNoun, prettyValue } from "./entityDiff";
import { pickHeroExample } from "./conditionKind";
import { heldThrough, readable } from "./conditionLabel";
import type { GintiData } from "./types";

/**
 * The link preview card: 1200x630, rendered by Playwright to a PNG.
 *
 * It exists because the preview is seen before the page is, and often instead
 * of it. A card showing a real amount changing on a degraded line delivers the
 * finding to someone who never clicks; a card showing a logo delivers nothing.
 *
 * Built as a second Vite entry rather than as a route in the app, so none of
 * this reaches the page bundle, and as a component rather than as handwritten
 * HTML in the generator, so it uses the same tokens, the same fonts and the
 * same diff logic the page uses. The values are the ones on the page: the same
 * example, chosen by the same function.
 *
 * Sized for where previews actually render. Slack shows this around 360px wide
 * and LinkedIn around 550, so everything is scaled for a 3x reduction -- the
 * pair of values is ~104px here, which survives to ~31px in Slack. Nothing on
 * the card is smaller than 26px for the same reason.
 */
export function Card({ data }: { data: GintiData }) {
  const ex = pickHeroExample(data.listen, data.conditions, data.primaryMode);
  const f = data.finding;
  const held = f ? heldThrough(data.conditions, f.held) : [];
  const family = data.usage?.asr.models[0]?.split(":")[0] ?? "";
  const familyName = family ? family.charAt(0).toUpperCase() + family.slice(1) : "";

  const said = ex ? prettyValue(ex.expected) : null;
  const heard = ex ? prettyValue(ex.found) : null;
  const parts = said && heard ? diffValue(said, heard) : [];

  return (
    <div className="card">
      <div className="card__top">
        <span className="card__brand">
          <Mark className="card__mark" size="1em" />
          Ginti<span className="deva">गिनती</span>
        </span>
        {f && f.ci && (
          <span className="card__n">
            n&nbsp;=&nbsp;{f.nPerCondition} per condition &middot; 95% CI [
            {f.ci[0].toFixed(1)}, {f.ci[1].toFixed(1)}]
          </span>
        )}
      </div>

      <p className="card__claim">
        Nobody measures whether the digits survive a phone line.
      </p>

      {ex && said && heard && (
        <div className="card__pair">
          <div className="card__side">
            <span className="card__label">heard on a clean line</span>
            <span className="card__val card__val--keep">{said}</span>
          </div>
          <span className="card__arrow" aria-hidden="true">&rarr;</span>
          <div className="card__side">
            <span className="card__label">heard on a bad line</span>
            <span className="card__val">
              {parts.map((p, i) =>
                p.kind === "same"
                  ? <span key={i}>{p.text}</span>
                  : p.kind === "wrong"
                    ? <span key={i} className="card__bad">{p.text}</span>
                    : <span key={i} className="card__gone">
                        {"·".repeat(p.text.length)}
                      </span>,
              )}
            </span>
          </div>
        </div>
      )}

      <p className="card__foot">
        {f && f.points !== null && held.length > 0 && familyName ? (
          <>
            <b>{familyName} holds through {readable(held)}.</b> Bursty packet
            loss costs it {f.points.toFixed(1)} points.
          </>
        ) : ex ? (
          <>One {entityNoun(ex.entityType)} from the run: right length, right
            shape, still a valid value.</>
        ) : null}
      </p>
    </div>
  );
}
