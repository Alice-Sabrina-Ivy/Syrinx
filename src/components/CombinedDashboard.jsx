// CombinedDashboard.jsx — Default practice view: pitch trace + resonance
// thermometer side by side (stacked on mobile), with vocal-weight + HNR
// stats + session controls below. Handles session recording: buffers
// frames and writes to IndexedDB every ~1s.
//
// App keeps this component mounted for the whole time the pipeline runs
// (so a recording survives switching to the Pitch / History tabs) and
// passes active=false while another tab is showing: it then renders
// nothing — the canvases unmount, so no rAF loops run hidden, and they
// remount + size themselves fresh from the live refs when shown again —
// while the recording state, timer, and flush interval keep running.

import { useState, useRef, useEffect, useCallback } from "react";
import { PitchTrace } from "./PitchTrace";
import { ResonanceMeter } from "./ResonanceMeter";
import { VocalWeightGauge } from "./VocalWeightGauge";
import { SteadinessReadout } from "./SteadinessReadout";
import { DEFAULT_PITCH_TARGET, DEFAULT_F2_TARGET } from "../utils/constants";
import { computeSummaryStats } from "../utils/sessionStats";
import { holdRecordingLock } from "../utils/sessionRepair";
import db from "../db";

const FRAME_FLUSH_INTERVAL = 1000; // Flush buffered frames every 1s

export function CombinedDashboard({
  active = true,
  voiced,
  holding,
  pitch,
  steadiness,
  steadinessHeld,
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
  // Shown under the session controls when a recording can't start
  // (IndexedDB unavailable — site data blocked, some private modes).
  const [recordError, setRecordError] = useState(null);
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

  // Releases the "recording in progress" Web Lock for the current session
  // (see sessionRepair.js — another tab's start-up repair skips sessions
  // whose lock is held, so a live recording is never "repaired").
  const releaseLockRef = useRef(null);

  // Re-entry guard for startRecording: `recording` state only flips
  // after the awaited db.sessions.add resolves, so a double-click (or a
  // slow IndexedDB open) could otherwise run startRecording twice —
  // orphaning the first session row and leaking its timer + flush
  // intervals (the refs get overwritten by the second call).
  const startingRef = useRef(false);

  // Same guard for stopRecording: `recording` stays true (button still
  // reads "Stop & Save") for the whole async finalize — a frames
  // read-back that takes hundreds of ms on a long session. A second
  // click would otherwise run stopRecording again: its finalize returns
  // early, it clears the notes before the first finalize has written
  // them, and a third click could start a new recording mid-finalize.
  // `stopping` mirrors the ref for rendering (button disabled, "Saving…").
  const stoppingRef = useRef(false);
  const [stopping, setStopping] = useState(false);

  // False once the dashboard unmounts (pipeline stopped / errored).
  // startRecording awaits IndexedDB twice before it installs the frame
  // callback, intervals and MediaRecorder; an unmount during those awaits
  // finds nothing to finalize yet, so startRecording must notice and back
  // out itself — otherwise it leaks the intervals + a frame callback and
  // may start a MediaRecorder on the already-stopped stream.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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
    if (startingRef.current || stoppingRef.current || sessionIdRef.current !== null) return;
    startingRef.current = true;
    setRecordError(null);
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
      if (!mountedRef.current) return;
      const recordAudio = !!settings?.recordAudio;

      // Create session in DB
      const id = await db.sessions.add({
        startedAt: now,
        sessionType: "freeform",
        notes: "",
      });
      if (!mountedRef.current) {
        // Unmounted while the row was being created: nothing will ever
        // finalize it, so remove it instead of leaving an empty session.
        db.sessions.delete(id).catch((err) => console.error("Failed to remove abandoned session:", err));
        return;
      }
      sessionIdRef.current = id;
      releaseLockRef.current = holdRecordingLock(id);

      // Set up frame callback
      frameCallbackRef.current = (frame) => {
        const ts = Date.now() - recordingStartRef.current;
        frameBufferRef.current.push({
          sessionId: sessionIdRef.current,
          timestampMs: ts,
          voiced: frame.voiced,
          f0: frame.f0,
          // Live-trace paint decision (non-indexed field: no Dexie schema
          // bump). SessionHistory draws its trace from painted frames.
          painted: frame.painted,
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
    } catch (err) {
      // Only the two IndexedDB awaits above can reject, and both run
      // before anything is installed — nothing to unwind, just say so
      // instead of an unhandled rejection and a button that does nothing.
      console.error("Failed to start recording:", err);
      if (mountedRef.current) {
        setRecordError("Couldn't start recording — session storage is unavailable in this browser.");
      }
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
  // Resolves true only for the call that actually finalized.
  const finalizeRecordingDb = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return false;
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
    //   2. Audio pipeline torn down first (Stop Listening, status→error
    //      unmount) — useAudioPipeline.stop() ends the mic
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
    releaseLockRef.current?.();
    releaseLockRef.current = null;

    // Announce completion so a SessionHistory that loaded DURING the
    // async finalize re-queries and picks up the endedAt + stats it read
    // too early.
    window.dispatchEvent(new CustomEvent("syrinx:session-finalized"));
    return true;
  }, [frameCallbackRef]);

  // Stop recording + compute summary stats (button-click path).
  const stopRecording = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setStopping(true);
    try {
      // The notes now live on the finalized session row — clear the
      // input so they don't carry into the next session. Only after a
      // successful finalize by THIS call: on failure the text stays put.
      if (await finalizeRecordingDb()) setNotes("");
    } finally {
      // finalize tore the recording down (intervals, frame callback)
      // before anything could throw — never leave the button on
      // "Stop & Save" for a recording that no longer exists.
      stoppingRef.current = false;
      if (mountedRef.current) {
        setStopping(false);
        setRecording(false);
      }
    }
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
  // in-memory and reset the UI. Deleting the in-progress session itself
  // from History (reachable mid-recording now that tab switches don't
  // end it) sends the same event with detail.sessionId; other sessions'
  // deletes leave the recording alone.
  useEffect(() => {
    const abort = (e) => {
      if (sessionIdRef.current === null) return;
      const target = e?.detail?.sessionId;
      if (target != null && target !== sessionIdRef.current) return;
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
      releaseLockRef.current?.();
      releaseLockRef.current = null;
      setRecording(false);
      setElapsed(0);
      setNotes(""); // the session they annotated is gone
    };
    window.addEventListener("syrinx:abort-recording", abort);
    return () => window.removeEventListener("syrinx:abort-recording", abort);
  }, [frameCallbackRef]);

  // Page going away (tab close, navigation) or into the background (where
  // mobile browsers may discard it without another event): flush the
  // buffered frames, best-effort, so the start-up repair
  // (sessionRepair.js) has them. Deliberately NOT a finalize — a mobile
  // tab switch fires visibilitychange→hidden and is not the end of the
  // session.
  useEffect(() => {
    const flushIfRecording = () => {
      if (sessionIdRef.current !== null) flushFrames();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushIfRecording();
    };
    window.addEventListener("pagehide", flushIfRecording);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushIfRecording);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushFrames]);

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

  // Another tab is showing: stay mounted (recording continues), render
  // nothing. After all hooks — the hook order must not change.
  if (!active) return null;

  return (
    // min-h-0 only at lg: below lg the parent scrolls, and these must not
    // shrink below their content (shrinking is what let the traces row
    // overflow onto the stats + session controls).
    <div className="flex-1 flex flex-col w-full max-w-6xl lg:min-h-0">
      {/* Two scrolling traces: pitch (left) + resonance (right), stacked on mobile */}
      <div className="lg:flex-1 flex flex-col lg:flex-row gap-3 lg:min-h-0">
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

      {/* Live stats — columnar layout: F0 + steadiness | F2 + VocalWeight | HNR.
          Perceived voice is shown by the thermometer above. */}
      <div className="flex-shrink-0 mt-3 px-2">
        <div className="flex items-end justify-center gap-x-3 sm:gap-x-6">
          {/* Column 1: F0 value + pitch steadiness (last ~1 s) */}
          <div className="text-center shrink-0">
            <div className={`${statOpacity} transition-opacity duration-300`}>
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
            <div className="mt-0.5">
              <SteadinessReadout value={steadiness} held={steadinessHeld} />
            </div>
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
              disabled={stopping}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium transition-colors cursor-pointer border disabled:opacity-60 disabled:cursor-wait ${
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
              {stopping ? "Saving…" : recording ? "Stop & Save" : "Save Session"}
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
        {recordError && (
          <p role="alert" className="text-xs text-red-400 text-center mt-2">{recordError}</p>
        )}
      </div>
    </div>
  );
}
