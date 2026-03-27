// CombinedDashboard.jsx — Default practice view: two scrolling traces + stats + session controls
// Layout: pitch trace + resonance trace side by side (stacked on mobile). Two-row stats.
// Handles session recording: buffers frames and writes to IndexedDB every ~1s.

import { useState, useRef, useEffect, useCallback } from "react";
import { PitchTrace } from "./PitchTrace";
import { ResonanceTrace } from "./ResonanceTrace";
import { SpectralTiltGauge } from "./SpectralTiltGauge";
import { ResonanceGauge } from "./ResonanceGauge";
import { DEFAULT_PITCH_TARGET, DEFAULT_F2_TARGET } from "../utils/constants";
import db from "../db";

const FRAME_FLUSH_INTERVAL = 1000; // Flush buffered frames every 1s

export function CombinedDashboard({
  voiced,
  holding,
  pitch,
  formants,
  spectralTilt,
  hnr,
  pitchTraceRef,
  formantTrailRef,
  sessionRef,
  frameCallbackRef,
  streamRef,
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [notes, setNotes] = useState("");
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  // Session recording state
  const sessionIdRef = useRef(null);
  const frameBufferRef = useRef([]);
  const flushIntervalRef = useRef(null);
  const recordingStartRef = useRef(null);

  // Audio recording state
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [recordAudio, setRecordAudio] = useState(false);

  // Load audio recording preference
  useEffect(() => {
    db.settings.get("default").then((s) => {
      if (s?.recordAudio) setRecordAudio(true);
    });
  }, []);

  // Flush buffered frames to IndexedDB
  const flushFrames = useCallback(async () => {
    const buffer = frameBufferRef.current;
    if (buffer.length === 0) return;
    frameBufferRef.current = [];
    try {
      await db.frames.bulkAdd(buffer);
    } catch (err) {
      console.error("Failed to write frames to IndexedDB:", err);
    }
  }, []);

  // Start recording
  const startRecording = useCallback(async () => {
    const now = Date.now();
    recordingStartRef.current = now;

    // Create session in DB
    const id = await db.sessions.add({
      startedAt: now,
      sessionType: "freeform",
      notes: "",
    });
    sessionIdRef.current = id;

    // Set up frame callback
    frameCallbackRef.current = (frame) => {
      const ts = Date.now() - recordingStartRef.current;
      frameBufferRef.current.push({
        sessionId: sessionIdRef.current,
        timestampMs: ts,
        voiced: frame.voiced,
        f0: frame.f0,
        f1: frame.f1,
        f2: frame.f2,
        f3: frame.f3,
        intensity: frame.intensity,
        spectralTilt: frame.spectralTilt,
        hnr: frame.hnr,
      });
    };

    // Flush interval
    flushIntervalRef.current = setInterval(flushFrames, FRAME_FLUSH_INTERVAL);

    // Start audio recording if enabled
    if (recordAudio && streamRef?.current) {
      try {
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
        const recorder = new MediaRecorder(streamRef.current, { mimeType });
        audioChunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        recorder.start(1000); // 1s timeslices
        mediaRecorderRef.current = recorder;
      } catch (err) {
        console.error("Audio recording failed to start:", err);
      }
    }

    // Timer
    setElapsed(0);
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    setRecording(true);
  }, [frameCallbackRef, flushFrames, recordAudio, streamRef]);

  // Stop recording + compute summary stats
  const stopRecording = useCallback(async () => {
    // Stop timer
    clearInterval(timerRef.current);
    timerRef.current = null;

    // Remove frame callback
    frameCallbackRef.current = null;

    // Stop flush interval and flush remaining
    clearInterval(flushIntervalRef.current);
    flushIntervalRef.current = null;
    await flushFrames();

    // Stop audio recording
    let audioBlob = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      await new Promise((resolve) => {
        mediaRecorderRef.current.onstop = resolve;
        mediaRecorderRef.current.stop();
      });
      if (audioChunksRef.current.length > 0) {
        audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorderRef.current.mimeType });
      }
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
    }

    // Read all frames for this session to compute stats
    const sessionId = sessionIdRef.current;
    const allFrames = await db.frames.where("sessionId").equals(sessionId).toArray();
    const endTime = Date.now();
    const durationSeconds = Math.round((endTime - recordingStartRef.current) / 1000);

    // Compute summary stats
    const summary = computeSummaryStats(allFrames);

    // Update session record
    await db.sessions.update(sessionId, {
      endedAt: endTime,
      durationSeconds,
      notes,
      audioBlob,
      ...summary,
    });

    sessionIdRef.current = null;
    recordingStartRef.current = null;
    setRecording(false);
  }, [frameCallbackRef, flushFrames, notes]);

  // Keep sessionRef in sync
  useEffect(() => {
    if (sessionRef) {
      sessionRef.current = { recording, elapsed, notes };
    }
  }, [recording, elapsed, notes, sessionRef]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);
      if (frameCallbackRef) frameCallbackRef.current = null;
    };
  }, [frameCallbackRef]);

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const inPitchTarget =
    pitch !== null &&
    pitch >= DEFAULT_PITCH_TARGET.low &&
    pitch <= DEFAULT_PITCH_TARGET.high;

  const inF2Target =
    formants?.f2 !== null && formants?.f2 !== undefined &&
    formants.f2 >= DEFAULT_F2_TARGET.low;

  const statOpacity = !voiced && !holding ? "opacity-40" : holding ? "opacity-50" : "";

  return (
    <div className="flex-1 flex flex-col w-full max-w-6xl min-h-0">
      {/* Two scrolling traces: pitch (left) + resonance (right), stacked on mobile */}
      <div className="lg:flex-1 flex flex-col lg:flex-row gap-3 min-h-0">
        {/* Pitch trace — 50% */}
        <div className="lg:w-1/2 min-h-[180px] lg:min-h-0">
          <PitchTrace
            pitchTraceRef={pitchTraceRef}
            voiced={voiced}
            holding={holding}
            pitch={pitch}
            compact
          />
        </div>

        {/* Resonance trace — 50% */}
        <div className="lg:w-1/2 min-h-[180px] lg:min-h-0">
          <ResonanceTrace
            formantTrailRef={formantTrailRef}
            voiced={voiced}
            holding={holding}
            formants={formants}
            compact
          />
        </div>
      </div>

      {/* Live stats — columnar layout: F0+Resonance | F2+VocalWeight | HNR */}
      <div className="flex-shrink-0 mt-3 px-2">
        <div className="flex items-end justify-center gap-x-3 sm:gap-x-6">
          {/* Column 1: F0 value + Resonance gauge */}
          <div className="flex-1 max-w-40 sm:max-w-44">
            <div className={`text-center mb-1.5 ${statOpacity} transition-opacity duration-300`}>
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
                {pitch !== null ? `${Math.round(pitch)}` : "\u2014"}
                <span className="text-xs text-neutral-500 ml-0.5">Hz</span>
              </span>
            </div>
            <ResonanceGauge
              formants={formants}
              voiced={voiced}
              holding={holding}
            />
          </div>

          {/* Column 2: F2 value + Vocal weight gauge */}
          <div className="flex-1 max-w-40 sm:max-w-44">
            <div className={`text-center mb-1.5 ${statOpacity} transition-opacity duration-300`}>
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider block">
                F2
              </span>
              <span
                className={`text-xl sm:text-2xl font-light tabular-nums ${
                  formants?.f2 !== null && formants?.f2 !== undefined
                    ? inF2Target
                      ? "text-blue-400"
                      : "text-orange-400"
                    : "text-neutral-600"
                }`}
              >
                {formants?.f2 !== null && formants?.f2 !== undefined ? `${Math.round(formants.f2)}` : "\u2014"}
                <span className="text-xs text-neutral-500 ml-0.5">Hz</span>
              </span>
            </div>
            <SpectralTiltGauge
              spectralTilt={spectralTilt}
              voiced={voiced}
              holding={holding}
            />
          </div>

          {/* Column 3: HNR */}
          <div className={`text-center shrink-0 pb-3 ${statOpacity} transition-opacity duration-300`}>
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider block">
              HNR
            </span>
            <span className="text-sm font-light tabular-nums text-neutral-300">
              {hnr !== null ? `${hnr.toFixed(1)}` : "\u2014"}
              <span className="text-xs text-neutral-500 ml-0.5">dB</span>
            </span>
          </div>
        </div>
      </div>

      {/* Session controls */}
      <div className="flex-shrink-0 mt-3 pb-2">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={recording ? stopRecording : startRecording}
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
              {recording ? "Stop & Save" : "Save Session"}
            </button>

            {/* Recording indicator + timer */}
            {recording && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs text-red-400 font-medium">REC</span>
              </span>
            )}
          </div>

          <span className="text-sm tabular-nums text-neutral-400 font-mono">
            {formatTime(elapsed)}
          </span>

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

// Compute summary statistics from recorded frames
function computeSummaryStats(frames) {
  const voicedFrames = frames.filter((f) => f.voiced && f.f0 !== null);
  const f0Values = voicedFrames.map((f) => f.f0);
  const f2Values = voicedFrames.filter((f) => f.f2 !== null).map((f) => f.f2);
  const f1Values = voicedFrames.filter((f) => f.f1 !== null).map((f) => f.f1);
  const f3Values = voicedFrames.filter((f) => f.f3 !== null).map((f) => f.f3);
  const tiltValues = voicedFrames.filter((f) => f.spectralTilt !== null).map((f) => f.spectralTilt);
  const hnrValues = voicedFrames.filter((f) => f.hnr !== null).map((f) => f.hnr);

  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const med = (arr) => {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const stdev = (arr) => {
    if (arr.length < 2) return null;
    const mean = avg(arr);
    const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(variance);
  };

  // Time in target calculations
  const pitchInTarget = f0Values.filter(
    (f0) => f0 >= DEFAULT_PITCH_TARGET.low && f0 <= DEFAULT_PITCH_TARGET.high
  );
  const f2InTarget = f2Values.filter((f2) => f2 >= DEFAULT_F2_TARGET.low);

  // Estimate voiced duration: each frame is ~50ms
  const frameDurationMs = 50;
  const voicedDurationSeconds = Math.round((voicedFrames.length * frameDurationMs) / 1000);

  return {
    avgF0: avg(f0Values),
    medianF0: med(f0Values),
    avgF1: avg(f1Values),
    avgF2: avg(f2Values),
    medianF2: med(f2Values),
    avgF3: avg(f3Values),
    avgSpectralTilt: avg(tiltValues),
    avgHnr: avg(hnrValues),
    pitchRangeLow: f0Values.length ? Math.min(...f0Values) : null,
    pitchRangeHigh: f0Values.length ? Math.max(...f0Values) : null,
    pitchStdev: stdev(f0Values),
    pctTimeInPitchTarget: f0Values.length
      ? Math.round((pitchInTarget.length / f0Values.length) * 100)
      : null,
    pctTimeInResonanceTarget: f2Values.length
      ? Math.round((f2InTarget.length / f2Values.length) * 100)
      : null,
    voicedDurationSeconds,
  };
}
