// hnr-readout-test.js — unit tests for src/audio/hnrReadout.js, the live HNR
// readout under the cue strip (median of the voiced frames' fresh HNR over
// the last 3 s). Decision data: measurements/hnr-readout-2026-11-02.md.
//
// Usage: node tests/audio/hnr-readout-test.js

import { createHnrReadout, HNR_READOUT_WINDOW_MS } from "../../src/audio/hnrReadout.js";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

{
  const r = createHnrReadout();
  check("empty readout is null", r.value(0) === null);
  r.push(0, 12, false);
  r.push(25, -6, false);
  check("values from unvoiced frames are ignored", r.value(25) === null);
  r.push(50, null, true);
  r.push(75, undefined, true);
  r.push(100, NaN, true);
  check("voiced frames without a fresh value are ignored", r.value(100) === null);
}

{
  const r = createHnrReadout();
  [10, 14, 2, 12, 11].forEach((v, i) => r.push(i * 150, v, true));
  check("median of an odd count", r.value(600) === 11, String(r.value(600)));
  r.push(750, 20, true);
  check("median of an even count", r.value(750) === 11.5, String(r.value(750)));
  r.push(800, -15, false);
  check("an unvoiced outlier does not move it", r.value(800) === 11.5, String(r.value(800)));
}

{
  const r = createHnrReadout();
  r.push(0, 4, true);
  r.push(HNR_READOUT_WINDOW_MS, 10, true);
  check("a value exactly WINDOW_MS old still counts", r.value(HNR_READOUT_WINDOW_MS) === 7, String(r.value(HNR_READOUT_WINDOW_MS)));
  check("older values leave the window", r.value(HNR_READOUT_WINDOW_MS + 1) === 10, String(r.value(HNR_READOUT_WINDOW_MS + 1)));
  check("an empty window returns null (the hook keeps the last value shown)", r.value(3 * HNR_READOUT_WINDOW_MS) === null);
}

{
  const r = createHnrReadout(500);
  r.push(0, 3, true);
  r.push(400, 9, true);
  check("custom window", r.value(600) === 9, String(r.value(600)));
  r.reset();
  check("reset empties it", r.value(600) === null);
}

{
  // A running-speech-like stream: voiced vowels near 10 dB, consonant and gap
  // windows (unvoiced) far lower; the readout stays near the vowels' value.
  const r = createHnrReadout();
  const shown = [];
  for (let i = 0; i < 200; i++) {
    const t = i * 150;
    const voiced = i % 3 !== 0;
    const v = voiced ? 10 + ((i * 7) % 5) - 2 : -8 - (i % 6);
    r.push(t, v, voiced);
    shown.push(r.value(t));
  }
  const vals = shown.filter((x) => x !== null);
  check("speech-like stream: never negative", vals.every((x) => x >= 0), String(Math.min(...vals)));
  check("speech-like stream: within the vowels' range", vals.every((x) => x >= 8 && x <= 12), `${Math.min(...vals)}..${Math.max(...vals)}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
