// cue-strip-wiring-test.js — CueStrip.jsx passes the pitch display's own
// flags (pitchVoiced / pitchHolding: what the voice gate leaves) to
// cueRowStates, for both rows and the caption (2026-10-21,
// measurements/voice-gate-resonance-row-2026-10-21.md).
//
// cue-strip-model-test.js checks cueRowStates itself; this checks that the
// component uses it with the gated flags. A source check, not a render (the
// strip needs a DOM): if CueStrip went back to the raw voiced / holding, or
// back to calling pitchRowState / resonanceRowState directly, test:unit
// fails here instead of only the browser smokes, which CI does not run.
// Review finding 2026-10-21.
//
//   node tests/audio/cue-strip-wiring-test.js

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../src/components/CueStrip.jsx", import.meta.url), "utf8")
  .replace(/\/\/[^\n]*/g, "");   // comments out: only code counts

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}
// The keys of an object literal written as { a, b, c: x, ...y }.
const keysOf = (body) => body.split(",").map((k) => k.trim().split(":")[0].trim()).filter(Boolean);

console.log("CueStrip wiring");
const calls = src.match(/cueRowStates\(/g) ?? [];
check("cueRowStates is called for the live rows and the 4 Hz tick (2 calls)", calls.length === 2, `${calls.length} calls`);
const args = [...src.matchAll(/cueRowStates\(\{([^}]*)\}\)/g)].map((m) => keysOf(m[1]));
check("each cueRowStates call passes only its inputs and hasRef (no flag overridden there)",
  args.length === 2 && args.every((k) => k.length === 2 && k[0] === "...inputs" && k[1] === "hasRef"),
  args.map((k) => k.join(",")).join(" | "));
check("no direct pitchRowState / resonanceRowState call (both rows go through cueRowStates)",
  !/\b(pitchRowState|resonanceRowState)\(/.test(src));

const latest = src.match(/latest\.current = \{([^}]*)\}/);
const lk = latest ? keysOf(latest[1]) : [];
check("the tick's inputs (latest.current) carry pitchVoiced / pitchHolding",
  lk.includes("pitchVoiced") && lk.includes("pitchHolding"), lk.join(","));
check("the tick's inputs carry no raw voiced / holding", !lk.includes("voiced") && !lk.includes("holding"), lk.join(","));

const inputs = src.match(/const inputs = \{ (pitchVoiced[^}]*)\}/);
const ik = inputs ? keysOf(inputs[1]) : [];
check("the render's inputs carry pitchVoiced / pitchHolding", ik.includes("pitchVoiced") && ik.includes("pitchHolding"), ik.join(","));
check("the render's inputs carry no raw voiced / holding", inputs && !ik.includes("voiced") && !ik.includes("holding"), ik.join(","));

check("the caption's \"ever spoke\" flag follows pitchVoiced", /if \(p\.pitchVoiced\) ever = true/.test(src) && !/p\.voiced\b/.test(src));
check("the caption text follows pitchVoiced", /view\.everVoiced \|\| pitchVoiced \?/.test(src));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
