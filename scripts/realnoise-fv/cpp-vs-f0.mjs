// cpp-vs-f0.mjs — CPP (production src/dsp/cpp.js) of one synthetic
// glottal-pulse vowel at F0s from 76 to 350 Hz, modal and with aspiration
// noise, on the DSP worker's windows: 50 ms (`cpp`, the vocal-weight feed) and
// 64 ms (`bridgeCpp`, the pitch-hold bridge's voice evidence). Review fix
// round 2026-10-06 (measurements/pitch-hold-bridge-rework-2026-10-06.md
// §4.1): on 50 ms a deep voice fits fewer periods and reads lower, so a fixed
// evidence threshold is a stricter bar for low voices. Median over 25 ms hops
// of a 1.5 s vowel (/a/: 700 / 1220 / 2600 Hz), jitter 0.5 %.
//
//   node scripts/realnoise-fv/cpp-vs-f0.mjs [--src=src] [--sr=16000] [--windows=50,64]
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const { computeCPP } = await import(pathToFileURL(resolve(args.src ?? "src", "dsp/cpp.js")).href);
const SR = Number(args.sr ?? 16000);
const WINDOWS = (args.windows ?? "50,64").split(",").map(Number);

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const rms = (x) => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length); };
function reson(x, F, B, sr) {
  const r = Math.exp(-Math.PI * B / sr), c = 2 * r * Math.cos(2 * Math.PI * F / sr), d = -r * r;
  const y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] + c * (y[i - 1] ?? 0) + d * (y[i - 2] ?? 0);
  return y;
}
// Rosenberg-like glottal flow, differentiated; aspiration at aspDb re its RMS
function vowel(f0, sr, dur, aspDb, jitter = 0.005, seed = 3) {
  const r = rng(seed), n = Math.round(sr * dur), src = new Float64Array(n);
  let t = 0;
  while (t < n) {
    const T = sr / (f0 * (1 + jitter * gauss(r)));
    const Tp = 0.4 * T, Tn = 0.16 * T;
    for (let i = 0; i < T && t + i < n; i++) {
      const g = i < Tp ? 0.5 * (1 - Math.cos(Math.PI * i / Tp)) : i < Tp + Tn ? Math.cos(Math.PI * (i - Tp) / (2 * Tn)) : 0;
      src[Math.floor(t + i)] += g;
    }
    t += T;
  }
  for (let i = n - 1; i > 0; i--) src[i] -= src[i - 1];
  const amp = Math.pow(10, aspDb / 20) * rms(src);
  for (let i = 0; i < n; i++) src[i] += amp * gauss(r);
  let y = src;
  for (const [F, B] of [[700, 90], [1220, 110], [2600, 160]]) y = reson(y, F, B, sr);
  let m = 0; for (const v of y) m = Math.max(m, Math.abs(v));
  return Float32Array.from(y, (v) => 0.5 * v / m);
}

const F0S = [76, 78, 82, 86, 90, 100, 110, 120, 140, 160, 180, 200, 220, 250, 300, 350];
console.log(`| window | aspiration | ${F0S.map((f) => `${f} Hz`).join(" | ")} |`);
console.log(`|---|---|${F0S.map(() => "---").join("|")}|`);
for (const wms of WINDOWS) {
  for (const asp of [-60, -6]) {
    const row = [];
    for (const f0 of F0S) {
      const x = vowel(f0, SR, 1.5, asp);
      const W = Math.floor(SR * wms / 1000), hop = Math.round(SR * 0.025);
      const v = [];
      for (let s = SR * 0.2; s + W <= x.length; s += hop) v.push(computeCPP(x.subarray(s, s + W), SR));
      v.sort((a, b) => a - b);
      row.push(v[Math.floor(v.length / 2)].toFixed(2));
    }
    console.log(`| ${wms} ms | ${asp === -60 ? "none (modal)" : `${asp} dB`} | ${row.join(" | ")} |`);
  }
}
