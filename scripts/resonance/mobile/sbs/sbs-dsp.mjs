// sbs-dsp.mjs — numeric helpers for the phone-vs-headset kit (sbs-*.mjs):
// FFT, FFT cross-correlation, Welch band powers on 1/3-octave bands, a
// linear-phase FIR designed from a band response, WAV read / write.
// Pure functions; no app code.
import { readFileSync, writeFileSync } from "node:fs";

// ---- FFT (iterative radix-2, in place, complex as two Float64Arrays)
export function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const a = i + k, b = a + h;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/**
 * Cross-correlation c[lag] = sum_i a[i + lag] * b[i] for lag in [-(b.length-1), a.length-1],
 * via FFT. Returns { c: Float64Array, lag0 } with c[lag0 + lag].
 */
export function xcorr(a, b) {
  const N = nextPow2(a.length + b.length);
  const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
  ar.set(a); br.set(b);
  fft(ar, ai); fft(br, bi);
  for (let i = 0; i < N; i++) { const r = ar[i] * br[i] + ai[i] * bi[i], m = ai[i] * br[i] - ar[i] * bi[i]; ar[i] = r; ai[i] = m; }
  fft(ar, ai, true);
  const lag0 = b.length - 1, c = new Float64Array(a.length + b.length - 1);
  for (let lag = -(b.length - 1); lag <= a.length - 1; lag++) c[lag0 + lag] = ar[(lag + N) % N];
  return { c, lag0 };
}
/** Normalised cross-correlation of a (long) against a template b (short): Pearson r per lag where b fits inside a. */
export function ncc(a, b) {
  const { c, lag0 } = xcorr(a, b);
  const m = b.length;
  let sb = 0, sbb = 0;
  for (const v of b) { sb += v; sbb += v * v; }
  const vb = sbb - (sb * sb) / m;
  const cs = new Float64Array(a.length + 1), cs2 = new Float64Array(a.length + 1);
  for (let i = 0; i < a.length; i++) { cs[i + 1] = cs[i] + a[i]; cs2[i + 1] = cs2[i] + a[i] * a[i]; }
  const out = new Float64Array(Math.max(0, a.length - m + 1));
  for (let lag = 0; lag + m <= a.length; lag++) {
    const sa = cs[lag + m] - cs[lag], saa = cs2[lag + m] - cs2[lag];
    const va = saa - (sa * sa) / m;
    const cov = c[lag0 + lag] - (sa * sb) / m;
    out[lag] = va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
  }
  return out;
}
/**
 * Pearson r of template b against a at every lag where they overlap by at least
 * minOverlap samples (b may hang over either end of a). Returns { r, n, lag0 }:
 * r[lag0 + lag] for lag in [-(b.length - 1), a.length - 1] (lag = a index of b[0]).
 */
export function nccPartial(a, b, minOverlap = Math.ceil(b.length / 2)) {
  const ones = new Float64Array(b.length).fill(1);
  const w = new Float64Array(a.length).fill(1);
  const a2 = Float64Array.from(a, (v) => v * v), b2 = Float64Array.from(b, (v) => v * v);
  const N = xcorr(w, ones), Sa = xcorr(a, ones), Saa = xcorr(a2, ones), Sb = xcorr(w, b), Sbb = xcorr(w, b2), Sab = xcorr(a, b);
  const L = N.c.length, r = new Float64Array(L), n = new Float64Array(L);
  for (let i = 0; i < L; i++) {
    const nn = Math.round(N.c[i]);
    n[i] = nn;
    if (nn < minOverlap) { r[i] = 0; continue; }
    const va = Saa.c[i] - (Sa.c[i] * Sa.c[i]) / nn, vb = Sbb.c[i] - (Sb.c[i] * Sb.c[i]) / nn;
    r[i] = va > 1e-9 && vb > 1e-9 ? (Sab.c[i] - (Sa.c[i] * Sb.c[i]) / nn) / Math.sqrt(va * vb) : 0;
  }
  return { r, n, lag0: N.lag0 };
}
/** Parabolic peak refinement around index i of array y. */
export function parabolic(y, i) {
  if (i <= 0 || i >= y.length - 1) return { x: i, y: y[i] };
  const a = y[i - 1], b = y[i], c = y[i + 1], d = a - 2 * b + c;
  if (d === 0) return { x: i, y: b };
  const p = (0.5 * (a - c)) / d;
  return { x: i + p, y: b - 0.25 * (a - c) * p };
}

// ---- 1/3-octave bands
export const THIRD_OCT = [200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000];
export const bandEdges = (fc) => [fc * 2 ** (-1 / 6), fc * 2 ** (1 / 6)];

/** Welch power spectrum (Hann, 50 % overlap) of x[s0, s1). Returns { psd: Float64Array (nfft/2+1), df, frames }. */
export function welch(x, sr, s0 = 0, s1 = x.length, nfft = 8192) {
  const hop = nfft >> 1, w = new Float64Array(nfft);
  for (let i = 0; i < nfft; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nfft);
  let wss = 0; for (const v of w) wss += v * v;
  const psd = new Float64Array(nfft / 2 + 1), re = new Float64Array(nfft), im = new Float64Array(nfft);
  let frames = 0;
  for (let s = Math.max(0, s0); s + nfft <= Math.min(s1, x.length); s += hop) {
    for (let i = 0; i < nfft; i++) { re[i] = x[s + i] * w[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= nfft / 2; k++) psd[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  if (frames) for (let k = 0; k < psd.length; k++) psd[k] /= frames * wss;
  return { psd, df: sr / nfft, frames };
}
/** Band power (sum of PSD bins whose centre lies in [lo, hi)). */
export function bandPower(W, lo, hi) {
  let s = 0;
  for (let k = Math.max(0, Math.ceil(lo / W.df)); k < W.psd.length && k * W.df < hi; k++) s += W.psd[k];
  return s;
}
export function thirdOctPowers(W, centres = THIRD_OCT) {
  return centres.map((fc) => { const [lo, hi] = bandEdges(fc); return bandPower(W, lo, hi); });
}
export const db = (p) => 10 * Math.log10(Math.max(p, 1e-30));

// ---- FIR design from a band response (dB at band centres)
/**
 * Linear-phase FIR (odd length N) whose magnitude follows gainsDb at freqs
 * (interpolated on log frequency, held flat outside [freqs[0], freqs.at(-1)]),
 * by frequency sampling on an nfft grid + a Hann-tapered window.
 */
export function designFir(freqs, gainsDb, sr, N = 1023, nfft = 16384) {
  if (!(N % 2)) throw new Error("designFir: N must be odd");
  const lf = freqs.map((f) => Math.log(f));
  const gAt = (f) => {
    if (f <= freqs[0]) return gainsDb[0];
    if (f >= freqs[freqs.length - 1]) return gainsDb[gainsDb.length - 1];
    const x = Math.log(f);
    let i = 0; while (lf[i + 1] < x) i++;
    const a = (x - lf[i]) / (lf[i + 1] - lf[i]);
    return gainsDb[i] * (1 - a) + gainsDb[i + 1] * a;
  };
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  for (let k = 0; k <= nfft / 2; k++) {
    const f = (k * sr) / nfft, m = 10 ** (gAt(Math.max(f, 1)) / 20);
    re[k] = m; if (k > 0 && k < nfft / 2) re[nfft - k] = m;
  }
  fft(re, im, true); // zero-phase impulse response, centred at 0
  const h = new Float64Array(N), M = (N - 1) / 2;
  for (let n = 0; n < N; n++) {
    const d = n - M, v = re[(d + nfft) % nfft];
    const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / (M + 1)); // Hann taper
    h[n] = v * w;
  }
  return h;
}
/** |H(f)| in dB of FIR taps h at frequency f. */
export function firGainDb(h, f, sr) {
  let r = 0, i = 0;
  const w = (2 * Math.PI * f) / sr;
  for (let n = 0; n < h.length; n++) { r += h[n] * Math.cos(w * n); i -= h[n] * Math.sin(w * n); }
  return 10 * Math.log10(r * r + i * i + 1e-30);
}
/** Overlap-add FFT convolution, centred (delay (N-1)/2 removed), output the input's length. */
export function firFilter(x, h) {
  const N = h.length, D = (N - 1) >> 1, L = nextPow2(Math.max(4 * N, 8192)), B = L - N + 1;
  const hr = new Float64Array(L), hi = new Float64Array(L);
  hr.set(h); fft(hr, hi);
  const full = new Float64Array(x.length + N - 1);
  const re = new Float64Array(L), im = new Float64Array(L);
  for (let s = 0; s < x.length; s += B) {
    re.fill(0); im.fill(0);
    const e = Math.min(x.length, s + B);
    for (let i = s; i < e; i++) re[i - s] = x[i];
    fft(re, im);
    for (let k = 0; k < L; k++) { const r = re[k] * hr[k] - im[k] * hi[k], m = re[k] * hi[k] + im[k] * hr[k]; re[k] = r; im[k] = m; }
    fft(re, im, true);
    for (let i = 0; i < L && s + i < full.length; i++) full[s + i] += re[i];
  }
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = full[i + D];
  return y;
}

// ---- WAV
export function readWav(p) {
  const b = readFileSync(p);
  if (b.toString("ascii", 0, 4) !== "RIFF") throw new Error(`${p}: not a WAV`);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === "fmt ") {
      fmt = { tag: b.readUInt16LE(off + 8), ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
      if (fmt.tag === 0xfffe && sz >= 26) fmt.tag = b.readUInt16LE(off + 8 + 24);
    }
    if (id === "data") data = b.subarray(off + 8, Math.min(b.length, off + 8 + sz));
    off += 8 + sz + (sz & 1);
  }
  const bps = fmt.bits / 8, n = Math.floor(data.length / bps / fmt.ch), y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) {
      const o = (i * fmt.ch + c) * bps;
      s += fmt.tag === 3 ? data.readFloatLE(o) : bps === 2 ? data.readInt16LE(o) / 32768 : bps === 3 ? data.readIntLE(o, 3) / 8388608 : data.readInt32LE(o) / 2147483648;
    }
    y[i] = s / fmt.ch;
  }
  return { y, sr: fmt.sr };
}
/** 16-bit PCM mono WAV (Chrome's fake capture device plays these). Returns the clipped-sample count. */
export function writeWav16(p, y, sr) {
  const n = y.length, buf = Buffer.alloc(44 + n * 2);
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    let q = Math.round(y[i] * 32767);
    if (q > 32767) { q = 32767; clipped++; } else if (q < -32768) { q = -32768; clipped++; }
    buf.writeInt16LE(q, 44 + 2 * i);
  }
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  writeFileSync(p, buf);
  return clipped;
}

// ---- small stats
export const quant = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
export const median = (a) => quant(a, 0.5);
export const mean = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };
/** Least-squares line y = a + b x. */
export function linfit(xs, ys) {
  const n = xs.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const d = n * sxx - sx * sx;
  const b = d ? (n * sxy - sx * sy) / d : 0, a = (sy - b * sx) / n;
  return { a, b };
}
