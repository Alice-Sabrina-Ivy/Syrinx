// warp-test.js — the formant envelope warp (vp_warp in the committed WebAssembly, both
// builds) against a JavaScript reference of its definition (the scratch prototype's
// World._warp, numpy.interp semantics):
//   f_k = k fs / fft (k = 0 .. fft/2), ln S'(f_k) = interp(f_k / a; f, ln max(S, 1e-16)),
//   A'(f_k) = clip(interp(f_k / a; f, A), 0, 1); a = 1 is a plain copy.
// On real CheapTrick / D4C output (a committed LibriSpeech clip) and on synthetic rows
// (a single peak that must move to a x its frequency, values outside [0, 1], values below
// the 1e-16 floor). Aperiodicity is pure interpolation and must match bit for bit; the
// envelope goes through log / exp (musl in WebAssembly vs V8 in the reference), so it is
// compared to 1e-12 relative. measurements/voice-preview-phase1-2026-10-19.md §5.
//
//   node tests/voice-preview/warp-test.js
import { PreviewEngine } from "../../src/voice-preview/engine/preview.js";
import { formantScale } from "../../src/voice-preview/controls.js";
import { loadWorld, makeInput, makeChecker, PARITY_JSON } from "./vp-test-lib.js";
import { readFileSync } from "node:fs";

const T = makeChecker();

function interp(x, xp, fp, n) {
  if (x > xp[n - 1]) return fp[n - 1];
  if (x < xp[0]) return fp[0];
  let j = 0;
  while (j + 1 < n && xp[j + 1] <= x) j++;
  if (j === n - 1) return fp[j];
  if (xp[j] === x) return fp[j];
  const slope = (fp[j + 1] - fp[j]) / (xp[j + 1] - xp[j]);
  return slope * (x - xp[j]) + fp[j];
}
function refWarp(sp, ap, nf, fft, fs, a) {
  const nb = fft / 2 + 1;
  if (a === 1) return { sp: Float64Array.from(sp), ap: Float64Array.from(ap) };
  const f = new Float64Array(nb);
  const step = (fs / 2) / (nb - 1);
  for (let k = 0; k < nb; k++) f[k] = k * step;
  f[nb - 1] = fs / 2;
  const os = new Float64Array(sp.length), oa = new Float64Array(ap.length);
  const row = new Float64Array(nb);
  for (let i = 0; i < nf; i++) {
    const o = i * nb;
    for (let k = 0; k < nb; k++) row[k] = Math.log(sp[o + k] > 1e-16 ? sp[o + k] : 1e-16);
    for (let k = 0; k < nb; k++) {
      os[o + k] = Math.exp(interp(f[k] / a, f, row, nb));
      const v = interp(f[k] / a, f, ap.subarray(o, o + nb), nb);
      oa[o + k] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return { sp: os, ap: oa };
}
function compare(got, want) {
  let spRel = 0, apBits = 0;
  for (let i = 0; i < want.sp.length; i++) {
    const d = Math.abs(got.sp[i] - want.sp[i]) / Math.max(1e-300, Math.abs(want.sp[i]));
    if (d > spRel) spRel = d;
    if (!Object.is(got.ap[i], want.ap[i])) apBits++;
  }
  return { spRel, apBits };
}

// real analysis output (16 kHz LibriSpeech clip, its committed posted track)
const fx = JSON.parse(readFileSync(PARITY_JSON, "utf8"));
const f16 = fx.inputs.find((i) => i.name === "ls_man_hi8_f105@16000");
const { pcm } = makeInput({ clip: "ls_man_hi8_f105", rate: 16000 });

for (const build of ["simd", "nosimd"]) {
  console.log(`${build}`);
  const W = await loadWorld(build);
  const eng = new PreviewEngine(W);
  eng.analyse(pcm, 16000, Float32Array.from(f16.track));
  const s = eng.session;
  const nf = s.nf, fft = s.fft, nb = fft / 2 + 1;
  const sp = W.get(s.psp, nf * nb), ap = W.get(s.pap, nf * nb);
  for (const pct of [0, 3, -3, 26, -21]) {
    const a = formantScale(pct);
    const got = W.warp(sp, ap, nf, fft, 16000, a);
    const { spRel, apBits } = compare(got, refWarp(sp, ap, nf, fft, 16000, a));
    T.check(`real envelope, ${pct >= 0 ? "+" : ""}${pct} % (a ${a}): aperiodicity bit-identical, envelope within 1e-12`,
      apBits === 0 && spRel < 1e-12 && (pct !== 0 || (spRel === 0 && got.sp.every((v, i) => Object.is(v, sp[i])))), `max rel ${spRel.toExponential(2)}, ${apBits} ap diffs`);
  }
  eng.free();

  // synthetic rows at 48 kHz (fft 2048)
  const fs = 48000, fftS = W.fftSize(fs), nbS = fftS / 2 + 1, bin = fs / fftS;
  const peakBin = 100; // 2343.75 Hz
  const spS = new Float64Array(3 * nbS), apS = new Float64Array(3 * nbS);
  for (let k = 0; k < nbS; k++) {
    spS[k] = Math.exp(-0.5 * ((k - peakBin) / 3) ** 2) + 1e-6; // a peak
    spS[nbS + k] = k % 7 === 0 ? 0 : 1e-20 * (k + 1);              // below the 1e-16 floor, zeros
    spS[2 * nbS + k] = 1 / (1 + k);
    apS[k] = k / (nbS - 1);
    apS[nbS + k] = -0.2 + 1.4 * k / (nbS - 1);                     // outside [0, 1]
    apS[2 * nbS + k] = 0.5;
  }
  for (const a of [1.1, 0.9, formantScale(26), formantScale(-21)]) {
    const got = W.warp(spS, apS, 3, fftS, fs, a);
    const { spRel, apBits } = compare(got, refWarp(spS, apS, 3, fftS, fs, a));
    let argmax = 0;
    for (let k = 0; k < nbS; k++) if (got.sp[k] > got.sp[argmax]) argmax = k;
    const want = Math.round(peakBin * a);
    T.check(`synthetic rows, a ${a}: matches the definition; the peak moves to a x its frequency`,
      apBits === 0 && spRel < 1e-12 && Math.abs(argmax - want) <= 1, `peak ${(argmax * bin).toFixed(0)} Hz (want ${(want * bin).toFixed(0)}), rel ${spRel.toExponential(2)}`);
    T.check(`synthetic rows, a ${a}: aperiodicity clipped to [0, 1], envelope floored at 1e-16`,
      got.ap.every((v) => v >= 0 && v <= 1) && got.sp.subarray(nbS, 2 * nbS).every((v) => v >= 1e-16 * (1 - 1e-12)));
  }
  const same = W.warp(spS, apS, 3, fftS, fs, 1);
  T.check("a = 1: a plain copy", same.sp.every((v, i) => Object.is(v, spS[i])) && same.ap.every((v, i) => Object.is(v, apS[i])));
}
T.done();
