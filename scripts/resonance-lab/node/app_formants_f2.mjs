// app_formants_f2.mjs — B1 bridge: the app's own formant extractor
// (src/dsp/formants.js, unmodified import) emulating production capture.
//
// Per job (16 kHz float32 audio + 10 ms F0 track, t_k = 0.005 + 0.01 k):
//  * every 150 ms (dsp-worker: formants on every 6th 25 ms frame) take the last
//    50 ms (WINDOW_MS), band-limited-upsampled 16 k -> 48 k (production capture
//    rate; Hann-windowed sinc, half-width 32 taps per phase);
//  * pitch hint = F0 ~90 ms before the window end (pitch-worker display latency),
//    null when unvoiced -> the extractor's female/unknown branch, as in production;
//  * only frames voiced at the window centre are emitted (display gating);
//  * F2 goes through the app's 7-sample gated rolling median (FORMANT_SMOOTH_LEN 7,
//    FORMANT_OUTLIER_HZ 500, useAudioPipeline.pushAndMedianGated).
// Output score = smoothed F2 in Hz (the current UI's resonance signal).
//
// Usage: node app_formants_f2.mjs <jobs.json> <out.jsonl> [--feature=f2|f1|f3]
import { readFileSync, openSync, writeSync, closeSync } from "node:fs";
import { configureFormants, extractFormants } from "../../../src/dsp/formants.js";

const [jobsPath, outPath] = process.argv.slice(2);
const featArg = process.argv.find((a) => a.startsWith("--feature="));
const FEAT = featArg ? featArg.split("=")[1] : "f2";
const SRC = 16000, SR = 48000, L = SR / SRC;
const WIN = Math.floor(SR * 0.05);
const HOP_S = 0.15, HINT_LAG_S = 0.09, SMOOTH_LEN = 7, MAX_JUMP = 500;
configureFormants(SR, WIN);

const HALF = 32;   // sinc half-width (source samples); cutoff 0.47 x source Nyquist x 2 = 0.94
const taps = [];
for (let ph = 0; ph < L; ph++) {
  const frac = ph / L, w = new Float64Array(2 * HALF);
  for (let j = 0; j < 2 * HALF; j++) {
    const k = -HALF + 1 + j, d = frac - k;
    const fc = 0.94;                      // 0.47 x 2 (normalised to the source rate)
    const s = d === 0 ? fc : Math.sin(Math.PI * fc * d) / (Math.PI * d);
    w[j] = s * (0.5 + 0.5 * Math.cos(Math.PI * d / HALF));
  }
  taps.push(w);
}
function upsampleSpan(x, start, len) {    // output samples [start, start+len) at 48 k
  const y = new Float64Array(len);
  for (let n = 0; n < len; n++) {
    const o = start + n, c = Math.floor(o / L), w = taps[o - c * L];
    let acc = 0;
    for (let j = 0; j < 2 * HALF; j++) {
      const k = c - HALF + 1 + j;
      if (k < 0 || k >= x.length) continue;
      acc += x[k] * w[j];
    }
    y[n] = acc;
  }
  return y;
}
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const median = (a) => { const s = [...a].sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const f0At = (f0, t) => { const i = Math.round((t - 0.005) / 0.01); return i >= 0 && i < f0.length ? f0[i] : 0; };

const jobs = JSON.parse(readFileSync(jobsPath, "utf8"));
const fd = openSync(outPath, "w");
let extractMs = 0;
for (const job of jobs) {
  const x = readF32(job.audio), f0 = readF32(job.f0);
  const ts = [], ss = [], buf = [];
  const dur = x.length / SRC;
  for (let k = 1; k * HOP_S <= dur + 1e-9; k++) {
    const te = k * HOP_S;
    ts.push(+te.toFixed(4));
    if (f0At(f0, te - 0.025) <= 0) { ss.push(null); continue; }
    const h = f0At(f0, te - HINT_LAG_S);
    const start = Math.round(te * SR) - WIN;
    if (start < 0) { ss.push(null); continue; }
    const w = upsampleSpan(x, start, WIN);
    const t0 = performance.now();
    const r = extractFormants(w, h > 0 ? h : null);
    extractMs += performance.now() - t0;
    const v = r[FEAT];
    if (v == null) { ss.push(null); continue; }
    let out;
    if (buf.length === 0) { buf.push(v); out = v; }
    else {
      const cur = median(buf), d = v - cur;
      buf.push(Math.abs(d) > MAX_JUMP ? cur + Math.sign(d) * MAX_JUMP : v);
      if (buf.length > SMOOTH_LEN) buf.shift();
      out = median(buf);
    }
    ss.push(+out.toFixed(2));
  }
  writeSync(fd, JSON.stringify({ key: job.key, t: ts, s: ss }) + "\n");
}
writeSync(fd, JSON.stringify({ __cpu_s: extractMs / 1000 }) + "\n");
closeSync(fd);
