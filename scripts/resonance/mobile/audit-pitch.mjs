// audit-pitch.mjs — phone-vs-desktop audit (resonance cue), step 1: the REAL
// pitch worker (src/dsp/pitch-worker.js, fake self) with the REAL FireRedVAD
// model (frozen performance clock, so the 0.5 s "slow" switch-off never
// fires, as scripts/resonance/faster.mjs) over public LibriSpeech streams
// under input conditions a phone may differ in (level, band-limits).
//
//   node scripts/resonance/mobile/audit-pitch.mjs --readers=<readers-dev.json>
//        --conds=c0,g10,g20,g30 --streams=L,N,U10,NUN [--shard=i/n]
//        [--out=build/resonance-mobile/audit]
//
// Streams (48 kHz float32, from faster-streams.mjs output, read only):
//   L    the reader's own 150 s of reading with 0.3 s gaps
//   N    WORLD re-render, unchanged (54 s)       U10  formants +12 % (54 s)
//   NUN  N 0-18 s, U10 18-36 s, N 36-54 s (10 ms crossfades)
// Conditions (applied to the 48 kHz stream before chunking):
//   c0 as is; gNN gain -NN dB; gNNpnMM gain -NN dB plus pink noise at -MM dBFS
//   RMS (a fixed floor, seeded); lpNk 4th-order Butterworth low-pass at N kHz;
//   hp200 2nd-order Butterworth high-pass at 200 Hz; hsN -N dB high shelf at 3 kHz.
// Output per (cond, stream): <out>/pitch/<cond>/<id>.json with per chunk the
// posted pitch messages [voiced, pitch, contextTime, vad.voice] (as faster.mjs)
// plus the RMS (dBFS) of the 50 ms around each posted frame's centre.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const SR = 48000, CH = 1200;
const OUT = path.resolve(repo, arg("out", "build/resonance-mobile/audit"));
const turn = () => new Promise((r) => setImmediate(r));
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };

export function splice3(parts, joins) {
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

// RBJ biquads (float64 state), applied in place.
function biquad(x, b0, b1, b2, a0, a1, a2) {
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi; x[i] = yi;
  }
}
function lp(x, fc, Q) { const w = 2 * Math.PI * fc / SR, c = Math.cos(w), al = Math.sin(w) / (2 * Q); biquad(x, (1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al); }
function hp(x, fc, Q) { const w = 2 * Math.PI * fc / SR, c = Math.cos(w), al = Math.sin(w) / (2 * Q); biquad(x, (1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al); }
function highShelf(x, fc, gainDb) {
  const A = 10 ** (gainDb / 40), w = 2 * Math.PI * fc / SR, c = Math.cos(w), s = Math.sin(w), al = s / 2 * Math.SQRT2, sq = 2 * Math.sqrt(A) * al;
  biquad(x, A * ((A + 1) + (A - 1) * c + sq), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sq),
    (A + 1) - (A - 1) * c + sq, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sq);
}
// Pink noise (Paul Kellett's refined filter on seeded uniform white noise),
// scaled to an absolute RMS of `dbfs`: a fixed noise floor under the speech,
// as a microphone with AGC off has (the floor does not scale with the voice).
function pinkNoise(n, dbfs, seed = 20261028) {
  let s = seed >>> 0;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 * 2 - 1; };
  const y = new Float64Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd();
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
    y[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
  }
  let e = 0;
  for (let i = 0; i < n; i++) e += y[i] * y[i];
  const g = 10 ** (dbfs / 20) / Math.sqrt(e / n);
  for (let i = 0; i < n; i++) y[i] *= g;
  return y;
}

export function applyCond(y, cond) {
  const x = Float64Array.from(y);
  let m;
  if (cond === "c0") { /* as is */ }
  else if ((m = /^g(\d+)pn(\d+)$/.exec(cond))) { // gain -NN dB, then pink noise at -MM dBFS RMS
    const g = 10 ** (-Number(m[1]) / 20), nz = pinkNoise(x.length, -Number(m[2]));
    for (let i = 0; i < x.length; i++) x[i] = x[i] * g + nz[i];
  }
  else if ((m = /^g(\d+)$/.exec(cond))) { const g = 10 ** (-Number(m[1]) / 20); for (let i = 0; i < x.length; i++) x[i] *= g; }
  else if ((m = /^lp(\d+)k$/.exec(cond))) { const fc = Number(m[1]) * 1000; lp(x, fc, 0.5411961); lp(x, fc, 1.3065630); }
  else if (cond === "hp200") hp(x, 200, Math.SQRT1_2);
  else if ((m = /^hs(\d+)$/.exec(cond))) highShelf(x, 3000, -Number(m[1]));
  else throw new Error(`unknown condition ${cond}`);
  return Float32Array.from(x);
}

export function streamsFor(readersJson, names) {
  const L = JSON.parse(readFileSync(readersJson, "utf8"));
  const items = [];
  for (const r of L.readers) {
    const v = (n) => { const p = r.variants[n]; if (!p) throw new Error(`${r.id}: ${n} missing`); return p; };
    for (const s of names) {
      if (s === "NUN") items.push({ id: `${r.id}__NUN`, reader: r.id, sex: r.sex, stream: s, load: () => splice3([readF32(v("N")), readF32(v("U10")), readF32(v("N"))], [18, 36]) });
      else items.push({ id: `${r.id}__${s}`, reader: r.id, sex: r.sex, stream: s, load: () => readF32(v(s)) });
    }
  }
  return items;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const readersJson = path.resolve(repo, arg("readers", "build/resonance-mobile/streams/readers-dev.json"));
  const conds = arg("conds", "c0").split(",").filter(Boolean);
  const streams = arg("streams", "L,N,U10,NUN").split(",").filter(Boolean);
  let jobs = [];
  for (const c of conds) for (const it of streamsFor(readersJson, streams)) jobs.push({ ...it, cond: c });
  const only = new Set(arg("only", "").split(",").filter(Boolean));
  if (only.size) jobs = jobs.filter((j) => only.has(j.reader) || only.has(j.id));
  const [si, sn] = arg("shard", "0/1").split("/").map(Number);
  jobs = jobs.filter((_, i) => i % sn === si);

  const frozen = { now: () => 0, timeOrigin: 0, mark() {}, measure() {} };
  Object.defineProperty(globalThis, "performance", { value: frozen, configurable: true, writable: true });
  const ORT_DIST = path.join(repo, "node_modules/onnxruntime-web/dist");
  const ort = await import(pathToFileURL(path.join(ORT_DIST, "ort.wasm.bundle.min.mjs")).href);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmBinary = readFileSync(path.join(ORT_DIST, "ort-wasm-simd-threaded.wasm"));
  const { createFireRedRunner, parseKaldiCmvn } = await imp("src/dsp/firered-vad.js");
  const MD = path.join(repo, "build/models/firered");
  const session = await ort.InferenceSession.create(readFileSync(path.join(MD, "fireredvad_stream_vad_with_cache.onnx")), { executionProviders: ["wasm"] });
  const cmvn = parseKaldiCmvn(readFileSync(path.join(MD, "cmvn.ark")));
  let target = [];
  globalThis.self = { postMessage: (m) => target.push(m) };
  const W = await imp("src/dsp/pitch-worker.js");
  const pitchOn = self.onmessage;
  const t0 = Date.now();
  let audioS = 0;
  for (const it of jobs) {
    const dir = path.join(OUT, "pitch", it.cond);
    mkdirSync(dir, { recursive: true });
    const js = path.join(dir, `${it.id}.json`);
    if (existsSync(js)) continue;
    const y = applyCond(it.load(), it.cond);
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
    const rmsAt = (ct) => {
      const c = Math.round((ct - 0.04) * SR), h = Math.round(0.025 * SR);
      let s = 0, n = 0;
      for (let i = Math.max(0, c - h); i < Math.min(y.length, c + h); i++) { s += y[i] * y[i]; n++; }
      return n ? +(10 * Math.log10(s / n + 1e-20)).toFixed(2) : null;
    };
    const pick = (ms) => ms.filter((m) => m.type === "pitch").map((m) => [m.voiced ? 1 : 0, m.pitch, m.contextTime, m.vad ? (m.vad.voice ? 1 : 0) : -1, m.voiced ? rmsAt(m.contextTime) : null]);
    const nC = Math.ceil(y.length / CH);
    for (let k = 0; k < nC; k++) {
      const x = y.slice(k * CH, Math.min(y.length, (k + 1) * CH));
      port.onmessage({ data: { buffer: x.buffer, contextTime: Math.min(y.length, (k + 1) * CH) / SR } });
      await turn();
      for (const m of posts.slice(seen)) {
        if (m.type === "vad-status" && m.status !== "ready") throw new Error(`detector ${m.status}`);
        if (m.type === "status" && m.status === "error") throw new Error(`pitch worker error: ${m.message}`);
      }
      byChunk.push(pick(posts.slice(seen)));
      seen = posts.length;
    }
    for (let i = 0; i < 50; i++) await turn();
    byChunk[byChunk.length - 1].push(...pick(posts.slice(seen)));
    W.setVadModelLoaderForTests(null);
    writeFileSync(js, JSON.stringify({ id: it.id, reader: it.reader, sex: it.sex, stream: it.stream, cond: it.cond, dur: y.length / SR, byChunk }));
    audioS += y.length / SR;
    console.log(`${it.cond}/${it.id} [${(audioS / ((Date.now() - t0) / 1000)).toFixed(1)}x]`);
  }
  process.exit(0);
}
