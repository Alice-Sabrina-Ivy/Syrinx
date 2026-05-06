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

function _readQuery() {
  if (typeof window === "undefined") return new URLSearchParams("");
  try { return new URLSearchParams(window.location.search); }
  catch { return new URLSearchParams(""); }
}
const _query = _readQuery();

export const DIAG_ENABLED = _query.get("diag") === "1";

// Sample-rate override — `?sr=N` URL param. Used by useAudioPipeline.js to
// request a specific sample rate from getUserMedia and the AudioContext.
// MEASUREMENT-ONLY: at non-48kHz the formant pipeline will run at its
// fallback decimation but produce slightly different formant numbers.
// pYIN is unaffected (time-domain). Used to test the hypothesis that the
// 48 kHz hardware-buffer floor is a load-bearing latency constraint on
// mobile. Must NOT be relied on for production behavior. Returns null
// when the flag is absent.
export const DIAG_SR_OVERRIDE = (() => {
  const v = _query.get("sr");
  if (v == null) return null;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 4000 || n > 96000) return null;
  return n;
})();

// Latency-hint override — `?lat=N` URL param (a numeric value passed to
// the AudioContext constructor) or `?lat=interactive|balanced|playback`.
// MEASUREMENT-ONLY. Used to compare the platform's response to different
// hint values without recompiling. Default behavior unchanged (current
// production hint is "interactive").
export const DIAG_LATENCY_HINT = (() => {
  const v = _query.get("lat");
  if (v == null) return null;
  if (v === "interactive" || v === "balanced" || v === "playback") return v;
  const n = parseFloat(v);
  if (Number.isFinite(n) && n >= 0 && n < 1) return n;
  return null;
})();

// Disable the explicit `latency: { ideal: 0.01, max: 0.05 }` constraint —
// `?nolatconstraint=1`. Used to A/B-test whether the constraint is actually
// helping or hurting on a given platform. Default behavior unchanged.
export const DIAG_NO_LATENCY_CONSTRAINT = _query.get("nolatconstraint") === "1";

// Override the AudioWorklet chunk size from the default 25 ms — `?chunk=N`
// where N is in milliseconds. Smaller chunks = sub-chunkSize start-of-
// utterance latency improvement, but more frequent DSP-worker analysis
// calls (the worker analyzes on every chunk arrival once the 50 ms
// window is full, so chunk=10 means analysis at 10 ms cadence vs 25 ms).
// MEASUREMENT-ONLY. Range 5–50 ms. Returns null when absent.
export const DIAG_CHUNK_MS_OVERRIDE = (() => {
  const v = _query.get("chunk");
  if (v == null) return null;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 5 || n > 50) return null;
  return n;
})();

// Use `latency: { exact: N }` instead of `{ ideal: 0.01, max: 0.05 }`
// — `?latexact=N`. `exact` forces getUserMedia to fail if the platform
// can't deliver, so this is a strict probe of the platform floor.
// Range 0.001–0.1 (1–100 ms).
export const DIAG_LATENCY_EXACT = (() => {
  const v = _query.get("latexact");
  if (v == null) return null;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n < 0.001 || n > 0.1) return null;
  return n;
})();

// Force a specific capture-source kind — `?capture=mstp` or
// `?capture=audiocontext`. Default behavior (when absent) follows the
// production routing in captureSource.js. Used to A/B-test MSTP vs
// AudioContext on the same device for latency and accuracy comparisons.
export const DIAG_CAPTURE_KIND = (() => {
  const v = _query.get("capture");
  if (v === "mstp" || v === "audiocontext") return v;
  return null;
})();

// ~30 seconds at the worker's analysis cadence (~25 ms hop = 40 fps).
// Sized so a single snapshot covers enough session time to make slow
// drift (e.g. mobile audio-clock skew) visible by linear regression.
// 1200 frames × ~150 B per frame ≈ 180 KB — negligible for a
// diag-mode-only allocation. Plain array with index-wrap for O(1) push.
const RING_CAP = 1200;

// ML inference timings ring. ~6.7 Hz cadence × ~90 s ≈ 600 entries.
// Sized to fit a typical mobile-diag-capture run (60 s configurable, but
// 90 s of headroom keeps the buffer non-saturated for the longer
// "eat dinner and capture" runs). ~50 B per entry ≈ 30 KB.
const ML_INFERENCES_CAP = 600;

// Long-history low-res buffer: one entry per second, 600 entries = 10 min.
// Each entry is sampled from the most recent high-res frame plus
// audio-context introspection (state, baseLatency, outputLatency,
// visibility) so a single snapshot covers a full long session timeline
// even after the high-res ring scrolls out the early portion. Sized so
// drift onset, phase changes, and long-session behavior are visible
// from the captured JSON without scrolling out of context.
// 600 × ~120 B ≈ 72 KB.
const LOW_RES_CAP = 600;

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
      capture: null,    // { kind: "audiocontext"|"mstp", diag, chunkSize, sampleRate, ... }
      worker: null,     // { diag, sampleRate, windowSize } from worker-init-ack
      errors: [],       // { source: "capture" | "worker" | "main", where, message, stack }
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
    // Per-ML-inference timings ring (gender-worker score events, when
    // diag is on). Each entry:
    // {
    //   tEpochMs,    // performance.timeOrigin + now() at score postMessage
    //   inferMs,     // wall-clock duration of classifier(...) — the only
    //                // load-bearing number for the 150 ms hop budget
    //   score,       // 0..100 perceived-femininity score (post-EMA)
    //   confidence,  // 0..1
    // }
    mlInferences: new RingBuffer(ML_INFERENCES_CAP),
    // Which model+device the gender worker ended up running. Tracks
    // the modelId reported by the worker on its "ready" status and
    // the ORT backend that succeeded ("webgpu" or "wasm"). Useful
    // for post-hoc snapshot inspection — answers "did the worker
    // actually load the expected model on this device?" and
    // "was WebGPU available for it?".
    mlModel: { modelId: null, device: null },
    // Long-history low-res ring. One entry per second, ≤ LOW_RES_CAP
    // entries (10 min). Populated by pushFrame (which dedups to ≤ 1
    // entry/sec) and supplemented by setAudioCtxSample for periodic
    // AudioContext state samples (state, baseLatency, outputLatency,
    // visibility). This is the buffer to use for drift-onset and
    // long-session analysis — the high-res `frames` ring above only
    // covers the most recent ~30 s.
    lowRes: new RingBuffer(LOW_RES_CAP),
    _lowResLastTEpochMs: 0,
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
// same module-instance state the React app is writing to. Also exposes
// snapshot() because dynamic `import("/Syrinx/src/diag/diag.js")` in a
// puppeteer evaluate context can resolve to a different module instance
// than the one Vite served eagerly via React's import graph — so calling
// snapshot via the dynamic import returns an empty fresh state. Always
// route through `window.__syrinxDiag.snapshot` for tooling. Not exposed
// in production: DIAG_ENABLED is false without ?diag=1.
if (DIAG_ENABLED && typeof window !== "undefined") {
  window.__syrinxDiag = {
    get state() { return diagState; },
    snapshot,
  };
}

export function setAudioInfo(info) {
  if (!diagState) return;
  diagState.audio = info;
}

export function setCaptureStatus(s) {
  if (!diagState) return;
  diagState.status.capture = s;
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
  // Sample into the long-history low-res ring at most once per second.
  // The most recent frame's data is what matters for drift analysis;
  // the AudioContext state fields are filled in lazily by
  // setAudioCtxSample, which is called by useAudioPipeline.js's
  // periodic interval.
  const t = frame.tEpochMs;
  if (typeof t === "number" && t - diagState._lowResLastTEpochMs >= 1000) {
    diagState._lowResLastTEpochMs = t;
    diagState.lowRes.push({
      tEpochMs: t,
      pitch: frame.pitch,
      voicedness: frame.voicedness,
      voicednessObs: frame.voicednessObs,
      inputRms: frame.inputRms,
      chunkArrivalMs: frame.timings?.chunkArrivalMs ?? null,
      totalMs: frame.timings?.totalMs ?? null,
      pendingChunks: frame.pendingChunks ?? null,
      // AudioContext state fields filled in by the next
      // setAudioCtxSample call; null if useAudioPipeline.js's
      // periodic interval hasn't run yet.
      ctxState: null,
      ctxBaseLatencyMs: null,
      ctxOutputLatencyMs: null,
      ctxCurrentTime: null,
      visibilityState: typeof document !== "undefined" ? document.visibilityState : null,
      memoryUsedMB: null,
    });
  }
}

// Called periodically (target ~1 Hz) by useAudioPipeline.js with the
// current AudioContext + memory state. Backfills the most recent
// lowRes entry's ctx* fields. Decoupled from pushFrame because the
// AudioWorklet may stop producing frames (e.g., processor disconnected
// by an error, or audio paused) but we still want to capture what
// the AudioContext is doing.
export function setAudioCtxSample(s) {
  if (!diagState) return;
  const arr = diagState.lowRes.arr;
  if (arr.length === 0) {
    // No frame-driven entry yet — push a context-only entry so the
    // sample isn't lost. Useful for diagnosing "no frames at all"
    // states where the worklet died before producing anything.
    diagState.lowRes.push({
      tEpochMs: performance.timeOrigin + performance.now(),
      pitch: null, voicedness: null, voicednessObs: null,
      inputRms: null, chunkArrivalMs: null, totalMs: null,
      pendingChunks: null,
      ...s,
    });
    diagState._lowResLastTEpochMs = performance.timeOrigin + performance.now();
    return;
  }
  // Backfill onto the latest entry. Note: with index-wrap, the
  // "latest" entry is at idx-1 (mod cap) once we've wrapped, else at
  // arr.length-1.
  const lr = diagState.lowRes;
  const latestIdx = lr.arr.length < lr.cap
    ? lr.arr.length - 1
    : (lr.idx - 1 + lr.cap) % lr.cap;
  const latest = lr.arr[latestIdx];
  Object.assign(latest, s);
}

// Called by useAudioPipeline.js's mlWorker.onmessage when the gender
// worker emits a score event. Records the per-inference timing so
// mobile-diag-capture's snapshot summary can compute median/p95/p99
// against the 150 ms hop budget. No-op when diag isn't enabled.
export function pushMlInference(entry) {
  if (!diagState) return;
  diagState.mlInferences.push(entry);
}

export function getMlInferences() {
  return diagState ? diagState.mlInferences.toArray() : [];
}

// Called by useAudioPipeline.js when the gender worker's "ready"
// status arrives with modelId + device fields populated. Captures
// both into the snapshot for post-hoc inspection.
export function setMlModel(info) {
  if (!diagState) return;
  diagState.mlModel = { ...diagState.mlModel, ...info };
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

// Linear regression of a per-frame numeric field against tEpochMs.
// Returns slope in (field-units per millisecond of session time). The
// intended use is "ms of latency added per second of session": call
// with field "chunkArrivalMs" and multiply the result by 1000. NaN-safe;
// returns null if fewer than 2 valid points or if x has no variance.
export function driftSlopePerMs(field) {
  if (!diagState) return null;
  const frames = diagState.frames.toArray();
  if (frames.length < 2) return null;
  let n = 0, sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  let t0 = null;
  for (const fr of frames) {
    const t = fr.tEpochMs;
    const y = fr.timings && fr.timings[field];
    if (typeof t !== "number" || typeof y !== "number") continue;
    if (!Number.isFinite(t) || !Number.isFinite(y)) continue;
    if (t0 === null) t0 = t;
    const dt = t - t0;
    n++;
    sumX += dt;
    sumY += y;
    sumXY += dt * y;
    sumX2 += dt * dt;
  }
  if (n < 2) return null;
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

// Aggregated stats over the current ring contents — current value of each
// timing field plus its p95 and drift (ms per second of session time)
// over the buffer. Returns nulls when no data. Drift is the load-bearing
// signal for clock-skew / buffer-accumulation diagnosis: monotonic growth
// in chunkArrivalMs over session time is the mobile capture issue.
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
    const slopePerMs = driftSlopePerMs(f);
    out[f] = {
      current: last.timings ? last.timings[f] : null,
      p95: p95(series),
      mean: mean(series),
      // Convert slope from (ms per ms) to (ms per second of session
      // time). Null-safe — multiplying null * 1000 = 0, so guard.
      driftMsPerSec: slopePerMs == null ? null : slopePerMs * 1000,
      n: series.length,
    };
  }
  // Window length in seconds — useful in the overlay so a "drift +0.5
  // ms/s" reading over a 2-second window is appropriately distrustable
  // vs the same slope over 30 s.
  const windowSec =
    frames.length >= 2
      ? (frames[frames.length - 1].tEpochMs - frames[0].tEpochMs) / 1000
      : 0;
  out._windowSec = windowSec;
  return out;
}

// Snapshot the entire ring buffer + audio info as a JSON-serializable blob.
// Used by the "Snapshot last 5s" button in the overlay AND the mobile
// diag harness. The lowRes array carries the long-session timeline;
// the high-res frames array carries the last ~30 s.
export function snapshot() {
  if (!diagState) return null;
  return {
    capturedAtEpochMs: performance.timeOrigin + performance.now(),
    capturedAtIso: new Date().toISOString(),
    enabledAtEpochMs: diagState.enabledAtEpochMs,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    diagFlags: {
      DIAG_ENABLED, DIAG_SR_OVERRIDE, DIAG_LATENCY_HINT, DIAG_NO_LATENCY_CONSTRAINT,
      DIAG_CHUNK_MS_OVERRIDE, DIAG_LATENCY_EXACT, DIAG_CAPTURE_KIND,
    },
    audio: diagState.audio,
    status: diagState.status,
    framesWhileHidden: diagState.framesWhileHidden,
    visibilityState: typeof document !== "undefined" ? document.visibilityState : null,
    taps: diagState.taps.toArray(),
    frames: diagState.frames.toArray(),
    lowRes: diagState.lowRes.toArray(),
    mlInferences: diagState.mlInferences.toArray(),
    mlModel: { ...diagState.mlModel },
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
