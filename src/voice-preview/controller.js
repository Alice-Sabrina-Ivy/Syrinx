// controller.js — main-thread side of Voice Shaper: worker lifecycle, recording
// control (capture consumer + posted-pitch tap through bridge.js), render queue.
// A small observable store, like resonance-lab/labPipeline.js, created once by the card
// and kept for the page visit (it survives view and tab switches).
// measurements/voice-preview-phase1-2026-10-19.md §3, §4.
//
// createVoicePreviewController({ createWorker, glueUrl, wasmUrls, rnnoiseUrl }) — the card
// passes a factory for the module Worker (src/voice-preview/vp-worker.js) and the asset URLs
// (wasm-files.js); Node tests pass a worker_threads adapter and file URLs.
// Noise reduction (2026-10-23, measurements/voice-shaper-denoise-2026-10-23.md): setDenoise(on)
// is the user's setting for the page visit (kept through Discard / Record again). A recording
// is analysed with the setting it had when it ended; changing it with a preview on screen
// re-analyses the same recording (`reanalysing`), keeps the original, and renders the setting
// that was showing (or the newest one asked for meanwhile) again. When the worker reports that
// RNNoise cannot load, the setting goes off and `denoiseError` stays set for that worker.
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
// Re-arm (2026-10-21): the card's one button turns from Stop into Record / Record again in
// the same place, so a press that belongs to stopping (a finger that touches down again, a
// second tap because the label changed under it, a held Enter key repeating) used to start
// a new recording at once — on a phone that recording of silence ended "There wasn't enough
// voice…". When a recording ends (the phase leaves recording / analysing for a phase whose
// button can act), `rearming` is true for REARM_MS and record() / recordAgain() refuse.
import { getVoicePreviewCapture, onVoicePreviewCapture, setVoicePreviewPitchTap } from "./bridge.js";

export const RECORD_MAX_S = 8;
export const RECORD_MIN_S = 3;
/** Record waits until listening has run this long, so the tonal-noise notch can flag a hum (§1, §7). */
export const LISTEN_BEFORE_RECORD_MS = 6000;
/** Loading (worker start -> ready) longer than this is a load error. */
export const LOAD_TIMEOUT_MS = 30000;
/** `recorded` -> `analysed` longer than this (500 ms track wait + analysis, ~2.3 s for 8 s on the gate phone) is an error. */
export const ANALYSE_TIMEOUT_MS = 20000;
/** After a recording ends, Record / Record again ignore presses this long (the press that stopped it). */
export const REARM_MS = 1000;

const RECORDABLE = new Set(["ready", "too-short", "no-voice", "cancelled"]);
/** Phases whose one button can act (Record, or Record again). */
const ACTIONABLE = new Set([...RECORDABLE, "preview", "error", "memory"]);

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
    rearming: false,      // true for REARM_MS after a recording ended: Record / Record again wait
    denoise: false,       // noise reduction (the user's setting; initialState() is patched to keep it)
    reanalysing: false,   // the preview's recording is being analysed again (noise reduction changed)
    denoiseError: false,  // RNNoise could not load or run in this worker
  };
}

export function createVoicePreviewController({
  createWorker, glueUrl, wasmUrls, rnnoiseUrl = null, now = () => performance.now(),
  loadTimeoutMs = LOAD_TIMEOUT_MS, analyseTimeoutMs = ANALYSE_TIMEOUT_MS, rearmMs = REARM_MS,
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
  let rearmTimer = null;

  function set(patch) {
    const was = state.phase;
    state = { ...state, ...patch };
    // the recording ended and the button can act again: it re-arms after rearmMs
    if ((was === "recording" || was === "analysing") && ACTIONABLE.has(state.phase) && rearmMs > 0) {
      if (rearmTimer !== null) clearTimer(rearmTimer);
      state = { ...state, rearming: true };
      rearmTimer = setTimer(() => { rearmTimer = null; set({ rearming: false }); }, rearmMs);
    }
    for (const fn of listeners) fn(state);
  }

  function clearRearm() {
    if (rearmTimer !== null) { clearTimer(rearmTimer); rearmTimer = null; }
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
      set({ phase, rendering: null, level: null, error: { stage, kind: "timeout", message: `Voice Shaper worker did not answer within ${ms} ms (${inPhase})` } });
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
      set({ phase: state.phase === "loading" ? "load-error" : "error", error: { stage: "worker", kind: "other", message: e?.message || "Voice Shaper worker failed" } });
    };
    w.postMessage({ type: "init", glueUrl, wasmUrls, rnnoiseUrl });
    watch(loadTimeoutMs, "loading", "load-error", "load");
  }

  function terminate() {
    workerGen++;
    unwatch();
    clearRearm();
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
        // the worker analyses again until its input matches the setting: only that one is final
        const final = !!analysis.denoised === (state.denoise && !state.denoiseError);
        if (state.phase === "preview" && state.analysis && analysis.take === state.analysis.take) {
          // the same recording analysed again (noise reduction changed): keep the original and
          // render the setting that was showing, or the newest one asked for meanwhile
          const want = waitingRender ?? (state.preview ? { st: state.preview.st, pct: state.preview.pct } : null);
          waitingRender = null;
          set({ analysis, rebuild, preview: null, rendering: null, reanalysing: !final });
          if (!final) { waitingRender = want; watch(analyseTimeoutMs, "preview", "error", "analyse"); }
          else if (want) render(want.st, want.pct);
          break;
        }
        set({ phase: "preview", analysis, original, rebuild, preview: null, rendering: null, reanalysing: !final });
        if (!final) watch(analyseTimeoutMs, "preview", "error", "analyse");
        break;
      }
      case "denoise-error": set({ denoise: false, denoiseError: true }); break;
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
    if (!worker || !RECORDABLE.has(state.phase) || state.rearming) return false;
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
    w.postMessage({ type: "record", port, sampleRate: h.sampleRate, maxS: RECORD_MAX_S, minS: RECORD_MIN_S, denoise: state.denoise }, [port]);
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
    if (state.reanalysing) { waitingRender = { st, pct }; return true; }
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

  /**
   * Noise reduction on / off. Refused (false) while RNNoise is unavailable in this worker, or
   * while nothing could use it yet (loading). With a preview the recording is analysed again.
   */
  function setDenoise(on) {
    on = !!on;
    if (on === state.denoise || (on && state.denoiseError)) return false;
    set({ denoise: on });
    if (!worker || state.phase === "loading") return true;
    worker.postMessage({ type: "denoise", on });
    if (state.phase === "preview") {
      set({ reanalysing: true });
      watch(analyseTimeoutMs, "preview", "error", "analyse");
    }
    return true;
  }

  /** Drop the recording and everything made from it; a fresh worker gets ready. The noise-reduction setting stays. */
  function discard() {
    const denoise = state.denoise || false;
    terminate();
    set({ ...initialState(), denoise });
    spawn();
  }

  /**
   * Discard, then record as soon as the fresh worker is ready. Refused (nothing discarded,
   * returns false) while Record would have to wait, listening is off, or the button is
   * re-arming after the recording ended.
   */
  function recordAgain() {
    if (readyInMs() !== 0 || state.rearming) return false;
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
    record, stop, cancel, render, setDenoise, discard, recordAgain, dispose,
  };
}
