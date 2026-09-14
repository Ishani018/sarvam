/**
 * Which mode the tables below are showing.
 *
 * Renders nothing with a single mode in the results -- a control with one
 * option is decoration. The label says what changes, because "transcribe" and
 * "verbatim" mean nothing to a reader who has not been told.
 */
export function ModeSwitch({ modes, value, onChange, primary }: {
  modes: string[];
  value: string;
  onChange: (m: string) => void;
  primary: string;
}) {
  if (modes.length < 2) return null;
  return (
    <div className="modesw">
      <span className="modesw__label">transcribed as</span>
      <div className="modesw__opts" role="group" aria-label="ASR mode">
        {modes.map((m) => (
          <button type="button" key={m}
                  className={`modesw__opt ${m === value ? "is-on" : ""}`}
                  aria-pressed={m === value}
                  onClick={() => onChange(m)}>
            {m}
            {m === primary && <i>default</i>}
          </button>
        ))}
      </div>
      <span className="modesw__note">
        {value === primary
          ? "numbers normalised by the recogniser, as the API returns them unless asked otherwise"
          : "the words as spoken, with no number normalisation"}
      </span>
    </div>
  );
}
