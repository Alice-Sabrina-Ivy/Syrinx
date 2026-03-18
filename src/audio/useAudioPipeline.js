// useAudioPipeline.js — Hook that connects: mic → AudioWorklet → DSP Worker → React state
// Handles mic permission, AudioContext setup, and result smoothing with silence gating.

import { useState, useRef, useCallback, useEffect } from "react";

const SILENCE_THRESHOLD_DB = -45; // dB below full-scale; adjust as needed
const PITCH_HISTORY_LEN = 3;      // median filter length for pitch smoothing

export function useAudioPipeline() {
  const [state, setState] = useState({
    status: "idle", // "idle" | "requesting" | "running" | "error"
    error: null,
    voiced: false,
    pitch: null,       // smoothed Hz
    intensity: null,   // dB
    noteName: null,    // e.g. "A3"
  });

  const audioCtxRef = useRef(null);
  const workerRef = useRef(null);
  const streamRef = useRef(null);
  const pitchHistoryRef = useRef([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stop();
  }, []);

  const start = useCallback(async () => {
    if (audioCtxRef.current) return; // Already running

    setState((s) => ({ ...s, status: "requesting", error: null }));

    try {
      // Request mic access — mono, default sample rate
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      // Create AudioContext
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      // Load the AudioWorklet processor
      await audioCtx.audioWorklet.addModule("capture-processor.js");

      // Create the worklet node
      const workletNode = new AudioWorkletNode(audioCtx, "capture-processor");

      // Create and init the DSP Web Worker
      const worker = new Worker(
        new URL("../dsp/dsp-worker.js", import.meta.url),
        { type: "module" }
      );
      workerRef.current = worker;

      worker.postMessage({
        type: "init",
        sampleRate: audioCtx.sampleRate,
      });

      // Worklet → Worker: relay audio chunks
      workletNode.port.onmessage = (e) => {
        worker.postMessage(
          { type: "chunk", buffer: e.data },
          [e.data] // Transfer the ArrayBuffer
        );
      };

      // Worker → React state: receive analysis results
      worker.onmessage = (e) => {
        if (e.data.type === "analysis") {
          handleAnalysisResult(e.data.data);
        }
      };

      // Connect the audio graph: mic → worklet
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(workletNode);
      // Don't connect worklet to destination — we don't want to hear ourselves

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
    // Tear down worker
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    // Close AudioContext
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    // Stop mic stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    pitchHistoryRef.current = [];
    setState({
      status: "idle",
      error: null,
      voiced: false,
      pitch: null,
      intensity: null,
      noteName: null,
    });
  }, []);

  function handleAnalysisResult(data) {
    const { pitch, intensity } = data;

    // Silence gate: if intensity is below threshold, report unvoiced
    if (intensity < SILENCE_THRESHOLD_DB || pitch === null) {
      // Clear history on silence to avoid stale smoothed values
      pitchHistoryRef.current = [];
      setState((s) => ({
        ...s,
        voiced: false,
        pitch: null,
        intensity,
        noteName: null,
      }));
      return;
    }

    // Smooth pitch with rolling median
    const history = pitchHistoryRef.current;
    history.push(pitch);
    if (history.length > PITCH_HISTORY_LEN) history.shift();

    const smoothedPitch = median(history);

    setState((s) => ({
      ...s,
      voiced: true,
      pitch: smoothedPitch,
      intensity,
    }));
  }

  return { ...state, start, stop };
}

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
