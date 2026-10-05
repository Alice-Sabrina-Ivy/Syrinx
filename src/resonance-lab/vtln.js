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

import { createFFT } from "./fft.js";

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

/** WORLD's deterministic Gaussian-ish generator (matlabfunctions.cpp randn). */
function createRandn() {
  let x = 123456789, y = 362436069, z = 521288629, w = 88675123;
  return {
    reset() { x = 123456789; y = 362436069; z = 521288629; w = 88675123; },
    next() {
      let t = (x ^ (x << 11)) >>> 0;
      x = y; y = z; z = w;
      w = ((w ^ (w >>> 19)) ^ (t ^ (t >>> 8))) >>> 0;
      let tmp = w >>> 4;
      for (let i = 0; i < 11; i++) {
        t = (x ^ (x << 11)) >>> 0;
        x = y; y = z; z = w;
        w = ((w ^ (w >>> 19)) ^ (t ^ (t >>> 8))) >>> 0;
        tmp += w >>> 4;
      }
      return tmp / 268435456.0 - 6.0;
    },
  };
}

// interp1Q (matlabfunctions.cpp): y defined on x0 + k*dx, k = 0..yLen-1.
function interp1Q(x0, dx, y, yLen, xi, n, out, dy) {
  for (let i = 0; i < yLen - 1; i++) dy[i] = y[i + 1] - y[i];
  dy[yLen - 1] = 0;
  for (let i = 0; i < n; i++) {
    const q = (xi[i] - x0) / dx;
    const base = Math.trunc(q);
    out[i] = y[base] + dy[base] * (q - base);
  }
}

/** CheapTrick for one frame -> natural-log power envelope (HALF+1 bins) in `logEnv`. */
function createCheapTrick() {
  const fft = createFFT(NFFT);
  const randn = createRandn();
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  const win = new Float64Array(NFFT + 1);
  const seg2 = new Float64Array(NFFT + 1);
  const power = new Float64Array(HALF + 1);
  const maxB = HALF + 4;
  const mirror = new Float64Array(HALF + 2 * maxB + 1);
  const seg = new Float64Array(HALF + 2 * maxB + 1);
  const dy = new Float64Array(HALF + 2 * maxB + 2);
  const axis = new Float64Array(HALF + 1);
  const lowL = new Float64Array(HALF + 1);
  const highL = new Float64Array(HALF + 1);
  const repl = new Float64Array(HALF + 2);
  const lfAxis = new Float64Array(HALF + 2);
  const smoothLifter = new Float64Array(HALF + 1);
  const compLifter = new Float64Array(HALF + 1);

  function linearSmoothing(width) {
    const fs = SR;
    const boundary = Math.trunc((width * NFFT) / fs) + 1;
    const L = HALF + boundary * 2 + 1;
    for (let i = 0; i < boundary; i++) mirror[i] = power[boundary - i];
    for (let i = boundary; i < HALF + boundary; i++) mirror[i] = power[i - boundary];
    for (let i = HALF + boundary; i <= HALF + boundary * 2; i++) mirror[i] = power[HALF - (i - (HALF + boundary))];
    seg[0] = (mirror[0] * fs) / NFFT;
    for (let i = 1; i < L; i++) seg[i] = (mirror[i] * fs) / NFFT + seg[i - 1];
    for (let i = 0; i <= HALF; i++) axis[i] = (i / NFFT) * fs - width / 2.0;
    const origin = (-(boundary - 0.5) * fs) / NFFT;
    const dfx = fs / NFFT;
    interp1Q(origin, dfx, seg, L, axis, HALF + 1, lowL, dy);
    for (let i = 0; i <= HALF; i++) axis[i] += width;
    interp1Q(origin, dfx, seg, L, axis, HALF + 1, highL, dy);
    for (let i = 0; i <= HALF; i++) power[i] = (highL[i] - lowL[i]) / width;
  }

  function dcCorrection(f0) {
    const upper = 2 + Math.trunc((f0 * NFFT) / SR);
    for (let i = 0; i < upper; i++) lfAxis[i] = (i * SR) / NFFT;
    const nRep = upper - 1;
    interp1Q(f0 - lfAxis[0], -SR / NFFT, power, upper + 1, lfAxis, nRep, repl, dy);
    for (let i = 0; i < nRep; i++) power[i] += repl[i];
  }

  /**
   * ring: sample ring (clamped reads = WORLD safe_index); tSec: frame time.
   * Writes ln(envelope + 1e-12) for bins 0..HALF into logEnv.
   */
  function frame(ring, tSec, f0In, logEnv) {
    const f0 = f0In <= F0_FLOOR ? DEFAULT_F0 : f0In;
    // GetWindowedWaveform
    const hwl = matlabRound((1.5 * SR) / f0);
    const origin = matlabRound(tSec * SR + 0.001);
    const nw = 2 * hwl + 1;
    let avg = 0;
    for (let i = 0; i < nw; i++) {
      const pos = (i - hwl) / 1.5 / SR;
      win[i] = 0.5 * Math.cos(Math.PI * pos * f0) + 0.5;
      avg += win[i] * win[i];
    }
    avg = Math.sqrt(avg);
    let w1 = 0, w2 = 0;
    ring.readClamped(seg2, origin - hwl, nw);
    for (let i = 0; i < nw; i++) {
      win[i] /= avg;
      re[i] = seg2[i] * win[i] + randn.next() * SAFE_MIN;
      w1 += re[i];
      w2 += win[i];
    }
    const wc = w1 / w2;
    for (let i = 0; i < nw; i++) re[i] -= win[i] * wc;
    for (let i = nw; i < NFFT; i++) re[i] = 0;
    im.fill(0);
    // GetPowerSpectrum + DCCorrection
    fft.forward(re, im);
    for (let i = 0; i <= HALF; i++) power[i] = re[i] * re[i] + im[i] * im[i];
    dcCorrection(f0);
    linearSmoothing((f0 * 2.0) / 3.0);
    for (let i = 0; i <= HALF; i++) power[i] += Math.abs(randn.next()) * K_EPS;
    // SmoothingWithRecovery
    smoothLifter[0] = 1.0;
    compLifter[0] = 1.0 - 2.0 * Q1 + 2.0 * Q1;
    for (let i = 1; i <= HALF; i++) {
      const q = i / SR;
      smoothLifter[i] = Math.sin(Math.PI * f0 * q) / (Math.PI * f0 * q);
      compLifter[i] = 1.0 - 2.0 * Q1 + 2.0 * Q1 * Math.cos(2.0 * Math.PI * q * f0);
    }
    for (let i = 0; i <= HALF; i++) re[i] = Math.log(power[i]);
    for (let i = 1; i < HALF; i++) re[NFFT - i] = re[i];
    im.fill(0);
    fft.forward(re, im);
    for (let i = 0; i <= HALF; i++) re[i] = (re[i] * smoothLifter[i] * compLifter[i]) / NFFT;
    for (let i = 1; i < HALF; i++) re[NFFT - i] = re[i];
    im.fill(0);
    fft.inverse(re, im);
    for (let i = 0; i <= HALF; i++) logEnv[i] = Math.log(Math.exp(re[i]) + 1e-12);
  }

  return { frame, reset: () => randn.reset() };
}

/**
 * model = { cfg: {band:[lo,hi], kmax, st, ...}, w:[K], mu:[[K x Dw]], var:[[K x Dw]] }
 * onBin(tEndSeconds, lnAlphaOrNull) once per 150 ms bin, in order.
 */
export function createVtln(model, onBin) {
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

  // grid read positions for the wide-band columns
  const posI = new Int32Array(colsW.length);
  const posW = new Float64Array(colsW.length);
  for (let c = 0; c < colsW.length; c++) {
    const p = Math.exp(LN_LO + colsW[c] * LN_STEP) / (SR / NFFT);
    posI[c] = Math.floor(p);
    posW[c] = p - posI[c];
  }

  // per-hypothesis sub-models (ModelWarp.prepare)
  const subs = [];
  for (let j = 0; j < nk; j++) {
    const prec = new Float64Array(K * Dc);
    const mp = new Float64Array(K * Dc);
    const cst = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      let m = 0;
      for (let d = 0; d < Dc; d++) m += model.mu[k][j + d];
      m /= Dc;
      let lv = 0, mm = 0;
      for (let d = 0; d < Dc; d++) {
        const v = model.var[k][j + d];
        const mu = model.mu[k][j + d] - m;
        const p = 1 / v;
        prec[k * Dc + d] = p;
        mp[k * Dc + d] = mu * p;
        lv += Math.log(2 * Math.PI * v);
        mm += mu * mu * p;
      }
      cst[k] = Math.log(model.w[k]) - 0.5 * lv - 0.5 * mm;
    }
    subs.push({ prec, mp, cst });
  }

  const ct = createCheapTrick();
  const logEnv = new Float64Array(HALF + 1);
  const X = new Float64Array(Dc);
  const lp = new Float64Array(K);
  const rows = new Float64Array(TRAIL * nk); // ring of the last TRAIL voiced frames' curves
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
    if (inBin >= MIN_FRAMES) {
      const n = Math.min(TRAIL, nVoiced);
      curve.fill(0);
      for (let r = 0; r < n; r++) {
        const slot = ((nVoiced - 1 - r) % TRAIL) * nk;
        for (let j = 0; j < nk; j++) curve[j] += rows[slot + j];
      }
      v = lna0 + refinePeak(curve) * dlna;
    }
    onBin((cur + 1) * VTLN_BIN_S, v);
    cur++;
    inBin = 0;
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
      ct.frame(ring, tSec, f0, logEnv);
      // wide-band grid values, then the fixed canonical-band data vector
      let m = 0;
      for (let d = 0; d < Dc; d++) {
        const c = cOff + d;
        const i = posI[c];
        X[d] = logEnv[i] * (1 - posW[c]) + logEnv[i + 1] * posW[c];
        m += X[d];
      }
      m /= Dc;
      for (let d = 0; d < Dc; d++) X[d] -= m;
      const slot = (nVoiced % TRAIL) * nk;
      for (let j = 0; j < nk; j++) {
        const { prec, mp, cst } = subs[j];
        let mx = -Infinity;
        for (let k = 0; k < K; k++) {
          let s = cst[k];
          const o = k * Dc;
          for (let d = 0; d < Dc; d++) {
            const x = X[d];
            s += x * (mp[o + d] - 0.5 * x * prec[o + d]);
          }
          lp[k] = s;
          if (s > mx) mx = s;
        }
        let se = 0;
        for (let k = 0; k < K; k++) se += Math.exp(lp[k] - mx);
        rows[slot + j] = mx + Math.log(se);
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
