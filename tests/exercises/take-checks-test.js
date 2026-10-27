// take-checks-test.js — what a lesson says about a take (src/exercises/takeChecks.js) and
// "Test your ear" (src/exercises/guess.js), with plain frames and a seeded random.
//   - the voice count: frames with a pitch, minus the ones the voice gate hid; 25 ms each
//   - a take's pitch: the median voiced f0, only with at least TRY_PITCH_MIN_S of voice
//   - notes: "short" under the card's minimum (default 1 s) and nothing else — the
//     pre-registered voice check stopped (measurements/exercise-take-checks-2026-10-27.md)
//   - the guess round: A / B in either order, R4's change from the direction's list, which
//     one is brighter for a brighter and a darker change
//
//   node tests/exercises/take-checks-test.js
import * as takeChecks from "../../src/exercises/takeChecks.js";
import { newGuessRound, markPlayed, brighterIndex } from "../../src/exercises/guess.js";
import { LESSONS, takesFor, hearShifts } from "../../src/exercises/lessons.js";

const { createTakeVoiceLog, takeNote, takePitchHz, TRY_PITCH_MIN_S, DEFAULT_MIN_S } = takeChecks;
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

console.log("the voice in a take");
{
  const log = createTakeVoiceLog();
  for (let i = 0; i < 40; i++) log.push({ voiced: true, f0: 200 + (i % 5), voiceGate: "voice" }); // 1.0 s
  for (let i = 0; i < 20; i++) log.push({ voiced: true, f0: 300, voiceGate: "hidden" });        // hidden by the gate
  for (let i = 0; i < 20; i++) log.push({ voiced: false, f0: null });                            // silence
  log.push({ voiced: true, f0: 0 });                                                              // no pitch
  log.push(null);
  const st = log.stats();
  check("voice = voiced frames with a pitch the gate didn't hide, 25 ms each", st.voicedS === 1, String(st.voicedS));
  check("every frame is counted as a frame", st.frames === 81, String(st.frames));
  check("the pitch is the median of the counted frames (hidden ones left out)", st.medianHz === 202, String(st.medianHz));
}
{
  const log = createTakeVoiceLog();
  for (let i = 0; i < 39; i++) log.push({ voiced: true, f0: 180 });
  check(`no pitch under ${TRY_PITCH_MIN_S} s of voice`, log.stats().medianHz === null && log.stats().voicedS === 0.98);
  const noGate = createTakeVoiceLog();
  for (let i = 0; i < 40; i++) noGate.push({ voiced: true, f0: 150 });
  check("with no gate decision every voiced frame counts", noGate.stats().voicedS === 1 && noGate.stats().medianHz === 150);
}

console.log("\nnotes");
{
  const voice = (s) => ({ voicedS: s, medianHz: 200, frames: 100 });
  check(`"short" under the default ${DEFAULT_MIN_S} s`, takeNote({ seconds: 0.8, voice: voice(0.7) }) === "short");
  check("a card's own minimum (R4's try: 3 s)", takeNote({ seconds: 2.5, voice: voice(2) }, { minS: 3 }) === "short"
    && takeNote({ seconds: 3.2, voice: voice(2) }, { minS: 3 }) === null);
  check("no voice note at all, even with no voice (the measured check stopped)", takeNote({ seconds: 2, voice: voice(0) }, { minS: 1 }) === null
    && !("VOICE_MIN_S" in takeChecks));
  check("a take's pitch in whole Hz, or none", takePitchHz({ voice: { medianHz: 182.6 } }) === 183 && takePitchHz({ voice: { medianHz: null } }) === null && takePitchHz(null) === null);
}

console.log("\nthe lessons' take specs");
{
  const spec = (id, dir = "feminine") => ["R2", "R3", "R4"].map((L) => takesFor(LESSONS[L], dir)).flat().find((t) => t.id === id);
  check("R2 / R3 takes: the default 1 s minimum, no voice field", ["big", "little", "bright", "dark"].every((id) => spec(id).minS == null && !("voice" in spec(id)))
    && spec("middle", "androgynous").minS == null);
  check("R4's try: 3 s minimum (the sentence twice), its pitch shown", spec("try").minS === 3 && spec("try").pitch === true && !("voice" in spec("try")));
}

console.log("\ntest your ear");
function seeded(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; }; }
{
  const r3 = LESSONS.R3.cards.find((c) => c.kind === "guess");
  const orders = new Set();
  const rand = seeded(7);
  for (let i = 0; i < 40; i++) orders.add(newGuessRound(r3, [], rand).order.join(","));
  check("R3: the bright / dark takes, in both orders over rounds", orders.has("bright,dark") && orders.has("dark,bright") && orders.size === 2, [...orders].join(" "));
  const round = newGuessRound(r3, [], () => 0.1);
  check("a new round: nothing played, nothing picked", round.pick === null && round.played.join() === "false,false" && round.shift === null);
  const p = markPlayed(markPlayed(round, 1), 1);
  check("playing B marks B (again: unchanged)", p.played.join() === "false,true" && markPlayed(p, 1) === p);
}
{
  const r4 = LESSONS.R4.cards.find((c) => c.kind === "guess");
  const fem = newGuessRound(r4, hearShifts("feminine"), seeded(3));
  check("R4: the unchanged rebuild vs the direction's change", fem.order.includes("unchanged") && fem.order.includes("shift10") && fem.shift === 10);
  const shifts = new Set();
  const rand = seeded(11);
  for (let i = 0; i < 40; i++) shifts.add(newGuessRound(r4, hearShifts("androgynous"), rand).shift);
  check("R4 with two changes: both come up", shifts.has(10) && shifts.has(-10) && shifts.size === 2, [...shifts].join(" "));
  check("brighter: the changed one when it moved brighter", brighterIndex({ order: ["unchanged", "shift10"], shift: 10 }) === 1
    && brighterIndex({ order: ["shift10", "unchanged"], shift: 10 }) === 0);
  check("brighter: the unchanged one when the change moved darker", brighterIndex({ order: ["unchanged", "shift-10"], shift: -10 }) === 0
    && brighterIndex({ order: ["shift-10", "unchanged"], shift: -10 }) === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
