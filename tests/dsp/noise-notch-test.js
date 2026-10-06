// noise-notch-test.js — Unit tests for the persistent-peak tonal-
// interferer tracker + streaming notch (src/dsp/noise-notch.js).
// Corpus-level validation lives in scripts/noise-augment-oracle.js
// (--frontend=tracker); this file guards the module-level contracts:
// promotion timing, stability discrimination (hum vs moving voice),
// attenuation, demotion, the multi-notch cap, the onset-born promotion
// delay, seen-to-promote, stable cascade keying — and (end-to-end through
// the real pitch worker) that held notes are never blanked by the notch
// (measurements/noise-notch-voice-safety-2026-10-03.md), the 2026-10-04
// held-note gaps as KNOWN LIMITATION lines, and interferer regression
// guards against every held-note rule tried since (6f8be18's latch, round
// 1, round 2: measurements/noise-notch-held-note-robustness-2026-10-04.md),
// and (2026-10-05) the voice-vs-machine line verdict: voice-timed glides /
// speech -> hold / early phonation, its interferer guards, and REAL
// recordings (tests/dsp/data/notch-real/: an MS-SNSD air conditioner, CC0;
// VocalSet long tones and PVQD sustained vowels, CC BY 4.0;
// measurements/noise-notch-voice-discrimination-2026-10-05.md); its
// follow-up adds 75-80 Hz voices, crescendos / messa di voce at a hold's
// start (synthetic and real) and a later takeover guard case; its fix round
// (2026-10-06) adds vowel changes and a settle-then-swell on not-onset-born
// holds, a voice centred on the 75 Hz floor, and the voice-like machine (a
// harmonic stack with shared in-band speed wobble) as a bounded-cost guard.
//
// Usage: node tests/dsp/noise-notch-test.js

import { readFileSync } from "node:fs";
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
const posts = [];
globalThis.self = { postMessage: (m) => posts.push(m) };
await import("../../src/dsp/pitch-worker.js");
const worker = globalThis.self;
function workerRun(x) {
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
console.log(`\nheld notes stay on the trace (real pitch worker, ${HOLD} s holds)`);
{
  for (const f0 of [120, 220]) {
    for (const [label, mod] of [["25 c vibrato", { vibCents: 25 }], ["15 c drift", { driftCents: 15 }], ["steady, breathy", { h1h2: 12, hnr: 12 }]]) {
      const { x, f0At } = heldVoice({ f0, dur: HOLD, ...mod, seed: 3 * f0 + label.length });
      const msgs = workerRun(x);
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

// ---- 2026-10-04: held-note robustness
// The 2026-10-03 onset-born rule keys on "first seen AT an onset". Routine
// exercise shapes that escape it are notched ~5 s in, then blanked by the
// ghost veto (real worker, measurements/noise-notch-held-note-robustness-
// 2026-10-04.md): a hold that slides / steps > matchHz mid-note, speech
// running into a hold with < 0.3 s gaps, phonation starting in the stream's
// first observation window, and repeated same-pitch holds with breaths.
// Three rule sets that closed some of these were built and reverted
// (6f8be18's in-sound latch; round 1's breath re-birth + glide handoff;
// round 2's quiet-window breath re-birth): each delayed or blocked a real
// interferer — round 2's only failure is a tonal source that itself cuts
// out for 0.15-1 s every few seconds, which is signal-identical to repeated
// steady holds. On bc42ad0 all four shapes were KNOWN LIMITATIONS. Since
// 2026-10-05 the first three are closed for voices that carry shared
// modulation (vibrato / wander) by the line-coherence voice timing (checks
// below); repeated holds with breaths stay a known limitation. The
// interferer guards below keep any held-note rule honest. Synthesized here
// over a -70 dB noise floor.

// voiceTrack({ dur, f0At(t) -> Hz | 0, ampAt(t) -> [0,1], h1h2, hnr, vibCents,
// wanderCents, seed }): harmonic source as heldVoice, 5.5 Hz vibrato,
// optional F0 wander (Ornstein-Uhlenbeck, 0.5 s time constant, rms
// wanderCents — every real voice measured carries >= ~2.3 c of it,
// measurements/notch-voice-machine-discrimination-2026-10-05.md), aspiration
// noise, -70 dB floor everywhere.
function voiceTrack({ dur, f0At, ampAt, h1h2 = 6, hnr = 25, vibCents = 15, wanderCents = 0, amp = 0.15, seed = 11, h1At = null }) {
  const n = Math.round(dur * SR);
  const x = new Float32Array(n);
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 0x7fffffff - 1; };
  let w = (seed * 7919) >>> 0 || 1;
  const rndW = () => { w ^= w << 13; w >>>= 0; w ^= w >> 17; w ^= w << 5; w >>>= 0; return w / 0x7fffffff - 1; };
  const ouA = Math.exp(-1 / (0.5 * SR)), ouS = wanderCents * Math.sqrt(3) * Math.sqrt(1 - ouA * ouA);
  let ou = 0;
  const noiseAmp = amp * Math.pow(10, -hnr / 20);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f0 = f0At(t), a = ampAt(t);
    if (wanderCents > 0) ou = ouA * ou + ouS * rndW();
    let v = 0;
    if (f0 > 0 && a > 0) {
      ph += 2 * Math.PI * f0 * Math.pow(2, (vibCents * Math.sin(2 * Math.PI * 5.5 * t) + ou) / 1200) / SR;
      const nh = Math.floor(3800 / f0);
      for (let k = 1; k <= nh; k++) v += (k === 1 && h1At ? Math.pow(10, h1At(t) / 20) : 1) * Math.pow(10, (k === 1 ? 0 : -h1h2 - 6 * Math.log2(k / 2)) / 20) * Math.sin(k * ph);
      v = a * (amp * v / 2 + noiseAmp * rnd());
    }
    x[i] = v + 0.0003 * rnd();
  }
  return x;
}
const ramp = (t, a, b, r = 0.05) => (t < a || t > b ? 0 : Math.max(0, Math.min(1, (t - a) / r, (b - t) / r)));
// speech-like syllables in [a, b): 0.12-0.3 s, F0 random-walking +-4 st
// around `center` with a +-2 st contour per syllable, 40-120 ms gaps
function syllables(a, b, center, seed) {
  let s = seed;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 0xffffffff; };
  const out = []; let t = a, st = 0;
  while (t < b - 0.1) {
    const e = Math.min(b, t + 0.12 + 0.18 * rnd());
    st = Math.max(-4, Math.min(4, st + (rnd() - 0.5) * 3));
    out.push({ a: t, b: e, f: center * Math.pow(2, st / 12), c: (rnd() - 0.5) * 4 });
    t = e + 0.04 + 0.08 * rnd();
  }
  out[out.length - 1].b = b;
  return out;
}
function holdScore(msgs, f0At, spans) {
  let n = 0, ok = 0, notched = false;
  for (const m of msgs) {
    const t = m.contextTime - 0.04;
    if (m.notchedFreqs) notched = true;
    if (!spans.some(([a, b]) => t >= a + 0.3 && t <= b - 0.1)) continue;
    n++;
    if (m.pitch > 0 && Math.abs(m.pitch / f0At(t) - 1) < 0.08) ok++;
  }
  return { pct: 100 * ok / n, notched };
}
// known limitation: report the measured value, never fail
const knownLimit = (name, r) => console.log(`  · KNOWN LIMITATION ${name}: ${r.pct.toFixed(1)} % of hold frames at pitch${r.notched ? ", notch promoted" : ", never notched"}`);

// ---- 2026-10-05: voice vs machine lines (line coherence) ----------------
// A voice's partials wander together; a machine line has no mid-band FM
// shared with its own 2nd partial. A voice-confirmed line that was not born
// at an onset gets the onset-born 20 s clock (measurements/noise-notch-
// voice-discrimination-2026-10-05.md), which closes three of the 2026-10-04
// gaps for any voice carrying vibrato or wander: a glide / step mid-hold,
// speech running straight into a hold, phonation in the stream's first
// observation windows. bc42ad0 notched all three ~5 s in (45-74 % of hold
// frames reported). Each case below is also run with OU wander only (no
// vibrato), the minimum every real voice measured carries.
const HELD_MIN = 95;
console.log("\nmid-hold glide / step: the moved line is voice-timed (real worker)");
for (const [label, f0b, g] of [["220 -> 228 Hz glide (1.5 s) after 4 s", 228, 1.5], ["220 -> 224 Hz step after 4 s", 224, 0.05], ["180 -> 186 Hz glide (1 s) after 4 s", 186, 1]]) {
  const f0a = label.startsWith("180") ? 180 : 220;
  const c = 1200 * Math.log2(f0b / f0a);
  const f0At = (t) => (t < 1 || t > 17 ? 0 : f0a * Math.pow(2, (t < 5 ? 0 : t < 5 + g ? c * (t - 5) / g : c) / 1200));
  for (const [vl, mod] of [["15 c vibrato", {}], ["10 c vibrato + 3 c wander", { vibCents: 10, wanderCents: 3 }], ["3 c wander, no vibrato", { vibCents: 0, wanderCents: 3 }]]) {
    const x = voiceTrack({ dur: 18, f0At, ampAt: (t) => ramp(t, 1, 17), seed: f0b, ...mod });
    const r = holdScore(workerRun(x), f0At, [[1, 17]]);
    // 3 c of slow wander alone leaves < 2.5 c of shared 0.5-8 Hz modulation:
    // no voice verdict, bc42ad0 timing (known)
    if (mod.vibCents === 0) knownLimit(`${label}, ${vl} (too little shared modulation for a voice verdict)`, r);
    else check(`${label}, ${vl}: >= ${HELD_MIN} % of hold frames at pitch`, r.pct >= HELD_MIN, `${r.pct.toFixed(1)} %${r.notched ? ", notch promoted" : ""}`);
  }
}

console.log("\nspeech running straight into a hold: the hold's line is voice-timed (real worker)");
for (const gap of [0, 0.06]) for (const [f0, h1h2, hnr] of [[220, 6, 25], [120, 12, 12]]) {
  const syl = syllables(1, 4, f0, 7 + f0);
  const h0 = 4 + gap;
  const f0At = (t) => {
    if (t >= h0 && t <= h0 + 12) return f0;
    const q = syl.find((y) => t >= y.a && t <= y.b);
    return q ? q.f * Math.pow(2, q.c * ((t - q.a) / (q.b - q.a) - 0.5) / 12) : 0;
  };
  const ampAt = (t) => (t >= h0 ? ramp(t, h0, h0 + 12, gap ? 0.05 : 0.02) : (syl.some((y) => t >= y.a && t <= y.b) ? ramp(t, syl.find((y) => t >= y.a && t <= y.b).a, syl.find((y) => t >= y.a && t <= y.b).b, 0.02) : 0));
  const name = `3 s speech, ${gap * 1000} ms gap, 12 s hold at ${f0} Hz${h1h2 > 6 ? " (breathy)" : ""}`;
  const r = holdScore(workerRun(voiceTrack({ dur: h0 + 13, f0At, ampAt, h1h2, hnr, seed: 31 + f0 })), f0At, [[h0, h0 + 12]]);
  // a breathy synthetic note (H1-H2 12 dB, HNR 12 dB) has a 2nd partial too
  // noisy for a voice verdict at 0.7 / 2.5 c: bc42ad0 timing (known)
  if (h1h2 > 6) knownLimit(`${name} (2nd partial too noisy for a voice verdict)`, r);
  else check(`${name}: >= ${HELD_MIN} % of hold frames at pitch`, r.pct >= HELD_MIN, `${r.pct.toFixed(1)} %${r.notched ? ", notch promoted" : ""}`);
}

console.log("\nphonation 0.15 s after the stream starts: the first line is voice-timed (real worker)");
for (const f0 of [120, 220]) {
  const f0At = (t) => (t >= 0.15 && t <= 16.15 ? f0 : 0);
  const r = holdScore(workerRun(voiceTrack({ dur: 17, f0At, ampAt: (t) => ramp(t, 0.15, 16.15, 0.02), seed: 5 + f0 })), f0At, [[0.15, 16.15]]);
  check(`${f0} Hz, 16 s hold from t = 0.15 s: >= ${HELD_MIN} % of hold frames at pitch`, r.pct >= HELD_MIN, `${r.pct.toFixed(1)} %${r.notched ? ", notch promoted" : ""}`);
}

// ---- 2026-10-05 follow-up (review of V14; measurements/noise-notch-voice-
// discrimination-2026-10-05.md "Follow-up") -----------------------------------
// (1) The coherence band starts at the display / detector floor (75 Hz):
// V14 measured lines from 80 Hz only, so a 75-80 Hz voice got no verdict and
// was notched 5.45 s in (31.7 % of hold frames), as on bc42ad0 — very low
// voices are in scope (gender symmetry).
console.log("\nvery low voices: phonation from the stream's start at 76-79 Hz (real worker)");
for (const [f0, t0] of [[77, 0], [77, 0.15], [76, 0.15], [79, 0]]) {
  const f0At = (t) => (t >= t0 && t <= t0 + 16 ? f0 : 0);
  const r = holdScore(workerRun(voiceTrack({ dur: t0 + 17, f0At, ampAt: (t) => ramp(t, t0, t0 + 16, 0.02), vibCents: 10, wanderCents: 3, seed: 3 * f0 + 10 * t0 })), f0At, [[t0, t0 + 16]]);
  check(`${f0} Hz, 16 s hold from t = ${t0} s (10 c vibrato + 3 c wander): >= ${HELD_MIN} % of hold frames at pitch`, r.pct >= HELD_MIN, `${r.pct.toFixed(1)} %${r.notched ? ", notch promoted" : ""}`);
}
{
  const f0At = (t) => (t >= 0.15 && t <= 16.15 ? 77 : 0);
  knownLimit("77 Hz from t = 0.15 s, 3 c wander, no vibrato (too little shared modulation for a voice verdict)",
    holdScore(workerRun(voiceTrack({ dur: 17, f0At, ampAt: (t) => ramp(t, 0.15, 16.15, 0.02), vibCents: 0, wanderCents: 3, seed: 231 })), f0At, [[0.15, 16.15]]));
}

// (2) The jump guard keys on a TAKEOVER, not on any rise: V14 refused voice
// timing to a line whose level rose >= 6 dB over its first 3 sightings, which
// is also what a crescendo or a messa di voce does at the start of a hold
// (measured on real PVQD sustained vowels from t ~ 0, below). Now: >= 6 dB
// within 6 observations over a level that held within 1.5 dB for 3
// consecutive sightings and was the line's loudest so far (within 3 dB) — a
// hum with a louder note starting on its track (case (l) below), which no
// constant-slope crescendo and no voice recovering from a dip matches.
console.log("\ncrescendo / messa di voce at the start of a not-onset-born hold (real worker)");
for (const f0 of [120, 220]) for (const [label, gDb] of [
  ["-12 -> 0 dB over 1 s", (u) => (u < 1 ? -12 + 12 * u : 0)],
  ["-10 -> 0 dB over 3 s", (u) => (u < 3 ? -10 + 10 * u / 3 : 0)],
  ["messa di voce -10 -> 0 -> -10 dB, 8 s period", (u) => -10 * Math.abs(Math.cos(Math.PI * u / 8))],
]) {
  const f0At = (t) => (t >= 0.15 && t <= 16.15 ? f0 : 0);
  const ampAt = (t) => ramp(t, 0.15, 16.15, 0.02) * Math.pow(10, gDb(t - 0.15) / 20);
  const r = holdScore(workerRun(voiceTrack({ dur: 17, f0At, ampAt, vibCents: 10, wanderCents: 3, seed: f0 + label.length })), f0At, [[0.15, 16.15]]);
  check(`${f0} Hz from t = 0.15 s, ${label}: >= ${HELD_MIN} % of hold frames at pitch`, r.pct >= HELD_MIN, `${r.pct.toFixed(1)} %${r.notched ? ", notch promoted" : ""}`);
}
// a voice that dips and recovers before its verdict (a held-out real /a/ fell
// 13 dB after its onset, steadied, then rose 7 dB in 0.4 s): its steady
// stretch is not the line's loudest so far, so it is no takeover (V16, which
// lacked that condition, notched it 5.45 s in: 31.7 %)
for (const f0 of [120, 220]) {
  const f0At = (t) => (t >= 0.15 && t <= 16.15 ? f0 : 0);
  const g = (u) => (u < 0.3 ? 0 : u < 1.3 ? -13 * (u - 0.3) : u < 2.0 ? -13 : u < 2.4 ? -13 + 17.5 * (u - 2.0) : Math.min(0, -6 + 15 * (u - 2.4)));
  const ampAt = (t) => ramp(t, 0.15, 16.15, 0.02) * Math.pow(10, g(t - 0.15) / 20);
  const r = holdScore(workerRun(voiceTrack({ dur: 17, f0At, ampAt, vibCents: 10, wanderCents: 3, seed: 11 * f0 })), f0At, [[0.15, 16.15]]);
  check(`${f0} Hz from t = 0.15 s, dips 13 dB after the onset and recovers: >= ${HELD_MIN} % of hold frames at pitch`, r.pct >= HELD_MIN, `${r.pct.toFixed(1)} %${r.notched ? ", notch promoted" : ""}`);
}
for (const f0 of [120, 220]) {
  // subito forte: 1 s at -8 dB, then +8 dB within 0.1 s — a steady line that
  // jumps, i.e. the takeover's own signal: bc42ad0's timing (known)
  const f0At = (t) => (t >= 0.15 && t <= 16.15 ? f0 : 0);
  const ampAt = (t) => ramp(t, 0.15, 16.15, 0.02) * Math.pow(10, (t < 1.15 ? -8 : t < 1.25 ? -8 + 80 * (t - 1.15) : 0) / 20);
  knownLimit(`${f0} Hz from t = 0.15 s, subito forte (+8 dB after 1 s at -8 dB) (takeover signal)`,
    holdScore(workerRun(voiceTrack({ dur: 17, f0At, ampAt, vibCents: 10, wanderCents: 3, seed: 7 * f0 })), f0At, [[0.15, 16.15]]));
}

// (3) Fix round (2026-10-06, measurements/noise-notch-voice-discrimination-
// 2026-10-05.md "Fix round"): a vowel change on a held pitch raises the 1st
// harmonic 6-13 dB within ~0.15 s (Hillenbrand 1995, within-talker /a/ -> /i/:
// median +10.7 dB for men, +12.9 dB for women), and a voice that settles
// after its attack and then swells rises over a steady level that is its
// loudest so far within 3 dB: both are the takeover test's signal, and V18
// notched them 5.45 s in (36-43 % of hold frames). The test now also needs
// the line NOT to have read as a voice before its steady level began. Before
// the line's first 1 s coherence window there is no such evidence, so a
// change in roughly the first 2 s of the line, and a fast crescendo after a
// steady soft start, keep bc42ad0's timing (known).
console.log("\nvowel change / swell on a not-onset-born hold (real worker)");
for (const f0 of [131, 220]) {
  const f0At = (t) => (t >= 0.15 && t <= 16.15 ? f0 : 0);
  const ampAt = (t) => ramp(t, 0.15, 16.15, 0.02);
  for (const [at, known] of [[2.5, false], [1.0, true]]) {
    const h1At = (t) => { const u = t - 0.15 - at; return u < 0 ? 0 : u < 0.15 ? 10 * u / 0.15 : 10; };
    const name = `${f0} Hz from t = 0.15 s, H1 +10 dB (a vowel change) ${at} s in`;
    const r = holdScore(workerRun(voiceTrack({ dur: 17, f0At, ampAt, h1At, vibCents: 10, wanderCents: 3, seed: 13 * f0 + 10 * at })), f0At, [[0.15, 16.15]]);
    if (known) knownLimit(`${name} (before the line's first coherence window)`, r);
    else check(`${name}: >= ${HELD_MIN} % of hold frames at pitch`, r.pct >= HELD_MIN, `${r.pct.toFixed(1)} %${r.notched ? ", notch promoted" : ""}`);
  }
  // attack at 0 dB for 0.6 s, settle 3 dB lower until 1.6 s, swell to +3.5 dB within 0.4 s
  const g = (u) => (u < 0.6 ? 0 : u < 0.9 ? -10 * (u - 0.6) : u < 1.6 ? -3 : u < 2.0 ? -3 + 16.25 * (u - 1.6) : 3.5);
  const r = holdScore(workerRun(voiceTrack({ dur: 17, f0At, ampAt: (t) => ampAt(t) * Math.pow(10, (g(t - 0.15) - 3.5) / 20), vibCents: 10, wanderCents: 3, seed: 17 * f0 })), f0At, [[0.15, 16.15]]);
  check(`${f0} Hz from t = 0.15 s, settles 3 dB after its attack, then +6.5 dB within 0.4 s: >= ${HELD_MIN} % of hold frames at pitch`, r.pct >= HELD_MIN, `${r.pct.toFixed(1)} %${r.notched ? ", notch promoted" : ""}`);
  // -12 dB held 0.5 s, then +12 dB/s: a steady line that jumps (known)
  const gc = (u) => (u < 0.5 ? -12 : u < 1.5 ? -12 + 12 * (u - 0.5) : 0);
  knownLimit(`${f0} Hz from t = 0.15 s, -12 dB for 0.5 s then a +12 dB/s crescendo (steady, then a takeover-like rise)`,
    holdScore(workerRun(voiceTrack({ dur: 17, f0At, ampAt: (t) => ampAt(t) * Math.pow(10, gc(t - 0.15) / 20), vibCents: 10, wanderCents: 3, seed: 19 * f0 })), f0At, [[0.15, 16.15]]));
}
// (4) a voice centred on the 75 Hz display floor: its line estimate wanders
// across 75.0 Hz, and V18 measured from exactly 75 Hz (the windows lost
// chunks, the verdict came late or never; notched 5.45 s in on some seeds).
// Now measured from 72 Hz (cohMarginHz): no notch on the voice's partials up
// to 400 Hz (its 6th, ~450 Hz, is never measured and keeps bc42ad0's timing).
// Voice timing is still granted only to a line inside 75-400 Hz (granting it
// in the margin delayed voice-like machines just outside the band, case (o)):
// seed 16's line estimate sits at 74.90-74.98 Hz, so it keeps bc42ad0's
// timing (known). The detector itself reports only the half of a 75.0 Hz
// vibrato above 75 Hz.
console.log("\na voice centred on the 75 Hz floor (real worker)");
for (const seed of [15, 16]) {
  const f0At = (t) => (t >= 0.15 && t <= 16.15 ? 75 : 0);
  const msgs = workerRun(voiceTrack({ dur: 17, f0At, ampAt: (t) => ramp(t, 0.15, 16.15, 0.02), vibCents: 10, wanderCents: 3, seed }));
  const hit = msgs.find((m) => m.notchedFreqs?.some((f) => [75, 150, 225, 300, 375].some((L) => Math.abs(f / L - 1) < 0.04)));
  const name = `75.0 Hz, 16 s hold from t = 0.15 s (seed ${seed})`;
  if (seed === 16) console.log(`  · KNOWN LIMITATION ${name} (line estimate 74.9 Hz, under the grant band): ${hit ? `notched ${hit.notchedFreqs} at ${hit.contextTime.toFixed(2)} s` : "never notched"}`);
  else check(`${name}: no notch on its partials up to 400 Hz`, !hit, hit ? `notched ${hit.notchedFreqs} at ${hit.contextTime.toFixed(2)} s` : "");
}

console.log("\nrepeated same-pitch holds separated by breaths (known limitation: one onset-born track spans the series, notched once it passes 20 s)");
for (const [label, breathNoiseDb, mod] of [["silent 0.5 s breaths", null, { vibCents: 0 }], ["0.5 s breaths with audible inhalation (-20 dB)", -20, { vibCents: 0 }], ["silent 0.5 s breaths, 10 c vibrato + 3 c wander", null, { vibCents: 10, wanderCents: 3 }]]) for (const f0 of [120, 220]) {
  const spans = [[1, 11], [11.5, 21.5], [22, 32]];
  const f0At = (t) => (spans.some(([a, b]) => t >= a && t <= b) ? f0 : 0);
  const x = voiceTrack({ dur: 33, f0At, ampAt: (t) => Math.max(...spans.map(([a, b]) => ramp(t, a, b))), seed: 17 + f0, ...mod });
  if (breathNoiseDb !== null) {
    let s = 99, hp = 0, prev = 0;
    const g = 0.15 / Math.SQRT2 * Math.pow(10, breathNoiseDb / 20) * Math.sqrt(3);
    for (const [a, b] of [[11, 11.5], [21.5, 22]]) for (let i = Math.floor(a * SR); i < b * SR; i++) {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      const w = s / 0x7fffffff - 1; hp = 0.9 * (hp + w - prev); prev = w;
      x[i] += ramp(i / SR, a, b) * g * hp;
    }
  }
  knownLimit(`${f0} Hz 3 x 10 s, ${label}`, holdScore(workerRun(x), f0At, spans));
}

// ---- 2026-10-05: interferer guards for the voice timing --------------------
// The voice verdict must not delay real interferers (strict rule vs bc42ad0;
// limits = bc42ad0's promotion time on this synthesis + 0.3 s, measured with
// the bc42ad0 module: (l) 5.45 / 5.45 s, (m) 21.45 s).
const VM_LIM = { l: 5.75, m: 21.75 };
console.log("\nvoice timing never holds back a hum (real worker)");
{
  const firstNotchNear = (msgs, after, lines) => {
    for (const m of msgs) if (m.contextTime > after && m.notchedFreqs?.some((f) => lines.some((L) => Math.abs(f / L - 1) < 0.03))) return m.contextTime - after;
    return null;
  };
  const humTrack = (n, fOf, a, on = 0) => {
    const x = new Float32Array(n); let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; if (t < on) continue; ph += 2 * Math.PI * fOf(t) / SR; x[i] = a * (Math.sin(ph) + 0.25 * Math.sin(2 * ph + 1.1) + 0.12 * Math.sin(3 * ph + 2.3)); }
    return x;
  };
  // (l) a hum present from t = 0 with a louder 120.5 Hz note on its track
  // (vibrato + wander), then the hum alone: the note makes the line voice-
  // like, but the line was a hum first — steady, then >= 6 dB up within 6
  // observations when the note took it over (the takeover test) -> no voice
  // timing; bc42ad0 notches it at 5.45 s. Notes at 1-5 s (rms 0.01 / 0.03:
  // the line rises ~16 / ~6-9 dB) and, 2026-10-05 follow-up, at 3-7 s over
  // an rms 0.02 hum (a 2.4 s steady stretch before the takeover)
  for (const [lvl, a, b] of [[0.01, 1, 5], [0.03, 1, 5], [0.02, 3, 7]]) {
    const f0At = (t) => (t >= a && t <= b ? 120.5 : 0);
    const v = voiceTrack({ dur: 25, f0At, ampAt: (t) => ramp(t, a, b, 0.06), vibCents: 10, wanderCents: 3, amp: 0.2, seed: 91 });
    const h = humTrack(v.length, () => 120, lvl * Math.SQRT2 / 1.032);
    const t = firstNotchNear(workerRun(Float32Array.from(v, (s, i) => s + h[i])), 0, [120]);
    check(`(l) hum (rms ${lvl}) under a ${b - a} s 120.5 Hz note on its track from ${a} s: notched by ${VM_LIM.l} s`, t !== null && t <= VM_LIM.l, `t=${t?.toFixed(2)}`);
  }
  // (m) a fan spinning up (90 -> 120 Hz, 1 s time constant) after switching
  // on in silence at 5 s, then steady, sparse speech from 10 s: the spin-up's
  // curvature reads as shared FM (voice-like) until the fan settles. Here
  // the line is onset-born (bc42ad0: 20 s); r2int.mjs --part=step spinup
  // covers the not-onset-born case, where an unrevoked voice timing turned
  // bc42ad0's 7.75 s into 21.45 s
  {
    const syl = syllables(10, 40, 210, 5);
    const sparse = (t) => ((t - 10) % 6) > 4.8;
    const f0At = (t) => { const q = syl.find((y) => t >= y.a && t <= y.b); return q && !sparse(t) ? q.f : 0; };
    const v = voiceTrack({ dur: 40, f0At, ampAt: (t) => (f0At(t) > 0 ? 1 : 0), vibCents: 0, amp: 0.12, seed: 93 });
    const fl = Float32Array.from({ length: v.length }, (_, i) => 0.001 * Math.sin(i * 1.3) * Math.sin(i * 0.77));
    const h = humTrack(v.length, (t) => 120 - 30 * Math.exp(-(t - 5) / 1.0), 0.01 * Math.SQRT2 / 1.032, 5);
    const t = firstNotchNear(workerRun(Float32Array.from(v, (s, i) => s + h[i] + fl[i])), 5, [110, 115, 120, 240]);
    check(`(m) fan spinning up 90 -> 120 Hz after switching on, sparse speech: notched by ${VM_LIM.m} s after switch-on`, t !== null && t <= VM_LIM.m, `t=${t?.toFixed(2)}`);
  }
  // (n) 2026-10-06 fix round: a VOICE-LIKE MACHINE — a harmonic stack whose
  // speed wobbles 5 c at 2 Hz, shared by every partial (a motor's speed
  // ripple), running from t = 0. Its line reads voice-confirmed, so it gets
  // the voice timing: bc42ad0 notches it at 5.45 s, the voice timing at
  // 20.45 s (scripts/notch-adversarial/vmach.mjs; ~2 % of real machine lines
  // behave like this). A KNOWN COST of the voice timing, printed; the guard
  // only bounds it: notched by the onset clock (20.45 s) + 0.3 s.
  for (const [f0, rate, cents] of [[120, 2, 5], [77, 2, 8], [73, 2, 8]]) {
    const n = 30 * SR, x = new Float32Array(n);
    let ph = 0, s = 5 + f0;
    for (let i = 0; i < n; i++) {
      const tt = i / SR;
      ph += 2 * Math.PI * f0 * Math.pow(2, cents * Math.sin(2 * Math.PI * rate * tt + 0.3) / 1200) / SR;
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      x[i] = 0.02 * (Math.sin(ph) + 0.5 * Math.sin(2 * ph + 0.7) + 0.3 * Math.sin(3 * ph + 1.4)) / Math.sqrt((1 + 0.25 + 0.09) / 2) + 0.0003 * (s / 0x7fffffff - 1);
    }
    const t = firstNotchNear(workerRun(x), 0, [f0]);
    if (f0 < 75) {
      // (o) the same machine at 73 Hz: outside the display band, inside the
      // coherence band's measurement margin — no voice timing there (a margin
      // that also granted it delayed it to 20.45 s): bc42ad0's 5.45 s + 0.3 s
      check(`(o) ${f0} Hz voice-like machine (in the measurement margin, below the display band): notched by 5.75 s`, t !== null && t <= 5.75, `t=${t?.toFixed(2)}`);
      continue;
    }
    console.log(`  · KNOWN COST (n) ${f0} Hz machine with a shared ${rate} Hz / ${cents} c speed wobble from t = 0: its fundamental notched at ${t === null ? "never" : t.toFixed(2) + " s"} (bc42ad0 5.45 s)`);
    check(`(n) ${f0} Hz voice-like machine from t = 0: notched by 20.75 s (the voice timing's bound)`, t !== null && t <= 20.75, `t=${t?.toFixed(2)}`);
  }
}

// ---- 2026-10-05: REAL recordings (tests/dsp/data/notch-real/, README there:
// MS-SNSD AirConditioner_10 excerpt, CC0; VocalSet long tones, CC BY 4.0) ----
function readPcm16(path) {
  const b = readFileSync(path);
  let off = 12;
  while (off < b.length - 8) {
    const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === "data") { const n = Math.floor(sz / 2), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = b.readInt16LE(off + 8 + 2 * i) / 32768; return x; }
    off += 8 + sz + (sz & 1);
  }
  throw new Error(`${path}: no data chunk`);
}
const REAL = new URL("./data/notch-real/", import.meta.url);
const ac = readPcm16(new URL("ac114.wav", REAL));
// its compressor stack: 114.6 Hz and harmonics (the excerpt's notched line is the 3rd)
const AC_LINES = [114.6, 229.2, 343.8];
// loop a clip to n samples with 20 ms crossfaded seams
function loopTo(x, n) {
  const F = Math.round(0.02 * SR), y = new Float32Array(n);
  let o = 0;
  while (o < n) {
    for (let i = 0; i < x.length && o + i < n; i++) {
      const g = o > 0 && i < F ? i / F : 1;
      y[o + i] = g * x[i] + (o > 0 && i < F ? (1 - g) * x[x.length - F + i] : 0);
    }
    o += x.length - F;
  }
  return y;
}
// three real notes back to back -> one continuous same-pitch phrase (30 ms
// crossfades), or with silent gaps
function notes(path, len) {
  const x = readPcm16(new URL(path, REAL)), L = Math.round(len * SR);
  return [0, 1, 2].map((k) => x.subarray(k * L, (k + 1) * L));
}
function chain(parts, gap, start) {
  const F = Math.round(0.03 * SR), G = Math.round(gap * SR);
  let n = Math.round(start * SR); const spans = [];
  const total = n + parts.reduce((a, p) => a + p.length + G, 0) + SR;
  const y = new Float32Array(total);
  parts.forEach((p, k) => {
    if (k > 0 && gap === 0) n -= F;
    const a = n;
    for (let i = 0; i < p.length; i++) {
      const env = Math.min(1, (i + 1) / F, (p.length - i) / F);
      y[n + i] += env * p[i];
    }
    spans.push([a / SR, (a + p.length) / SR]);
    n += p.length + G;
  });
  return { y, spans };
}
const realScore = (msgs, spans, f0) => holdScore(msgs, () => f0, spans);
console.log("\nreal recordings (real worker)");
{
  const firstNotchNear = (msgs, after, lines) => {
    for (const m of msgs) if (m.contextTime > after && m.notchedFreqs?.some((f) => lines.some((L) => Math.abs(f / L - 1) < 0.03))) return m.contextTime - after;
    return null;
  };
  // (r1) the real air conditioner alone (114.6 Hz compressor line), 40 s:
  // bc42ad0 notches it at 5.45 s
  const acLong = loopTo(ac, 40 * SR);
  const t1 = firstNotchNear(workerRun(acLong), 0, AC_LINES);
  check("(r1) real air-conditioner noise from t = 0: notched by 5.75 s", t1 !== null && t1 <= 5.75, `t=${t1?.toFixed(2)}`);
  // (r2) the same source switching fully off for 0.15 s every 5 s (the
  // signal of repeated holds with catch breaths; round 2's R8 never notched
  // it): bc42ad0 notches it ~20 s after it switches on
  {
    const n = 45 * SR, y = new Float32Array(n), g = Math.pow(10, -35 / 20) / Math.sqrt(acLong.reduce((a, v) => a + v * v, 0) / acLong.length);
    const src = loopTo(ac, n);
    let s = 3;
    for (let i = 0; i < n; i++) {
      const t = i / SR; let e = 0;
      if (t >= 2) { const u = (t - 2) % 5; e = u > 4.85 ? 0 : Math.min(1, u / 0.02, (4.85 - u) / 0.02, (t - 2) / 0.02); }
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      y[i] = e * g * src[i] + 3e-4 * Math.sqrt(3) * (s / 0x7fffffff - 1);
    }
    const t2 = firstNotchNear(workerRun(y), 2, AC_LINES);
    check("(r2) the real air conditioner cutting out 0.15 s every 5 s: notched by 20.55 s after switch-on", t2 !== null && t2 <= 20.55, `t=${t2?.toFixed(2)}`);
  }
  // (r3) a REAL long hold: one real VocalSet long tone (female2 straight /a/,
  // 262 Hz; male1 straight /e/, 128 Hz) looped 4x with 30 ms crossfades into
  // a 10-14 s hold (real F0 micro-variation; real corpus holds are 2-3.5 s,
  // too short for any notch), (a) with 3 s of speech-like syllables running
  // straight into it, (b) from t = 0.15 s. Only the 128 Hz hold from
  // t = 0.15 s DISCRIMINATES: bc42ad0 notches it at 5.45 s (47.0 % of hold
  // frames). The other three are no-regression guards — bc42ad0 never
  // notches them either (100 %; corrected 2026-10-05, the V14 comment said
  // bc42ad0 notched all four).
  for (const [file, len, k, f0] of [["vs_f2_262.wav", 3.5, 1, 262.5], ["vs_m1_128.wav", 2.75, 1, 128.3]]) {
    const note = notes(file, len)[k];
    for (const start of [4, 0.15]) {
      const { y, spans } = chain([note, note, note, note], 0, start);
      let x = y;
      if (start > 1) {
        const syl = syllables(1, start, f0, 3);
        const sp = voiceTrack({ dur: y.length / SR, f0At: (t) => syl.find((q) => t >= q.a && t <= q.b)?.f ?? 0, ampAt: (t) => { const q = syl.find((r) => t >= r.a && t <= r.b); return q ? ramp(t, q.a, q.b, 0.02) : 0; }, vibCents: 10, wanderCents: 3, amp: 0.1, seed: 33 });
        x = Float32Array.from(y, (v, i) => v + sp[i]);
      }
      const r = realScore(workerRun(x), [[spans[0][0], spans[3][1]]], f0);
      const role = f0 < 200 && start < 1 ? "discriminating" : "guard";
      check(`(r3, ${role}) real ${f0} Hz hold (VocalSet ${file.slice(3, 5)}) ${start > 1 ? "after 3 s of speech" : "from t = 0.15 s"}: >= ${HELD_MIN} % of hold frames at pitch`, r.pct >= HELD_MIN, `${r.pct.toFixed(1)} %${r.notched ? ", notch promoted" : ""}`);
    }
  }
  // (r5) REAL crescendos at the start of a not-onset-born hold (2026-10-05
  // follow-up): V14's first-sightings jump guard took them for a takeover.
  //   (a) the (r3) 128 Hz hold from t = 0.15 s with a -6 -> 0 dB swell over
  //       its first 2 s: bc42ad0 and V14 47.0 %
  //   (b) PVQD sustained /a/ as recorded (Sj6001, SJ2012: phonation from the
  //       recording's start, the level rising 5-11 dB over its first 1-3 s),
  //       held on by looping its last steady 2 s to ~13 s: bc42ad0 and V14
  //       notch the vowel at 5.45 s (35.6 / 36.6 % of hold frames)
  {
    const note = notes("vs_m1_128.wav", 2.75)[1];
    const { y, spans } = chain([note, note, note, note], 0, 0.15);
    const a = spans[0][0];
    const x = Float32Array.from(y, (v, i) => { const u = i / SR - a; return u >= 0 && u < 2 ? v * Math.pow(10, (-6 + 3 * u) / 20) : v; });
    const r = realScore(workerRun(x), [[a, spans[3][1]]], 128.3);
    check(`(r5a) real 128.3 Hz hold from t = 0.15 s with a -6 -> 0 dB swell over 2 s: >= ${HELD_MIN} % of hold frames at pitch`, r.pct >= HELD_MIN, `${r.pct.toFixed(1)} %${r.notched ? ", notch promoted" : ""}`);
  }
  {
    const pv = readPcm16(new URL("pvqd_cresc.wav", REAL));
    for (const [label, from, len, f0] of [["PVQD Sj6001 /a/ (270 Hz)", 0, 5.6, 270.2], ["PVQD SJ2012 /a/ (201 Hz)", 5.6, 5.25, 201]]) {
      const head = pv.subarray(Math.round(from * SR), Math.round((from + len) * SR));
      const tail = head.subarray(head.length - 2 * SR);
      const F = Math.round(0.03 * SR), parts = [head, tail, tail, tail, tail];
      const y = new Float32Array(parts.reduce((s, p) => s + p.length - F, F) + SR);
      let n = 0;
      parts.forEach((p, k) => { if (k) n -= F; for (let i = 0; i < p.length; i++) y[n + i] += Math.min(1, k ? (i + 1) / F : 1, (p.length - i) / F) * p[i]; n += p.length; });
      const r = realScore(workerRun(y), [[0.7, n / SR]], f0);
      check(`(r5b) ${label} as recorded (onset crescendo), held to ${(n / SR).toFixed(1)} s: >= ${HELD_MIN} % of hold frames at pitch`, r.pct >= HELD_MIN, `${r.pct.toFixed(1)} %${r.notched ? ", notch promoted" : ""}`);
    }
  }
  // (r4) the three real notes (0.3 s gaps) over the real air conditioner
  // (+10 dB, 12 s noise lead): the compressor stack is notched at ~5.5 s and
  // the notes keep at least bc42ad0's share of frames at pitch (bc42ad0:
  // 58.6 % at 262 Hz — octave errors in this noise, not the notch — and
  // 58.2 % at 128 Hz, where it notched the voice's own line)
  for (const [file, len, f0, minPct] of [["vs_f2_262.wav", 3.5, 262.5, 57.5], ["vs_m1_128.wav", 2.75, 128.3, 90]]) {
    const { y, spans } = chain(notes(file, len), 0.3, 12);
    const nz = loopTo(ac, y.length);
    let pv = 0, m = 0, pn = 0;
    for (const [a, b] of spans) for (let i = Math.floor(a * SR); i < b * SR; i++) { pv += y[i] * y[i]; m++; }
    for (let i = 0; i < nz.length; i++) pn += nz[i] * nz[i];
    const g = Math.sqrt((pv / m) / (pn / nz.length) / 10);
    const msgs = workerRun(Float32Array.from(y, (v, i) => v + g * nz[i]));
    const t4 = firstNotchNear(msgs, 0, AC_LINES);
    const r = realScore(msgs, spans, f0);
    check(`(r4) real ${f0} Hz notes over the real air conditioner (+10 dB): line notched by 5.75 s, >= ${minPct} % of note frames at pitch`, t4 !== null && t4 <= 5.75 && r.pct >= minPct, `notched ${t4?.toFixed(2)} s, ${r.pct.toFixed(1)} %`);
  }
}

console.log("\ninterferers keep their promotion (real worker)");
{
  // first time a notch sits within 3 % of 120 Hz
  const firstNotch = (msgs, after = 0) => {
    for (const m of msgs) if (m.contextTime > after && m.notchedFreqs?.some((f) => Math.abs(f / 120 - 1) < 0.03)) return m.contextTime - after;
    return null;
  };
  const hum = (t) => 0.03 * (Math.sin(2 * Math.PI * 120 * t) + 0.25 * Math.sin(2 * Math.PI * 240 * t + 1.1) + 0.12 * Math.sin(2 * Math.PI * 360 * t + 2.3));
  // hum present from the first sample, speech-like voicing from 3 s with pauses
  const syl = syllables(3, 30, 200, 3);
  const pauses = (t) => Math.floor(t / 4) % 2 === 1 && (t % 4) > 2.8; // 1.2 s pause every 8 s
  const f0At = (t) => { const q = syl.find((y) => t >= y.a && t <= y.b); return q && !pauses(t) ? q.f : 0; };
  const sp = voiceTrack({ dur: 30, f0At, ampAt: (t) => (f0At(t) > 0 ? 1 : 0), vibCents: 0, seed: 41 });
  const x1 = Float32Array.from(sp, (v, i) => v + hum(i / SR));
  const t1 = firstNotch(workerRun(x1));
  check("hum present at stream start, speech from 3 s: notched within ~5.6 s", t1 !== null && t1 <= 5.6, `t=${t1?.toFixed(2)}`);
  // hum switching on at 10 s DURING the speech: onset-born, 20 s — and the
  // speech pauses (latch release / offsets) must not keep restarting it
  const x2 = Float32Array.from(sp.length < 40 * SR ? new Float32Array(40 * SR).map((_, i) => (i < sp.length ? sp[i] : 0)) : sp, (v, i) => v + (i >= 10 * SR ? hum(i / SR) : 0));
  const t2 = firstNotch(workerRun(x2), 10);
  check(`hum switching on mid-speech: notched no later than ~${NOTCH_DEFAULTS.onsetMinTrackSec} s after it starts (not reset by speech pauses)`,
    t2 !== null && t2 <= NOTCH_DEFAULTS.onsetMinTrackSec + 2, `t=${t2?.toFixed(2)}`);
  // stream that begins with 100 ms of digital zeros, hum then present: the
  // zeros are not a pre-onset floor (capture start), hum keeps ~5 s
  const x3 = new Float32Array(10 * SR);
  for (let i = Math.round(0.1 * SR); i < x3.length; i++) x3[i] = hum(i / SR) + 0.0003 * Math.sin(i * 1.7);
  const t3 = firstNotch(workerRun(x3));
  check("hum after 100 ms of stream-start digital silence: notched within ~5.7 s", t3 !== null && t3 <= 5.7, `t=${t3?.toFixed(2)}`);
}

// ---- 2026-10-04 round 1: interferer regressions of 6f8be18's in-sound latch
// (review-confirmed; measurements/noise-notch-held-note-robustness-2026-10-04.md
// round-1 section). Each case promotes at ~5 s on bc42ad0 (and on the
// shipped module); 6f8be18 never notched (a), (b) or took 20 s (c).
// bc42ad0's promotion times for (d) / (e) below + 0.3 s, measured with the
// bc42ad0 module on this synthesis (21.15 s / 10.35 s)
const HUM_NOTE_LIM = { d: 21.45, e: 10.65 };
console.log("\ninterferer regressions: held-note rules must not delay or block real hums (real worker)");
{
  const firstNotch = (msgs, after = 0) => {
    for (const m of msgs) if (m.contextTime > after && m.notchedFreqs?.some((f) => Math.abs(f / 120 - 1) < 0.03)) return m.contextTime - after;
    return null;
  };
  const hum = (t, a = 0.03) => a * (Math.sin(2 * Math.PI * 120 * t) + 0.25 * Math.sin(2 * Math.PI * 240 * t + 1.1) + 0.12 * Math.sin(2 * Math.PI * 360 * t + 2.3));
  // dense speech from t0 with a 0.6 s pause every 4 s
  const speechFrom = (t0, dur, center, seed) => {
    const syl = syllables(t0, dur, center, seed);
    const pause = (t) => ((t - t0) % 4) > 3.4;
    const f0At = (t) => { const q = syl.find((y) => t >= y.a && t <= y.b); return q && !pause(t) ? q.f : 0; };
    return { f0At, x: voiceTrack({ dur, f0At, ampAt: (t) => (f0At(t) > 0 ? 1 : 0), vibCents: 0, seed }) };
  };
  // (a) hum present from the first sample, speech starting 0.2 / 0.6 s in —
  // 6f8be18: never notched, 100 % of pauses painted at 120 Hz
  for (const t0 of [0.2, 0.6]) {
    const { x: sp } = speechFrom(t0, 25, 210, 7);
    const t = firstNotch(workerRun(Float32Array.from(sp, (v, i) => v + hum(i / SR))));
    check(`hum present at stream start, speech from ${t0} s: notched within ~6 s`, t !== null && t <= 6, `t=${t?.toFixed(2)}`);
  }
  // (b) weak hum (+6 dB band energy over a white floor) switching on mid-
  // utterance — 6f8be18 restarted its clock in every pause, never notched
  {
    const { x: sp } = speechFrom(1, 45, 210, 9);
    let s = 4242;
    const floorRms = 0.003, humRms = Math.sqrt(floorRms * floorRms * (3950 / 8000) * Math.pow(10, 6 / 10));
    const a = humRms / Math.sqrt((1 + 0.0625 + 0.0144) / 2);
    const x = Float32Array.from(sp, (v, i) => {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      return v + floorRms * Math.sqrt(3) * (s / 0x7fffffff - 1) + (i >= 10.3 * SR ? hum(i / SR, a) : 0);
    });
    const t = firstNotch(workerRun(x), 10.3);
    check("weak hum (+6 dB over the floor) switching on mid-speech: notched within ~21 s", t !== null && t <= 21, `t=${t?.toFixed(2)}`);
  }
  // (c) capture pre-roll: 300 ms of 1e-5 dither, or an 80 ms fade-in, then a
  // hum — 6f8be18 treated it as switching on (20 s)
  for (const [label, pre] of [["300 ms of 1e-5 dither", "dither"], ["an 80 ms fade-in", "fade"]]) {
    const x = new Float32Array(10 * SR);
    let s = 77;
    const L = pre === "dither" ? Math.round(0.3 * SR) : 0;
    for (let i = 0; i < x.length; i++) {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      const w = s / 0x7fffffff - 1;
      if (i < L) { x[i] = 1e-5 * Math.sqrt(3) * w; continue; }
      const g = pre === "fade" ? Math.min(1, i / (0.08 * SR)) : 1;
      x[i] = g * (hum((i - L) / SR) + 0.0003 * w);
    }
    const t = firstNotch(workerRun(x), L / SR);
    check(`hum after ${label}: notched within ~5.7 s`, t !== null && t <= 5.7, `t=${t?.toFixed(2)}`);
  }
  // (d) / (e): a hum a held-note rule could take for a note — a 120 Hz hum
  // present from the first sample beside a louder held note (scripts/notch-
  // adversarial/handoff-adv.mjs). Must notch no later than bc42ad0 does
  // (printed bc42ad0 times, this synthesis).
  //   (d) 123 Hz note 1-9 s on the hum's track: a breath re-birth at the
  //       note's end must not take the hum for the note
  //   (e) 112 Hz note 1-5 s (masks the hum line) gliding onto 121 Hz in its
  //       last second, then ending: no glide handoff to the returning line
  for (const [label, f0At, end, lim] of [
    ["(d) 123 Hz note held 1-9 s on the hum's track", (t) => (t >= 1 && t <= 9 ? 123 : 0), 9, HUM_NOTE_LIM.d],
    ["(e) 112 Hz note 1-5 s gliding onto 121 Hz", (t) => (t < 1 || t > 5 ? 0 : t < 4 ? 112 : 112 + 9 * (t - 4)), 5, HUM_NOTE_LIM.e],
  ]) {
    const v = voiceTrack({ dur: 32, f0At, ampAt: (t) => ramp(t, 1, end), vibCents: 10, seed: 23 });
    const t = firstNotch(workerRun(Float32Array.from(v, (s, i) => s + hum(i / SR, 0.01))));
    check(`hum beside a held note, ${label}: notched by ${lim} s (bc42ad0 + 0.3 s)`, t !== null && t <= lim, `t=${t?.toFixed(2)}`);
  }
  // (f) a BEATING hum (two fans 120 / 120.5 Hz, ~9.5 dB 2 s amplitude
  // cycle) at +9 dB over a white floor, switching on at the end of a pause
  // of 2.5 s-on / 1 s-off speech: its own line dips in the pauses (round 1's
  // dip-only re-birth fired on it: 43.75 / 40.45 s without a revoke; bc42ad0
  // 20.15 / 20.15 s on this synthesis, scripts/notch-adversarial int.mjs
  // --part=weak2)
  {
    const tone = (f, t, ph = 0) => Math.sin(2 * Math.PI * f * t + ph) + 0.25 * Math.sin(4 * Math.PI * f * t + 1.1 + ph) + 0.12 * Math.sin(6 * Math.PI * f * t + 2.3 + ph);
    const syl = syllables(0.5, 60, 210, 50);
    const pause = (t) => ((t - 0.5) % 3.5) > 2.5;
    const f0At = (t) => { const q = syl.find((y) => t >= y.a && t <= y.b); return q && !pause(t) ? q.f : 0; };
    const sp = voiceTrack({ dur: 60, f0At, ampAt: (t) => (f0At(t) > 0 ? 1 : 0), vibCents: 0, seed: 9 });
    const floorRms = 0.003, humRms = Math.sqrt(floorRms * floorRms * (3950 / 8000) * Math.pow(10, 9 / 10));
    const a = humRms / Math.sqrt(1.118 * (1 + 0.0625 + 0.0144) / 2);
    for (const on of [11.0, 14.3]) {
      let s = 4242;
      const x = Float32Array.from(sp, (v, i) => {
        s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
        const t = i / SR;
        return v + floorRms * Math.sqrt(3) * (s / 0x7fffffff - 1) + (t >= on ? a * (tone(120, t) + 0.5 * tone(120.5, t, 0.7)) / 1.118 : 0);
      });
      const t = firstNotch(workerRun(x), on);
      check(`(f) beating hum (+9 dB) switching on at ${on} s, end of a pause: notched within ~21 s`, t !== null && t <= 21, `t=${t?.toFixed(2)}`);
    }
  }
}

// ---- 2026-10-04 round 2: interferer regressions of round 1 (cb00425),
// review-confirmed, kept as guards after the revert to bc42ad0 (measurements/noise-notch-held-note-robustness-
// 2026-10-04.md "Round 2"; scripts/notch-adversarial/r2int.mjs). Limits =
// bc42ad0's promotion time on this synthesis + 0.3 s (bc42ad0: 8.25 /
// 13.25 / 10.25 / 20.15 / 20.15 / 20.15 / 20.25 s); cb00425's times in
// brackets.
const R2_LIM = { g: 8.55, g2: 13.55, h: 10.55, i: 20.45, i2: 20.45, j: 20.45, k: 20.55 };
console.log("\nround-2 interferer regressions: a hum that steps, is masked, beats, or shares a note's track (real worker)");
{
  const firstNotchNear = (msgs, after, lines) => {
    for (const m of msgs) if (m.contextTime > after && m.notchedFreqs?.some((f) => lines.some((L) => Math.abs(f / L - 1) < 0.03))) return m.contextTime - after;
    return null;
  };
  const humAt = (phase, a) => a * (Math.sin(phase) + 0.25 * Math.sin(2 * phase + 1.1) + 0.12 * Math.sin(3 * phase + 2.3));
  // continuous-phase hum with frequency f(t), on from `on` s
  const humTrack = (n, fOf, a, on) => {
    const x = new Float32Array(n); let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; if (t < on) continue; ph += 2 * Math.PI * fOf(t) / SR; x[i] = humAt(ph, a); }
    return x;
  };
  const white = (n, rms, seed) => { let s = seed; return Float32Array.from({ length: n }, () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return rms * Math.sqrt(3) * (s / 0x7fffffff - 1); }); };
  // (g) an onset-born hum (switches on in silence at 5 s, noise-only) that
  // then steps 115 -> 121 Hz at 8 s (fan speed change), or alternates
  // 115 / 121 Hz every 8 s: round 1 handed the new line the old one's
  // onset-born status (own 20 s clock) [23.15 s / never]
  for (const [label, fOf, lim] of [["steps 115 -> 121 Hz 3 s after switching on", (t) => (t < 8 ? 115 : 121), R2_LIM.g],
    ["alternates 115 / 121 Hz every 8 s", (t) => (Math.floor((t - 5) / 8) % 2 ? 121 : 115), R2_LIM.g2]]) {
    const n = 40 * SR, fl = white(n, 0.001, 5), h = humTrack(n, fOf, 0.014, 5);
    const t = firstNotchNear(workerRun(Float32Array.from(h, (v, i) => v + fl[i])), 5, [115, 121]);
    check(`(g) hum ${label} (noise-only): notched by ${lim} s after switch-on`, t !== null && t <= lim, `t=${t?.toFixed(2)}`);
  }
  // (h) a hum present from t = 0, masked by a 125 Hz note at 1-5 s (min-
  // separation prunes its track), the note then stepping into syllables at
  // 1.5x with 0.9 s pauses: round 1 handed the reappearing hum line the
  // note's onset-born status [25.25 s]
  {
    const syl = syllables(5, 40, 187, 13);
    const pause = (t) => ((t - 5) % 6) > 5.1;
    const f0At = (t) => { if (t >= 1 && t < 5) return 125; const q = syl.find((y) => t >= y.a && t <= y.b); return q && !pause(t) ? q.f : 0; };
    const v = voiceTrack({ dur: 40, f0At, ampAt: (t) => (f0At(t) > 0 ? 1 : 0), vibCents: 10, seed: 61 });
    const h = humTrack(v.length, () => 120, 0.014, 0);
    const t = firstNotchNear(workerRun(Float32Array.from(v, (s, i) => s + h[i])), 0, [120]);
    check(`(h) hum masked by a 125 Hz note, the note stepping into speech with 0.9 s pauses: notched by ${R2_LIM.h} s`, t !== null && t <= R2_LIM.h, `t=${t?.toFixed(2)}`);
  }
  // (i) a beating hum (two fans 0.5 Hz apart, 2:1 and 1:1 amplitude)
  // switching on in silence at 4 s, speech from 6 s with frequent 0.25-0.6 s
  // pauses: a beat trough met a pause and round 1 re-birthed it [2:1: 3 of
  // 12 seeds of r2int.mjs --part=beatpause at 29-35 s, here 20.15 s; 1:1
  // here never]. Round 2's quiet-window rule needed a provisional re-birth
  // for the 1:1 beat, whose null can leave the line absent in a pause
  for (const [label, g, key] of [["2:1", 0.5, "i"], ["1:1", 1, "i2"]]) {
    let s = 1234; const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 0xffffffff; };
    const syl = []; let t = 6;
    while (t < 44.5) { const e = t + 0.12 + 0.18 * rnd(); syl.push({ a: t, b: e, f: 210 * Math.pow(2, (rnd() - 0.5) * 6 / 12) }); t = e + 0.04 + 0.08 * rnd(); if (rnd() < 0.15) t += 0.25 + 0.35 * rnd(); }
    const f0At = (tt) => syl.find((y) => tt >= y.a && tt <= y.b)?.f ?? 0;
    const v = voiceTrack({ dur: 45, f0At, ampAt: (tt) => { const q = syl.find((y) => tt >= y.a && tt <= y.b); return q ? ramp(tt, q.a, q.b, 0.02) : 0; }, vibCents: 0, amp: 0.12, seed: 71 });
    const n = v.length, fl = white(n, 0.001, 9), h1 = humTrack(n, () => 120, 0.0055, 4), h2 = humTrack(n, () => 120.5, 0.0055 * g, 4);
    const tn = firstNotchNear(workerRun(Float32Array.from(v, (x, i) => x + fl[i] + h1[i] + h2[i])), 4, [120]);
    check(`(i) ${label} beating hum switching on in silence, speech with short pauses: notched within ~${R2_LIM[key]} s`, tn !== null && tn <= R2_LIM[key], `t=${tn?.toFixed(2)}`);
  }
  // (j) a fan-like hum switching on in silence at 3 s, then 2 s held notes at
  // 120.5 Hz (one track with the hum) with 0.4 s breaths, the hum 25 dB under
  // the voice: round 1 read the hum's level in each breath as "the line
  // dipped" and re-birthed every breath [never notched]
  {
    const holds = []; for (let t = 5; t + 2 < 39; t += 2.4) holds.push([t, t + 2]);
    const f0At = (t) => (holds.some(([a, b]) => t >= a && t <= b) ? 120.5 : 0);
    const v = voiceTrack({ dur: 40, f0At, ampAt: (t) => Math.max(...holds.map(([a, b]) => ramp(t, a, b, 0.04))), vibCents: 10, seed: 81 });
    const h = humTrack(v.length, (t) => 120 + 0.2 * Math.sin(2 * Math.PI * 0.3 * t), 0.15 * Math.pow(10, -25 / 20), 3);
    const t = firstNotchNear(workerRun(Float32Array.from(v, (s, i) => s + h[i])), 3, [120]);
    check(`(j) hum under repeated 120.5 Hz holds (-25 dB, 0.4 s breaths): notched by ${R2_LIM.j} s after switch-on`, t !== null && t <= R2_LIM.j, `t=${t?.toFixed(2)}`);
  }
  // (k) a hum that itself cuts out for 0.3 s every 5 s (noise-only, on from
  // 2 s): the signal of repeated steady same-pitch holds with breaths. Round
  // 2's candidate (and round 1, and 6f8be18) never notched it — 95 % of the
  // audio painted as voice — which is why every breath rule was reverted
  for (const lvl of [0.01, 0.03]) {
    const n = 45 * SR, fl = white(n, 0.0003, 21), h = humTrack(n, () => 120, lvl * Math.SQRT2 / 1.032, 2);
    const x = Float32Array.from(h, (v, i) => {
      const t = i / SR; if (t < 2) return fl[i];
      const u = (t - 2) % 5;
      return (u > 4.7 ? 0 : Math.min(1, u / 0.02, (4.7 - u) / 0.02)) * v + fl[i];
    });
    const t = firstNotchNear(workerRun(x), 2, [120]);
    check(`(k) hum cutting out 0.3 s every 5 s (rms ${lvl}): notched by ${R2_LIM.k} s after switch-on`, t !== null && t <= R2_LIM.k, `t=${t?.toFixed(2)}`);
  }
}

console.log("\ncatch breaths: same-pitch holds separated by 0.15 / 0.25 s (known limitation, as above)");
for (const br of [0.15, 0.25]) for (const f0 of [120, 220]) {
  const spans = []; let t = 1;
  for (let k = 0; k < 3; k++) { spans.push([t, t + 8]); t += 8 + br; }
  const f0At = (tt) => (spans.some(([a, b]) => tt >= a && tt <= b) ? f0 : 0);
  const x = voiceTrack({ dur: spans[2][1] + 1, f0At, ampAt: (tt) => Math.max(...spans.map(([a, b]) => ramp(tt, a, b))), vibCents: 0, seed: 17 + f0 });
  knownLimit(`${f0} Hz 3 x 8 s, ${br} s breaths`, holdScore(workerRun(x), f0At, spans));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
