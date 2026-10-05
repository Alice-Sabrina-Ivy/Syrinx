// lib.mjs — shared library for the precision/steadiness pass (2026-10-04,
// synth(): additive held-vowel synthesizer with known instantaneous F0.
// makeAC().frame(): reproduction of boersma-ac.js candidates()' rNorm (verified
// against the production parabolic candidate freq in est.mjs).
// refine*(): candidate peak-refinement methods on rNorm / the spectrum.

export function rng(seed) {
  let s = seed >>> 0 || 1;
  const u = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const g = () => { let a = 0; while (a === 0) a = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u()); };
  return { u, g };
}

const VOWELS = {
  a: [[730, 90], [1090, 110], [2440, 160], [3400, 200]],
  i: [[300, 60], [2300, 100], [3000, 150], [3700, 200]],
  u: [[330, 70], [870, 90], [2300, 150], [3300, 200]],
  e: [[500, 70], [1800, 100], [2600, 150], [3500, 200]],
};
// magnitude of a cascade of 2-pole resonators (normalised to 1 at DC)
function envMag(f, formants) {
  let m = 1;
  for (const [F, B] of formants) {
    const a = (F * F + (B / 2) ** 2);
    const num = a;
    const re = a - f * f, im = f * B;
    m *= num / Math.sqrt(re * re + im * im);
  }
  return m;
}

// contour(t) -> cents offset of the smooth F0 at time t (s).
// Per-cycle jitter (RMS fraction of the period) and shimmer (RMS fraction
// of amplitude); aspiration noise as white noise at `snrDb` re the voiced
// signal's RMS. Harmonic amplitudes h^-tiltPow * vowel envelope, recomputed
// per cycle. Returns { x, fSmooth (Float64Array per sample), fInst }.
export function synth({ sr = 16000, dur = 4, f0 = 200, contour = () => 0, jitter = 0, shimmer = 0,
  snrDb = Infinity, vowel = "a", seed = 1, tiltPow = 1, h1Db = 0, maxHz = null }) {
  const R = rng(seed);
  const N = Math.round(sr * dur);
  const x = new Float64Array(N), fS = new Float64Array(N), fI = new Float64Array(N);
  const F = VOWELS[vowel];
  const nyq = (maxHz ?? sr / 2) - 200;
  const H = Math.floor(nyq / 60);
  const ph = new Float64Array(H + 1); for (let h = 1; h <= H; h++) ph[h] = 2 * Math.PI * R.u();
  let amp = new Float64Array(H + 1);
  let phase = 0, cyc = -1, eps = 0, sh = 1, nh = 0;
  const setAmps = (f) => {
    nh = Math.min(H, Math.floor(nyq / f));
    for (let h = 1; h <= nh; h++) amp[h] = Math.pow(h, -tiltPow) * envMag(h * f, F) * (h === 1 ? Math.pow(10, h1Db / 20) : 1);
  };
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    const fs = f0 * Math.pow(2, contour(t) / 1200);
    if (Math.floor(phase) !== cyc) { cyc = Math.floor(phase); eps = jitter * R.g(); sh = 1 + shimmer * R.g(); setAmps(fs); }
    const fi = fs / (1 + eps);
    fS[i] = fs; fI[i] = fi;
    let v = 0;
    const p = 2 * Math.PI * phase;
    for (let h = 1; h <= nh; h++) v += amp[h] * Math.cos(h * p + ph[h]);
    x[i] = sh * v;
    phase += fi / sr;
  }
  let rms = 0; for (let i = 0; i < N; i++) rms += x[i] * x[i]; rms = Math.sqrt(rms / N);
  const g = 0.1 / rms;
  const nAmp = Number.isFinite(snrDb) ? 0.1 * Math.pow(10, -snrDb / 20) : 0;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = x[i] * g + nAmp * R.g();
  return { x: out, fSmooth: fS, fInst: fI, sr };
}

// smooth random-walk-ish wander: sum of a few sinusoids at 0.2-3 Hz with
// random phases, scaled to `sdCents` RMS.
export function wander(seed, sdCents, { fLo = 0.2, fHi = 3, n = 8 } = {}) {
  const R = rng(seed);
  const comps = [];
  for (let k = 0; k < n; k++) {
    const f = fLo * Math.pow(fHi / fLo, R.u());
    comps.push([f, 2 * Math.PI * R.u(), 1 / Math.sqrt(f)]);
  }
  const norm = Math.sqrt(comps.reduce((s, c) => s + c[2] * c[2] / 2, 0));
  return (t) => { let v = 0; for (const [f, p, a] of comps) v += a * Math.sin(2 * Math.PI * f * t + p); return sdCents * v / norm; };
}

// ---------------- AC frame (copy of boersma-ac.js candidates() core) ----
function fft(re, im, invert) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (invert ? 1 : -1);
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const uR = re[i + k], uI = im[i + k];
        const vR = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vI = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = uR + vR; im[i + k] = uI + vI;
        re[i + k + len / 2] = uR - vR; im[i + k + len / 2] = uI - vI;
        const nr = cr * wRe - ci * wIm; ci = cr * wIm + ci * wRe; cr = nr;
      }
    }
  }
  if (invert) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
export { fft };

export function makeAC(sr, n, { minHz = 75, maxHz = 800 } = {}) {
  const fftSize = 1 << Math.ceil(Math.log2(2 * n));
  const minLag = Math.max(2, Math.floor(sr / maxHz));
  const maxLag = Math.min(n - 1, Math.ceil(sr / minHz));
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
  const ac = (x, out) => {
    re.fill(0); im.fill(0);
    for (let i = 0; i < n; i++) re[i] = x[i];
    fft(re, im, false);
    for (let i = 0; i < fftSize; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
    const pow = Float64Array.from(re.subarray(0, fftSize / 2));
    fft(re, im, true);
    for (let t = 0; t <= maxLag; t++) out[t] = re[t];
    return pow;
  };
  const rW = new Float64Array(maxLag + 1); ac(w, rW);
  const rX = new Float64Array(maxLag + 1);
  const xw = new Float64Array(n);
  return {
    n, fftSize, minLag, maxLag, sr, w,
    frame(buf) {
      let mean = 0; for (let i = 0; i < n; i++) mean += buf[i]; mean /= n;
      for (let i = 0; i < n; i++) xw[i] = (buf[i] - mean) * w[i];
      const pow = ac(xw, rX);
      const r = new Float64Array(maxLag + 1);
      for (let t = 0; t <= maxLag; t++) r[t] = (rX[t] / rX[0]) / (rW[t] / rW[0]);
      return { r, pow };
    },
  };
}

// local maxima of r in [minLag, maxLag) (as production), parabolic freq
export function peaks(r, A, floor = 0.15) {
  const out = [];
  for (let t = A.minLag; t < A.maxLag; t++) {
    if (r[t] > r[t - 1] && r[t] >= r[t + 1] && r[t] > floor) {
      const a = r[t - 1], b = r[t], c = r[t + 1];
      const den = a - 2 * b + c; const dt = den !== 0 ? 0.5 * (a - c) / den : 0;
      const lag = t + Math.max(-0.5, Math.min(0.5, dt));
      out.push({ t, lag, freq: A.sr / lag, r: b - 0.25 * (a - c) * dt });
    }
  }
  return out;
}

// ---------------- refinement methods ----------------
export function refineParabolic(r, t) {
  const a = r[t - 1], b = r[t], c = r[t + 1];
  const den = a - 2 * b + c; const dt = den !== 0 ? 0.5 * (a - c) / den : 0;
  return t + Math.max(-0.5, Math.min(0.5, dt));
}
export function refineLogParabolic(r, t) {
  const a = r[t - 1], b = r[t], c = r[t + 1];
  if (!(a > 0 && b > 0 && c > 0)) return refineParabolic(r, t);
  const la = Math.log(a), lb = Math.log(b), lc = Math.log(c);
  const den = la - 2 * lb + lc; const dt = den !== 0 ? 0.5 * (la - lc) / den : 0;
  return t + Math.max(-0.5, Math.min(0.5, dt));
}
// Praat NUM_interpolate_sinc (Hann-windowed sinc, depth `depth`)
export function sincInterp(y, nx, x, depth) {
  const midleft = Math.floor(x), midright = midleft + 1;
  if (x === midleft) return y[midleft];
  const d0 = Math.min(depth, midright, nx - 1 - midleft);
  const left = midright - d0, right = midleft + d0;
  let res = 0;
  for (let ix = midleft; ix >= left; ix--) {
    const d = x - ix, pd = Math.PI * d;
    res += y[ix] * (Math.sin(pd) / pd) * (0.5 + 0.5 * Math.cos(pd / (d0 + 0.5)));
  }
  for (let ix = midright; ix <= right; ix++) {
    const d = ix - x, pd = Math.PI * d;
    res += y[ix] * (Math.sin(pd) / pd) * (0.5 + 0.5 * Math.cos(pd / (d0 + 0.5)));
  }
  return res;
}
// golden-section max of f on [lo, hi]
export function goldenMax(f, lo, hi, tol = 1e-4) {
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi, c = b - g * (b - a), d = a + g * (b - a);
  let fc = f(c), fd = f(d);
  while (b - a > tol) {
    if (fc > fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}
export function refineSinc(r, t, depth = 70) {
  const p = refineParabolic(r, t);
  const nx = r.length;
  const lo = Math.max(1, t - 1), hi = Math.min(nx - 2, t + 1);
  const x = goldenMax((xx) => sincInterp(r, nx, xx, depth), lo, hi, 1e-4);
  return Number.isFinite(x) ? x : p;
}

// Spectral harmonic-weighted refinement: harmonics k*f (coarse f) below
// fMax; per-harmonic Gaussian (log-parabolic) interpolation of the power
// peak within +-min(0.5 f, 4 %) of k*f; weighted LS f0 = sum w k fk / sum w k^2.
export function refineSpectral(pow, fftSize, sr, f, { fMax = 3000, maxK = 12, minRel = 1e-3 } = {}) {
  const binHz = sr / fftSize;
  let num = 0, den = 0, pmax = 0;
  const est = [];
  for (let k = 1; k <= maxK && k * f < fMax; k++) {
    const x = k * f, half = Math.min(0.5 * f, 0.04 * x + binHz);
    let lo = Math.max(1, Math.floor((x - half) / binHz)), hi = Math.min(pow.length - 2, Math.ceil((x + half) / binHz));
    let b = lo; for (let i = lo; i <= hi; i++) if (pow[i] > pow[b]) b = i;
    if (b === lo || b === hi) continue;
    const a = Math.log(pow[b - 1] + 1e-30), c0 = Math.log(pow[b] + 1e-30), c = Math.log(pow[b + 1] + 1e-30);
    const dd = a - 2 * c0 + c; const d = dd !== 0 ? 0.5 * (a - c) / dd : 0;
    est.push([k, (b + d) * binHz, pow[b]]);
    if (pow[b] > pmax) pmax = pow[b];
  }
  for (const [k, fk, p] of est) { if (p < minRel * pmax) continue; num += p * k * fk; den += p * k * k; }
  return den > 0 ? num / den : f;
}

export const cents = (a, b) => 1200 * Math.log2(a / b);
