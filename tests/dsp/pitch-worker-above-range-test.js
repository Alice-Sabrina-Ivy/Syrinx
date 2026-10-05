// pitch-worker-above-range-test.js — drives the REAL pitch worker
// (src/dsp/pitch-worker.js) in Node with a fake `self` and checks the
// above-display-range contract (2026-10-03): phonation above
// PITCH_DISPLAY_RANGE.high is posted as unvoiced (pitch null, confidence
// < 0.5), never as a half-pitch value inside the display range; in-range
// phonation is unaffected. measurements/pitch-ceiling-2026-10-03.md
//
// Usage: node tests/dsp/pitch-worker-above-range-test.js

const posts = [];
globalThis.self = { postMessage: (m) => posts.push(m) };
await import("../../src/dsp/pitch-worker.js");
const { PITCH_DISPLAY_RANGE } = await import("../../src/utils/constants.js");

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`); }
}

const SR = 48000, CHUNK = Math.round(SR * 0.025);
// Harmonic source with a per-chunk F0 schedule f(seconds); 6 harmonics,
// 1/k amplitudes, 0.3 peak-ish — same family as the other worker probes.
function run(fOfT, seconds) {
  self.onmessage({ data: { type: "init", inputSampleRate: SR } });
  const port = {};
  self.onmessage({ data: { type: "audioPort", port } });
  posts.length = 0;
  let phase = 0, t = 0;
  for (let c = 0; c < Math.round(seconds / 0.025); c++) {
    const buf = new Float32Array(CHUNK);
    for (let i = 0; i < CHUNK; i++) {
      phase += (2 * Math.PI * fOfT(t)) / SR; t += 1 / SR;
      let s = 0; for (let k = 1; k <= 6; k++) s += Math.sin(k * phase) / k;
      buf[i] = 0.3 * s;
    }
    port.onmessage({ data: { buffer: buf.buffer, contextTime: t } });
  }
  return posts.filter((m) => m.type === "pitch").slice(8); // skip warm-up
}

console.log("pitch worker — above-display-range contract");
{
  const p = run(() => 520, 3);
  check("520 Hz sustained: every post is unvoiced", p.length > 50 && p.every((m) => m.pitch === null && m.voiced === false),
    `${p.filter((m) => m.pitch !== null).length}/${p.length} voiced`);
  check("520 Hz sustained: confidence < 0.5 on every post (silence-gate invariant)", p.every((m) => m.confidence < 0.5));
  check("520 Hz sustained: never posted at half pitch (~260 Hz)", !p.some((m) => m.pitch !== null && Math.abs(m.pitch / 260 - 1) < 0.05));
}
{
  const p = run(() => 260, 3);
  const ok = p.filter((m) => m.pitch !== null && Math.abs(m.pitch / 260 - 1) < 0.02).length;
  check("260 Hz sustained (in range) is reported at 260", ok >= 0.95 * p.length, `${ok}/${p.length}`);
}
{
  // Siren: 300 -> 600 Hz over 2 s. Below 400 the post must track the
  // glide; above 400 it must be unvoiced — never a half value (150-300).
  const p = run((t) => 300 * Math.pow(2, Math.min(t, 2) / 2), 2.4);
  const voiced = p.filter((m) => m.pitch !== null);
  check("300->600 Hz siren: no post below 290 Hz (no half-pitch alias)", voiced.every((m) => m.pitch >= 290),
    `min ${Math.min(...voiced.map((m) => m.pitch)).toFixed(1)}`);
  check(`300->600 Hz siren: no post above PITCH_DISPLAY_RANGE.high (${PITCH_DISPLAY_RANGE.high})`, voiced.every((m) => m.pitch <= PITCH_DISPLAY_RANGE.high));
  check("300->600 Hz siren: the in-range part is reported", voiced.length >= 20, `${voiced.length} voiced posts`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
