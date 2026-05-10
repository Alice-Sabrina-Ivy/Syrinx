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
import { VocalWeightAggregator } from "./vocal-weight-aggregator";
import { VocalWeightBaseline } from "./vocal-weight-baseline";
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
  pushPitchInference,
  setPitchModel,
  noteVocalWeightFrame,
  pushVocalWeightEmit,
  resetVocalWeightCounters,
} from "../diag/diag";

const SILENCE_THRESHOLD_DB = -50;
const SILENCE_DEBOUNCE_FRAMES = 3; // require 3 consecutive quiet frames before gating
// Confidence threshold for the AND-logic noise gate below. Reads the
// latest pitch-worker (SwiftF0) confidence, which is the upstream signal
// indicating "is this frame voiced with a clear pitch present" — exactly
// the question the gate's voicedness arm asks. Replaced pYIN's HMM-
// smoothed posterior at the Stage 4 SwiftF0 cutover (see CLAUDE.md
// §"Pitch detection — SwiftF0 cutover, 2026-05-06"). 0.5 matches the
// pitch-reporting threshold inside pitch-worker, so producing a non-null
// pitch and being "voiced enough for the gate to trust" are the same
// condition — single threshold value, no ambiguous middle band.
//
// Validated against the four-corpus pitch-bucket harness in Stage 3.4
// (measurements/swift-f0-stage3-4-3-5-validation-2026-05-06.md): drops
// 6.8 % null rate worst-case (PTDB-TUG <90 Hz) while keeping octave-
// error rate at 1.69 % — better than pYIN's 2.3 % baseline at the same
// cell.
const CONFIDENCE_THRESHOLD = 0.5;
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
    // Vocal-weight metric (CPP-aggregate, per-user-baseline-normalized).
    // - vocalWeight.cpp: latest 1-s aggregate CPP value in dB (raw).
    // - vocalWeight.position: gauge position in [0, 1]; null while
    //   warming up (insufficient voiced material) or while baseline
    //   is still calibrating.
    // - vocalWeight.sigmaDelta: σ-distance from baseline mean
    //   (positive = lighter, negative = heavier).
    // - vocalWeight.baselineProgress: 0-1 fraction of the first-30-s
    //   baseline window that has been filled by voiced speech.
    // - vocalWeight.baselineReady: true once baseline μ/σ are locked.
    vocalWeight: {
      cpp: null,
      position: null,
      sigmaDelta: null,
      baselineProgress: 0,
      baselineReady: false,
    },
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
  const pitchWorkerRef = useRef(null);
  const streamRef = useRef(null);
  // Latest pitch from pitch-worker (SwiftF0). The DSP worker no longer
  // produces pitch since the Stage 4 cutover; each DSP analysis frame
  // reads the most-recent pitch-worker output via this ref. Nearest-
  // neighbor temporal alignment is sufficient — DSP and pitch-worker
  // run on the same chunk cadence, so the lag is at most one chunk
  // (~25 ms), and pitch trace history is built using DSP's absoluteTime
  // anyway. confidence is the voicedness gate's input.
  const latestPitchRef = useRef({
    pitch: null,
    confidence: null,
    voiced: false,
    ts: 0,
  });
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

  // Vocal-weight (CPP) aggregation + per-user baseline. The aggregator
  // owns the 1-s window + 250 ms emit cadence + hard-reset rule
  // (see src/audio/vocal-weight-aggregator.js); the baseline owns the
  // first-30-s μ/σ derivation (see vocal-weight-baseline.js). Both are
  // re-instantiated on each start() so a stop/start cycle gets a fresh
  // baseline.
  const cppAggregatorRef = useRef(null);
  const cppBaselineRef = useRef(null);
  // Latest CPP-aggregate emit; used by the throttled state update so
  // we don't re-emit gauge state on every DSP frame.
  const lastCppAggregateRef = useRef({ time: -1 });

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

  // The DSP-worker `analysis` handler in start() needs to call
  // handleAnalysisResult, which is declared later in this hook body and
  // recreated on every render. Capturing it directly in start's closure
  // would be both (a) a forward-reference at hook-evaluation time and
  // (b) a "stale closure" lint warning since start's deps are []. The
  // ref-update pattern below sidesteps both: start reads the latest
  // handleAnalysisResult through the ref, and the effect that writes the
  // ref runs after every render, so the ref always points to the most-
  // recent version. Stable refs (audioCtxRef, captureSrcRef, etc.) are
  // referenced directly.
  const handleAnalysisResultRef = useRef(null);

  // Guards against a second start() call slipping through during the
  // ~1 s getUserMedia permission prompt — the audioCtxRef.current early-
  // return below isn't set until createCaptureSource resolves, and the UI
  // button-disable race (status "idle" → "requesting") is not airtight
  // if start is ever invoked from a non-button code path.
  const startingRef = useRef(false);

  // stop() is declared after start() in this hook body, but start()'s
  // mid-stream onError needs to call it (capture-source failures during
  // an active session must clean up workers + tracks, not just transition
  // to error state). The ref-update pattern below sidesteps the temporal
  // dead zone — start captures the ref, the post-render effect populates
  // it once stop is defined.
  const stopRef = useRef(null);

  const start = useCallback(async () => {
    if (startingRef.current) return;
    // If a previous AudioContext was closed (e.g. via stop()), discard the
    // stale reference so we create a fresh one. A closed AudioContext cannot
    // be resumed — the spec requires a new instance.
    if (audioCtxRef.current && audioCtxRef.current.state === "closed") {
      audioCtxRef.current = null;
    }
    if (audioCtxRef.current) return;
    startingRef.current = true;

    // Fresh CPP aggregator + baseline per session. A previous session's
    // baseline shouldn't carry over — mic, room, time-of-day, and the
    // user's voice state may all differ.
    cppAggregatorRef.current = new VocalWeightAggregator();
    cppBaselineRef.current = new VocalWeightBaseline();
    lastCppAggregateRef.current = { time: -1 };
    if (DIAG_ENABLED) resetVocalWeightCounters();

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
        onError: (err) => {
          pushError({ source: "capture", ...err });
          // Mid-stream capture failures (AudioWorklet process throw, MSTP
          // copyTo throw, MSTP read-loop reject) silently halt audio
          // delivery. Without surfacing here the UI just freezes — the
          // status indicator stays "running" forever with no chunks
          // arriving. stop() tears down the pipeline (workers, audio
          // context, tracks); the trailing setState overrides the idle
          // status to error. React batches the two state updates into a
          // single render, so the error message lands on the cleaned-up
          // state.
          stopRef.current?.();
          setState((s) => ({
            ...s,
            status: "error",
            error: `Audio capture failed: ${err.message || err.where || "unknown"}`,
          }));
        },
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

      // Pitch detection worker. Hosts SwiftF0 ONNX inference via
      // onnxruntime-web; emits {pitch, confidence, voiced} per audio
      // chunk. Replaces pYIN's pitch + voicedness signals (Stage 4
      // cutover, 2026-05-06). Audio forked from the same captureSource
      // via a third MessagePort.
      const pitchWorker = new Worker(
        new URL("../dsp/pitch-worker.js", import.meta.url),
        { type: "module" },
      );
      pitchWorkerRef.current = pitchWorker;
      // Vite serves /Syrinx/swift-f0/model.onnx in both dev and prod;
      // import.meta.env.BASE_URL resolves to "/Syrinx/" per vite.config.js.
      const modelUrl = `${import.meta.env.BASE_URL}swift-f0/model.onnx`;
      pitchWorker.postMessage({
        type: "init",
        inputSampleRate: captureSrc.sampleRate,
        modelUrl,
        ...(DIAG_ENABLED ? { diag: true } : {}),
      });

      const pitchPort = captureSrc.connectConsumer();
      pitchWorker.postMessage(
        { type: "audioPort", port: pitchPort },
        [pitchPort],
      );

      pitchWorker.onmessage = (e) => {
        const msg = e.data;
        if (!msg || !msg.type) return;
        if (msg.type === "pitch") {
          latestPitchRef.current = {
            pitch: msg.pitch,
            confidence: msg.confidence,
            voiced: msg.voiced,
            ts: msg.ts,
          };
          // Forward pitch hint to the DSP worker so its formant extraction
          // can pick the right LPC order / formant ceiling. One-frame lag
          // is acceptable since formants change slowly. We always send
          // (including null when unvoiced) so the DSP worker can drop the
          // hint promptly when speech ends.
          if (workerRef.current) {
            workerRef.current.postMessage({
              type: "pitch-hint",
              pitch: msg.pitch,
            });
          }
          if (DIAG_ENABLED && typeof msg.inferMs === "number") {
            pushPitchInference({
              tEpochMs: msg.ts,
              inferMs: msg.inferMs,
              pitch: msg.pitch,
              confidence: msg.confidence,
              voiced: msg.voiced,
            });
          }
        } else if (msg.type === "inference-event") {
          // Mirrors the gender-worker timeout-event handling. Diag-only
          // capture of pitch-worker hangs into the errors ring so
          // snapshots reveal hang frequency.
          if (DIAG_ENABLED) {
            pushError({
              source: "pitchWorker",
              where: msg.event,
              message: `${msg.event}: ${msg.durationMs}ms`,
              ts: msg.ts,
            });
          }
        } else if (msg.type === "status") {
          if (msg.status === "error") {
            pushError({ source: "pitch-worker", where: "load", message: msg.message });
          }
          if (msg.status === "ready" && DIAG_ENABLED) {
            setPitchModel({
              modelUrl: msg.modelUrl ?? null,
              device: msg.device ?? null,
              threshold: msg.threshold ?? null,
            });
          }
        }
      };

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
        } else if (msg.type === "inference-event") {
          // Diag-only: capture defensive-timeout events from the gender
          // worker into the errors ring so snapshots reveal hang frequency.
          // Used to confirm/refute H1 (WebGPU init race) from real-user
          // data — see CLAUDE.md "Pitch detection of periodic non-speech
          // content" / gender-worker.js INFERENCE_TIMEOUT_MS for context.
          if (DIAG_ENABLED) {
            pushError({
              source: "mlWorker",
              where: msg.event,
              message: `${msg.event}: ${msg.durationMs}ms`,
              ts: msg.ts,
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
          // Snapshot latest pitch + confidence at frame-emit time so the
          // diag entry pairs the DSP frame with the pitch-worker output
          // visible at this moment.
          const latest = latestPitchRef.current;
          try {
            handleAnalysisResultRef.current?.(data);
          } catch (err) {
            pushError({ source: "main", where: "handleAnalysisResult", message: err.message, stack: err.stack });
            return;
          }
          const handlerEnd = performance.timeOrigin + performance.now();
          pushFrame({
            tEpochMs: data.absoluteTime,
            pitch: latest.pitch,
            intensity: data.intensity,
            inputRms: data.diag.inputRms,
            confidence: latest.confidence,
            pendingChunks: data.pendingChunks,
            timings: {
              chunkArrivalMs,
              workerProcessingMs: data.workerProcessingMs,
              handoffToMainMs,
              mainHandlerMs: handlerEnd - handlerStart,
              totalMs: audioCapturedEpochMs ? handlerEnd - audioCapturedEpochMs : null,
            },
          });
        } else {
          handleAnalysisResultRef.current?.(data);
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
      // Best-effort cleanup of any partial state. start() may have set up
      // some refs before failing — getUserMedia stream, captureSrc, and any
      // workers created up to the failure point. Without this, retry-after-
      // error orphans the previous stream/workers (mic indicator stays on,
      // workers keep running with no terminate path).
      if (streamRef.current) {
        try { streamRef.current.getTracks().forEach((t) => t.stop()); } catch { /* */ }
        streamRef.current = null;
      }
      if (captureSrcRef.current) {
        try { captureSrcRef.current.close(); } catch { /* */ }
        captureSrcRef.current = null;
      }
      audioCtxRef.current = null;
      for (const ref of [workerRef, mlWorkerRef, pitchWorkerRef]) {
        if (ref.current) {
          try { ref.current.terminate(); } catch { /* */ }
          ref.current = null;
        }
      }
      if (ctxSamplerRef.current) {
        clearInterval(ctxSamplerRef.current);
        ctxSamplerRef.current = null;
      }
      setState((s) => ({
        ...s,
        status: "error",
        error: err.message || "Microphone access denied",
      }));
    } finally {
      startingRef.current = false;
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
    if (pitchWorkerRef.current) {
      pitchWorkerRef.current.terminate();
      pitchWorkerRef.current = null;
    }
    latestPitchRef.current = { pitch: null, confidence: null, voiced: false, ts: 0 };
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
    cppAggregatorRef.current = null;
    cppBaselineRef.current = null;
    lastCppAggregateRef.current = { time: -1 };
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
      vocalWeight: {
        cpp: null,
        position: null,
        sigmaDelta: null,
        baselineProgress: 0,
        baselineReady: false,
      },
      genderScore: null,
      genderConfidence: null,
      modelStatus: "idle",
      modelError: null,
      modelProgress: null,
    });
  }, []);

  // Unmount cleanup. Placed here (rather than at the top of the hook body
  // before start/stop are declared) so the [stop] dep list resolves
  // without a temporal-dead-zone reference and without a lint suppression
  // comment. stop is useCallback'd with [] so this effect runs exactly
  // once for setup and once for teardown.
  useEffect(() => {
    return () => stop();
  }, [stop]);

  // Make stop() callable from start()'s onError closure (mid-stream
  // capture errors must tear down the pipeline). Updated post-render so
  // refs are not mutated during render (concurrent renders may abandon).
  useEffect(() => { stopRef.current = stop; });

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

  // Build the vocalWeight state slice from the latest aggregator output
  // and the baseline tracker. Pure function — no side effects, called
  // from each setState path so state stays consistent across silent/
  // voiced/hold branches.
  function buildVocalWeightState(aggregate) {
    const baseline = cppBaselineRef.current;
    const cppValue = aggregate ? aggregate.cpp : null;
    if (!baseline) {
      return { cpp: cppValue, position: null, sigmaDelta: null,
               baselineProgress: 0, baselineReady: false };
    }
    return {
      cpp: cppValue,
      position: cppValue !== null ? baseline.gaugePosition(cppValue) : null,
      sigmaDelta: cppValue !== null ? baseline.sigmaDelta(cppValue) : null,
      baselineProgress: baseline.progress(),
      baselineReady: baseline.ready(),
    };
  }

  function handleAnalysisResult(data) {
    const { intensity, formants, spectralTilt, hnr, cpp, absoluteTime } = data;
    // Pitch + confidence come from pitch-worker (SwiftF0) via latestPitchRef,
    // not from the DSP analysis message. Each DSP frame consumes the most-
    // recent pitch-worker output (nearest-neighbor temporal alignment).
    const latestPitch = latestPitchRef.current;
    const pitch = latestPitch.pitch;
    const confidence = latestPitch.confidence;

    // Use the worker's absolute timestamp for data points.
    // This reflects when audio was *analyzed* in the worker, which is the
    // true event time.  The draw loop also uses absoluteTime-based clocks,
    // and clockOffset between worker and main thread is ~0ms.
    const now = Math.round(absoluteTime);

    // Silence = below intensity threshold AND below confidence threshold,
    // for multiple consecutive frames. AND-logic (NOT OR) is intentional
    // — both signals must agree on "noise" before a frame is suppressed.
    // Either signal alone over-suppresses real speech: the intensity arm
    // catches genuine speech during inter-phoneme dips (real desktop mic
    // speech median intensity is ~-38 dB but routinely crosses -50
    // between articulations); a low-confidence-only gate would suppress
    // borderline-voiced frames where pitch is real but uncertain.
    //
    // The confidence signal here is SwiftF0's per-frame voicing probability
    // (replaced pYIN's HMM-smoothed posterior at the Stage 4 cutover). 0.5
    // also matches the threshold inside pitch-worker that gates pitch
    // reporting — so confidence < 0.5 is exactly when pitch is null. The
    // gate's voicedness arm and the pitch-reporting threshold are the
    // same condition by design (no ambiguous middle band).
    //
    // Pre-warmup frames (pitch-worker has not yet completed its first
    // inference): confidence is null, voicednessQuiet defaults to true so
    // the AND collapses to intensity-only gating until SwiftF0 starts
    // emitting confidence values (~3 chunks ≈ 75 ms after start).
    const intensityQuiet = intensity < SILENCE_THRESHOLD_DB;
    const voicednessQuiet =
      typeof confidence !== "number" ||
      confidence < CONFIDENCE_THRESHOLD;
    const frameQuiet = intensityQuiet && voicednessQuiet;
    const hasPitch = pitch !== null;

    if (frameQuiet) {
      quietFrameCountRef.current++;
    } else {
      quietFrameCountRef.current = 0;
    }

    const isQuiet = quietFrameCountRef.current >= SILENCE_DEBOUNCE_FRAMES;

    // Push CPP into the vocal-weight aggregator with the DEBOUNCED
    // voicing flag (audit §3.5). Frames are pushed regardless of the
    // silent/voiced branch below — the aggregator's hard-reset rule
    // depends on observing unvoiced gaps. Only the aggregator's emit
    // result drives the gauge state update further down.
    let cppAggregate = null;
    if (cppAggregatorRef.current) {
      cppAggregate = cppAggregatorRef.current.push({
        time: now,
        cpp,                               // may be null on non-6th-frame DSP cycles
        voiced: !isQuiet,
      });
    }
    if (DIAG_ENABLED) noteVocalWeightFrame(!isQuiet);
    // Feed locked-or-warming baseline. Only voiced aggregates contribute
    // to the baseline so silence/breath don't bias μ. Once baseline locks,
    // accumulate() is a no-op.
    const isFreshAggregate =
      cppAggregate && cppAggregate.time !== lastCppAggregateRef.current.time;
    if (isFreshAggregate && !isQuiet && cppBaselineRef.current) {
      cppBaselineRef.current.accumulate({
        time: cppAggregate.time,
        cpp: cppAggregate.cpp,
      });
      lastCppAggregateRef.current = cppAggregate;
    }
    if (DIAG_ENABLED && isFreshAggregate) {
      const baseline = cppBaselineRef.current;
      pushVocalWeightEmit({
        tEpochMs: performance.timeOrigin + performance.now(),
        aggregateTime: cppAggregate.time,
        cpp: cppAggregate.cpp,
        voicedFrames: cppAggregate.voicedFrames,
        baselineProgress: baseline ? baseline.progress() : 0,
        baselineSampleCount: baseline ? baseline.state().sampleCount : 0,
        baselineSampleTarget: baseline ? baseline.state().sampleTarget : null,
        baselineLocked: baseline ? baseline.ready() : false,
        baselineMu: baseline ? baseline.mu() : null,
        baselineSigma: baseline ? baseline.sigma() : null,
        sigmaDelta: baseline ? baseline.sigmaDelta(cppAggregate.cpp) : null,
      });
    }

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
        const vw = buildVocalWeightState(cppAggregate);
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
          vocalWeight: vw,
        }));
      } else {
        // Prolonged silence: clear everything
        dspGateRef.current = { voiced: false, holding: false };
        pitchSmoothRef.current = [];
        f1SmoothRef.current = [];
        f2SmoothRef.current = [];
        f3SmoothRef.current = [];
        const vw = buildVocalWeightState(cppAggregate);
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
          vocalWeight: vw,
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
    const vw = buildVocalWeightState(cppAggregate);
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
      vocalWeight: vw,
    }));
  }

  // Keep the latest handleAnalysisResult reachable from start()'s closure
  // via a ref. Updated post-render so it's safe under StrictMode and
  // concurrent rendering (refs must not be mutated during render).
  useEffect(() => { handleAnalysisResultRef.current = handleAnalysisResult; });

  // Re-anchor the per-user vocal-weight baseline mid-session. Wired
  // to a UI affordance so users whose first 30 s wasn't representative
  // of their typical voice (e.g., started with a vocal warm-up before
  // settling into trained voice) can re-calibrate without restarting
  // the mic. Drops the baseline AND the aggregator's history so the
  // new baseline window starts from genuinely fresh material.
  const resetVocalWeightBaseline = useCallback(() => {
    if (cppBaselineRef.current) cppBaselineRef.current.reset();
    if (cppAggregatorRef.current) cppAggregatorRef.current.reset();
    lastCppAggregateRef.current = { time: -1 };
    setState((s) => ({
      ...s,
      vocalWeight: {
        cpp: null,
        position: null,
        sigmaDelta: null,
        baselineProgress: 0,
        baselineReady: false,
      },
    }));
  }, []);

  return {
    ...state,
    start,
    stop,
    resetVocalWeightBaseline,
    pitchTraceRef,
    formantTrailRef,
    genderTraceRef,
    // Exposed so canvas-based components can read the DSP voicedness gate
    // at full rAF rate, bypassing the ~5 fps throttledSetState that drives
    // the `voiced` / `holding` text-readout fields above. The two are kept
    // in sync each DSP analysis frame; the ref is just lower-latency.
    dspGateRef,
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
