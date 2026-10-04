// noise-notch-test.js — Unit tests for the persistent-peak tonal-
// interferer tracker + streaming notch (src/dsp/noise-notch.js).
// Corpus-level validation lives in scripts/noise-augment-oracle.js
// (--frontend=tracker); this file guards the module-level contracts:
// promotion timing, stability discrimination (hum vs moving voice),
// attenuation, demotion, the multi-notch cap, the onset-born promotion
// delay, seen-to-promote, stable cascade keying — and (end-to-end through
// the real pitch worker) that held notes are never blanked by the notch
// (measurements/noise-notch-voice-safety-2026-10-03.md).
//
// Usage: node tests/dsp/noise-notch-test.js

import { createNoiseNotch, NOTCH_DEFAULTS, isNearNotch } from "../../src/dsp/noise-notch.js";

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

// Deterministic held-note voice: harmonic source (H1-H2 = h1h2 dB, then
// -6 dB/oct), F0 = f0 * 2^((vib*sin(2*pi*5.5 t) + drift*t/dur)/1200) cents,
// seeded aspiration noise at -hnr dB, 1 s silence before the note and
// `post` s after. Returns { x, f0At(t) } with t in seconds from x[0].
function heldVoice({ f0, dur, vibCents = 0, driftCents = 0, h1h2 = 6, hnr = 25, amp = 0.15, pre = 1, post = 1, seed = 11 }) {
  const n = Math.round((pre + dur + post) * SR);
  const x = new Float32Array(n);
  const nh = Math.floor(3800 / f0);
  const A = [];
  for (let k = 1; k <= nh; k++) A.push(Math.pow(10, (k === 1 ? 0 : -h1h2 - 6 * Math.log2(k / 2)) / 20));
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 0x7fffffff - 1; };
  const centsAt = (tn) => vibCents * Math.sin(2 * Math.PI * 5.5 * tn) + driftCents * tn / dur;
  const f0At = (t) => (t < pre || t > pre + dur ? 0 : f0 * Math.pow(2, centsAt(t - pre) / 1200));
  let ph = 0;
  const noiseAmp = amp * Math.pow(10, -hnr / 20);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if (t < pre || t > pre + dur) continue;
    const tn = t - pre;
    const env = Math.min(1, tn / 0.05, (dur - tn) / 0.05);
    ph += 2 * Math.PI * f0At(t) / SR;
    let v = 0;
    for (let k = 0; k < nh; k++) v += A[k] * Math.sin((k + 1) * ph);
    x[i] = env * (amp * v / 2 + noiseAmp * rnd());
  }
  return { x, f0At };
}

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

// ---- 2026-10-03: voice-training safety (held notes) -------------------

// first time (s) an active notch sits within 4 % of k*f0 (k = 1..3)
function promotionTime(x, f0) {
  const n = createNoiseNotch(SR);
  for (let c = 0; c + CHUNK <= x.length; c += CHUNK) {
    n.process(Float32Array.from(x.subarray(c, c + CHUNK)));
    if (n.activeFreqs().some((f) => [1, 2, 3].some((k) => Math.abs(f / (k * f0) - 1) < 0.04))) return (c + CHUNK) / SR;
  }
  return null;
}

// a hold comfortably inside the onset-born promotion delay (20 s default)
const HOLD = 18;
console.log(`\nonset-born held notes: no promotion before onsetMinTrackSec (${HOLD} s holds)`);
for (const f0 of [120, 220]) {
  for (const [label, mod] of [["steady", {}], ["25 c vibrato", { vibCents: 25 }], ["15 c drift", { driftCents: 15 }]]) {
    const { x } = heldVoice({ f0, dur: HOLD, ...mod, seed: f0 + label.length });
    const t = promotionTime(x, f0);
    check(`${f0} Hz ${label}: not notched`, t === null, `promoted at ${t?.toFixed(1)} s`);
  }
}

console.log("\nonset re-birth: a note cannot adopt a young noise track");
{
  // a faint 220 Hz line (~-40 dB re the note) for 1.5 s, then the note:
  // the faint line's young track predates the onset and used to carry its
  // age (and its not-onset-born status) into the note -> notched ~5 s in
  const { x } = heldVoice({ f0: 220, dur: HOLD - 2, pre: 1.5, seed: 5 });
  for (let i = 0; i < 1.5 * SR; i++) x[i] += 0.0015 * Math.sin(2 * Math.PI * 220 * i / SR);
  const t = promotionTime(x, 220);
  check("note over a faint precursor: not notched", t === null, `promoted at ${t?.toFixed(1)} s`);
}

console.log("\nbackground hum vs hum that starts mid-session");
{
  // present from the first observation (no onset): ~5 s, as before
  const x = new Float32Array(10 * SR);
  for (let i = 0; i < x.length; i++) x[i] = 0.05 * Math.sin(2 * Math.PI * 120 * i / SR);
  const t = promotionTime(x, 120);
  check("steady background hum promoted within ~5.6 s", t !== null && t <= 5.6, `t=${t}`);
}
{
  // switches on after 3 s of near-silence: onset-born -> onsetMinTrackSec
  const x = new Float32Array(25 * SR);
  for (let i = 3 * SR; i < x.length; i++) x[i] = 0.05 * Math.sin(2 * Math.PI * 120 * i / SR);
  const t = promotionTime(x, 120);
  check(`hum switching on mid-session promoted after ~${NOTCH_DEFAULTS.onsetMinTrackSec} s, not 5 s`,
    t !== null && t - 3 >= NOTCH_DEFAULTS.onsetMinTrackSec - 0.5 && t - 3 <= NOTCH_DEFAULTS.onsetMinTrackSec + 1.5, `t-3=${t && (t - 3).toFixed(1)}`);
}

console.log("\nseen-to-promote: a tone that just stopped never promotes");
{
  // 4.8 s tone from t=0 then silence: the track reaches minTrackSec of
  // span ~0.7 s after the tone left the 512 ms observation window, with
  // duty still >= 0.9 — which used to promote it on silence
  const x = new Float32Array(9 * SR);
  for (let i = 0; i < 4.8 * SR; i++) x[i] = 0.05 * Math.sin(2 * Math.PI * 150 * i / SR);
  const t = promotionTime(x, 150);
  check("no promotion after the tone ended", t === null, `promoted at ${t?.toFixed(2)} s`);
}

console.log("\nstable cascade keying: wobbling hum, no rebuild transients");
{
  // 120 Hz +-0.6 Hz wobble (slow fan-speed drift) + 2nd harmonic: the old
  // freq.toFixed(0) key rebuilt (state-reset) the cascade on every 1 Hz
  // rounding crossing -> leak spikes up to +16 dB over the steady residual
  const n = createNoiseNotch(SR);
  let ph = 0, s = 7;
  const res = [];
  for (let c = 0; c < 120 * SR / CHUNK; c++) {
    const chunk = new Float32Array(CHUNK);
    for (let i = 0; i < CHUNK; i++) {
      const t = (c * CHUNK + i) / SR;
      ph += 2 * Math.PI * (120 + 0.6 * Math.sin(2 * Math.PI * 0.05 * t) + 0.18 * Math.sin(2 * Math.PI * 0.135 * t)) / SR;
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      chunk[i] = 0.03 * (Math.sin(ph) + 0.3 * Math.sin(2 * ph + 1)) + 0.001 * (s / 0x7fffffff - 1);
    }
    n.process(chunk);
    if (c * CHUNK / SR >= 20) res.push(rms(chunk) ** 2);
  }
  const med = [...res].sort((a, b) => a - b)[Math.floor(res.length / 2)];
  const maxDb = 10 * Math.log10(Math.max(...res) / med);
  check("max post-notch chunk power < +10 dB over steady residual", maxDb < 10, `max ${maxDb.toFixed(1)} dB`);
}

console.log("\nisNearNotch (narrow, track-referenced ghost veto)");
{
  const L = [{ freq: 120, dev: 0.02 }];
  check("at the line", isNearNotch(120, L) === true);
  check("within 2 % of the line", isNearNotch(122.3, L) === true);
  check("3 % off the line: voice kept", isNearNotch(123.6, L) === false);
  check("at the line's octave", isNearNotch(241, L) === true);
  check("half the line: voice kept", isNearNotch(60.5, L) === false);
  check("5 % below the octave: voice kept", isNearNotch(228, L) === false);
  check("wobbling line widens the window (dev 0.6 Hz -> +-3.6 Hz)", isNearNotch(123.4, [{ freq: 120, dev: 0.6 }]) === true);
  check("bare numbers accepted", isNearNotch(119, [120]) === true && isNearNotch(126, [120]) === false);
  check("no active lines", isNearNotch(120, []) === false);
}

// End-to-end: the REAL pitch worker (notch -> AC -> tracker -> ghost
// veto -> harmonic guard) must keep reporting held notes at 120 / 220 Hz
// with <= 25 c vibrato or <= 15 c drift, modal and breathy (production
// before 2026-10-03: notched ~5 s in, then blanked by the ghost veto).
// Drives pitch-worker.js in-process with a fake worker `self` at 16 kHz.
console.log(`\nheld notes stay on the trace (real pitch worker, ${HOLD} s holds)`);
{
  const posts = [];
  globalThis.self = { postMessage: (m) => posts.push(m) };
  await import("../../src/dsp/pitch-worker.js");
  const worker = globalThis.self;
  async function workerRun(x) {
    posts.length = 0;
    worker.onmessage({ data: { type: "init", inputSampleRate: SR } });
    const port = {};
    worker.onmessage({ data: { type: "audioPort", port } });
    for (let c = 0; c + CHUNK <= x.length; c += CHUNK) {
      const chunk = Float32Array.from(x.subarray(c, c + CHUNK));
      port.onmessage({ data: { buffer: chunk.buffer, contextTime: (c + CHUNK) / SR } });
    }
    return posts.filter((p) => p.type === "pitch");
  }
  for (const f0 of [120, 220]) {
    for (const [label, mod] of [["25 c vibrato", { vibCents: 25 }], ["15 c drift", { driftCents: 15 }], ["steady, breathy", { h1h2: 12, hnr: 12 }]]) {
      const { x, f0At } = heldVoice({ f0, dur: HOLD, ...mod, seed: 3 * f0 + label.length });
      const msgs = await workerRun(x);
      let n = 0, ok = 0, notchedSeen = false;
      for (const m of msgs) {
        // posted pitch describes the 80 ms frame centred 40 ms before
        // the end of its chunk (contextTime = end of that chunk)
        const t = m.contextTime - 0.04;
        if (t < 1.3 || t > HOLD + 0.9) continue;
        n++;
        if (m.pitch > 0 && Math.abs(m.pitch / f0At(t) - 1) < 0.08) ok++;
        if (m.notchedFreqs) notchedSeen = true;
      }
      check(`${f0} Hz ${label}: >= 95 % of hold frames reported at pitch`, ok / n >= 0.95,
        `${(100 * ok / n).toFixed(1)} % (notch ${notchedSeen ? "promoted" : "never promoted"})`);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
