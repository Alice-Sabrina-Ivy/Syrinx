// le.js — learned-envelope finalist (le_ens_h64), streaming port.
//
// Port of scripts/resonance-lab/candidates/learned-envelope/le_band.mjs
// ("band" envelope only) + le_cand.py's 3-seed ensemble mean, reshaped for
// a worker: allocation-free per frame.
//
// Per VOICED 10 ms frame (voicing from the pitch track; the F0 value is not
// used): 32 ms Hann window centred on the frame, 1024-pt FFT at 16 kHz,
// power pooled into 64 triangular log-spaced bands (150-6000 Hz, width
// max(450 Hz, 0.25 fc)), log, frame mean removed. Frames are averaged into
// absolute 150 ms bins (>= 3 voiced frames, else null), emitted when the
// bin closes. Bin score = mean over ensemble members of a 1-hidden-layer
// tanh MLP on the standardised 500-6000 Hz bands (mean-removed).
// Readout pooling in the harness: MEAN of bin scores.
// Larger score = shorter apparent vocal tract ("smaller / brighter").

import { createFFT } from "./fft.js";

const SR = 16000;
const NFFT = 1024;
const WIN = 512;
const NB = 64;
const FLO = 150;
const FHI = 6000;
export const LE_BIN_S = 0.15;
const MIN_FR = 3;
const NF = NFFT / 2 + 1;

const GRID = Float64Array.from({ length: NB }, (_, i) =>
  Math.exp(Math.log(FLO) + ((Math.log(FHI) - Math.log(FLO)) * i) / (NB - 1)));
const HANN = Float64Array.from({ length: WIN }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / WIN));

function bandMatrix(bwmin) {
  const M = [];
  for (let i = 0; i < NB; i++) {
    const c = GRID[i];
    const bw = Math.max(bwmin, 0.25 * c);
    const row = new Float64Array(NF);
    let s = 0;
    for (let k = 0; k < NF; k++) {
      const w = Math.max(0, 1 - Math.abs((k * SR) / NFFT - c) / bw);
      row[k] = w;
      s += w;
    }
    let lo = 0;
    while (row[lo] === 0) lo++;
    let hi = NF - 1;
    while (row[hi] === 0) hi--;
    const w = new Float64Array(hi - lo + 1);
    for (let k = lo; k <= hi; k++) w[k - lo] = row[k] / s;
    M.push({ lo, w });
  }
  return M;
}

function makeHead(m) {
  const mu = Float64Array.from(m.mu);
  const sd = Float64Array.from(m.sd);
  if (m.kind === "linear") {
    const w = Float64Array.from(m.w);
    const b = m.b;
    return { mu, sd, f: (X) => { let s = b; for (let i = 0; i < X.length; i++) s += w[i] * X[i]; return s; } };
  }
  const W1 = m.mlp["0.weight"].map((r) => Float64Array.from(r));
  const b1 = Float64Array.from(m.mlp["0.bias"]);
  const W2 = Float64Array.from(m.mlp["2.weight"][0]);
  const b2 = m.mlp["2.bias"][0];
  const H = b1.length;
  return {
    mu, sd,
    f: (X) => {
      let s = b2;
      for (let j = 0; j < H; j++) {
        const r = W1[j];
        let z = b1[j];
        for (let i = 0; i < X.length; i++) z += r[i] * X[i];
        s += W2[j] * Math.tanh(z);
      }
      return s;
    },
  };
}

/**
 * model = { feat: {method:"band", flo, fhi, tilt}, members: [ {mu, sd, kind, mlp|w,b} ... ] }
 * onBin(tEndSeconds, scoreOrNull) is called once per 150 ms bin, in order.
 */
export function createLe(model, onBin) {
  const f = model.feat;
  if (f.method !== "band" || f.tilt) throw new Error("le.js ports the band (no tilt) envelope only");
  const BM = bandMatrix(450);
  const sel = [];
  for (let i = 0; i < NB; i++) if (GRID[i] >= f.flo * 0.999 && GRID[i] <= f.fhi * 1.001) sel.push(i);
  const heads = model.members.map(makeHead);
  const fft = createFFT(NFFT);
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  const E = new Float64Array(NB);
  const acc = new Float64Array(NB);
  const X = new Float64Array(sel.length);
  const Xs = new Float64Array(sel.length);
  let n = 0;
  let cur = 0; // index of the bin currently accumulating

  function scoreBin() {
    let mu = 0;
    for (let i = 0; i < sel.length; i++) { X[i] = acc[sel[i]] / n; mu += X[i]; }
    mu /= sel.length;
    for (let i = 0; i < sel.length; i++) X[i] -= mu;
    let s = 0;
    for (const h of heads) {
      for (let i = 0; i < sel.length; i++) Xs[i] = (X[i] - h.mu[i]) / h.sd[i];
      s += h.f(Xs);
    }
    return s / heads.length;
  }
  function flush() {
    onBin((cur + 1) * LE_BIN_S, n >= MIN_FR ? scoreBin() : null);
    acc.fill(0);
    n = 0;
    cur++;
  }

  return {
    /** Close every bin that ends at or before time t (s). Call before frame(t). */
    advance(t) {
      const bi = Math.floor(t / LE_BIN_S);
      while (cur < bi) flush();
    },
    /** One voiced 10 ms frame centred on absolute 16 kHz sample `center`. */
    frame(ring, center) {
      for (let i = 0; i < WIN; i++) { re[i] = ring.at(center - WIN / 2 + i) * HANN[i]; im[i] = 0; }
      for (let i = WIN; i < NFFT; i++) { re[i] = 0; im[i] = 0; }
      fft.forward(re, im);
      let m = 0;
      for (let b = 0; b < NB; b++) {
        const { lo, w } = BM[b];
        let s = 0;
        for (let k = 0; k < w.length; k++) {
          const kk = lo + k;
          s += w[k] * (re[kk] * re[kk] + im[kk] * im[kk] + 1e-12);
        }
        E[b] = Math.log(s + 1e-12);
        m += E[b];
      }
      m /= NB;
      for (let b = 0; b < NB; b++) acc[b] += E[b] - m;
      n++;
    },
    /** Offline end of stream: flush through ceil(dur / BIN) bins. */
    finish(durS) {
      const nb = Math.ceil(durS / LE_BIN_S);
      while (cur < nb) flush();
    },
    reset() { acc.fill(0); n = 0; cur = 0; },
  };
}
