// useAudioPipeline.js — Hook that connects: mic → AudioWorklet → DSP Worker → React state
// Handles mic permission, AudioContext setup, result smoothing, and silence gating.
// Exposes history refs for canvas-based visualizations.

import { useState, useRef, useCallback, useEffect } from "react";
import { hzToNote } from "../utils/pitchUtils";
import {
  SILENCE_HOLD_MS,
  PITCH_TRACE_SECONDS,
  FORMANT_TRAIL_SECONDS,
} from "../utils/constants";

const SILENCE_THRESHOLD_DB = -50;
const SILENCE_DEBOUNCE_FRAMES = 3; // require 3 consecutive quiet frames before gating
const PITCH_SMOOTH_LEN = 3;
const FORMANT_SMOOTH_LEN = 5;

export function useAudioPipeline() {
  const [state, setState] = useState({
    status: "idle",
    error: null,
    voiced: false,
    holding: false,
    pitch: null,
    intensity: null,
    noteName: null,
    formants: { f1: null, f2: null, f3: null },
    spectralTilt: null,
    hnr: null,
  });

  // Latency diagnostic state (temporary — visible on page for debugging)
  const [diag, setDiag] = useState({
    messageLatencyMs: 0,     // worker send → main thread receive
    workerProcessingMs: 0,   // time spent in processChunk
    pendingChunks: 0,        // chunks queued in worker
    baseLatency: 0,          // AudioContext.baseLatency
    outputLatency: 0,        // AudioContext.outputLatency
    sampleRate: 0,           // actual AudioContext sample rate
  });

  // Throttle setState to reduce React renders on mobile.
  // Canvas animations read from refs at full rAF rate; setState only drives
  // the text readouts (F0, F2, HNR, etc.) which don't need >5fps.
  const lastStateUpdateRef = useRef(0);
  const STATE_UPDATE_INTERVAL = 200; // ms (~5fps for text readouts)
  const lastDiagUpdateRef = useRef(0);
  const DIAG_UPDATE_INTERVAL = 500; // ms (~2fps for diagnostic panel)

  const audioCtxRef = useRef(null);
  const workerRef = useRef(null);
  const streamRef = useRef(null);
  const workletNodeRef = useRef(null);
  const sourceNodeRef = useRef(null);

  // Smoothing buffers
  const pitchSmoothRef = useRef([]);
  const f1SmoothRef = useRef([]);
  const f2SmoothRef = useRef([]);
  const f3SmoothRef = useRef([]);

  // Silence gating
  const silenceStartRef = useRef(null);
  const quietFrameCountRef = useRef(0);
  const lastVoicedRef = useRef({
    pitch: null,
    noteName: null,
    formants: { f1: null, f2: null, f3: null },
    spectralTilt: null,
    hnr: null,
  });

  // History buffers for canvas visualizations (read directly by rAF loops)
  const pitchTraceRef = useRef([]);
  const formantTrailRef = useRef([]);

  useEffect(() => {
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    if (audioCtxRef.current) return;

    setState((s) => ({ ...s, status: "requesting", error: null }));

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      await audioCtx.audioWorklet.addModule("capture-processor.js");
      const workletNode = new AudioWorkletNode(audioCtx, "capture-processor");
      workletNodeRef.current = workletNode;

      const worker = new Worker(
        new URL("../dsp/dsp-worker.js", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      worker.postMessage({ type: "init", sampleRate: audioCtx.sampleRate });

      // Create a direct MessagePort between the AudioWorklet and the DSP
      // Worker so audio chunks bypass the main thread entirely.  Without
      // this, every chunk relays through the main-thread event loop, which
      // stalls when React renders saturate it (especially at steady pitch).
      const channel = new MessageChannel();
      workletNode.port.postMessage(
        { type: "port", port: channel.port1 },
        [channel.port1],
      );
      worker.postMessage(
        { type: "port", port: channel.port2 },
        [channel.port2],
      );

      worker.onmessage = (e) => {
        if (e.data.type === "analysis") {
          const data = e.data.data;
          // Always update refs immediately (canvas reads these at full rAF rate)
          handleAnalysisResult(data);
          // Throttle diagnostic setState to ~2fps (avoid render pressure)
          const diagNow = performance.now();
          if (diagNow - lastDiagUpdateRef.current >= DIAG_UPDATE_INTERVAL) {
            lastDiagUpdateRef.current = diagNow;
            const receiveAbsolute = performance.timeOrigin + diagNow;
            const messageLatencyMs = receiveAbsolute - data.absoluteTime;
            setDiag({
              messageLatencyMs: Math.round(messageLatencyMs * 10) / 10,
              workerProcessingMs: Math.round((data.workerProcessingMs || 0) * 10) / 10,
              pendingChunks: data.pendingChunks || 0,
              baseLatency: Math.round((audioCtx.baseLatency || 0) * 1000 * 10) / 10,
              outputLatency: Math.round((audioCtx.outputLatency || 0) * 1000 * 10) / 10,
              sampleRate: audioCtx.sampleRate,
            });
          }
        }
      };

      // Connect worklet to destination via a muted gain node.
      // Without this, the browser may stop calling process() on the
      // AudioWorklet because its output "isn't consumed" (no path to
      // destination). This is per spec — the UA may skip processing
      // for nodes whose output isn't reachable from the destination.
      const muteNode = audioCtx.createGain();
      muteNode.gain.value = 0;
      workletNode.connect(muteNode);
      muteNode.connect(audioCtx.destination);

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(workletNode);
      sourceNodeRef.current = source;

      setState((s) => ({ ...s, status: "running" }));
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err.message || "Microphone access denied",
      }));
    }
  }, []);

  const stop = useCallback(() => {
    // Disconnect audio nodes before closing context
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    pitchSmoothRef.current = [];
    f1SmoothRef.current = [];
    f2SmoothRef.current = [];
    f3SmoothRef.current = [];
    silenceStartRef.current = null;
    quietFrameCountRef.current = 0;
    pitchTraceRef.current = [];
    formantTrailRef.current = [];
    setState({
      status: "idle",
      error: null,
      voiced: false,
      holding: false,
      pitch: null,
      intensity: null,
      noteName: null,
      formants: { f1: null, f2: null, f3: null },
      spectralTilt: null,
      hnr: null,
    });
  }, []);

  // Throttled setState: only fires at STATE_UPDATE_INTERVAL to avoid
  // saturating the main thread with React renders on mobile.
  // Canvas animations read from refs at full rAF rate (unaffected).
  function throttledSetState(updater) {
    const now = performance.now();
    if (now - lastStateUpdateRef.current >= STATE_UPDATE_INTERVAL) {
      lastStateUpdateRef.current = now;
      setState(updater);
    }
  }

  function handleAnalysisResult(data) {
    const { pitch, intensity, formants, spectralTilt, hnr, absoluteTime } = data;
    // Use the worker's absolute timestamp (timeOrigin + performance.now()).
    // This reflects when audio was actually *analyzed*, not when the main
    // thread got around to handling the message.  Using absolute time from
    // the worker avoids clock skew between worker and main thread
    // performance.now() origins (which can differ by seconds on mobile).
    const now = Math.round(absoluteTime);

    // Silence = intensity below threshold for multiple consecutive frames.
    // Single-frame dips (from GC pauses or audio glitches) are bridged.
    // Pitch detection failure during loud audio is NOT silence.
    const frameQuiet = intensity < SILENCE_THRESHOLD_DB;
    const hasPitch = pitch !== null;

    if (frameQuiet) {
      quietFrameCountRef.current++;
    } else {
      quietFrameCountRef.current = 0;
    }

    const isQuiet = quietFrameCountRef.current >= SILENCE_DEBOUNCE_FRAMES;

    if (isQuiet) {
      // Record silence start time
      if (silenceStartRef.current === null) {
        silenceStartRef.current = now;
      }

      const silenceDuration = now - silenceStartRef.current;

      // Add gap to pitch trace (null pitch = gap)
      pitchTraceRef.current.push({ time: now, pitch: null, voiced: false });
      trimHistory(pitchTraceRef.current, PITCH_TRACE_SECONDS * 1000, now);

      if (silenceDuration < SILENCE_HOLD_MS) {
        // Hold last voiced values (display goes to reduced opacity)
        const held = lastVoicedRef.current;
        throttledSetState((s) => ({
          ...s,
          voiced: false,
          holding: true,
          pitch: held.pitch,
          intensity,
          noteName: held.noteName,
          formants: held.formants,
          spectralTilt: held.spectralTilt,
          hnr: held.hnr,
        }));
      } else {
        // Prolonged silence: clear everything
        pitchSmoothRef.current = [];
        f1SmoothRef.current = [];
        f2SmoothRef.current = [];
        f3SmoothRef.current = [];
        throttledSetState((s) => ({
          ...s,
          voiced: false,
          holding: false,
          pitch: null,
          intensity,
          noteName: null,
          formants: { f1: null, f2: null, f3: null },
          spectralTilt: null,
          hnr: null,
        }));
      }
      return;
    }

    // Audio is above silence threshold — treat as voiced
    silenceStartRef.current = null;

    // Use detected pitch, or hold last smoothed pitch across detection gaps
    const effectivePitch = hasPitch
      ? pitch
      : (pitchSmoothRef.current.length > 0
        ? pitchSmoothRef.current[pitchSmoothRef.current.length - 1]
        : null);

    if (effectivePitch === null) {
      // No pitch history to hold — treat as gap
      pitchTraceRef.current.push({ time: now, pitch: null, voiced: false });
      trimHistory(pitchTraceRef.current, PITCH_TRACE_SECONDS * 1000, now);
      return;
    }

    // Smooth pitch with rolling median (only push new detections, not held values)
    const smoothedPitch = hasPitch
      ? pushAndMedian(pitchSmoothRef, pitch, PITCH_SMOOTH_LEN)
      : median(pitchSmoothRef.current);

    // Smooth formants with rolling median — hold last valid value on null frames
    const f1 = formants?.f1
      ? pushAndMedian(f1SmoothRef, formants.f1, FORMANT_SMOOTH_LEN)
      : median(f1SmoothRef.current);
    const f2 = formants?.f2
      ? pushAndMedian(f2SmoothRef, formants.f2, FORMANT_SMOOTH_LEN)
      : median(f2SmoothRef.current);
    const f3 = formants?.f3
      ? pushAndMedian(f3SmoothRef, formants.f3, FORMANT_SMOOTH_LEN)
      : median(f3SmoothRef.current);

    const noteInfo = hzToNote(smoothedPitch);
    const noteName = noteInfo?.name || null;
    const smoothedFormants = { f1, f2, f3 };

    // Update history buffers (always, at full rate — canvas reads these)
    pitchTraceRef.current.push({
      time: now,
      pitch: smoothedPitch,
      voiced: true,
    });
    trimHistory(pitchTraceRef.current, PITCH_TRACE_SECONDS * 1000, now);

    if (f1 !== null && f2 !== null) {
      formantTrailRef.current.push({ time: now, f1, f2, voiced: true });
      trimHistory(formantTrailRef.current, FORMANT_TRAIL_SECONDS * 1000, now);
    }

    // Use new values when provided, otherwise hold previous
    const currentTilt = spectralTilt ?? lastVoicedRef.current.spectralTilt;
    const currentHnr = hnr ?? lastVoicedRef.current.hnr;

    // Save as last voiced values (for hold behavior)
    lastVoicedRef.current = {
      pitch: smoothedPitch,
      noteName,
      formants: smoothedFormants,
      spectralTilt: currentTilt,
      hnr: currentHnr,
    };

    // Throttled: only update React state for text readouts at ~5fps
    throttledSetState((s) => ({
      ...s,
      voiced: true,
      holding: false,
      pitch: smoothedPitch,
      intensity,
      noteName,
      formants: smoothedFormants,
      spectralTilt: currentTilt,
      hnr: currentHnr,
    }));
  }

  return {
    ...state,
    diag,
    start,
    stop,
    pitchTraceRef,
    formantTrailRef,
  };
}

function pushAndMedian(ref, value, maxLen) {
  ref.current.push(value);
  if (ref.current.length > maxLen) ref.current.shift();
  return median(ref.current);
}

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function trimHistory(arr, maxAgeMs, now) {
  const cutoff = now - maxAgeMs;
  while (arr.length > 0 && arr[0].time < cutoff) {
    arr.shift();
  }
}
