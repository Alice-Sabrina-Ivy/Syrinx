// diag.js — Diagnostic-mode singleton for the ?diag=1 URL flag.
//
// Off by default. The hot path checks DIAG_ENABLED (a module-level const that
// the JIT can DCE when false), and the diagnostic state object is only
// allocated when the flag is set. Callers that want zero-cost gating do
// `if (DIAG_ENABLED) { ... }` directly; the helpers below also guard
// internally so callers can use them unconditionally without harm.
//
// The module is shared between the main thread and any consumer that imports
// it (currently just the React side). The DSP worker and AudioWorklet do
// NOT import this — they receive a `diag: true` flag in their init messages
// and stash it locally.

export const DIAG_ENABLED = (() => {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("diag") === "1";
  } catch {
    return false;
  }
})();

// 5 seconds at the worker's analysis cadence (~25 ms hop = 40 fps) plus
// headroom. Plain array with index-wrap for O(1) push.
const RING_CAP = 250;

class RingBuffer {
  constructor(cap) {
    this.cap = cap;
    this.arr = [];
    this.idx = 0;
  }
  push(v) {
    if (this.arr.length < this.cap) {
      this.arr.push(v);
    } else {
      this.arr[this.idx] = v;
      this.idx = (this.idx + 1) % this.cap;
    }
  }
  // Returns entries in chronological order (oldest first).
  toArray() {
    if (this.arr.length < this.cap) return [...this.arr];
    return [...this.arr.slice(this.idx), ...this.arr.slice(0, this.idx)];
  }
  size() { return this.arr.length; }
}

export function p95(arr) {
  if (!arr || arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.95)];
}

export function mean(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function _createState() {
  return {
    enabledAtEpochMs: performance.timeOrigin + performance.now(),
    // Audio-context introspection captured once at start().
    audio: null,
    // Pipeline status — populated by init-ack messages and any errors.
    // The overlay surfaces this so an empty `frames` buffer doesn't look
    // like "everything's fine, just no audio" — it shows whether init
    // messages landed and whether anything threw.
    status: {
      worklet: null,    // { diag, chunkSize, sampleRate } from worklet-init-ack
      worker: null,     // { diag, sampleRate, windowSize } from worker-init-ack
      errors: [],       // { source: "worklet" | "worker", where, message, stack }
    },
    // Per-frame ring buffer. Each entry:
    // {
    //   tEpochMs,           // worker-side absoluteTime (when analysis completed)
    //   pitch,              // Hz or null
    //   intensity,          // dB
    //   inputRms,           // linear amplitude RMS (small number, 0..~0.5)
    //   voicedness,         // HMM-smoothed posterior, 0..1 or null
    //   voicednessObs,      // raw Beta-CDF candidate mass, 0..1 or null
    //   timings: {
    //     chunkArrivalMs,   // audio captured (ctx time → epoch) → DSP arrival
    //     pitchDetectMs,    // detectPitch() call only
    //     workerProcessingMs, // detectPitch + formants + tilt + HNR
    //     handoffToMainMs,  // DSP postMessage → main onmessage handler entry
    //     mainHandlerMs,    // time inside handleAnalysisResult
    //     totalMs,          // (capture context-time → display update) wall clock
    //   },
    //   pendingChunks,      // worker queue depth at handoff
    // }
    frames: new RingBuffer(RING_CAP),
    // Recent tap/click event timestamps for tap-to-display latency.
    taps: new RingBuffer(20),
    // Frames-while-hidden tally (visibility/lifecycle).
    framesWhileHidden: 0,
  };
}

// Allocated only when diag is enabled. Anywhere that calls helpers below can
// do so unconditionally; helpers no-op when state is null.
export const diagState = DIAG_ENABLED ? _createState() : null;

// Pin a stable handle on `window` when diag is on so external tooling
// (puppeteer probes, browser devtools, snapshot scripts) can read the
// same module-instance state the React app is writing to. Not exposed
// in production: DIAG_ENABLED is false without ?diag=1.
if (DIAG_ENABLED && typeof window !== "undefined") {
  window.__syrinxDiag = { state: diagState };
}

export function setAudioInfo(info) {
  if (!diagState) return;
  diagState.audio = info;
}

export function setWorkletStatus(s) {
  if (!diagState) return;
  diagState.status.worklet = s;
}

export function setWorkerStatus(s) {
  if (!diagState) return;
  diagState.status.worker = s;
}

export function pushError(err) {
  if (!diagState) return;
  diagState.status.errors.push({
    tEpochMs: performance.timeOrigin + performance.now(),
    ...err,
  });
  // Cap errors so a runaway loop doesn't OOM the page.
  if (diagState.status.errors.length > 50) {
    diagState.status.errors.splice(0, diagState.status.errors.length - 50);
  }
  // Also log to console — diag mode is opt-in so noisy console is fine.
  // eslint-disable-next-line no-console
  console.error("[diag]", err.source ?? "unknown", err.where ?? "", err.message ?? "", err.stack ?? "");
}

export function getStatus() {
  return diagState ? diagState.status : null;
}

export function pushFrame(frame) {
  if (!diagState) return;
  diagState.frames.push(frame);
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    diagState.framesWhileHidden++;
  }
}

export function pushTap(tap) {
  if (!diagState) return;
  diagState.taps.push(tap);
}

export function getFrames() {
  return diagState ? diagState.frames.toArray() : [];
}

export function getTaps() {
  return diagState ? diagState.taps.toArray() : [];
}

// Aggregated stats over the current ring contents — current value of each
// timing field plus its p95 over the buffer. Returns nulls when no data.
export function getTimingStats() {
  if (!diagState) return null;
  const frames = diagState.frames.toArray();
  if (frames.length === 0) return null;
  const last = frames[frames.length - 1];
  const fields = [
    "chunkArrivalMs",
    "pitchDetectMs",
    "workerProcessingMs",
    "handoffToMainMs",
    "mainHandlerMs",
    "totalMs",
  ];
  const out = {};
  for (const f of fields) {
    const series = frames
      .map((fr) => fr.timings && fr.timings[f])
      .filter((v) => typeof v === "number" && Number.isFinite(v));
    out[f] = {
      current: last.timings ? last.timings[f] : null,
      p95: p95(series),
      mean: mean(series),
      n: series.length,
    };
  }
  return out;
}

// Snapshot the entire ring buffer + audio info as a JSON-serializable blob.
// Used by the "Snapshot last 5s" button in the overlay.
export function snapshot() {
  if (!diagState) return null;
  return {
    capturedAtEpochMs: performance.timeOrigin + performance.now(),
    capturedAtIso: new Date().toISOString(),
    enabledAtEpochMs: diagState.enabledAtEpochMs,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    audio: diagState.audio,
    status: diagState.status,
    framesWhileHidden: diagState.framesWhileHidden,
    visibilityState: typeof document !== "undefined" ? document.visibilityState : null,
    taps: diagState.taps.toArray(),
    frames: diagState.frames.toArray(),
  };
}

// Trigger a browser download of the snapshot as a JSON file.
export function downloadSnapshot() {
  if (!diagState) return;
  const json = JSON.stringify(snapshot(), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `syrinx-diag-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
