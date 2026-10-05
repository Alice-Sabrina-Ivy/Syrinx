// JS port of the learned-envelope features (band / band7 / hs) + linear / tiny-MLP / gated heads (browser-worker shaped).
//   node le_band.mjs <jobs.json> <out.jsonl> <model.json>
// Per voiced 10 ms frame: 32 ms Hann, 1024-pt FFT, power, 64 triangular log-spaced bands
// (150-6000 Hz, width max(450 Hz, 0.25 fc)), log, level-normalise. 150 ms bins (mean of
// >= 3 voiced frames). Score = standardised [band-limit, mean-remove, optional tilt-remove]
// features . w + b. Output at bin END. Mirrors lefeat.py / train_eval.Feat exactly.
import fs from "node:fs";

const SR = 16000, NFFT = 1024, WIN = 512, BIN = 0.15, MIN_FR = 3, NB = 64;
const FLO = 150, FHI = 6000;
const GRID = Float64Array.from({ length: NB }, (_, i) => Math.exp(Math.log(FLO) + (Math.log(FHI) - Math.log(FLO)) * i / (NB - 1)));
const NF = NFFT / 2 + 1;
const HANN = Float64Array.from({ length: WIN }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / WIN));

function bandMatrix(bwmin) {
  const M = [];
  for (let i = 0; i < NB; i++) {
    const c = GRID[i], bw = Math.max(bwmin, 0.25 * c);
    const row = new Float64Array(NF);
    let s = 0;
    for (let k = 0; k < NF; k++) { const w = Math.max(0, 1 - Math.abs(k * SR / NFFT - c) / bw); row[k] = w; s += w; }
    const lo = row.findIndex((v) => v > 0);
    let hi = NF - 1; while (row[hi] === 0) hi--;
    M.push({ lo, hi, w: row.subarray(lo, hi + 1).map((v) => v / s) });
  }
  return M;
}

// iterative radix-2 complex FFT, in place
const LOG2 = Math.log2(NFFT);
const REV = new Uint32Array(NFFT);
for (let i = 0; i < NFFT; i++) { let r = 0; for (let b = 0; b < LOG2; b++) r |= ((i >> b) & 1) << (LOG2 - 1 - b); REV[i] = r; }
const COS = Float64Array.from({ length: NFFT / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / NFFT));
const SIN = Float64Array.from({ length: NFFT / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / NFFT));
function fft(re, im) {
  for (let i = 0; i < NFFT; i++) { const j = REV[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= NFFT; size <<= 1) {
    const half = size >> 1, step = NFFT / size;
    for (let s = 0; s < NFFT; s += size) for (let k = 0; k < half; k++) {
      const wr = COS[k * step], wi = SIN[k * step], a = s + k, b = a + half;
      const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}

export function makeScorer(model) {
  const f = model.feat;
  const BM = bandMatrix(f.method === "band7" ? 700 : 450);
  const sel = []; for (let i = 0; i < NB; i++) if (GRID[i] >= f.flo * 0.999 && GRID[i] <= f.fhi * 1.001) sel.push(i);
  const lx = sel.map((i) => Math.log(GRID[i])); const lm = lx.reduce((a, b) => a + b, 0) / lx.length;
  for (let i = 0; i < lx.length; i++) lx[i] -= lm;
  const lxx = lx.reduce((a, b) => a + b * b, 0);
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT), E = new Float64Array(NB);
  const dot = (w, X) => { let s = 0; for (let i = 0; i < X.length; i++) s += w[i] * X[i]; return s; };
  let head;
  if (model.kind === "linear") head = (X) => model.b + dot(model.w, X);
  else if (model.mlp._kind === "gated") {
    const M = model.mlp, K = M["gate.bias"].length;
    head = (X) => {
      const z = M["gate.bias"].map((b, k) => b + dot(M["gate.weight"][k], X)), zm = Math.max(...z);
      let gs = 0, s = 0;
      for (let k = 0; k < K; k++) { const g = Math.exp(z[k] - zm); gs += g; s += g * (M["expert.bias"][k] + dot(M["expert.weight"][k], X)); }
      return s / gs;
    };
  } else {
    const M = model.mlp, Hn = M["0.bias"].length;
    head = (X) => { let s = M["2.bias"][0]; for (let j = 0; j < Hn; j++) s += M["2.weight"][0][j] * Math.tanh(M["0.bias"][j] + dot(M["0.weight"][j], X)); return s; };
  }
  const LP = new Float64Array(NF), LG = Float64Array.from(GRID, Math.log);
  const hsEnv = (F0) => {
    // harmonic-sampled envelope (mirrors lefeat.env_hs)
    for (let k = 0; k < NF; k++) LP[k] = Math.log(re[k] * re[k] + im[k] * im[k] + 1e-12);
    F0 = Math.min(1000, Math.max(50, F0));
    const df = SR / NFFT, H = Math.max(1, Math.floor(FHI * 1.05 / F0)), w = Math.ceil(0.35 * F0 / df);
    const fr = new Float64Array(H), pk = new Float64Array(H);
    for (let h = 1; h <= H; h++) {
      const c0 = Math.round(h * F0 / df);
      let j = -1, best = -Infinity;
      for (let d = -w; d <= w; d++) { const kk = Math.min(NF - 2, Math.max(1, c0 + d)); if (LP[kk] > best) { best = LP[kk]; j = kk; } }
      const a = LP[j - 1], b = LP[j], cc = LP[j + 1], den = a - 2 * b + cc;
      let dl = Math.abs(den) > 1e-9 ? 0.5 * (a - cc) / den : 0; dl = Math.min(0.5, Math.max(-0.5, dl));
      pk[h - 1] = b - 0.25 * (a - cc) * dl; fr[h - 1] = Math.log(Math.max((j + dl) * df, 1));
    }
    const o = Array.from({ length: H }, (_, i) => i).sort((p, q) => fr[p] - fr[q]);
    let m = 0, q = 0;
    for (let b = 0; b < NB; b++) {
      const v = LG[b];
      if (v <= fr[o[0]]) E[b] = pk[o[0]];
      else if (v >= fr[o[H - 1]]) E[b] = pk[o[H - 1]];
      else { while (q < H - 2 && fr[o[q + 1]] < v) q++; const x0 = fr[o[q]], x1 = fr[o[q + 1]]; const t = x1 > x0 ? (v - x0) / (x1 - x0) : 0; E[b] = pk[o[q]] * (1 - t) + pk[o[q + 1]] * t; }
      m += E[b];
    }
    m /= NB; for (let b = 0; b < NB; b++) E[b] -= m;
    return E;
  };
  const frameEnv = (x, c, F0) => {
    re.fill(0); im.fill(0);
    for (let i = 0; i < WIN; i++) { const n = c - WIN / 2 + i; if (n >= 0 && n < x.length) re[i] = x[n] * HANN[i]; }
    fft(re, im);
    if (f.method === "hs") return hsEnv(F0);
    let m = 0;
    for (let b = 0; b < NB; b++) {
      const { lo, w } = BM[b]; let s = 0;
      for (let k = 0; k < w.length; k++) { const kk = lo + k; s += w[k] * (re[kk] * re[kk] + im[kk] * im[kk] + 1e-12); }
      E[b] = Math.log(s + 1e-12); m += E[b];
    }
    m /= NB; for (let b = 0; b < NB; b++) E[b] -= m;
    return E;
  };
  const scoreBin = (acc, n) => {
    const X = sel.map((i) => acc[i] / n);
    const mu = X.reduce((a, b) => a + b, 0) / X.length;
    for (let i = 0; i < X.length; i++) X[i] -= mu;
    if (f.tilt) { let bb = 0; for (let i = 0; i < X.length; i++) bb += X[i] * lx[i]; bb /= lxx; for (let i = 0; i < X.length; i++) X[i] -= bb * lx[i]; }
    for (let i = 0; i < X.length; i++) X[i] = (X[i] - model.mu[i]) / model.sd[i];
    return head(X);
  };
  // streaming-shaped: feed voiced frames in time order; a bin closes when time passes its end
  return function score(x, f0) {
    const dur = x.length / SR, nb = Math.ceil(dur / BIN);
    const t = [], s = [];
    let cur = 0, acc = new Float64Array(NB), n = 0;
    const flush = (bi) => { t.push((bi + 1) * BIN); s.push(n >= MIN_FR ? scoreBin(acc, n) : null); acc.fill(0); n = 0; };
    for (let k = 0; k < f0.length; k++) {
      if (!(f0[k] > 0)) continue;
      const tk = 0.005 + 0.01 * k, c = Math.round(tk * SR);
      if (c < 0 || c >= x.length) continue;
      const bi = Math.floor(tk / BIN);
      while (cur < bi && cur < nb) flush(cur++);
      const e = frameEnv(x, c, f0[k]);
      for (let b = 0; b < NB; b++) acc[b] += e[b];
      n++;
    }
    while (cur < nb) flush(cur++);
    return { t, s };
  };
}

if (process.argv[1] && process.argv[1].endsWith("le_band.mjs") && process.argv.length >= 5) {
  const [jobsP, outP, modelP] = process.argv.slice(2);
  const jobs = JSON.parse(fs.readFileSync(jobsP, "utf8"));
  const model = JSON.parse(fs.readFileSync(modelP, "utf8"));
  if (!["band", "band7", "hs"].includes(model.feat.method)) throw new Error("JS port covers band/band7/hs envelopes only");
  const score = makeScorer(model);
  const out = fs.openSync(outP, "w");
  const c0 = process.cpuUsage();
  let cpu = 0;
  for (const j of jobs) {
    const rd = (p) => { const b = fs.readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
    const x = rd(j.audio), f0 = rd(j.f0);
    const u0 = process.cpuUsage();
    const r = score(x, f0);
    const u = process.cpuUsage(u0); cpu += (u.user + u.system) / 1e6;
    fs.writeSync(out, JSON.stringify({ key: j.key, t: r.t, s: r.s.map((v) => (v === null || !Number.isFinite(v) ? null : v)) }) + "\n");
  }
  fs.writeSync(out, JSON.stringify({ __cpu_s: cpu }) + "\n");
  fs.closeSync(out);
  void c0;
}
