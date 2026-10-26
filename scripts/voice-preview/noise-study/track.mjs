// track.mjs — Voice Shaper noise study, step 2 (measurements/voice-shaper-noise-2026-10-25.md):
// build each mixture and run the REAL pitch worker (with the REAL FireRedVAD detector, as
// scripts/session-oracle/lib/voice-gate.mjs does) over 6 s of pre-roll, the recording and 0.5 s
// after it, at production cadence. Keeps, per recorded chunk, what recorder.js would assign from
// the posted messages: pitch (0 = unvoiced), notched, plus the detector's { p, voice }.
//
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-preview/noise-study/track.mjs
//        --data=build/vsn/data --set=dev|test|sung --shard=i/N
//
// Writes <data>/mix/<set>/<mixId>.f32 (the recording, capture rate), <mixId>.pre.f32 (the last
// 2 s of capture before Record) and <mixId>.json (meta + per-chunk track). Mixture ids and noise
// draws are seeded, so every shard computes the same list and takes its own share.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] ?? "1"]; }));
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DATA = path.resolve(args.data ?? "build/vsn/data");
const SET = args.set ?? "dev";
const [SHARD, NSHARD] = (args.shard ?? "0/1").split("/").map(Number);
const man = JSON.parse(readFileSync(path.join(DATA, "manifest.json"), "utf8"));

export const PRE_S = 6, LEAD_S = 0.5, TAIL_S = 0.5, AFTER_S = 0.5, PRE_KEEP_S = 2;
export const SNRS = [0, 5, 10, 20];
// Quiet-room controls, added 2026-10-25 after the first dev round (the clean mixtures' padding is
// near-digital silence, which no room has); appended after SNRS so earlier draws are unchanged.
export const QUIET_SNRS = [30, 40];

// ---- seeded helpers ----
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
const writeF32 = (p, x) => writeFileSync(p, Buffer.from(x.buffer, x.byteOffset, x.byteLength));

// The fork's synthetic generators (white, pink, 120 Hz fan hum over rumble), dev only.
function synth(kind, n, sr, rnd) {
  const r = () => rnd() * 2 - 1;
  const x = new Float32Array(n);
  if (kind === "white") for (let i = 0; i < n; i++) x[i] = r();
  else if (kind === "pink") { let b0 = 0, b1 = 0, b2 = 0; for (let i = 0; i < n; i++) { const w = r(); b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; x[i] = b0 + b1 + b2 + w * 0.1848; } }
  else { let lp = 0; const a = 0.0195 * 48000 / sr; for (let i = 0; i < n; i++) { const t = i / sr; lp += a * (r() - lp); x[i] = Math.sin(2 * Math.PI * 120 * t) + 0.25 * Math.sin(2 * Math.PI * 240 * t + 1.1) + 0.12 * Math.sin(2 * Math.PI * 360 * t + 2.3) + 2.2 * lp; } }
  return x;
}
const rms = (x) => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length); };
function activeRms(x, F) {
  const e = []; for (let k = 0; k + F <= x.length; k += F) e.push(rms(x.subarray(k, k + F)));
  const mx = Math.max(...e); const a = e.filter((v) => v > mx * 0.01);
  return Math.sqrt(a.reduce((t, v) => t + v * v, 0) / a.length);
}

// ---- the mixture list (identical in every shard) ----
export function mixtures(man, set) {
  const speech = man.speech.filter((s) => s.set === set);
  const noiseSet = set === "sung" ? "test" : set;
  const pool = man.noise.filter((n) => n.set === noiseSet);
  const classes = [...new Set(pool.map((n) => n.class))].sort();
  if (set === "dev") classes.push("syn-white", "syn-pink", "syn-fan");
  const out = [];
  for (const s of speech) {
    const rnd = mulberry(hash(`${set}/${s.id}`));
    out.push({ id: `${s.id}__clean`, speech: s, snr: null, noise: null });
    const snrs = set === "sung" ? [10] : [...SNRS, ...QUIET_SNRS];
    for (const snr of snrs) {
      const draws = set === "sung" || QUIET_SNRS.includes(snr) ? 1 : 2;
      const used = new Set();
      for (let d = 0; d < draws; d++) {
        let cls; do cls = classes[Math.floor(rnd() * classes.length)]; while (used.has(cls));
        used.add(cls);
        let noise;
        if (cls.startsWith("syn-")) noise = { class: cls, id: cls, synth: cls.slice(4) };
        else { const items = pool.filter((n) => n.class === cls); noise = items[Math.floor(rnd() * items.length)]; }
        out.push({ id: `${s.id}__${snr}dB_${d}`, speech: s, snr, noise, offsetFrac: rnd(), seed: Math.floor(rnd() * 2 ** 31) });
      }
    }
  }
  return out;
}

function buildStream(mx) {
  const sr = mx.speech.rate;
  const C = Math.floor(0.025 * sr);
  const sp = readF32(path.join(DATA, mx.speech.path));
  const lead = Math.round(LEAD_S * sr), tail = Math.round(TAIL_S * sr);
  let nRec = Math.floor((lead + sp.length + tail) / C) * C;
  nRec = Math.min(nRec, Math.floor(8 * sr / C) * C);
  const nPre = Math.round(PRE_S * sr / C) * C, nAfter = Math.round(AFTER_S * sr / C) * C;
  const total = nPre + nRec + nAfter;
  const clean = new Float32Array(total);
  clean.set(sp.subarray(0, Math.min(sp.length, nRec - lead)), nPre + lead);
  const stream = Float32Array.from(clean);
  let gain = 0;
  if (mx.noise) {
    let nz;
    if (mx.noise.synth) nz = synth(mx.noise.synth, total, sr, mulberry(mx.seed));
    else {
      const full = readF32(path.join(DATA, sr === 44100 ? mx.noise.path.replace(/\.f32$/, "_44k.f32") : mx.noise.path));
      const off = Math.floor(mx.offsetFrac * Math.max(0, full.length - total));
      nz = full.subarray(off, off + total);
      if (nz.length < total) throw new Error(`noise ${mx.noise.id} too short`);
    }
    const nr = rms(nz.subarray(nPre, nPre + nRec));
    gain = activeRms(sp, Math.round(0.02 * sr)) / 10 ** (mx.snr / 20) / nr;
    for (let i = 0; i < total; i++) stream[i] += gain * nz[i];
  } else {
    const rnd = mulberry(hash(mx.id));
    const d = 10 ** (-90 / 20) * Math.sqrt(3); // -90 dBFS RMS uniform dither
    for (let i = 0; i < total; i++) stream[i] += d * (rnd() * 2 - 1);
  }
  return { sr, C, stream, nPre, nRec, nAfter, gain };
}

// ---- the real pitch worker with the detector (voice-gate.mjs's runWorkersVad, pitch only) ----
const turn = () => new Promise((r) => setImmediate(r));
async function loadWorker() {
  const ORT_DIST = path.join(REPO, "node_modules/onnxruntime-web/dist");
  const ort = await import(pathToFileURL(path.join(ORT_DIST, "ort.wasm.bundle.min.mjs")).href);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmBinary = readFileSync(path.join(ORT_DIST, "ort-wasm-simd-threaded.wasm"));
  const P = { posts: [], postMessage(m) { this.posts.push(m); } };
  globalThis.self = P;
  const PW = await import(pathToFileURL(path.join(REPO, "src/dsp/pitch-worker.js")).href);
  const FV = await import(pathToFileURL(path.join(REPO, "src/dsp/firered-vad.js")).href);
  const { PATH_DEFAULTS } = await import(pathToFileURL(path.join(REPO, "src/dsp/boersma-ac.js")).href);
  const { LOCAL_MODEL_DIR } = await import(pathToFileURL(path.join(REPO, "scripts/firered/local-model.mjs")).href);
  const file = (key) => path.join(LOCAL_MODEL_DIR, FV.FIRERED_MODEL.files.find((f) => f.key === key).name);
  const session = await ort.InferenceSession.create(readFileSync(file("onnx")), { executionProviders: ["wasm"] });
  const cmvn = FV.parseKaldiCmvn(readFileSync(file("cmvn")));
  return { P, PW, FV, ort, session, cmvn, L: PATH_DEFAULTS.lookback };
}

export async function runPitch(Wk, samples, sr, C) {
  const { P, PW, FV, ort, session, cmvn, L } = Wk;
  const n = Math.floor(samples.length / C);
  const post = new Float32Array(n), vadP = new Float32Array(n).fill(NaN), vadV = new Int8Array(n).fill(-1), notched = new Uint8Array(n);
  const got = new Uint8Array(n);
  const clock = globalThis.performance;
  globalThis.performance = { now: () => 0, timeOrigin: 0, mark() {}, measure() {} };
  try {
    PW.setVadModelLoaderForTests(async () => ({ runner: FV.createFireRedRunner(ort, session), cmvn }));
    globalThis.self = P; P.posts = [];
    P.onmessage({ data: { type: "init", inputSampleRate: sr, vad: { modelBase: "test:" } } });
    for (let i = 0; i < 500 && !P.posts.some((m) => m.type === "vad-status" && m.status !== "loading"); i++) await turn();
    const st = P.posts.find((m) => m.type === "vad-status" && m.status !== "loading");
    if (!st || st.status !== "ready") throw new Error(`detector not ready: ${st?.status}`);
    const pp = {}; P.onmessage({ data: { type: "audioPort", port: pp } });
    let seen = P.posts.length;
    const take = () => {
      for (let i = seen; i < P.posts.length; i++) {
        const m = P.posts[i];
        if (m.type === "status" && m.status === "error") throw new Error(`pitch worker: ${m.message}`);
        if (m.type === "vad-status") throw new Error(`detector ${m.status}: ${m.message ?? ""}`);
        if (m.type !== "pitch") continue;
        const kk = Math.round(m.contextTime * sr / C) - 1;
        if (kk < 0 || kk >= n || got[kk]) continue;
        got[kk] = 1;
        post[kk] = m.pitch > 0 ? m.pitch : 0;
        notched[kk] = Array.isArray(m.notchedFreqs) && m.notchedFreqs.length > 0 ? 1 : 0;
        if (m.vad && typeof m.vad.voice === "boolean") { vadP[kk] = m.vad.p; vadV[kk] = m.vad.voice ? 1 : 0; }
      }
      seen = P.posts.length;
    };
    for (let k = 0; k < n; k++) {
      const a = Float32Array.from(samples.subarray(k * C, (k + 1) * C));
      pp.onmessage({ data: { buffer: a.buffer, contextTime: (k + 1) * C / sr } });
      for (let i = 0; i < 200; i++) {
        await turn();
        if (k < L || P.posts.slice(seen).some((m) => m.type === "pitch" && Math.round(m.contextTime * sr / C) - 1 + L === k)) break;
      }
      take();
    }
    for (let i = 0; i < 20; i++) await turn();
    take();
  } finally {
    PW.setVadModelLoaderForTests(null);
    globalThis.performance = clock;
  }
  return { post, vadP, vadV, notched, got };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const list = mixtures(man, SET).filter((_, i) => i % NSHARD === SHARD);
  const outDir = path.join(DATA, "mix", SET);
  mkdirSync(outDir, { recursive: true });
  const Wk = await loadWorker();
  let done = 0; const t0 = Date.now();
  for (const mx of list) {
    const jp = path.join(outDir, `${mx.id}.json`);
    if (existsSync(jp) && !args.force) { done++; continue; }
    const S = buildStream(mx);
    const R = await runPitch(Wk, S.stream, S.sr, S.C);
    const k0 = S.nPre / S.C, nk = S.nRec / S.C;
    const sl = (a) => Array.from(a.subarray(k0, k0 + nk), (v) => (Number.isNaN(v) ? null : +v.toFixed(4)));
    writeF32(path.join(outDir, `${mx.id}.f32`), S.stream.subarray(S.nPre, S.nPre + S.nRec));
    writeF32(path.join(outDir, `${mx.id}.pre.f32`), S.stream.subarray(S.nPre - Math.round(PRE_KEEP_S * S.sr / S.C) * S.C, S.nPre));
    writeFileSync(jp, JSON.stringify({
      id: mx.id, set: SET, speech: { id: mx.speech.id, sex: mx.speech.sex, speaker: mx.speech.speaker, source: mx.speech.source },
      snr: mx.snr, noise: mx.noise ? { class: mx.noise.class, id: mx.noise.id } : null, gain: S.gain,
      rate: S.sr, chunk: S.C, chunks: nk, leadS: LEAD_S,
      track: sl(R.post), vadP: sl(R.vadP), vadV: sl(R.vadV), notched: sl(R.notched), received: sl(R.got).reduce((a, b) => a + b, 0),
    }));
    done++;
    if (done % 10 === 0) console.log(`[${SHARD}/${NSHARD}] ${done}/${list.length} ${((Date.now() - t0) / done / 1000).toFixed(2)} s/mix`);
  }
  console.log(`[${SHARD}/${NSHARD}] done ${done}`);
}
