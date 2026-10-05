// fvtl_js.mjs â€” browser-portable JS implementation of the formant-vtl estimator
// (end to end: the app's LPC with all poles -> formant assignment -> per-frame log-scale
// estimate -> learned shape correction -> gates -> 150 ms bin statistic), used as a
// NodeBridge candidate so the leaderboard numbers come from the JS code that would ship.
//
// Usage: node fvtl_js.mjs <jobs.json> <out.jsonl> <model.json>
// model.json = {cfg: {...}, corr: null | {type:"ridge", deg, w:[...]} | {type:"kmeans", C, off}}
// Per job: 16 kHz float32 audio + 10 ms F0 track; audio is band-limited-upsampled to 48 kHz
// (production capture rate), frames are 50 ms windows every 25 ms (one per capture chunk).
import { readFileSync, openSync, writeSync, closeSync } from "node:fs";
import { makeExtractor } from "./allpoles.mjs";
import { upsample } from "./extract_app.mjs";

const [jobsPath, outPath, modelPath] = process.argv.slice(2);
const model = JSON.parse(readFileSync(modelPath, "utf8"));
const cfg = model.cfg, corr = model.corr;
const SR = 48000, WIN = Math.round(SR * 0.05), HOP = Math.round(SR * 0.025);
const orders = cfg.orders || [cfg.order || 12];
const ex = makeExtractor(SR, WIN, orders);
const FMIN = cfg.fmin ?? 90, FMAX = cfg.fmax ?? 5400, BWMAX = cfg.bwmax ?? 600;
const BINW = cfg.binw ?? 0.15, MINN = cfg.min_n ?? 2;
const K = [0.5, 1.5, 2.5, 3.5];

function estimate(F, kind) {          // F: [F1..F5] (NaN when missing)
  const L = F.map(Math.log);
  const need = (idx) => idx.every((i) => Number.isFinite(F[i]));
  switch (kind) {
    case "gm1234": return need([0, 1, 2, 3]) ? (L[0] + L[1] + L[2] + L[3]) / 4 : NaN;
    case "gm34": return need([2, 3]) ? (L[2] + L[3]) / 2 : NaN;
    case "f4": return need([3]) ? L[3] : NaN;
    case "dF1234": {
      if (!need([0, 1, 2, 3])) return NaN;
      let num = 0, den = 0; for (let i = 0; i < 4; i++) { num += F[i] * K[i]; den += K[i] * K[i]; }
      return Math.log(num / den);
    }
    default: throw new Error("estimator " + kind);
  }
}
function shape(F) {                     // ln F1..F3 minus mean ln F1..F4
  if (![0, 1, 2, 3].every((i) => Number.isFinite(F[i]))) return null;
  const L = [0, 1, 2, 3].map((i) => Math.log(F[i])), m = (L[0] + L[1] + L[2] + L[3]) / 4;
  return [L[0] - m, L[1] - m, L[2] - m];
}
function offset(F) {
  if (!corr) return 0;
  const x = shape(F);
  if (!x) return NaN;
  if (corr.type === "ridge") {
    const phi = [1, ...x];
    if (corr.deg >= 2) for (let i = 0; i < 3; i++) for (let j = i; j < 3; j++) phi.push(x[i] * x[j]);
    if (corr.deg >= 3) for (let i = 0; i < 3; i++) phi.push(x[i] ** 3);
    let s = 0; for (let i = 0; i < phi.length; i++) s += phi[i] * corr.w[i];
    return s;
  }
  let best = Infinity, off = 0;           // kmeans: nearest centroid
  for (let k = 0; k < corr.C.length; k++) {
    let d = 0; for (let i = 0; i < 3; i++) d += (x[i] - corr.C[k][i]) ** 2;
    if (d < best) { best = d; off = corr.off[k]; }
  }
  return off;
}
const median = (a) => { const s = Float64Array.from(a).sort(), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
// nearest 10 ms pitch frame; exact ties (every other 25 ms frame centre) go to the LATER frame, as in
// rlab F0Track.at (its t[0] is float32 0.0049999999 so its ties round up) — plain Math.round
// sends some ties down through floating-point error.
const f0At = (f0, t) => { const i = Math.floor((t - 0.005) / 0.01 + 0.5 + 1e-6); return i >= 0 && i < f0.length ? f0[i] : 0; };

const jobs = JSON.parse(readFileSync(jobsPath, "utf8"));
const fd = openSync(outPath, "w");
let cpuMs = 0;
for (const job of jobs) {
  const x = readF32(job.audio), f0 = readF32(job.f0);
  const y = upsample(x);                              // bench emulation of 48 kHz capture (not timed)
  const t0 = performance.now();
  const dur = x.length / 16000, nb = Math.ceil(dur / BINW);
  const bins = Array.from({ length: nb }, () => []);
  const nF = y.length >= WIN ? Math.floor((y.length - WIN) / HOP) + 1 : 0;
  for (let k = 0; k < nF; k++) {
    const s0 = k * HOP, tEnd = (s0 + WIN) / SR, tc = tEnd - 0.025;
    const pitch = f0At(f0, tc);
    if (!(pitch > 0)) continue;                       // voiced frames only (production: pitch-worker voicing)
    const res = ex.analyze(y.subarray(s0, s0 + WIN));
    for (const r of res) {
      const F = [];
      for (let i = 0; i < r.f.length && F.length < 5; i++) {
        if (r.f[i] > FMIN && r.f[i] < FMAX && r.bw[i] > 0 && r.bw[i] < BWMAX) F.push(r.f[i]);
      }
      while (F.length < 5) F.push(NaN);
      let v = estimate(F, cfg.est) - offset(F);
      if (!Number.isFinite(v)) continue;
      const b = Math.floor(tEnd / BINW);
      if (b < nb) bins[b].push(v);
    }
  }
  const ts = [], ss = [];
  for (let b = 0; b < nb; b++) {
    ts.push(+((b + 1) * BINW).toFixed(4));
    ss.push(bins[b].length >= MINN ? +median(bins[b]).toFixed(6) : null);
  }
  cpuMs += performance.now() - t0;
  writeSync(fd, JSON.stringify({ key: job.key, t: ts, s: ss }) + "\n");
}
writeSync(fd, JSON.stringify({ __cpu_s: cpuMs / 1000 }) + "\n");
closeSync(fd);
