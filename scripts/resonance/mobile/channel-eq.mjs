// channel-eq.mjs — an arbitrary smooth magnitude response as a linear-phase FIR
// (perturb.mjs "mod" module; mobile resonance diagnosis, channel area, 2026-10-28).
//
//   { "type": "mod", "path": "scripts/resonance/mobile/channel-eq.mjs",
//     "params": { "curve": [[f_Hz, dB], ...], "taps": 4095 } }
//   or params { "tilt": <dB per octave>, "knee": 1000 }  (0 dB below the knee,
//     tilt * log2(f / knee) above it)
//
// The target |H(f)| is the curve interpolated linearly in dB over log2 f, held
// flat beyond its first and last points. Design: frequency sampling on an
// 8192-point grid at the stream rate, zero phase, the impulse response cut to
// `taps` (odd) samples with a Hann window. Applied by FFT overlap-add; the
// (taps - 1) / 2 delay is removed, so the output is time-aligned with the input
// (non-causal by ~43 ms at 48 kHz; a real microphone is minimum phase — the
// chain reads magnitude spectra, so the phase choice is not expected to matter).
import { createFFT } from "../../../src/resonance-lab/fft.js";

export function curveDb(curve, f) {
  if (!curve.length) return 0;
  if (f <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (f >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    if (f <= curve[i][0]) {
      const [f0, d0] = curve[i - 1], [f1, d1] = curve[i];
      const a = (Math.log2(f) - Math.log2(f0)) / (Math.log2(f1) - Math.log2(f0));
      return d0 + a * (d1 - d0);
    }
  }
  return last[1];
}
export function tiltCurve(slope, knee = 1000, top = 24000) {
  const c = [[knee, 0]];
  for (let f = knee * 2 ** (1 / 12); f <= top * 1.0001; f *= 2 ** (1 / 12)) c.push([f, slope * Math.log2(f / knee)]);
  return c;
}
export function paramsCurve(params) {
  if (params.curve) return params.curve;
  if (params.tilt != null) return tiltCurve(params.tilt, params.knee ?? 1000);
  throw new Error("channel-eq: params.curve or params.tilt required");
}

const designCache = new Map();
/** Linear-phase FIR (Float64Array, length taps) for a curve at sr. */
export function design(curve, sr, taps = 4095) {
  const key = JSON.stringify([curve, sr, taps]);
  if (designCache.has(key)) return designCache.get(key);
  if (taps % 2 !== 1) throw new Error("taps must be odd");
  const N = 8192;
  if (taps > N) throw new Error("taps > 8192");
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let k = 0; k <= N / 2; k++) {
    const f = (k * sr) / N, g = 10 ** (curveDb(curve, Math.max(f, 1)) / 20);
    re[k] = g;
    if (k > 0 && k < N / 2) re[N - k] = g;
  }
  createFFT(N).inverse(re, im); // real, even -> real, even impulse response centred at 0
  const M = taps, D = (M - 1) / 2, h = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    const n = i - D, w = 0.5 * (1 + Math.cos((2 * Math.PI * n) / (M + 1)));
    h[i] = (re[(n + N) % N] / N) * w;
  }
  designCache.set(key, h);
  return h;
}
/** |H(f)| in dB of the FIR (direct evaluation). */
export function firGainDb(h, f, sr) {
  const D = (h.length - 1) / 2, w = (2 * Math.PI * f) / sr;
  let s = 0;
  for (let i = 0; i < h.length; i++) s += h[i] * Math.cos(w * (i - D));
  return 20 * Math.log10(Math.abs(s) + 1e-30);
}
/** FFT overlap-add convolution, delay (M - 1) / 2 removed. */
export function filterCentred(x, h) {
  const M = h.length, D = (M - 1) / 2, NF = 16384, L = NF - M + 1;
  const fft = createFFT(NF);
  const Hr = new Float64Array(NF), Hi = new Float64Array(NF);
  Hr.set(h); fft.forward(Hr, Hi);
  const acc = new Float64Array(x.length + M);
  const br = new Float64Array(NF), bi = new Float64Array(NF);
  for (let s = 0; s < x.length; s += L) {
    br.fill(0); bi.fill(0);
    const e = Math.min(x.length, s + L);
    for (let i = s; i < e; i++) br[i - s] = x[i];
    fft.forward(br, bi);
    for (let k = 0; k < NF; k++) { const r = br[k] * Hr[k] - bi[k] * Hi[k], m = br[k] * Hi[k] + bi[k] * Hr[k]; br[k] = r; bi[k] = m; }
    fft.inverse(br, bi);
    const n = Math.min(NF, acc.length - s);
    for (let i = 0; i < n; i++) acc[s + i] += br[i] / NF;
  }
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = acc[i + D];
  return y;
}
export function apply(x, sr, params = {}) {
  return filterCentred(x, design(paramsCurve(params), sr, params.taps ?? 4095));
}
