// switch-asymmetry.mjs — how fast does the Dashboard resonance row follow a
// change of resonance, up vs down? (measurements/resonance-switch-asymmetry-2026-10-21.md)
//
//   SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs scripts/resonance/switch-asymmetry.mjs \
//        --split=dev [--shard=i/n] [--out=build/resonance-switch/run-<split>-<i>of<n>.jsonl]
//
// Streams (from switch-streams.mjs, readers-<split>.json; segments 0-18 /
// 18-36 / 36-54 s, 10 ms crossfades at the joins):
//   (a) same reader, WORLD-rendered:  <r>__a<k|m>__DBD / BDB (switches) and
//       DDD / BBB (that variant alone: the controls); k = pitch kept, m = pitch
//       moves with the resonance (-3 / +3 st).
//   (b) different readers: <split>__pair<i>__MWM / WMW (man i, woman i of the
//       split, each segment from that reader's own recording at that time) and
//       the readers' own recordings as controls (<r>__O).
// Per stream: the REAL pitch worker with the real FireRedVAD model (decision
// on every hop), the REAL DSP worker, the REAL hook (voice-gate setting on:
// raw voiced / holding and gated pitchVoiced / pitchHolding), and the
// resonance cue twice: arm "off" (hint as posted, row on the raw flags) and
// arm "on" (hint voiced:false where the detector says no voice, row on the
// gated flags; what cue-strip ships). Per arm the REAL resonance worker
// (fake self) runs next to a replica built from the same modules exactly as
// its startEngine() (lab-engine "frames" + resonanceCue + narrowband) with a
// tap on every stamped vtln bin (te, voiced stamp, value, admitted, verdict);
// every worker post is checked equal to the replica (parity counted).
// Per 25 ms chunk and arm: the posted u, verdict, startU, and the REAL row
// state / drawn dot / header (cueStripModel.js). Workers run with a frozen
// performance.now (no overload switch-off); the hook with +1 s per call.
//
// Candidate replays (--cand=<name>): see switch-candidates.mjs; the replica
// then uses the candidate cue and the parity check is skipped for that arm.
import { readFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const SR = 48000, CH = 1200, SEG = 18;
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);

const ORT_DIST = path.join(repo, "node_modules/onnxruntime-web/dist");
const ort = await import(pathToFileURL(path.join(ORT_DIST, "ort.wasm.bundle.min.mjs")).href);
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmBinary = readFileSync(path.join(ORT_DIST, "ort-wasm-simd-threaded.wasm"));
const { createFireRedRunner, parseKaldiCmvn } = await imp("src/dsp/firered-vad.js");
const { LOCAL_MODEL_DIR: MD } = await imp("scripts/firered/local-model.mjs");
if (!existsSync(path.join(MD, "cmvn.ark"))) { console.error("model files missing: node scripts/fetch-firered-model.mjs"); process.exit(2); }
const session = await ort.InferenceSession.create(readFileSync(path.join(MD, "fireredvad_stream_vad_with_cache.onnx")), { executionProviders: ["wasm"] });
const cmvn = parseKaldiCmvn(readFileSync(path.join(MD, "cmvn.ark")));

let target = [];
globalThis.self = { postMessage: (m) => target.push(m) };
const W = await imp("src/dsp/pitch-worker.js");
const pitchOn = self.onmessage;
const readPublic = (name) => JSON.parse(readFileSync(path.join(repo, "public/resonance-lab", name), "utf8"));
globalThis.fetch = async (url) => {
  const name = String(url).split("resonance-lab/").pop();
  const file = path.join(repo, "public/resonance-lab", name);
  if (!existsSync(file)) return { ok: false, status: 404 };
  const txt = readFileSync(file, "utf8");
  return { ok: true, status: 200, json: async () => JSON.parse(txt) };
};
await imp("src/resonance/resonance-worker.js");
const resOn = self.onmessage;
await imp("src/dsp/dsp-worker.js");
const dspOn = self.onmessage;
const turn = () => new Promise((r) => setImmediate(r));
const CS = await imp("src/components/cueStripModel.js");
const { createLabEngine } = await imp("src/resonance-lab/lab-engine.js");
const { createResonanceCue } = await imp("src/resonance/resonanceCue.js");
const { createNarrowbandDetector } = await imp("src/resonance/narrowband.js");
const VTLN = readPublic("vtln_warp.json"), REF = readPublic("reference.json");
let M;
try { ({ M } = await imp("scripts/session-oracle/lib/react-mock.mjs")); } catch (err) {
  console.error(`needs: node --import ./scripts/session-oracle/lib/register.mjs (${err.message})`); process.exit(2);
}
const hookUrl = pathToFileURL(path.join(repo, "src/audio/useAudioPipeline.js")).href;
let fakeNow = 0;
const frozenPerf = { now: () => 0, timeOrigin: 0, mark() {}, measure() {} };
const hookPerf = { now: () => (fakeNow += 1000), timeOrigin: 0, mark() {}, measure() {} };
const setPerf = (p) => Object.defineProperty(globalThis, "performance", { value: p, configurable: true, writable: true });
setPerf(frozenPerf);

const VERD = ["silent", "warming", "score", "sustained", "pause", "stale"];
const ROW_STATES = ["starting", "restarting", "reload", "unavailable", "paused", "narrowband", "idle", "sustained", "warming", "settling", "holding", "live"];
const HDRS = [];
const hdrIdx = (h) => { let i = HDRS.indexOf(h); if (i < 0) { HDRS.push(h); i = HDRS.length - 1; } return i; };

// 1. pitch worker + detector
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
  let seen = posts.length;
  const n = Math.ceil(y.length / CH);
  for (let k = 0; k < n; k++) {
    const x = y.slice(k * CH, Math.min(y.length, (k + 1) * CH));
    port.onmessage({ data: { buffer: x.buffer, contextTime: Math.min(y.length, (k + 1) * CH) / SR } });
    await turn();
    for (const m of posts.slice(seen)) {
      if (m.type === "vad-status" && m.status !== "ready") throw new Error(`detector ${m.status}: ${m.message ?? ""}`);
      if (m.type === "status" && m.status === "error") throw new Error(`pitch worker error: ${m.message}`);
    }
    byChunk.push(posts.slice(seen).filter((m) => m.type === "pitch"));
    seen = posts.length;
  }
  for (let i = 0; i < 50; i++) await turn();
  byChunk[byChunk.length - 1].push(...posts.slice(seen).filter((m) => m.type === "pitch"));
  W.setVadModelLoaderForTests(null);
  return byChunk;
}

// 2. DSP worker intensity
function dspPass(y, n) {
  const posts = [];
  target = posts;
  dspOn({ data: { type: "init", sampleRate: SR } });
  const port = {};
  dspOn({ data: { type: "port", port } });
  const inten = new Float32Array(n).fill(NaN);
  for (let k = 0; k < n; k++) {
    const x = y.slice(k * CH, Math.min(y.length, (k + 1) * CH));
    posts.length = 0;
    port.onmessage({ data: { buffer: x.buffer, contextTime: Math.min(y.length, (k + 1) * CH) / SR } });
    for (const m of posts) if (m.type === "analysis") inten[k] = m.data.intensity;
  }
  return inten;
}

// 3. the REAL hook (setting on): bit 0 voiced, 1 holding (raw), 2 pitchVoiced, 3 pitchHolding
let hookGen = 0;
async function hookPass(byChunk, inten) {
  setPerf(hookPerf);
  try {
    M.refs = []; M.effects = []; M.state = null;
    const mod = await import(`${hookUrl}?sw=${++hookGen}`);
    mod.useAudioPipeline();
    for (const e of M.effects) { try { e(); } catch { /* browser-only */ } }
    const latest = M.refs.find((r) => r.current && typeof r.current === "object" && "pitch" in r.current && "ts" in r.current && "confidence" in r.current && "voiced" in r.current);
    const har = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handleAnalysisResult");
    if (!latest || !har) throw new Error("could not locate latestPitchRef / handleAnalysisResultRef");
    const n = byChunk.length, flags = new Uint8Array(n);
    let cur = { pitch: null, confidence: null, voiced: false, ts: 0, vadVoice: null, vadP: null };
    const code = (s) => (s.voiced ? 1 : 0) | (s.holding ? 2 : 0) | (s.pitchVoiced ? 4 : 0) | (s.pitchHolding ? 8 : 0);
    let last = code(M.state);
    for (let k = 0; k < n; k++) {
      const now = (k + 1) * CH / SR * 1000;
      const msgs = byChunk[k];
      if (msgs.length) {
        const m = msgs[msgs.length - 1];
        const vad = m.vad && typeof m.vad.voice === "boolean" ? m.vad : null;
        cur = { pitch: m.pitch, confidence: m.confidence, voiced: m.voiced, ts: now, vadVoice: vad ? vad.voice : null, vadP: vad ? vad.p : null };
      }
      if (!Number.isNaN(inten[k])) {
        latest.current = cur;
        har.current({ intensity: inten[k], formants: null, spectralTilt: null, hnr: null, cpp: null, absoluteTime: now });
        last = code(M.state);
      }
      flags[k] = last;
    }
    return flags;
  } finally { setPerf(frozenPerf); }
}

// 4. resonance: the REAL worker + the tapped replica, one arm
function replica() {
  const cue = createResonanceCue({ reference: REF });
  const nb = createNarrowbandDetector();
  const bins = [];
  const engine = createLabEngine({
    sampleRate: SR, models: { vtln: VTLN }, reference: REF, pitchSource: "frames",
    onStamped: (name, te, stampS, value) => {
      if (name !== "vtln") return;
      const adm = cue.onStamped(te, stampS, value);
      bins.push([+te.toFixed(3), +stampS.toFixed(3), value == null ? null : +value.toFixed(5), adm ? 1 : 0, VERD.indexOf(cue.snapshot().verdict)]);
    },
    onGridFrame: (j, f0, ring16) => {
      if (!(f0 > 0)) return;
      const st = nb.frame((i) => ring16.at(i), Math.round((0.005 + 0.01 * j) * 16000));
      cue.noteNarrowband(st.on);
    },
  });
  return { cue, nb, engine, bins };
}
async function resonancePass(y, byChunk, gated) {
  const posts = [];
  target = posts;
  resOn({ data: { type: "init", sampleRate: SR, assetBase: "/", diag: false } });
  for (let i = 0; i < 200 && !posts.some((m) => m.type === "status" && m.status !== "loading"); i++) await turn();
  const st = posts.find((m) => m.type === "status" && m.status !== "loading");
  if (!st || st.status !== "ready") throw new Error(`resonance worker: ${st?.status} ${st?.message ?? ""}`);
  const port = {};
  resOn({ data: { type: "audioPort", port } });
  const R = replica();
  const n = byChunk.length;
  const snaps = new Array(n);
  let snap = null, parityN = 0, parityBad = 0, sincePost = 0;
  const hint = []; // per chunk: last hint pitch relayed (0 = unvoiced), -1 none
  for (let k = 0; k < n; k++) {
    const x = y.slice(k * CH, Math.min(y.length, (k + 1) * CH));
    const ct = Math.min(y.length, (k + 1) * CH) / SR;
    const before = posts.length;
    port.onmessage({ data: { buffer: x.slice().buffer, contextTime: ct } });
    // replica: the worker's onChunk
    R.cue.noteChunk(ct);
    R.engine.pushChunk(x, null, ct);
    sincePost += x.length / SR;
    let rep = null;
    if (sincePost >= 0.2) { sincePost = 0; const s = R.cue.snapshot(); const pos = R.nb.state.decided; rep = { u: pos ? s.u : null, verdict: s.verdict, startU: s.startU }; }
    let h = -1;
    for (const m of byChunk[k]) {
      const hide = gated && m.vad && m.vad.voice === false;
      const voiced = hide ? false : m.voiced;
      resOn({ data: { type: "pitch-hint", voiced, pitch: m.pitch, contextTime: m.contextTime ?? null } });
      const c = m.contextTime;
      if (typeof c === "number" && Number.isFinite(c)) {
        R.cue.notePitchHint({ voiced: !!voiced, pitch: m.pitch, contextTime: c });
        R.engine.pushPitchFrame(c, voiced ? m.pitch : 0);
      }
      h = voiced && m.pitch ? m.pitch : 0;
    }
    hint.push(h < 0 ? -1 : +h.toFixed(1));
    for (const m of posts.slice(before)) {
      if (m.type === "status") throw new Error(`resonance worker status ${m.status} ${m.message ?? ""}`);
      if (m.type !== "state") continue;
      snap = m;
      parityN++;
      if (!rep || rep.u !== m.u || rep.verdict !== m.verdict || rep.startU !== m.startU) parityBad++;
    }
    snaps[k] = snap;
  }
  return { snaps, bins: R.bins, parityN, parityBad, hint };
}

function rowArm(snaps, flags, gatedFlags) {
  const n = snaps.length;
  const out = { u: [], verdict: [], startU: [], state: [], dot: [], hdr: [], voicedS: [], fill: [] };
  for (let k = 0; k < n; k++) {
    const s = snaps[k], f = flags[k];
    const voiced = gatedFlags ? !!(f & 4) : !!(f & 1), holding = gatedFlags ? !!(f & 8) : !!(f & 2);
    const state = CS.resonanceRowState({ workerStatus: "ready", snap: s, voiced, holding });
    const value = CS.rowValue("resonance", { snap: s });
    const dot = CS.dotOpacity(state) !== null && value != null;
    out.u.push(s?.u == null ? null : +s.u.toFixed(4));
    out.verdict.push(s ? VERD.indexOf(s.verdict) : -1);
    out.startU.push(s?.startU == null ? null : +s.startU.toFixed(4));
    out.state.push(ROW_STATES.indexOf(state));
    out.dot.push(dot ? 1 : 0);
    out.hdr.push(hdrIdx(CS.resonanceHeader(state, s)));
    out.voicedS.push(s ? +s.voicedS.toFixed(3) : 0);
    out.fill.push(s ? +(s.fill ?? 0).toFixed(3) : 0);
  }
  return out;
}

// ---- streams
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
function splice(parts, joins = [SEG, 2 * SEG]) {
  // three Float32Arrays (54 s each); segment i from parts[i]; 10 ms crossfade centred on each join
  const n = Math.min(...parts.map((p) => p.length)), y = new Float32Array(n), X = Math.round(0.005 * SR);
  const j1 = Math.round(joins[0] * SR), j2 = Math.round(joins[1] * SR);
  for (let i = 0; i < n; i++) {
    let w;
    if (i < j1 - X) w = [1, 0, 0];
    else if (i < j1 + X) { const a = (i - (j1 - X)) / (2 * X); w = [1 - a, a, 0]; }
    else if (i < j2 - X) w = [0, 1, 0];
    else if (i < j2 + X) { const a = (i - (j2 - X)) / (2 * X); w = [0, 1 - a, a]; }
    else w = [0, 0, 1];
    y[i] = w[0] * parts[0][i] + w[1] * parts[1][i] + w[2] * parts[2][i];
  }
  return y;
}
const split = arg("split", "dev");
// --patterns: which join times. "" = 18 / 36 s (three equal segments); "x6" = 30 / 36 s (a 6 s
// excursion after 30 s), "x10" = 30 / 40 s. --patterns=,x6,x10 runs all three.
const PATTERN_JOINS = { "": [SEG, 2 * SEG], x6: [30, 36], x10: [30, 40] };
const PATTERNS = arg("patterns", "").split(",").map((p) => [p, PATTERN_JOINS[p]]);
if (PATTERNS.some(([, j]) => !j)) throw new Error("unknown --patterns");
const controlsToo = !process.argv.includes("--no-controls");
const L = JSON.parse(readFileSync(path.join(repo, `build/resonance-switch/readers-${split}.json`), "utf8"));
const vp = (r, v) => r.variants.find((x) => x.v === v).path;
let items = [];
for (const r of L.readers) {
  for (const mode of ["k", "m"]) {
    const D = vp(r, `D${mode}`), B = vp(r, `B${mode}`);
    const base = { reader: r.id, sex: r.sex, split, kind: "a", mode };
    for (const [pat, joins] of PATTERNS) {
      items.push({ ...base, id: `${r.id}__a${mode}__DBD${pat}`, seq: "DBD", joins, load: () => splice([readF32(D), readF32(B), readF32(D)], joins) });
      items.push({ ...base, id: `${r.id}__a${mode}__BDB${pat}`, seq: "BDB", joins, load: () => splice([readF32(B), readF32(D), readF32(B)], joins) });
    }
    if (controlsToo) {
      items.push({ ...base, id: `${r.id}__a${mode}__DDD`, seq: "DDD", load: () => readF32(D) });
      items.push({ ...base, id: `${r.id}__a${mode}__BBB`, seq: "BBB", load: () => readF32(B) });
    }
  }
  if (controlsToo) items.push({ reader: r.id, sex: r.sex, split, kind: "b", id: `${r.id}__O`, seq: r.sex === "m" ? "MMM" : "WWW", load: () => readF32(vp(r, "O")) });
}
const men = L.readers.filter((r) => r.sex === "m"), women = L.readers.filter((r) => r.sex === "f");
for (let i = 0; i < Math.min(men.length, women.length); i++) {
  const m = vp(men[i], "O"), w = vp(women[i], "O");
  const base = { split, kind: "b", man: men[i].id, woman: women[i].id };
  for (const [pat, joins] of PATTERNS) {
    items.push({ ...base, id: `${split}__pair${i}__MWM${pat}`, seq: "MWM", joins, load: () => splice([readF32(m), readF32(w), readF32(m)], joins) });
    items.push({ ...base, id: `${split}__pair${i}__WMW${pat}`, seq: "WMW", joins, load: () => splice([readF32(w), readF32(m), readF32(w)], joins) });
  }
}
const only = new Set(arg("only", "").split(",").filter(Boolean));
if (only.size) items = items.filter((it) => only.has(it.id));
const [si, sn] = arg("shard", "0/1").split("/").map(Number);
items = items.filter((_, i) => i % sn === si);
const out = path.resolve(repo, arg("out", `build/resonance-switch/run-${split}-${si}of${sn}.jsonl`));
mkdirSync(path.dirname(out), { recursive: true });
const done = new Set(existsSync(out) ? readFileSync(out, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l).id) : []);
console.log(`${items.length} streams (${done.size} done) -> ${out}`);
const t0 = Date.now();
let audioS = 0;
for (const it of items) {
  if (done.has(it.id)) continue;
  const y = it.load();
  let byChunk = null;
  for (let retry = 0; ; retry++) {
    try { byChunk = await pitchPass(y); break; } catch (err) {
      if (!/detector slow/.test(String(err?.message)) || retry >= 3) throw err;
      target = []; for (let i = 0; i < 200; i++) await turn();
    }
  }
  const n = byChunk.length;
  const inten = dspPass(y, n);
  const flags = await hookPass(byChunk, inten);
  const off = await resonancePass(y, byChunk, false);
  const on = await resonancePass(y, byChunk, true);
  const pitch = byChunk.map((ms) => { const m = ms[ms.length - 1]; return m ? (m.voiced && m.pitch ? +m.pitch.toFixed(1) : 0) : -1; });
  const vad = byChunk.map((ms) => { const m = ms[ms.length - 1]; return m?.vad ? (m.vad.voice ? 1 : 0) : -1; });
  const rec = {
    ...Object.fromEntries(Object.entries(it).filter(([k]) => k !== "load")),
    dur: y.length / SR, n, pitch, vad, flags: Array.from(flags),
    off: { ...rowArm(off.snaps, flags, false), bins: off.bins, hint: off.hint, parityN: off.parityN, parityBad: off.parityBad },
    on: { ...rowArm(on.snaps, flags, true), bins: on.bins, hint: on.hint, parityN: on.parityN, parityBad: on.parityBad },
    hdrs: HDRS,
  };
  appendFileSync(out, JSON.stringify(rec) + "\n");
  audioS += rec.dur;
  console.log(`${it.id}  parity ${off.parityN - off.parityBad}/${off.parityN} ${on.parityN - on.parityBad}/${on.parityN}  [${(audioS / ((Date.now() - t0) / 1000)).toFixed(1)}x]`);
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(0);
