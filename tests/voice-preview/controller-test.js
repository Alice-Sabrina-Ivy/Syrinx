// controller-test.js — Voice Shaper's main-thread controller with the REAL worker
// (src/voice-preview/vp-worker.js in a Node worker_threads thread, tests/voice-preview/
// fixtures/node-worker-shim.mjs) and the REAL bridge: the capture handle hands out a
// MessagePort per recording, the posted pitch arrives through voicePreviewPitchTap as
// useAudioPipeline calls it. Checks the 6 s listening wait, record -> preview with the
// spike's bytes, the capture consumer released when the recording ends, the render queue
// (one in flight, one waiting, newest wins, repeats ignored), listening stopping during a
// recording, and the worker lifecycle: discard / record again terminate the worker (its
// thread exits, so all of its WebAssembly memory is gone) and a fresh worker starts
// with the initial memory. Noise reduction: switching it with a preview on screen analyses
// the same recording again, keeps the original, re-renders the setting that was showing (or
// the one asked for meanwhile), survives Discard, and goes off when the model cannot load
// (DeepFilterNet 3; the parts that need its gitignored graphs are skipped without them).
// measurements/voice-preview-phase1-2026-10-19.md §3, §4; measurements/voice-shaper-denoise-2026-10-23.md.
//
//   node tests/voice-preview/controller-test.js
import { autoDenoise } from "../../src/voice-preview/checks.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { PARITY_JSON, GLUE_URL, WASM_URLS, DFN3_SOURCE, DFN3_MISSING, DFN3_HINT, ORT_WASM_PATHS, REPO, cellKey, makeInput, chunkFor, sha256, makeChecker } from "./vp-test-lib.js";
import { setVoicePreviewCapture, voicePreviewPitchTap } from "../../src/voice-preview/bridge.js";
import * as controller from "../../src/voice-preview/controller.js";
const { createVoicePreviewController, LISTEN_BEFORE_RECORD_MS } = controller;
const REARM_MS = controller.REARM_MS ?? 1000;

const T = makeChecker();
const fx = JSON.parse(readFileSync(PARITY_JSON, "utf8"));
const f = fx.inputs.find((i) => i.name === "ls_woman_high@16000");
const { pcm, rate } = makeInput({ clip: "ls_woman_high", rate: 16000 });
const track = Float32Array.from(f.track);
const C = chunkFor(rate);
const N = pcm.length / C;
const SHIM = new URL("./fixtures/node-worker-shim.mjs", import.meta.url);
const WORKER_URL = pathToFileURL(path.join(REPO, "src/voice-preview/vp-worker.js")).href;

// ---- a Web-Worker-shaped adapter over worker_threads ----
const workers = [];
class NodeWorker {
  constructor() {
    this.w = new Worker(SHIM, { workerData: { url: WORKER_URL } });
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    this.exited = new Promise((r) => this.w.on("exit", () => r(true)));
    this.w.on("message", (data) => this.onmessage?.({ data }));
    this.w.on("error", (e) => this.onerror?.(e));
    workers.push(this);
  }
  postMessage(m, transfer) { this.w.postMessage(m, transfer); }
  terminate() { this.terminated = true; this.w.terminate(); }
}

// ---- the capture handle (as useAudioPipeline registers it) ----
let clock = 100000;
const consumers = [];
const disconnected = [];
function listen({ sinceMs = 10000 } = {}) {
  setVoicePreviewCapture({
    sampleRate: rate,
    connect() { const ch = new MessageChannel(); consumers.push(ch.port1); this.lastPort = ch.port2; return ch.port2; },
    disconnect(p) { disconnected.push(p); },
    startedAt: clock - sinceMs,
  });
}
const ct = (k) => 50 + (k + 1) * C / rate;
function chunk(k) {
  const b = Float32Array.from(pcm.subarray(k * C, (k + 1) * C)).buffer;
  consumers.at(-1).postMessage({ buffer: b, contextTime: ct(k) }, [b]);
}
// what useAudioPipeline's handlePitchMessage passes on (the posted message itself)
const posted = (k, extra = {}) => voicePreviewPitchTap({ type: "pitch", pitch: track[k] > 0 ? track[k] : null, confidence: track[k] > 0 ? 0.8 : 0.2, voiced: track[k] > 0, ts: 0, contextTime: ct(k), ...extra });

async function until(ctl, pred, label, timeoutMs = 30000) {
  const t0 = Date.now();
  while (!pred(ctl.getState())) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout: ${label} (phase ${ctl.getState().phase}, error ${JSON.stringify(ctl.getState().error)})`);
    await new Promise((r) => setTimeout(r, 5));
  }
  return ctl.getState();
}
const tick = () => new Promise((r) => setTimeout(r, 20));

async function recordClip(ctl) {
  T.check("record() starts a recording", ctl.record() === true && ctl.getState().phase === "recording");
  for (let k = 0; k < N; k++) {
    chunk(k);
    if (k >= 2) posted(k - 2, k - 2 === 10 ? { notchedFreqs: [120] } : {});
    if (k % 50 === 49) await tick();
  }
  await tick();
  // wait until the worker has taken in the chunks before Stop: Stop travels on the worker's own
  // port, the chunks on the capture port, and two ports keep no order between them (a recording
  // in the app lasts >= 3 s; this one is fed in ~0.1 s)
  await until(ctl, (s) => (s.level?.seconds ?? 0) >= (N - 4) * C / rate, "chunks taken in");
  ctl.stop();
  await until(ctl, (s) => s.phase === "analysing", "analysing");
  posted(N - 2); posted(N - 1);
  return until(ctl, (s) => s.phase === "preview", "preview");
}

const ctl = createVoicePreviewController({
  createWorker: () => new NodeWorker(), glueUrl: GLUE_URL, wasmUrls: WASM_URLS, dfn3Source: DFN3_SOURCE, ortWasmPaths: ORT_WASM_PATHS, now: () => clock,
});
const phases = [];
ctl.subscribe((s) => { if (phases.at(-1) !== s.phase) phases.push(s.phase); });

console.log("loading and the listening wait");
let s = await until(ctl, (st) => st.phase === "ready", "ready");
T.check("worker ready (SIMD build)", s.build === "simd" && s.memBytes > 0, `${s.build}, ${s.loadMs?.toFixed(0)} ms`);
const memInitial = s.memBytes;
T.check("not listening: readyInMs null, record() refused", ctl.readyInMs() === null && ctl.record() === false);
listen({ sinceMs: 2000 });
T.check(`listening for 2 s: Record waits ${LISTEN_BEFORE_RECORD_MS / 1000} s in all`, ctl.readyInMs() === LISTEN_BEFORE_RECORD_MS - 2000 && ctl.record() === false);
clock += LISTEN_BEFORE_RECORD_MS - 2000;
T.check("after 6 s of listening: ready", ctl.readyInMs() === 0);

console.log("\nrecord -> preview");
T.check("noise reduction: auto by default", ctl.getState().denoiseMode === "auto" && ctl.getState().denoise === false);
T.check("setDenoise(false) while the switch shows off: no change for the take, the setting becomes off", ctl.setDenoise(false) === false && ctl.getState().denoiseMode === "off");
s = await recordClip(ctl);
const port1 = disconnected.at(-1);
T.check("the capture consumer is released when the recording ends", disconnected.length === 1 && port1 !== undefined);
T.check("rebuild = the spike's (0, 0) render", sha256(s.rebuild) === f.expected.simd[cellKey(0, 0)]);
T.check("original kept at the capture rate", sha256(s.original) === f.pcmSha256 && s.analysis.captureRate === 16000);
T.check("hum flag from the tap's notchedFreqs", s.analysis.check.hum === true && s.analysis.check.noise === false);
T.check("phases: loading, ready, recording, analysing, preview", phases.join() === "loading,ready,recording,analysing,preview", phases.join());
const memAnalysed = s.analysis.memBytes;

console.log("\nrender queue");
let rendered = 0;
const unsub = ctl.subscribe((st) => { if (st.preview && st.preview !== s.preview) { rendered++; s = st; } });
T.check("render(0, 0) before any preview: nothing (that is the rebuild)", ctl.render(0, 0) === false);
T.check("render(+2, +3) starts", ctl.render(2, 3) === true && ctl.getState().rendering?.st === 2);
T.check("render(+4, 0) waits", ctl.render(4, 0) === true);
T.check("render(0, +6) replaces the waiting one", ctl.render(0, 6) === true);
await until(ctl, (st) => st.preview?.st === 0 && st.preview?.pct === 6 && !st.rendering, "queued render");
T.check("two renders ran (+2/+3, then 0/+6); +4/0 never did", rendered === 2, `${rendered} renders`);
T.check("the latest preview is the spike's (0, +6) render", sha256(ctl.getState().preview.pcm) === f.expected.simd[cellKey(0, 6)]);
T.check("a commit equal to the last render does nothing", ctl.render(0, 6) === false);
unsub();

console.log("\nnoise reduction with a preview on screen");
if (!DFN3_SOURCE) console.log(`  SKIP the DeepFilterNet 3 graphs are not in build/models/dfn3 (${DFN3_HINT})`);
else {
  const before = ctl.getState();
  T.check("off (the setting): not noise-reduced", before.denoise === false && before.analysis.denoised === false && before.analysis.auto === false);
  T.check("setDenoise(true) -> re-analysing", ctl.setDenoise(true) === true && ctl.getState().denoise === true && ctl.getState().reanalysing === true);
  T.check("a render asked for while re-analysing waits (nothing in flight)", ctl.render(2, 3) === true && ctl.getState().rendering === null);
  let st = await until(ctl, (x) => !x.reanalysing && x.preview?.st === 2 && x.preview?.pct === 3 && !x.rendering, "denoised preview");
  T.check("analysed again with DeepFilterNet 3: same take, same original, phase stays preview",
    st.analysis.denoised === true && st.analysis.take === before.analysis.take && st.original === before.original && st.phase === "preview"
    && phases.at(-1) === "preview");
  T.check("…a new rebuild, and the waiting setting rendered on it", sha256(st.rebuild) !== f.expected.simd[cellKey(0, 0)] && sha256(st.preview.pcm) !== f.expected.simd[cellKey(2, 3)]);
  T.check("setDenoise(true) again does nothing", ctl.setDenoise(true) === false);
  T.check("setDenoise(false) -> re-analysing", ctl.setDenoise(false) === true && ctl.getState().reanalysing === true);
  st = await until(ctl, (x) => !x.reanalysing && x.preview && !x.rendering, "plain preview again");
  T.check("off again: the spike's rebuild, and the showing setting (+2, +3) re-rendered: the spike's bytes",
    st.analysis.denoised === false && sha256(st.rebuild) === f.expected.simd[cellKey(0, 0)] && st.preview.st === 2 && st.preview.pct === 3
    && sha256(st.preview.pcm) === f.expected.simd[cellKey(2, 3)]);
  T.check("…the original is still the recording", sha256(st.original) === f.pcmSha256);
  s = st;
}

console.log("\ndiscard: the worker is terminated and a fresh one starts");
const w1 = workers.at(-1);
if (DFN3_SOURCE) {
  ctl.setDenoise(true);
  await until(ctl, (x) => !x.reanalysing, "re-analysed before discard");
}
ctl.discard();
if (DFN3_SOURCE) T.check("discard keeps the noise-reduction setting", ctl.getState().denoise === true && ctl.getState().reanalysing === false && ctl.getState().denoiseError === false);
T.check("discard clears the recording and its renders", ctl.getState().original === null && ctl.getState().rebuild === null && ctl.getState().preview === null && ctl.getState().analysis === null);
T.check("the old worker's thread exits (its WebAssembly memory is gone)", w1.terminated && await Promise.race([w1.exited, new Promise((r) => setTimeout(() => r(false), 5000))]));
s = await until(ctl, (st) => st.phase === "ready", "fresh ready");
const w2 = workers.at(-1);
T.check("a fresh worker is ready", w2 !== w1 && !w2.terminated);
T.check("…with the initial WebAssembly memory, below the analysed worker's", s.memBytes === memInitial && s.memBytes < memAnalysed,
  `fresh ${(s.memBytes / 1e6).toFixed(1)} MB, analysed ${(memAnalysed / 1e6).toFixed(1)} MB`);
T.check("render() without a preview does nothing", ctl.render(2, 3) === false);
if (DFN3_SOURCE) T.check("setDenoise(false) without a recording: just the setting", ctl.setDenoise(false) === true && ctl.getState().denoise === false && !ctl.getState().reanalysing);

console.log("\nlistening stops during a recording");
T.check("record() again", ctl.record() === true);
for (let k = 0; k < 40; k++) chunk(k);
await tick();
setVoicePreviewCapture(null);
s = await until(ctl, (st) => st.phase === "cancelled", "cancelled");
T.check("-> cancelled; no analysis", s.analysis === null && s.original === null);
listen();
T.check("listening again, right after the cancel: Record re-arming, refused", s.rearming === true && ctl.record() === false);
s = await until(ctl, (st) => !st.rearming, "re-armed after the cancel", REARM_MS + 2000);
T.check("listening again: the same worker can record", ctl.record() === true);
ctl.cancel();
await until(ctl, (st) => st.phase === "cancelled", "cancelled 2");
await until(ctl, (st) => !st.rearming, "re-armed after cancelled 2", REARM_MS + 2000);

console.log("\nrecord again from a finished preview");
s = await recordClip(ctl);
const memSecond = s.analysis.memBytes;
const w3 = workers.at(-1);
T.check("Record again right after the preview appeared: refused, the preview kept", ctl.recordAgain() === false && !w3.terminated && ctl.getState().phase === "preview");
await until(ctl, (st) => !st.rearming, "re-armed after the preview", REARM_MS + 2000);
ctl.recordAgain();
T.check("record again terminates the worker", w3.terminated && await Promise.race([w3.exited, new Promise((r) => setTimeout(() => r(false), 5000))]));
s = await until(ctl, (st) => st.phase === "recording", "recording after record again");
const w4 = workers.at(-1);
T.check("…and records with a fresh worker as soon as it is ready", w4 !== w3);
ctl.cancel();
await until(ctl, (st) => st.phase === "cancelled", "cancelled 3");

console.log("\nmemory");
T.check("each analysis grew its worker's memory from the initial size", memAnalysed > memInitial && memSecond > memInitial,
  `initial ${(memInitial / 1e6).toFixed(1)} MB, after the analyses ${(memAnalysed / 1e6).toFixed(1)} / ${(memSecond / 1e6).toFixed(1)} MB`);

ctl.dispose();
T.check("dispose terminates the worker", workers.at(-1).terminated);

console.log("\nauto: noise reduction when the level margin is below DENOISE_MARGIN_DB, the track re-made");
if (!DFN3_SOURCE) console.log(`  SKIP the DeepFilterNet 3 graphs are not in build/models/dfn3 (${DFN3_HINT})`);
else {
  const auto = createVoicePreviewController({
    createWorker: () => new NodeWorker(), glueUrl: GLUE_URL, wasmUrls: WASM_URLS, dfn3Source: DFN3_SOURCE, ortWasmPaths: ORT_WASM_PATHS, now: () => clock,
  });
  await until(auto, (x) => x.phase === "ready", "ready (auto)");
  const st = await recordClip(auto);
  const want = autoDenoise(st.analysis.check.marginDb);
  T.check("auto decided by the recording's margin; the switch shows it", st.analysis.auto === true && st.analysis.denoised === want && st.denoise === want && st.denoiseMode === "auto",
    `margin ${st.analysis.check.marginDb.toFixed(1)} dB -> ${want}`);
  if (want) {
    T.check("…noise-reduced with the track re-made by the pitch worker", st.analysis.retracked === true && st.analysis.ms.retrack > 0 && sha256(st.rebuild) !== f.expected.simd[cellKey(0, 0)]);
    T.check("…the worker reported its stages (the analysis stage cleared after)", st.analysingStage === null);
    T.check("…the original is the recording", sha256(st.original) === f.pcmSha256);
    T.check("switching it off: the user's setting", auto.setDenoise(false) === true && auto.getState().denoiseMode === "off");
    const off = await until(auto, (x) => !x.reanalysing && x.rebuild && x.analysis.denoised === false, "auto -> off");
    T.check("…not noise-reduced, not re-tracked: the spike's rebuild", off.analysis.retracked === false && sha256(off.rebuild) === f.expected.simd[cellKey(0, 0)]);
  }
  await until(auto, (x) => !x.rearming, "re-armed (auto)", REARM_MS + 2000);
  auto.discard();
  T.check("discard keeps the user's setting", auto.getState().denoiseMode === (want ? "off" : "auto"));
  auto.dispose();
}

console.log("\nthe model cannot load");
{
  const bad = createVoicePreviewController({
    createWorker: () => new NodeWorker(), glueUrl: GLUE_URL, wasmUrls: WASM_URLS,
    dfn3Source: DFN3_MISSING, ortWasmPaths: ORT_WASM_PATHS, now: () => clock,
  });
  await until(bad, (x) => x.phase === "ready", "ready (missing model files)");
  T.check("setDenoise(true) before recording", bad.setDenoise(true) === true);
  const st = await recordClip(bad);
  const fin = await until(bad, (x) => !x.reanalysing, "final analysis");
  T.check("-> preview without noise reduction: the setting off, denoiseError set, the spike's rebuild",
    fin.phase === "preview" && fin.denoise === false && fin.denoiseError === true && fin.analysis.denoised === false
    && sha256(fin.rebuild) === f.expected.simd[cellKey(0, 0)], `${st.phase} ${fin.denoise} ${fin.denoiseError}`);
  T.check("…setDenoise(true) is refused while it is unavailable", bad.setDenoise(true) === false && bad.getState().reanalysing === false);
  bad.dispose();
}
await Promise.all(workers.map((w) => w.exited));
setVoicePreviewCapture(null);
T.done();
