// DirectionPrompt.jsx — "What are you trying to sound like?"
//
// Asked on every app load (no direction is ever assumed), with the last
// answer preselected so confirming it is one tap — Continue also starts
// listening, so a return visit is still a single tap. Changeable any time
// in the settings panel, which renders the same DirectionOptions. Every
// option looks the same — only the targets behind them differ (a pitch
// band for the first three; a vocal-weight side for more feminine /
// more masculine).
//
// A real modal: App makes everything behind it inert while it is open
// (no focus, no clicks — the microphone can't be started and Settings
// can't be opened behind it), the options show keyboard focus, Escape
// confirms a preselected/chosen answer without starting the microphone,
// and the panel scrolls on short (landscape) viewports.

import { useState, useRef, useEffect } from "react";
import {
  TRAINING_DIRECTIONS,
  pitchTargetFor,
  weightTargetFor,
  formatTarget,
} from "../utils/trainingDirection";

function optionHint(id) {
  const pitch = formatTarget(pitchTargetFor(id));
  if (!pitch) return "No targets, just the readings";
  const weight = weightTargetFor(id)?.side;
  return weight ? `Pitch target ${pitch} · ${weight} vocal weight` : `Pitch target ${pitch}`;
}

// Radio group of the four directions. `compact` = the settings-panel size.
export function DirectionOptions({ value, onChange, compact = false, name = "training-direction" }) {
  return (
    <div role="radiogroup" aria-label="What are you trying to sound like?" className={compact ? "space-y-1.5" : "space-y-2"}>
      {TRAINING_DIRECTIONS.map((d) => {
        const selected = value === d.id;
        return (
          <label
            key={d.id}
            className={`flex items-center gap-3 rounded-xl border cursor-pointer transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-purple-300 ${
              compact ? "px-3 py-2" : "px-3.5 py-2.5"
            } ${
              selected
                ? "border-purple-500 bg-purple-500/10"
                : "border-neutral-700 bg-neutral-800/40 hover:border-neutral-500"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={d.id}
              checked={selected}
              onChange={() => onChange(d.id)}
              className="sr-only"
              data-direction={d.id}
            />
            <span
              aria-hidden="true"
              className={`flex-shrink-0 w-4 h-4 rounded-full border-2 ${
                selected ? "border-purple-400 bg-purple-400 shadow-[inset_0_0_0_2px_rgb(23,23,23)]" : "border-neutral-500"
              }`}
            />
            <span className="text-left">
              <span className={`block ${compact ? "text-sm" : "text-[15px]"} text-neutral-200`}>{d.label}</span>
              <span className="block text-[11px] text-neutral-500 mt-0.5">{optionHint(d.id)}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

// onConfirm(direction, { start }) — start: true from Continue (start
// listening), false from Escape (just close).
export function DirectionPrompt({ initial, onConfirm }) {
  // App mounts this once the saved choice has been read, so `initial` is
  // final here.
  const [choice, setChoice] = useState(initial ?? null);
  const formRef = useRef(null);
  // Keyboard start point: Continue when the last answer is preselected
  // (one key/tap to confirm), otherwise the first option.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const target = initial != null
      ? form.querySelector('button[type="submit"]')
      : form.querySelector('input[type="radio"]');
    target?.focus();
  }, [initial]);

  // Escape: confirm the preselected / chosen answer (nothing to confirm =
  // stay open; an answer is required).
  const choiceRef = useRef(choice);
  useEffect(() => { choiceRef.current = choice; }, [choice]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || choiceRef.current == null) return;
      e.preventDefault();
      onConfirm(choiceRef.current, { start: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onConfirm]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="direction-title"
      data-dialog="direction"
    >
      <form
        ref={formRef}
        className="bg-neutral-900 border border-neutral-700 rounded-2xl p-5 max-w-sm w-full shadow-xl max-h-full overflow-y-auto"
        onSubmit={(e) => {
          e.preventDefault();
          if (choice != null) onConfirm(choice, { start: true });
        }}
      >
        <h2 id="direction-title" className="text-lg font-light text-white text-center">
          What are you trying to sound like?
        </h2>
        <p className="text-xs text-neutral-400 text-center mt-1.5 mb-4 leading-relaxed">
          This sets your targets. You can change it any time in Settings.
        </p>
        <DirectionOptions value={choice} onChange={setChoice} />
        <button
          type="submit"
          disabled={choice == null}
          className="mt-5 w-full px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-700 disabled:text-neutral-400 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300"
        >
          Continue
        </button>
        <p className="text-[11px] text-neutral-500 text-center mt-2">Continue starts the microphone.</p>
      </form>
    </div>
  );
}
