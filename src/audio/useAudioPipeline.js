// useAudioPipeline.js — Hook that connects: mic → AudioWorklet → DSP Worker → React state
// Handles mic permission, AudioContext setup, result smoothing, and silence gating.
// Exposes history refs for canvas-based visualizations.

import { useState, useRef, useCallback, useEffect } from "react";
import { hzToNote } from "../utils/pitchUtils";
import {
  SILENCE_HOLD_MS,
  PITCH_TRACE_SECONDS,
  RESONANCE_TRACE_SECONDS,
} from "../utils/constants";
import {
  pushAndMedianPitch,
  PITCH_SMOOTH_LEN,
} from "./pitchSmoothing";
import { DIAG_ENABLED, setAudioInfo, pushFrame } from "../diag/diag";

const SILENCE_THRESHOLD_DB = -50;
const SILENCE_DEBOUNCE_FRAMES = 3; // require 3 consecutive quiet frames before gating
const FORMANT_SMOOTH_LEN = 7;
const FORMANT_OUTLIER_HZ = 500; // max plausible frame-to-frame formant jump

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
    genderScore: null,        // 0-100 from ML worker, null until first inference
    genderConfidence: null,
    modelStatus: "idle",       // idle | loading | ready | error
    modelError: null,
    modelProgress: null,       // { loaded, total, file } during download
  });

  // Throttle setState to reduce React renders on mobile.
  // Canvas animations read from refs at full rAF rate; setState only drives
  // the text readouts (F0, F2, HNR, etc.) which don't need >5fps.
  const lastStateUpdateRef = useRef(0);
  const STATE_UPDATE_INTERVAL = 200; // ms (~5fps for text readouts)

  const audioCtxRef = useRef(null);
  const workerRef = useRef(null);
  const mlWorkerRef = useRef(null);
  const streamRef = useRef(null);
  const workletNodeRef = useRef(null);
  const sourceNodeRef = useRef(null);

  // Gender-score history for the trace canvas. Each entry:
  // { time: <ms epoch>, score: 0-100, confidence: 0-1 }
  // Trimmed to the last RESONANCE_TRACE_SECONDS.
  const genderTraceRef = useRef([]);

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

  // Optional callback for session recording — called with every analysis frame
  const frameCallbackRef = useRef(null);

  useEffect(() => {
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    // If a previous AudioContext was closed (e.g. via stop()), discard the
    // stale reference so we create a fresh one. A closed AudioContext cannot
    // be resumed — the spec requires a new instance.
    if (audioCtxRef.current && audioCtxRef.current.state === "closed") {
      audioCtxRef.current = null;
    }
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

      const audioCtx = new AudioContext({ latencyHint: "interactive" });
      audioCtxRef.current = audioCtx;
      const ctxCreatedAtEpochMs = performance.timeOrigin + performance.now();
      await audioCtx.audioWorklet.addModule("capture-processor.js");
      const workletNode = new AudioWorkletNode(audioCtx, "capture-processor");
      workletNodeRef.current = workletNode;

      // Diagnostic snapshot of the audio context, captured once at start.
      // Read here rather than later because some browsers may not let us
      // re-introspect granted constraints after the track has been used.
      if (DIAG_ENABLED) {
        const trackSettings = stream.getAudioTracks()[0]?.getSettings?.() ?? null;
        setAudioInfo({
          sampleRate: audioCtx.sampleRate,
          baseLatencySec: audioCtx.baseLatency ?? null,
          outputLatencySec: audioCtx.outputLatency ?? null,
          ctxCreatedAtEpochMs,
          // AudioWorklet support is the modern path. If addModule above
          // succeeded we got it; if not we'd have thrown earlier. Surface
          // the explicit confirmation so a failed-fallback case (some old
          // mobile browsers) is visible in the snapshot.
          audioWorkletSupported: typeof AudioWorkletNode !== "undefined",
          // Track settings reflect what the platform actually granted vs
          // what we requested in getUserMedia (echoCancellation: false etc.).
          // Mobile browsers may silently override these.
          requestedConstraints: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          grantedConstraints: trackSettings,
          userAgent: navigator.userAgent,
        });
        // Tell the AudioWorklet to attach postedAt timestamps. Sent
        // before the port message so the worklet's diag flag is set
        // before any chunk leaves it.
        workletNode.port.postMessage({ type: "init", diag: true });
      }

      const worker = new Worker(
        new URL("../dsp/dsp-worker.js", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      worker.postMessage({
        type: "init",
        sampleRate: audioCtx.sampleRate,
        ...(DIAG_ENABLED ? { diag: true } : {}),
      });

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

      // ML inference worker. Hosts a Transformers.js pipeline that emits
      // a perceived-gender score (0-100) on a rolling 2-sec audio window.
      // Audio is forked from the same AudioWorklet via a second MessagePort.
      const mlWorker = new Worker(
        new URL("../ml/gender-worker.js", import.meta.url),
        { type: "module" },
      );
      mlWorkerRef.current = mlWorker;
      mlWorker.postMessage({
        type: "init",
        inputSampleRate: audioCtx.sampleRate,
      });

      const mlChannel = new MessageChannel();
      workletNode.port.postMessage(
        { type: "port", port: mlChannel.port1 },
        [mlChannel.port1],
      );
      mlWorker.postMessage(
        { type: "audioPort", port: mlChannel.port2 },
        [mlChannel.port2],
      );

      mlWorker.onmessage = (e) => {
        const msg = e.data;
        if (!msg || !msg.type) return;
        if (msg.type === "score") {
          const entry = { time: Math.round(msg.ts), score: msg.score, confidence: msg.confidence };
          genderTraceRef.current.push(entry);
          trimHistory(genderTraceRef.current, RESONANCE_TRACE_SECONDS * 1000, entry.time);
          throttledSetState((s) => ({
            ...s,
            genderScore: msg.score,
            genderConfidence: msg.confidence,
          }));
        } else if (msg.type === "status") {
          setState((s) => ({
            ...s,
            modelStatus: msg.status,
            modelError: msg.message ?? null,
          }));
        } else if (msg.type === "progress") {
          setState((s) => ({
            ...s,
            modelProgress: { loaded: msg.loaded, total: msg.total, file: msg.file },
          }));
        }
      };

      worker.onmessage = (e) => {
        if (e.data.type === "analysis") {
          const data = e.data.data;
          // Diagnostic mode: capture timing breakpoints around the
          // analysis-handler call. handoffToMainMs is DSP postMessage
          // (postedAtEpochMs) → main onmessage entry (now). mainHandlerMs
          // is the time inside handleAnalysisResult. totalMs is the
          // wall-clock from "audio captured" (ctx time → epoch via
          // ctxCreatedAtEpochMs) to display update completion.
          if (DIAG_ENABLED && data.diag) {
            const handlerStart = performance.timeOrigin + performance.now();
            const handoffToMainMs =
              typeof data.diag.postedAtEpochMs === "number"
                ? handlerStart - data.diag.postedAtEpochMs
                : null;
            handleAnalysisResult(data);
            const handlerEnd = performance.timeOrigin + performance.now();
            const audioCapturedEpochMs =
              typeof data.contextTime === "number" && ctxCreatedAtEpochMs
                ? ctxCreatedAtEpochMs + data.contextTime * 1000
                : null;
            pushFrame({
              tEpochMs: data.absoluteTime,
              pitch: data.pitch,
              intensity: data.intensity,
              inputRms: data.diag.inputRms,
              voicedness: data.voicedness,
              voicednessObs: data.diag.voicednessObs,
              pendingChunks: data.pendingChunks,
              timings: {
                chunkArrivalMs: data.diag.chunkArrivalMs,
                pitchDetectMs: data.diag.pitchDetectMs,
                workerProcessingMs: data.workerProcessingMs,
                handoffToMainMs,
                mainHandlerMs: handlerEnd - handlerStart,
                totalMs: audioCapturedEpochMs
                  ? handlerEnd - audioCapturedEpochMs
                  : null,
              },
            });
          } else {
            handleAnalysisResult(data);
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
    if (mlWorkerRef.current) {
      mlWorkerRef.current.terminate();
      mlWorkerRef.current = null;
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
    genderTraceRef.current = [];
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
      genderScore: null,
      genderConfidence: null,
      modelStatus: "idle",
      modelError: null,
      modelProgress: null,
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
    // Use the worker's absolute timestamp for data points.
    // This reflects when audio was *analyzed* in the worker, which is the
    // true event time.  The draw loop also uses absoluteTime-based clocks,
    // and clockOffset between worker and main thread is ~0ms.
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
      // Notify frame callback (session recording) even during silence
      if (frameCallbackRef.current) {
        frameCallbackRef.current({
          voiced: false, f0: null, f1: null, f2: null, f3: null,
          intensity, spectralTilt: null, hnr: null,
        });
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

    // Smooth pitch with a harmonic-aware rolling median: when YIN briefly
    // locks on 2·f0 or 3·f0 (typically when a strong formant amplifies a
    // higher harmonic), reconcile the value back to the fundamental
    // before the median pass. Only new detections are pushed — held
    // values (when YIN returned null but audio is still loud enough)
    // don't enter the buffer so they can't stale-shift the median.
    const smoothedPitch = hasPitch
      ? pushAndMedianPitch(pitchSmoothRef.current, pitch, PITCH_SMOOTH_LEN)
      : median(pitchSmoothRef.current);

    // Smooth formants with rolling median + outlier rejection.
    // Discard values that jump more than FORMANT_OUTLIER_HZ from the
    // current median — such spikes are measurement artifacts, not real
    // vocal tract changes.
    const f1 = formants?.f1
      ? pushAndMedianGated(f1SmoothRef, formants.f1, FORMANT_SMOOTH_LEN, FORMANT_OUTLIER_HZ)
      : median(f1SmoothRef.current);
    const f2 = formants?.f2
      ? pushAndMedianGated(f2SmoothRef, formants.f2, FORMANT_SMOOTH_LEN, FORMANT_OUTLIER_HZ)
      : median(f2SmoothRef.current);
    const f3 = formants?.f3
      ? pushAndMedianGated(f3SmoothRef, formants.f3, FORMANT_SMOOTH_LEN, FORMANT_OUTLIER_HZ)
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
      formantTrailRef.current.push({ time: now, f1, f2, f3: f3, voiced: true });
      trimHistory(formantTrailRef.current, RESONANCE_TRACE_SECONDS * 1000, now);
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

    // Notify frame callback (session recording) with smoothed values
    if (frameCallbackRef.current) {
      frameCallbackRef.current({
        voiced: true,
        f0: smoothedPitch,
        f1: f1,
        f2: f2,
        f3: f3,
        intensity,
        spectralTilt: currentTilt,
        hnr: currentHnr,
      });
    }

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
    start,
    stop,
    pitchTraceRef,
    formantTrailRef,
    genderTraceRef,
    frameCallbackRef,
    streamRef,
  };
}

function pushAndMedianGated(ref, value, maxLen, maxJump) {
  const current = median(ref.current);
  // If buffer is empty, accept any value
  if (current === null) {
    ref.current.push(value);
    return value;
  }
  // Clamp outliers toward the current median so the buffer can drift
  // toward the true value instead of getting permanently stuck
  const delta = value - current;
  const clamped = Math.abs(delta) > maxJump
    ? current + Math.sign(delta) * maxJump
    : value;
  ref.current.push(clamped);
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
