// extract_app.mjs — per-frame all-pole dump with the app's LPC pipeline at production
// capture conditions (16 kHz bench audio band-limited-upsampled to 48 kHz, 50 ms window,
// 25 ms hop = one analysis per capture chunk), for the formant-vtl candidate family.
//
// Usage: node extract_app.mjs <jobs.json>   jobs = [{audio: <16k f32 path>, out: <path>}]
// Output per job: float32 rows of ROW = 2 + 3*(1 + 2*7) values:
//   t_end, rms_db, then per order in (10, 12, 14): n_poles, f[7], bw[7] (unused slots 0).
import { readFileSync, writeFileSync } from "node:fs";
import { makeExtractor } from "./allpoles.mjs";

const SRC = 16000, SR = 48000, L = SR / SRC;
const WIN = Math.round(SR * 0.05), HOP = Math.round(SR * 0.025);
const ORDERS = [10, 12, 14], NP = 7, ROW = 2 + ORDERS.length * (1 + 2 * NP);

const HALF = 32, fc = 0.94;
const taps = [];
for (let ph = 0; ph < L; ph++) {
  const frac = ph / L, w = new Float64Array(2 * HALF);
  for (let j = 0; j < 2 * HALF; j++) {
    const k = -HALF + 1 + j, d = frac - k;
    const s = d === 0 ? fc : Math.sin(Math.PI * fc * d) / (Math.PI * d);
    w[j] = s * (0.5 + 0.5 * Math.cos(Math.PI * d / HALF));
  }
  taps.push(w);
}
export function upsample(x) {
  const y = new Float64Array(x.length * L);
  for (let o = 0; o < y.length; o++) {
    const c = Math.floor(o / L), w = taps[o - c * L];
    let acc = 0;
    const j0 = Math.max(0, HALF - 1 - c), j1 = Math.min(2 * HALF, x.length - c + HALF - 1);
    for (let j = j0; j < j1; j++) acc += x[c - HALF + 1 + j] * w[j];
    y[o] = acc;
  }
  return y;
}

const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };

if (process.argv[1] && process.argv[1].endsWith("extract_app.mjs")) {
  const jobs = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const ex = makeExtractor(SR, WIN, ORDERS);
  for (const job of jobs) {
    const y = upsample(readF32(job.audio));
    const nF = y.length >= WIN ? Math.floor((y.length - WIN) / HOP) + 1 : 0;
    const out = new Float32Array(nF * ROW);
    for (let k = 0; k < nF; k++) {
      const s0 = k * HOP, buf = y.subarray(s0, s0 + WIN);
      let e = 0; for (let i = 0; i < WIN; i++) e += buf[i] * buf[i];
      const r = out.subarray(k * ROW, (k + 1) * ROW);
      r[0] = (s0 + WIN) / SR;
      r[1] = 10 * Math.log10(e / WIN + 1e-12);
      if (e === 0) continue;
      const res = ex.analyze(buf);
      for (let q = 0; q < ORDERS.length; q++) {
        const b = 2 + q * (1 + 2 * NP), { f, bw } = res[q];
        const n = Math.min(NP, f.length);
        r[b] = n;
        for (let i = 0; i < n; i++) { r[b + 1 + i] = f[i]; r[b + 1 + NP + i] = Math.min(bw[i], 1e6); }
      }
    }
    writeFileSync(job.out, Buffer.from(out.buffer));
  }
}
