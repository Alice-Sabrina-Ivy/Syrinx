// SteadinessReadout.jsx — "Steadiness ±0.4 st" next to the F0 readout.
//
// Shows how steadily the voice held pitch over the last ~1 s: the
// spread (standard deviation) of the detected pitch in semitones, from
// src/audio/steadiness.js via useAudioPipeline (`steadiness`,
// `steadinessHeld`). Deliberately neutral: no colour judgement (it is
// not a pass/fail and not gendered), "—" when there is not enough
// voiced sound in the window or the window spans a jump the trim
// refuses, dim when the value is the last reading held briefly after
// the voice stopped. A small info button
// opens a one-paragraph explainer (tap-friendly; also a hover title).

import { useEffect, useId, useRef, useState } from "react";
import { formatSteadiness } from "../audio/steadiness";

const EXPLAINER =
  "How steadily your pitch held over the last second: the spread " +
  "(standard deviation) of your pitch, in semitones. Smaller means " +
  "steadier; 1 semitone is the step between neighbouring piano keys. " +
  "Vibrato and slides count as movement. Shows — until there is " +
  "about half a second of voiced sound, and during a jump to a new " +
  "note or register (until the new note fills most of the second). " +
  "After you stop, the last value stays, dimmed, for a moment. " +
  "Differences under about 0.1 st are within measurement noise.";

export function SteadinessReadout({
  value,
  held = false,
  variant = "stat", // "stat" (dashboard column) | "inline" (Pitch tab)
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const tipId = useId();
  const text = formatSteadiness(value);

  // Close the explainer on an outside tap or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const dim = text === null ? "opacity-40" : held ? "opacity-50" : "";
  const valueNode = (
    <span className="tabular-nums text-neutral-300">
      {text === null ? "—" : `±${text}`}
      <span className="text-xs text-neutral-500 ml-0.5">st</span>
    </span>
  );
  const infoButton = (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      aria-controls={tipId}
      aria-label="What does steadiness measure?"
      title={EXPLAINER}
      className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-neutral-600 text-[9px] leading-none text-neutral-500 hover:text-neutral-300 hover:border-neutral-400 transition-colors cursor-pointer align-middle"
    >
      i
    </button>
  );
  // Anchored to the side the readout sits on so it stays on screen at
  // phone width: the dashboard column is at the left, the Pitch-tab
  // readout ends its row.
  const popover = open && (
    <div
      id={tipId}
      role="note"
      className={`absolute z-20 bottom-full mb-2 ${variant === "inline" ? "right-0" : "left-0"} w-60 max-w-[calc(100vw-2rem)] rounded-lg border border-neutral-700 bg-neutral-900/95 px-3 py-2 text-left text-xs leading-relaxed text-neutral-300 shadow-lg normal-case tracking-normal`}
    >
      {EXPLAINER}
    </div>
  );

  if (variant === "inline") {
    return (
      <span ref={wrapRef} className="relative inline-flex items-baseline gap-1.5">
        <span className={`inline-flex items-baseline gap-1.5 transition-opacity duration-300 ${dim}`}>
          <span className="text-[11px] text-neutral-500 uppercase tracking-wider">Steadiness</span>
          <span className="text-lg font-light">{valueNode}</span>
        </span>
        {infoButton}
        {popover}
      </span>
    );
  }

  return (
    <div ref={wrapRef} className="relative text-center">
      <span className="text-[10px] leading-tight text-neutral-500 uppercase tracking-wider inline-flex items-center">
        Steadiness
        {infoButton}
      </span>
      <span className={`block text-sm leading-tight font-light transition-opacity duration-300 ${dim}`}>{valueNode}</span>
      {popover}
    </div>
  );
}
