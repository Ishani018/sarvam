import { Reveal } from "./Reveal";
import { entityNoun } from "../entityDiff";
import type { GintiData } from "../types";

/**
 * Why anyone would build this, in about fifteen seconds.
 *
 * Sits between the hero and the first numbered section, unnumbered: it is
 * orientation, not part of the argument, and numbering it would imply a reader
 * has to have read it to follow what comes after.
 *
 * The entity types listed are the ones actually scored in this run, not a
 * wishlist, so the section cannot claim coverage the corpus does not have.
 */

const DOMAIN_BLURB: Record<string, string> = {
  account_number: "read back on collections and servicing calls",
  currency: "the amount in a payment confirmation",
  otp: "the one-time code on a login or a transaction",
  pin_code: "the delivery PIN a courier reads out",
  date: "the due date on a reminder call",
};

export function WhyItMatters({ data }: { data: GintiData }) {
  const h = data.headline;
  const types = data.entityTypes;

  return (
    <section className="why" id="why">
      <div className="why__inner">
        <Reveal className="why__head">
          <h2>Why this exists</h2>
          <p>
            A voice agent that mishears a word can be forgiven. One that
            mishears a digit cannot, and the two failures look identical to
            every metric in common use.
          </p>
        </Reveal>

        <div className="why__grid">
          <Reveal as="section" className="why__item">
            <h3>Where a number is the payload</h3>
            <p>
              Collections calls, banking IVR, OTP confirmation, delivery PIN
              verification, insurance servicing. In each of these the
              conversation is small talk wrapped around one value that has to be
              exactly right.
            </p>
            <ul className="why__list">
              {types.map((t) => (
                <li key={t}>
                  <span className="why__type">{entityNoun(t)}</span>
                  {DOMAIN_BLURB[t] && <span>{DOMAIN_BLURB[t]}</span>}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal as="section" className="why__item" delay={60}>
            <h3>The call is not studio audio</h3>
            <p>
              An Indian mobile call arrives at 8&nbsp;kHz through a lossy codec,
              and on a weak connection some of it does not arrive at all. Models
              are benchmarked on clean recordings and then deployed onto this.
            </p>
            <p className="why__aside">
              This run puts synthesised speech through{" "}
              {h.conditions} such conditions &mdash; downsampling, G.711, G.726,
              additive noise, and packet loss both scattered and in bursts
              &mdash; using ffmpeg, not a simulation of one.
            </p>
          </Reveal>

          <Reveal as="section" className="why__item" delay={120}>
            <h3>What actually breaks</h3>
            <p>
              Not a garbled transcript anyone would notice. A single wrong
              digit, in a value of exactly the right length and shape, that
              passes every downstream validation and lands in a ledger.
            </p>
            <p className="why__aside">
              In the worst condition here,{" "}
              {data.lossPairs[0]
                ? `${data.lossPairs[0].bursty.total - data.lossPairs[0].bursty.hits} of ${data.lossPairs[0].bursty.total}`
                : "some"}{" "}
              entities came back wrong while word error rate barely moved.
            </p>
          </Reveal>

          <Reveal as="section" className="why__item" delay={180}>
            <h3>Who it is for</h3>
            <p>
              Anyone deploying or procuring an Indian-language voice agent who
              currently has a single word error rate to go on. Ginti gives you
              the number that matters instead: how often the entity survived,
              broken out by what the network did to the audio.
            </p>
            <p className="why__aside">
              It is an open harness, not a leaderboard. The conditions, the
              corpus and the scoring are all in the repository.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
