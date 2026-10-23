// denoise-eval.mjs — Voice Shaper's background-noise reduction, measured through the REAL engine
// (measurements/voice-shaper-denoise-2026-10-23.md): the three committed LibriSpeech clips
// (CC BY 4.0, tests/resonance-lab/fixtures/) at 48 kHz with their posted pitch tracks
// (tests/voice-preview/fixtures/spike-parity.json), mixed with seeded synthetic noise (white,
// pink, a 120 Hz fan hum over rumble) at 0 / 10 / 20 dB SNR, then the engine's unchanged rebuild
// (WORLD, 0 st, 0 %) of: the noisy recording; the old RNNoise model (the package's separate
// dist/rnnoise.wasm, 2022 build); RNNoise 0.2 (the shipped module). Scored against the rebuild
// of the clean recording:
//   LSD    log-spectral distance on speech frames (20 ms Hann, 100 Hz–8 kHz, each frame's bins
//          floored 40 dB below the clean frame's peak), dB — lower is closer to the clean rebuild
//   pause  level of the rebuild in the clean recording's pauses, dB re its active speech
//   clean  LSD of the rebuild of the CLEAN recording run through each model (what it costs a
//          clean voice)
// plus each model's output delay, initial memory and CPU per audio second (Node).
//
//   node scripts/voice-preview/denoise-eval.mjs [--json=<out>]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorld, makeInput, PARITY_JSON } from "../../tests/voice-preview/vp-test-lib.js";
import { PreviewEngine } from "../../src/voice-preview/engine/preview.js";
import { createRnnoise, RNNOISE_DELAY } from "../../src/voice-preview/denoise.js";
import { OUT as SHIPPED, PACKAGE_DIR } from "./extract-rnnoise.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");

// The old build's export names (Module["asm"] in the package's dist/rnnoise.js) and its delay
// (one frame, measured below); the loader is the shipped one with those names swapped in.
const OLD = { exports: { ctors: "d", create: "f", malloc: "g", destroy: "h", free: "i", process: "j" }, delay: 480 };
function oldModel() {
  const bytes = readFileSync(path.join(PACKAGE_DIR, "dist", "rnnoise.wasm"));
  let memory;
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { a: {
    a: (req) => { const want = req >>> 0, have = memory.buffer.byteLength; if (want <= have) return 1; try { memory.grow(Math.ceil((want - have) / 65536)); return 1; } catch { return 0; } },
    b: (d, s, n) => { new Uint8Array(memory.buffer).copyWithin(d, s, s + n); },
  } });
  const e = inst.exports;
  memory = e.c;
  const f = Object.fromEntries(Object.entries(OLD.exports).map(([k, v]) => [k, e[v]]));
  f.ctors();
  return {
    memoryBytes: () => memory.buffer.byteLength,
    denoise48(x, delay = OLD.delay) {
      const st = f.create(0), pin = f.malloc(1920), pout = f.malloc(1920);
      const y = new Float32Array(x.length);
      for (let k = 0; k < x.length + delay; k += 480) {
        let h = new Float32Array(memory.buffer, pin, 480);
        for (let i = 0; i < 480; i++) h[i] = k + i < x.length ? x[k + i] * 32768 : 0;
        f.process(st, pout, pin);
        h = new Float32Array(memory.buffer, pout, 480);
        for (let i = 0; i < 480; i++) { const j = k + i - delay; if (j >= 0 && j < x.length) y[j] = h[i] / 32768; }
      }
      f.free(pin); f.free(pout); f.destroy(st);
      return y;
    },
  };
}

let seed = 99;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296 * 2 - 1; };
const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
const unit = (x) => { const r = rms(x); return x.map((v) => v / r); };
const NOISE = {
  white: (n) => unit(Float32Array.from({ length: n }, rnd)),
  pink: (n) => { let b0 = 0, b1 = 0, b2 = 0; return unit(Float32Array.from({ length: n }, () => { const w = rnd(); b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; return b0 + b1 + b2 + w * 0.1848; })); },
  fan: (n) => { let lp = 0; return unit(Float32Array.from({ length: n }, (_, i) => { const t = i / 48000; lp += 0.0195 * (rnd() - lp); return Math.sin(2 * Math.PI * 120 * t) + 0.25 * Math.sin(2 * Math.PI * 240 * t + 1.1) + 0.12 * Math.sin(2 * Math.PI * 360 * t + 2.3) + 2.2 * lp; })); },
};
const F = 960;
const frames = (x) => { const e = []; for (let k = 0; k + F <= x.length; k += F) e.push(rms(x.subarray(k, k + F))); return e; };
function activeRms(x) { const e = frames(x); const mx = Math.max(...e); const a = e.filter((v) => v > mx * 0.01); return Math.sqrt(a.reduce((t, v) => t + v * v, 0) / a.length); }
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const c = Math.cos(a * k), s = Math.sin(a * k), p = i + k, q = p + len / 2;
      const vr = re[q] * c - im[q] * s, vi = re[q] * s + im[q] * c;
      re[q] = re[p] - vr; im[q] = im[p] - vi; re[p] += vr; im[p] += vi;
    }
  }
}
function logSpec(x, k0) {
  const re = new Float64Array(2048), im = new Float64Array(2048);
  for (let i = 0; i < F; i++) re[i] = x[k0 + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / F));
  fft(re, im);
  const o = [];
  for (let b = Math.round(100 / 48000 * 2048); b < Math.round(8000 / 48000 * 2048); b++) o.push(10 * Math.log10(re[b] * re[b] + im[b] * im[b] + 1e-12));
  return o;
}
function score(ref, y, speech) {
  let lsd = 0, n = 0;
  const pe = [];
  for (let f = 0; f < speech.length; f++) {
    if (speech[f]) {
      const a = logSpec(ref, f * F), b = logSpec(y, f * F);
      const fl = Math.max(...a) - 40;
      let d = 0;
      for (let i = 0; i < a.length; i++) d += (Math.max(a[i], fl) - Math.max(b[i], fl)) ** 2;
      lsd += Math.sqrt(d / a.length); n++;
    } else pe.push(rms(y.subarray(f * F, f * F + F)));
  }
  return { lsd: lsd / n, pauseDb: pe.length ? 20 * Math.log10(Math.sqrt(pe.reduce((t, v) => t + v * v, 0) / pe.length) / activeRms(ref)) : null };
}
function lagOf(x, y, maxLag) {
  let best = 0, bv = -Infinity;
  for (let d = 0; d <= maxLag; d++) { let c = 0; for (let i = 0; i + d < y.length; i += 2) c += x[i] * y[i + d]; if (c > bv) { bv = c; best = d; } }
  return best;
}

const par = JSON.parse(readFileSync(PARITY_JSON, "utf8"));
const eng = new PreviewEngine(await loadWorld("simd"));
const models = { old: oldModel(), v02: createRnnoise(readFileSync(SHIPPED)) };
const den = { old: (x) => models.old.denoise48(x), v02: (x) => models.v02.denoise48(x) };
const rebuild = (x, track) => eng.analyse(x, 48000, track).rebuild;

// delay (uncompensated) and CPU, on the first clip
const probe = makeInput({ clip: "ls_woman_high", rate: 48000 }).pcm;
const info = {};
for (const k of Object.keys(models)) {
  const raw = k === "old" ? models.old.denoise48(probe, 0) : (() => { const y = models.v02.denoise48(probe); const z = new Float32Array(probe.length); z.set(y.subarray(0, probe.length - RNNOISE_DELAY), RNNOISE_DELAY); return z; })();
  const t0 = performance.now();
  for (let i = 0; i < 3; i++) den[k](probe);
  const ms = (performance.now() - t0) / 3;
  info[k] = { delay: lagOf(probe, raw, 1200), memMB: models[k].memoryBytes() / 1048576, msPerAudioS: ms / (probe.length / 48000) };
}
console.log("model  delay (samples @48k)  initial memory  CPU per audio s (Node)");
for (const [k, v] of Object.entries(info)) console.log(`${k.padEnd(6)} ${String(v.delay).padStart(6)}  ${v.memMB.toFixed(1).padStart(8)} MB  ${v.msPerAudioS.toFixed(1).padStart(6)} ms`);

const rows = [];
const cleanRows = [];
for (const clip of ["ls_woman_high", "ls_man_low", "ls_man_hi8_f105"]) {
  const inp = par.inputs.find((i) => i.name === `${clip}@48000`);
  const track = Float32Array.from(inp.track);
  const { pcm } = makeInput({ clip, rate: 48000 });
  const ref = rebuild(pcm, track);
  const e = frames(pcm); const mx = Math.max(...e); const speech = e.map((v) => v > mx * 0.05);
  const c = { clip, pauseShare: speech.filter((v) => !v).length / speech.length, ref: score(ref, ref, speech) };
  for (const k of Object.keys(models)) c[k] = score(ref, rebuild(den[k](pcm), track), speech);
  cleanRows.push(c);
  for (const [nt, gen] of Object.entries(NOISE)) {
    const nz = gen(pcm.length);
    for (const snr of [0, 10, 20]) {
      const g = activeRms(pcm) / 10 ** (snr / 20);
      const mixd = pcm.map((v, i) => v + g * nz[i]);
      const r = { clip, noise: nt, snr, raw: score(ref, rebuild(mixd, track), speech) };
      for (const k of Object.keys(models)) r[k] = score(ref, rebuild(den[k](mixd), track), speech);
      rows.push(r);
    }
  }
}
const f1 = (v) => (v == null ? "  —  " : v.toFixed(1).padStart(5));
console.log("\nclean recording through each model: LSD vs the clean rebuild (dB)");
for (const c of cleanRows) console.log(`  ${c.clip.padEnd(16)} pauses ${(100 * c.pauseShare).toFixed(0).padStart(2)} %   old ${c.old.lsd.toFixed(2)}   v0.2 ${c.v02.lsd.toFixed(2)}`);
console.log("\nnoisy recordings: LSD on speech frames (dB) | pause level (dB re speech)");
console.log("  clip             noise snr |   raw   old  v0.2 |   raw   old  v0.2");
for (const r of rows) console.log(`  ${r.clip.padEnd(16)} ${r.noise.padEnd(5)} ${String(r.snr).padStart(3)} | ${f1(r.raw.lsd)} ${f1(r.old.lsd)} ${f1(r.v02.lsd)} | ${f1(r.raw.pauseDb)} ${f1(r.old.pauseDb)} ${f1(r.v02.pauseDb)}`);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const by = (pred) => rows.filter(pred);
console.log("\nmeans");
for (const [label, sel] of [["all 27", () => true], ...["white", "pink", "fan"].map((n) => [n, (r) => r.noise === n]), ...[0, 10, 20].map((s) => [`${s} dB`, (r) => r.snr === s])]) {
  const rs = by(sel);
  const p = rs.filter((r) => r.raw.pauseDb != null);
  console.log(`  ${label.padEnd(7)} LSD raw ${mean(rs.map((r) => r.raw.lsd)).toFixed(2)} old ${mean(rs.map((r) => r.old.lsd)).toFixed(2)} v0.2 ${mean(rs.map((r) => r.v02.lsd)).toFixed(2)}`
    + `   pause raw ${mean(p.map((r) => r.raw.pauseDb)).toFixed(1)} old ${mean(p.map((r) => r.old.pauseDb)).toFixed(1)} v0.2 ${mean(p.map((r) => r.v02.pauseDb)).toFixed(1)}`
    + `   v0.2 worse than raw: ${rs.filter((r) => r.v02.lsd > r.raw.lsd).length} / ${rs.length}`);
}
const cleanPause = cleanRows.filter((c) => c.ref.pauseDb != null).map((c) => c.ref.pauseDb);
console.log(`  clean rebuild's own pause level: ${cleanPause.map((v) => v.toFixed(1)).join(" / ")} dB`);
const out = arg("json", "");
if (out) writeFileSync(out, JSON.stringify({ info, cleanRows, rows }, null, 1));
