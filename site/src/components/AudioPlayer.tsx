import { useEffect, useRef, useState } from "react";

/**
 * Minimal audio player.
 *
 * Native <audio controls> renders differently in every browser and would be the
 * one obviously un-designed element on the page, so this is hand-built:
 * play/pause, a thin seekable progress line, a duration readout in tabular
 * figures.
 *
 * Starting one player stops every other. Coordination is a module-level
 * singleton rather than React context because the only shared state is "who is
 * playing", and routing that through a provider would re-render every player on
 * every tick.
 */

let stopCurrent: (() => void) | null = null;

function claimPlayback(stop: () => void) {
  if (stopCurrent && stopCurrent !== stop) stopCurrent();
  stopCurrent = stop;
}

function releasePlayback(stop: () => void) {
  if (stopCurrent === stop) stopCurrent = null;
}

const fmt = (s: number) =>
  Number.isFinite(s)
    ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
    : "--:--";

interface Props {
  src: string | null;
  label: string;
  /** Shown beside the label, e.g. the condition description. */
  hint?: string;
}

export function AudioPlayer({ src, label, hint }: Props) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [duration, setDuration] = useState(NaN);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = () => { el.pause(); };
    const onPlay = () => { claimPlayback(stop); setPlaying(true); };
    const onPause = () => { releasePlayback(stop); setPlaying(false); };
    const onTime = () => setAt(el.currentTime);
    const onMeta = () => setDuration(el.duration);
    const onEnd = () => { setPlaying(false); setAt(0); releasePlayback(stop); };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
      releasePlayback(stop);
    };
  }, [src]);

  if (!src) {
    return (
      <div className="player player--empty">
        <div className="player__row">
          <span className="player__label">{label}</span>
        </div>
        <p className="player__missing">audio not in this build</p>
      </div>
    );
  }

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play(); else el.pause();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || !Number.isFinite(el.duration)) return;
    const box = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - box.left) / box.width) * el.duration;
  };

  const pct = Number.isFinite(duration) && duration > 0 ? (at / duration) * 100 : 0;

  return (
    <div className={`player ${playing ? "player--on" : ""}`}>
      <div className="player__row">
        <button
          className="player__btn"
          onClick={toggle}
          aria-label={`${playing ? "Pause" : "Play"} ${label}`}
          type="button"
        >
          {playing ? (
            <svg viewBox="0 0 10 12" width="10" height="12" aria-hidden="true">
              <rect x="0" y="0" width="3.2" height="12" fill="currentColor" />
              <rect x="6.8" y="0" width="3.2" height="12" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 10 12" width="10" height="12" aria-hidden="true">
              <path d="M0 0 L10 6 L0 12 Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <span className="player__label">{label}</span>
        <span className="player__time">
          {fmt(playing || at > 0 ? at : duration)}
        </span>
      </div>

      <div className="player__track" onClick={seek} role="presentation">
        <div className="player__fill" style={{ width: `${pct}%` }} />
      </div>

      {hint && <p className="player__hint">{hint}</p>}
      <audio ref={ref} src={src} preload="metadata" />
    </div>
  );
}
