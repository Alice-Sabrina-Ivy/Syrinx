// dfn3.js — Voice Shaper's background-noise reduction: DeepFilterNet 3 (Rikorose/DeepFilterNet
// @ d375b2d, MIT OR Apache-2.0) over a whole recording, in the voice-preview worker
// (./vp-worker.js) and in Node by the tests. measurements/voice-shaper-noise-2026-10-25.md §6–§7.
//
// libDF's signal processing (libDF/src/lib.rs, libDF/src/tract.rs) ported to JS: STFT with the
// Vorbis window (a mixed-radix 960-point FFT, two real frames per transform), ERB and complex
// features with exponential normalisation, the per-frame stage thresholds, ERB gains, deep
// filtering over frames tau-2 .. tau+2, inverse STFT. The official ONNX export's three graphs
// (models/DeepFilterNet3_onnx.tar.gz: enc, erb_dec, df_dec) run once over the whole sequence with
// onnxruntime-web (injected; the app's own self-hosted runtime). It does not stream (the graphs
// keep no recurrent state between calls): the recording is processed when it ends.
//
//   DFN3_MODEL                       the pinned model files (sizes, sha256) and their hosting
//   dfn3ModelSource({ appBaseUrl })  where they come from (the mirror, or the app's own folder)
//   loadDfn3Files(source)            the three graphs, size + sha256 checked
//   createDfn3Sessions(ort, files)   onnxruntime sessions for them
//   createDfn3(ort, sessions, opts)  -> { denoise48(x) -> Promise<{ y, lsnr, ms }> } (48 kHz)
//   denoiseClipDfn3(dfn3, pcm, sr)   any capture rate: sr -> 48 kHz -> DFN3 -> sr (the engine's
//                                    sinc resampler), same length, no delay, level-normalised
import { resampleClip } from "./engine/preview.js";
import { loadVerified } from "../dsp/firered-vad.js";
import { loadVerifiedModel } from "../ml/speech-detector.js";
import { DFN3_MODEL, DFN3_CACHE_PREFIX } from "./dfn3-model.js";

export { DFN3_MODEL, DFN3_CACHE_PREFIX, dfn3ModelSource } from "./dfn3-model.js";

/** The three graphs from `source` -> { enc, erbDec, dfDec } (Uint8Array), each size + sha256 checked. */
export async function loadDfn3Files(source, { fetchFn = globalThis.fetch, cachesApi = globalThis.caches, model = DFN3_MODEL } = {}) {
  if (!source || typeof source.base !== "string") throw Object.assign(new Error("no model source"), { code: "unavailable" });
  const one = async (f) => {
    if (source.kind !== "mirror") return loadVerified(source.base + f.name, f, { fetchFn });
    let got;
    try {
      got = await loadVerifiedModel({ url: source.base + f.name, sha256: f.sha256, fetchFn, cachesApi, cacheName: DFN3_CACHE_PREFIX + f.key });
    } catch (err) {
      throw Object.assign(new Error(`${f.name}: ${String(err?.message || err).replace(/^speech detector model /, "")}`), { code: "unavailable" });
    }
    const bytes = new Uint8Array(got.bytes);
    if (bytes.length !== f.bytes) throw Object.assign(new Error(`${f.name}: ${bytes.length} bytes, expected ${f.bytes}`), { code: "unavailable" });
    return bytes;
  };
  const got = await Promise.all(model.files.map(one));
  return Object.fromEntries(model.files.map((f, i) => [f.key, got[i]]));
}

/** onnxruntime sessions for the three graphs (WASM, one thread: the caller sets ort.env). */
export async function createDfn3Sessions(ort, files) {
  const S = (b) => ort.InferenceSession.create(b, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  const [enc, erbDec, dfDec] = await Promise.all([S(files.enc), S(files.erbDec), S(files.dfDec)]);
  return { enc, erbDec, dfDec };
}

/**
 * The level DeepFilterNet 3 is given: the 95th-percentile 20 ms frame RMS is brought to
 * DFN3_LEVEL (about -20 dBFS; the peak kept under 0.99) and the gain is undone afterwards. The
 * model's features are level-dependent: a quiet recording (RAVDESS at -51 dBFS in the noise study,
 * or a low-gain microphone) has its local-SNR estimate pinned at the -15 dB floor, every frame
 * gated to zero and the preview silent (the official wasm build does the same).
 */
export const DFN3_LEVEL = 0.1;
export function dfn3Gain(pcm, sr) {
  const n = Math.round(0.02 * sr), m = Math.floor(pcm.length / n);
  if (m === 0) return 1;
  const e = new Float64Array(m);
  let peak = 0;
  for (let f = 0; f < m; f++) { let s2 = 0; for (let i = f * n; i < (f + 1) * n; i++) { const v = pcm[i]; s2 += v * v; const a = Math.abs(v); if (a > peak) peak = a; } e[f] = Math.sqrt(s2 / n); }
  e.sort();
  const p95 = e[Math.min(m - 1, Math.floor(0.95 * (m - 1)))];
  if (!(p95 > 1e-7)) return 1; // digital silence: nothing to scale
  return Math.min(DFN3_LEVEL / p95, 0.99 / Math.max(peak, 1e-9));
}

/** Any capture rate: sr -> 48 kHz -> DFN3 -> sr with the engine's sinc resampler; pcm's length; level-normalised (dfn3Gain). */
export async function denoiseClipDfn3(dfn3, pcm, sr) {
  const g = dfn3Gain(pcm, sr);
  const x = g === 1 ? pcm : Float32Array.from(pcm, (v) => v * g);
  let y = sr === DF.sr ? (await dfn3.denoise48(x)).y : resampleClip((await dfn3.denoise48(resampleClip(x, sr, DF.sr))).y, DF.sr, sr);
  if (y.length !== pcm.length) { const out = new Float32Array(pcm.length); out.set(y.subarray(0, Math.min(y.length, pcm.length))); y = out; }
  if (g !== 1) for (let i = 0; i < y.length; i++) y[i] /= g;
  return y;
}

export const DF = Object.freeze({ sr: 48000, fft: 960, hop: 480, nbErb: 32, nbDf: 96, order: 5, lookahead: 2, minNbErbFreqs: 2, tau: 1 });

// ---- FFT (mixed radix; 960 = 2^6 * 3 * 5) ----
function factorize(n) { const f = []; for (const p of [4, 2, 3, 5]) while (n % p === 0) { f.push(p); n /= p; } if (n > 1) f.push(n); return f; }
/** A complex FFT of size n (mixed radix 2/3/4/5): fft(inRe, inIm, outRe, outIm). Exported for the tests. */
export function makeFft(n) {
  const fac = factorize(n);
  const S = fac.length;
  // leaf order of the recursive decimation in time (mixed-radix digit reversal)
  const perm = new Int32Array(n);
  let leaf = 0;
  (function order(off, stride, len, fi) {
    if (len === 1) { perm[leaf++] = off; return; }
    for (let r = 0; r < fac[fi]; r++) order(off + r * stride, stride * fac[fi], len / fac[fi], fi + 1);
  })(0, 1, n, 0);
  // stages from the innermost factor out: len = fac[fi] * prod(fac[fi+1..]); twiddles W_len^(r k)
  const stages = [];
  let inner = 1;
  for (let fi = S - 1; fi >= 0; fi--) {
    const p = fac[fi], m = inner, len = p * m;
    const wr = new Float64Array(p * m), wi = new Float64Array(p * m);
    for (let r = 0; r < p; r++) for (let k = 0; k < m; k++) { const a = -2 * Math.PI * r * k / len; wr[r * m + k] = Math.cos(a); wi[r * m + k] = Math.sin(a); }
    const cr = new Float64Array(p * p), ci = new Float64Array(p * p);
    for (let q = 0; q < p; q++) for (let r = 0; r < p; r++) { const a = -2 * Math.PI * q * r / p; cr[q * p + r] = Math.cos(a); ci[q * p + r] = Math.sin(a); }
    stages.push({ p, m, len, wr, wi, cr, ci });
    inner = len;
  }
  const ar = new Float64Array(8), ai = new Float64Array(8);
  return (inRe, inIm, re, im) => {
    for (let i = 0; i < n; i++) { const j = perm[i]; re[i] = inRe[j]; im[i] = inIm[j]; }
    for (const { p, m, len, wr, wi, cr, ci } of stages) {
      for (let o = 0; o < n; o += len) {
        for (let k = 0; k < m; k++) {
          for (let r = 0; r < p; r++) {
            const i = o + r * m + k, w = r * m + k, a = re[i], b = im[i];
            ar[r] = a * wr[w] - b * wi[w]; ai[r] = a * wi[w] + b * wr[w];
          }
          if (p === 4) {
            const t0r = ar[0] + ar[2], t0i = ai[0] + ai[2], t1r = ar[0] - ar[2], t1i = ai[0] - ai[2];
            const t2r = ar[1] + ar[3], t2i = ai[1] + ai[3], t3r = ar[1] - ar[3], t3i = ai[1] - ai[3];
            re[o + k] = t0r + t2r; im[o + k] = t0i + t2i;
            re[o + m + k] = t1r + t3i; im[o + m + k] = t1i - t3r;
            re[o + 2 * m + k] = t0r - t2r; im[o + 2 * m + k] = t0i - t2i;
            re[o + 3 * m + k] = t1r - t3i; im[o + 3 * m + k] = t1i + t3r;
          } else {
            for (let q = 0; q < p; q++) {
              let sr = 0, si = 0;
              for (let r = 0; r < p; r++) { const c = cr[q * p + r], d = ci[q * p + r]; sr += ar[r] * c - ai[r] * d; si += ar[r] * d + ai[r] * c; }
              re[o + q * m + k] = sr; im[o + q * m + k] = si;
            }
          }
        }
      }
    }
  };
}

/** libDF erb_fb: frequency bins per ERB band. Exported for the tests. */
export function erbFb(sr, fft, nb, minNb) {
  const freq2erb = (f) => 9.265 * Math.log1p(f / (24.7 * 9.265));
  const erb2freq = (e) => 24.7 * 9.265 * (Math.exp(e / 9.265) - 1);
  const nyq = sr / 2, fw = sr / fft, lo = freq2erb(0), hi = freq2erb(nyq), step = (hi - lo) / nb;
  const out = new Array(nb).fill(0);
  let prev = 0, over = 0;
  for (let i = 1; i <= nb; i++) {
    const fb = Math.round(erb2freq(lo + i * step) / fw);
    let n = fb - prev - over;
    if (n < minNb) { over = minNb - n; n = minNb; } else over = 0;
    out[i - 1] = n; prev = fb;
  }
  out[nb - 1] += 1;
  const tooLarge = out.reduce((a, b) => a + b, 0) - (fft / 2 + 1);
  if (tooLarge > 0) out[nb - 1] -= tooLarge;
  return out;
}

/**
 * The port. opts: { minDb, maxErbDb, maxDfDb, attenLimDb }: tract.rs apply_stages' thresholds (the
 * deep-filter CLI's defaults -15 / 35 / 35, which the noise study scored; libDF's RuntimeParams
 * default and the official wasm binding use -10 / 30 / 20) and the attenuation limit (100 = none).
 * y has x's length and no delay (python enhance(): pad n_fft zeros after the clip, trim
 * n_fft - hop at the start).
 */
export function createDfn3(ort, sessions, opts = {}) {
  const o = { minDb: -15, maxErbDb: 35, maxDfDb: 35, attenLimDb: 100, ...opts };
  const { fft: N, hop: H, nbErb, nbDf, order, lookahead: LA } = DF;
  const F = N / 2 + 1;
  const fftN = makeFft(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) { const s = Math.sin(0.5 * Math.PI * (i + 0.5) / (N / 2)); win[i] = Math.sin(0.5 * Math.PI * s * s); }
  const wnorm = 1 / (N * N / (2 * H));
  const erb = erbFb(DF.sr, N, nbErb, DF.minNbErbFreqs);
  // calc_norm_alpha: exp(-hop / sr / tau) rounded to the first precision below 1 (0.99)
  let alpha = 1; { const a = Math.exp(-H / DF.sr / DF.tau); for (let p = 3; alpha >= 1; p++) alpha = Math.round(a * 10 ** p) / 10 ** p; }
  const lim = Math.abs(o.attenLimDb) >= 100 ? null : 10 ** (-Math.abs(o.attenLimDb) / 20);

  async function denoise48(x) {
    const t0 = performance.now();
    const n = x.length;
    const T = Math.floor((n + N) / H); // python enhance pads n_fft zeros after the clip
    const pad = new Float32Array(T * H); pad.set(x);
    // ---- analysis (frame_analysis: [previous hop, new hop] x window, rfft, x wnorm), two real
    // frames per complex FFT (frame t real, t + 1 imaginary) ----
    const Xr = new Float32Array(T * F), Xi = new Float32Array(T * F);
    const bRe = new Float64Array(N), bIm = new Float64Array(N), oRe = new Float64Array(N), oIm = new Float64Array(N);
    const frame = (t, i) => { const j = t * H - (N - H) + i; return t < T && j >= 0 ? pad[j] * win[i] : 0; };
    for (let t = 0; t < T; t += 2) {
      for (let i = 0; i < N; i++) { bRe[i] = frame(t, i); bIm[i] = frame(t + 1, i); }
      fftN(bRe, bIm, oRe, oIm);
      for (let k = 0; k < F; k++) {
        const nk = (N - k) % N;
        Xr[t * F + k] = 0.5 * (oRe[k] + oRe[nk]) * wnorm; Xi[t * F + k] = 0.5 * (oIm[k] - oIm[nk]) * wnorm;
        if (t + 1 < T) { Xr[(t + 1) * F + k] = 0.5 * (oIm[k] + oIm[nk]) * wnorm; Xi[(t + 1) * F + k] = -0.5 * (oRe[k] - oRe[nk]) * wnorm; }
      }
    }
    // ---- features (feat_erb / feat_cplx with exponential normalisation, causal over frames) ----
    const fe = new Float32Array(T * nbErb), fs = new Float32Array(2 * T * nbDf);
    const mean = Float64Array.from({ length: nbErb }, (_, i) => -60 + i * (-90 - -60) / (nbErb - 1));
    const unit = Float64Array.from({ length: nbDf }, (_, i) => 0.001 + i * (0.0001 - 0.001) / (nbDf - 1));
    for (let t = 0; t < T; t++) {
      let k0 = 0;
      for (let b = 0; b < nbErb; b++) {
        let e = 0; const w = 1 / erb[b];
        for (let j = 0; j < erb[b]; j++) { const k = t * F + k0 + j; e += (Xr[k] * Xr[k] + Xi[k] * Xi[k]) * w; }
        k0 += erb[b];
        const db = Math.log10(e + 1e-10) * 10;
        mean[b] = db * (1 - alpha) + mean[b] * alpha;
        fe[t * nbErb + b] = (db - mean[b]) / 40;
      }
      for (let k = 0; k < nbDf; k++) {
        const re = Xr[t * F + k], im = Xi[t * F + k];
        unit[k] = Math.hypot(re, im) * (1 - alpha) + unit[k] * alpha;
        const s = Math.sqrt(unit[k]);
        fs[t * nbDf + k] = re / s;             // channel 0: real
        fs[T * nbDf + t * nbDf + k] = im / s;  // channel 1: imaginary
      }
    }
    const tFeat = performance.now();
    // ---- the three graphs over the whole sequence ----
    const e = await sessions.enc.run({ feat_erb: new ort.Tensor("float32", fe, [1, 1, T, nbErb]), feat_spec: new ort.Tensor("float32", fs, [1, 2, T, nbDf]) });
    const [m, c] = await Promise.all([
      sessions.erbDec.run({ emb: e.emb, e3: e.e3, e2: e.e2, e1: e.e1, e0: e.e0 }),
      sessions.dfDec.run({ emb: e.emb, c0: e.c0 }),
    ]);
    const tNet = performance.now();
    const lsnr = e.lsnr.data, gains = m.m.data, coefs = c.coefs.data; // [T], [T*32], [T*96*10]
    // ---- enhancement: model output at t belongs to frame t - lookahead (tract.rs process) ----
    const Yr = new Float32Array(T * F), Yi = new Float32Array(T * F);
    for (let tau = 0; tau < T; tau++) {
      const t = tau + LA; // model output index
      const L = t < T ? lsnr[t] : -Infinity;
      let gainsOn = false, zeros = false, dfOn = false;
      if (L < o.minDb) zeros = true;
      else if (L > o.maxErbDb) { /* clean: unchanged */ }
      else if (L > o.maxDfDb) gainsOn = true;
      else { gainsOn = true; dfOn = true; }
      const base = tau * F;
      if (zeros) { /* the frame stays zero */ } else {
        let k0 = 0;
        for (let b = 0; b < nbErb; b++) {
          const g = gainsOn ? gains[t * nbErb + b] : 1;
          for (let j = 0; j < erb[b]; j++) { const k = base + k0 + j; Yr[k] = Xr[k] * g; Yi[k] = Xi[k] * g; }
          k0 += erb[b];
        }
      }
      if (dfOn) {
        for (let k = 0; k < nbDf; k++) {
          let sr = 0, si = 0;
          for (let q = 0; q < order; q++) {
            const s = tau - LA + q; // frames tau-2 .. tau+2
            if (s < 0 || s >= T) continue;
            const xr = Xr[s * F + k], xi = Xi[s * F + k];
            const ci = ((t * nbDf + k) * order + q) * 2, cr = coefs[ci], cim = coefs[ci + 1];
            sr += xr * cr - xi * cim; si += xr * cim + xi * cr;
          }
          Yr[base + k] = sr; Yi[base + k] = si;
        }
      }
      if (lim !== null) for (let k = 0; k < F; k++) { Yr[base + k] = Yr[base + k] * (1 - lim) + Xr[base + k] * lim; Yi[base + k] = Yi[base + k] * (1 - lim) + Xi[base + k] * lim; }
    }
    // ---- synthesis (frame_synthesis: irfft (unnormalised), window, overlap-add), two frames per
    // complex FFT: C = A + iB, conj(FFT(conj(C))) = a + ib ----
    const out = new Float32Array(T * H);
    const mem = new Float64Array(N - H);
    const fr = new Float64Array(2 * N);
    for (let tau = 0; tau < T; tau += 2) {
      const two = tau + 1 < T;
      for (let k = 0; k < N; k++) {
        const kk = k < F ? k : N - k, sg = k < F ? 1 : -1; // Hermitian completion
        const Ar = Yr[tau * F + kk], Ai = sg * Yi[tau * F + kk];
        const Br = two ? Yr[(tau + 1) * F + kk] : 0, Bi = two ? sg * Yi[(tau + 1) * F + kk] : 0;
        bRe[k] = Ar - Bi; bIm[k] = -(Ai + Br); // conj(A + iB)
      }
      fftN(bRe, bIm, oRe, oIm);
      for (let i = 0; i < N; i++) { fr[i] = oRe[i]; fr[N + i] = -oIm[i]; }
      for (let f2 = 0; f2 < (two ? 2 : 1); f2++) {
        const t = tau + f2, base = f2 * N;
        for (let i = 0; i < H; i++) out[t * H + i] = fr[base + i] * win[i] + mem[i];
        for (let i = 0; i < N - H; i++) mem[i] = fr[base + H + i] * win[H + i];
      }
    }
    const d = N - H;
    const y = out.slice(d, d + n);
    return { y, lsnr, ms: { features: tFeat - t0, net: tNet - tFeat, total: performance.now() - t0 } };
  }
  return { denoise48, erb, alpha };
}
