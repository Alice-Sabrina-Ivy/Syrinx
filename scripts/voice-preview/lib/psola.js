// psola.js — the voice-preview spike's fallback engine (§P2b of
// measurements/voice-preview-spike-2026-10-12.md): the scratch prototype's own
// psola.mjs, carried over with its code unchanged (own code, MIT). Everything
// below this header is byte-for-byte the prototype file; parity/psola-parity.mjs
// checks that its renders match the prototype's stored renders bit for bit.
//
// psola.mjs — baseline engine: TD-PSOLA plus resampling, the published "Change gender"
// recipe (Moulines & Charpentier 1990; Praat manual "Sound: Change gender"), written
// from the method description (no Praat code). Formant ratio a by resampling the
// source (y(u) = x(a u), band-limited), pitch factor r = 2^(st/12) and duration 1 by
// pitch-synchronous overlap-add of two-period Hann grains taken from y.
// F0 comes from the Syrinx front end (10 ms grid, t_j = 0.005 + 0.01 j, 0 = unvoiced).

function lowpassZeroPhase(x, sr, fc) {
  // RBJ biquad low-pass, Q = 0.707, run forward then backward
  const w0 = 2 * Math.PI * fc / sr, al = Math.sin(w0) / (2 * Math.SQRT1_2), c = Math.cos(w0);
  const b0 = (1 - c) / 2, b1 = 1 - c, b2 = (1 - c) / 2, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  const B0 = b0 / a0, B1 = b1 / a0, B2 = b2 / a0, A1 = a1 / a0, A2 = a2 / a0;
  const run = (u) => {
    const v = new Float64Array(u.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let n = 0; n < u.length; n++) {
      const y = B0 * u[n] + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
      x2 = x1; x1 = u[n]; y2 = y1; y1 = y; v[n] = y;
    }
    return v;
  };
  const f = run(x);
  f.reverse();
  const b = run(f);
  b.reverse();
  return b;
}

function f0At(grid, t) {
  // log-linear interpolation between voiced neighbours, nearest otherwise
  const p = (t - 0.005) / 0.01;
  const j0 = Math.floor(p), j1 = j0 + 1, w = p - j0;
  const g0 = j0 >= 0 && j0 < grid.length ? grid[j0] : 0;
  const g1 = j1 >= 0 && j1 < grid.length ? grid[j1] : 0;
  if (g0 > 0 && g1 > 0) return Math.exp((1 - w) * Math.log(g0) + w * Math.log(g1));
  const jn = Math.round(p);
  return jn >= 0 && jn < grid.length && Math.abs(p - jn) <= 0.75 ? grid[jn] : 0;
}

/** Analysis: pitch marks. Returns {m: Float64Array positions, P: periods (samples), v: voiced}. */
export function psolaAnalyze(x, sr, grid) {
  const xl = lowpassZeroPhase(x, sr, 900);
  const N = x.length, U = Math.round(0.01 * sr);
  const m = [], P = [], v = [];
  let t = 0, prevVoiced = false, prevM = -1e9, prevP = U;
  while (t < N) {
    const f0 = f0At(grid, t / sr);
    if (f0 > 0) {
      const per = sr / f0;
      let lo, hi;
      if (prevVoiced && t - prevM < 1.5 * per + 1) { lo = Math.round(prevM + 0.8 * per); hi = Math.round(prevM + 1.2 * per); }
      else { lo = Math.round(t); hi = Math.round(t + per); }
      if (hi >= N) break;
      let best = lo, bv = -Infinity;
      for (let i = Math.max(0, lo); i <= hi; i++) if (xl[i] > bv) { bv = xl[i]; best = i; }
      if (best <= prevM) best = Math.round(prevM + per);
      m.push(best); P.push(per); v.push(1);
      prevVoiced = true; prevM = best; prevP = per;
      t = best + 0.8 * per; // next search window is anchored on prevM
    } else {
      const nm = prevVoiced ? prevM + prevP : (m.length ? prevM + U : 0);
      if (nm >= N) break;
      m.push(nm); P.push(U); v.push(0);
      prevVoiced = false; prevM = nm; prevP = U; t = nm + U;
    }
  }
  return { m: Float64Array.from(m), P: Float64Array.from(P), v: Uint8Array.from(v) };
}

function resampleBy(x, a) {
  // y[u] = x(a u), windowed-sinc, cutoff 0.475 * min(1, 1/a) cycles per x-sample
  const fc = 0.475 * Math.min(1, 1 / a), H = Math.ceil(16 / (2 * fc)) ;
  const Ny = Math.floor((x.length - 1) / a) + 1;
  const y = new Float64Array(Ny);
  for (let u = 0; u < Ny; u++) {
    const c = a * u, i0 = Math.floor(c);
    let acc = 0, ws = 0;
    for (let i = i0 - H + 1; i <= i0 + H; i++) {
      const d = c - i;
      const s = Math.abs(d) < 1e-9 ? 2 * fc : Math.sin(2 * Math.PI * fc * d) / (Math.PI * d);
      const w = s * (0.5 + 0.5 * Math.cos(Math.PI * d / H));
      ws += w;
      if (i >= 0 && i < x.length) acc += x[i] * w;
    }
    y[u] = acc / ws; // unit DC gain
  }
  return y;
}

/** Synthesis. ana from psolaAnalyze. Returns Float32Array of x.length. */
export function psolaRender(x, sr, ana, { st, a }) {
  const r = Math.pow(2, st / 12);
  const y = a === 1 ? Float64Array.from(x) : resampleBy(x, a);
  const N = x.length, out = new Float64Array(N);
  const { m, P, v } = ana;
  const K = m.length;
  if (!K) return new Float32Array(N);
  let k = 0;
  let to = m[0];
  while (to < N) {
    while (k + 1 < K && Math.abs(m[k + 1] - to) <= Math.abs(m[k] - to)) k++;
    const D = v[k] ? P[k] / r : P[k];     // output spacing (samples)
    const h = P[k] / a;                    // grain half-width in y samples
    const uc = m[k] / a;                   // grain centre in y
    const g = D / h;                       // average window-sum normalisation
    const j0 = Math.ceil(-h), j1 = Math.floor(h);
    for (let j = j0; j <= j1; j++) {
      const n = Math.round(to) + j;
      if (n < 0 || n >= N) continue;
      const u = uc + j, ui = Math.floor(u), fr = u - ui;
      if (ui < 0 || ui + 1 >= y.length) continue;
      const s = y[ui] * (1 - fr) + y[ui + 1] * fr;
      out[n] += g * s * (0.5 + 0.5 * Math.cos(Math.PI * j / h));
    }
    to += Math.max(1, D);
  }
  return Float32Array.from(out);
}

export function finish(y, x) {
  let ry = 0, rx = 0;
  for (let i = 0; i < y.length; i++) ry += y[i] * y[i];
  for (let i = 0; i < x.length; i++) rx += x[i] * x[i];
  ry = Math.sqrt(ry / y.length); rx = Math.sqrt(rx / x.length);
  const out = new Float32Array(y.length);
  const s = ry > 0 ? rx / ry : 1;
  let pk = 0;
  for (let i = 0; i < y.length; i++) { out[i] = y[i] * s; pk = Math.max(pk, Math.abs(out[i])); }
  if (pk > 0.99) for (let i = 0; i < out.length; i++) out[i] *= 0.99 / pk;
  return out;
}
