// vtln-cpu-exactness-test.js — the resonance-cue CPU pass
// (measurements/resonance-cue-cpu-2026-10-07.md) kept the vtln analysis
// exact where it claims to, and near-exact where it says so.
//
//   1  lazy 16 kHz analysis ring (sinc-resampler.js createLazySincRing) ===
//      the eager createSincResampler stream, sample for sample, at 48 / 44.1 /
//      32 / 16 kHz with uneven chunk sizes, read in random order
//   2  frames-mode sample counter (lab-engine.js) === the length the pitch
//      worker's createStreamingResampler returns, chunk for chunk
//   3  createRealFFT vs the complex FFT: max relative error < 1e-12
//   4  the per-stage FFT tables give bit-identical transforms to a reference
//      radix-2 implementation with the original loop order
//   5  vtln with every near-exact switch OFF (realFft, noDither, prune false)
//      reproduces the pre-pass engine's vtln bins BIT-EXACTLY (golden values
//      tests/resonance/fixtures/vtln-exact-golden.json, generated from
//      origin/cue-strip 045ec9f's lab engine: the three lab fixtures at 48 kHz,
//      internal pitch replica); the default (near-exact) analysis is within
//      1e-6 ln alpha of it (the pre-registered guards allow 0.02 u ~ 2e-3)
//
//   node tests/resonance/vtln-cpu-exactness-test.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createSincResampler, createLazySincRing } from "../../src/resonance-lab/sinc-resampler.js";
import { createFFT, createRealFFT } from "../../src/resonance-lab/fft.js";
import { createStreamingResampler } from "../../src/ml/audio-utils.js";
import { createLabEngine, createStreamingSampleCounter } from "../../src/resonance-lab/lab-engine.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const { upsample } = await import(pathToFileURL(path.join(repo, "scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs")).href);

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}
let seed = 12345;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
function signal(n, sr) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    x[i] = 0.3 * Math.sin(2 * Math.PI * 180 * t) + 0.2 * Math.sin(2 * Math.PI * 2300 * t + 1) + 0.05 * (rnd() - 0.5) + 0.1 * Math.sin(2 * Math.PI * 11000 * t);
  }
  return x;
}
function chunkSizes(sr) { return [Math.round(sr * 0.025), Math.round(sr * 0.01) + 7, 1, Math.round(sr * 0.05), 3, Math.round(sr * 0.025) - 1]; }

console.log("1. lazy analysis ring === eager sinc resampler");
for (const sr of [48000, 44100, 32000, 16000]) {
  const x = signal(sr * 3, sr);
  const eager = createSincResampler(sr, 16000);
  const ring = createLazySincRing(sr, 16000, 1 << 15);
  const ref = [];
  let s = 0, k = 0, endsOk = true;
  const sizes = chunkSizes(sr);
  while (s < x.length) {
    const c = x.subarray(s, Math.min(x.length, s + sizes[k++ % sizes.length]));
    const out = eager(c);
    for (const v of out) ref.push(v);
    ring.pushNative(c);
    if (ring.end !== ref.length) endsOk = false;
    s += c.length;
  }
  check(`${sr} Hz: ring.end follows the eager output count after every chunk`, endsOk, `${ref.length} samples`);
  // random-order reads of the retained window (lazy fill), then a clamped block read
  let same = true, maxIdx = -1;
  const lo = Math.max(0, ring.end - ring.capacity);
  for (let r = 0; r < 4000; r++) {
    const i = lo + Math.floor(rnd() * (ring.end - lo));
    const v = ring.at(i);
    if (v !== Math.fround(ref[i])) { same = false; maxIdx = i; break; }
  }
  const dst = new Float64Array(700);
  ring.readClamped(dst, ring.end - 500, 700);
  for (let i = 0; i < 700 && same; i++) {
    const j = Math.min(ring.end - 1, ring.end - 500 + i);
    if (dst[i] !== Math.fround(ref[j])) { same = false; maxIdx = j; }
  }
  check(`${sr} Hz: every lazily computed sample === the eager one`, same, same ? "" : `first mismatch at ${maxIdx}`);
}

console.log("2. frames-mode sample counter === pitch worker resampler output length");
for (const sr of [48000, 44100, 22050, 16000]) {
  const x = signal(sr * 2, sr);
  const lin = createStreamingResampler(sr, 16000);
  const cnt = createStreamingSampleCounter(sr, 16000);
  let s = 0, k = 0, ok = true, total = 0;
  const sizes = [...chunkSizes(sr), 0];
  while (s < x.length) {
    const c = x.subarray(s, Math.min(x.length, s + sizes[k++ % sizes.length]));
    const a = lin(c).length, b = cnt(c);
    if (a !== b) ok = false;
    total += a;
    s += c.length;
  }
  check(`${sr} Hz: counts equal on every chunk`, ok, `${total} samples`);
}

console.log("3. real-input FFT vs complex FFT");
{
  const n = 1024, f = createFFT(n), rf = createRealFFT(n);
  let maxRel = 0;
  for (let trial = 0; trial < 20; trial++) {
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = trial % 2 ? Math.log(1e-6 + rnd()) : rnd() - 0.5;
    const re = Float64Array.from(x), im = new Float64Array(n);
    f.forward(re, im);
    const oR = new Float64Array(n / 2 + 1), oI = new Float64Array(n / 2 + 1);
    rf.forward(x, oR, oI);
    let scale = 0;
    for (let k = 0; k <= n / 2; k++) scale = Math.max(scale, Math.hypot(re[k], im[k]));
    for (let k = 0; k <= n / 2; k++) maxRel = Math.max(maxRel, Math.hypot(oR[k] - re[k], oI[k] - im[k]) / scale);
  }
  check("max error / max |X| < 1e-12", maxRel < 1e-12, maxRel.toExponential(2));
}

console.log("4. per-stage FFT tables: bit-identical to the original loop order");
{
  const n = 1024, f = createFFT(n);
  // the pre-pass transform, verbatim
  const log2 = 10, rev = new Uint32Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < log2; b++) r |= ((i >> b) & 1) << (log2 - 1 - b); rev[i] = r; }
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((-2 * Math.PI * i) / n); sin[i] = Math.sin((-2 * Math.PI * i) / n); }
  function old(re, im, sign) {
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = sign * sin[k * step], a = s + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  let same = true;
  for (let trial = 0; trial < 10 && same; trial++) {
    const r0 = new Float64Array(n), i0 = new Float64Array(n);
    for (let i = 0; i < n; i++) { r0[i] = rnd() - 0.5; i0[i] = trial % 3 ? rnd() - 0.5 : 0; }
    for (const [sign, fn] of [[1, f.forward], [-1, f.inverse]]) {
      const a = Float64Array.from(r0), b = Float64Array.from(i0), c = Float64Array.from(r0), d = Float64Array.from(i0);
      fn(a, b); old(c, d, sign);
      for (let i = 0; i < n; i++) if (a[i] !== c[i] || b[i] !== d[i]) same = false;
    }
  }
  check("forward and inverse === the original radix-2 loop", same);
}

console.log("5. vtln bins vs the pre-pass engine (golden)");
{
  const golden = JSON.parse(readFileSync(path.join(here, "fixtures", "vtln-exact-golden.json"), "utf8"));
  const assets = path.join(repo, "public", "resonance-lab");
  const vtln = JSON.parse(readFileSync(path.join(assets, "vtln_warp.json"), "utf8"));
  const reference = JSON.parse(readFileSync(path.join(assets, "reference.json"), "utf8"));
  function readWav16(p) {
    const b = readFileSync(p);
    let off = 12, data = null;
    while (off < b.length) {
      const id = b.toString("ascii", off, off + 4), len = b.readUInt32LE(off + 4);
      if (id === "data") { data = b.subarray(off + 8, off + 8 + len); break; }
      off += 8 + len + (len & 1);
    }
    const x = new Float32Array(data.length / 2);
    for (let i = 0; i < x.length; i++) x[i] = data.readInt16LE(2 * i) / 32768;
    return x;
  }
  const run = (y, opts) => {
    const bins = [];
    const eng = createLabEngine({ sampleRate: 48000, models: { vtln }, reference, vtln: opts,
      onBin: (n, te, v) => { if (n === "vtln") bins.push([Math.round(te * 1000), v]); } });
    for (let s = 0; s < y.length; s += 1200) eng.pushChunk(y.subarray(s, Math.min(y.length, s + 1200)));
    eng.finish();
    return bins;
  };
  for (const [name, exp] of Object.entries(golden.fixtures)) {
    const y = Float32Array.from(upsample(readWav16(path.join(repo, "tests/resonance-lab/fixtures", `${name}.wav`))));
    const exact = run(y, { realFft: false, noDither: false, prune: false });
    const sameLen = exact.length === exp.length;
    let identical = sameLen, nonNull = 0;
    for (let i = 0; sameLen && i < exp.length; i++) {
      if (exact[i][0] !== exp[i][0] || exact[i][1] !== exp[i][1]) identical = false;
      if (exp[i][1] !== null) nonNull++;
    }
    check(`${name}: exact switches === pre-pass engine (bit-exact)`, identical && nonNull > 0, `${exp.length} bins, ${nonNull} values`);
    const def = run(y, {});
    let maxd = 0, nullMismatch = 0;
    for (let i = 0; i < Math.min(def.length, exp.length); i++) {
      if ((def[i][1] === null) !== (exp[i][1] === null)) nullMismatch++;
      else if (exp[i][1] !== null) maxd = Math.max(maxd, Math.abs(def[i][1] - exp[i][1]));
    }
    check(`${name}: default analysis within 1e-6 ln alpha`, def.length === exp.length && nullMismatch === 0 && maxd <= 1e-6, `max |d| ${maxd.toExponential(2)}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
