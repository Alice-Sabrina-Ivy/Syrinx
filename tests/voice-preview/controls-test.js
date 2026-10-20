// controls-test.js — the voice preview's slider maths (src/voice-preview/controls.js):
// median and 5th percentile (numpy linear), the pitch limits (+12 st; the low-contour
// rule: the shifted 5th percentile stays >= 75 Hz, never below -12), percent -> formant
// scale (3 % -> exactly 1.03), the label's Hz, presets with and without clamping, the
// pitch-target mapping and its prefill. measurements/voice-preview-phase1-2026-10-19.md §6, §14 item 4.
//
//   node tests/voice-preview/controls-test.js
import {
  percentile, pitchStats, pitchLimits, formantScale, shiftedHz, clampSt, clampPct, applyPreset, PRESETS,
  targetSetting, targetPrefillHz, ST_MAX, ST_FLOOR, LOW_HZ, PCT_MIN, PCT_MAX,
} from "../../src/voice-preview/controls.js";
import { pitchFactor } from "../../src/voice-preview/engine/world.js";
import { PITCH_TARGETS } from "../../src/utils/trainingDirection.js";
import { makeChecker } from "./vp-test-lib.js";

const T = makeChecker();

console.log("median and 5th percentile (numpy linear)");
T.check("percentile([1,2,3,4], 0.5) = 2.5", percentile([1, 2, 3, 4], 0.5) === 2.5);
T.check("percentile([1,2,3,4], 0.05) = 1.15", Math.abs(percentile([1, 2, 3, 4], 0.05) - 1.15) < 1e-12);
T.check("percentile of one value", percentile([7], 0.05) === 7 && percentile([], 0.5) === null);
{
  const track = Float32Array.from([0, 120, 0, 100, 140, 0, 110, 130]);
  const s = pitchStats(track);
  T.check("pitchStats: voiced values only (0 = unvoiced)", s.voicedHops === 5 && s.medianHz === 120 && Math.abs(s.p5Hz - 102) < 1e-12, JSON.stringify(s));
}

console.log("\npitch limits");
T.check("constants: +12 max, -12 floor, 75 Hz, -21..+26 %", ST_MAX === 12 && ST_FLOOR === -12 && LOW_HZ === 75 && PCT_MIN === -21 && PCT_MAX === 26);
{
  const lim = pitchLimits(150);
  T.check("p5 150 Hz -> min -12 (exactly 75 Hz there), max +12", lim.stMin === -12 && lim.stMax === 12 && lim.pctMin === -21 && lim.pctMax === 26, JSON.stringify(lim));
}
T.check("p5 75 Hz -> min 0 (lowering off)", pitchLimits(75).stMin === 0);
T.check("p5 80 Hz -> min -1", pitchLimits(80).stMin === -1);
T.check("p5 400 Hz -> min -12 (never below)", pitchLimits(400).stMin === -12);
T.check("p5 below 75 Hz (not posted by the detector) -> min 0", pitchLimits(70).stMin === 0);
{
  // the rule binds exactly: min is the lowest st >= -12 with p5 * 2^(st/12) >= 75 (the renderer's own factor)
  let bad = 0, n = 0, example = "";
  const p5s = [];
  for (let hz = 75; hz <= 320; hz += 0.37) p5s.push(hz);
  for (let k = 0; k <= 13; k++) { const b = LOW_HZ * 2 ** (k / 12); p5s.push(b, Math.fround(b), b * (1 + 1e-12), b * (1 - 1e-12)); }
  for (const p5 of p5s) {
    if (p5 < LOW_HZ) continue;
    n++;
    const m = pitchLimits(p5).stMin;
    const okHere = p5 * pitchFactor(m) >= LOW_HZ;
    const okBelow = m === ST_FLOOR || p5 * pitchFactor(m - 1) < LOW_HZ;
    if (!(okHere && okBelow && m <= 0 && m >= ST_FLOOR)) { bad++; if (!example) example = `p5 ${p5}: min ${m}`; }
  }
  T.check(`min binds exactly where the shifted p5 would fall below 75 Hz (${n} p5 values incl. the boundaries)`, bad === 0, example);
}

console.log("\nformant scale and labels");
T.check("3 % -> exactly 1.03", formantScale(3) === 1.03);
T.check("-3 % -> 0.97, 6 % -> 1.06, 26 % -> 1.26, -21 % -> 0.79, 0 % -> 1",
  formantScale(-3) === 0.97 && formantScale(6) === 1.06 && formantScale(26) === 1.26 && formantScale(-21) === 0.79 && formantScale(0) === 1);
T.check("label Hz = round(median x 2^(st/12)): 148 Hz, +4 st -> 186; 0 st -> 148; -2 st -> 132",
  shiftedHz(148, 4) === 186 && shiftedHz(148, 0) === 148 && shiftedHz(148, -2) === 132);
{
  const lim = pitchLimits(100); // min -4 (100 * 2^(-4/12) = 79.4; -5 -> 74.9)
  T.check("p5 100 Hz -> min -4", lim.stMin === -4, String(lim.stMin));
  T.check("clampSt / clampPct round and clamp", clampSt(-7, lim) === -4 && clampSt(13, lim) === 12 && clampSt(2.4, lim) === 2 && clampPct(30) === 26 && clampPct(-40) === -21);
}

console.log("\npresets");
{
  const free = pitchLimits(200), tight = pitchLimits(80), none = pitchLimits(75);
  const cur = { st: 5, pct: -6 };
  T.check("every preset is defined", PRESETS.every((p) => applyPreset(p, cur, free)));
  const eq = (a, b) => a.st === b.st && a.pct === b.pct;
  T.check("small step higher & brighter: +2 st, +3 %", eq(applyPreset("higherBrighter", cur, free), { st: 2, pct: 3 }));
  T.check("small step lower & darker: -2 st, -3 %", eq(applyPreset("lowerDarker", cur, free), { st: -2, pct: -3 }));
  T.check("…pitch clamped to the min (-1 at p5 80 Hz; 0 at 75 Hz)", eq(applyPreset("lowerDarker", cur, tight), { st: -1, pct: -3 }) && eq(applyPreset("lowerDarker", cur, none), { st: 0, pct: -3 }));
  T.check("pitch only: resonance -> 0, pitch kept", eq(applyPreset("pitchOnly", cur, free), { st: 5, pct: 0 }));
  T.check("pitch only clamps a pitch below a new min", eq(applyPreset("pitchOnly", { st: -3, pct: 4 }, tight), { st: -1, pct: 0 }));
  T.check("resonance only: pitch -> 0, resonance kept", eq(applyPreset("resonanceOnly", cur, free), { st: 0, pct: -6 }));
  T.check("unchanged: 0, 0", eq(applyPreset("unchanged", cur, free), { st: 0, pct: 0 }));
  let threw = false;
  try { applyPreset("louder", cur, free); } catch { threw = true; }
  T.check("an unknown preset throws", threw);
}

console.log("\ntoward a pitch target");
{
  const lim = pitchLimits(120);
  const a = targetSetting(205, 148, lim);
  T.check("205 Hz from a 148 Hz median -> +6 st (about 209 Hz)", a.st === 6 && a.hz === 209 && a.clamped === null, JSON.stringify(a));
  const b = targetSetting(115, 148, lim);
  T.check("115 Hz from 148 Hz -> -4 st (about 117 Hz)", b.st === -4 && b.hz === 117 && b.clamped === null, JSON.stringify(b));
  const c = targetSetting(400, 100, pitchLimits(90));
  T.check("400 Hz from 100 Hz -> +12, the highest setting", c.st === 12 && c.clamped === "high");
  const d = targetSetting(75, 200, pitchLimits(100));
  T.check("75 Hz from 200 Hz with min -4 -> -4, the lowest setting", d.st === -4 && d.clamped === "low", JSON.stringify(d));
  const e = targetSetting(148, 148, lim);
  T.check("the median itself -> 0 st", e.st === 0 && e.clamped === null && e.hz === 148);
  // symmetric rounding: 12 log2(t/m) = +-2.5 exactly
  const m = 100, up = targetSetting(m * 2 ** (2.5 / 12), m, pitchLimits(150)), dn = targetSetting(m * 2 ** (-2.5 / 12), m, pitchLimits(150));
  T.check("half steps round away from zero both ways", up.st === -dn.st, `${up.st} / ${dn.st}`);
}
T.check("prefill: the geometric centre of the training-direction band (205 / 115 / 159 Hz); none -> null",
  targetPrefillHz(PITCH_TARGETS.feminine) === 205 && targetPrefillHz(PITCH_TARGETS.masculine) === 115
  && targetPrefillHz(PITCH_TARGETS.androgynous) === 159 && targetPrefillHz(null) === null);
T.done();
