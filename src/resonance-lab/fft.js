// fft.js — iterative radix-2 complex FFT, in place, with per-size cached
// twiddle / bit-reversal tables. Shared by the resonance-lab ports
// (learned-envelope band envelope, vtln CheapTrick envelope). Allocation-
// free after construction. Forward transform uses exp(-2πi kn/N)
// (numpy/FFTW sign); `inverse` is unnormalised (caller divides by N).
//
// 2026-10-07 (measurements/resonance-cue-cpu-2026-10-07.md): twiddles are
// stored per stage, contiguous, for both signs, and each stage runs twiddle-
// outer / block-inner. Every butterfly computes exactly the same expression
// on the same operands as before (results are bit-identical); only the loop
// order and table layout changed. `createRealFFT(n)` adds a real-input
// transform through one n/2-point complex FFT (near-exact, ~1e-16 relative).

const cache = new Map();

export function createFFT(n) {
  if (cache.has(n)) return cache.get(n);
  const log2 = Math.round(Math.log2(n));
  if (1 << log2 !== n) throw new Error(`FFT size ${n} is not a power of two`);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < log2; b++) r |= ((i >> b) & 1) << (log2 - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n);
    sin[i] = Math.sin((-2 * Math.PI * i) / n);
  }
  // Per-stage tables: stage of size `size` uses twiddle index k * (n / size),
  // k < size / 2; laid out back to back (offset size / 2 - 1 for that stage).
  const twr = new Float64Array(Math.max(1, n - 1));
  const twiF = new Float64Array(Math.max(1, n - 1)); // sign +1 (forward)
  const twiI = new Float64Array(Math.max(1, n - 1)); // sign -1 (inverse)
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size, off = half - 1;
    for (let k = 0; k < half; k++) {
      twr[off + k] = cos[k * step];
      twiF[off + k] = 1 * sin[k * step];
      twiI[off + k] = -1 * sin[k * step];
    }
  }
  function transform(re, im, twi) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, off = half - 1;
      for (let k = 0; k < half; k++) {
        const wr = twr[off + k];
        const wi = twi[off + k];
        for (let a = k; a < n; a += size) {
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
  const fft = {
    n,
    forward: (re, im) => transform(re, im, twiF),
    inverse: (re, im) => transform(re, im, twiI),
  };
  cache.set(n, fft);
  return fft;
}

const realCache = new Map();

/**
 * Real-input FFT of size n through one n/2-point complex FFT.
 * forward(x, outRe, outIm): x real (length n, read only); writes bins
 * 0..n/2 of exp(-2πi kn/N) transform into outRe / outIm (length >= n/2 + 1).
 * Because a real EVEN sequence has a real, even transform and its
 * unnormalised inverse equals its forward transform, the same call also
 * serves CheapTrick's cepstral liftering pair.
 */
export function createRealFFT(n) {
  if (realCache.has(n)) return realCache.get(n);
  const h = n / 2;
  const c = createFFT(h);
  const zr = new Float64Array(h), zi = new Float64Array(h);
  const wr = new Float64Array(h + 1), wi = new Float64Array(h + 1);
  for (let k = 0; k <= h; k++) { wr[k] = Math.cos((-2 * Math.PI * k) / n); wi[k] = Math.sin((-2 * Math.PI * k) / n); }
  function forward(x, outRe, outIm) {
    for (let m = 0; m < h; m++) { zr[m] = x[2 * m]; zi[m] = x[2 * m + 1]; }
    c.forward(zr, zi);
    // X[k] = E[k] + W^k O[k], E = (Z[k] + conj Z[h-k]) / 2, O = (Z[k] - conj Z[h-k]) / 2i
    for (let k = 0; k <= h; k++) {
      const a = k === h ? 0 : k, b = k === 0 ? 0 : h - k;
      const zrk = zr[a], zik = zi[a], zrm = zr[b], zim = -zi[b];
      const er = 0.5 * (zrk + zrm), ei = 0.5 * (zik + zim);
      const dr = 0.5 * (zrk - zrm), di = 0.5 * (zik - zim);
      // O = (dr + i di) / i = di - i dr
      const or = di, oi = -dr;
      outRe[k] = er + (wr[k] * or - wi[k] * oi);
      outIm[k] = ei + (wr[k] * oi + wi[k] * or);
    }
  }
  const r = { n, forward };
  realCache.set(n, r);
  return r;
}
