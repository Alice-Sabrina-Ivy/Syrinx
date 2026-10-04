// chain.mjs — the session oracle's production chain: the REAL pitch worker,
// the REAL DSP worker and the REAL main-thread display decision
// (useAudioPipeline.js handleAnalysisResult), driven in Node over one audio
// stream at production cadence (25 ms capture chunks, both workers fed the
// same chunk, each DSP frame consuming the latest pitch message).
//
// Requires `node --import <this dir>/register.mjs` (react mock, Vite-style
// extensionless imports, boersma-ac tap). Everything is imported from a
// caller-chosen src tree (`srcDir`), so the same oracle measures any commit:
// `git archive <rev> src | tar -x -C build/trees/<name>`.
//
// Per-hop series (k = capture-chunk index; chunk k = samples
// [k*C, (k+1)*C) at the input rate):
//   Detection columns are indexed by the chunk whose arrival completed the
//   analysis frame (window centre = chunk end - 40 ms):
//     fl    frame-local argmax (best voiced candidate if it beats unvoiced)
//     c0f   best voiced candidate frequency (regardless of voicing)
//     uv    unvoicedStrength
//     dec   path-tracker decode of that frame (before veto / range / guard)
//     post  pitch the worker POSTED for that frame (0 = null)
//     conf  posted confidence
//     nnotch active notch lines when that frame was posted
//   Display columns are indexed by display hop k (the DSP frame for chunk k,
//   consuming the pitch message emitted at chunk k, which describes frame
//   k-L):
//     inten  DSP-worker intensity (dB) — NaN before the DSP worker posts
//     msg    pitch in the consumed message (0 = null)
//     paint  value painted on the live trace this hop (0 = gap)
//     brk    1 if the hook inserted an octave-class line break before it
//     ro     readout Hz in the hook's state (0 = "—")
//     style  0 inactive, 1 holding (dim), 2 voiced
//     rec    session-recorded f0 (frame callback; 0 = unvoiced)
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { M } from "./react-mock.mjs";

// performance.now advances 1 s per call so the hook's 200 ms setState
// throttle never drops an update: the recorded readout is the per-frame
// state the throttle samples from (fraction-of-time metric).
let fakeNow = 0;
Object.defineProperty(globalThis, "performance", {
  value: { now: () => (fakeNow += 1000), timeOrigin: 0, mark() {}, measure() {} },
  configurable: true, writable: true,
});

export const DET_COLS = ["fl", "c0f", "uv", "dec", "post", "conf", "nnotch"];
export const DISP_COLS = ["inten", "msg", "paint", "brk", "ro", "style", "rec"];

export async function loadSrc(srcDir) {
  const src = resolve(srcDir);
  const P = { posts: [], postMessage(m) { this.posts.push(m); } };
  const D = { posts: [], postMessage(m) { this.posts.push(m); } };
  globalThis.self = P;
  await import(pathToFileURL(resolve(src, "dsp/pitch-worker.js")).href);
  globalThis.self = D;
  await import(pathToFileURL(resolve(src, "dsp/dsp-worker.js")).href);
  return { src, P, D, hookPath: resolve(src, "audio/useAudioPipeline.js") };
}

// Run both workers over `samples` (Float32Array at `sr`). Returns the
// detection + DSP columns, the per-chunk pitch messages and timing.
export function runWorkers(S, samples, sr, { chunkMs = 25 } = {}) {
  const C = Math.round(sr * chunkMs / 1000);
  const n = Math.floor(samples.length / C);
  const col = {};
  for (const c of DET_COLS) col[c] = new Float32Array(n);
  col.inten = new Float32Array(n).fill(NaN);
  const msgPitch = new Float32Array(n).fill(NaN); // NaN = no message this chunk
  const msgConf = new Float32Array(n).fill(NaN);
  const { P, D } = S;
  // ---- tap state ----
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
  // ---- init (fresh state per stream) ----
  globalThis.self = P; P.posts = [];
  P.onmessage({ data: { type: "init", inputSampleRate: sr } });
  const pp = {}; P.onmessage({ data: { type: "audioPort", port: pp } });
  globalThis.self = D; D.posts = [];
  D.onmessage({ data: { type: "init", sampleRate: sr } });
  const dp = {}; D.onmessage({ data: { type: "port", port: dp } });
  let busyNs = 0n, frames = 0;
  for (let k = 0; k < n; k++) {
    const ct = (k + 1) * C / sr;
    // pitch worker
    globalThis.self = P; curK = k; P.posts.length = 0;
    const a = Float32Array.from(samples.subarray(k * C, (k + 1) * C));
    const t0 = process.hrtime.bigint();
    pp.onmessage({ data: { buffer: a.buffer, contextTime: ct } });
    busyNs += process.hrtime.bigint() - t0;
    for (const m of P.posts) {
      if (m.type === "status" && m.status === "error") throw new Error(`pitch worker: ${m.message}`);
      if (m.type !== "pitch") continue;
      frames++;
      const kk = Math.round(m.contextTime * sr / C) - 1;
      col.post[kk] = m.pitch !== null ? m.pitch : 0;
      col.conf[kk] = m.confidence;
      col.nnotch[kk] = m.notchedFreqs ? m.notchedFreqs.length : 0;
      if ((m.pitch !== null) !== (m.confidence >= 0.5)) throw new Error(`invariant pitch!==null <=> conf>=0.5 broken at chunk ${k}`);
      msgPitch[k] = m.pitch !== null ? m.pitch : 0; msgConf[k] = m.confidence;
    }
    // DSP worker (same chunk, independent copy: transferables detach)
    globalThis.self = D; D.posts.length = 0;
    const b = Float32Array.from(samples.subarray(k * C, (k + 1) * C));
    dp.onmessage({ data: { buffer: b.buffer, contextTime: ct } });
    for (const m of D.posts) {
      if (m.type === "worker-error") throw new Error(`dsp worker: ${m.message}`);
      if (m.type === "analysis") col.inten[k] = m.data.intensity;
    }
  }
  globalThis.__SO_TAP = null;
  return { n, C, sr, L, col, msgPitch, msgConf, cpu: { pitchMsPerChunk: Number(busyNs) / 1e6 / n, frames } };
}

// Main-thread frames, one per DSP frame: the pitch message consumed is the
// latest one posted at or before chunk k (the pitch worker posts once per
// chunk once warm). `mask` (Uint8Array per hop, optional): hops with
// mask[k] === 0 are replaced by a pitchless frame at `floorDb` (simulates
// the user practising alone with the room noise left in).
export function buildFrames(W, { mask = null, floorDb = null } = {}) {
  const { n, C, sr, col, msgPitch, msgConf } = W;
  const frames = [];
  let last = { pitch: null, confidence: null, ts: 0 };
  for (let k = 0; k < n; k++) {
    const now = (k + 1) * C / sr * 1000;
    if (!Number.isNaN(msgPitch[k])) last = { pitch: msgPitch[k] > 0 ? msgPitch[k] : null, confidence: msgConf[k], ts: now };
    if (Number.isNaN(col.inten[k])) continue;
    let f = { k, now, intensity: col.inten[k], pitch: last.pitch, confidence: last.confidence, ts: last.ts };
    if (mask && !mask[k]) f = { k, now, intensity: floorDb, pitch: null, confidence: 0.2, ts: now };
    frames.push(f);
  }
  return frames;
}

let hookGen = 0;
// Drive the REAL handleAnalysisResult over `frames` (fresh hook instance).
// Returns display columns of length n (hops without a DSP frame stay 0).
export async function driveHook(hookPath, frames, n) {
  M.refs = []; M.effects = []; M.state = null;
  const mod = await import(pathToFileURL(hookPath).href + `?so=${++hookGen}`);
  const api = mod.useAudioPipeline();
  for (const e of M.effects) { try { e(); } catch { /* browser-only effects */ } }
  const latest = M.refs.find((r) => r.current && typeof r.current === "object" && "pitch" in r.current && "ts" in r.current && "confidence" in r.current && "voiced" in r.current);
  const har = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handleAnalysisResult");
  if (!latest || !har) throw new Error("could not locate latestPitchRef / handleAnalysisResultRef");
  const out = { msg: new Float32Array(n), paint: new Float32Array(n), brk: new Uint8Array(n), ro: new Float32Array(n), style: new Uint8Array(n), rec: new Float32Array(n) };
  let rec = null;
  api.frameCallbackRef.current = (f) => { rec = f; };
  const tr = api.pitchTraceRef;
  for (const f of frames) {
    latest.current = { pitch: f.pitch, confidence: f.confidence, voiced: f.pitch !== null, ts: f.ts };
    rec = null;
    har.current({ intensity: f.intensity, formants: null, spectralTilt: null, hnr: null, cpp: null, absoluteTime: f.now });
    const T = tr.current; const lastE = T[T.length - 1]; const now = Math.round(f.now);
    const painted = lastE && lastE.time === now && lastE.pitch !== null ? lastE.pitch : 0;
    out.msg[f.k] = f.pitch ?? 0;
    out.paint[f.k] = painted;
    const prev = T[T.length - 2];
    if (painted > 0 && prev && prev.time === now && prev.pitch === null) out.brk[f.k] = 1;
    const s = M.state;
    out.ro[f.k] = s.pitch ?? 0;
    out.style[f.k] = s.voiced ? 2 : s.holding ? 1 : 0;
    out.rec[f.k] = rec && rec.voiced && rec.f0 !== null ? rec.f0 : 0;
  }
  return out;
}

export function tenthPercentile(inten) {
  const v = Array.from(inten).filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length * 0.1)] : -80;
}
