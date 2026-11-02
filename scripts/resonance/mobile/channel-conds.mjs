// channel-conds.mjs — the microphone / acoustic frequency-response conditions of
// the mobile resonance diagnosis (channel area, 2026-10-28), as perturb.mjs JSON
// specs. `node scripts/resonance/mobile/channel-conds.mjs` prints each
// condition's gain at reference frequencies (dB re its 1 kHz gain) and checks
// the FIR designs against their target curves.
//
// Sources for the directivity curves:
//   Monson, Hunter & Story (2012), "Horizontal directivity of low- and
//   high-frequency energy in speech and singing", JASA 132(1):433-441,
//   Table I, "Normal speech" rows (octave bands 125 Hz-16 kHz, 15 talkers,
//   anechoic, standing, 60 cm, levels at 1 m): level at 30 / 60 / 90 deg minus
//   level at 0 deg (horizontal plane, mouth height).
//   Chu & Warnock (2002), "Detailed directivity of sound fields around human
//   talkers", NRC IRC-RR-104, Appendix "Relative Levels, All subjects" (40
//   talkers, 1/3-octave 160 Hz-8 kHz, seated): azimuth 0, elevation 327 deg
//   (33 deg below the mouth axis) and 308 deg (52 deg below) — the frontal
//   vertical plane, i.e. a microphone in front of and below the mouth.
// Both are far-field (~1 m) averages; a phone 10-30 cm from the mouth is in the
// near field, where directivity is generally weaker, and the hand / phone body
// add their own shadowing. They are plausible shapes, not a Pixel measurement.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { design, firGainDb, paramsCurve, curveDb } from "./channel-eq.mjs";
import { biquadCoefs, biquadGainDb } from "./perturb.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const EQ = path.join(here, "channel-eq.mjs").replace(/\\/g, "/");
const SR = 48000;

const OCT = [125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const MONSON = { // dB re 0 deg, normal speech (Table I)
  30: [-0.1, -0.2, 0.1, -0.7, -0.1, -0.7, -1.7, -0.5],
  60: [-0.6, -0.8, -0.1, -1.5, -2.5, -3.9, -5.8, -4.4],
  90: [-1.6, -2.3, -1.6, -1.6, -7.0, -6.3, -8.7, -7.2],
};
const THIRD = [160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000];
const CW = { // dB re 0 deg / 0 deg elevation, azimuth 0 (all subjects)
  below33: [-0.4, -1.1, -1.9, 0.3, 3.5, 3.8, 2.8, 1.1, -2.9, -2.8, -3.6, -1.3, 1.7, 0.2, -0.5, 2.1, 2.4, 2.8], // elevation 327
  below52: [-1.1, -1.5, -3.0, -3.0, 0.2, 1.6, 3.2, 4.8, 1.1, -1.8, -5.6, -4.8, -2.6, -0.7, -2.6, -0.9, -0.1, -0.1], // elevation 308
};
const zip = (f, d) => f.map((x, i) => [x, d[i]]);
const eq = (curve) => ({ type: "mod", path: EQ, params: { curve } });
const lp1 = (fc) => { const k = Math.tan((Math.PI * fc) / SR); return { type: "biquad", b: [k / (1 + k), k / (1 + k), 0], a: [1, (k - 1) / (k + 1), 0] }; };
const lp2 = (fc) => ({ type: "lp", fc, q: Math.SQRT1_2, n: 1 });
const hp2 = (fc) => ({ type: "hp", fc, q: Math.SQRT1_2, n: 1 });
const peak = (fc) => ({ type: "peak", fc, db: 6, q: 2 });
const dir = (a) => eq(zip(OCT, MONSON[a]));
const below = (k) => eq(zip(THIRD, CW[k]));
const tilt = (s) => ({ type: "mod", path: EQ, params: { tilt: s, knee: 1000 } });

export const CONDS = [];
const add = (name, list, desc) => CONDS.push({ name, pert: list, desc });
for (const fc of [2000, 3000, 4000, 5000, 6000]) add(`lp1-${fc / 1000}k`, [lp1(fc)], `1st-order low-pass (bilinear), -3 dB at ${fc} Hz`);
for (const fc of [2000, 3000, 4000, 5000, 6000]) add(`lp2-${fc / 1000}k`, [lp2(fc)], `2nd-order Butterworth low-pass (RBJ, Q 0.707), -3 dB at ${fc} Hz`);
for (const s of [-3, -6, -9]) add(`tilt${s}`, [tilt(s)], `${s} dB/octave above 1 kHz (linear-phase FIR), flat below`);
for (const a of [30, 60, 90]) add(`dir${a}`, [dir(a)], `horizontal off-axis ${a} deg, Monson et al. 2012 Table I normal speech (octave bands, linear-phase FIR)`);
for (const k of ["below33", "below52"]) add(`dir-${k}`, [below(k)], `${k === "below33" ? 33 : 52} deg below the mouth axis, Chu & Warnock 2002 (1/3-octave, linear-phase FIR)`);
for (const fc of [150, 300]) add(`hp2-${fc}`, [hp2(fc)], `2nd-order Butterworth high-pass (RBJ, Q 0.707) at ${fc} Hz`);
for (const fc of [2000, 3000, 5000]) add(`peak-${fc / 1000}k`, [peak(fc)], `+6 dB peaking EQ (RBJ, Q 2) at ${fc} Hz`);
add("combo-dir60-hp150", [dir(60), hp2(150)], "60 deg off-axis (Monson) + 2nd-order high-pass 150 Hz");
add("combo-dir60-lp2-5k", [dir(60), lp2(5000)], "60 deg off-axis (Monson) + 2nd-order low-pass 5 kHz");
add("combo-below33-hp150-lp1-5k", [below("below33"), hp2(150), lp1(5000)], "33 deg below the mouth (Chu & Warnock) + 2nd-order high-pass 150 Hz + 1st-order low-pass 5 kHz");
// steep cut-offs (mechanism contrast, added 2026-10-28 after the gentle low-passes moved the readout <= 0.06 u):
// 8th-order Butterworth low-pass = 4 RBJ sections with the Butterworth Qs
const lp8 = (fc) => [2.5629, 0.9, 0.6013, 0.5098].map((q) => ({ type: "lp", fc, q, n: 1 }));
for (const fc of [4000, 4500, 5000]) add(`lp8-${fc / 1000}k`, lp8(fc), `8th-order Butterworth low-pass at ${fc} Hz (steep; contrast to the gentle 1st / 2nd-order corners)`);
// a RISING high end (added 2026-10-28 after the falling ones read brighter): a mic port in the
// face of a phone-sized rigid body sees up to +6 dB of pressure build-up / diffraction gain once
// the body is large against the wavelength (~2-4 kHz for a 7-8 cm wide phone); modelled as an
// RBJ high shelf, +6 dB, shelf slope 1, at 2 and 3 kHz
for (const fc of [2000, 3000]) add(`hshelf-${fc / 1000}k+6`, [{ type: "hshelf", fc, db: 6, s: 1 }], `+6 dB high shelf (RBJ, S 1) at ${fc} Hz — rising high end (baffle / diffraction gain)`);
add("combo-below33-hshelf2k+6-hp150", [below("below33"), { type: "hshelf", fc: 2000, db: 6, s: 1 }, hp2(150)], "33 deg below the mouth (Chu & Warnock) + rising high end (+6 dB shelf at 2 kHz) + 2nd-order high-pass 150 Hz");
export const byName = Object.fromEntries(CONDS.map((c) => [c.name, c]));

/** |H(f)| in dB of a perturbation list (linear parts only). */
export function gainDb(list, f) {
  let g = 0;
  for (const t of list) {
    if (t.type === "mod") g += firGainDb(design(paramsCurve(t.params), SR, t.params.taps ?? 4095), f, SR);
    else g += (t.n ?? 1) * biquadGainDb(biquadCoefs({ q: Math.SQRT1_2, s: 1, ...t }, SR), f, SR);
  }
  return g;
}
/** Band power gain (dB) for a flat input spectrum over [a, b] Hz. */
export function bandGainDb(list, a, b, step = 25) {
  let s = 0, n = 0;
  for (let f = a; f <= b; f += step) { s += 10 ** (gainDb(list, f) / 10); n++; }
  return 10 * Math.log10(s / n);
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const F = [100, 150, 250, 500, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 7000, 7800];
  console.log(["cond", ...F.map((f) => (f >= 1000 ? `${f / 1000}k` : `${f}`)), "dF(nb)"].join("\t"));
  let worst = 0;
  for (const c of CONDS) {
    const g1k = gainDb(c.pert, 1000);
    const dF = bandGainDb(c.pert, 4500, 6500) - bandGainDb(c.pert, 2500, 3500);
    console.log([c.name, ...F.map((f) => (gainDb(c.pert, f) - g1k).toFixed(1)), dF.toFixed(1)].join("\t"));
    for (const t of c.pert.filter((x) => x.type === "mod")) {
      const curve = paramsCurve(t.params), h = design(curve, SR);
      for (let f = 100; f <= 7800; f *= 2 ** (1 / 24)) worst = Math.max(worst, Math.abs(firGainDb(h, f, SR) - curveDb(curve, f)));
    }
  }
  console.log(`FIR designs vs target curves, 100 Hz-7.8 kHz: max |error| ${worst.toFixed(2)} dB`);
}
