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
  REACQUIRE_GAP_FRAMES,
  REACQUIRE_SUSTAIN,
  REACQUIRE_WINDOW,
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
const gap = (g, n) => { for (let i = 0; i < n; i++) g.resetSegment(); };
const firstTrue = (arr) => arr.indexOf(true);

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

console.log("\nfast wide glide recovers while the target note is held (offRun windowing)");
{
  // Regression (2026-07-19): a fast ~2-octave siren (+24 st in 16
  // frames) puts off-level values spanning >= EXCURSION_SEMI into the
  // candidate run. Unwindowed, those mid-glide values inflated the
  // min-max consistency check forever — the held target note stayed
  // suppressed until the next unvoiced gap. Windowed to the last
  // EXCURSION_SUSTAIN values, the run empties of glide values once the
  // target holds, and painting resumes within ~EXCURSION_SUSTAIN frames.
  const g = established(createPaintGate(), 110, 30);
  for (let i = 1; i <= 16; i++) g.push(110 * 2 ** (24 * i / 16 / 12));
  const target = 110 * 2 ** (24 / 12); // 440
  const hold = [];
  for (let i = 0; i < 40; i++) hold.push(g.push(target));
  const firstPaint = hold.indexOf(true);
  check(`held siren target paints within ~EXCURSION_SUSTAIN frames (got ${firstPaint})`,
    firstPaint !== -1 && firstPaint <= EXCURSION_SUSTAIN);
  check("target keeps painting once accepted (level reseeded)",
    hold.slice(firstPaint + 1).every((p) => p === true));
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

console.log("\nheld values never feed the gate (2026-10-03)");
{
  // A held (stale) value an octave off the level must neither paint nor
  // move the level, however long the hold lasts.
  const g = established(createPaintGate(), 100);
  const out = [];
  for (let i = 0; i < 30; i++) out.push(g.push(205, { fresh: false }));
  check("held off-level values never paint", out.every((p) => p === false));
  check("held values do not move the level", Math.abs(g.level() - 100) < 1, `level ${g.level()}`);
  check("held value reports lastReason 'hold'", g.lastReason() === "hold");
}
{
  // On-level held values still bridge the trace once continuity is confirmed...
  const g = established(createPaintGate(), 100);
  check("held on-level value bridges (paints)", g.push(101, { fresh: false }) === true);
  // ...but not right after a break (no continuity yet).
  g.resetSegment();
  check("held value right after a break does not paint", g.push(101, { fresh: false }) === false);
}

console.log("\npost-gap register re-acquisition (2026-10-03)");
{
  // Safety voice -> target voice across a word gap: accepted after
  // REACQUIRE_SUSTAIN frames instead of EXCURSION_SUSTAIN.
  const g = established(createPaintGate(), 110, 30);
  gap(g, REACQUIRE_GAP_FRAMES);
  const out = []; for (let i = 0; i < 12; i++) out.push(g.push(225));
  check(`target word after a ${REACQUIRE_GAP_FRAMES}-frame gap paints at frame ${REACQUIRE_SUSTAIN}`,
    firstTrue(out) === REACQUIRE_SUSTAIN - 1, `first paint at ${firstTrue(out)}`);
  check("keeps painting after re-acquisition", out.slice(REACQUIRE_SUSTAIN - 1).every((p) => p));
  check("level moved to the new register", Math.abs(g.level() - 225) < 2, `level ${g.level()}`);
}
{
  // Symmetric (transmasculine direction): target -> low voice.
  const g = established(createPaintGate(), 225, 30);
  gap(g, REACQUIRE_GAP_FRAMES);
  const out = []; for (let i = 0; i < 12; i++) out.push(g.push(110));
  check("low word after a gap re-acquired just as fast (gender-symmetric)",
    firstTrue(out) === REACQUIRE_SUSTAIN - 1, `first paint at ${firstTrue(out)}`);
}
{
  // 2026-10-04 review finding: a re-acquisition accept left only
  // REACQUIRE_SUSTAIN (4) values in the level ring, under the 5 the level
  // needs, so the very next frame was ungated and painted ANY value — an
  // octave error included. The level must be defined right after the accept.
  const g = established(createPaintGate(), 110, 30);
  gap(g, REACQUIRE_GAP_FRAMES);
  const acc = []; for (let i = 0; i < REACQUIRE_SUSTAIN; i++) acc.push(g.push(225));
  check("re-acquisition accept paints on its last frame", acc[REACQUIRE_SUSTAIN - 1] === true);
  check("level defined immediately after the accept", g.level() !== null && Math.abs(g.level() - 225) < 2,
    `level ${g.level()}`);
  check("octave-down frame right after the accept is suppressed", g.push(112.5) === false);
  check("octave-up frame right after the accept is suppressed", g.push(450) === false);
}
{
  const g = established(createPaintGate(), 110, 30);
  gap(g, REACQUIRE_GAP_FRAMES);
  for (let i = 0; i < REACQUIRE_SUSTAIN; i++) g.push(225);
  check("on-level frame right after the accept keeps painting", g.push(226) === true);
}
{
  // Same with a slightly wobbly accepted run: the pad value is the run's median.
  const g = established(createPaintGate(), 110, 30);
  gap(g, REACQUIRE_GAP_FRAMES);
  [222, 228, 224, 226].forEach((hz) => g.push(hz));
  check("pad uses the accepted run's median", Math.abs(g.level() - 226) < 0.01, `level ${g.level()}`);
  check("x0.5 of a wobbly accepted run is suppressed", g.push(113) === false);
}
{
  // Held frames count as gap frames (consonant bridged by the pitch hold).
  const g = established(createPaintGate(), 110, 30);
  for (let i = 0; i < REACQUIRE_GAP_FRAMES; i++) g.push(110, { fresh: false });
  const out = []; for (let i = 0; i < 12; i++) out.push(g.push(225));
  check("held frames arm re-acquisition like a gap", firstTrue(out) === REACQUIRE_SUSTAIN - 1,
    `first paint at ${firstTrue(out)}`);
}
{
  // A single dropped frame does NOT arm it (mid-word voicing flicker).
  const g = established(createPaintGate(), 110, 30);
  gap(g, REACQUIRE_GAP_FRAMES - 1);
  const out = []; for (let i = 0; i < EXCURSION_SUSTAIN + 4; i++) out.push(g.push(225));
  check(`shorter gap: needs the full EXCURSION_SUSTAIN (${EXCURSION_SUSTAIN})`,
    firstTrue(out) === EXCURSION_SUSTAIN - 1, `first paint at ${firstTrue(out)}`);
}
{
  // Onset harmonic lock right after a gap (REACQUIRE_SUSTAIN-1 frames at
  // 2x / 3x) stays suppressed — the level is kept, not cleared.
  for (const mul of [2, 3]) {
    const g = established(createPaintGate(), 110, 30);
    gap(g, 4);
    const lock = []; for (let i = 0; i < REACQUIRE_SUSTAIN - 1; i++) lock.push(g.push(110 * mul));
    const back = []; for (let i = 0; i < 6; i++) back.push(g.push(110));
    check(`post-gap ${REACQUIRE_SUSTAIN - 1}-frame x${mul} onset lock does not paint`, lock.every((p) => !p));
    check(`true pitch paints after the lock (x${mul})`, back[back.length - 1] === true);
  }
}
{
  // The short sustain only covers the first REACQUIRE_WINDOW painted frames
  // after the gap; later in the segment a lock needs the full
  // EXCURSION_SUSTAIN (mid-word protection unchanged).
  const g = established(createPaintGate(), 110, 30);
  gap(g, REACQUIRE_GAP_FRAMES);
  for (let i = 0; i < ONSET_CONFIRM_FRAMES - 1 + REACQUIRE_WINDOW; i++) g.push(110);
  const out = []; for (let i = 0; i < REACQUIRE_SUSTAIN + 1; i++) out.push(g.push(220));
  check("after the window, a REACQUIRE_SUSTAIN-length lock is suppressed", out.every((p) => !p));
}
{
  // Mid-segment harmonic lock of median length (4 frames) never paints.
  const g = established(createPaintGate(), 100);
  const out = [300, 300, 300, 300].map((hz) => g.push(hz));
  check("mid-segment 4-frame x3 lock suppressed", out.every((p) => !p));
  check("suppressed fresh off-level value reports lastReason 'offlevel'", g.lastReason() === "offlevel");
  g.push(100); g.push(100);
  check("lastReason 'paint' once painting resumes", g.push(100) === true && g.lastReason() === "paint");
}

console.log("\nconstants sane");
check("EXCURSION_SEMI between prosody max (9) and octave (12)", EXCURSION_SEMI > 9 && EXCURSION_SEMI < 12);
check("EXCURSION_SUSTAIN outlasts the median harmonic lock (4 frames) by 2x", EXCURSION_SUSTAIN >= 8);
check("REACQUIRE_SUSTAIN outlasts a 3-frame onset lock and is below EXCURSION_SUSTAIN",
  REACQUIRE_SUSTAIN > ONSET_CONFIRM_FRAMES && REACQUIRE_SUSTAIN < EXCURSION_SUSTAIN);
check("REACQUIRE_GAP_FRAMES ignores single dropped frames", REACQUIRE_GAP_FRAMES >= 2);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
