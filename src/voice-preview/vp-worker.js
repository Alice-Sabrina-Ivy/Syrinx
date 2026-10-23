// vp-worker.js — Voice Shaper's module Worker: records, analyses once, renders on
// demand. measurements/voice-preview-phase1-2026-10-19.md §3–§5, §7.
//
// One worker per card session. All audio stays here and in the main thread's memory;
// every PCM buffer crosses the boundary as a transferable. WebAssembly memory grows and
// never shrinks: the app releases it by terminating this worker (Discard, Record again,
// page hide) and starting a fresh one.
//
// No `?url` imports here: the main thread passes the glue and .wasm URLs in `init`, so
// Node tests drive this file with file URLs (tests/voice-preview/worker-test.js).
//
// Main thread -> worker:
//   init    { glueUrl, wasmUrls: { simd, nosimd }, rnnoiseUrl? }
//             SIMD build where the SIMD probe validates, else non-SIMD; a SIMD build that
//             fails to compile or instantiate is retried once with the non-SIMD build.
//             The RNNoise module (rnnoiseUrl) is fetched only when noise reduction is first used.
//             -> ready { build, ms, memBytes } | error { stage: "load" }
//   record  { port (transferred), sampleRate, maxS = 8, minS = 3, trackTimeoutMs = 500, denoise = false }
//             collects capture chunks ({ buffer, contextTime }) from the port;
//             -> level { rms, peak, seconds } every 4th chunk; at the cap
//             -> recorded { seconds, reason: "max" }
//   stop    -> recorded { seconds, reason: "user" } | too-short { seconds }
//   cancel  -> cancelled { seconds } (the recording is dropped)
//   pitch   { contextTime, pitch (Hz | null), notched } — one forwarded posted value
//   render  { id, st, pct } -> rendered { id, st, pct, pcm (transferred), rate, ms }
//   denoise { on } — background-noise reduction (RNNoise, ./denoise.js) for the engine's input:
//             during a recording it applies to that recording's analysis; with a preview it
//             re-analyses the same recording and posts `analysed` again (no `original`). A
//             change that arrives while an analysis runs is applied right after it.
// Worker -> main thread, after the recording ends and its posted track is complete
// (the last chunk's value arrived, or trackTimeoutMs after the end; missing values = 0):
//   analysed { take, denoised, rate, captureRate, seconds, check { hum, noise, marginDb, voicedS },
//              pitch { medianHz, p5Hz }, limits { stMin, stMax, pctMin, pctMax },
//              hops { recorded, received }, ms, memBytes, original?, rebuild }
//            (take: the recording's number in this worker, the same on a re-analysis;
//             denoised: the engine's input went through RNNoise. The recording check, the
//             posted track and `original` always come from the recording as captured.
//             original: float32 at the capture rate — at the engine rate above 96 kHz — on
//             a take's first analysis only; rebuild: the unchanged rebuild, float32 at the
//             engine rate; both transferred)
//   denoise-error { message } — RNNoise could not load or run: the analysis went ahead
//             without it (denoised: false) and noise reduction is off in this worker
//   no-voice { voicedS, check }
//   error    { stage: "load" | "record" | "analyse" | "render", kind: "memory" | "other", message, id? }
import { createWorld, simdSupported } from "./engine/world.js";
import { PreviewEngine } from "./engine/preview.js";
import { createRecorder } from "./recorder.js";
import { recordingCheck } from "./checks.js";
import { pitchStats, pitchLimits } from "./controls.js";
import { resampleClip, engineRateFor } from "./engine/preview.js";
import { loadRnnoise, denoiseClip } from "./denoise.js";

const now = () => performance.now();
const ORIGINAL_MAX_RATE = 96000;

let world = null;
let build = null;
let engine = null;
let recorder = null;
let port = null;
let trackTimer = null;
let trackTimeoutMs = 500;
let phase = "loading"; // loading | idle | recording | waiting | analysing | ready | failed
let rnnoiseUrl = null;
let rnnoise = null;     // Promise of the loaded RNNoise module (first use)
let denoiseOn = false;  // noise reduction for the engine's input
let denoiseBroken = false;
let take = 0;
let last = null;        // the take being previewed: what a re-analysis needs (recording as captured)

function send(msg, transfer) {
  if (transfer && transfer.length) self.postMessage(msg, transfer);
  else self.postMessage(msg);
}

/**
 * Memory failures: a failed malloc (WorldMemoryError), a JS RangeError (typed-array
 * allocation), or — during analysis or rendering — a WebAssembly abort (in this build only
 * a failed operator new inside WORLD aborts). A module that fails to load is never "memory".
 */
function errorKind(stage, err) {
  if (stage === "load") return "other";
  if (err && (err.kind === "memory" || err instanceof RangeError)) return "memory";
  const s = String((err && err.message) || err);
  return /out of memory|Aborted\(|could not allocate/i.test(s) ? "memory" : "other";
}

function fail(stage, err, extra = {}) {
  send({ type: "error", stage, kind: errorKind(stage, err), message: String((err && (err.stack || err.message)) || err), ...extra });
}

async function loadBuild(glueUrl, wasmUrl) {
  const { default: factory } = await import(/* @vite-ignore */ glueUrl);
  const mod = await factory({
    locateFile: (p) => (p.endsWith(".wasm") ? wasmUrl : p),
    // the glue prints instantiation failures; the caller reports them
    printErr: () => {},
  });
  return createWorld(mod);
}

async function init(m) {
  const t0 = now();
  rnnoiseUrl = m.rnnoiseUrl ?? null;
  const order = simdSupported() ? ["simd", "nosimd"] : ["nosimd"];
  let lastErr = null;
  for (const b of order) {
    try {
      world = await loadBuild(m.glueUrl, m.wasmUrls[b]);
      build = b;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!world) {
    phase = "failed";
    fail("load", lastErr);
    return;
  }
  engine = new PreviewEngine(world);
  phase = "idle";
  send({ type: "ready", build, ms: now() - t0, memBytes: world.memoryBytes() });
}

function closePort() {
  if (!port) return;
  port.onmessage = null;
  try { port.close(); } catch { /* already closed */ }
  port = null;
}

function onChunk(e) {
  const d = e.data;
  if (!d || !d.buffer || phase !== "recording") return;
  const r = recorder.pushChunk(new Float32Array(d.buffer), d.contextTime);
  if (r.level) send({ type: "level", ...r.level });
  if (r.stopped === "max") ended("max");
}

function record(m) {
  if (phase !== "idle") {
    closeTransferredPort(m.port);
    fail("record", new Error(`cannot record while ${phase}`));
    return;
  }
  try {
    recorder = createRecorder({ sampleRate: m.sampleRate, maxS: m.maxS ?? 8, minS: m.minS ?? 3 });
  } catch (err) {
    closeTransferredPort(m.port);
    fail("record", err);
    return;
  }
  trackTimeoutMs = m.trackTimeoutMs ?? 500;
  denoiseOn = !!m.denoise;
  port = m.port;
  port.onmessage = onChunk;
  if (typeof port.start === "function") port.start();
  phase = "recording";
}

function closeTransferredPort(p) {
  if (!p) return;
  try { p.close(); } catch { /* ignore */ }
}

/** The recording ended (user Stop or the cap): too short, or wait for the posted track. */
function ended(reason) {
  closePort();
  const seconds = recorder.seconds;
  if (reason === "user") recorder.stop("user");
  if (recorder.tooShort()) {
    recorder = null;
    phase = "idle";
    send({ type: "too-short", seconds });
    return;
  }
  phase = "waiting";
  send({ type: "recorded", seconds, reason });
  if (recorder.trackComplete()) { analyse(); return; }
  trackTimer = setTimeout(() => { trackTimer = null; if (phase === "waiting") analyse(); }, trackTimeoutMs);
}

function cancel() {
  closePort();
  if (trackTimer) { clearTimeout(trackTimer); trackTimer = null; }
  const seconds = recorder ? recorder.seconds : 0;
  if (phase === "recording" || phase === "waiting") {
    recorder = null;
    phase = "idle";
  }
  send({ type: "cancelled", seconds });
}

function onPitch(m) {
  if (!recorder || (phase !== "recording" && phase !== "waiting")) return;
  recorder.addPitch(m);
  if (phase === "waiting" && recorder.trackComplete()) analyse();
}

function analyse() {
  if (trackTimer) { clearTimeout(trackTimer); trackTimer = null; }
  phase = "analysing";
  const rec = recorder;
  recorder = null;
  rec.finalise();
  const t0 = now();
  const pcm = rec.pcm();
  const track = rec.track();
  const sr = rec.sampleRate;
  const hops = { recorded: rec.chunks, received: rec.received() };
  let check;
  try {
    check = recordingCheck({ pcm, sampleRate: sr, track, notched: rec.notched() });
  } catch (err) {
    phase = "failed";
    fail("analyse", err);
    return;
  }
  const checkMs = now() - t0;
  const seconds = rec.seconds;
  const checkOut = { hum: check.hum, noise: check.noise, marginDb: check.marginDb, voicedS: check.voicedS };
  if (!check.enoughVoice) {
    phase = "idle";
    send({ type: "no-voice", voicedS: check.voicedS, check: checkOut, hops });
    return;
  }
  last = { take: ++take, pcm, sr, track, seconds, check: checkOut, hops, checkMs };
  return guarded(runAnalysis(true));
}

/** An analysis runs asynchronously once RNNoise is involved: its failures still end in `error`. */
function guarded(p) {
  return p.catch((err) => {
    phase = "failed";
    fail("analyse", err);
  });
}

/** The RNNoise module, loaded on first use; null when it cannot load (reported once). */
async function getRnnoise() {
  if (denoiseBroken || !rnnoiseUrl) return null;
  if (!rnnoise) rnnoise = loadRnnoise(rnnoiseUrl);
  try {
    return await rnnoise;
  } catch (err) {
    denoiseBroken = true;
    send({ type: "denoise-error", message: String((err && err.message) || err) });
    return null;
  }
}

/**
 * The engine part of an analysis of `last`: the recording as captured, or (noise reduction on)
 * RNNoise's version of it, with the same posted track. first: the take's first analysis (it
 * sends `original`). A noise-reduction change that came in meanwhile runs right after.
 */
async function runAnalysis(first) {
  phase = "analysing";
  const L = last;
  const ms = {};
  let input = L.pcm;
  let denoised = false;
  if (denoiseOn) {
    const rn = await getRnnoise();
    if (L !== last) return; // a newer take replaced this one while the module loaded
    if (rn) {
      try {
        const t = now();
        input = denoiseClip(rn, L.pcm, L.sr);
        ms.denoise = now() - t;
        denoised = true;
      } catch (err) {
        denoiseBroken = true;
        send({ type: "denoise-error", message: String((err && err.message) || err) });
      }
    }
    if (!denoised) denoiseOn = false;
  }
  try {
    const r = engine.analyse(input, L.sr, L.track);
    Object.assign(ms, r.ms);
    ms.check = L.checkMs;
    const stats = pitchStats(L.track);
    const limits = pitchLimits(stats.p5Hz);
    const msg = {
      type: "analysed", take: L.take, denoised, rate: r.rate, captureRate: L.sr, seconds: L.seconds, check: L.check,
      pitch: { medianHz: stats.medianHz, p5Hz: stats.p5Hz }, limits, hops: L.hops, ms,
      memBytes: engine.memoryBytes(), rebuild: r.rebuild,
    };
    const transfer = [r.rebuild.buffer];
    if (first) {
      // as captured, whatever the engine's input was (resampleClip is what the engine does above 96 kHz)
      const original = L.sr > ORIGINAL_MAX_RATE ? resampleClip(L.pcm, L.sr, engineRateFor(L.sr)) : L.pcm.slice();
      msg.original = original;
      transfer.push(original.buffer);
    }
    phase = "ready";
    send(msg, transfer);
  } catch (err) {
    phase = "failed";
    try { engine.free(); } catch { /* the module may have aborted */ }
    fail("analyse", err);
    return;
  }
  if (denoiseOn !== denoised && !(denoiseOn && denoiseBroken)) return runAnalysis(false);
}

/** Noise reduction on / off: kept for the recording in progress, or applied to the preview now. */
function setDenoise(m) {
  const on = !!m.on && !denoiseBroken;
  if (m.on && denoiseBroken) send({ type: "denoise-error", message: "noise reduction is unavailable in this worker" });
  if (on === denoiseOn) return;
  denoiseOn = on;
  if (phase === "ready" && last) return guarded(runAnalysis(false));
}

function render(m) {
  if (phase !== "ready") {
    fail("render", new Error(`no preview to render (${phase})`), { id: m.id });
    return;
  }
  try {
    const { pcm, ms } = engine.render(m.st, m.pct);
    send({ type: "rendered", id: m.id, st: m.st, pct: m.pct, pcm, rate: engine.rate, ms }, [pcm.buffer]);
  } catch (err) {
    fail("render", err, { id: m.id });
  }
}

self.onmessage = (e) => {
  const m = e.data;
  if (!m || !m.type) return;
  try {
    if (m.type === "init") return init(m);
    if (m.type === "record") return record(m);
    if (m.type === "stop") { if (phase === "recording") ended("user"); return; }
    if (m.type === "cancel") return cancel();
    if (m.type === "pitch") return onPitch(m);
    if (m.type === "render") return render(m);
    if (m.type === "denoise") return setDenoise(m);
  } catch (err) {
    fail(m.type === "init" ? "load" : m.type === "render" ? "render" : m.type === "pitch" || m.type === "denoise" ? "analyse" : "record", err);
  }
};
