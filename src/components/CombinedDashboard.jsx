// CombinedDashboard.jsx — Default practice view: compact visualizations + live stats + session controls
// Layout: compact pitch + resonance side-by-side (stacked mobile), stats row, session controls.

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
      {/* Compact visualizations: pitch on top (mobile) or left (desktop), resonance below/right */}
      <div className="flex-1 flex flex-col lg:flex-row gap-3 min-h-0">
        {/* Pitch trace — compact */}
        <div className="flex-1 min-h-[180px] lg:min-h-0">
          <PitchTrace
            pitchTraceRef={pitchTraceRef}
            voiced={voiced}
            holding={holding}
            pitch={pitch}
            compact
          />
        </div>

        {/* Vowel space — compact */}
        <div className="flex-1 min-h-[180px] lg:min-h-0">
          <VowelSpacePlot
            formantTrailRef={formantTrailRef}
            voiced={voiced}
            holding={holding}
            formants={formants}
            compact
          />
        </div>
      </div>

      {/* Live stats row */}
      <div className="flex-shrink-0 mt-3 px-2">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {/* F0 */}
          <div className={`text-center ${statOpacity} transition-opacity duration-300`}>
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider block">
              F0
            </span>
            <span
              className={`text-lg font-light tabular-nums ${
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
            <span className="text-lg font-light tabular-nums text-neutral-300">
              {formants?.f2 !== null ? `${Math.round(formants.f2)}` : "—"}
              <span className="text-xs text-neutral-500 ml-0.5">Hz</span>
            </span>
          </div>

          {/* Spectral Tilt gauge */}
          <div className="w-40 sm:w-48">
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
            <span className="text-lg font-light tabular-nums text-neutral-300">
              {hnr !== null ? `${hnr.toFixed(1)}` : "—"}
              <span className="text-xs text-neutral-500 ml-0.5">dB</span>
            </span>
          </div>
        </div>
      </div>

      {/* Session controls */}
      <div className="flex-shrink-0 mt-3 pb-2">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {/* Start/stop recording */}
          <button
            onClick={toggleRecording}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
              recording
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                : "bg-purple-600/20 text-purple-400 hover:bg-purple-600/30"
            }`}
          >
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                recording ? "bg-red-400 animate-pulse" : "bg-purple-400"
              }`}
            />
            {recording ? "Stop Recording" : "Start Recording"}
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
