// subharmonic-evidence-test.js — subharmonicPartialCount
// (src/dsp/subharmonic-evidence.js) and the pitch worker's `subharmonic`
// flag (2026-10-07, low-voice-noise candidate meter-c1).
//
// The flag marks an above-range decode d that carries >= 2 partials of a
// sub-multiple d/k which d itself can't have: a low voice whose
// formant-region harmonic the tracker locked onto. It is weak evidence for
// the perceived-voice utterance gate only; the frame stays unvoiced.
//
// Usage: node tests/dsp/subharmonic-evidence-test.js

import { subharmonicPartialCount } from "../../src/dsp/subharmonic-evidence.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`); }
}

const SR = 16000, N = 1280;
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

// Harmonic complex at f0 with amplitudes amp(h) (h*f0 < 4 kHz).
function complex(f0, amp, noise = 0) {
  const x = new Float32Array(N);
  for (let h = 1; h * f0 < 4000; h++) {
    const a = amp(h), ph = rand() * 2 * Math.PI;
    if (a === 0) continue;
    for (let i = 0; i < N; i++) x[i] += a * Math.sin((2 * Math.PI * h * f0 * i) / SR + ph);
  }
  if (noise > 0) for (let i = 0; i < N; i++) x[i] += noise * gauss();
  return x;
}

console.log("subharmonicPartialCount");
{
  // 95 Hz voice, strong partials around the first formant (~570 Hz = 6 f0):
  // decoded at 570 Hz, the sub-multiple 95 Hz has its own partials 5, 7, 4, 8 ...
  const voice = complex(95, (h) => 1 / (1 + Math.abs(h - 6)));
  const c = subharmonicPartialCount(voice, 570, SR);
  check("low voice decoded at 6 f0: >= 2 partials of f0 that 6 f0 can't have", c >= 2, `count ${c}`);
  // KNOWN LIMITATION (not asserted): a clean harmonic note above 400 Hz
  // often counts too — Hann sidelobes of its strong partials clear the
  // 10 dB floor at sub-multiple partials within ~60 Hz of them. Harmless
  // for the gate's opening (weak hints never open an utterance); it can
  // keep an utterance open into a high sung note right after speech.
  for (const f of [520, 570]) {
    const c = subharmonicPartialCount(complex(f, (h) => 1 / h), f, SR);
    console.log(`  KNOWN LIMITATION: clean ${f} Hz harmonic note -> count ${c}`);
  }
  // Unvoiced decodes / out-of-range sub-multiples: nothing to count.
  check("decodedHz 0 -> 0", subharmonicPartialCount(voice, 0, SR) === 0);
  check("no sub-multiple in 75-400 Hz -> 0", subharmonicPartialCount(voice, 60, SR) === 0);
  // White noise: a 10 dB peak over the band median is rare per partial, so
  // two off-multiple partials at one sub-multiple are rare too.
  let hits = 0;
  const T = 300;
  for (let t = 0; t < T; t++) {
    const x = new Float32Array(N);
    for (let i = 0; i < N; i++) x[i] = gauss();
    if (subharmonicPartialCount(x, 450 + rand() * 300, SR) >= 2) hits++;
  }
  check("white noise frames flagged <= 5 %", hits / T <= 0.05, `${((100 * hits) / T).toFixed(1)} %`);
}

console.log("\npitch worker — `subharmonic` flag");
{
  const posts = [];
  globalThis.self = { postMessage: (m) => posts.push(m) };
  await import("../../src/dsp/pitch-worker.js");
  const WSR = 48000, CHUNK = Math.round(WSR * 0.025);
  const run = (f0, seconds) => {
    self.onmessage({ data: { type: "init", inputSampleRate: WSR } });
    const port = {};
    self.onmessage({ data: { type: "audioPort", port } });
    posts.length = 0;
    let phase = 0, t = 0;
    for (let c = 0; c < Math.round(seconds / 0.025); c++) {
      const buf = new Float32Array(CHUNK);
      for (let i = 0; i < CHUNK; i++) {
        phase += (2 * Math.PI * f0) / WSR; t += 1 / WSR;
        let s = 0; for (let k = 1; k <= 6; k++) s += Math.sin(k * phase) / k;
        buf[i] = 0.3 * s;
      }
      port.onmessage({ data: { buffer: buf.buffer, contextTime: t } });
    }
    return posts.filter((m) => m.type === "pitch").slice(8);
  };
  const sung = run(520, 2);
  check("520 Hz sung note: stays unvoiced whatever the flag", sung.length > 30 && sung.every((m) => m.pitch === null && m.voiced === false));
  console.log(`  KNOWN LIMITATION: 520 Hz clean sung note flagged on ${sung.filter((m) => m.subharmonic).length}/${sung.length} posts`);
  const low = run(100, 2);
  check("100 Hz voice: voiced, never flagged", low.every((m) => !m.subharmonic) && low.filter((m) => m.pitch !== null).length > 0.9 * low.length);
  check("the flag is only ever set on unvoiced posts", [...sung, ...low].every((m) => !m.subharmonic || m.pitch === null));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
