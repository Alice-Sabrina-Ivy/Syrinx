// heard-as-equivalence-test.js — the live "Likely heard as" aggregation is
// the definition its constants were fitted on, and the windows it pools are
// still the ones the calibration assumed.
//
// Golden file: tests/ml/fixtures/heard-as-golden.json, written by
// scripts/heard-as/make_golden.mjs on the three committed lab fixtures
// (public LibriSpeech, upsampled to 48 kHz) through the production chain
// (real pitch worker, the gender worker's window schedule, decideMlWindow,
// the real utterance gate, the deployed classifier); its aggregates and
// shares are computed independently in Python (scripts/heard-as/golden_check.py).
//
//   1. src/ml/heard-as.js on the stored windows + pitch == the Python values
//      (meterLogit, lnF0 to 1e-9; the shares to 1e-12).
//   2. Window-set guard (no ONNX): replaying the chain gives exactly the
//      stored scored-window times and the stored posted pitch. A change to the
//      utterance gate, the pitch chain or decideMlWindow fails here.
//   3. Logits (optional): with the classifier in the transformers.js cache,
//      re-scoring the windows reproduces the stored logits within 1e-4;
//      otherwise SKIPPED.
//
//   node tests/ml/heard-as-equivalence-test.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHeardAsAggregator, heardAsShares } from "../../src/ml/heard-as.js";
import { HEARD_AS_CALIBRATION as C } from "../../src/ml/heardAsCalibration.js";
import { replay, readWav16, upsample16to48, loadClassifier } from "../../scripts/heard-as/chain.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const G = JSON.parse(readFileSync(path.join(here, "fixtures/heard-as-golden.json"), "utf8"));

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}
const REFIT = "the utterance gate, the pitch chain or decideMlWindow changed: re-run scripts/heard-as " +
  "(run_chain.mjs on the calibration sources; refit or confirm the constants in src/ml/heardAsCalibration.js — " +
  "measurements/heard-as-calibration-2026-10-07.md), then node scripts/heard-as/make_golden.mjs";

console.log("golden constants = shipped constants");
check("a / bMeter / bLnF0 / halfWidth / unsure", G.constants.a === C.a && G.constants.bMeter === C.bMeter && G.constants.bLnF0 === C.bLnF0
  && G.constants.halfWidth === C.halfWidth && G.constants.unsureK === C.unsureK && G.constants.unsureFloor === C.unsureFloor,
  "regenerate the golden file after changing the constants");

console.log("\n1. heard-as.js == the independent Python aggregate");
for (const [name, fx] of Object.entries(G.fixtures)) {
  const agg = createHeardAsAggregator({ windowMs: Infinity, minVoicedMs: 0, minWindows: 0 });
  for (const [ms, f0] of fx.pitch) agg.addPitch({ audioMs: ms, f0 });
  for (const [ms, logit, mode] of fx.windows) agg.addWindow({ audioMs: ms, logit, mode });
  const g = agg.aggregate(Infinity);
  const p = fx.python;
  check(`${name}: meterLogit`, Math.abs(g.meterLogit - p.meterLogit) <= 1e-9, `${g.meterLogit} vs ${p.meterLogit}`);
  check(`${name}: lnF0`, Math.abs(g.lnF0 - p.lnF0) <= 1e-9 && g.nVoicedFrames === p.nVoicedFrames && g.nWindows === p.nWindows,
    `${g.lnF0} vs ${p.lnF0}; ${g.nVoicedFrames} frames`);
  const s = heardAsShares(p.meterLogit, p.lnF0);
  const d = Math.max(Math.abs(s.eta - p.eta), Math.abs(s.s - p.s),
    ...[0, 1].flatMap((i) => [Math.abs(s.man[i] - p.man[i]), Math.abs(s.unsure[i] - p.unsure[i]), Math.abs(s.woman[i] - p.woman[i])]));
  check(`${name}: shares`, d <= 1e-12, `max |diff| ${d.toExponential(1)}`);
  // the live path (8 s trailing window at the stimulus end) sees the same 5 s stimulus
  const live = createHeardAsAggregator({ minVoicedMs: 0, minWindows: 0 });
  for (const [ms, f0] of fx.pitch) live.addPitch({ audioMs: ms, f0 });
  for (const [ms, logit, mode] of fx.windows) live.addWindow({ audioMs: ms, logit, mode });
  const end = fx.pitch[fx.pitch.length - 1][0];
  const e = live.estimate(end);
  check(`${name}: live estimate() at the stimulus end == the fit-time aggregate`,
    !e.hidden && e.meterLogit === g.meterLogit && e.lnF0 === g.lnF0, JSON.stringify(e));
}

console.log("\n2. window-set guard (production chain replay, no classifier)");
const wins = {};
for (const [name, fx] of Object.entries(G.fixtures)) {
  const { x } = readWav16(readFileSync(path.join(repo, "tests/resonance-lab/fixtures", `${name}.wav`)));
  const r = await replay(await upsample16to48(x), { sr: 48000 });
  wins[name] = r.windows;
  const sameW = r.windows.length === fx.windows.length && r.windows.every((w, i) => w.audioMs === fx.windows[i][0] && w.mode === fx.windows[i][2]);
  const sameP = r.pitch.length === fx.pitch.length && r.pitch.every((q, i) => q[0] === fx.pitch[i][0] && q[1] === fx.pitch[i][1]);
  check(`${name}: scored windows identical`, sameW, sameW ? `${r.windows.length} windows` : REFIT);
  check(`${name}: posted pitch identical`, sameP, sameP ? `${r.pitch.length} frames` : REFIT);
}

console.log("\n3. classifier logits (optional)");
const score = await loadClassifier().catch(() => null);
if (!score) {
  console.log("  SKIPPED: the q8-v2 classifier is not in the transformers.js cache (run tests/ml/perceived-voice-hillenbrand-test.js once)");
} else {
  for (const [name, fx] of Object.entries(G.fixtures)) {
    let maxd = 0;
    for (let i = 0; i < wins[name].length; i++) maxd = Math.max(maxd, Math.abs((await score(wins[name][i].win)) - fx.windows[i][1]));
    check(`${name}: logits within 1e-4`, maxd <= 1e-4, `max |diff| ${maxd.toExponential(1)}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
