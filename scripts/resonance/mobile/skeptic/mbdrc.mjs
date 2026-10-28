// skeptic/mbdrc.mjs — a perturb.mjs "mod": a generic STFT multiband dynamic-range
// compressor (a stand-in for platform-side processing a phone's capture preset
// might apply; NOT a model of any measured device). Per band, the frame level
// L (dB) is tracked by an attack/release envelope; gain = (1/R - 1)(env - P_b),
// clamped to [-maxCut, +maxBoost], interpolated across bands in log-frequency.
// Pivot P_b = that band's median active level in the SAME reader's unchanged N
// render, normalised to the same active level as x, so N, U10, D10 and the
// switch / excursion streams of a reader share one fixed operating point (a
// stream-adaptive pivot would cancel the compression of long-term differences).
// ratio 1 = identity (up to float32 rounding).
import fs from "node:fs"; import path from "node:path";
import { fileURLToPath as toPath } from "node:url";
import { activeLevelDb } from "../perturb.mjs";
const N = 1024, H = 256;
const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = ((inv ? 2 : -2) * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
      re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
const EDGES = [0, 300, 800, 1600, 3200, 6400, 24000];
function frames(x, sr, fn) { // calls fn(re, im, t) per frame
  const nF = Math.ceil((x.length + N) / H) + 1;
  for (let f = 0; f < nF; f++) {
    const s = f * H - N; const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) { const j = s + i; re[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0; }
    fft(re, im, false); fn(re, im, s);
  }
}
function bandOf(sr) { const b = new Int32Array(N / 2 + 1); for (let k = 0; k <= N / 2; k++) { const f = (k * sr) / N; let i = 0; while (i < EDGES.length - 2 && f >= EDGES[i + 1]) i++; b[k] = i; } return b; }
function bandLevels(re, im, bo, nb) { const e = new Float64Array(nb), c = new Float64Array(nb); for (let k = 1; k < N / 2; k++) { e[bo[k]] += re[k] * re[k] + im[k] * im[k]; c[bo[k]]++; } return Array.from(e, (v, i) => 10 * Math.log10(v / c[i] + 1e-20)); }
const pivotCache = new Map();
function pivots(reader, sr, target, streamsDir) {
  const key = `${reader}|${target.toFixed(2)}`; if (pivotCache.has(key)) return pivotCache.get(key);
  const buf = fs.readFileSync(path.join(streamsDir, "v", `${reader}__N.f32`));
  const n = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const g = 10 ** ((target - activeLevelDb(n, sr)) / 20); const y = Float32Array.from(n, (v) => v * g);
  const bo = bandOf(sr), nb = EDGES.length - 1, L = Array.from({ length: nb }, () => []), tot = [];
  frames(y, sr, (re, im) => { const l = bandLevels(re, im, bo, nb); const t = 10 * Math.log10(l.reduce((a, v) => a + 10 ** (v / 10), 0) + 1e-20); tot.push(t); l.forEach((v, i) => L[i].push([t, v])); });
  const tmax = [...tot].sort((a, b) => a - b)[Math.floor(tot.length * 0.95)];
  const P = L.map((arr) => { const v = arr.filter(([t]) => t > tmax - 25).map(([, v]) => v).sort((a, b) => a - b); return v[v.length >> 1]; });
  pivotCache.set(key, P); return P;
}
export function apply(x, sr, params = {}, ctx = {}) {
  const R = params.ratio ?? 3, ta = params.attackMs ?? 20, tr = params.releaseMs ?? 300, maxCut = params.maxCut ?? 24, maxBoost = params.maxBoost ?? 12;
  const streamsDir = params.streams ?? path.join(path.resolve(path.dirname(toPath(import.meta.url)), "../../../.."), "build/resonance-mobile/streams");
  const nb = EDGES.length - 1, bo = bandOf(sr);
  const P = pivots(ctx.reader, sr, activeLevelDb(x, sr), streamsDir);
  const ca = 1 - Math.exp(-(H / sr) / (ta / 1000)), cr = 1 - Math.exp(-(H / sr) / (tr / 1000));
  const env = P.slice();
  const cen = EDGES.slice(0, -1).map((e, i) => Math.log(Math.max(e, 60) * Math.min(EDGES[i + 1], 8000)) / 2);
  const out = new Float64Array(x.length + 2 * N);
  frames(x, sr, (re, im, s) => {
    const l = bandLevels(re, im, bo, nb);
    const gdb = l.map((v, i) => { env[i] += (v > env[i] ? ca : cr) * (v - env[i]); return Math.max(-maxCut, Math.min(maxBoost, (1 / R - 1) * (env[i] - P[i]))); });
    for (let k = 0; k <= N / 2; k++) {
      const lf = Math.log(Math.max((k * sr) / N, 1)); let g;
      if (lf <= cen[0]) g = gdb[0]; else if (lf >= cen[nb - 1]) g = gdb[nb - 1];
      else { let i = 0; while (lf > cen[i + 1]) i++; const w = (lf - cen[i]) / (cen[i + 1] - cen[i]); g = gdb[i] * (1 - w) + gdb[i + 1] * w; }
      const a = 10 ** (g / 20); re[k] *= a; im[k] *= a; if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    }
    fft(re, im, true);
    for (let i = 0; i < N; i++) out[s + i + N] += re[i] * win[i];
  });
  // sqrt-Hann analysis x synthesis at hop N/4 sums to 2
  const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = out[i + N] / 2;
  return y;
}
