// fft.js — iterative radix-2 complex FFT, in place, with per-size cached
// twiddle / bit-reversal tables. Shared by the resonance-lab ports
// (learned-envelope band envelope, vtln CheapTrick envelope). Allocation-
// free after construction. Forward transform uses exp(-2πi kn/N)
// (numpy/FFTW sign); `inverse` is unnormalised (caller divides by N).

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
  function transform(re, im, sign) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let s = 0; s < n; s += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step];
          const wi = sign * sin[k * step];
          const a = s + k;
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
    forward: (re, im) => transform(re, im, 1),
    inverse: (re, im) => transform(re, im, -1),
  };
  cache.set(n, fft);
  return fft;
}
