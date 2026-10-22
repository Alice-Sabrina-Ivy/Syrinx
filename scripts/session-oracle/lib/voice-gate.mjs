// voice-gate.mjs — the session oracle's --voice-gate option (2026-10-21): the
// chain of lib/chain.mjs WITH the voice gate. The REAL pitch worker runs the
// REAL FireRedVAD model (src/dsp/firered-vad.js, through the worker's test
// seam setVadModelLoaderForTests: only the model loading is replaced —
// onnxruntime-web's WASM build in Node, the model files from the local copy
// build/models/firered/, `node scripts/fetch-firered-model.mjs`), and the
// REAL hook is driven with each pitch message's detector decision in
// latestPitchRef (what handlePitchMessage stores) — gate on — and without
// decisions — gate off, identical to the setting off.
//
// Until 2026-10-21 this lived as an uncommitted driver; the committed oracle
// could not run the voice gate, which the "committed oracles must mirror the
// shipped chain" rule (CLAUDE.md) forbids for a shipped gate.
//
// The detector's lag safeguard (the "slow" switch-off) measures wall clock
// with performance.now; chain.mjs fakes that clock (+1 s per call, for the
// hook's throttle), so the worker phase runs with a frozen clock (0): the
// detector never switches itself off — the decisions of a device that keeps
// up. Any "vad-status" other than "ready" aborts the run.
//
// Exports:
//   loadVoiceGate(S)                 the model + ORT session for src tree S
//   runWorkersVad(S, VG, samples, sr)  as chain.runWorkers, async, plus
//                                    msgVad (1 voice / 0 no voice / -1 none)
//                                    per display hop and decision stats
//   buildFramesVad(W, { gate, mask, floorDb })  chain.buildFrames + each
//                                    frame's decision (gate false: none)
//   maskCheck(G, U)                  the gate only hides: { bad, hid }
import { existsSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DET_COLS } from "./chain.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const imp = (p) => import(pathToFileURL(p).href);
const frozenPerf = { now: () => 0, timeOrigin: 0, mark() {}, measure() {} };
const turn = () => new Promise((r) => setImmediate(r));

export async function loadVoiceGate(S) {
  const ORT_DIST = join(REPO, "node_modules/onnxruntime-web/dist");
  const ort = await imp(join(ORT_DIST, "ort.wasm.bundle.min.mjs"));
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmBinary = readFileSync(join(ORT_DIST, "ort-wasm-simd-threaded.wasm"));
  const FV = await imp(resolve(S.src, "dsp/firered-vad.js"));
  const { LOCAL_MODEL_DIR, LOCAL_MODEL_HINT } = await imp(join(REPO, "scripts/firered/local-model.mjs"));
  const file = (key) => join(LOCAL_MODEL_DIR, FV.FIRERED_MODEL.files.find((f) => f.key === key).name);
  if (!existsSync(file("onnx")) || !existsSync(file("cmvn"))) {
    throw new Error(`--voice-gate: the FireRedVAD model files are missing in ${LOCAL_MODEL_DIR} (run: ${LOCAL_MODEL_HINT})`);
  }
  const session = await ort.InferenceSession.create(readFileSync(file("onnx")), { executionProviders: ["wasm"] });
  const cmvn = FV.parseKaldiCmvn(readFileSync(file("cmvn")));
  // The same module instance loadSrc imported (the worker S.P drives).
  const PW = await imp(resolve(S.src, "dsp/pitch-worker.js"));
  if (typeof PW.setVadModelLoaderForTests !== "function") throw new Error("--voice-gate: this src tree's pitch worker has no voice detector");
  return { ort, FV, session, cmvn, PW };
}

// chain.runWorkers with the detector on. The worker posts after the
// detector's await, so each chunk waits for its message. Detection columns
// are indexed by the message's own chunk (contextTime), display messages by
// the chunk whose handling posted it (frame chunk + L) — the indices the
// synchronous chain uses.
export async function runWorkersVad(S, VG, samples, sr, { chunkMs = 25 } = {}) {
  const C = Math.round(sr * chunkMs / 1000);
  const n = Math.floor(samples.length / C);
  const col = {};
  for (const c of DET_COLS) col[c] = new Float32Array(n);
  col.inten = new Float32Array(n).fill(NaN);
  const msgPitch = new Float32Array(n).fill(NaN);
  const msgConf = new Float32Array(n).fill(NaN);
  const msgVad = new Int8Array(n).fill(-1);
  const { P, D } = S;
  const frameChunk = []; let L = null; let curK = -1;
  globalThis.__SO_TAP = {
    tracker(t) { L = t.config.lookback; },
    cand(fc) {
      const v = fc.voiced;
      col.fl[curK] = v.length && v[0].strength > fc.unvoicedStrength ? v[0].freq : 0;
      col.c0f[curK] = v.length ? v[0].freq : 0;
      col.uv[curK] = fc.unvoicedStrength;
      frameChunk.push(curK);
    },
    emit(d) {
      const fi = frameChunk.length - 1;
      if (L !== null && fi >= L) col.dec[frameChunk[fi - L]] = d > 0 ? d : 0;
    },
  };
  const clock = globalThis.performance;
  globalThis.performance = frozenPerf;
  const stats = { voice: 0, novoice: 0, none: 0, late: 0, frames: 0 };
  try {
    VG.PW.setVadModelLoaderForTests(async () => ({ runner: VG.FV.createFireRedRunner(VG.ort, VG.session), cmvn: VG.cmvn }));
    globalThis.self = P; P.posts = [];
    P.onmessage({ data: { type: "init", inputSampleRate: sr, vad: { modelBase: "test:" } } });
    for (let i = 0; i < 500 && !P.posts.some((m) => m.type === "vad-status" && m.status !== "loading"); i++) await turn();
    const st = P.posts.find((m) => m.type === "vad-status" && m.status !== "loading");
    if (!st || st.status !== "ready") throw new Error(`detector not ready: ${st?.status} ${st?.message ?? ""}`);
    const pp = {}; P.onmessage({ data: { type: "audioPort", port: pp } });
    if (L === null) L = S.defaultLookback;
    if (L === null) throw new Error("tracker lookback unknown");
    globalThis.self = D; D.posts = [];
    D.onmessage({ data: { type: "init", sampleRate: sr } });
    const dp = {}; D.onmessage({ data: { type: "port", port: dp } });
    let seen = P.posts.length, warm = false;
    const take = (k) => {
      for (let i = seen; i < P.posts.length; i++) {
        const m = P.posts[i];
        if (m.type === "status" && m.status === "error") throw new Error(`pitch worker: ${m.message}`);
        if (m.type === "vad-status") throw new Error(`detector ${m.status}: ${m.message ?? ""}`);
        if (m.type !== "pitch") continue;
        stats.frames++; warm = true;
        const kk = Math.round(m.contextTime * sr / C) - 1; // the frame's chunk
        const ka = kk + L;                                  // the chunk whose handling posted it
        if (ka < k) stats.late++;
        col.post[kk] = m.pitch !== null ? m.pitch : 0;
        col.conf[kk] = m.confidence;
        col.nnotch[kk] = m.notchedFreqs ? m.notchedFreqs.length : 0;
        if ((m.pitch !== null) !== (m.confidence >= 0.5)) throw new Error(`invariant pitch!==null <=> conf>=0.5 broken at chunk ${kk}`);
        const vad = m.vad && typeof m.vad.voice === "boolean" ? m.vad : null;
        if (!vad) stats.none++; else if (vad.voice) stats.voice++; else stats.novoice++;
        if (ka >= n) continue;
        msgPitch[ka] = m.pitch !== null ? m.pitch : 0; msgConf[ka] = m.confidence;
        msgVad[ka] = vad ? (vad.voice ? 1 : 0) : -1;
      }
      seen = P.posts.length;
    };
    for (let k = 0; k < n; k++) {
      const ct = (k + 1) * C / sr;
      globalThis.self = P; curK = k;
      const a = Float32Array.from(samples.subarray(k * C, (k + 1) * C));
      pp.onmessage({ data: { buffer: a.buffer, contextTime: ct } });
      // wait for this chunk's message (once warm, every chunk posts one)
      for (let i = 0; i < (warm ? 200 : 4); i++) {
        await turn();
        if (P.posts.slice(seen).some((m) => m.type === "pitch" && Math.round(m.contextTime * sr / C) - 1 + L === k)) break;
      }
      take(k);
      globalThis.self = D; D.posts.length = 0;
      const b = Float32Array.from(samples.subarray(k * C, (k + 1) * C));
      dp.onmessage({ data: { buffer: b.buffer, contextTime: ct } });
      for (const m of D.posts) {
        if (m.type === "worker-error") throw new Error(`dsp worker: ${m.message}`);
        if (m.type === "analysis") col.inten[k] = m.data.intensity;
      }
    }
    for (let i = 0; i < 20; i++) await turn();
    globalThis.self = P; take(n);
  } finally {
    VG.PW.setVadModelLoaderForTests(null);
    globalThis.__SO_TAP = null;
    globalThis.performance = clock;
  }
  return { n, C, sr, L, col, msgPitch, msgConf, msgVad, stats, cpu: { pitchMsPerChunk: NaN, frames: stats.frames } };
}

// chain.buildFrames + the consumed message's decision (gate false: none —
// the display of the setting off).
export function buildFramesVad(W, { gate = true, mask = null, floorDb = null } = {}) {
  const { n, C, sr, col, msgPitch, msgConf, msgVad } = W;
  const frames = [];
  let last = { pitch: null, confidence: null, ts: 0, vadVoice: null };
  for (let k = 0; k < n; k++) {
    const now = (k + 1) * C / sr * 1000;
    if (!Number.isNaN(msgPitch[k])) {
      last = { pitch: msgPitch[k] > 0 ? msgPitch[k] : null, confidence: msgConf[k], ts: now, vadVoice: gate && msgVad[k] >= 0 ? msgVad[k] === 1 : null };
    }
    if (Number.isNaN(col.inten[k])) continue;
    let f = { k, now, intensity: col.inten[k], pitch: last.pitch, confidence: last.confidence, ts: last.ts, vadVoice: last.vadVoice };
    if (mask && !mask[k]) f = { k, now, intensity: floorDb, pitch: null, confidence: 0.2, ts: now, vadVoice: null };
    frames.push(f);
  }
  return frames;
}

// The gate is a mask on the unchanged chain: every value it shows equals
// the gate-off painted value. bad = hops where it does not, hid = painted
// hops (gate off) it hid.
export function maskCheck(G, U) {
  let bad = 0, hid = 0;
  for (let k = 0; k < G.paint.length; k++) {
    if (G.paint[k] > 0 && G.paint[k] !== U.paint[k]) bad++;
    if (U.paint[k] > 0 && !(G.paint[k] > 0)) hid++;
  }
  return { bad, hid };
}
