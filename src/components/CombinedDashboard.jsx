// CombinedDashboard.jsx — Default practice view: compact visualizations + live stats + session controls
// Layout: pitch 60% width, resonance 40% (stacked on mobile). Two-row stats. Distinct buttons.

import { useState, useRef, useEffect, useCallback } from "react";
import { PitchTrace } from "./PitchTrace";
import { VowelSpacePlot } from "./VowelSpacePlot";
import { SpectralTiltGauge } from "./SpectralTiltGauge";
import { DEFAULT_PITCH_TARGET } from "../utils/constants";

export function CombinedDashboard({
  voiced,
  holding,
  pitch,
  intensity,
  noteName,
  formants,
  spectralTilt,
  hnr,
  pitchTraceRef,
  formantTrailRef,
  debugRef,
  start,
  stop,
  status,
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [notes, setNotes] = useState("");
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  const toggleRecording = useCallback(() => {
    if (recording) {
      // Stop recording
      clearInterval(timerRef.current);
      timerRef.current = null;
      setRecording(false);
    } else {
      // Start recording
      setElapsed(0);
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
      setRecording(true);
    }
  }, [recording]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const inPitchTarget =
    pitch !== null &&
    pitch >= DEFAULT_PITCH_TARGET.low &&
    pitch <= DEFAULT_PITCH_TARGET.high;

  const statOpacity = !voiced && !holding ? "opacity-40" : holding ? "opacity-50" : "";

  return (
    <div className="flex-1 flex flex-col w-full max-w-6xl min-h-0">
      {/* Compact visualizations: 60% pitch / 40% resonance (stacked on mobile) */}
      <div className="flex-1 flex flex-col lg:flex-row gap-3 min-h-0">
        {/* Pitch trace — 60% */}
        <div className="lg:w-[60%] min-h-[180px] lg:min-h-0">
          <PitchTrace
            pitchTraceRef={pitchTraceRef}
            debugRef={debugRef}
            voiced={voiced}
            holding={holding}
            pitch={pitch}
            compact
          />
        </div>

        {/* Vowel space — 40% */}
        <div className="lg:w-[40%] min-h-[180px] lg:min-h-0">
          <VowelSpacePlot
            formantTrailRef={formantTrailRef}
            voiced={voiced}
            holding={holding}
            formants={formants}
            compact
          />
        </div>
      </div>

      {/* Live stats — two rows */}
      <div className="flex-shrink-0 mt-3 px-2">
        {/* Row 1: Primary metrics (F0 + F2) — larger */}
        <div className="flex items-center justify-center gap-x-8 gap-y-1">
          {/* F0 */}
          <div className={`text-center ${statOpacity} transition-opacity duration-300`}>
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider block">
              F0
            </span>
            <span
              className={`text-xl sm:text-2xl font-light tabular-nums ${
                pitch !== null
                  ? inPitchTarget
                    ? "text-green-400"
                    : "text-red-400"
                  : "text-neutral-600"
              }`}
            >
              {pitch !== null ? `${Math.round(pitch)}` : "—"}
              <span className="text-xs text-neutral-500 ml-0.5">Hz</span>
            </span>
          </div>

          {/* F2 */}
          <div className={`text-center ${statOpacity} transition-opacity duration-300`}>
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider block">
              F2
            </span>
            <span className="text-xl sm:text-2xl font-light tabular-nums text-neutral-300">
              {formants?.f2 != null ? `${Math.round(formants.f2)}` : "—"}
              <span className="text-xs text-neutral-500 ml-0.5">Hz</span>
            </span>
          </div>
        </div>

        {/* Row 2: Secondary metrics (Vocal Weight + HNR) */}
        <div className="flex items-center justify-center gap-x-6 gap-y-1 mt-1.5">
          {/* Spectral Tilt gauge */}
          <div className="w-36 sm:w-44">
            <SpectralTiltGauge
              spectralTilt={spectralTilt}
              voiced={voiced}
              holding={holding}
            />
          </div>

          {/* HNR */}
          <div className={`text-center ${statOpacity} transition-opacity duration-300`}>
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider block">
              HNR
            </span>
            <span className="text-sm font-light tabular-nums text-neutral-300">
              {hnr !== null ? `${hnr.toFixed(1)}` : "—"}
              <span className="text-xs text-neutral-500 ml-0.5">dB</span>
            </span>
          </div>
        </div>
      </div>

      {/* Session controls */}
      <div className="flex-shrink-0 mt-3 pb-2">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {/* Save session recording — visually distinct */}
          <button
            onClick={toggleRecording}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium transition-colors cursor-pointer border ${
              recording
                ? "bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25"
                : "bg-neutral-800/60 text-neutral-300 border-neutral-700 hover:bg-neutral-700/60"
            }`}
          >
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                recording ? "bg-red-400 animate-pulse" : "bg-neutral-500"
              }`}
            />
            {recording ? "Stop Recording" : "Save Session"}
          </button>

          {/* Session timer */}
          <span className="text-sm tabular-nums text-neutral-400 font-mono">
            {formatTime(elapsed)}
          </span>

          {/* Session notes */}
          <input
            type="text"
            placeholder="Session notes..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="bg-neutral-800/60 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-300 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500 w-48 sm:w-56"
          />
        </div>
      </div>
    </div>
  );
}
