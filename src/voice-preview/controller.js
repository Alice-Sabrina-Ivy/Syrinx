// controller.js — main-thread side of the voice preview: worker lifecycle, recording
// control (capture consumer + posted-pitch tap through bridge.js), render queue.
// A small observable store, like resonance-lab/labPipeline.js, created once by the card
// and kept for the page visit (it survives view and tab switches).
// measurements/voice-preview-phase1-2026-10-19.md §3, §4.
//
// createVoicePreviewController({ createWorker, glueUrl, wasmUrls }) — the card passes a
// factory for the module Worker (src/voice-preview/vp-worker.js) and the asset URLs
// (wasm-files.js); Node tests pass a worker_threads adapter and file URLs.
//
// Phases: loading -> ready -> recording -> analysing -> preview
//   (too-short | no-voice | cancelled lead back to a recordable state with the same
//    worker; load-error | error | memory need a fresh worker: discard / record again).
// Memory: WebAssembly memory never shrinks, so discard() and recordAgain() terminate the
// worker (all of its memory goes back) and start a fresh idle one.
// Watchdogs (fix step): a worker that has not answered LOAD_TIMEOUT_MS after it was started
// (a stalled .wasm fetch) goes to load-error, and one that has not finished the analysis
// ANALYSE_TIMEOUT_MS after `recorded` (a hang, a worker that died without an error event) is
// terminated and goes to error, so Record again / Discard always come back. recordAgain()
// does nothing while Record would have to wait (the 6 s listening wait after listening
// restarts): it used to discard the preview and then not record.
import { getVoicePreviewCapture, onVoicePreviewCapture, setVoicePreviewPitchTap } from "./bridge.js";

export const RECORD_MAX_S = 8;
export const RECORD_MIN_S = 3;
/** Record waits until listening has run this long, so the tonal-noise notch can flag a hum (§1, §7). */
export const LISTEN_BEFORE_RECORD_MS = 6000;
/** Loading (worker start -> ready) longer than this is a load error. */
export const LOAD_TIMEOUT_MS = 30000;
/** `recorded` -> `analysed` longer than this (500 ms track wait + analysis, ~2.3 s for 8 s on the gate phone) is an error. */
export const ANALYSE_TIMEOUT_MS = 20000;

const RECORDABLE = new Set(["ready", "too-short", "no-voice", "cancelled"]);

function initialState() {
  return {
    phase: "loading",
    build: null,
    loadMs: null,
    memBytes: null,       // the worker's WebAssembly memory when it became ready
    level: null,          // { rms, peak, seconds } while recording
    recordedSeconds: null,
    analysis: null,       // the worker's `analysed` message without the PCM
    original: null,       // Float32Array at analysis.captureRate (engine rate above 96 kHz)
    rebuild: null,        // Float32Array at analysis.rate
    preview: null,        // { st, pct, pcm, rate, ms } — the last rendered setting
    rendering: null,      // { st, pct } in flight
    voicedS: null,        // no-voice
    error: null,          // { stage, kind, message }
  };
}

export function createVoicePreviewController({
  createWorker, glueUrl, wasmUrls, now = () => performance.now(),
  loadTimeoutMs = LOAD_TIMEOUT_MS, analyseTimeoutMs = ANALYSE_TIMEOUT_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t),
}) {
  let state = initialState();
  const listeners = new Set();
  let worker = null;
  let workerGen = 0;
  let recPort = null;
  let recHandle = null;
  let pendingRecord = false;
  let waitingRender = null;
  let renderSeq = 0;
  let watchdog = null;

  function set(patch) {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  }

  function removeTap() { setVoicePreviewPitchTap(null); }

  function unwatch() {
    if (watchdog !== null) { clearTimer(watchdog); watchdog = null; }
  }
  /** One watchdog at a time: after ms, if the worker generation is unchanged, terminate it and go to `phase`. */
  function watch(ms, inPhase, phase, stage) {
    unwatch();
    const gen = workerGen;
    watchdog = setTimer(() => {
      watchdog = null;
      if (gen !== workerGen || state.phase !== inPhase) return;
      terminate();
      set({ phase, rendering: null, level: null, error: { stage, kind: "timeout", message: `voice preview worker did not answer within ${ms} ms (${inPhase})` } });
    }, ms);
  }

  function releaseCapture() {
    if (recPort && recHandle) {
      try { recHandle.disconnect(recPort); } catch { /* capture already closed */ }
    }
    recPort = null;
    recHandle = null;
  }

  function spawn() {
    const gen = ++workerGen;
    if (typeof WebAssembly !== "object") {
      set({ ...initialState(), phase: "unsupported" });
      return;
    }
    const w = createWorker();
    worker = w;
    w.onmessage = (e) => { if (gen === workerGen) onWorkerMessage(e.data); };
    w.onerror = (e) => {
      if (gen !== workerGen) return;
      unwatch();
      removeTap();
      releaseCapture();
      set({ phase: state.phase === "loading" ? "load-error" : "error", error: { stage: "worker", kind: "other", message: e?.message || "voice preview worker failed" } });
    };
    w.postMessage({ type: "init", glueUrl, wasmUrls });
    watch(loadTimeoutMs, "loading", "load-error", "load");
  }

  function terminate() {
    workerGen++;
    unwatch();
    removeTap();
    releaseCapture();
    pendingRecord = false;
    waitingRender = null;
    if (worker) {
      try { worker.terminate(); } catch { /* already gone */ }
      worker = null;
    }
  }

  function sendRender(st, pct) {
    set({ rendering: { st, pct } });
    worker.postMessage({ type: "render", id: ++renderSeq, st, pct });
  }

  function onWorkerMessage(m) {
    switch (m.type) {
      case "ready": {
        unwatch();
        set({ phase: "ready", build: m.build, loadMs: m.ms, memBytes: m.memBytes });
        if (pendingRecord) { pendingRecord = false; record(); }
        break;
      }
      case "level": set({ level: { rms: m.rms, peak: m.peak, seconds: m.seconds } }); break;
      case "recorded": {
        releaseCapture(); // the tap stays until the posted track is complete
        set({ phase: "analysing", recordedSeconds: m.seconds, level: null });
        watch(analyseTimeoutMs, "analysing", "error", "analyse");
        break;
      }
      case "too-short": removeTap(); releaseCapture(); set({ phase: "too-short", recordedSeconds: m.seconds, level: null }); break;
      case "cancelled": removeTap(); releaseCapture(); set({ phase: "cancelled", level: null }); break;
      case "no-voice": unwatch(); removeTap(); set({ phase: "no-voice", voicedS: m.voicedS }); break;
      case "analysed": {
        unwatch();
        removeTap();
        const { original, rebuild, type: _t, ...analysis } = m;
        set({ phase: "preview", analysis, original, rebuild, preview: null, rendering: null });
        break;
      }
      case "rendered": {
        // a successful render clears an earlier render error's notice
        set({ preview: { st: m.st, pct: m.pct, pcm: m.pcm, rate: m.rate, ms: m.ms }, rendering: null, error: null });
        if (waitingRender) { const r = waitingRender; waitingRender = null; render(r.st, r.pct); }
        break;
      }
      case "error": {
        removeTap();
        releaseCapture();
        if (m.stage === "render" && state.phase === "preview" && m.kind !== "memory") {
          // the previous preview stays playable; a setting that waited behind the failed
          // render is sent now (it used to wait until the next render and then override it)
          set({ rendering: null, error: { stage: m.stage, kind: m.kind, message: m.message } });
          if (waitingRender) { const r = waitingRender; waitingRender = null; render(r.st, r.pct); }
          break;
        }
        unwatch();
        const phase = m.stage === "load" ? "load-error" : m.kind === "memory" ? "memory" : "error";
        set({ phase, rendering: null, error: { stage: m.stage, kind: m.kind, message: m.message } });
        break;
      }
      default: break;
    }
  }

  /** Listening stopped (the bridge's handle cleared) during a recording: cancel it. */
  const unsubCapture = onVoicePreviewCapture((h) => {
    if (h === null && state.phase === "recording" && worker) {
      worker.postMessage({ type: "cancel" });
      removeTap();
      recPort = null; // the capture source is closing; nothing to disconnect
      recHandle = null;
    }
  });

  /** Milliseconds until Record is allowed (0 = now; null = not listening). */
  function readyInMs() {
    const h = getVoicePreviewCapture();
    if (!h) return null;
    return Math.max(0, h.startedAt + LISTEN_BEFORE_RECORD_MS - now());
  }

  function record() {
    if (!worker || !RECORDABLE.has(state.phase)) return false;
    const h = getVoicePreviewCapture();
    if (!h || readyInMs() > 0) return false;
    const port = h.connect();
    recPort = port;
    recHandle = h;
    const w = worker;
    setVoicePreviewPitchTap((msg) => {
      w.postMessage({
        type: "pitch",
        contextTime: msg.contextTime,
        pitch: msg.pitch,
        notched: Array.isArray(msg.notchedFreqs) && msg.notchedFreqs.length > 0,
      });
    });
    w.postMessage({ type: "record", port, sampleRate: h.sampleRate, maxS: RECORD_MAX_S, minS: RECORD_MIN_S }, [port]);
    set({ phase: "recording", level: null, recordedSeconds: null, voicedS: null, error: null });
    return true;
  }

  function stop() {
    if (state.phase === "recording" && worker) worker.postMessage({ type: "stop" });
  }

  function cancel() {
    if (state.phase === "recording" && worker) worker.postMessage({ type: "cancel" });
  }

  /**
   * Re-render on commit. At most one render in flight and one waiting; a newer request
   * replaces the waiting one; a setting equal to the last rendered (or in-flight) one does nothing.
   */
  function render(st, pct) {
    if (state.phase !== "preview" || !worker) return false;
    const same = (r) => r && r.st === st && r.pct === pct;
    if (state.rendering) {
      if (same(state.rendering)) { waitingRender = null; return false; }
      waitingRender = { st, pct };
      return true;
    }
    if (same(state.preview) || (!state.preview && st === 0 && pct === 0)) return false;
    sendRender(st, pct);
    return true;
  }

  /** Drop the recording and everything made from it; a fresh worker gets ready. */
  function discard() {
    terminate();
    set(initialState());
    spawn();
  }

  /**
   * Discard, then record as soon as the fresh worker is ready. Refused (nothing discarded,
   * returns false) while Record would have to wait or listening is off.
   */
  function recordAgain() {
    if (readyInMs() !== 0) return false;
    discard();
    pendingRecord = true;
    return true;
  }

  /** Page hide / teardown: terminate the worker and stop listening to the bridge. */
  function dispose() {
    terminate();
    unsubCapture();
    listeners.clear();
    state = initialState();
  }

  spawn();

  return {
    subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    getState: () => state,
    readyInMs,
    record, stop, cancel, render, discard, recordAgain, dispose,
  };
}
