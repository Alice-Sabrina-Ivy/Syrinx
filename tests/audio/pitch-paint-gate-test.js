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
import {
  pushAndMedianPitch,
  median,
  createSmoothingGapTracker,
  smoothingBufferFor,
  SMOOTH_RESET_GAP_FRAMES,
  SMOOTH_RESTART_SEMI,
} from "../../src/audio/pitchSmoothing.js";
import { createGateState, evaluateFrameGate } from "../../src/audio/pitchGate.js";

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
}
{
  // Octave-up on its own fresh gate: in the block above it would be the
  // SECOND frame after the accept (the x0.5 frame already refilled the ring),
  // which the old gate also suppressed (2026-10-04 review follow-up).
  const g = established(createPaintGate(), 110, 30);
  gap(g, REACQUIRE_GAP_FRAMES);
  for (let i = 0; i < REACQUIRE_SUSTAIN; i++) g.push(225);
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

console.log("\nraw-agreement accept + median restart (2026-10-04)");
{
  // The accepting frame's RAW pitch must be in the run's register: a
  // smoothed run whose raw value is already back on the old level (the
  // median carrying a lock one frame past its end) is not accepted.
  const g = established(createPaintGate(), 110, 30);
  gap(g, REACQUIRE_GAP_FRAMES);
  const out = [];
  for (let i = 0; i < REACQUIRE_SUSTAIN - 1; i++) out.push(g.push(225, { raw: 225 }));
  out.push(g.push(225, { raw: 110 }));
  check("accept refused while the raw value disagrees with the run", out.every((p) => !p));
  check("refused accept reports lastReason 'offlevel'", g.lastReason() === "offlevel");
  check("accept happens on the next frame whose raw value agrees", g.push(225, { raw: 225 }) === true);
  check("level moved to the new register", Math.abs(g.level() - 225) < 2, `level ${g.level()}`);
}
{
  // raw omitted (callers that feed raw values directly): unchanged contract.
  const g = established(createPaintGate(), 110, 30);
  gap(g, REACQUIRE_GAP_FRAMES);
  const out = []; for (let i = 0; i < REACQUIRE_SUSTAIN; i++) out.push(g.push(225));
  check("without raw, re-acquisition accepts on frame REACQUIRE_SUSTAIN as before", firstTrue(out) === REACQUIRE_SUSTAIN - 1);
}
{
  // Mid-segment: an EXCURSION_SUSTAIN-length run is accepted only if the
  // raw value of its last frame agrees.
  const a = established(createPaintGate(), 100);
  const outA = []; for (let i = 0; i < EXCURSION_SUSTAIN; i++) outA.push(a.push(205, { raw: 205 }));
  check(`mid-segment run accepted on frame EXCURSION_SUSTAIN (${EXCURSION_SUSTAIN})`, firstTrue(outA) === EXCURSION_SUSTAIN - 1,
    `first paint at ${firstTrue(outA)}`);
  const b = established(createPaintGate(), 100);
  const outB = []; for (let i = 0; i < EXCURSION_SUSTAIN - 1; i++) outB.push(b.push(205, { raw: 205 }));
  outB.push(b.push(205, { raw: 100 }));
  check("mid-segment run whose last raw value is back on the level is not accepted", outB.every((p) => !p));
}

// The hook's display chain (useAudioPipeline.js handleAnalysisResult):
// gap tracker, median restart (smoothingBufferFor), median-3, paint gate with
// the raw value. seq entries: a number = a frame with a fresh detection,
// null = a frame without one. Returns the painted value per frame (0 = not
// painted).
//   gap: "quiet" (default) — null frames are quiet audio (-70 dB, conf 0.2)
//          run through the real evaluateFrameGate: its 3-frame silence
//          debounce makes the first 2 frames of a gap HELD frames
//          (push(median, { fresh: false })), later ones silence
//          (resetSegment; the buffer drops once the 400 ms hold expires);
//        "loud" — null frames are loud unvoiced audio (-38 dB): held while
//          the 400 ms pitch hold lasts, then a trace break (buffer dropped);
//        "reset" — the pre-review model: every null frame is resetSegment()
//          (no held frames; kept so the gate-only reasoning stays covered).
//   restart: "shipped" (smoothingBufferFor), "none" (pre-2026-10-04: no
//          restart), "df497b9" (the first version: clear the buffer after
//          every >= 2-frame gap — reproduces the review defect).
function chain(seq, { gap = "quiet", restart = "shipped" } = {}) {
  const g = createPaintGate(); const tr = createSmoothingGapTracker(); const gs = createGateState();
  let buf = [];
  const fresh = (raw, afterGap) => {
    if (restart === "shipped") buf = smoothingBufferFor(buf, raw, afterGap);
    else if (restart === "df497b9" && afterGap) buf = [];
    const sm = pushAndMedianPitch(buf, raw);
    return g.push(sm, { raw }) ? sm : 0;
  };
  return seq.map((raw, i) => {
    const afterGap = tr.frame(raw !== null);
    if (gap === "reset") {
      if (raw === null) { g.resetSegment(); return 0; }
      return fresh(raw, afterGap);
    }
    const now = 1e6 + i * 25;
    const fr = evaluateFrameGate(gs, raw !== null
      ? { now, intensity: -28, pitch: raw, confidence: 0.8, pitchTs: now }
      : { now, intensity: gap === "quiet" ? -70 : -38, pitch: null, confidence: 0.2, pitchTs: now });
    if (fr.isQuiet) {
      g.resetSegment();
      if (!fr.holdAllowed) buf = [];
      return 0;
    }
    if (fr.hasPitch) return fresh(fr.pitch, afterGap);
    if (fr.holdAllowed && buf.length > 0) {
      const sm = median(buf);
      return g.push(sm, { fresh: false }) ? sm : 0;
    }
    buf = []; g.resetSegment(); return 0;
  });
}
const GAP_MODES = ["quiet", "loud", "reset"];
const rep = (hz, n) => Array(n).fill(hz);
const gapN = (n) => Array(n).fill(null);
const fmt = (a) => a.map((v) => Math.round(v)).join(",");
// Pickup assertions through every gap model — the held-gap path ("quiet":
// a 2-frame gap is two held frames under the silence debounce; "loud": held
// for the whole gap) is what the hook actually does for short gaps.
for (const gm of GAP_MODES) {
  const tag = `chain[${gm}]`;
  {
    // Safety voice -> target voice across a word gap (the reported case).
    const pre = rep(110, 30);
    const seq = [...pre, ...gapN(REACQUIRE_GAP_FRAMES), ...rep(225, 12)];
    const out = chain(seq, { gap: gm }).slice(pre.length + REACQUIRE_GAP_FRAMES);
    check(`${tag}: target word after a gap paints on its frame ${REACQUIRE_SUSTAIN} (median restarted)`,
      out.findIndex((v) => v > 0) === REACQUIRE_SUSTAIN - 1, `painted ${fmt(out)}`);
    check(`${tag}: no frame of the target word paints the previous register`, out.every((v) => v === 0 || v > 160), fmt(out));
    const old = chain(seq, { gap: gm, restart: "none" }).slice(pre.length + REACQUIRE_GAP_FRAMES);
    check(`${tag}: without the restart it is a frame slower (the 2026-10-03 behaviour)`,
      old.findIndex((v) => v > 160) === REACQUIRE_SUSTAIN, fmt(old));
  }
  {
    // Symmetric: target -> low voice.
    const pre = rep(225, 30);
    const out = chain([...pre, ...gapN(REACQUIRE_GAP_FRAMES), ...rep(110, 12)], { gap: gm }).slice(pre.length + REACQUIRE_GAP_FRAMES);
    check(`${tag}: low word after a gap re-acquired just as fast (gender-symmetric)`,
      out.findIndex((v) => v > 0) === REACQUIRE_SUSTAIN - 1 && out.every((v) => v === 0 || v < 160), fmt(out));
  }
  {
    // Post-gap onset harmonic locks of REACQUIRE_SUSTAIN-1 frames never
    // paint, although the restarted median carries them for
    // REACQUIRE_SUSTAIN frames — the raw check refuses the last one.
    for (const gapLen of [REACQUIRE_GAP_FRAMES, 4]) {
      for (const mul of [2, 3, 0.5]) {
        const base = mul < 1 ? 225 : 110;
        const pre = rep(base, 30);
        const out = chain([...pre, ...gapN(gapLen), ...rep(base * mul, REACQUIRE_SUSTAIN - 1), ...rep(base, 10)], { gap: gm }).slice(pre.length + gapLen);
        check(`${tag}: ${gapLen}-frame gap, ${REACQUIRE_SUSTAIN - 1}-frame x${mul} onset lock does not paint; true pitch paints after it`,
          out.every((v) => v === 0 || Math.abs(12 * Math.log2(v / base)) < EXCURSION_SEMI) && out[out.length - 1] > 0, fmt(out));
      }
    }
  }
}
{
  // Mid-word locks of up to EXCURSION_SUSTAIN raw frames never paint; a
  // run of EXCURSION_SUSTAIN + 1 is accepted as a register (its tail paints).
  for (const [len, paints] of [[4, false], [EXCURSION_SUSTAIN, false], [EXCURSION_SUSTAIN + 1, true]]) {
    const pre = rep(110, 30);
    const out = chain([...pre, ...rep(220, len), ...rep(110, 12)]).slice(pre.length);
    const oct = out.filter((v) => v > 160).length;
    check(`chain: mid-word ${len}-frame x2 lock ${paints ? "is accepted (tail paints)" : "never paints"}`,
      paints ? oct > 0 : oct === 0, `octave frames painted ${oct}`);
  }
}

console.log("\nheld-gap median restart: painted values are real, 1-frame flips never paint (review fix 2026-10-04)");
{
  // The review defect, reproduced through the real frame gate: a 2-frame
  // quiet gap is two HELD frames (silence debounce), which do not reset the
  // paint gate's onset streak; the df497b9 restart cleared the median, so the
  // 2nd fresh frame painted the MEAN of 110 and a 1-frame 220 flip (165) —
  // a value no detector frame posted.
  for (const gm of ["quiet", "loud"]) {
    const pre = rep(110, 30);
    const seq = [...pre, ...gapN(2), 110, 220, ...rep(110, 8)];
    const bad = chain(seq, { gap: gm, restart: "df497b9" }).slice(pre.length + 2);
    check(`[${gm}] defect reproduced: the df497b9 restart paints 165 = mean(110, 220)`, bad.some((v) => Math.abs(v - 165) < 0.01), fmt(bad));
    const out = chain(seq, { gap: gm }).slice(pre.length + 2);
    check(`[${gm}] shipped: the 1-frame 220 flip after a 2-frame held gap never paints, nor any value between`,
      out.every((v) => v === 0 || v === 110), fmt(out));
    check(`[${gm}] shipped: the word keeps painting (no blank introduced)`, out.every((v) => v === 110), fmt(out));
  }
}
{
  // A 1-frame ON-level outlier as the first frame after a 2-frame held gap
  // (x1.5 = 7 st and +5.4 st, both inside EXCURSION_SEMI so the gate cannot
  // catch them) must not paint: it does not trigger a restart, so the median
  // still has the previous word's values. The df497b9 restart painted it.
  for (const gm of ["quiet", "loud"]) {
    for (const hz of [165, 150]) {
      const pre = rep(110, 30);
      const seq = [...pre, ...gapN(2), hz, ...rep(110, 8)];
      const out = chain(seq, { gap: gm }).slice(pre.length + 2);
      check(`[${gm}] 1-frame on-level ${hz} Hz outlier after a 2-frame held gap does not paint`,
        !out.includes(hz) && out[out.length - 1] === 110, fmt(out));
      const bad = chain(seq, { gap: gm, restart: "df497b9" }).slice(pre.length + 2);
      check(`[${gm}] (control) the df497b9 restart painted the ${hz} Hz outlier`, bad.includes(hz), fmt(bad));
    }
  }
}
{
  // A 1-frame octave flip as the first frame after a held gap triggers a
  // restart (seeded [flip]) but stays unpainted, and the true pitch returns.
  for (const gm of ["quiet", "loud"]) {
    for (const [base, flip] of [[110, 220], [225, 112.5]]) {
      const pre = rep(base, 30);
      const out = chain([...pre, ...gapN(2), flip, ...rep(base, 10)], { gap: gm }).slice(pre.length + 2);
      check(`[${gm}] 1-frame ${flip} Hz octave flip opening a word after a held gap never paints; ${base} Hz resumes`,
        out.every((v) => v === 0 || v === base) && out[out.length - 1] === base, fmt(out));
    }
  }
}
{
  // Property: across random sequences (registers 110/225, octave and fifth
  // flips, gaps of 1-6 frames in every gap model), every painted value is
  // one of the posted detections — never strictly between two of them.
  let s = 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const vals = [110, 112, 116];
  let worst = null, worstDf = null, nPaint = 0;
  for (let t = 0; t < 300; t++) {
    const seq = [];
    while (seq.length < 120) {
      if (rnd() < 0.25) { for (let k = 1 + Math.floor(rnd() * 6); k > 0; k--) seq.push(null); continue; }
      const base = rnd() < 0.5 ? 1 : 225 / 110;
      for (let k = 2 + Math.floor(rnd() * 10); k > 0; k--) {
        const r = rnd();
        const v = vals[Math.floor(rnd() * vals.length)] * base;
        seq.push(r < 0.08 ? v * 2 : r < 0.16 ? v / 2 : r < 0.2 ? v * 1.5 : v);
      }
    }
    const posted = new Set(seq.filter((v) => v !== null));
    const gm = GAP_MODES[t % 3];
    chain(seq, { gap: gm }).forEach((v) => {
      if (v > 0) { nPaint++; if (!posted.has(v) && !worst) worst = `${gm} trial ${t}: painted ${v}`; }
    });
    chain(seq, { gap: gm, restart: "df497b9" }).forEach((v) => { if (v > 0 && !posted.has(v) && !worstDf) worstDf = `${v}`; });
  }
  check(`property: every painted value is a posted detection (300 random sequences, ${nPaint} painted frames)`, worst === null, worst ?? "");
  check("property check is sensitive: the df497b9 restart paints a non-posted value", worstDf !== null, worstDf ?? "none found");
}
{
  // smoothingBufferFor unit contract.
  const b = [110, 112, 111];
  check("buffer: empty -> seeded [x]", smoothingBufferFor([], 200, false).join(",") === "200");
  check("buffer: on-level value after a gap keeps the buffer", smoothingBufferFor(b, 150, true) === b);
  check("buffer: octave-class value after a gap restarts, seeded", smoothingBufferFor(b, 222, true).join(",") === "222");
  check("buffer: octave-class value without a gap keeps the buffer", smoothingBufferFor(b, 222, false) === b);
  const buf = smoothingBufferFor(b, 222, true);
  const meds = [222, 230, 226].map((x) => pushAndMedianPitch(buf, x));
  check("buffer: restarted medians are real detections (x1, x1, median of 3)", meds.join(",") === "222,222,226", meds.join(","));
}
{
  // The tracker: afterGap only after >= SMOOTH_RESET_GAP_FRAMES frames
  // without a fresh detection; a single dropped frame does not count.
  const tr = createSmoothingGapTracker();
  const out = [true, false, true, false, false, true, true].map((h) => tr.frame(h));
  check("tracker: 1-frame gap is not a gap, 2-frame gap flags the next fresh frame once",
    out.join(",") === "false,false,false,false,false,true,false", out.join(","));
  tr.frame(false); tr.frame(false); tr.reset();
  check("tracker: reset() forgets a pending gap", tr.frame(true) === false);
}

console.log("\nconstants sane");
check("EXCURSION_SEMI between prosody max (9) and octave (12)", EXCURSION_SEMI > 9 && EXCURSION_SEMI < 12);
// 7 since 2026-10-04 (was 8): with the raw-agreement accept a mid-word lock
// must last >= EXCURSION_SUSTAIN + 1 raw frames to paint (see the chain tests).
check("EXCURSION_SUSTAIN outlasts the median harmonic lock (4 frames) with margin", EXCURSION_SUSTAIN >= 7);
check("median restart uses the same gap notion as re-acquisition", SMOOTH_RESET_GAP_FRAMES === REACQUIRE_GAP_FRAMES);
check("median restart threshold = the gate's off-level threshold", SMOOTH_RESTART_SEMI === EXCURSION_SEMI);
check("REACQUIRE_SUSTAIN outlasts a 3-frame onset lock and is below EXCURSION_SUSTAIN",
  REACQUIRE_SUSTAIN > ONSET_CONFIRM_FRAMES && REACQUIRE_SUSTAIN < EXCURSION_SUSTAIN);
check("REACQUIRE_GAP_FRAMES ignores single dropped frames", REACQUIRE_GAP_FRAMES >= 2);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
