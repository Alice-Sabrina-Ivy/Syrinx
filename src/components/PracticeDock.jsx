// The practice dock (2026-10-25, approved board "Recording on any tab"):
// one bar pinned to the bottom of EVERY tab while listening — record /
// stop & save with the timer, the session note, and Mic off. Replaces the
// Dashboard's session row and the old voice-status + Stop Listening bar.
// Presentational only: the recording itself stays in CombinedDashboard
// (always mounted while listening), which renders this into App's dock slot.
import { useEffect, useRef, useState } from "react";
import { formatElapsed } from "../utils/formatElapsed";

// The voice status (laid out at the widest one's width so the dock's
// buttons don't slide as the voice comes and goes).
const VOICE_STATUS_TEXTS = ["Voice detected", "Listening...", "Waiting for voice..."];

function VoiceDot({ pitchVoiced, pitchHolding }) {
  // Three stacked dots cross-fading by opacity (composited) instead of one
  // dot transitioning colour + shadow, which ran on the main thread every
  // display frame (measurements/main-thread-cpu-2026-10-08.md).
  return (
    <div className="relative w-2 h-2 shrink-0" data-voice-status={pitchVoiced ? "voiced" : pitchHolding ? "holding" : "waiting"}>
      <div className={`absolute inset-0 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)] transition-opacity duration-300 ${pitchVoiced ? "opacity-100" : "opacity-0"}`} />
      <div className={`absolute inset-0 rounded-full bg-yellow-400/60 transition-opacity duration-300 ${!pitchVoiced && pitchHolding ? "opacity-100" : "opacity-0"}`} />
      <div className={`absolute inset-0 rounded-full bg-neutral-600 transition-opacity duration-300 ${!pitchVoiced && !pitchHolding ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
}

function MicOffIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
      <path d="M7.5 2a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 7.5 2z" opacity="0.5" />
      <path fillRule="evenodd" d="M3.5 7.5a.5.5 0 0 1 .5.5 3.5 3.5 0 1 0 7 0 .5.5 0 0 1 1 0 4.5 4.5 0 0 1-4 4.473V14.5h2a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1h2v-2.027A4.5 4.5 0 0 1 3 8a.5.5 0 0 1 .5-.5z" clipRule="evenodd" opacity="0.5" />
      <path d="M1.646 1.646a.5.5 0 0 1 .708 0l12 12a.5.5 0 0 1-.708.708l-12-12a.5.5 0 0 1 0-.708z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-5 h-5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" />
    </svg>
  );
}

const NOTES_INPUT_CLASS =
  "w-full min-w-0 bg-neutral-800/60 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-300 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500";

export function PracticeDock({
  recording,
  stopping,
  elapsed,
  notes,
  onNotesChange,
  onRecord,
  onStopAndSave,
  onMicOff,
  pitchVoiced,
  pitchHolding,
  recordError,
}) {
  // Phone: the note lives in a small popover above the dock.
  const [noteOpen, setNoteOpen] = useState(false);
  const noteButtonRef = useRef(null);
  const noteInputRef = useRef(null);
  useEffect(() => {
    if (!noteOpen) return;
    noteInputRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); setNoteOpen(false); noteButtonRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [noteOpen]);

  const statusText = pitchVoiced ? "Voice detected" : pitchHolding ? "Listening..." : "Waiting for voice...";
  const hasNote = notes.trim().length > 0;
  const time = formatElapsed(elapsed);

  return (
    <div className="relative flex-shrink-0 mt-2 pt-2 border-t border-neutral-800/80" data-practice-dock="" data-recording={recording ? "1" : "0"}>
      {noteOpen && (
        <div className="sm:hidden absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-neutral-700 bg-neutral-900 p-3 shadow-xl" data-dock-note-popover="">
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="dock-note-phone" className="text-xs text-neutral-400">Session note</label>
            <button
              type="button"
              onClick={() => { setNoteOpen(false); noteButtonRef.current?.focus(); }}
              className="min-w-[44px] min-h-[44px] -my-3 -mr-2 flex items-center justify-center text-neutral-400 hover:text-neutral-200 cursor-pointer"
              aria-label="Close note"
            >
              ✕
            </button>
          </div>
          <input
            id="dock-note-phone"
            ref={noteInputRef}
            type="text"
            placeholder="Session notes..."
            aria-label="Session notes"
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            className={NOTES_INPUT_CLASS}
          />
        </div>
      )}

      <div className="flex items-center gap-2 w-full">
        {/* Voice status: words from sm, an accessible dot on phones */}
        <div className="flex items-center gap-2 shrink-0" data-dock-voice="">
          <VoiceDot pitchVoiced={pitchVoiced} pitchHolding={pitchHolding} />
          <span className="sr-only sm:hidden">{statusText}</span>
          <span className="hidden sm:inline-grid text-[11px] text-neutral-500" aria-hidden="true">
            {VOICE_STATUS_TEXTS.map((t) => <span key={t} className="invisible col-start-1 row-start-1 whitespace-nowrap">{t}</span>)}
            <span className="col-start-1 row-start-1 whitespace-nowrap">{statusText}</span>
          </span>
        </div>

        {recording ? (
          <button
            type="button"
            onClick={onStopAndSave}
            disabled={stopping}
            data-dock-record=""
            className="flex-1 sm:flex-none min-w-0 min-h-[44px] flex items-center gap-2 px-3 rounded-xl text-sm font-medium transition-colors cursor-pointer border bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25 disabled:opacity-60 disabled:cursor-wait"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-red-400 animate-pulse shrink-0" aria-hidden="true" />
            <span className="text-xs font-semibold tracking-wide">REC</span>
            <span className="tabular-nums font-mono text-neutral-200" data-dock-timer="">{time}</span>
            <span className="w-px h-5 bg-red-500/30 shrink-0" aria-hidden="true" />
            <span className="w-2.5 h-2.5 rounded-[2px] bg-red-400 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap text-neutral-100">{stopping ? "Saving…" : "Stop & save"}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onRecord}
            data-dock-record=""
            className="flex-1 sm:flex-none min-w-0 min-h-[44px] flex items-center justify-center sm:justify-start gap-2 px-4 rounded-xl text-sm font-medium transition-colors cursor-pointer border bg-neutral-800/60 text-neutral-200 border-neutral-700 hover:bg-neutral-700/60"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-red-400 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">Record session</span>
          </button>
        )}

        {/* Note: a button + popover on phones, the field inline from sm */}
        <button
          type="button"
          ref={noteButtonRef}
          onClick={() => setNoteOpen((o) => !o)}
          aria-expanded={noteOpen}
          aria-label={hasNote ? "Session note (has a note)" : "Session note"}
          data-dock-note-button=""
          className="sm:hidden relative shrink-0 w-11 h-11 flex items-center justify-center rounded-xl border border-neutral-700 bg-neutral-800/60 text-neutral-300 hover:bg-neutral-700/60 cursor-pointer"
        >
          <PencilIcon />
          {hasNote && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-violet-400" aria-hidden="true" />}
        </button>
        <div className="hidden sm:block flex-1 min-w-0">
          <input
            type="text"
            placeholder="Session notes..."
            aria-label="Session notes"
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            className={NOTES_INPUT_CLASS}
          />
        </div>

        <button
          type="button"
          onClick={onMicOff}
          data-dock-mic-off=""
          className="shrink-0 min-h-[44px] flex items-center gap-1.5 px-3 sm:px-4 rounded-xl border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm transition-colors cursor-pointer"
        >
          <MicOffIcon />
          <span className="whitespace-nowrap">Mic off</span>
        </button>
      </div>
      {recordError && (
        <p role="alert" className="text-xs text-red-400 text-center mt-2">{recordError}</p>
      )}
    </div>
  );
}

// "Session saved · 3:12" after Stop & save or Mic off ends a recording.
// Rendered by App (it outlives CombinedDashboard on Mic off).
export function SavedToast({ durationSeconds, onShow, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div
      role="status"
      aria-live="polite"
      data-saved-toast=""
      className="fixed left-1/2 -translate-x-1/2 bottom-24 z-40 w-[min(92vw,440px)] flex items-center gap-3 pl-4 pr-1 py-1 rounded-xl border border-neutral-700 bg-neutral-800 shadow-xl text-sm text-neutral-100"
    >
      <span aria-hidden="true" className="text-neutral-300">✓</span>
      <span className="flex-1 min-w-0 font-medium">Session saved · {formatElapsed(Math.round(durationSeconds || 0))}</span>
      {onShow && (
        <button type="button" onClick={onShow} className="min-h-[44px] px-2 text-violet-300 hover:text-violet-200 font-medium cursor-pointer whitespace-nowrap">
          Show session
        </button>
      )}
      <button type="button" onClick={onClose} aria-label="Dismiss" className="min-w-[44px] min-h-[44px] flex items-center justify-center text-neutral-400 hover:text-neutral-200 cursor-pointer">
        ✕
      </button>
    </div>
  );
}
