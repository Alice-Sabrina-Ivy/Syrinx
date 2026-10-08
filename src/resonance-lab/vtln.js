// vtln.js — vtln_warp v3 finalist, streaming JS port.
//
// Port of scripts/resonance-lab/candidates/vtln_warp.py +
// candidates/vtln-warp/vtlnlib.py (arch "mw", method "ct", estimator "w1"):
//
// 1. Per voiced 10 ms frame, a WORLD CheapTrick spectral envelope (exact
//    port of WORLD 0.3.x cheaptrick.cpp as shipped in pyworld 0.3.5,
//    fft_size 1024 @ 16 kHz, q1 = -0.15, including its deterministic
//    xorshift "randn" safeguards), natural-log power, linearly
//    interpolated onto a log-frequency grid (0.01-nat steps from 100 Hz).
//    On that grid a linear frequency warp S(alpha f) is a pure shift.
// 2. "Warp the model, not the data": the frame's fixed 800-5000 Hz band
//    (92 points at 0.02 nat, mean removed) is scored against 25 shifted,
//    mean-renormalised sub-windows of a wide-band diagonal GMM (K = 32,
//    SAT-trained on LibriSpeech dev-clean). Column j <-> ln alpha =
//    0.24 - 0.02 j.
// 3. Output every absolute 150 ms bin with >= 3 voiced frames: the
//    parabolically refined argmax of the per-frame log-likelihood curves
//    summed over the trailing 100 voiced frames (~1 s of voicing).
//    Units: ln(alpha); larger = formants higher = shorter apparent tract.
// Readout pooling in the harness: MEDIAN of bin values.
//
// Needs the F0 VALUE (CheapTrick's window and smoothing are F0-adaptive):
// a sustained octave-down tracker error biases the readout (measured
// -0.25 G for women in the prototype).
//
// CPU (2026-10-07, measurements/resonance-cue-cpu-2026-10-07.md; the cue
// and the lab both run this):
//   exact rewrites (bit-identical values): per-F0 cache of the window /
//   lifters / interpolation geometry, the final log(exp(c) + 1e-12) only on
//   the envelope bins the model reads, flattened sub-models with 0.5·x
//   hoisted, exp() skipped where it underflows to 0, int32 randn state;
//   near-exact defaults (readouts within ~3e-6 of the men–women spacing of
//   the exact port on the pass's public material): real-input FFTs
//   (realFft), no WORLD randn dither (noDither), GMM components 40 nats
//   below the best one abandoned early (prune). All three switches off =
//   the exact WORLD / prototype port, bit-identical to the pre-pass engine
//   (tests/resonance/vtln-cpu-exactness-test.js). trail / minFrames /
//   coarse (and the engine's `stride`) are the reduced-analysis variants
//   that pass measured and rejected (they move the readout too much).

import { createFFT, createRealFFT } from "./fft.js";

const SR = 16000;
const NFFT = 1024;
const HALF = NFFT / 2;
const Q1 = -0.15;
const K_EPS = 2.220446049250313e-16;
const SAFE_MIN = 1e-12;
const DEFAULT_F0 = 500;
const F0_FLOOR = (3 * SR) / (NFFT - 3); // GetF0FloorForCheapTrick
export const VTLN_BIN_S = 0.15;
const TRAIL = 100; // estimator "w1": trailing 100 voiced frames
const MIN_FRAMES = 3;
const EDGE = 200; // frames closer than 200 samples to the clip edges are skipped (prototype)

const LN_STEP = 0.01;
const LN_LO = Math.log(100);

function matlabRound(x) {
  return x > 0 ? Math.trunc(x + 0.5) : Math.trunc(x - 0.5);
}

/**
 * WORLD's deterministic Gaussian-ish generator (matlabfunctions.cpp randn).
 * State kept as int32: the same bits as the uint32 original (xor and left
 * shift are sign-agnostic; the right shifts stay logical, `>>>`).
 */
function createRandn() {
  let x = 123456789, y = 362436069, z = 521288629, w = 88675123;
  return {
    reset() { x = 123456789; y = 362436069; z = 521288629; w = 88675123; },
    next() {
      let t = x ^ (x << 11);
      x = y; y = z; z = w;
      w = (w ^ (w >>> 19)) ^ (t ^ (t >>> 8));
      let tmp = w >>> 4;
      for (let i = 0; i < 11; i++) {
        t = x ^ (x << 11);
        x = y; y = z; z = w;
        w = (w ^ (w >>> 19)) ^ (t ^ (t >>> 8));
        tmp += w >>> 4;
      }
      return tmp / 268435456.0 - 6.0;
    },
  };
}

// interp1Q (matlabfunctions.cpp), y defined on x0 + k*dx, k = 0..yLen-1,
// split into the query geometry (depends on F0 only, cached) and its
// application: out[i] = y[b] + dy[b] * (q - b), dy[k] = y[k+1] - y[k],
// dy[yLen-1] = 0 — the same expression on the same operands as before.
function interpGeom(x0, dx, xi, n, base, frac) {
  for (let i = 0; i < n; i++) {
    const q = (xi[i] - x0) / dx;
    const b = Math.trunc(q);
    base[i] = b;
    frac[i] = q - b;
  }
}
function interpApply(y, yLen, base, frac, n, out) {
  for (let i = 0; i < n; i++) {
    const b = base[i];
    const dy = b < yLen - 1 ? y[b + 1] - y[b] : 0;
    out[i] = y[b] + dy * frac[i];
  }
}

/**
 * CheapTrick for one frame -> natural-log power envelope in `logEnv`.
 * opts.realFft:  real-input FFTs (near-exact).
 * opts.noDither: WORLD's ±1e-12 randn safeguards dropped; the spectral floor
 *                |randn|·eps becomes a constant 0.8·eps (near-exact).
 */
function createCheapTrick({ realFft = false, noDither = false } = {}) {
  const fft = createFFT(NFFT);
  const rfft = realFft ? createRealFFT(NFFT) : null;
  const randn = createRandn();
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  const oRe = new Float64Array(HALF + 1);
  const oIm = new Float64Array(HALF + 1);
  const win = new Float64Array(NFFT + 1);
  const seg2 = new Float64Array(NFFT + 1);
  const power = new Float64Array(HALF + 1);
  const maxB = HALF + 4;
  const mirror = new Float64Array(HALF + 2 * maxB + 1);
  const seg = new Float64Array(HALF + 2 * maxB + 1);
  const axis = new Float64Array(HALF + 1);
  const lowL = new Float64Array(HALF + 1);
  const highL = new Float64Array(HALF + 1);
  const repl = new Float64Array(HALF + 2);
  const lfAxis = new Float64Array(HALF + 2);
  for (let i = 0; i < HALF + 2; i++) lfAxis[i] = (i * SR) / NFFT;
  const smoothLifter = new Float64Array(HALF + 1);
  const compLifter = new Float64Array(HALF + 1);
  // per-F0 geometry, rebuilt when the F0 changes
  let cf0 = NaN, hwl = 0, nw = 0, w2 = 0, boundary = 0, upper = 0;
  const lowB = new Int32Array(HALF + 1), lowF = new Float64Array(HALF + 1);
  const highB = new Int32Array(HALF + 1), highF = new Float64Array(HALF + 1);
  const dcB = new Int32Array(HALF + 2), dcF = new Float64Array(HALF + 2);

  function prepare(f0) {
    cf0 = f0;
    // GetWindowedWaveform: Hanning-like window normalised by its RMS
    hwl = matlabRound((1.5 * SR) / f0);
    nw = 2 * hwl + 1;
    let avg = 0;
    for (let i = 0; i < nw; i++) {
      const pos = (i - hwl) / 1.5 / SR;
      win[i] = 0.5 * Math.cos(Math.PI * pos * f0) + 0.5;
      avg += win[i] * win[i];
    }
    avg = Math.sqrt(avg);
    w2 = 0;
    for (let i = 0; i < nw; i++) { win[i] /= avg; w2 += win[i]; }
    // DCCorrection
    upper = 2 + Math.trunc((f0 * NFFT) / SR);
    interpGeom(f0 - lfAxis[0], -SR / NFFT, lfAxis, upper - 1, dcB, dcF);
    // LinearSmoothing(width = 2 f0 / 3)
    const width = (f0 * 2.0) / 3.0;
    const fs = SR;
    boundary = Math.trunc((width * NFFT) / fs) + 1;
    for (let i = 0; i <= HALF; i++) axis[i] = (i / NFFT) * fs - width / 2.0;
    const origin = (-(boundary - 0.5) * fs) / NFFT;
    const dfx = fs / NFFT;
    interpGeom(origin, dfx, axis, HALF + 1, lowB, lowF);
    for (let i = 0; i <= HALF; i++) axis[i] += width;
    interpGeom(origin, dfx, axis, HALF + 1, highB, highF);
    // SmoothingWithRecovery lifters
    smoothLifter[0] = 1.0;
    compLifter[0] = 1.0 - 2.0 * Q1 + 2.0 * Q1;
    for (let i = 1; i <= HALF; i++) {
      const q = i / SR;
      smoothLifter[i] = Math.sin(Math.PI * f0 * q) / (Math.PI * f0 * q);
      compLifter[i] = 1.0 - 2.0 * Q1 + 2.0 * Q1 * Math.cos(2.0 * Math.PI * q * f0);
    }
  }

  function linearSmoothing(width) {
    const fs = SR;
    const L = HALF + boundary * 2 + 1;
    for (let i = 0; i < boundary; i++) mirror[i] = power[boundary - i];
    for (let i = boundary; i < HALF + boundary; i++) mirror[i] = power[i - boundary];
    for (let i = HALF + boundary; i <= HALF + boundary * 2; i++) mirror[i] = power[HALF - (i - (HALF + boundary))];
    seg[0] = (mirror[0] * fs) / NFFT;
    for (let i = 1; i < L; i++) seg[i] = (mirror[i] * fs) / NFFT + seg[i - 1];
    interpApply(seg, L, lowB, lowF, HALF + 1, lowL);
    interpApply(seg, L, highB, highF, HALF + 1, highL);
    for (let i = 0; i <= HALF; i++) power[i] = (highL[i] - lowL[i]) / width;
  }

  function dcCorrection() {
    const nRep = upper - 1;
    interpApply(power, upper + 1, dcB, dcF, nRep, repl);
    for (let i = 0; i < nRep; i++) power[i] += repl[i];
  }

  /**
   * ring: sample ring (clamped reads = WORLD safe_index); tSec: frame time.
   * Writes ln(envelope + 1e-12) for bins lo..hi (default all, 0..HALF) into logEnv.
   */
  function frame(ring, tSec, f0In, logEnv, lo = 0, hi = HALF) {
    const f0 = f0In <= F0_FLOOR ? DEFAULT_F0 : f0In;
    if (f0 !== cf0) prepare(f0);
    // GetWindowedWaveform
    const origin = matlabRound(tSec * SR + 0.001);
    let w1 = 0;
    ring.readClamped(seg2, origin - hwl, nw);
    if (noDither) {
      for (let i = 0; i < nw; i++) { re[i] = seg2[i] * win[i]; w1 += re[i]; }
    } else {
      for (let i = 0; i < nw; i++) {
        re[i] = seg2[i] * win[i] + randn.next() * SAFE_MIN;
        w1 += re[i];
      }
    }
    const wc = w1 / w2;
    for (let i = 0; i < nw; i++) re[i] -= win[i] * wc;
    for (let i = nw; i < NFFT; i++) re[i] = 0;
    // GetPowerSpectrum + DCCorrection
    if (rfft) {
      rfft.forward(re, oRe, oIm);
      for (let i = 0; i <= HALF; i++) power[i] = oRe[i] * oRe[i] + oIm[i] * oIm[i];
    } else {
      im.fill(0);
      fft.forward(re, im);
      for (let i = 0; i <= HALF; i++) power[i] = re[i] * re[i] + im[i] * im[i];
    }
    dcCorrection();
    linearSmoothing((f0 * 2.0) / 3.0);
    if (noDither) for (let i = 0; i <= HALF; i++) power[i] += 0.8 * K_EPS;
    else for (let i = 0; i <= HALF; i++) power[i] += Math.abs(randn.next()) * K_EPS;
    // SmoothingWithRecovery (cepstral liftering; the log spectrum is real
    // and even, so is its transform)
    for (let i = 0; i <= HALF; i++) re[i] = Math.log(power[i]);
    for (let i = 1; i < HALF; i++) re[NFFT - i] = re[i];
    if (rfft) {
      rfft.forward(re, oRe, oIm);
      for (let i = 0; i <= HALF; i++) re[i] = (oRe[i] * smoothLifter[i] * compLifter[i]) / NFFT;
      for (let i = 1; i < HALF; i++) re[NFFT - i] = re[i];
      rfft.forward(re, oRe, oIm);
      for (let i = lo; i <= hi; i++) logEnv[i] = Math.log(Math.exp(oRe[i]) + 1e-12);
    } else {
      im.fill(0);
      fft.forward(re, im);
      for (let i = 0; i <= HALF; i++) re[i] = (re[i] * smoothLifter[i] * compLifter[i]) / NFFT;
      for (let i = 1; i < HALF; i++) re[NFFT - i] = re[i];
      im.fill(0);
      fft.inverse(re, im);
      for (let i = lo; i <= hi; i++) logEnv[i] = Math.log(Math.exp(re[i]) + 1e-12);
    }
  }

  return { frame, reset: () => randn.reset() };
}

/**
 * model = { cfg: {band:[lo,hi], kmax, st, ...}, w:[K], mu:[[K x Dw]], var:[[K x Dw]] }
 * onBin(tEndSeconds, lnAlphaOrNull) once per 150 ms bin, in order.
 * opts:
 *   realFft, noDither  CheapTrick near-exact switches (above; default true)
 *   prune              abandon GMM components whose partial log-likelihood
 *                      falls 40 nats below the best one (near-exact; default true)
 *   trail              trailing voiced frames summed per bin (100)
 *   minFrames          scored frames a bin needs for a value (3)
 *   coarse             score the even warp hypotheses only and fill the odd
 *                      ones by cubic Lagrange interpolation along the warp axis
 *                      (measured, not adopted; default false)
 */
export function createVtln(model, onBin, opts = {}) {
  const { trail = TRAIL, minFrames = MIN_FRAMES, coarse = false, prune = true, realFft = true, noDither = true } = opts;
  const { band, kmax, st } = model.cfg;
  const i0 = Math.round((Math.log(band[0]) - LN_LO) / LN_STEP);
  const D = Math.round((Math.log(band[1]) - Math.log(band[0])) / LN_STEP);
  const colsW = [];
  for (let c = i0 - kmax; c < i0 + D + kmax; c += st) colsW.push(c);
  const colsC = [];
  for (let c = i0; c < i0 + D; c += st) colsC.push(c);
  const Dc = colsC.length;
  const cOff = (i0 - (i0 - kmax)) / st; // colsC[i] = colsW[cOff + i]
  const nk = (2 * kmax) / st + 1;
  const lna0 = kmax * LN_STEP;
  const dlna = -st * LN_STEP;
  const K = model.w.length;
  if (model.mu[0].length !== colsW.length) throw new Error("vtln model width mismatch");
  if (coarse && (nk % 2 === 0 || nk < 5)) throw new Error("vtln coarse grid needs an odd number of hypotheses >= 5");

  // grid read positions for the wide-band columns
  const posI = new Int32Array(colsW.length);
  const posW = new Float64Array(colsW.length);
  for (let c = 0; c < colsW.length; c++) {
    const p = Math.exp(LN_LO + colsW[c] * LN_STEP) / (SR / NFFT);
    posI[c] = Math.floor(p);
    posW[c] = p - posI[c];
  }
  // envelope bins the canonical band reads
  const binLo = posI[cOff];
  const binHi = posI[cOff + Dc - 1] + 1;

  // per-hypothesis sub-models (ModelWarp.prepare), flattened j-major
  const PREC = new Float64Array(nk * K * Dc);
  const MP = new Float64Array(nk * K * Dc);
  const CST = new Float64Array(nk * K);
  // prune mode: s = CQ - 0.5 * sum_d prec (x - mu_c)^2 — the same value as
  // CST + sum_d x (mp - 0.5 x prec), other rounding (MUC = centred means)
  const MUC = new Float64Array(prune ? nk * K * Dc : 0);
  const CQ = new Float64Array(nk * K);
  for (let j = 0; j < nk; j++) {
    for (let k = 0; k < K; k++) {
      let m = 0;
      for (let d = 0; d < Dc; d++) m += model.mu[k][j + d];
      m /= Dc;
      let lv = 0, mm = 0;
      const o = (j * K + k) * Dc;
      for (let d = 0; d < Dc; d++) {
        const v = model.var[k][j + d];
        const mu = model.mu[k][j + d] - m;
        const p = 1 / v;
        PREC[o + d] = p;
        MP[o + d] = mu * p;
        lv += Math.log(2 * Math.PI * v);
        mm += mu * mu * p;
      }
      CST[j * K + k] = Math.log(model.w[k]) - 0.5 * lv - 0.5 * mm;
      CQ[j * K + k] = Math.log(model.w[k]) - 0.5 * lv;
      if (prune) for (let d = 0; d < Dc; d++) MUC[o + d] = model.mu[k][j + d] - m;
    }
  }

  const ct = createCheapTrick({ realFft, noDither });
  const logEnv = new Float64Array(HALF + 1);
  const X = new Float64Array(Dc);
  const HX = new Float64Array(Dc);
  const lp = new Float64Array(K);
  const rows = new Float64Array(trail * nk); // ring of the last `trail` voiced frames' curves
  const curve = new Float64Array(nk);
  let nVoiced = 0; // voiced frames scored since start
  let cur = 0;     // bin currently accumulating
  let inBin = 0;   // voiced frames in the current bin

  function refinePeak(c) {
    let j = 0;
    for (let i = 1; i < c.length; i++) if (c[i] > c[j]) j = i;
    if (j > 0 && j < c.length - 1) {
      const a = c[j - 1], b = c[j], d = c[j + 1];
      const den = a - 2 * b + d;
      let off = den < 0 ? (0.5 * (a - d)) / den : 0;
      off = Math.min(0.5, Math.max(-0.5, off));
      return j + off;
    }
    return j;
  }

  function flush() {
    let v = null;
    if (inBin >= minFrames) {
      const n = Math.min(trail, nVoiced);
      curve.fill(0);
      for (let r = 0; r < n; r++) {
        const slot = ((nVoiced - 1 - r) % trail) * nk;
        for (let j = 0; j < nk; j++) curve[j] += rows[slot + j];
      }
      v = lna0 + refinePeak(curve) * dlna;
    }
    onBin((cur + 1) * VTLN_BIN_S, v);
    cur++;
    inBin = 0;
  }

  // prune mode: components are visited best-first (last frame's order for
  // this hypothesis) and abandoned once their (monotonically falling) partial
  // log-likelihood is PRUNE below the running max: each such component adds
  // < e^-40 relative to the max term to the sum (< 1e-16 in total).
  const PRUNE = 40;
  const order = new Int32Array(nk * K);
  for (let j = 0; j < nk; j++) for (let k = 0; k < K; k++) order[j * K + k] = k;
  const live = new Uint8Array(K);
  function scorePruned(j) {
    let mx = -Infinity, best = -1;
    const ob = j * K;
    for (let r = 0; r < K; r++) {
      const k = order[ob + r];
      const o = (ob + k) * Dc;
      const c = CQ[ob + k];
      const lim = 2 * (c - (mx - PRUNE)); // prune once acc > lim
      let acc = 0, d = 0, dead = false;
      while (d < Dc) {
        const e = d + 8 < Dc ? d + 8 : Dc;
        for (; d < e; d++) { const t = X[d] - MUC[o + d]; acc += PREC[o + d] * t * t; }
        if (acc > lim) { dead = true; break; }
      }
      live[k] = dead ? 0 : 1;
      if (dead) continue;
      const s = c - 0.5 * acc;
      lp[k] = s;
      if (s > mx) { mx = s; best = r; }
    }
    if (best > 0) { const t = order[ob + best]; order[ob + best] = order[ob]; order[ob] = t; }
    let se = 0;
    for (let k = 0; k < K; k++) if (live[k]) se += Math.exp(lp[k] - mx);
    return mx + Math.log(se);
  }

  // log-likelihood of the current X under sub-model j (log-sum-exp over K)
  function score(j) {
    if (prune) return scorePruned(j);
    let mx = -Infinity;
    const ob = j * K;
    for (let k = 0; k < K; k++) {
      let s = CST[ob + k];
      const o = (ob + k) * Dc;
      for (let d = 0; d < Dc; d++) s += X[d] * (MP[o + d] - HX[d] * PREC[o + d]);
      lp[k] = s;
      if (s > mx) mx = s;
    }
    let se = 0;
    for (let k = 0; k < K; k++) {
      const e = lp[k] - mx;
      if (e > -750) se += Math.exp(e); // exp(e) is exactly 0 below ~ -745
    }
    return mx + Math.log(se);
  }

  return {
    /** Close bins that end before time t (prototype bins use floor((t - 1e-9)/BIN)). */
    advance(t) {
      const bi = Math.floor((t - 1e-9) / VTLN_BIN_S);
      while (cur < bi) flush();
    },
    /** True when the prototype would score a voiced frame at this time (edge margin). */
    eligible(tSec, streamLength = Infinity) {
      return tSec * SR > EDGE && tSec * SR < streamLength - EDGE;
    },
    /** One voiced frame at time tSec (s) with F0 f0 (Hz). */
    frame(ring, tSec, f0) {
      ct.frame(ring, tSec, f0, logEnv, binLo, binHi);
      // wide-band grid values, then the fixed canonical-band data vector
      let m = 0;
      for (let d = 0; d < Dc; d++) {
        const c = cOff + d;
        const i = posI[c];
        X[d] = logEnv[i] * (1 - posW[c]) + logEnv[i + 1] * posW[c];
        m += X[d];
      }
      m /= Dc;
      for (let d = 0; d < Dc; d++) { X[d] -= m; HX[d] = 0.5 * X[d]; }
      const slot = (nVoiced % trail) * nk;
      if (!coarse) {
        for (let j = 0; j < nk; j++) rows[slot + j] = score(j);
      } else {
        for (let j = 0; j < nk; j += 2) rows[slot + j] = score(j);
        const r = (j) => rows[slot + j];
        rows[slot + 1] = (3 * r(0) + 6 * r(2) - r(4)) / 8;
        rows[slot + nk - 2] = (3 * r(nk - 1) + 6 * r(nk - 3) - r(nk - 5)) / 8;
        for (let j = 3; j < nk - 2; j += 2) rows[slot + j] = (9 * (r(j - 1) + r(j + 1)) - r(j - 3) - r(j + 3)) / 16;
      }
      nVoiced++;
      inBin++;
    },
    finish(durS) {
      const nb = Math.ceil(durS / VTLN_BIN_S);
      while (cur < nb) flush();
    },
    reset() { nVoiced = 0; cur = 0; inBin = 0; ct.reset(); },
  };
}
