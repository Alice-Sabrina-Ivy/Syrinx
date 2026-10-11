// weight-features.js — the weight × clarity lab view's per-frame analysis
// (pure; runs in the lab worker and, unchanged, in the Node tests).
//
// Port of the learned "v5" vocal-weight candidate's frame path (Python
// reference: scripts/resonance-lab/weight/v5_ref.py = the research feats.py
// frame_feats + the frozen-model forward pass). Per posted voiced pitch frame:
//   * 50 ms Hann frame (800 samples at 16 kHz) centred on the frame time,
//     4096-point FFT (3.9 Hz bins), power spectrum in dB;
//   * harmonic peaks H1..HK (K = floor(min(7000, 8000 − f0) / f0)) and the
//     inter-harmonic floor at the midpoints;
//   * formant poles from order-16 Burg LPC (librosa.lpc's algorithm) on the
//     pre-emphasised (0.97) Hamming-windowed frame: polynomial roots, poles
//     90–5500 Hz with bandwidth 0–700 Hz, lowest 5 → Iseli–Alwan correction
//     of the harmonic amplitudes (Iseli et al. 2007, doi:10.1121/1.2697522);
//   * corrected / raw source-spectrum slopes (dB per octave, least squares on
//     log2 f) over harmonics ≤ 1.5 kHz and 1–5 kHz;
//   * CPP (cepstrum of the dB spectrum, peak within ±15 % of 1/f0 above a
//     linear trend fitted over 2.5–16.6 ms), harmonic-to-interharmonic ratio
//     in 0–1.5 / 1.5–3.5 / 3.5–6 kHz;
//   * 16 Slaney-mel bands 80–7000 Hz (librosa.filters.mel, norm None,
//     float32 weights), log, mean removed; frame level in dBFS;
//   * the frozen model public/resonance-lab/weight_v5.json → weight w (45
//     derived inputs, tanh MLP) and clarity c (5 inputs, linear).
// Parity with the Python reference: tests/resonance-lab/weight-test.js.
//
// The model is licence-clean (trained on synthetic stimuli, CMU ARCTIC,
// VocalSet and PVQD; never on PTDB-TUG, FDA or the teacher demos) — see the
// model file and measurements/weight-lab-prototype-2026-10-08.md. It is NOT a
// contact / vocal-fold-weight measure: at fixed pitch and loudness it tracked
// EGG contact weakly in women and not at all in men (that note, §2).

import { createRealFFT } from "./fft.js";

export const SR = 16000;
export const FRAME_N = 800;
const NF = 4096;
const NB = NF / 2 + 1;
const DF = SR / NF;
const TARGETS = [1000, 2000, 3000, 4000, 5000];
const LPC_ORDER = 16;
const MAXH = 128;

export const FEATURE_NAMES = [
  "f0", "level",
  "H1", "H2", "H3", "H4", "Hk1000", "Hk2000", "Hk3000", "Hk4000", "Hk5000",
  "H1c", "H2c", "H3c", "H4c", "Hk1000c", "Hk2000c", "Hk3000c", "Hk4000c", "Hk5000c",
  "slope_lo_c", "slope_hi_c", "slope_lo", "slope_hi",
  "cpp", "hir_lo", "hir_mid", "hir_hi", "nform",
  "F1", "F2", "F3", "F4", "B1", "B2", "B3", "B4",
  ...Array.from({ length: 16 }, (_, i) => `mel${i}`),
];
const FI = Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, i]));

const BASE_INPUTS = ["H1c-H2c", "H2c-H4c", "H4c-H2kc", "H2kc-H5kc", "H1-H2", "H1c-H1kc", "H1c-H3kc", "H1-H2k",
  "slope_lo_c", "slope_hi_c", "cpp", "hir_lo", "hir_mid", "hir_hi"];
export const MODEL_INPUTS = [...BASE_INPUTS, "z", ...BASE_INPUTS.map((n) => `${n}*z`),
  ...Array.from({ length: 16 }, (_, i) => `mel${i}`)];

// Python's round(): half to even (numpy's np.round is the same).
function roundHalfEven(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

// librosa 0.11 mel_frequencies / filters.mel (htk = False, norm = None), weights as float32.
function hzToMel(f) {
  const fsp = 200 / 3;
  const minLogHz = 1000, minLogMel = minLogHz / fsp, logstep = Math.log(6.4) / 27;
  return f >= minLogHz ? minLogMel + Math.log(f / minLogHz) / logstep : f / fsp;
}
function melToHz(m) {
  const fsp = 200 / 3;
  const minLogHz = 1000, minLogMel = minLogHz / fsp, logstep = Math.log(6.4) / 27;
  return m >= minLogMel ? minLogHz * Math.exp(logstep * (m - minLogMel)) : fsp * m;
}
function melBank(nMels = 16, fmin = 80, fmax = 7000) {
  const lo = hzToMel(fmin), hi = hzToMel(fmax);
  const n = nMels + 2;
  const melF = Array.from({ length: n }, (_, i) => melToHz(lo + ((hi - lo) * i) / (n - 1)));
  const bands = [];
  for (let i = 0; i < nMels; i++) {
    const d0 = melF[i + 1] - melF[i], d1 = melF[i + 2] - melF[i + 1];
    const idx = [], w = [];
    for (let k = 0; k < NB; k++) {
      const f = (k * SR) / NF;
      const lower = -(melF[i] - f) / d0;
      const upper = (melF[i + 2] - f) / d1;
      const v = Math.max(0, Math.min(lower, upper));
      if (v > 0) { idx.push(k); w.push(Math.fround(v)); }
    }
    bands.push({ start: idx[0], w: Float64Array.from(w) });
  }
  return bands;
}

/** librosa.lpc (Burg, Marple 1980) in float64; returns false when the result is not finite. */
function burg(y, n, order, a, aPrev, f, b) {
  const tiny = 2.2250738585072014e-308;
  a.fill(0); aPrev.fill(0);
  a[0] = 1; aPrev[0] = 1;
  // fwd = y[1:], bwd = y[:-1]; kept as views [fo, fo + len) into f / b
  for (let i = 0; i < n - 1; i++) { f[i] = y[i + 1]; b[i] = y[i]; }
  let len = n - 1, fo = 0, bo = 0;
  let den = 0;
  for (let i = 0; i < len; i++) den += f[i] * f[i] + b[i] * b[i];
  let cur = a, prev = aPrev;
  for (let i = 0; i < order; i++) {
    let r = 0;
    for (let k = 0; k < len; k++) r += b[bo + k] * f[fo + k];
    r *= -2;
    r /= den + tiny;
    const t = prev; prev = cur; cur = t;
    for (let j = 1; j <= i + 1; j++) cur[j] = prev[j] + r * prev[i - j + 1];
    for (let k = 0; k < len; k++) {
      const fk = f[fo + k], bk = b[bo + k];
      f[fo + k] = fk + r * bk;
      b[bo + k] = bk + r * fk;
    }
    const q = 1 - r * r;
    den = q * den - b[bo + len - 1] * b[bo + len - 1] - f[fo] * f[fo];
    fo += 1; len -= 1;
  }
  if (cur !== a) a.set(cur);
  for (let j = 0; j <= order; j++) if (!Number.isFinite(a[j])) return false;
  return true;
}

/**
 * Roots of the monic polynomial z^n + c[1] z^(n-1) + ... + c[n] (Aberth–Ehrlich,
 * then Newton polishing), into re / im. Deterministic.
 */
function polyRoots(c, n, re, im) {
  let rad = 0;
  for (let i = 1; i <= n; i++) rad = Math.max(rad, Math.abs(c[i]) ** (1 / i));
  rad = Math.max(0.5, Math.min(2, rad));
  for (let k = 0; k < n; k++) {
    const ang = (2 * Math.PI * k) / n + 0.4;
    re[k] = rad * Math.cos(ang);
    im[k] = rad * Math.sin(ang);
  }
  const evalAt = (zr, zi) => {
    // p and p' by Horner
    let pr = 1, pi = 0, dr = 0, di = 0;
    for (let i = 1; i <= n; i++) {
      const ndr = dr * zr - di * zi + pr, ndi = dr * zi + di * zr + pi;
      dr = ndr; di = ndi;
      const npr = pr * zr - pi * zi + c[i], npi = pr * zi + pi * zr;
      pr = npr; pi = npi;
    }
    return [pr, pi, dr, di];
  };
  for (let it = 0; it < 500; it++) {
    let maxStep = 0;
    for (let k = 0; k < n; k++) {
      const zr = re[k], zi = im[k];
      const [pr, pi, dr, di] = evalAt(zr, zi);
      const dd = dr * dr + di * di;
      if (dd === 0) continue;
      // ratio = p / p'
      const rr = (pr * dr + pi * di) / dd, ri = (pi * dr - pr * di) / dd;
      let sr = 0, si = 0;
      for (let j = 0; j < n; j++) {
        if (j === k) continue;
        const ar = zr - re[j], ai = zi - im[j];
        const aa = ar * ar + ai * ai;
        if (aa === 0) continue;
        sr += ar / aa; si -= ai / aa;
      }
      // w = ratio / (1 - ratio * s)
      const qr = 1 - (rr * sr - ri * si), qi = -(rr * si + ri * sr);
      const qq = qr * qr + qi * qi;
      if (qq === 0) continue;
      const wr = (rr * qr + ri * qi) / qq, wi = (ri * qr - rr * qi) / qq;
      re[k] = zr - wr; im[k] = zi - wi;
      const step = Math.hypot(wr, wi) / Math.max(1, Math.hypot(zr, zi));
      if (step > maxStep) maxStep = step;
    }
    if (maxStep < 1e-15) break;
  }
  for (let k = 0; k < n; k++) {
    for (let p = 0; p < 2; p++) {
      const [pr, pi, dr, di] = evalAt(re[k], im[k]);
      const dd = dr * dr + di * di;
      if (dd === 0) break;
      re[k] -= (pr * dr + pi * di) / dd;
      im[k] -= (pi * dr - pr * di) / dd;
    }
  }
}

function checkModel(model) {
  const ins = model?.inputs;
  if (!Array.isArray(ins) || ins.length !== MODEL_INPUTS.length || ins.some((n, i) => n !== MODEL_INPUTS[i])) {
    throw new Error("weight model: unexpected input layout");
  }
}

/**
 * createWeightFeatures(model) -> {
 *   frame(x, f0, out?)  x: 800 samples (any array) centred on the pitch frame; f0 in Hz.
 *                       Returns { w, c, level, features } or null (fewer than 4 harmonics,
 *                       or an all-zero frame). `features` is a Float64Array in FEATURE_NAMES
 *                       order (NaN where undefined), reused between calls.
 * }
 */
export function createWeightFeatures(model) {
  checkModel(model);
  const W1 = model.state["f.0.weight"], B1 = model.state["f.0.bias"];
  const W2 = model.state["f.2.weight"][0], B2 = model.state["f.2.bias"][0];
  const MED = model.median, SC = model.scale;
  const CW = model.clarity.w.flat(), CB = [model.clarity.b].flat(2)[0];
  const CMED = model.clarity.median, CSC = model.clarity.scale;
  const nIn = MODEL_INPUTS.length;
  const nHid = B1.length;

  const rfft = createRealFFT(NF);
  const hann = new Float64Array(FRAME_N), hamm = new Float64Array(FRAME_N);
  for (let i = 0; i < FRAME_N; i++) {
    hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_N - 1));
    hamm[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME_N - 1));
  }
  const mel = melBank();
  const buf = new Float64Array(NF);
  const sr = new Float64Array(NB), si = new Float64Array(NB);
  const spec = new Float64Array(NB), X = new Float64Array(NB);
  const H = new Float64Array(MAXH), Hc = new Float64Array(MAXH), V = new Float64Array(MAXH);
  const lpcY = new Float64Array(FRAME_N);
  const a = new Float64Array(LPC_ORDER + 1), aPrev = new Float64Array(LPC_ORDER + 1);
  const fe = new Float64Array(FRAME_N), be = new Float64Array(FRAME_N);
  const rr = new Float64Array(LPC_ORDER), ri = new Float64Array(LPC_ORDER);
  const fmF = [], fmB = [];
  // per-formant constants of the Iseli-Alwan correction (set by formants())
  const cR = new Float64Array(5), cTh = new Float64Array(5), cNum = new Float64Array(5);
  const feats = new Float64Array(FEATURE_NAMES.length);
  const D = new Float64Array(nIn);
  const melv = new Float64Array(16);

  function formants(x) {
    fmF.length = 0; fmB.length = 0;
    let any = false;
    lpcY[0] = x[0] * hamm[0];
    for (let i = 1; i < FRAME_N; i++) lpcY[i] = (x[i] - 0.97 * x[i - 1]) * hamm[i];
    for (let i = 0; i < FRAME_N; i++) if (lpcY[i] !== 0) { any = true; break; }
    if (!any || !Number.isFinite(lpcY[0])) return;
    if (!burg(lpcY, FRAME_N, LPC_ORDER, a, aPrev, fe, be)) return;
    // np.roots strips trailing zero coefficients (roots at 0, never selected)
    let n = LPC_ORDER;
    while (n > 0 && a[n] === 0) n--;
    if (n === 0) return;
    polyRoots(a, n, rr, ri);
    const cand = [];
    for (let k = 0; k < n; k++) {
      if (!(ri[k] > 0)) continue;
      const f = (Math.atan2(ri[k], rr[k]) * SR) / (2 * Math.PI);
      const bw = (-Math.log(Math.hypot(rr[k], ri[k]) + 1e-12) * SR) / Math.PI;
      if (f > 90 && f < 5500 && bw < 700 && bw > 0) cand.push([f, bw]);
    }
    cand.sort((p, q) => p[0] - q[0]);
    for (let i = 0; i < Math.min(5, cand.length); i++) { fmF.push(cand[i][0]); fmB.push(cand[i][1]); }
  }

  function prepCorrection() {
    for (let i = 0; i < fmF.length; i++) {
      const r = Math.exp((-Math.PI * fmB[i]) / SR);
      const th = (2 * Math.PI * fmF[i]) / SR;
      cR[i] = r; cTh[i] = th;
      cNum[i] = (1 - 2 * r * Math.cos(th) + r * r) ** 2;
    }
  }

  // sum over formants of 10 log10(num / den), as one log of the product (same value to ~1e-14 dB)
  function correction(f) {
    let prod = 1;
    const w = (2 * Math.PI * f) / SR;
    for (let i = 0; i < fmF.length; i++) {
      const r = cR[i], th = cTh[i];
      prod *= cNum[i] / ((1 - 2 * r * Math.cos(th - w) + r * r) * (1 - 2 * r * Math.cos(th + w) + r * r));
    }
    return 10 * Math.log10(prod);
  }

  // least-squares slope of v[k] on log2(hf) over harmonics with lo <= hf <= hi (>= 3 points)
  function slope(v, f0, K, lo, hi) {
    let n = 0, sx = 0, sy = 0;
    for (let k = 1; k <= K; k++) { const hf = k * f0; if (hf >= lo && hf <= hi) { n++; sx += Math.log2(hf); sy += v[k]; } }
    if (n < 3) return NaN;
    const mx = sx / n, my = sy / n;
    let sxy = 0, sxx = 0;
    for (let k = 1; k <= K; k++) {
      const hf = k * f0;
      if (hf >= lo && hf <= hi) { const dx = Math.log2(hf) - mx; sxy += dx * (v[k] - my); sxx += dx * dx; }
    }
    return sxy / sxx;
  }

  function frame(x, f0) {
    if (!(f0 > 0)) return null;
    const K = Math.floor(Math.min(7000, SR / 2 - f0) / f0);
    if (K < 4) return null;
    let any = false, ss = 0;
    for (let i = 0; i < FRAME_N; i++) { const v = x[i]; if (v !== 0) any = true; ss += v * v; buf[i] = v * hann[i]; }
    if (!any) return null;
    buf.fill(0, FRAME_N);
    rfft.forward(buf, sr, si);
    for (let k = 0; k < NB; k++) { const p = sr[k] * sr[k] + si[k] * si[k]; spec[k] = p; X[k] = 10 * Math.log10(p + 1e-14); }
    const level = 10 * Math.log10(ss / FRAME_N + 1e-14);

    // harmonic peaks and inter-harmonic floor
    const hw = Math.max(1, roundHalfEven((0.3 * f0) / DF));
    const hw2 = Math.max(1, roundHalfEven((0.1 * f0) / DF));
    const last = NB - 1;
    for (let k = 1; k <= K; k++) {
      const c = roundHalfEven((k * f0) / DF);
      let mx = -Infinity;
      for (let j = c - hw; j <= c + hw; j++) { const v = X[j < 0 ? 0 : j > last ? last : j]; if (v > mx) mx = v; }
      H[k] = mx;
      const cm = roundHalfEven(((k + 0.5) * f0) / DF);
      let s = 0;
      for (let j = cm - hw2; j <= cm + hw2; j++) s += X[j < 0 ? 0 : j > last ? last : j];
      V[k] = s / (2 * hw2 + 1);
    }
    formants(x);
    prepCorrection();
    // corrected amplitudes are only read up to the harmonic nearest 5 kHz
    const Kc = Math.min(K, Math.floor((5000 + f0) / f0));
    for (let k = 1; k <= Kc; k++) Hc[k] = H[k] - correction(k * f0);
    const tk = TARGETS.map((T) => {
      let best = 1, bd = Infinity;
      for (let k = 1; k <= K; k++) { const d = Math.abs(k * f0 - T); if (d < bd) { bd = d; best = k; } }
      return best;
    });

    // CPP: real cepstrum of the dB spectrum (irfft, 1/N), linear trend over q in [40, 266)
    for (let k = 0; k < NB; k++) buf[k] = X[k];
    for (let k = NB; k < NF; k++) buf[k] = X[NF - k];
    rfft.forward(buf, sr, si);
    const qa = 40, qb = 266;
    let n = 0, mq = 0, mc = 0;
    for (let i = qa; i < qb; i++) { n++; mq += i / SR; mc += sr[i] / NF; }
    mq /= n; mc /= n;
    let sqq = 0, sqc = 0;
    for (let i = qa; i < qb; i++) { const dq = i / SR - mq; sqq += dq * dq; sqc += dq * (sr[i] / NF - mc); }
    const pb = sqc / sqq, pa = mc - pb * mq;
    const q0 = 1 / f0;
    let cpp = NaN, best = -Infinity;
    for (let i = qa; i < qb; i++) {
      const q = i / SR;
      if (q > q0 * 0.85 && q < q0 * 1.15) {
        const cv = sr[i] / NF;
        if (cv > best) { best = cv; cpp = cv - (pb * q + pa); }
      }
    }

    const band = (lo, hi) => {
      let s = 0, m = 0;
      for (let k = 1; k <= K; k++) { const hf = k * f0; if (hf >= lo && hf < hi) { s += H[k] - V[k]; m++; } }
      return m ? s / m : NaN;
    };

    let mm = 0;
    for (let i = 0; i < 16; i++) {
      const b = mel[i];
      let s = 0;
      for (let j = 0; j < b.w.length; j++) s += b.w[j] * spec[b.start + j];
      melv[i] = Math.log10(s + 1e-14) * 10;
      mm += melv[i];
    }
    mm /= 16;

    let o = 0;
    feats[o++] = f0; feats[o++] = level;
    for (let k = 1; k <= 4; k++) feats[o++] = H[k];
    for (const t of tk) feats[o++] = H[t];
    for (let k = 1; k <= 4; k++) feats[o++] = Hc[k];
    for (const t of tk) feats[o++] = Hc[t];
    feats[o++] = slope(Hc, f0, K, -Infinity, 1500);
    feats[o++] = slope(Hc, f0, K, 1000, 5000);
    feats[o++] = slope(H, f0, K, -Infinity, 1500);
    feats[o++] = slope(H, f0, K, 1000, 5000);
    feats[o++] = cpp;
    feats[o++] = band(0, 1500); feats[o++] = band(1500, 3500); feats[o++] = band(3500, 6000);
    feats[o++] = fmF.length;
    for (let i = 0; i < 4; i++) feats[o++] = i < fmF.length ? fmF[i] : NaN;
    for (let i = 0; i < 4; i++) feats[o++] = i < fmB.length ? fmB[i] : NaN;
    for (let i = 0; i < 16; i++) feats[o++] = melv[i] - mm;

    // model inputs (train.py derive), standardised
    const g = (name) => feats[FI[name]];
    const z = Math.log2(f0 / 150);
    const base = [
      g("H1c") - g("H2c"), g("H2c") - g("H4c"), g("H4c") - g("Hk2000c"), g("Hk2000c") - g("Hk5000c"),
      g("H1") - g("H2"), g("H1c") - g("Hk1000c"), g("H1c") - g("Hk3000c"), g("H1") - g("Hk2000"),
      g("slope_lo_c"), g("slope_hi_c"), g("cpp"), g("hir_lo"), g("hir_mid"), g("hir_hi"),
    ];
    let d = 0;
    for (const v of base) D[d++] = v;
    D[d++] = z;
    for (const v of base) D[d++] = v * z;
    for (let i = 0; i < 16; i++) D[d++] = feats[FI.mel0 + i];
    for (let i = 0; i < nIn; i++) {
      const v = (D[i] - MED[i]) / SC[i];
      D[i] = Number.isFinite(v) ? Math.max(-5, Math.min(5, v)) : 0;
    }
    let w = B2;
    for (let u = 0; u < nHid; u++) {
      const row = W1[u];
      let s = B1[u];
      for (let i = 0; i < nIn; i++) s += row[i] * D[i];
      w += W2[u] * Math.tanh(s);
    }
    const cin = [g("cpp"), g("hir_lo"), g("hir_mid"), g("hir_hi"), z];
    let c = CB;
    for (let i = 0; i < 5; i++) {
      const v = (cin[i] - CMED[i]) / CSC[i];
      c += CW[i] * (Number.isFinite(v) ? Math.max(-5, Math.min(5, v)) : 0);
    }
    return { w, c, level, features: feats };
  }

  return { frame };
}
