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
import { createCaptureSource } from "./captureSource";
import {
  DIAG_ENABLED,
  DIAG_SR_OVERRIDE,
  DIAG_LATENCY_HINT,
  DIAG_NO_LATENCY_CONSTRAINT,
  DIAG_CHUNK_MS_OVERRIDE,
  DIAG_LATENCY_EXACT,
  DIAG_CAPTURE_KIND,
  setAudioInfo,
  setAudioCtxSample,
  pushFrame,
  setCaptureStatus,
  setWorkerStatus,
  pushError,
  pushMlInference,
  setMlModel,
} from "../diag/diag";

const SILENCE_THRESHOLD_DB = -50;
const SILENCE_DEBOUNCE_FRAMES = 3; // require 3 consecutive quiet frames before gating
// Voicedness gate for the UI. The DSP worker's HMM-smoothed posterior
// (data.voicedness ∈ [0, 1]) is ~0.5 on silence (uniform Bayesian
// fallback), > 0.5 on real voiced speech, < 0.5 on unvoiced loud noise
// (AC, fans). The intensity gate alone passes broadband loud noise, so
// the UI rendered phantom pitch readings while ambient noise was loud
// but not voiced — this gate filters those out. 0.5 is the prior, so
// frames at-or-below the prior have NO net evidence of voicing and we
// treat them as quiet. Stage 0 / Stage 1 of pYIN don't compute
// voicedness (data.voicedness is null) — the typeof check keeps those
// stages on intensity-only gating, preserving harness compatibility.
const VOICEDNESS_THRESHOLD = 0.5;
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

  const audioCtxRef = useRef(null);          // null on MSTP path
  const captureSrcRef = useRef(null);        // unified handle from captureSource factory
  const workerRef = useRef(null);
  const mlWorkerRef = useRef(null);
  const streamRef = useRef(null);
  // Periodic AudioContext state sampler interval — set up in start(),
  // cleared in stop(). Diag-mode-only; the ref stays null in production.
  const ctxSamplerRef = useRef(null);

  // Gender-score history for the trace canvas. Each entry:
  // { time: <ms epoch>, score: 0-100, confidence: 0-1, voiced: bool }
  // Trimmed to the last RESONANCE_TRACE_SECONDS. The `voiced` field
  // captures the DSP voicedness gate's state at the moment the ML score
  // was emitted — so the history strip can filter out dots produced
  // during DSP-detected non-voice (ambient noise, breath, etc.). Without
  // this, the strip's 6 s retention overlaps the 5 s silence-hold,
  // producing a 1 s window of stale colored dots after the bar/indicator
  // have blanked. (Codex finding on PR #70.)
  const genderTraceRef = useRef([]);

  // Mirror of the latest DSP gate state, updated each analysis frame.
  // The mlWorker.onmessage handler runs on a different cadence than DSP
  // (ML 6.7 Hz, DSP ~40 Hz) and is a closure that doesn't see React
  // state updates in real time; the ref bridges them so each ML score
  // can be tagged with the DSP gate's current verdict.
  const dspGateRef = useRef({ voiced: false, holding: false });

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
      // `latency` is a hint to the platform — Chrome on Android takes it
      // seriously on some configurations. Default constraint is
      // { ideal: 0.01, max: 0.05 }; the diag overrides at the top let us
      // measurement-test alternates without rebuilding.
      const audioConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
      if (DIAG_LATENCY_EXACT != null) {
        // `exact` is a strict constraint — getUserMedia rejects if the
        // platform can't deliver the requested value. Used to probe
        // whether the granted-0.04 floor on Pixel/Chrome is movable.
        audioConstraints.latency = { exact: DIAG_LATENCY_EXACT };
      } else if (!DIAG_NO_LATENCY_CONSTRAINT) {
        audioConstraints.latency = { ideal: 0.01, max: 0.05 };
      }
      // ?sr=N — request a specific capture sample rate. Mobile Chrome
      // sometimes allocates smaller hardware buffers at lower sample
      // rates (16 kHz / 22.05 kHz are commonly fast-path on Android).
      // MEASUREMENT-ONLY in this commit: the formant pipeline runs at
      // its fallback decimation at non-48 kHz and produces slightly
      // different formant numbers; pYIN is unaffected.
      if (DIAG_SR_OVERRIDE) {
        audioConstraints.sampleRate = DIAG_SR_OVERRIDE;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      streamRef.current = stream;

      // Capture-source factory. Returns either an audiocontext-based or
      // mstp-based source depending on factory routing (see
      // captureSource.js). Production default is "audiocontext"; the
      // ?capture=mstp / ?capture=audiocontext diag flags override for
      // measurement.
      //
      // latencyHint = "balanced" (NOT "interactive"). On Pixel-class
      // Android Chrome, "interactive" allocates a tight ~5 ms output
      // buffer that leaves the audio thread no headroom for scheduling
      // jitter; drift accumulates at +5-8 ms/s. "balanced" allocates
      // ~20 ms baseLatency and the drift collapses to ~0. Sweep data:
      // measurements/mobile-latency-sweep-2026-05-05.md.
      const captureSrc = await createCaptureSource(stream, {
        diag: DIAG_ENABLED,
        chunkMs: DIAG_CHUNK_MS_OVERRIDE,
        latencyHint: DIAG_LATENCY_HINT ?? "balanced",
        sampleRate: DIAG_SR_OVERRIDE,
        forceKind: DIAG_CAPTURE_KIND,
        onInitAck: (ack) => setCaptureStatus(ack),
        onError: (err) => pushError({ source: "capture", ...err }),
      });
      captureSrcRef.current = captureSrc;
      audioCtxRef.current = captureSrc.audioCtx; // null on mstp path

      // Diagnostic snapshot — captured once at start. Path-specific
      // fields (baseLatency / outputLatency / ctxCreatedAtEpochMs)
      // come from captureSrc.audioInfoExtra(); mstp path returns
      // nulls for the fields that don't apply.
      if (DIAG_ENABLED) {
        const trackSettings = stream.getAudioTracks()[0]?.getSettings?.() ?? null;
        setAudioInfo({
          captureKind: captureSrc.kind,
          sampleRate: captureSrc.sampleRate,
          ...captureSrc.audioInfoExtra(),
          // Echo of which override flags were active for this session,
          // so the snapshot is self-describing.
          srOverride: DIAG_SR_OVERRIDE,
          latencyHintOverride: DIAG_LATENCY_HINT,
          noLatencyConstraint: DIAG_NO_LATENCY_CONSTRAINT,
          captureKindOverride: DIAG_CAPTURE_KIND,
          // Track settings reflect what the platform granted vs
          // requested. Mobile browsers may silently override.
          requestedConstraints: { ...audioConstraints },
          grantedConstraints: trackSettings,
          userAgent: navigator.userAgent,
        });
      }

      const worker = new Worker(
        new URL("../dsp/dsp-worker.js", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      worker.postMessage({
        type: "init",
        sampleRate: captureSrc.sampleRate,
        ...(DIAG_ENABLED ? { diag: true } : {}),
      });

      // Direct MessagePort from the capture source to the DSP worker.
      // The factory hands us the consumer end of a MessageChannel
      // already plumbed into the worklet (or MSTP worker, on that path).
      const dspPort = captureSrc.connectConsumer();
      worker.postMessage(
        { type: "port", port: dspPort },
        [dspPort],
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
        inputSampleRate: captureSrc.sampleRate,
        ...(DIAG_ENABLED ? { diag: true } : {}),
      });

      const mlPort = captureSrc.connectConsumer();
      mlWorker.postMessage(
        { type: "audioPort", port: mlPort },
        [mlPort],
      );

      mlWorker.onmessage = (e) => {
        const msg = e.data;
        if (!msg || !msg.type) return;
        if (msg.type === "score") {
          // Tag the entry with the DSP gate's current state so the
          // history strip can filter out dots emitted during non-voice
          // (Codex finding on PR #70). dspGateRef is updated by
          // handleAnalysisResult on every DSP analysis frame.
          const entry = {
            time: Math.round(msg.ts),
            score: msg.score,
            confidence: msg.confidence,
            voiced: dspGateRef.current.voiced || dspGateRef.current.holding,
          };
          genderTraceRef.current.push(entry);
          trimHistory(genderTraceRef.current, RESONANCE_TRACE_SECONDS * 1000, entry.time);
          throttledSetState((s) => ({
            ...s,
            genderScore: msg.score,
            genderConfidence: msg.confidence,
          }));
          // Diag-only: capture per-inference timing so mobile-diag-
          // capture's snapshot summary can compute median/p95/p99
          // against the 150 ms hop budget. No-op when diag isn't on
          // (pushMlInference is no-op without diagState).
          if (DIAG_ENABLED && typeof msg.inferMs === "number") {
            pushMlInference({
              tEpochMs: msg.ts,
              inferMs: msg.inferMs,
              score: msg.score,
              confidence: msg.confidence,
            });
          }
        } else if (msg.type === "status") {
          setState((s) => ({
            ...s,
            modelStatus: msg.status,
            modelError: msg.message ?? null,
          }));
          // When the worker reaches "ready", record which modelId
          // + ORT backend (webgpu vs wasm) actually loaded into
          // diag state. Useful for snapshot inspection. The fields
          // are only present on the "ready" status; setMlModel is
          // a no-op outside diag mode.
          if (msg.status === "ready" && (msg.modelId || msg.device)) {
            setMlModel({
              modelId: msg.modelId ?? null,
              device: msg.device ?? null,
            });
          }
        } else if (msg.type === "progress") {
          setState((s) => ({
            ...s,
            modelProgress: { loaded: msg.loaded, total: msg.total, file: msg.file },
          }));
        }
      };

      worker.onmessage = (e) => {
        const msg = e.data;
        if (!msg || !msg.type) return;

        // Init-ack / error messages from the DSP worker (diag mode only —
        // production worker doesn't send these; the conditional read on
        // the diag side keeps production paths untouched).
        if (msg.type === "worker-init-ack") {
          if (DIAG_ENABLED) setWorkerStatus({
            diag: msg.diag,
            sampleRate: msg.sampleRate,
            windowSize: msg.windowSize,
          });
          return;
        }
        if (msg.type === "worker-error") {
          if (DIAG_ENABLED) pushError({
            source: "worker", where: msg.where, message: msg.message, stack: msg.stack,
          });
          return;
        }

        if (msg.type !== "analysis") return;
        const data = msg.data;

        // Diagnostic mode: capture timing breakpoints around the
        // analysis-handler call.
        //   chunkArrivalMs   = DSP receipt epoch - audio capture epoch
        //                      (audio capture epoch = audioOriginEpochMs
        //                       + contextTime*1000 from the worklet)
        //   handoffToMainMs  = main onmessage entry - DSP postMessage epoch
        //   mainHandlerMs    = handleAnalysisResult duration
        //   totalMs          = display update time - audio capture epoch
        if (DIAG_ENABLED && data.diag) {
          const handlerStart = performance.timeOrigin + performance.now();
          const audioOriginEpochMs = captureSrcRef.current?.audioOriginEpochMs;
          const audioCapturedEpochMs =
            typeof data.contextTime === "number" && typeof audioOriginEpochMs === "number"
              ? audioOriginEpochMs + data.contextTime * 1000
              : null;
          const chunkArrivalMs =
            audioCapturedEpochMs && typeof data.diag.chunkReceiveEpochMs === "number"
              ? data.diag.chunkReceiveEpochMs - audioCapturedEpochMs
              : null;
          const handoffToMainMs =
            typeof data.diag.postedAtEpochMs === "number"
              ? handlerStart - data.diag.postedAtEpochMs
              : null;
          try {
            handleAnalysisResult(data);
          } catch (err) {
            pushError({ source: "main", where: "handleAnalysisResult", message: err.message, stack: err.stack });
            return;
          }
          const handlerEnd = performance.timeOrigin + performance.now();
          pushFrame({
            tEpochMs: data.absoluteTime,
            pitch: data.pitch,
            intensity: data.intensity,
            inputRms: data.diag.inputRms,
            voicedness: data.voicedness,
            voicednessObs: data.diag.voicednessObs,
            pendingChunks: data.pendingChunks,
            timings: {
              chunkArrivalMs,
              pitchDetectMs: data.diag.pitchDetectMs,
              workerProcessingMs: data.workerProcessingMs,
              handoffToMainMs,
              mainHandlerMs: handlerEnd - handlerStart,
              totalMs: audioCapturedEpochMs ? handlerEnd - audioCapturedEpochMs : null,
            },
          });
        } else {
          handleAnalysisResult(data);
        }
      };

      // Periodic AudioContext state sampler (diag mode only). 1 Hz —
      // matches the low-res buffer cadence so each lowRes entry can be
      // backfilled with one fresh ctx-state read. Cheap (a handful of
      // property reads); does nothing in production. On the MSTP path,
      // captureSrc.audioCtx is null and the ctx-* fields write null —
      // signals that AudioContext-internal state isn't observable on
      // that path (which is itself useful diagnostic info).
      if (DIAG_ENABLED) {
        const ac = captureSrc.audioCtx;
        ctxSamplerRef.current = setInterval(() => {
          try {
            const mem = performance && performance.memory
              ? performance.memory.usedJSHeapSize / (1024 * 1024)
              : null;
            setAudioCtxSample({
              ctxState: ac ? ac.state : null,
              ctxBaseLatencyMs: ac ? (ac.baseLatency ?? 0) * 1000 : null,
              ctxOutputLatencyMs: ac ? (ac.outputLatency ?? 0) * 1000 : null,
              ctxCurrentTime: ac ? ac.currentTime : null,
              visibilityState: typeof document !== "undefined" ? document.visibilityState : null,
              memoryUsedMB: mem,
            });
          } catch {
            // ignore; ctx may be closing
          }
        }, 1000);
      }

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
    if (ctxSamplerRef.current) {
      clearInterval(ctxSamplerRef.current);
      ctxSamplerRef.current = null;
    }
    if (captureSrcRef.current) {
      captureSrcRef.current.close();
      captureSrcRef.current = null;
    }
    audioCtxRef.current = null; // owned by captureSrc; just drop the alias
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    if (mlWorkerRef.current) {
      mlWorkerRef.current.terminate();
      mlWorkerRef.current = null;
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
    dspGateRef.current = { voiced: false, holding: false };
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

    // Silence = below intensity threshold OR voicedness threshold, for
    // multiple consecutive frames. Single-frame dips (from GC pauses or
    // audio glitches) are bridged by the SILENCE_DEBOUNCE_FRAMES count.
    // The voicedness arm of this OR is what filters loud-but-unvoiced
    // ambient noise (AC, fans, computer hum) from displaying phantom
    // pitches — without it, broadband noise that exceeds the −50 dB
    // intensity gate would render as if voiced. See VOICEDNESS_THRESHOLD
    // comment above for the threshold rationale.
    const frameQuiet =
      intensity < SILENCE_THRESHOLD_DB ||
      (typeof data.voicedness === "number" && data.voicedness < VOICEDNESS_THRESHOLD);
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
        dspGateRef.current = { voiced: false, holding: true };
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
        dspGateRef.current = { voiced: false, holding: false };
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
    dspGateRef.current = { voiced: true, holding: false };
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
