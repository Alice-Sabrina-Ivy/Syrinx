// CombinedDashboard.jsx — Default practice view: pitch trace + resonance
// thermometer side by side (stacked on mobile), with vocal-weight + HNR
// stats + session controls below. Handles session recording: buffers
// frames and writes to IndexedDB every ~1s.

import { useState, useRef, useEffect, useCallback } from "react";
import { PitchTrace } from "./PitchTrace";
import { ResonanceMeter } from "./ResonanceMeter";
import { VocalWeightGauge } from "./VocalWeightGauge";
import { DEFAULT_PITCH_TARGET, DEFAULT_F2_TARGET } from "../utils/constants";
import db from "../db";

const FRAME_FLUSH_INTERVAL = 1000; // Flush buffered frames every 1s

export function CombinedDashboard({
  voiced,
  holding,
  pitch,
  formants,
  hnr,
  vocalWeight,
  modelStatus,
  modelError,
  modelProgress,
  pitchTraceRef,
  genderTraceRef,
  dspGateRef,
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

  // Re-entry guard for startRecording: `recording` state only flips
  // after the awaited db.sessions.add resolves, so a double-click (or a
  // slow IndexedDB open) could otherwise run startRecording twice —
  // orphaning the first session row and leaking its timer + flush
  // intervals (the refs get overwritten by the second call).
  const startingRef = useRef(false);

  // Flush buffered frames to IndexedDB
  const flushFrames = useCallback(async () => {
    const buffer = frameBufferRef.current;
    if (buffer.length === 0) return;
    frameBufferRef.current = [];
    try {
      // Explicit transaction so the flush is ATOMIC: on any failure the
      // whole transaction aborts and nothing persists, which is what
      // makes the re-queue below safe. A bare bulkAdd outside a
      // transaction commits its successful rows even when the call
      // rejects (Dexie BulkError semantics) — re-queueing after that
      // would insert the committed rows again under fresh auto-increment
      // ids, inflating frame counts and derived session stats.
      await db.transaction("rw", db.frames, () => db.frames.bulkAdd(buffer));
    } catch (err) {
      // Put the frames back at the head of the buffer (frames appended
      // during the await stay behind them, preserving order) so a
      // transient failure retries on the next flush instead of silently
      // dropping a second of session data.
      frameBufferRef.current = buffer.concat(frameBufferRef.current);
      console.error("Failed to write frames to IndexedDB:", err);
    }
  }, []);

  // Start recording
  const startRecording = useCallback(async () => {
    if (startingRef.current || sessionIdRef.current !== null) return;
    startingRef.current = true;
    try {
      const now = Date.now();
      recordingStartRef.current = now;

      // Read the audio-recording preference fresh at start time. The
      // toggle lives in the DataManagement overlay, which renders OVER
      // this still-mounted component — a value cached at mount goes
      // stale the moment the user flips the toggle, and the stale-ON
      // direction would keep recording mic audio against the user's
      // expressed setting.
      const settings = await db.settings.get("default");
      const recordAudio = !!settings?.recordAudio;

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
          // First supported container wins; Safari supports neither webm
          // variant (it records audio/mp4), and an unsupported explicit
          // mimeType makes the constructor throw — in that case fall
          // through to letting the browser pick its default.
          const mimeType = [
            "audio/webm;codecs=opus",
            "audio/webm",
            "audio/mp4",
          ].find((t) => MediaRecorder.isTypeSupported(t));
          const recorder = new MediaRecorder(
            streamRef.current,
            mimeType ? { mimeType } : undefined,
          );
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
    } finally {
      startingRef.current = false;
    }
  }, [frameCallbackRef, flushFrames, streamRef]);

  // notesRef tracks the latest notes value so the unmount cleanup can
  // finalize a session with the up-to-date text without depending on the
  // closure-captured value (which would re-run the effect on every keystroke).
  // Updated post-render via useEffect — React forbids mutating refs during
  // render (concurrent renders may abandon the render entirely).
  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; });

  // DB-only finalization (no React state writes). Used by both stopRecording
  // (button click) and the unmount cleanup, so an abandoned session — user
  // navigates away or stops the audio pipeline mid-record — still gets
  // endedAt + summary stats written. Sets sessionIdRef.current = null up
  // front so concurrent calls (button + unmount race) deduplicate.
  const finalizeRecordingDb = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    sessionIdRef.current = null;

    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (flushIntervalRef.current) { clearInterval(flushIntervalRef.current); flushIntervalRef.current = null; }
    frameCallbackRef.current = null;

    // Flush any remaining buffered frames before reading them back for stats.
    const buffered = frameBufferRef.current;
    if (buffered.length > 0) {
      frameBufferRef.current = [];
      try { await db.frames.bulkAdd(buffered); }
      catch (err) { console.error("Failed to flush frames:", err); }
    }

    // Stop audio recording and capture the blob.
    //
    // Two paths arrive here:
    //   1. Stop & Save button — recorder is still active, we call stop()
    //      and await onstop. The browser flushes any pending data via a
    //      final dataavailable event before firing onstop.
    //   2. Audio pipeline torn down first (Stop Listening, status→error,
    //      tab change unmount) — useAudioPipeline.stop() ends the mic
    //      tracks, the recorder auto-transitions to "inactive", and the
    //      browser dispatches its final dataavailable event before
    //      firing stop. By the time we run, audioChunksRef is fully
    //      populated and calling stop() on the inactive recorder would
    //      throw InvalidStateError.
    //
    // Earlier code gated blob assembly on state !== "inactive", which
    // meant path 2 lost its audio: recorder was already inactive, the
    // entire if-block was skipped, audioChunksRef discarded.
    let audioBlob = null;
    if (mediaRecorderRef.current) {
      const mimeType = mediaRecorderRef.current.mimeType || "audio/webm";
      if (mediaRecorderRef.current.state !== "inactive") {
        try {
          await new Promise((resolve) => {
            mediaRecorderRef.current.onstop = resolve;
            mediaRecorderRef.current.stop();
          });
        } catch (err) {
          console.error("Failed to stop MediaRecorder:", err);
        }
      }
      if (audioChunksRef.current.length > 0) {
        audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      }
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
    }

    const allFrames = await db.frames.where("sessionId").equals(sessionId).toArray();
    const endTime = Date.now();
    const startedAt = recordingStartRef.current;
    const durationSeconds = startedAt ? Math.round((endTime - startedAt) / 1000) : null;
    const summary = computeSummaryStats(allFrames);

    await db.sessions.update(sessionId, {
      endedAt: endTime,
      durationSeconds,
      notes: notesRef.current,
      audioBlob,
      ...summary,
    });

    recordingStartRef.current = null;

    // Announce completion so a SessionHistory that mounted DURING the
    // async finalize (tab switch away from the dashboard is exactly what
    // unmount-finalize means) re-queries and picks up the endedAt +
    // stats it read too early.
    window.dispatchEvent(new CustomEvent("syrinx:session-finalized"));
  }, [frameCallbackRef]);

  // Stop recording + compute summary stats (button-click path).
  const stopRecording = useCallback(async () => {
    await finalizeRecordingDb();
    setRecording(false);
  }, [finalizeRecordingDb]);

  // Stash the latest finalize fn in a ref so the unmount cleanup can call
  // it without re-subscribing the cleanup useEffect on every render.
  // Updated post-render — see notesRef above for why mutating during
  // render is unsafe.
  const finalizeRef = useRef(finalizeRecordingDb);
  useEffect(() => { finalizeRef.current = finalizeRecordingDb; });

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
      // Fire-and-forget: finalize any in-progress recording so the DB row
      // gets endedAt + stats. Tab-close may not flush IndexedDB, but
      // tab-switch / stop-listening keeps the page alive long enough.
      finalizeRef.current?.();
    };
  }, [frameCallbackRef]);

  // "Delete all data" (DataManagement overlay) aborts — not finalizes —
  // any in-progress recording: the session row is about to be wiped, so
  // finalizing would just write into the void while the flush interval
  // keeps attaching frames to a deleted session id. Drop everything
  // in-memory and reset the UI.
  useEffect(() => {
    const abort = () => {
      if (sessionIdRef.current === null) return;
      sessionIdRef.current = null;
      frameBufferRef.current = [];
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (flushIntervalRef.current) { clearInterval(flushIntervalRef.current); flushIntervalRef.current = null; }
      if (frameCallbackRef) frameCallbackRef.current = null;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try { mediaRecorderRef.current.stop(); } catch { /* already stopping */ }
      }
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
      recordingStartRef.current = null;
      setRecording(false);
      setElapsed(0);
    };
    window.addEventListener("syrinx:abort-recording", abort);
    return () => window.removeEventListener("syrinx:abort-recording", abort);
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

        {/* Resonance meter (vertical thermometer) — 50%.
            The meter reads its score directly from genderTraceRef each
            frame, so we don't pass genderScore/genderConfidence as
            props (those go through useAudioPipeline's throttledSetState
            and would lag — see the meter's header comment). */}
        <div className="lg:w-1/2 min-h-[260px] lg:min-h-0">
          <ResonanceMeter
            genderTraceRef={genderTraceRef}
            dspGateRef={dspGateRef}
            modelStatus={modelStatus}
            modelProgress={modelProgress}
            modelError={modelError}
          />
        </div>
      </div>

      {/* Live stats — columnar layout: F0 | F2 + VocalWeight | HNR.
          Perceived voice is shown by the thermometer above. */}
      <div className="flex-shrink-0 mt-3 px-2">
        <div className="flex items-end justify-center gap-x-3 sm:gap-x-6">
          {/* Column 1: F0 value */}
          <div className={`text-center shrink-0 pb-3 ${statOpacity} transition-opacity duration-300`}>
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
            <VocalWeightGauge
              vocalWeight={vocalWeight}
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

  // Estimate voiced duration. DSP analysis runs once per chunk arrival
  // (default chunkMs = 25), not once per WINDOW_MS — so frames are ~25 ms
  // apart in steady state. The earlier 50 ms constant double-counted.
  const frameDurationMs = 25;
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
    // reduce instead of Math.min(...arr) — the spread operator can overflow
    // engine arg-count limits on long sessions (60+ minutes of voiced
    // frames at ~40 fps = >100K args).
    pitchRangeLow: f0Values.length ? f0Values.reduce((m, v) => v < m ? v : m, Infinity) : null,
    pitchRangeHigh: f0Values.length ? f0Values.reduce((m, v) => v > m ? v : m, -Infinity) : null,
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
