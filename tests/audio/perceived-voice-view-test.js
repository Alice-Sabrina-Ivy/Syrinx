// perceived-voice-view-test.js — what the Perceived Voice meter shows
// (src/components/perceivedVoiceView.js): a number only while the newest
// score is fresh, "updating…" while an onset is being collected, "needs
// running speech" on held phonation, nothing otherwise.
//
//   node tests/audio/perceived-voice-view-test.js

import { perceivedVoiceView, SCORE_FRESH_MS } from "../../src/components/perceivedVoiceView.js";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const NOW = 100000;
const voicedGate = { voiced: true, holding: false };
const holdingGate = { voiced: false, holding: true };
const idleGate = { voiced: false, holding: false };
const score = (ageMs, value = 64) => ({ time: NOW - ageMs, score: value, confidence: 0.3 });
const state = (s) => ({ state: s, ts: NOW - 50 });
const view = (o) => perceivedVoiceView({ now: NOW, modelStatus: "ready", dspGate: voicedGate, newest: null, voiceState: null, ...o });

check("fresh window is about a second", SCORE_FRESH_MS >= 800 && SCORE_FRESH_MS <= 1500);

// Model status
check("loading -> no number", view({ modelStatus: "loading", newest: score(100) }).status === "loading");
check("error -> no number", view({ modelStatus: "error", newest: score(100) }).score === null);

// Silence / noise: nothing on screen
check("DSP gate idle -> nothing, even with a fresh score",
  view({ dspGate: idleGate, newest: score(100), voiceState: state("scoring") }).score === null);
check("worker hears no voice, no score -> listening",
  view({ voiceState: state("listening") }).status === "listening");
check("noise holding the DSP gate open, last score stale -> nothing (the old meter held it up to 6 s)",
  view({ newest: score(SCORE_FRESH_MS + 1), voiceState: state("listening") }).score === null);
check("...even 6 s later", view({ newest: score(5900), voiceState: state("pause") }).score === null);

// Scoring
const live = view({ newest: score(150, 71), voiceState: state("scoring") });
check("fresh score while scoring -> number, not dim", live.score === 71 && !live.dim && live.status === "scoring");
const brief = view({ dspGate: holdingGate, newest: score(600, 71), voiceState: state("pause") });
check("short pause -> last score stays, dimmed", brief.score === 71 && brief.dim);
check("fresh at exactly SCORE_FRESH_MS", view({ newest: score(SCORE_FRESH_MS), voiceState: state("pause") }).score === 64);
check("freshMs override (measurement sweeps)",
  view({ newest: score(1400), voiceState: state("pause"), freshMs: 1500 }).score === 64);

// Updating
check("onset being collected -> updating, no number",
  view({ voiceState: state("updating") }).status === "updating" && view({ voiceState: state("updating") }).score === null);
check("new utterance after a long pause: old score not reused",
  view({ newest: score(3000), voiceState: state("updating") }).score === null);
check("scoring but the score is late (slow inference) -> updating",
  view({ newest: score(2000), voiceState: state("scoring") }).status === "updating");
check("pause that never produced a score (noise blip) -> nothing, not 'updating'",
  view({ voiceState: state("pause") }).status === "listening");

// Held phonation
const held = view({ newest: score(100, 52), voiceState: state("sustained") });
check("sustained -> 'needs running speech', no number even if fresh", held.status === "sustained" && held.score === null);

// No worker state yet (model just loaded)
check("no state yet, no score -> listening", view({}).status === "listening");

console.log(failures === 0 ? "\nAll perceived-voice view checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
