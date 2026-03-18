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

const SILENCE_THRESHOLD_DB = -45;
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

  const audioCtxRef = useRef(null);
  const workerRef = useRef(null);
  const streamRef = useRef(null);

  // Smoothing buffers
  const pitchSmoothRef = useRef([]);
  const f1SmoothRef = useRef([]);
  const f2SmoothRef = useRef([]);
  const f3SmoothRef = useRef([]);

  // Silence gating
  const silenceStartRef = useRef(null);
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

      const worker = new Worker(
        new URL("../dsp/dsp-worker.js", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      worker.postMessage({ type: "init", sampleRate: audioCtx.sampleRate });

      workletNode.port.onmessage = (e) => {
        worker.postMessage(
          { type: "chunk", buffer: e.data },
          [e.data],
        );
      };

      worker.onmessage = (e) => {
        if (e.data.type === "analysis") {
          handleAnalysisResult(e.data.data);
        }
      };

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(workletNode);

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

  function handleAnalysisResult(data) {
    const { pitch, intensity, formants, spectralTilt, hnr } = data;
    const now = Date.now();

    const isSilent = intensity < SILENCE_THRESHOLD_DB || pitch === null;

    if (isSilent) {
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
        setState((s) => ({
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
        setState((s) => ({
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

    // Voiced frame — clear silence timer
    silenceStartRef.current = null;

    // Smooth pitch with rolling median
    const smoothedPitch = pushAndMedian(pitchSmoothRef, pitch, PITCH_SMOOTH_LEN);

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

    // Update history buffers
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

    // Save as last voiced values (for hold behavior)
    lastVoicedRef.current = {
      pitch: smoothedPitch,
      noteName,
      formants: smoothedFormants,
      spectralTilt: spectralTilt ?? null,
      hnr: hnr ?? null,
    };

    setState((s) => ({
      ...s,
      voiced: true,
      holding: false,
      pitch: smoothedPitch,
      intensity,
      noteName,
      formants: smoothedFormants,
      spectralTilt: spectralTilt ?? null,
      hnr: hnr ?? null,
    }));
  }

  return {
    ...state,
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
