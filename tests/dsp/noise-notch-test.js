// noise-notch-test.js — Unit tests for the persistent-peak tonal-
// interferer tracker + streaming notch (src/dsp/noise-notch.js).
// Corpus-level validation lives in scripts/noise-augment-oracle.js
// (--frontend=tracker); this file guards the module-level contracts:
// promotion timing, stability discrimination (hum vs moving voice),
// attenuation, demotion, and the multi-notch cap.
//
// Usage: node tests/dsp/noise-notch-test.js

import { createNoiseNotch, NOTCH_DEFAULTS } from "../../src/dsp/noise-notch.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`); }
}

const SR = 16000, CHUNK = 400;

// Feed `seconds` of signal from sampleFn(t) through the notch in
// 25 ms chunks; returns { out: concatenated output, notch }.
function run(notch, sampleFn, seconds, collectFrom = 0) {
  const chunks = Math.floor(seconds * SR / CHUNK);
  const collected = [];
  for (let c = 0; c < chunks; c++) {
    const chunk = new Float32Array(CHUNK);
    for (let i = 0; i < CHUNK; i++) {
      const t = (c * CHUNK + i) / SR;
      chunk[i] = sampleFn(t);
    }
    notch.process(chunk);
    if (c * CHUNK / SR >= collectFrom) collected.push(...chunk);
  }
  return Float32Array.from(collected);
}

const rms = (x) => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
};

console.log("promotion: steady 120 Hz hum");
{
  const n = createNoiseNotch(SR);
  run(n, (t) => 0.1 * Math.sin(2 * Math.PI * 120 * t), 4);
  check("not yet notched before minTrackSec", n.activeFreqs().length === 0,
    `active=${n.activeFreqs()}`);
  run(n, (t) => 0.1 * Math.sin(2 * Math.PI * 120 * t), 3);
  const f = n.activeFreqs();
  check("notched after ~5 s", f.length === 1 && Math.abs(f[0] - 120) < 3, `active=${f}`);
}

console.log("\nattenuation once active");
{
  const n = createNoiseNotch(SR);
  run(n, (t) => 0.1 * Math.sin(2 * Math.PI * 120 * t), 7);
  const out = run(n, (t) => 0.1 * Math.sin(2 * Math.PI * 120 * t), 2, 1);
  const inRms = 0.1 / Math.SQRT2;
  check("active hum attenuated > 20 dB", rms(out) < inRms * 0.1, `outRms=${rms(out).toFixed(4)}`);
}

console.log("\nvoice-band passthrough beside an active notch");
{
  const n = createNoiseNotch(SR);
  const hum = (t) => 0.1 * Math.sin(2 * Math.PI * 120 * t);
  run(n, hum, 7);
  // 200 Hz "voice" tone on top of the hum: must come through ~unity
  const out = run(n, (t) => hum(t) + 0.1 * Math.sin(2 * Math.PI * 200 * t), 2, 1);
  // out contains ~unity 200 Hz + heavily-notched 120 Hz ⇒ RMS ≈ single tone
  const oneTone = 0.1 / Math.SQRT2;
  check("200 Hz survives (RMS within 15 % of single-tone)",
    Math.abs(rms(out) - oneTone) < 0.15 * oneTone, `rms=${rms(out).toFixed(4)}`);
}

console.log("\nstability discrimination: moving F0 never notched");
{
  const n = createNoiseNotch(SR);
  // glide 100→140 Hz over 10 s (speech-scale prosody drift)
  run(n, (t) => 0.1 * Math.sin(2 * Math.PI * (100 + 4 * t) * t), 10);
  check("gliding tone not notched", n.activeFreqs().length === 0, `active=${n.activeFreqs()}`);
}
{
  const n = createNoiseNotch(SR);
  // 110 Hz with ±6 Hz vibrato at 5 Hz (held sung note)
  run(n, (t) => 0.1 * Math.sin(2 * Math.PI * 110 * t + (6 / 5) * Math.sin(2 * Math.PI * 5 * t)), 10);
  check("vibrato note not notched", n.activeFreqs().length === 0, `active=${n.activeFreqs()}`);
}

console.log("\ndemotion after the interferer stops");
{
  const n = createNoiseNotch(SR);
  run(n, (t) => 0.1 * Math.sin(2 * Math.PI * 120 * t), 7);
  check("active before stop", n.activeFreqs().length === 1);
  run(n, () => 0, 4); // silence
  check("demoted after missSec of absence", n.activeFreqs().length === 0, `active=${n.activeFreqs()}`);
}

console.log("\nharmonic stack: multiple notches, capped");
{
  const n = createNoiseNotch(SR);
  const stack = (t) =>
    0.08 * (Math.sin(2 * Math.PI * 60 * t) + Math.sin(2 * Math.PI * 120 * t) +
            Math.sin(2 * Math.PI * 180 * t) + Math.sin(2 * Math.PI * 240 * t) +
            Math.sin(2 * Math.PI * 300 * t));
  run(n, stack, 8);
  const f = n.activeFreqs();
  check(`notch count capped at ${NOTCH_DEFAULTS.maxNotches}`, f.length <= NOTCH_DEFAULTS.maxNotches && f.length >= 3,
    `active=${f}`);
}

console.log("\nno notches on clean-speech-like input (hum-free)");
{
  const n = createNoiseNotch(SR);
  // crude speech proxy: F0 random-walks 95–130 Hz with pauses
  let f0 = 110, seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  let phase = 0, lastT = 0;
  run(n, (t) => {
    if (t - lastT > 0.025) { f0 = Math.min(130, Math.max(95, f0 + 2 * rnd())); lastT = t; }
    phase += 2 * Math.PI * f0 / SR;
    const voiced = Math.floor(t / 1.5) % 2 === 0; // 1.5 s on / 1.5 s off
    return voiced ? 0.1 * Math.sin(phase) : 0;
  }, 12);
  check("no spurious notch on modulated voice", n.activeFreqs().length === 0, `active=${n.activeFreqs()}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
