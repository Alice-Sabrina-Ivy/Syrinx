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

// The resonance row's hold (K4, createVoiceHoldRef, confirmed 2026-11-01:
// measurements/resonance-row-hold-narrow-2026-11-01.md; it replaced C1's
// createResonanceHold of 2026-10-28): the 4 Hz tick runs it on the gated
// flags, the pitch level, the hook's throttled intensity, the resonance
// snapshot, the worker status and the clock, passes its answer to its own
// cueRowStates call and keeps it in the view; the render passes the view's
// answer. Never the raw voiced flag.
check("the tick creates the picked hold (createVoiceHoldRef) beside its trails, not C1's",
  /const hold = createVoiceHoldRef\(\);/.test(src) && !/createResonanceHold/.test(src));
check("the tick feeds it the gated flags, the level, intensity, the snapshot, the worker status and the clock",
  /const resonanceHold = hold\.tick\(\{ pitchVoiced: p\.pitchVoiced, pitchHolding: p\.pitchHolding, pitchLevel: p\.pitchLevel, intensity: p\.intensity, snap, workerStatus: p\.resonanceStatus, hasRef: !!ref \}, performance\.now\(\)\);/.test(src));
check("the tick's inputs (latest.current) carry intensity", lk.includes("intensity"), lk.join(","));
{
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\/\/[^\n]*/g, "");
  const dash = readFileSync(new URL("../../src/components/CombinedDashboard.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\/\/[^\n]*/g, "");
  const block = (s, tag) => s.match(new RegExp(`<${tag}\\b[^]*?\\/>`))?.[0] ?? "";
  check("App reads the hook's intensity and passes it to CombinedDashboard",
    /\n\s*intensity,\n[^]*?\} = useAudioPipeline\(\);/.test(app) && block(app, "CombinedDashboard").includes("intensity={intensity}"));
  check("CombinedDashboard passes intensity to CueStrip", /\n\s*intensity = null,\n/.test(dash) && block(dash, "CueStrip").includes("intensity={intensity}"));
  // What the hold reads from the hook (the hook itself is not changed by the
  // hold: the round's harness checked it bit for bit, narrow-freeze.json /
  // pause-row.mjs; a whole-file hash here would fail on any later, unrelated
  // hook change — review fix 2026-11-01): the throttled state's `intensity`
  // is the latest DSP frame's own level in every updater, null at start and
  // after stop(), and the hook returns the state.
  const hook = readFileSync(new URL("../../src/audio/useAudioPipeline.js", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\/\/[^\n]*/g, "");
  check("the hook's analysis handler takes intensity from the DSP frame", /const \{ intensity,[^}]*\} = data;/.test(hook));
  const updaters = [...hook.matchAll(/throttledSetState\(\(s\) => \(\{([^]*?)\}\)\);/g)].map((m) => m[1]);
  check("every throttled state update sets intensity from that frame (3 updaters)",
    updaters.length === 3 && updaters.every((b) => /\n\s*intensity,\n/.test(b)), `${updaters.length} updaters`);
  check("intensity is null in the initial state and after stop()",
    /useState\(\{\s*status: "idle",[^]*?\n\s*intensity: null,/.test(hook) && /setState\(\(s\) => \(\{\s*\.\.\.s,\s*status: "idle",[^]*?\n\s*intensity: null,/.test(hook));
  check("the hook returns its state (so intensity reaches App)", /return \{\s*\.\.\.state,/.test(hook));
}
const tickInputs = src.match(/const inputs = \{ \.\.\.p, ([^}]*)\}/);
check("the tick's cueRowStates inputs carry its resonanceHold", tickInputs && keysOf(tickInputs[1]).includes("resonanceHold"), tickInputs?.[1]);
check("the tick keeps resonanceHold in the view", /setView\(\{\s*snap,\s*resonanceHold,/.test(src));
check("the render passes the latest tick's hold", ik.includes("resonanceHold") && /resonanceHold: view\.resonanceHold/.test(src), ik.join(","));

check("the caption's \"ever spoke\" flag follows pitchVoiced", /if \(p\.pitchVoiced\) ever = true/.test(src) && !/p\.voiced\b/.test(src));
check("the caption text follows pitchVoiced", /view\.everVoiced \|\| pitchVoiced \?/.test(src));

// The screen-reader summaries (cueSummary; their words are checked in
// cue-strip-model-test.js) take each row's shown state from the tick's own
// cueRowStates call, hold included, so a held row is read as the last
// reading (2026-11-02 decision).
check("the 1 Hz summaries take each row's state from the tick's cueRowStates (hold included)",
  /const states = cueRowStates\(\{ \.\.\.inputs, hasRef: !!ref \}\);/.test(src)
  && /pitch: cueSummary\("pitch", \{ state: states\.pitch,/.test(src)
  && /resonance: cueSummary\("resonance", \{ state: states\.resonance,/.test(src));

// The resonance info popover (2026-11-02 decision): the microphone point is
// ONE sentence (it was two in a row: "Your microphone, room and distance
// shift the whole scale, so trust …" then "Readings depend on the microphone
// and how you hold or wear it, so compare yourself on one device, held or
// worn the same way.").
{
  const m = src.replace(/\r\n/g, "\n").match(/const RESONANCE_INFO =\n((?:\s*"(?:[^"\\\n]|\\.)*"\s*\+?)+);/);
  const info = m ? [...m[1].matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((x) => x[1]).join("") : "";
  const MIC = "Your microphone, how you hold or wear it, the room and distance all shift the whole scale, so compare yourself " +
    "on one device used the same way, and trust how the marker moves more than where it sits.";
  check("the resonance info text is found", info.length > 500, `${info.length} chars`);
  check("the resonance info says the microphone point once, in one sentence", info.split(MIC).length === 2, info);
  check("the two old microphone sentences are gone",
    !/Readings depend on/.test(info) && !/held or worn/.test(info) && (info.match(/whole scale/g) ?? []).length === 1
    && (info.match(/hold or wear/g) ?? []).length === 1);
  check("the sentences before and after it are unchanged",
    info.includes(`readings land outside their band about 1 time in 5. ${MIC} What you say moves it too, so judge a change over tens of seconds, not sentence by sentence.`));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
