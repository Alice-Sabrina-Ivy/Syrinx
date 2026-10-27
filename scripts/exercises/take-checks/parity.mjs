// parity.mjs — before any candidate number (measurements/exercise-take-checks-2026-10-27.md
// §1 "Chain"): on one input, the frames the harness counts are the frames the real hook
// hands exerciseFrameTap.
//
//   SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs \
//     scripts/exercises/take-checks/parity.mjs [--src=build/exercise-take-checks/tree/src] \
//     [--take=sel|<reader>|double|0] [--cond=noisy] [--out=build/exercise-take-checks/parity.txt]
//
// One worker run (chain.mjs runWorkers: real pitch worker + FireRedVAD, real DSP worker), then
// the same messages through three hook drives:
//   H  the harness path (chain.mjs driveHookTap: handlePitchMessage / handleAnalysisResult
//      called through the hook's refs, the tap installed) — what run.mjs counts;
//   P  the app's path: the REAL hook's start() with a fake capture (MSTP) and fake Worker
//      shells (as tests/exercises/frame-tap-hook-test.js), the messages delivered to the
//      hook's own pitch-worker / DSP-worker onmessage handlers, the exercises tap installed
//      directly with setExerciseFrameTap and a session-recording frame callback set;
//   O  the session oracle's own drive (lib/voice-gate.mjs runWorkersVad + buildFramesVad +
//      lib/chain.mjs driveHook) on the same samples: an independent worker run and its
//      recorded f0 / detector decision per display hop.
// Checks: H and P tap the same frames in the same order (every field); in P the tap gets the
// very objects the frame callback gets; H's counted set is exactly the tapped frames that
// arrive in the window and a / b recomputed from P's frames agree; H's f0 per hop equals O's
// recorded f0 and H's voiceGate equals O's decision on every hop.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { M } from "../../session-oracle/lib/react-mock.mjs";
import { loadChain, runWorkers, driveHookTap, inWindow, counts } from "./chain.mjs";
import { positiveTakes, renderPositive, RATE } from "./stimuli.mjs";
import { runWorkersVad, buildFramesVad } from "../../session-oracle/lib/voice-gate.mjs";
import { driveHook } from "../../session-oracle/lib/chain.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const SRC = args.src ?? "build/exercise-take-checks/tree/src";
const OUTF = resolve(args.out ?? "build/exercise-take-checks/parity.txt");
const COND = args.cond ?? "noisy";
const lines = [];
const log = (s = "") => { lines.push(s); console.log(s); };
let fails = 0;
const check = (name, ok, detail = "") => { if (!ok) fails++; log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

const MODE = args.mode ?? "all";
// The app path's fakes (P) must exist before the hook's imports are first evaluated
// (captureSource.js decides MSTP support once, at import). In "h-only" mode (the child
// process below) none are installed: the harness path exactly as run.mjs runs it.
const workers = [];
if (MODE !== "h-only") {
  class FakeWorker {
    constructor(url) { this.url = String(url); this.onmessage = null; this.onerror = null; this.sent = []; workers.push(this); }
    postMessage(m) { this.sent.push(m?.type ?? m); }
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
    send(data) { this.onmessage?.({ data }); }
  }
  globalThis.Worker = FakeWorker;
  globalThis.AudioData = class {};
  globalThis.MediaStreamTrackProcessor = class {
    constructor() {
      let first = true; let cancelResolve = null;
      this.readable = { getReader: () => ({
        read: () => (first
          ? (first = false, Promise.resolve({ done: false, value: { timestamp: 0, duration: 25000, sampleRate: RATE, numberOfFrames: 1200, numberOfChannels: 1, format: "f32-planar", copyTo() {}, close() {} } }))
          : new Promise((r) => { cancelResolve = r; })),
        cancel: () => { cancelResolve?.({ done: true }); },
      }) };
    }
  };
  const track = { stop() {}, addEventListener() {}, removeEventListener() {}, getSettings: () => ({ sampleRate: RATE }), label: "fake" };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "node", mediaDevices: { getUserMedia: () => Promise.resolve(stream) } } });
  globalThis.window ||= { location: { search: "" }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
}
const CH = await loadChain(SRC);
const { takes } = positiveTakes("sel");
const take = args.take ? takes.find((t) => t.id === args.take) : takes.find((t) => t.type === "double");
if (!take) throw new Error(`no take ${args.take}`);
const R = renderPositive(take, COND);
log(`take-checks parity — ${new Date().toISOString()}`);
log(`src tree: ${resolve(SRC)}`);
log(`input: ${take.id} (${take.utts.join(" + ")}), condition ${COND}, ${R.samples.length} samples at ${RATE} Hz; take window ${R.takeStartS.toFixed(3)}-${R.takeEndS.toFixed(3)} s`);

// one worker run
const W = await runWorkers(CH, R.samples, RATE);
log(`worker run: ${W.n} chunks, pitch messages ${W.stats.frames} (voice ${W.stats.voice} / no voice ${W.stats.novoice} / none ${W.stats.none}), late ${W.stats.late}, L = ${W.L}`);

// ---- H: harness path ----
const H = await driveHookTap(CH, W);
const winH = inWindow(H, R.takeStartS, R.takeEndS);
const cH = counts(CH, winH, { capS: 8.0, takeStartS: R.takeStartS });
if (MODE === "h-only") {
  writeFileSync(args.dump, JSON.stringify(H.map((t) => [t.k, t.nowMs, t.frame])));
  process.exit(0);
}

// ---- P: the hook's start() path ----
M.refs = []; M.effects = []; M.state = null;
const mod = await import(pathToFileURL(CH.S.hookPath).href + "?parity=start");
const api = mod.useAudioPipeline();
for (const e of M.effects) { try { e(); } catch { /* effects that need a DOM */ } }
await api.start();
const pw = workers.filter((w) => w.url.includes("pitch-worker")).at(-1);
const dw = workers.filter((w) => w.url.includes("dsp-worker")).at(-1);
if (!pw || !dw) throw new Error(`start() made no pitch / DSP worker: ${workers.map((w) => w.url).join(", ")}`);
const P = [];
const recorded = [];
let curP = null;
api.frameCallbackRef.current = (f) => recorded.push(f);
CH.bridge.setExerciseFrameTap((frame) => P.push({ frame, nowMs: curP.nowMs, k: curP.k }));
for (let k = 0; k < W.n; k++) {
  const nowMs = (k + 1) * W.C / W.sr * 1000;
  for (const m of W.events[k].pitch) pw.send({ ...m, ts: nowMs });
  const d = W.events[k].dsp;
  if (d) { curP = { nowMs, k }; dw.send({ type: "analysis", data: { ...d, absoluteTime: nowMs } }); }
}
CH.bridge.setExerciseFrameTap(null);
api.frameCallbackRef.current = null;
api.stop();

const js = (f) => JSON.stringify(f);
check("start() path: the tap gets every frame the session recording's frame callback gets — the same objects, in order",
  P.length === recorded.length && P.length > 0 && P.every((t, i) => t.frame === recorded[i]), `${P.length} of ${recorded.length}`);
check("H (harness) and P (start() path) tap the same number of frames", H.length === P.length, `${H.length} vs ${P.length}`);
const firstDiff = H.findIndex((t, i) => !P[i] || js(t.frame) !== js(P[i].frame) || t.nowMs !== P[i].nowMs);
check("…the same frames in the same order, every field (voiced, f0, voiceGate, painted, formants, HNR, …) and arrival time",
  firstDiff === -1 && H.length === P.length, firstDiff === -1 ? `${H.length} frames` : `first difference at ${firstDiff}: ${js(H[firstDiff]?.frame)} vs ${js(P[firstDiff]?.frame)}`);
const winP = inWindow(P, R.takeStartS, R.takeEndS);
const cP = counts(CH, winP, { capS: 8.0, takeStartS: R.takeStartS });
check("the window holds the same frames on both paths", winH.length === winP.length && winH.every((t, i) => js(t.frame) === js(winP[i].frame)), `${winH.length} frames`);
check("counts a / b / median f0 identical on both paths", js(cH) === js(cP), `a ${cH.a} s, b ${cH.b} s, median f0 (b) ${cH.medB?.toFixed(1)} Hz, gate ${js(cH.gate)}`);
// the counted set is exactly the window's tapped frames
const lo = R.takeStartS * 1000, hi = R.takeEndS * 1000;
const manual = H.filter((t) => t.nowMs > lo && t.nowMs <= hi + 1e-6);
check("the counted frames = the tapped frames arriving after Record (take start) and up to Stop (take end)", manual.length === winH.length && manual.every((t, i) => t === winH[i]));
const contiguous = winH.length > 0 && winH.every((t, i) => i === 0 || t.k === winH[i - 1].k + 1);
check("…a contiguous run of display hops, one frame per DSP frame", contiguous, `hops ${winH[0]?.k}..${winH.at(-1)?.k}`);
const aDirect = winH.filter((t) => t.frame.voiced && t.frame.f0 > 0).length * 0.025;
const bDirect = winH.filter((t) => t.frame.voiced && t.frame.f0 > 0 && t.frame.voiceGate !== "hidden").length * 0.025;
check("a = 0.025 s x (voiced && f0 > 0) and b = a minus voiceGate 'hidden', recounted from the raw frames", Math.abs(aDirect - cH.a) < 1e-9 && Math.abs(bDirect - cH.b) < 1e-9, `a ${aDirect.toFixed(3)} b ${bDirect.toFixed(3)}`);
const vgSeen = new Set(H.map((t) => t.frame.voiceGate ?? "none"));
check("the input exercises both detector decisions and silence-gated frames", vgSeen.has("voice") && vgSeen.has("hidden") && H.some((t) => !t.frame.voiced), `voiceGate values ${[...vgSeen].join(", ")}`);

// ---- H in a clean process (no app fakes installed: run.mjs's own process state) ----
const dumpF = resolve(dirname(OUTF), "parity-h-clean.json");
const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1).filter((a) => !a.startsWith("--mode=") && !a.startsWith("--dump=")), "--mode=h-only", `--dump=${dumpF}`],
  { env: { ...process.env, SO_TAP: "0" }, encoding: "utf8", maxBuffer: 1 << 26 });
if (child.status !== 0) throw new Error(`h-only child failed: ${child.stderr}`);
const Hclean = JSON.parse(readFileSync(dumpF, "utf8"));
check("the harness path in a clean process (no fake Worker / capture globals, as run.mjs) taps the identical frame sequence",
  js(Hclean) === js(H.map((t) => [t.k, t.nowMs, t.frame])), `${Hclean.length} frames`);

// ---- O: the session oracle's own drive ----
const S = CH.S;
const WO = await runWorkersVad(S, CH.VG, R.samples, RATE);
const O = await driveHook(S.hookPath, buildFramesVad(WO, { gate: true }), WO.n);
let f0Bad = 0, vgBad = 0, nCmp = 0;
for (const t of H) {
  nCmp++;
  const rec = t.frame.voiced && t.frame.f0 !== null ? t.frame.f0 : 0;
  if (Math.fround(rec) !== O.rec[t.k]) f0Bad++;
  const vg = t.frame.voiceGate === "voice" ? 1 : t.frame.voiceGate === "hidden" ? 0 : -1;
  if (vg !== O.vadv[t.k]) vgBad++;
}
check("session oracle (independent worker run + its own hook drive): recorded f0 identical on every hop", f0Bad === 0, `${nCmp} hops, ${f0Bad} differ`);
check("…and the detector decision each hop consumed = the frame's voiceGate on every hop", vgBad === 0, `${vgBad} differ`);
check("worker runs agree on the decisions", WO.stats.voice === W.stats.voice && WO.stats.novoice === W.stats.novoice && WO.stats.none === W.stats.none);

log("");
log(`frames in the window, in order (k, arrival ms, voiced, f0, voiceGate):`);
for (const t of winH) log(`  ${t.k}\t${t.nowMs.toFixed(0)}\t${t.frame.voiced ? 1 : 0}\t${t.frame.f0 == null ? "-" : t.frame.f0.toFixed(2)}\t${t.frame.voiceGate ?? "none"}`);
log("");
log(fails ? `PARITY FAILED (${fails} checks)` : "PARITY OK — every check passed");
mkdirSync(dirname(OUTF), { recursive: true });
writeFileSync(OUTF, lines.join("\n") + "\n");
process.exit(fails ? 1 : 0);
