import { useCallback, useEffect, useRef, useState } from "react";

/* -------------------------------------------------------------------------
 * Transport: two takes, one playhead
 * ---------------------------------------------------------------------- */

export const fmt = (s: number) =>
  Number.isFinite(s)
    ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
    : "--:--";

/**
 * Plays the clean take and the damaged take against one shared position.
 *
 * A/B swaps which one is audible without moving the playhead, so the reader
 * compares the two rather than remembering the first while the second plays.
 * Both elements are kept loaded; only the active one runs.
 */
export function useAB(cleanSrc: string | null, dmgSrc: string | null) {
  const cleanRef = useRef<HTMLAudioElement | null>(null);
  const dmgRef = useRef<HTMLAudioElement | null>(null);
  const [side, setSide] = useState<"clean" | "damaged">("clean");
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [duration, setDuration] = useState(NaN);

  const active = useCallback(
    () => (side === "clean" ? cleanRef.current : dmgRef.current), [side]);
  const other = useCallback(
    () => (side === "clean" ? dmgRef.current : cleanRef.current), [side]);

  // A new utterance or condition means new audio: stop, and rewind, or the
  // playhead sits somewhere in the middle of a clip the reader never started.
  useEffect(() => {
    [cleanRef.current, dmgRef.current].forEach((el) => {
      if (el) { el.pause(); el.currentTime = 0; }
    });
    setPlaying(false);
    setAt(0);
  }, [cleanSrc, dmgSrc]);

  useEffect(() => {
    const el = active();
    if (!el) return;
    const onTime = () => setAt(el.currentTime);
    const onMeta = () => setDuration(el.duration);
    const onEnd = () => { setPlaying(false); setAt(0); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    if (Number.isFinite(el.duration)) setDuration(el.duration);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [active, cleanSrc, dmgSrc]);

  const toggle = () => {
    const el = active();
    if (!el) return;
    if (el.paused) void el.play(); else el.pause();
  };

  const flip = () => {
    const from = active();
    const to = other();
    if (!from || !to) { setSide((s) => (s === "clean" ? "damaged" : "clean")); return; }
    const t = from.currentTime;
    const wasPlaying = !from.paused;
    from.pause();
    to.currentTime = Math.min(t, Number.isFinite(to.duration) ? to.duration : t);
    setSide((s) => (s === "clean" ? "damaged" : "clean"));
    if (wasPlaying) void to.play();
  };

  const seek = (frac: number) => {
    const el = active();
    if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = frac * el.duration;
    setAt(el.currentTime);
  };

  const pos = Number.isFinite(duration) && duration > 0 ? at / duration : 0;
  return { cleanRef, dmgRef, side, setSide, playing, at, duration, pos,
           toggle, flip, seek };
}
