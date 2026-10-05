// Streaming TD-PSOLA pitch flattener — browser-port prototype for the pitch-neutral-ml
// candidate (mirrors pnml_core.tdpsola, with causal filtering so it can run on live chunks).
//
// Usage (batch check):  node tdpsola.mjs in.f32 in.f0.f32 out.f32 [fref=165]
//   in.f32    float32 LE mono @ 16 kHz
//   in.f0.f32 float32 F0 on the 10 ms grid t_k = 0.005 + 0.01 k (0 = unvoiced)
// Prints {"ms": wall ms, "audio_s": ...}.
//
// Streaming design (what a worker would do): keep a ring of the last ~1 s of 16 kHz input
// and of the pitch track; each 25 ms chunk, (1) extend analysis marks up to (now - 1 max
// period), (2) emit output grains whose centre <= (now - 1 max period), (3) RMS-match and
// crossfade the newly completed 20 ms frames, (4) append to the ML window ring. Latency
// added on top of the pitch track's own delay: one analysis period (<= 13 ms at 75 Hz)
// plus one 20 ms RMS frame. The batch function below performs exactly these steps over a
// whole buffer.
import fs from "node:fs";

const SR = 16000;

function biquadLP(fc) {          // RBJ low-pass, Q = 1/sqrt2 per section (two in cascade ~ 4th-order Butterworth-ish)
  const w = (2 * Math.PI * fc) / SR, c = Math.cos(w), s = Math.sin(w), q = Math.SQRT1_2;
  const a = s / (2 * q), a0 = 1 + a;
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - a) / a0 };
}
function filt(x, f) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = f.b0 * x[i] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

export function sampleF0(f0, n) {
  const out = new Float64Array(n);
  // voiced runs of >= 3 frames, linear interpolation inside a run
  let i = 0;
  while (i < f0.length) {
    if (f0[i] <= 0) { i++; continue; }
    let j = i;
    while (j + 1 < f0.length && f0[j + 1] > 0) j++;
    if (j - i + 1 >= 3) {
      const s0 = Math.max(0, Math.round(0.01 * i * SR)), s1 = Math.min(n, Math.round((0.01 * j + 0.01) * SR));
      for (let s = s0; s < s1; s++) {
        const tk = (s / SR - 0.005) / 0.01;
        let k = Math.floor(tk);
        if (k < i) { out[s] = f0[i]; continue; }
        if (k >= j) { out[s] = f0[j]; continue; }
        const u = tk - k;
        out[s] = f0[k] * (1 - u) + f0[k + 1] * u;
      }
    }
    i = j + 1;
  }
  return out;
}

export function flatten(x, f0, fref = 165) {
  const n = x.length;
  const fs_ = sampleF0(f0, n);
  const lp = biquadLP(1000);
  const xl = filt(filt(x, lp), lp);
  const y = new Float64Array(n);
  const Tref = SR / fref;
  const hann = new Map();
  const win = (L) => {
    if (!hann.has(L)) { const w = new Float64Array(L); for (let i = 0; i < L; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (L - 1)); hann.set(L, w); }
    return hann.get(L);
  };
  let s = 0;
  while (s < n) {
    if (fs_[s] <= 0) { s++; continue; }
    let e = s;
    while (e < n && fs_[e] > 0) e++;
    // analysis marks in [s, e)
    const marks = [];
    let T = SR / fs_[s];
    let m = s, best = -Infinity;
    for (let k = s; k < Math.min(e, s + Math.floor(T) + 1); k++) if (xl[k] > best) { best = xl[k]; m = k; }
    while (m < e) {
      marks.push(m);
      T = SR / Math.max(fs_[m], 40);
      const lo = Math.floor(m + 0.75 * T), hi = Math.floor(m + 1.25 * T) + 1;
      if (lo >= e || hi > n) break;
      let bm = lo; best = -Infinity;
      for (let k = lo; k < hi; k++) if (xl[k] > best) { best = xl[k]; bm = k; }
      m = bm;
    }
    if (marks.length >= 2) {
      let k = 0;
      for (let o = marks[0]; o <= marks[marks.length - 1]; o += Tref) {
        while (k + 1 < marks.length && Math.abs(marks[k + 1] - o) <= Math.abs(marks[k] - o)) k++;
        const a = marks[k], P = Math.round(SR / Math.max(fs_[a], 40));
        const L = 2 * P + 1, w = win(L), oo = Math.round(o) - P;
        if (a - P < 0 || a + P + 1 > n || oo < 0 || oo + L > n) continue;
        for (let i = 0; i < L; i++) y[oo + i] += x[a - P + i] * w[i];
      }
    }
    s = e;
  }
  // RMS match per 20 ms frame on voiced frames, linear gain interpolation between frame centres
  const F = 320, nf = Math.ceil(n / F), g = new Float64Array(nf).fill(1);
  for (let i = 0; i < nf; i++) {
    const a = i * F, b = Math.min(n, a + F);
    let v = 0, ex = 0, ey = 0;
    for (let k = a; k < b; k++) { v += fs_[k] > 0 ? 1 : 0; ex += x[k] * x[k]; ey += y[k] * y[k]; }
    if (v / (b - a) < 0.5) continue;
    g[i] = Math.min(20, Math.max(0.05, Math.sqrt((ex / (b - a) + 1e-12) / (ey / (b - a) + 1e-12))));
  }
  // voiced mask crossfade (raised-cosine, 161 taps)
  const R = 80, kern = new Float64Array(2 * R + 1);
  let ks = 0;
  for (let i = 0; i <= 2 * R; i++) { kern[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (2 * R)); ks += kern[i]; }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let vm = 0;
    for (let j = -R; j <= R; j++) { const q = i + j; if (q >= 0 && q < n && fs_[q] > 0) vm += kern[j + R]; }
    vm = Math.min(1, vm / ks);
    const c = (i + 0.5) / F - 0.5, i0 = Math.max(0, Math.min(nf - 1, Math.floor(c))), i1 = Math.min(nf - 1, i0 + 1);
    const u = Math.min(1, Math.max(0, c - i0));
    const gi = g[i0] * (1 - u) + g[i1] * u;
    out[i] = (1 - vm) * x[i] + vm * y[i] * gi;
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("tdpsola.mjs") && process.argv.length >= 5) {
  const rd = (p) => { const b = fs.readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
  const x = rd(process.argv[2]), f0 = rd(process.argv[3]);
  const fref = Number(process.argv[5] || 165);
  const t0 = process.hrtime.bigint();
  const y = flatten(x, f0, fref);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  fs.writeFileSync(process.argv[4], Buffer.from(y.buffer));
  console.log(JSON.stringify({ ms, audio_s: x.length / SR }));
}
