// steadiness-test.js — unit tests for src/audio/steadiness.js, the live
// pitch-steadiness readout (1-s SD of the posted pitch, in semitones).
// Decision data: measurements/steadiness-readout-2026-10-04.md.
//
// Usage: node tests/audio/steadiness-test.js

import {
  createSteadinessTracker,
  trimmedSpread,
  formatSteadiness,
  hzToSemitones,
  STEADINESS_DEFAULTS,
  HOLD_SEC,
  SPREAD_OK,
  SPREAD_FEW,
  SPREAD_REFUSED,
} from "../../src/audio/steadiness.js";

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
const near = (a, b, tol) => typeof a === "number" && Math.abs(a - b) <= tol;
const HOP = 0.025;

// Feed f(t) (Hz or null) at the production 25 ms cadence from t0 for
// `dur` seconds; returns the read() result after every message.
function feed(tr, f, dur, t0 = 0) {
  const out = [];
  const n = Math.round(dur / HOP);
  for (let k = 1; k <= n; k++) {
    const t = t0 + k * HOP;
    tr.push(f(t), t);
    out.push({ t, ...tr.read() });
  }
  return out;
}
const popSd = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };

console.log("formatSteadiness");
check("null / NaN → null", formatSteadiness(null) === null && formatSteadiness(NaN) === null && formatSteadiness(undefined) === null);
check("below the 0.1 st noise floor → '<0.1'", formatSteadiness(0.04) === "<0.1" && formatSteadiness(0.0) === "<0.1");
check("one decimal", formatSteadiness(0.44) === "0.4" && formatSteadiness(0.65) === "0.7" && formatSteadiness(1.26) === "1.3");
check("large values without decimals", formatSteadiness(12.3) === "12");

console.log("trimmedSpread");
{
  const flat = new Float64Array(40).fill(hzToSemitones(220));
  check("constant pitch → 0", near(trimmedSpread(flat, 40), 0, 1e-9));
  const alt = Float64Array.from({ length: 40 }, (_, i) => 50 + (i % 2 ? 0.5 : -0.5));
  check("±0.5 st alternation → 0.5", near(trimmedSpread(alt, 40), 0.5, 1e-12));
  check("fewer than minValues → null", trimmedSpread(alt, STEADINESS_DEFAULTS.minValues - 1) === null);

  // 3 octave-class frames out of 40 (7.5 %): inner trim drops them, the
  // reading is the steady note's own spread.
  const oct = Float64Array.from(alt); oct[5] += 12; oct[17] -= 12; oct[30] += 12;
  const steadyPart = Array.from(alt).filter((_, i) => i !== 5 && i !== 17 && i !== 30);
  check("isolated octave errors are trimmed", near(trimmedSpread(oct, 40), popSd(steadyPart), 1e-12),
    `got ${trimmedSpread(oct, 40)}`);
  check("…untrimmed they would dominate", popSd(Array.from(oct)) > 2.5);

  // A register switch inside the window: 30 % of the values an octave up.
  // Neither trim may silently report the majority note as "steady".
  const sw = Float64Array.from({ length: 40 }, (_, i) => 50 + (i >= 28 ? 12 : 0) + 0.1 * Math.sin(i));
  check("register switch (30 % an octave away) → null", trimmedSpread(sw, 40) === null);
  const info = {};
  trimmedSpread(sw, 40, STEADINESS_DEFAULTS, null, info);
  check("…reason: refused by the trim", info.reason === SPREAD_REFUSED, `got ${info.reason}`);
  trimmedSpread(alt, 40, STEADINESS_DEFAULTS, null, info);
  check("reason ok for a qualifying window", info.reason === SPREAD_OK, `got ${info.reason}`);
  trimmedSpread(alt, STEADINESS_DEFAULTS.minValues - 1, STEADINESS_DEFAULTS, null, info);
  check("reason few below minValues", info.reason === SPREAD_FEW, `got ${info.reason}`);
  const before = Float64Array.from(oct);
  trimmedSpread(oct, 40, STEADINESS_DEFAULTS, new Float64Array(64));
  check("input values not modified (sort happens in scratch)", oct.every((v, i) => v === before[i]));

  // A genuinely wide window (a slow 8-st slide) is not refused: the outer
  // (octave-class) trim keeps everything and reports the real spread.
  const ramp = Float64Array.from({ length: 40 }, (_, i) => 50 - 4 + (8 * i) / 39);
  check("wide slide → real spread via the outer trim", near(trimmedSpread(ramp, 40), popSd(Array.from(ramp)), 1e-12),
    `got ${trimmedSpread(ramp, 40)} want ${popSd(Array.from(ramp))}`);
  check("outer trim disabled → wide slide refused", trimmedSpread(ramp, 40, { ...STEADINESS_DEFAULTS, wideTrimSemitones: null }) === null);

  // Random pitch over the whole 75–400 Hz range (what a noise source
  // voiced frame-by-frame would look like) → refused.
  let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const noise = Float64Array.from({ length: 40 }, () => hzToSemitones(75 * Math.pow(400 / 75, rnd())));
  check("random pitch across the range → null", trimmedSpread(noise, 40) === null);
}

console.log("tracker: coverage and warm-up");
{
  const tr = createSteadinessTracker();
  const out = feed(tr, () => 220, 2.0);
  const firstReport = out.find((r) => r.value !== null);
  check("no reading before 60 % of the 1-s window is voiced",
    firstReport && near(firstReport.t, 0.6, 0.026), `first at ${firstReport?.t}`);
  check("steady note reads 0", near(out[out.length - 1].value, 0, 1e-9) && out[out.length - 1].held === false);

  const half = createSteadinessTracker();
  const o2 = feed(half, (t) => (Math.round(t / HOP) % 2 ? 220 : null), 3.0);
  check("50 % voiced coverage → '—' throughout", o2.every((r) => r.value === null));

  const none = createSteadinessTracker();
  check("unvoiced only → '—'", feed(none, () => null, 3.0).every((r) => r.value === null));
}

console.log("tracker: known modulation");
{
  // Vibrato 5.5 Hz ±50 cents: SD of a sinusoid = amplitude/√2 = 0.354 st.
  // Reported plainly (deliberate vibrato counts as movement).
  const tr = createSteadinessTracker();
  const out = feed(tr, (t) => 220 * Math.pow(2, (0.5 * Math.sin(2 * Math.PI * 5.5 * t)) / 12), 3.0);
  const late = out.filter((r) => r.t > 1.5).map((r) => r.value);
  check("vibrato ±50 c reads ≈0.35 st", late.every((v) => near(v, 0.5 / Math.SQRT2, 0.03)),
    `range ${Math.min(...late).toFixed(3)}–${Math.max(...late).toFixed(3)}`);

  // Gender symmetry: the same musical wobble at 100 Hz and 300 Hz.
  const wob = (f0) => (t) => f0 * Math.pow(2, (0.3 * Math.sin(2 * Math.PI * 1.3 * t) + 0.1 * Math.sin(2 * Math.PI * 4.1 * t)) / 12);
  const lo = feed(createSteadinessTracker(), wob(100), 3.0).map((r) => r.value);
  const hi = feed(createSteadinessTracker(), wob(300), 3.0).map((r) => r.value);
  check("identical reading at 100 Hz and 300 Hz", lo.every((v, i) => (v === null && hi[i] === null) || near(v, hi[i], 1e-9)));

  // Slow drift 1 st/s: SD of a 1-s linear ramp = 1/√12 = 0.289 st.
  const dr = feed(createSteadinessTracker(), (t) => 150 * Math.pow(2, t / 12), 3.0).filter((r) => r.t > 1.5);
  check("drift 1 st/s reads ≈0.29 st", dr.every((r) => near(r.value, 1 / Math.sqrt(12), 0.01)));
}

console.log("tracker: register switch, hold, clock");
{
  // 1.5 s at 110 Hz, then an octave up. Windows straddling the switch
  // must never show a fresh small ("steady") reading: they are refused
  // (held / "—"), or — at an even split, where the outer trim keeps both
  // notes — report the large real spread (6 st).
  const tr = createSteadinessTracker();
  const out = feed(tr, (t) => (t <= 1.5 ? 110 : 220), 3.5);
  const mid = out.filter((r) => r.t > 1.5 + 0.2 && r.t < 1.5 + 0.8);
  const bad = mid.filter((r) => r.value !== null && !r.held && r.value < 3);
  check("mid-switch windows never read as steady", bad.length === 0, bad.map((r) => r.t.toFixed(3)).join(","));
  check("steady again after the switch", near(out[out.length - 1].value, 0, 1e-9) && !out[out.length - 1].held);

  // Same run: phonation never stops, so the 1.5-s post-voice hold must not
  // carry the OLD note's reading across the switch — refused windows show
  // "—". With the new note at 20–45 % of the window (both trims drop more
  // than they may) every window is "—", never held.
  check("no held reading anywhere during continuous phonation", out.every((r) => !r.held),
    out.filter((r) => r.held).map((r) => r.t.toFixed(3)).slice(0, 5).join(","));
  const refusedZone = out.filter((r) => r.t >= 1.5 + 0.2 && r.t <= 1.5 + 0.45);
  check("'—' across the switch (new note 20–45 % of the window)",
    refusedZone.length >= 9 && refusedZone.every((r) => r.value === null && !r.held),
    refusedZone.filter((r) => r.value !== null).map((r) => `${r.t.toFixed(3)}:${r.value.toFixed(2)}${r.held ? "h" : ""}`).join(","));

  // Octave-error run then silence: a refusal ends the hold, so the
  // silence after it does not resurrect the old note's reading.
  const oe = createSteadinessTracker();
  const oeOut = feed(oe, (t) => (t <= 1.5 ? 180 * Math.pow(2, (0.2 * Math.sin(2 * Math.PI * 2 * t)) / 12) : t <= 1.8 ? 360 : null), 3.5);
  const afterRun = oeOut.filter((r) => r.t > 1.8);
  check("silence right after a refused switch → '—', not the old note held",
    afterRun.every((r) => r.value === null && !r.held),
    afterRun.filter((r) => r.value !== null).map((r) => r.t.toFixed(3)).slice(0, 5).join(","));

  // Default (user decision 2026-10-04): no post-voice hold. After the
  // voice stops the reading stays fresh while the window is still >= 60 %
  // voiced (~0.4 s), then clears straight to "—" — never held/dimmed.
  check("holdSec default is the named HOLD_SEC (0: live-only readout)", STEADINESS_DEFAULTS.holdSec === HOLD_SEC && HOLD_SEC === 0);
  {
    const d = createSteadinessTracker();
    const pre = feed(d, (t) => 200 * Math.pow(2, (0.2 * Math.sin(2 * Math.PI * 2 * t)) / 12), 2.0);
    const post = feed(d, () => null, 3.0, 2.0);
    const tl0 = [...pre, ...post].filter((r) => r.t > 1.0);
    check("default: never a held reading after the voice stops", tl0.every((r) => !r.held));
    const lastFresh0 = tl0.filter((r) => r.value !== null).pop();
    check("default: clears to '—' once coverage drops (≈0.4 s after the note)",
      lastFresh0 && near(lastFresh0.t, 2.4, 0.026) && post.filter((r) => r.t > 2.45).every((r) => r.value === null),
      `last reading at ${lastFresh0?.t}`);
  }

  // Hold mechanics (opt-in, holdSec 1.5): after the voice stops, the last
  // reading stays (held) for holdSec, then clears. Timeline fresh → held →
  // "—", each phase contiguous, with the held phase lasting holdSec (lower
  // AND upper bound, to one message).
  const h = createSteadinessTracker({ holdSec: 1.5 });
  const before = feed(h, (t) => 200 * Math.pow(2, (0.2 * Math.sin(2 * Math.PI * 2 * t)) / 12), 2.0);
  const after = feed(h, () => null, 3.0, 2.0);
  const tl = [...before, ...after].filter((r) => r.t > 1.0);
  const phase = (r) => (r.value === null ? 2 : r.held ? 1 : 0);
  const monotone = tl.every((r, i) => i === 0 || phase(r) >= phase(tl[i - 1]));
  check("timeline is fresh → held → '—' (no flicker back)", monotone);
  const freshRows = tl.filter((r) => phase(r) === 0);
  const heldRows = tl.filter((r) => phase(r) === 1);
  const lastFresh = freshRows[freshRows.length - 1];
  check("fresh until the window drops below 60 % voiced (≈0.4 s after the note)",
    lastFresh && near(lastFresh.t, 2.4, 0.026), `last fresh at ${lastFresh?.t}`);
  check("held rows show the last fresh value", heldRows.length > 0 && heldRows.every((r) => r.value === lastFresh.value));
  const heldDur = heldRows.length ? heldRows[heldRows.length - 1].t - lastFresh.t : -1;
  const hs = 1.5; // the specified post-voice hold (literal, so a changed default fails here)
  check("hold lasts holdSec: not shorter", heldDur >= hs - HOP - 1e-9, `held ${heldDur.toFixed(3)} s`);
  check("hold lasts holdSec: not longer", heldDur <= hs + 1e-9, `held ${heldDur.toFixed(3)} s`);
  check("then '—'", after[after.length - 1].value === null && !after[after.length - 1].held);

  const nh = createSteadinessTracker({ holdSec: 0 });
  feed(nh, () => 200, 2.0);
  check("holdSec 0 → no held readings", feed(nh, () => null, 1.5, 2.0).every((r) => !r.held));

  // Capture restart: the audio clock jumps back → fresh window.
  const c = createSteadinessTracker();
  feed(c, () => 300, 2.0, 100);
  c.push(150, 0.025);
  check("clock reset clears the window", c.read().value === null);
  c.push(150, NaN); c.push(150, null);
  check("non-finite timestamps are ignored", c.read().value === null);

  // …and on a tracker that HAS a valid reading: octave-away values with
  // bad timestamps must not enter the window (they would make it a
  // register switch → "—") nor move the clock (Infinity would evict it).
  const g = createSteadinessTracker();
  feed(g, () => 220, 2.0);
  const r0 = g.read();
  for (let k = 0; k < 12; k++) g.push(440, NaN);
  g.push(440, Infinity); g.push(440, -Infinity); g.push(440, undefined); g.push(440, "2.1");
  const r1 = g.read();
  check("non-finite timestamps leave a valid reading untouched",
    near(r0.value, 0, 1e-9) && near(r1.value, 0, 1e-9) && !r1.held, `got ${JSON.stringify(r1)}`);
  const r2 = feed(g, () => 220, 0.5, 2.0);
  check("…and the window continues normally", r2.every((r) => near(r.value, 0, 1e-9) && !r.held));

  // reset()
  const r = createSteadinessTracker();
  feed(r, () => 220, 2.0);
  r.reset();
  check("reset() clears the reading", r.read().value === null);
}

console.log("tracker: update cadence");
{
  const tr = createSteadinessTracker({ updateSec: 0.1, holdSec: 0 });
  const out = feed(tr, (t) => 200 * Math.pow(2, t / 12), 3.0).filter((r) => r.t > 1.2);
  let changes = 0;
  for (let i = 1; i < out.length; i++) if (out[i].value !== out[i - 1].value) changes++;
  check("updateSec 0.1 → at most one change per 4 messages", changes <= Math.ceil(out.length / 4) + 1, `${changes} changes / ${out.length}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
