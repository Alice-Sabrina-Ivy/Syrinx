// DirectionPrompt.jsx — "What are you trying to sound like?"
//
// Asked on every app load (no direction is ever assumed), with the last
// answer preselected so confirming it is one tap; changeable any time in
// the settings panel, which renders the same DirectionOptions. Every
// option looks the same — only the target ranges behind them differ.

import { useState, useRef, useEffect } from "react";
import {
  TRAINING_DIRECTIONS,
  pitchTargetFor,
  formatTarget,
} from "../utils/trainingDirection";

function optionHint(id) {
  const pitch = formatTarget(pitchTargetFor(id));
  return pitch ? `Pitch target ${pitch}` : "No targets, just the readings";
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
            className={`flex items-center gap-3 rounded-xl border cursor-pointer transition-colors ${
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="direction-title"
    >
      <form
        ref={formRef}
        className="bg-neutral-900 border border-neutral-700 rounded-2xl p-5 max-w-sm w-full shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (choice != null) onConfirm(choice);
        }}
      >
        <h2 id="direction-title" className="text-lg font-light text-white text-center">
          What are you trying to sound like?
        </h2>
        <p className="text-xs text-neutral-400 text-center mt-1.5 mb-4 leading-relaxed">
          This sets the target ranges. You can change it any time in Settings.
        </p>
        <DirectionOptions value={choice} onChange={setChoice} />
        <button
          type="submit"
          disabled={choice == null}
          className="mt-5 w-full px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-700 disabled:text-neutral-400 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors cursor-pointer"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
