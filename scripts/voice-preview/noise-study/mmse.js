// mmse.js — candidate `mmse` of the Voice Shaper noise study (measurements/voice-shaper-noise-2026-10-25.md):
// the MMSE log-spectral-amplitude estimator (Ephraim & Malah 1985) with the decision-directed
// a-priori SNR, run over a whole recording (offline; non-causal noise estimate). Pure, no
// dependencies, any capture rate.
//
//   denoiseMmse(pcm, sr, opts) -> Float32Array (same length)
//     opts.noise      "vad" | "pre" | "minstat" | "pre+vad"   where the noise PSD comes from
//     opts.vadP       per-chunk detector score (25 ms chunks of the recording), for "vad"
//     opts.chunk      samples per chunk (floor(0.025 sr))
//     opts.pre        Float32Array of capture before Record, for "pre"
//     opts.theta      score below which a chunk counts as no-voice (0.3)
//     opts.alpha      decision-directed smoothing (0.98)
//     opts.beta       noise over-estimate factor (1)
//     opts.gminDb     gain floor in dB (-20)
//     opts.q, opts.bias   minimum-statistics quantile and bias (0.1, 1.8)
//     opts.agg        "mean" | "median": how noise frames are pooled per bin ("mean")
//     opts.minNoiseS  seconds of no-voice frames needed before falling back to minstat (0.25)

const nextPow2 = (n) => 1 << Math.ceil(Math.log2(n));

function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, half = len >> 1;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const p = i + k, q = p + half;
        const vr = re[q] * cr - im[q] * ci, vi = re[q] * ci + im[q] * cr;
        re[q] = re[p] - vr; im[q] = im[p] - vi; re[p] += vr; im[p] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** Exponential integral E1(x), x > 0 (Abramowitz & Stegun 5.1.53 / 5.1.56). */
export function expint1(x) {
  if (x <= 0) return 30;
  if (x <= 1) {
    return -Math.log(x) - 0.57721566 + x * (0.99999193 + x * (-0.24991055 + x * (0.05519968 + x * (-0.00976004 + x * 0.00107857))));
  }
  const num = x * x + 2.334733 * x + 0.250621, den = x * x + 3.330657 * x + 1.681534;
  return Math.exp(-x) / x * (num / den);
}

/** Frame layout shared by analysis and synthesis. */
export function stftLayout(sr) {
  const N = nextPow2(Math.round(0.02 * sr)); // 1024 at 44.1 / 48 kHz, 512 at 16 kHz
  const H = N / 4;
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); // sqrt periodic Hann
  return { N, H, w, nb: N / 2 + 1 };
}

/** Power spectra of x: frames centred every H samples (padded by N on both sides). */
export function powerFrames(x, L) {
  const { N, H, w, nb } = L;
  const pad = new Float64Array(x.length + 2 * N);
  pad.set(x, N);
  const nf = Math.floor((pad.length - N) / H) + 1;
  const re = new Float64Array(N), im = new Float64Array(N);
  const P = [], spec = [];
  for (let f = 0; f < nf; f++) {
    const o = f * H;
    for (let i = 0; i < N; i++) { re[i] = pad[o + i] * w[i]; im[i] = 0; }
    fftInPlace(re, im);
    const p = new Float64Array(nb), sr_ = new Float64Array(nb), si = new Float64Array(nb);
    for (let k = 0; k < nb; k++) { p[k] = re[k] * re[k] + im[k] * im[k]; sr_[k] = re[k]; si[k] = im[k]; }
    P.push(p); spec.push([sr_, si]);
  }
  return { P, spec, nf, padLen: pad.length };
}

function meanOf(P, idx, nb, agg = "mean") {
  const m = new Float64Array(nb);
  if (agg === "median") {
    // per-bin median of the frames' power / ln 2 (the median of an exponential variable is ln 2 x its mean)
    const col = new Float64Array(idx.length);
    for (let k = 0; k < nb; k++) {
      idx.forEach((f, i) => { col[i] = P[f][k]; });
      col.sort();
      m[k] = col[Math.floor(idx.length / 2)] / Math.LN2;
    }
    return m;
  }
  for (const f of idx) for (let k = 0; k < nb; k++) m[k] += P[f][k];
  for (let k = 0; k < nb; k++) m[k] /= Math.max(1, idx.length);
  return m;
}

function minStat(P, nb, q, bias) {
  const nf = P.length;
  const sm = P.map((p) => Float64Array.from(p));
  for (let f = 1; f < nf; f++) for (let k = 0; k < nb; k++) sm[f][k] = 0.8 * sm[f - 1][k] + 0.2 * P[f][k];
  const out = new Float64Array(nb), col = new Float64Array(nf);
  for (let k = 0; k < nb; k++) {
    for (let f = 0; f < nf; f++) col[f] = sm[f][k];
    col.sort();
    out[k] = col[Math.min(nf - 1, Math.floor(q * nf))] * bias;
  }
  return out;
}

/** The noise PSD per bin for the recording (frames of X), by the chosen rule. */
export function noisePsd(X, x, sr, L, o) {
  const { nb, H, N } = L;
  const minFrames = Math.ceil((o.minNoiseS ?? 0.25) * sr / H);
  let vadIdx = null;
  if (o.vadP && (o.noise === "vad" || o.noise === "pre+vad")) {
    const C = o.chunk, th = o.theta ?? 0.3;
    const nk = o.vadP.length;
    // a chunk is no-voice when it and its two neighbours on each side score below theta
    const quiet = new Uint8Array(nk);
    for (let k = 0; k < nk; k++) {
      let ok = true;
      for (let d = -2; d <= 2 && ok; d++) { const v = o.vadP[k + d]; if (k + d >= 0 && k + d < nk && !(v != null && v < th)) ok = false; }
      quiet[k] = ok ? 1 : 0;
    }
    vadIdx = [];
    for (let f = 0; f < X.nf; f++) {
      const c = f * H - N + N / 2; // frame centre in recording samples
      const k = Math.floor(c / C);
      if (k >= 0 && k < nk && quiet[k] && c - N / 2 >= 0 && c + N / 2 <= x.length) vadIdx.push(f);
    }
  }
  let preM = null;
  if (o.pre && (o.noise === "pre" || o.noise === "pre+vad")) {
    const Y = powerFrames(o.pre, L);
    const idx = []; for (let f = 4; f < Y.nf - 4; f++) idx.push(f); // skip the zero-padded edges
    preM = meanOf(Y.P, idx, nb, o.agg);
  }
  if (o.noise === "pre") return { psd: preM, source: "pre" };
  if (o.noise === "pre+vad") {
    if (vadIdx && vadIdx.length >= minFrames) {
      const v = meanOf(X.P, vadIdx, nb, o.agg);
      const out = new Float64Array(nb);
      for (let k = 0; k < nb; k++) out[k] = 0.5 * (v[k] + preM[k]);
      return { psd: out, source: "pre+vad" };
    }
    return { psd: preM, source: "pre" };
  }
  if (o.noise === "vad" && vadIdx && vadIdx.length >= minFrames) return { psd: meanOf(X.P, vadIdx, nb, o.agg), source: "vad", frames: vadIdx.length };
  return { psd: minStat(X.P, nb, o.q ?? 0.1, o.bias ?? 1.8), source: "minstat" };
}

export function denoiseMmse(pcm, sr, opts = {}) {
  const o = { noise: "vad", alpha: 0.98, beta: 1, gminDb: -20, ...opts };
  const L = stftLayout(sr);
  const { N, H, w, nb } = L;
  const X = powerFrames(pcm, L);
  const { psd, source } = noisePsd(X, pcm, sr, L, o);
  const lam = Float64Array.from(psd, (v) => Math.max(v * o.beta, 1e-20));
  const gmin = 10 ** (o.gminDb / 20);
  const out = new Float64Array(X.padLen), norm = new Float64Array(X.padLen);
  const re = new Float64Array(N), im = new Float64Array(N);
  const prevA2 = new Float64Array(nb); // |S_hat|^2 of the previous frame
  for (let f = 0; f < X.nf; f++) {
    const [sre, sim] = X.spec[f];
    const P = X.P[f];
    for (let k = 0; k < nb; k++) {
      const gamma = Math.min(P[k] / lam[k], 1e4);
      const xi = Math.max(o.alpha * prevA2[k] / lam[k] + (1 - o.alpha) * Math.max(gamma - 1, 0), 10 ** (-25 / 10));
      const v = xi * gamma / (1 + xi);
      let g = xi / (1 + xi) * Math.exp(0.5 * expint1(v));
      if (!(g < 1)) g = 1;
      prevA2[k] = g * g * P[k];
      if (g < gmin) g = gmin;
      re[k] = sre[k] * g; im[k] = sim[k] * g;
      if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    }
    // inverse FFT via conjugate trick
    for (let i = 0; i < N; i++) im[i] = -im[i];
    fftInPlace(re, im);
    const o0 = f * H;
    for (let i = 0; i < N; i++) { out[o0 + i] += re[i] / N * w[i]; norm[o0 + i] += w[i] * w[i]; }
  }
  const y = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) { const j = i + N; y[i] = norm[j] > 1e-9 ? out[j] / norm[j] : 0; }
  y.noiseSource = source;
  return y;
}
