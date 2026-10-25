// DirectionPrompt.jsx — "What are you trying to sound like?"
//
// Asked on every app load (no direction is ever assumed): the first visit
// gets the welcome sheet with the question in it (it replaced the separate
// Welcome overlay, 2026-10-25), later visits a bottom sheet with the last
// answer preselected so confirming it is one tap; the primary button also
// starts listening and "Not now" closes without the microphone.
// Changeable any time in the settings panel, which renders the same
// DirectionOptions. Every option looks the same: only the targets behind
// them differ (a pitch band for the first three, plus the resonance cue's
// outline).
//
// A real modal: App makes everything behind it inert while it is open,
// the options show keyboard focus, Escape = "Not now", and the sheet
// scrolls on short (landscape) viewports.

import { useState, useRef, useEffect } from "react";
import {
  TRAINING_DIRECTIONS,
  pitchTargetFor,
  formatTarget,
} from "../utils/trainingDirection";

function optionHint(id) {
  const pitch = formatTarget(pitchTargetFor(id));
  if (!pitch) return "No targets, just the readings";
  return `Pitch target ${pitch}`;
}

// Radio group of the four directions. `compact` = the settings-panel size.
// The focus outline shows for keyboard focus only (:focus-visible), so a
// tap never leaves a purple ring that looks like the selected state
// (2026-10-19 review S-4c).
// `only` limits the list to some ids (the return-visit sheet shows last
// time's answer alone until "Change goal" is opened); `badgeFor` puts a
// small pill (e.g. "Last time") on that option.
export function DirectionOptions({ value, onChange, compact = false, name = "training-direction", only = null, badgeFor = null, badge = null }) {
  const list = only ? TRAINING_DIRECTIONS.filter((d) => only.includes(d.id)) : TRAINING_DIRECTIONS;
  return (
    <div role="radiogroup" aria-label="What are you trying to sound like?" className={compact ? "space-y-1.5" : "space-y-2"}>
      {list.map((d) => {
        const selected = value === d.id;
        return (
          <label
            key={d.id}
            className={`flex items-center gap-3 rounded-xl border cursor-pointer transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-purple-300 ${
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
              <span className="block text-[11px] text-neutral-400 mt-0.5">{optionHint(d.id)}</span>
            </span>
            {badge && badgeFor === d.id && (
              <span className="ml-auto flex-shrink-0 rounded-full border border-neutral-600 px-2.5 py-0.5 text-[11px] text-neutral-200" data-last-time>
                {badge}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}


// A dimmed, static picture of the cue strip for the first-visit sheet —
// decoration only (aria-hidden); the caption under it says what it is.
function CueStripPreview() {
  return (
    <figure className="opacity-60 select-none" data-cue-preview>
      <svg viewBox="0 0 400 104" className="w-full h-auto" aria-hidden="true" focusable="false">
        <g fontSize="11" fill="#a3a3a3" fontFamily="inherit">
          <text x="0" y="31">Pitch</text>
          <text x="0" y="81">Resonance</text>
          <text x="90" y="13">typical men</text>
          <text x="302" y="44">typical women</text>
        </g>
        <line x1="70" y1="27" x2="400" y2="27" stroke="#525252" />
        <rect x="88" y="17" width="112" height="7" rx="3.5" fill="none" stroke="#737373" />
        <rect x="212" y="30" width="86" height="7" rx="3.5" fill="none" stroke="#737373" />
        <rect x="186" y="12" width="34" height="30" rx="4" fill="rgba(34,197,94,0.08)" stroke="rgba(34,197,94,0.45)" />
        <circle cx="194" cy="27" r="5.5" fill="#a3a3a3" />
        <line x1="96" y1="77" x2="400" y2="77" stroke="#525252" />
        <rect x="104" y="67" width="110" height="7" rx="3.5" fill="none" stroke="#737373" strokeDasharray="3 3" />
        <rect x="230" y="62" width="86" height="28" rx="4" fill="none" stroke="#737373" strokeDasharray="3 3" />
        <circle cx="205" cy="77" r="5.5" fill="#a3a3a3" />
      </svg>
      <figcaption className="text-[11px] text-neutral-400 text-center mt-1">
        Preview · your pitch and resonance will show here
      </figcaption>
    </figure>
  );
}

const PRIMARY_BUTTON =
  "w-full min-h-11 px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-700 disabled:text-neutral-400 disabled:cursor-not-allowed text-white text-[15px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300";
const LINK_BUTTON =
  "w-full min-h-11 px-4 py-2 rounded-xl text-sm font-medium text-purple-300 hover:text-purple-200 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300";

function LockIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

// The goal question, asked on every load (the owner's rule) as one of two
// sheets (approved 2026-10-25):
//   variant "first"  — the first visit (or no saved goal): logo, what the
//                      app does, the privacy line, a dimmed cue-strip
//                      preview, the four goals, "Start — allow the
//                      microphone" (disabled until a goal is chosen) and
//                      "Not now — look around first".
//   variant "return" — later visits with a saved goal: a bottom sheet,
//                      "Welcome back / Same goal as last time?", last
//                      time's goal preselected with a "Last time" pill,
//                      "Change goal" reveals the other three, "Start
//                      practicing" and "Not now — browse without the mic".
// onConfirm(direction, { start }) — start: true from the primary button,
// false from "Not now" / Escape with a goal chosen (applies it, mic off).
// onDismiss() — "Not now" / Escape with no goal chosen: closes, the goal
// stays unset (Start Listening asks again before the mic starts).
export function DirectionPrompt({ initial, onConfirm, onDismiss, variant = "first" }) {
  // App mounts this once the saved choice has been read, so `initial` is
  // final here.
  const [choice, setChoice] = useState(initial ?? null);
  const [expanded, setExpanded] = useState(false);
  const formRef = useRef(null);
  const isReturn = variant === "return" && initial != null;
  // Keyboard start point: the primary button when a goal is preselected
  // (one key/tap to confirm), otherwise the question itself — Tab then
  // reaches the first option. Focusing the first option drew its ring on a
  // first visit, which read as a preselected answer (2026-10-19 review
  // S-4c).
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const target = initial != null
      ? form.querySelector('button[type="submit"]')
      : form.querySelector("#direction-title");
    target?.focus();
  }, [initial]);

  // "Change goal" unmounts itself: keep keyboard focus in the list (on the
  // chosen goal) instead of losing it to the page.
  useEffect(() => {
    if (expanded) formRef.current?.querySelector("input[type=radio]:checked")?.focus();
  }, [expanded]);

  const choiceRef = useRef(choice);
  useEffect(() => { choiceRef.current = choice; }, [choice]);
  const notNowRef = useRef(null);
  useEffect(() => {
    notNowRef.current = () => {
      if (choiceRef.current != null) onConfirm(choiceRef.current, { start: false });
      else onDismiss?.();
    };
  }, [onConfirm, onDismiss]);
  // Escape = "Not now".
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      notNowRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e) => {
    e.preventDefault();
    if (choice != null) onConfirm(choice, { start: true });
  };

  if (isReturn) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
        role="dialog"
        aria-modal="true"
        aria-labelledby="direction-title"
        aria-describedby="direction-desc"
        data-dialog="direction"
        data-variant="return"
      >
        <form
          ref={formRef}
          onSubmit={submit}
          className="w-full max-w-lg max-h-full overflow-y-auto bg-neutral-900 border border-neutral-700 border-b-0 sm:border-b sm:mb-6 rounded-t-2xl sm:rounded-2xl px-5 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl"
        >
          <p className="text-sm text-neutral-400">Welcome back</p>
          <h2 id="direction-title" tabIndex={-1} className="text-xl font-medium text-white mt-1 outline-none">
            Same goal as last time?
          </h2>
          <p id="direction-desc" className="text-sm text-neutral-400 mt-1 mb-4">
            It sets your pitch target for this visit.
          </p>
          <DirectionOptions
            value={choice}
            onChange={setChoice}
            only={expanded ? null : [initial]}
            badgeFor={initial}
            badge="Last time"
          />
          {!expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-expanded="false"
              className="mt-2 min-h-11 inline-flex items-center gap-1.5 px-1 text-sm font-medium text-purple-300 hover:text-purple-200 cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300"
              data-change-goal
            >
              Change goal
              <svg viewBox="0 0 12 12" className="w-3 h-3" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
            </button>
          )}
          <button type="submit" disabled={choice == null} className={`${PRIMARY_BUTTON} mt-4`} data-start-listening>
            Start practicing
          </button>
          <button type="button" onClick={() => notNowRef.current?.()} className={`${LINK_BUTTON} mt-2`} data-not-now>
            Not now — browse without the mic
          </button>
          <p className="flex items-center justify-center gap-1.5 text-[11px] text-neutral-400 text-center mt-1">
            <LockIcon className="w-3 h-3 flex-shrink-0" />
            Start turns on the microphone. Everything stays on this device.
          </p>
        </form>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-neutral-950/95 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="direction-title"
      aria-describedby="welcome-desc"
      data-dialog="direction"
      data-variant="first"
    >
      <form ref={formRef} onSubmit={submit} className="w-full max-w-md px-5 py-6">
        <div className="text-center">
          <img src={`${import.meta.env.BASE_URL}Syrinx.svg`} alt="" className="w-10 h-10 mx-auto" />
          <p className="text-2xl font-medium text-white mt-2">Syrinx</p>
          <p id="welcome-desc" className="text-[15px] text-neutral-300 mt-1 leading-snug">
            Live feedback on your pitch and resonance while you speak.
          </p>
        </div>
        <p className="flex items-start gap-2.5 mt-4 rounded-xl border border-neutral-800 bg-neutral-900 px-3.5 py-2.5 text-[13px] text-neutral-300 leading-snug" data-privacy-line>
          <LockIcon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-neutral-400" />
          <span>Everything runs on this device. No account, nothing uploaded. Saving audio stays off unless you turn it on.</span>
        </p>
        <div className="mt-4">
          <CueStripPreview />
        </div>
        <h2 id="direction-title" tabIndex={-1} className="text-lg font-medium text-white mt-5 outline-none">
          What are you trying to sound like?
        </h2>
        <p className="text-[13px] text-neutral-400 mt-1 mb-3">
          Sets your target range. You can change it any time in Settings.
        </p>
        <DirectionOptions value={choice} onChange={setChoice} />
        <button type="submit" disabled={choice == null} className={`${PRIMARY_BUTTON} mt-5`} data-start-listening>
          Start — allow the microphone
        </button>
        <button type="button" onClick={() => notNowRef.current?.()} className={`${LINK_BUTTON} mt-2`} data-not-now>
          Not now — look around first
        </button>
        <p className="text-[11px] text-neutral-400 text-center mt-1">Your browser will ask for microphone access next.</p>
      </form>
    </div>
  );
}
