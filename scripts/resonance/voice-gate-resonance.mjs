// voice-gate-resonance.mjs — should the try-out voice gate also gate the
// resonance row? (measurements/noise-detector-tryout-resonance-2026-10-21.md)
//
//   node scripts/resonance/voice-gate-resonance.mjs --streams=build/resonance-voicegate/streams.json
//        [--sets=N1,N2,S1,S2,S3,H1,H2,D1] [--shard=i/n] [--out=build/resonance-voicegate/rows-<shard>.jsonl]
//   node scripts/resonance/voice-gate-resonance.mjs --wav=<file.wav> --out=<dir>/rows.jsonl   (one recording)
//   node scripts/resonance/voice-gate-resonance.mjs --report=<rows.jsonl,...> [--json=summary.json]
//
// Per stream (48 kHz float32 from voice-gate-prep.py; H1 = the synthetic
// holds of gating.mjs, made here):
//   1. the REAL pitch worker (src/dsp/pitch-worker.js, fake `self`) with the
//      real FireRedVAD model through its test seam setVadModelLoaderForTests
//      (the ORT-web WASM session the app builds; ready before the first
//      chunk), 1200-sample chunks; every pitch post recorded with the chunk
//      that produced it;
//   2. the REAL resonance worker (src/resonance/resonance-worker.js, fake
//      `self`, fetch reading public/), fed the same chunks, each followed by
//      the pitch hints that chunk produced — the hook's hint
//      { voiced, pitch, contextTime } — twice:
//        BASE   the hint as today;
//        GATED  voiced: false on a hop whose decision is "no voice" (the
//               setting on); pitch / contextTime unchanged; no decision ->
//               unchanged.
//   Every `state` post (each 0.2 s of audio) is kept: u (null = no
//   position), clamp, verdict, voicedS, fill, sinceResumeS, bin counters.
// The run aborts on a detector "slow" / "error" status or a resonance
// worker status other than ready.
//
// --row (2026-10-21, measurements/voice-gate-resonance-row-2026-10-21.md):
// the Dashboard resonance ROW, not only the worker. Needs the session
// oracle's module hooks (react mock, Vite-style imports):
//   SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs \
//     scripts/resonance/voice-gate-resonance.mjs --row [--streams=...] [--shard=i/n] [--out=...]
//   ... --row --report=<rows.jsonl,...> [--json=summary.json]
// Per stream, on top of the two resonance passes above:
//   3. the REAL DSP worker (fake `self`) on the same chunks (intensity for
//      the hook's silence gate);
//   4. the REAL hook (src/audio/useAudioPipeline.js handleAnalysisResult,
//      session-oracle react mock, voice-gate setting on), one DSP frame per
//      chunk, each consuming the latest pitch message with its detector
//      decision (latestPitchRef as handlePitchMessage stores it). Per
//      chunk: the raw voiced / holding flags and the gated pitchVoiced /
//      pitchHolding;
//   5. per 25 ms chunk, the REAL row logic of src/components/cueStripModel.js
//      (resonanceRowState, dotOpacity, rowValue, resonanceClamp, axisPos,
//      resonanceHeader) on the latest resonance `state` post, three arms:
//        PRE   ungated hint (the worker before the merge), raw flags;
//        BASE  gated hint (cue-strip 1a1713f), raw flags;
//        CAND  gated hint, the gated flags (pitchVoiced / pitchHolding) —
//              the candidate: while the setting is on and the detector is
//              ready the row's voiced / holding come from the gated pitch
//              signals. Every hop here carries a decision (counted).
// Workers run with a frozen performance.now (0): no overload / "slow"
// switch-off — the decisions of a device that keeps up (as the session
// oracle's detector option); the hook runs with the session oracle's
// +1 s per call clock so its 200 ms state throttle never drops a frame.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const SR = 48000, CH = 1200;
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };

const ROW = process.argv.includes("--row");

// ======================================================================= report
if (arg("report", "")) {
  const rows = arg("report", "").split(",").flatMap((f) => readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)));
  if (ROW) reportRow(rows); else report(rows);
  process.exit(0);
}

// ======================================================================= run
const ORT_DIST = path.join(repo, "node_modules/onnxruntime-web/dist");
const ort = await import(pathToFileURL(path.join(ORT_DIST, "ort.wasm.bundle.min.mjs")).href);
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmBinary = readFileSync(path.join(ORT_DIST, "ort-wasm-simd-threaded.wasm"));
const { FIRERED_MODEL, createFireRedRunner, parseKaldiCmvn } = await import(pathToFileURL(path.join(repo, "src/dsp/firered-vad.js")).href);
const MD = path.join(repo, "public", FIRERED_MODEL.dir);
if (!existsSync(path.join(MD, "cmvn.ark"))) { console.error("model files missing: node scripts/fetch-firered-model.mjs"); process.exit(2); }
const session = await ort.InferenceSession.create(readFileSync(path.join(MD, "fireredvad_stream_vad_with_cache.onnx")), { executionProviders: ["wasm"] });
const cmvn = parseKaldiCmvn(readFileSync(path.join(MD, "cmvn.ark")));

let target = [];
globalThis.self = { postMessage: (m) => target.push(m) };
const W = await import(pathToFileURL(path.join(repo, "src/dsp/pitch-worker.js")).href);
const pitchOn = self.onmessage;
globalThis.fetch = async (url) => {
  const name = String(url).split("resonance-lab/").pop();
  const file = path.join(repo, "public/resonance-lab", name);
  if (!existsSync(file)) return { ok: false, status: 404 };
  const txt = readFileSync(file, "utf8");
  return { ok: true, status: 200, json: async () => JSON.parse(txt) };
};
await import(pathToFileURL(path.join(repo, "src/resonance/resonance-worker.js")).href);
const resOn = self.onmessage;
const turn = () => new Promise((r) => setImmediate(r));

// --row: DSP worker, hook, row logic, clocks
let dspOn = null, CS = null, M = null, hookUrl = null;
const realPerf = globalThis.performance;
let fakeNow = 0;
const frozenPerf = { now: () => 0, timeOrigin: 0, mark() {}, measure() {} };
const hookPerf = { now: () => (fakeNow += 1000), timeOrigin: 0, mark() {}, measure() {} };
const setPerf = (p) => Object.defineProperty(globalThis, "performance", { value: p, configurable: true, writable: true });
if (ROW) {
  await import(pathToFileURL(path.join(repo, "src/dsp/dsp-worker.js")).href);
  dspOn = self.onmessage;
  CS = await import(pathToFileURL(path.join(repo, "src/components/cueStripModel.js")).href);
  try {
    ({ M } = await import(pathToFileURL(path.join(repo, "scripts/session-oracle/lib/react-mock.mjs")).href));
  } catch (err) {
    console.error(`--row needs: node --import ./scripts/session-oracle/lib/register.mjs (${err.message})`);
    process.exit(2);
  }
  hookUrl = pathToFileURL(path.join(repo, "src/audio/useAudioPipeline.js")).href;
  setPerf(frozenPerf);
}

// 1. pitch worker + detector: posts per chunk
async function pitchPass(y) {
  const posts = [];
  target = posts;
  W.setVadModelLoaderForTests(async () => ({ runner: createFireRedRunner(ort, session), cmvn }));
  pitchOn({ data: { type: "init", inputSampleRate: SR, vad: { modelBase: "test:" } } });
  for (let i = 0; i < 200 && !posts.some((m) => m.type === "vad-status" && m.status === "ready"); i++) await turn();
  if (!posts.some((m) => m.type === "vad-status" && m.status === "ready")) throw new Error("detector not ready");
  const port = {};
  pitchOn({ data: { type: "audioPort", port } });
  const byChunk = [];
  let seen = posts.length, late = 0;
  const nChunks = Math.ceil(y.length / CH);
  for (let k = 0; k < nChunks; k++) {
    const x = y.slice(k * CH, Math.min(y.length, (k + 1) * CH));
    const ct = Math.min(y.length, (k + 1) * CH) / SR;
    port.onmessage({ data: { buffer: x.buffer, contextTime: ct } });
    await turn();
    const got = posts.slice(seen).filter((m) => m.type === "pitch");
    for (const m of posts.slice(seen)) {
      if (m.type === "vad-status" && m.status !== "ready") throw new Error(`detector ${m.status}: ${m.message ?? ""}`);
      if (m.type === "status" && m.status === "error") throw new Error(`pitch worker error: ${m.message}`);
    }
    seen = posts.length;
    byChunk.push(got);
  }
  for (let i = 0; i < 50; i++) await turn();
  const tail = posts.slice(seen).filter((m) => m.type === "pitch");
  if (tail.length) { late += tail.length; byChunk[byChunk.length - 1].push(...tail); }
  W.setVadModelLoaderForTests(null);
  return { byChunk, late };
}

// 2. resonance worker, one arm
const VERD = ["silent", "warming", "score", "sustained", "pause", "stale"];
async function resonancePass(y, byChunk, gated) {
  const posts = [];
  target = posts;
  resOn({ data: { type: "init", sampleRate: SR, assetBase: "/", diag: true } });
  for (let i = 0; i < 200 && !posts.some((m) => m.type === "status" && m.status !== "loading"); i++) await turn();
  const st = posts.find((m) => m.type === "status" && m.status !== "loading");
  if (!st || st.status !== "ready") throw new Error(`resonance worker: ${st?.status} ${st?.message ?? ""}`);
  const port = {};
  resOn({ data: { type: "audioPort", port } });
  const rows = [];
  const snaps = ROW ? new Array(byChunk.length) : null; // --row: latest state post as of each chunk
  let snap = null;
  let hidden = 0, hints = 0;
  for (let k = 0; k < byChunk.length; k++) {
    const x = y.slice(k * CH, Math.min(y.length, (k + 1) * CH));
    const ct = Math.min(y.length, (k + 1) * CH) / SR;
    const before = posts.length;
    port.onmessage({ data: { buffer: x.buffer, contextTime: ct } });
    for (const m of byChunk[k]) {
      const hide = gated && m.vad && m.vad.voice === false;
      if (hide && m.voiced) hidden++;
      hints++;
      resOn({ data: { type: "pitch-hint", voiced: hide ? false : m.voiced, pitch: m.pitch, contextTime: m.contextTime ?? null } });
    }
    for (const m of posts.slice(before)) {
      if (m.type === "status") throw new Error(`resonance worker status ${m.status} ${m.message ?? ""}`);
      if (m.type !== "state") continue;
      snap = m;
      rows.push([+ct.toFixed(3), m.u, m.clamp, VERD.indexOf(m.verdict), +m.voicedS.toFixed(3), +(m.fill ?? 0).toFixed(3),
        m.sinceResumeS == null ? null : +m.sinceResumeS.toFixed(3), m.perf?.binsAdmitted ?? null, m.perf?.binsDropped ?? null,
        m.narrowband?.on ? 1 : 0]);
    }
    if (snaps) snaps[k] = snap;
  }
  return { rows, snaps, hiddenVoicedHints: hidden, hints };
}

// --row 3. DSP worker: intensity per chunk (NaN = no analysis frame)
function dspPass(y, nChunks) {
  const posts = [];
  target = posts;
  dspOn({ data: { type: "init", sampleRate: SR } });
  const port = {};
  dspOn({ data: { type: "port", port } });
  const inten = new Float32Array(nChunks).fill(NaN);
  for (let k = 0; k < nChunks; k++) {
    const x = y.slice(k * CH, Math.min(y.length, (k + 1) * CH));
    posts.length = 0;
    port.onmessage({ data: { buffer: x.buffer, contextTime: Math.min(y.length, (k + 1) * CH) / SR } });
    for (const m of posts) {
      if (m.type === "worker-error") throw new Error(`dsp worker: ${m.message}`);
      if (m.type === "analysis") inten[k] = m.data.intensity;
    }
  }
  return inten;
}

// --row 4. the REAL hook: per chunk, bit 0 voiced, 1 holding (raw), 2
// pitchVoiced, 3 pitchHolding (gated). A chunk without a DSP frame keeps the
// previous state (React state persists between frames).
let hookGen = 0;
async function hookPass(byChunk, inten) {
  setPerf(hookPerf);
  try {
    M.refs = []; M.effects = []; M.state = null;
    const mod = await import(`${hookUrl}?row=${++hookGen}`);
    mod.useAudioPipeline();
    for (const e of M.effects) { try { e(); } catch { /* browser-only effects */ } }
    const latest = M.refs.find((r) => r.current && typeof r.current === "object" && "pitch" in r.current && "ts" in r.current && "confidence" in r.current && "voiced" in r.current);
    const har = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handleAnalysisResult");
    if (!latest || !har) throw new Error("could not locate latestPitchRef / handleAnalysisResultRef");
    const n = byChunk.length;
    const flags = new Uint8Array(n);
    let noDecision = 0;
    let cur = { pitch: null, confidence: null, voiced: false, ts: 0, vadVoice: null, vadP: null };
    const code = (s) => (s.voiced ? 1 : 0) | (s.holding ? 2 : 0) | (s.pitchVoiced ? 4 : 0) | (s.pitchHolding ? 8 : 0);
    let last = code(M.state);
    for (let k = 0; k < n; k++) {
      const now = (k + 1) * CH / SR * 1000;
      const msgs = byChunk[k];
      if (msgs.length) {
        const m = msgs[msgs.length - 1];
        const vad = m.vad && typeof m.vad.voice === "boolean" ? m.vad : null;
        if (!vad) noDecision++;
        cur = { pitch: m.pitch, confidence: m.confidence, voiced: m.voiced, ts: now, vadVoice: vad ? vad.voice : null, vadP: vad ? vad.p : null };
      }
      if (!Number.isNaN(inten[k])) {
        latest.current = cur;
        har.current({ intensity: inten[k], formants: null, spectralTilt: null, hnr: null, cpp: null, absoluteTime: now });
        last = code(M.state);
      }
      flags[k] = last;
    }
    return { flags, noDecision };
  } finally {
    setPerf(frozenPerf);
  }
}

// --row 5. the row, per chunk, per arm: real cueStripModel.js logic
const ROW_STATES = ["starting", "restarting", "reload", "unavailable", "paused", "narrowband", "idle", "sustained", "warming", "settling", "holding", "live"];
function rowAt(snap, voiced, holding) {
  const state = CS.resonanceRowState({ workerStatus: "ready", snap, voiced, holding });
  const value = CS.rowValue("resonance", { snap });
  const dot = CS.dotOpacity(state) !== null && value !== null && value !== undefined;
  const p = dot ? CS.axisPos("resonance", value, { clamp: CS.resonanceClamp(snap) }) : null;
  return { s: ROW_STATES.indexOf(state), dot, value: dot ? value : null, beyond: !!(p && p.beyond !== 0), hdr: CS.resonanceHeader(state, snap) };
}
const DU_EDGES = [0, 0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, Infinity];
function rowSummary(snapsPre, snapsGated, flags, holds) {
  const arm = () => ({ st: new Array(ROW_STATES.length).fill(0), dot: 0, beyond: 0, hdrBeyond: 0, pos: 0, posBeyond: 0, stIn: new Array(ROW_STATES.length).fill(0), dotIn: 0, nIn: 0, firstDot: null });
  const A = { pre: arm(), base: arm(), cand: arm() };
  let differ = 0, newDot = 0;
  const trans = {};
  const du = new Array(DU_EDGES.length - 1).fill(0);
  const n = flags.length;
  for (let k = 0; k < n; k++) {
    const t = (k + 1) * CH / SR;
    const f = flags[k];
    const inHold = holds.some(([a, b]) => t >= a && t < b);
    const res = {
      pre: rowAt(snapsPre[k], !!(f & 1), !!(f & 2)),
      base: rowAt(snapsGated[k], !!(f & 1), !!(f & 2)),
      cand: rowAt(snapsGated[k], !!(f & 4), !!(f & 8)),
    };
    for (const [key, r] of Object.entries(res)) {
      const a = A[key], snap = key === "pre" ? snapsPre[k] : snapsGated[k];
      a.st[r.s]++;
      if (r.dot) { a.dot++; if (a.firstDot === null) a.firstDot = t; }
      if (r.beyond) a.beyond++;
      if (r.hdr === "beyond the scale") a.hdrBeyond++;
      if (snap && snap.u != null) {
        a.pos++;
        const p = CS.axisPos("resonance", snap.u, { clamp: CS.resonanceClamp(snap) });
        if (p && p.beyond !== 0) a.posBeyond++;
      }
      if (inHold) { a.nIn++; a.stIn[r.s]++; if (r.dot) a.dotIn++; }
    }
    if (res.cand.s !== res.base.s) {
      differ++;
      const key = `${ROW_STATES[res.base.s]}>${ROW_STATES[res.cand.s]}`;
      trans[key] = (trans[key] ?? 0) + 1;
    }
    if (res.cand.dot && !res.base.dot) newDot++;
    if (res.cand.dot && res.base.dot) {
      const d = Math.abs(res.cand.value - res.base.value); // the drawn positions (one worker run: the same snap)
      for (let i = 0; i < du.length; i++) if (d >= DU_EDGES[i] && d < DU_EDGES[i + 1]) { du[i]++; break; }
    }
  }
  return { nTicks: n, arms: A, differ, trans, newDot, du };
}

// H1: the synthetic holds of scripts/resonance/gating.mjs (same recipe)
const VOWELS = { a: [[730, 90], [1090, 110], [2440, 160]], i: [[270, 60], [2290, 100], [3010, 160]], u: [[300, 60], [870, 90], [2240, 150]] };
function heldVowel(f0, vowel, vibrato) {
  const n = Math.round(SR * 5);
  const src = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f0 * (vibrato ? Math.pow(2, (0.3 * Math.sin(2 * Math.PI * 5 * t)) / 12) : 1);
    ph += f / SR; if (ph >= 1) ph -= 1;
    const env = t < 0.5 || t >= 4.5 ? 0 : Math.min(1, (t - 0.5) / 0.03, (4.5 - t) / 0.03);
    src[i] = env * ((ph < 0.6 ? Math.sin(Math.PI * ph / 0.6) ** 2 : 0) - 0.3);
  }
  let y = src;
  for (const [f, bw] of VOWELS[vowel]) {
    const r = Math.exp(-Math.PI * bw / SR), th = 2 * Math.PI * f / SR, a1 = 2 * r * Math.cos(th), a2 = -r * r;
    const o = new Float32Array(n); let y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) { const v = y[i] + a1 * y1 + a2 * y2; o[i] = v; y2 = y1; y1 = v; }
    y = o;
  }
  let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v));
  for (let i = 0; i < n; i++) y[i] = (0.3 * y[i]) / pk + 1e-4 * Math.sin(i * 0.37);
  return y;
}

function readWav48(file) {
  const b = readFileSync(file);
  let o = 12, fmt = null;
  while (o + 8 <= b.length) {
    const id = b.toString("ascii", o, o + 4), s = b.readUInt32LE(o + 4);
    if (id === "fmt ") fmt = { tag: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === "data") {
      const w = fmt.bits / 8, n = Math.floor(Math.min(s, b.length - o - 8) / w / fmt.ch), x = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let v = 0;
        for (let c = 0; c < fmt.ch; c++) {
          const at = o + 8 + w * (i * fmt.ch + c);
          v += fmt.tag === 3 ? b.readFloatLE(at) : fmt.bits === 16 ? b.readInt16LE(at) / 32768 : fmt.bits === 24 ? b.readIntLE(at, 3) / 8388608 : b.readInt32LE(at) / 2147483648;
        }
        x[i] = v / fmt.ch;
      }
      if (fmt.sr !== SR) throw new Error(`${file}: ${fmt.sr} Hz (needs 48 kHz)`);
      return x;
    }
    o += 8 + s + (s & 1);
  }
  throw new Error(`${file}: no data`);
}

let items = [];
const wav = arg("wav", "");
if (wav) {
  items = [{ id: "recording", set: "P", cls: "room", sex: "na", load: () => readWav48(wav), holds: [] }];
} else {
  const sets = new Set(arg("sets", "N1,N2,S1,S2,S3,H1,H2,D1").split(","));
  const streams = JSON.parse(readFileSync(arg("streams", path.join(repo, "build/resonance-voicegate/streams.json")), "utf8"));
  items = streams.filter((s) => sets.has(s.set)).map((s) => ({ ...s, load: () => { const b = readFileSync(s.path); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); } }));
  if (sets.has("H1")) {
    for (const f0 of [110, 165, 220, 300]) for (const v of Object.keys(VOWELS)) for (const vib of [false, true]) {
      items.push({ id: `H1__${f0}_${v}${vib ? "_vib" : ""}`, set: "H1", cls: "synthetic", sex: "na", holds: [[0.5, 4.5]], load: () => heldVowel(f0, v, vib) });
    }
  }
}
// --shuffle=<seed>: a fixed seeded order before sharding, so a run stopped
// early has done a seeded random subset of every set.
const seed = Number(arg("shuffle", ""));
if (Number.isFinite(seed) && arg("shuffle", "") !== "") {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
}
const [si, sn] = arg("shard", "0/1").split("/").map(Number);
items = items.filter((_, i) => i % sn === si);
const [ui, un] = arg("sub", "0/1").split("/").map(Number); // a shard split further
items = items.filter((_, i) => i % un === ui);
const only = new Set(arg("only", "").split(",").filter(Boolean)); // --only=<id,...>
if (only.size) items = items.filter((it) => only.has(it.id));
const out = arg("out", path.join(repo, `build/resonance-voicegate/${ROW ? "row" : "rows"}-${si}of${sn}.jsonl`));
mkdirSync(path.dirname(out), { recursive: true });
const done = new Set([out, ...arg("skip-from", "").split(",").filter(Boolean)].filter((f) => existsSync(f))
  .flatMap((f) => readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l).id)));
console.log(`${items.length} streams (${done.size} already done) -> ${out}`);
const t0 = Date.now();
let audioS = 0;
for (const it of items) {
  if (done.has(it.id)) continue;
  const y = it.load();
  // The detector's lag safeguard measures wall-clock handling time; a Node
  // process on a loaded machine (GC pauses, other jobs) can trip it, which
  // in the app turns the detector off for the session. Not what is measured
  // here: the stream is run again (the decisions do not depend on timing).
  let pass = null, retries = 0;
  for (;;) {
    try { pass = await pitchPass(y); break; } catch (err) {
      if (!/detector slow/.test(String(err?.message)) || ++retries > 3) throw err;
      target = []; // let the aborted run's queued chunks drain before the next init
      for (let i = 0; i < 200; i++) await turn();
      console.log(`  ${it.id}: detector switched itself off as slow (machine load), run again (${retries})`);
    }
  }
  const { byChunk, late } = pass;
  const pitch = byChunk.flat();
  const base = await resonancePass(y, byChunk, false);
  const gated = await resonancePass(y, byChunk, true);
  const dec = pitch.filter((m) => m.vad);
  const row = {
    id: it.id, set: it.set, cls: it.cls, sex: it.sex, dur: y.length / SR, holds: it.holds ?? [],
    pitchPosts: pitch.length, latePosts: late, slowRetries: retries,
    decided: dec.length, noVoice: dec.filter((m) => !m.vad.voice).length,
    voicedPosts: pitch.filter((m) => m.voiced).length,
    voicedHidden: pitch.filter((m) => m.voiced && m.vad && m.vad.voice === false).length,
    base: base.rows, gated: gated.rows,
  };
  if (ROW) {
    // "base" / "gated" above = the hint arms of the 2026-10-21 note (PRE /
    // BASE here); the row arms PRE / BASE / CAND below.
    const inten = dspPass(y, byChunk.length);
    const { flags, noDecision } = await hookPass(byChunk, inten);
    row.hookNoDecision = noDecision;
    row.row = rowSummary(base.snaps, gated.snaps, flags, it.holds ?? []);
  }
  appendFileSync(out, JSON.stringify(row) + "\n");
  audioS += row.dur;
  const el = (Date.now() - t0) / 1000;
  if (ROW) { console.log(`${it.id}  ${row.dur.toFixed(1)} s  [${(audioS / el).toFixed(1)}x]`); continue; }
  console.log(`${it.id}  ${row.dur.toFixed(1)} s  voiced ${row.voicedPosts}/${row.pitchPosts}, hidden ${row.voicedHidden}; pos base ${base.rows.filter((r) => r[1] !== null).length} gated ${gated.rows.filter((r) => r[1] !== null).length} / ${base.rows.length}  [${(audioS / el).toFixed(1)}x]`);
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(0);

// ======================================================================= report
function report(rows) {
  const S = {};
  const pct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(100 * v).toFixed(1)} %`);
  const f2 = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d));
  const posShare = (rs) => { let n = 0, p = 0; for (const r of rs) { n += r.base.length; p += r.base.filter((x) => x[1] !== null).length; } return { n, p }; };
  const share = (rs, arm) => { let n = 0, p = 0; for (const r of rs) { n += r[arm].length; p += r[arm].filter((x) => x[1] !== null).length; } return n ? p / n : null; };
  const lines = [];
  const say = (s) => { lines.push(s); console.log(s); };
  const sets = (k) => rows.filter((r) => k.includes(r.set));

  // ---- noise
  const noise = sets(["N1", "N2"]);
  if (noise.length) {
    say("## Noise only: share of time with a position (u not null)");
    say("");
    say("| set / class | streams | audio s | voiced hops hidden | BASE | GATED | reduction |");
    say("|---|---|---|---|---|---|---|");
    const row = (label, rs) => {
      const b = share(rs, "base"), g = share(rs, "gated");
      const vh = rs.reduce((a, r) => a + r.voicedHidden, 0) / Math.max(1, rs.reduce((a, r) => a + r.voicedPosts, 0));
      say(`| ${label} | ${rs.length} | ${rs.reduce((a, r) => a + r.dur, 0).toFixed(0)} | ${pct(vh)} | ${pct(b)} | ${pct(g)} | ${b ? pct(1 - g / b) : "—"} |`);
      return { b, g };
    };
    for (const set of ["N1", "N2"]) {
      const rs = sets([set]);
      if (!rs.length) continue;
      for (const c of [...new Set(rs.map((r) => r.cls))].sort()) row(`${set} ${c}`, rs.filter((r) => r.cls === c));
      S[set] = row(`**${set} pooled**`, rs);
    }
    S.noise = row("**N1 + N2 pooled (judged)**", noise);
    // beyond-the-scale share
    const clampShare = (arm) => { let n = 0, c = 0; for (const r of noise) { n += r[arm].length; c += r[arm].filter((x) => x[1] !== null && x[2] !== 0).length; } return c / n; };
    say("");
    say(`Share of noise time at the clamp ("beyond the scale"): BASE ${pct(clampShare("base"))}, GATED ${pct(clampShare("gated"))}.`);
    // how often the shown position moves: consecutive posts both with a
    // position and |change| > 0.01 u, as a share of all noise time
    const moving = (arm) => { let n = 0, m = 0; for (const r of noise) { const a = r[arm]; n += a.length; for (let i = 1; i < a.length; i++) if (a[i][1] !== null && a[i - 1][1] !== null && Math.abs(a[i][1] - a[i - 1][1]) > 0.01) m++; } return m / n; };
    say(`Share of noise time the position moves (> 0.01 u between 0.2 s posts): BASE ${pct(moving("base"))}, GATED ${pct(moving("gated"))}.`);
    const mv = (arm) => q(noise.map((r) => { const u = r[arm].map((x) => x[1]).filter((v) => v !== null); return u.length ? Math.max(...u) - Math.min(...u) : 0; }), 0.5);
    say(`Per-stream range of u (max − min), median over streams: BASE ${f2(mv("base"))}, GATED ${f2(mv("gated"))}.`);
    say("");
  }

  // ---- speech
  const speech = sets(["S1", "S2", "S3"]);
  if (speech.length) {
    say("## Speech: readout difference and time to first position");
    say("");
    say("| sex / corpus | streams | median \\|Δu\\| | p95 \\|Δu\\| | first position BASE (median s) | GATED − BASE (median s) | max increase s | GATED never | position share BASE | GATED | voiced hops hidden |");
    say("|---|---|---|---|---|---|---|---|---|---|---|");
    const first = (rs) => { const i = rs.findIndex((x) => x[1] !== null); return i < 0 ? null : rs[i][0]; };
    const row = (label, rs) => {
      const du = [];
      for (const r of rs) {
        const n = Math.min(r.base.length, r.gated.length);
        for (let i = 0; i < n; i++) if (r.base[i][1] !== null && r.gated[i][1] !== null) du.push(Math.abs(r.gated[i][1] - r.base[i][1]));
      }
      const fb = rs.map((r) => first(r.base)), fg = rs.map((r) => first(r.gated));
      const inc = [], never = [];
      rs.forEach((r, i) => { if (fb[i] === null) return; if (fg[i] === null) never.push(r.id); else inc.push(fg[i] - fb[i]); });
      const vh = rs.reduce((a, r) => a + r.voicedHidden, 0) / Math.max(1, rs.reduce((a, r) => a + r.voicedPosts, 0));
      say(`| ${label} | ${rs.length} | ${f2(q(du, 0.5), 3)} | ${f2(q(du, 0.95), 3)} | ${f2(q(fb.filter((v) => v !== null), 0.5), 1)} | ${f2(q(inc, 0.5), 2)} | ${f2(inc.length ? Math.max(...inc) : null, 2)} | ${never.length} | ${pct(share(rs, "base"))} | ${pct(share(rs, "gated"))} | ${pct(vh)} |`);
      return { med: q(du, 0.5), p95: q(du, 0.95), inc: q(inc, 0.5), never: never.length };
    };
    for (const sex of ["f", "m"]) {
      const R = speech.filter((r) => r.sex === sex);
      for (const set of ["S1", "S2", "S3"]) { const rs = R.filter((r) => r.set === set); if (rs.length) row(`${sex === "f" ? "women" : "men"} ${set}`, rs); }
      S[sex] = row(`**${sex === "f" ? "women" : "men"} pooled (judged)**`, R);
    }
    say("");
  }

  // ---- held
  const h1 = sets(["H1"]);
  if (h1.length) {
    say("## Held vowels");
    say("");
    const pos = (arm) => h1.filter((r) => r[arm].some((x) => x[1] !== null)).length;
    // admitted voiced time (the readout's voiced clock; a stamped bin with no
    // value — an unvoiced bin — adds nothing)
    const adm = (arm) => Math.max(...h1.map((r) => Math.max(0, ...r[arm].map((x) => x[4] ?? 0))));
    const sus = (arm) => q(h1.map((r) => { const rs = r[arm].filter((x) => x[0] >= r.holds[0][0] + 1 && x[0] < r.holds[0][1]); return rs.length ? rs.filter((x) => x[3] === 3).length / rs.length : 0; }), 0.5);
    say(`H1 synthetic (${h1.length} holds): streams with a position BASE ${pos("base")}, GATED ${pos("gated")}; voiced time admitted to the readout per hold, max: BASE ${f2(adm("base"))} s, GATED ${f2(adm("gated"))} s; verdict "sustained" over the hold after its first second, median: BASE ${pct(sus("base"))}, GATED ${pct(sus("gated"))}; voiced hops hidden ${pct(h1.reduce((a, r) => a + r.voicedHidden, 0) / Math.max(1, h1.reduce((a, r) => a + r.voicedPosts, 0)))}.`);
    S.h1 = { posBase: pos("base"), posGated: pos("gated") };
  }
  const h2 = sets(["H2"]);
  if (h2.length) {
    // voiced time admitted to the readout during each annotated hold (+0.3 s
    // for late stamping): the readout's voiced clock, difference between posts
    const admittedIn = (r, arm) => {
      let tot = 0;
      for (const [t0, t1] of r.holds) {
        const at = (t) => { let v = 0; for (const x of r[arm]) { if (x[0] <= t) v = x[4] ?? 0; else break; } return v; };
        tot += at(t1 + 0.3) - at(t0);
      }
      return tot;
    };
    const b = h2.reduce((a, r) => a + admittedIn(r, "base"), 0), g = h2.reduce((a, r) => a + admittedIn(r, "gated"), 0);
    const holdS = h2.reduce((a, r) => a + r.holds.reduce((s, [t0, t1]) => s + t1 - t0, 0), 0);
    say(`H2 PVQD (${h2.length} recordings, ${holdS.toFixed(0)} s of annotated holds): voiced time admitted to the readout inside the holds BASE ${b.toFixed(1)} s, GATED ${g.toFixed(1)} s.`);
    S.h2 = { b, g };
  }
  say("");

  // ---- D1
  const d1 = sets(["D1"]);
  if (d1.length) {
    say("## Speech, then 30 s of noise (information)");
    say("");
    say("| stream | u range during the noise BASE | GATED | position share during noise BASE | GATED |");
    say("|---|---|---|---|---|");
    for (const r of d1) {
      const part = (arm) => r[arm].filter((x) => x[0] >= 30.3);
      const rng = (arm) => { const u = part(arm).map((x) => x[1]).filter((v) => v !== null); return u.length ? Math.max(...u) - Math.min(...u) : null; };
      const sh = (arm) => { const p = part(arm); return p.length ? p.filter((x) => x[1] !== null).length / p.length : null; };
      say(`| ${r.sex} · ${r.cls} | ${f2(rng("base"))} | ${f2(rng("gated"))} | ${pct(sh("base"))} | ${pct(sh("gated"))} |`);
    }
    say("");
  }

  // ---- private / single recording
  const P = sets(["P"]);
  for (const r of P) {
    const b = share([r], "base"), g = share([r], "gated");
    say(`Recording ${r.id}: ${r.dur.toFixed(0)} s; voiced hops ${r.voicedPosts}/${r.pitchPosts}, hidden ${r.voicedHidden}; position share BASE ${pct(b)}, GATED ${pct(g)}; at the clamp BASE ${pct(r.base.filter((x) => x[1] !== null && x[2] !== 0).length / r.base.length)}, GATED ${pct(r.gated.filter((x) => x[1] !== null && x[2] !== 0).length / r.gated.length)}.`);
  }

  // ---- verdict
  if (S.f && S.m && S.noise) {
    const sp = ["f", "m"].every((k) => S[k].med !== null && S[k].med <= 0.02 && S[k].inc !== null && S[k].inc <= 0.5 && S[k].never === 0);
    const nz = S.noise.b > 0 && S.noise.g <= 0.2 * S.noise.b;
    const hd = !S.h1 || (S.h1.posGated === 0) ; const hd2 = !S.h2 || S.h2.g <= S.h2.b;
    say(`Verdict: speech ${sp ? "PASS" : "FAIL"}, noise ${nz ? "PASS" : "FAIL"}, held ${hd && hd2 ? "PASS" : "FAIL"} -> ${sp && nz && hd && hd2 ? "PASS" : "FAIL"}`);
  }
  const js = arg("json", "");
  if (js) writeFileSync(js, JSON.stringify({ summary: S, lines }, null, 1));
}
