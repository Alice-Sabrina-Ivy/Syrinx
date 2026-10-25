// denoise-test.js — Voice Shaper's background-noise reduction (src/voice-preview/denoise.js):
// the committed RNNoise module is the pinned package's embedded RNNoise 0.2 build (and, when
// node_modules has the package, equals a fresh extraction); it loads without Emscripten's glue
// under the pinned export names; rnnoise_process_frame delays by RNNOISE_DELAY and denoise48
// compensates it exactly; clean speech keeps its level; white noise under speech is reduced;
// the result is deterministic; denoiseClip keeps the length and the timing at 44.1 and 16 kHz.
// Public audio only: the committed LibriSpeech clips (CC BY 4.0) and seeded synthetic noise.
// measurements/voice-shaper-denoise-2026-10-23.md.
//
//   node tests/voice-preview/denoise-test.js
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO, makeInput, sha256, makeChecker } from "./vp-test-lib.js";
import { RNNOISE_PINS, EXPORTS, RNNOISE_DELAY, FRAME, createRnnoise, denoiseClip } from "../../src/voice-preview/denoise.js";
import { createDenoiseStream } from "../../src/voice-preview/denoise-stream.js";
import { extractRnnoise, PACKAGE_DIR, OUT } from "../../scripts/voice-preview/extract-rnnoise.mjs";

const T = makeChecker();

console.log("the committed module");
const bytes = readFileSync(OUT);
{
  const ok = sha256(bytes) === RNNOISE_PINS.wasmSha256 && bytes.length === RNNOISE_PINS.wasmBytes;
  T.check("src/voice-preview/rnnoise/rnnoise.wasm: sha256 and size = RNNOISE_PINS", ok,
    ok ? `${bytes.length} B` : `got ${bytes.length} B, ${sha256(bytes)} (a CRLF checkout? see .gitattributes)`);
}
if (existsSync(PACKAGE_DIR)) {
  let same = false, detail = "";
  try { same = extractRnnoise().equals(bytes); } catch (err) { detail = String(err.message || err); }
  T.check(`= the module embedded in @jitsi/rnnoise-wasm ${RNNOISE_PINS.packageVersion} dist/rnnoise-sync.js`, same, detail);
} else {
  console.log("  SKIP extraction check (node_modules/@jitsi/rnnoise-wasm absent)");
}
const mod = new WebAssembly.Module(bytes);
const imports = WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}:${i.kind}`).sort();
T.check("imports: exactly the two functions the loader provides", JSON.stringify(imports) === JSON.stringify(["a.a:function", "a.b:function"]), imports.join(", "));
const exportNames = new Set(WebAssembly.Module.exports(mod).map((e) => e.name));
T.check("exports: every name in EXPORTS", Object.values(EXPORTS).every((n) => exportNames.has(n)), [...exportNames].join(","));
const licence = readFileSync(path.join(REPO, "licenses/rnnoise/COPYING"), "utf8");
T.check("licenses/rnnoise/COPYING is RNNoise's BSD licence", /Jean-Marc Valin/.test(licence) && /Xiph\.Org Foundation/.test(licence) && /Redistributions in binary form/.test(licence));

const rn = createRnnoise(mod);
console.log(`\nloads without the glue (memory ${(rn.memoryBytes() / 1048576).toFixed(1)} MB)`);

// ---- helpers
const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
function lagOf(x, y, maxLag) {
  let best = 0, bv = -Infinity;
  for (let d = -maxLag; d <= maxLag; d++) {
    let c = 0;
    for (let i = Math.max(0, -d); i + d < y.length && i < x.length; i++) c += x[i] * y[i + d];
    if (c > bv) { bv = c; best = d; }
  }
  return best;
}
function snrVs(clean, y) {
  let ss = 0, sy = 0;
  for (let i = 0; i < clean.length; i++) { ss += clean[i] * clean[i]; sy += clean[i] * y[i]; }
  const g = sy / ss;
  let e = 0;
  for (let i = 0; i < clean.length; i++) { const r = y[i] - g * clean[i]; e += r * r; }
  return 10 * Math.log10((g * g * ss) / e);
}
let seed = 7;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296 * 2 - 1; };

console.log("\ntiming and level (LibriSpeech @48 kHz)");
const { pcm } = makeInput({ clip: "ls_woman_high", rate: 48000 });
{
  // RNNOISE_DELAY is what denoise48 drops: a wrong value shows up as a non-zero lag here
  const st = createRnnoise(mod);
  const y = st.denoise48(pcm);
  const lag = lagOf(pcm.subarray(0, 96000), y.subarray(0, 96000), 2 * FRAME);
  T.check(`denoise48 output lines up with its input (lag 0 after dropping RNNOISE_DELAY = ${RNNOISE_DELAY})`, lag === 0, `lag ${lag} samples`);
  T.check("same length as the input", y.length === pcm.length);
  const dB = 20 * Math.log10(rms(y) / rms(pcm));
  T.check("clean speech keeps its level (within 1 dB)", Math.abs(dB) < 1, `${dB.toFixed(2)} dB`);
  T.check("deterministic: a second run is bit-identical", sha256(st.denoise48(pcm)) === sha256(y));
}

console.log("\nnoise reduction (white noise at 0 dB SNR)");
{
  const noise = Float32Array.from({ length: pcm.length }, rnd);
  const g = rms(pcm) / rms(noise);
  const mixd = pcm.map((v, i) => v + g * noise[i]);
  const y = rn.denoise48(mixd);
  const before = snrVs(pcm, mixd), after = snrVs(pcm, y);
  T.check("speech-to-residual ratio improves by ≥ 6 dB", after - before >= 6, `${before.toFixed(1)} -> ${after.toFixed(1)} dB`);
  const yn = rn.denoise48(noise.map((v) => v * g));
  const att = 20 * Math.log10(rms(noise.map((v) => v * g)) / rms(yn));
  T.check("noise alone is attenuated by ≥ 20 dB", att >= 20, `${att.toFixed(1)} dB`);
}

console.log("\ndenoiseClip at other capture rates");
for (const rate of [44100, 16000]) {
  const inp = makeInput({ clip: "ls_man_low", rate }).pcm;
  const y = denoiseClip(rn, inp, rate);
  const n = Math.min(inp.length, Math.round(2 * rate));
  const lag = lagOf(inp.subarray(0, n), y.subarray(0, n), Math.round(0.02 * rate));
  T.check(`${rate} Hz: same length, lag 0, level within 1.5 dB`, y.length === inp.length && lag === 0 && Math.abs(20 * Math.log10(rms(y) / rms(inp))) < 1.5,
    `lag ${lag}, ${(20 * Math.log10(rms(y) / rms(inp))).toFixed(2)} dB`);
}
{
  const inp = makeInput({ clip: "ls_man_low", rate: 48000 }).pcm;
  T.check("48 kHz: denoiseClip = denoise48 (no resampling)", sha256(denoiseClip(rn, inp, 48000)) === sha256(rn.denoise48(inp)));
}

console.log("\nwhile recording (denoise-stream.js): the same bytes as denoiseClip, chunk by chunk");
for (const rate of [48000, 44100, 16000, 96000]) {
  const inp = makeInput({ clip: "ls_woman_high", rate }).pcm;
  const C = Math.floor(0.025 * rate);
  const s = createDenoiseStream(rn, rate);
  const parts = [];
  for (let k = 0; k < inp.length; k += C) parts.push(s.push(inp.subarray(k, Math.min(inp.length, k + C))));
  const tail = s.finish();
  parts.push(tail);
  const y = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { y.set(p, o); o += p.length; }
  T.check(`${rate} Hz: streamed = denoiseClip, bit for bit; under 40 ms left at the end`, sha256(y) === sha256(denoiseClip(rn, inp, rate)) && tail.length < 0.04 * rate,
    `${tail.length} samples at the end`);
}

T.done();
