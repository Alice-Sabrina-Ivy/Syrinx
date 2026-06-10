// pitch-paint-gate-test.js — Unit tests for the established-level
// excursion break (src/audio/pitchPaintGate.js), which suppresses the
// transient octave/harmonic excursions that paint as connected spike
// lines on the pitch trace.
//
// Usage: node tests/audio/pitch-paint-gate-test.js

import {
  createPaintGate,
  ONSET_CONFIRM_FRAMES,
  EXCURSION_SEMI,
  EXCURSION_SUSTAIN,
} from "../../src/audio/pitchPaintGate.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`); }
}

// Feed a constant level long enough to establish it (returns the gate).
function established(g, hz = 100, frames = 20) {
  for (let i = 0; i < frames; i++) g.push(hz);
  return g;
}

console.log("onset confirmation");
{
  const g = createPaintGate();
  const out = [];
  for (let i = 0; i < 5; i++) out.push(g.push(110));
  check(`first ${ONSET_CONFIRM_FRAMES} frames suppressed, then paints`,
    out.slice(0, ONSET_CONFIRM_FRAMES - 1).every((p) => p === false) && out[ONSET_CONFIRM_FRAMES - 1] === true && out[4] === true,
    out.join(","));
}

console.log("\nestablished level + normal prosody");
{
  const g = established(createPaintGate(), 100);
  // Normal speech prosody: ±5-7 st swings around the level all paint.
  check("+6 st prosody paints", g.push(100 * 2 ** (6 / 12)) === true);
  check("-7 st prosody paints", g.push(100 * 2 ** (-7 / 12)) === true);
}

console.log("\noctave excursion suppression (the spike-line bug)");
{
  const g = established(createPaintGate(), 100);
  // A 100 -> ~380 Hz harmonic lock, arriving as a median ramp (each step
  // < 12 st, which defeated the old consecutive-delta jump break). The
  // guarantee is that nothing OCTAVE-CLASS paints (no full-height spike
  // line) — a low ramp step still within prosody range (e.g. 140 ≈ 5.8 st)
  // may paint as a short stub, which is correct: it's indistinguishable
  // from real prosody until it climbs past the threshold.
  const ramp = [140, 200, 270, 340, 380, 380, 380, 380];
  const painted = ramp.filter((hz) => g.push(hz));
  const octaveClass = painted.filter((hz) => Math.abs(12 * Math.log2(hz / 100)) >= EXCURSION_SEMI);
  check("no octave-class excursion value paints (no full-height spike)",
    octaveClass.length === 0, `painted octave-class: ${octaveClass.join(",")}`);
  // Returning to the established level repaints (after onset re-confirm).
  const back = [];
  for (let i = 0; i < 4; i++) back.push(g.push(102));
  check("returns to painting at the established level", back[back.length - 1] === true);
}

console.log("\ngenuine sustained register change is accepted");
{
  const g = established(createPaintGate(), 100);
  const out = [];
  // Hold a new level an octave up for longer than EXCURSION_SUSTAIN.
  for (let i = 0; i < EXCURSION_SUSTAIN + 6; i++) out.push(g.push(205));
  check(`new level suppressed for >= EXCURSION_SUSTAIN frames then accepted`,
    out.slice(0, EXCURSION_SUSTAIN - 1).every((p) => p === false) && out[out.length - 1] === true,
    `accepted at frame ${out.indexOf(true)}`);
  check("level reseeds — further frames at the new level paint", g.push(205) === true);
}

console.log("\nsmooth glide is unaffected (steps stay within SEMI of moving level)");
{
  const g = established(createPaintGate(), 100);
  // Glide 100 -> 200 over ~1 s (40 frames): ~0.3 st/frame, far below SEMI.
  const out = [];
  for (let i = 1; i <= 40; i++) out.push(g.push(100 * 2 ** (i / 40)));
  check("glide paints throughout (no suppression)", out.every((p) => p === true),
    `suppressed ${out.filter((p) => !p).length}/40 frames`);
}

console.log("\nresetSegment keeps level; reset clears it");
{
  const g = established(createPaintGate(), 100);
  g.resetSegment();
  check("level persists across resetSegment (brief gap)", Math.abs(g.level() - 100) < 1);
  // After resetSegment, onset re-confirms but stays on the same level —
  // a post-gap octave excursion is still suppressed.
  const out = [120, 200, 380].map((hz) => g.push(hz));
  check("post-gap octave excursion still suppressed", out[2] === false);
  g.reset();
  check("level cleared after reset", g.level() === null);
}

console.log("\nconstants sane");
check("EXCURSION_SEMI between prosody max (9) and octave (12)", EXCURSION_SEMI > 9 && EXCURSION_SEMI < 12);
check("EXCURSION_SUSTAIN outlasts typical harmonic lock (>12 frames)", EXCURSION_SUSTAIN > 12);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
