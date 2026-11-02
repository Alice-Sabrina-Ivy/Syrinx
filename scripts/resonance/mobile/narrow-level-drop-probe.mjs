// narrow-level-drop-probe.mjs — a synthetic probe from the review of the
// narrower resonance-row hold round (measurements/resonance-row-hold-narrow-
// 2026-11-01.md "Review and fixes"; information, no bar): what K4's own-voice
// reference (own ticks must be >= the median of the last 60 s of
// margin-qualified shown ticks − 6 dB) does when the user's voice drops
// mid-session (phone moved away, head turned). The shipped functions only:
// createVoiceHoldRef, createTrail, cueRowStates.
//
// A quiet room (−60 dBFS ± 1). Cycles of 4.25 s: 12 voiced ticks at the
// voice level (± 3 dB), 4 ticks on the hook's silence hold, then one onset
// blink tick (the voice level − 3 dB, no painted pitch yet). 60 s at
// −30 dBFS, then 90 s at −30 − drop. Fixed seed.
//
//   node scripts/resonance/mobile/narrow-level-drop-probe.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const M = await import(pathToFileURL(path.join(repo, "src/components/cueStripModel.js")).href);
const SNAP = { u: 0.8, raw: 0.03, fill: 1, voicedS: 6, verdict: "score", sinceResumeS: 100, narrowband: { decided: true, on: false } };
const BEFORE_S = 60, AFTER_S = 90;

function run(drop) {
  let seed = 5;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cycle = (lev) => [
    ...Array.from({ length: 12 }, () => ({ pitchVoiced: true, pitchLevel: 180, intensity: lev + 6 * (rnd() - 0.5) })),
    ...Array.from({ length: 4 }, () => ({ pitchHolding: true, pitchLevel: 180, intensity: -60 + 2 * (rnd() - 0.5) })),
    { intensity: lev - 3, blink: true },
  ];
  const frames = [];
  while (frames.length < BEFORE_S * 4) frames.push(...cycle(-30));
  const k0 = frames.length;
  while (frames.length < (BEFORE_S + AFTER_S) * 4) frames.push(...cycle(-30 - drop));
  const hold = M.createVoiceHoldRef();
  const trK = M.createTrail(M.RESONANCE_TRAIL.n, M.RESONANCE_TRAIL.everyTicks), trB = M.createTrail(M.RESONANCE_TRAIL.n, M.RESONANCE_TRAIL.everyTicks);
  let prevK = 0, prevB = 0, clearsK = 0, clearsB = 0, sumK = 0, sumB = 0, n = 0, lastBlinkClear = null;
  frames.forEach((fr, i) => {
    const inp = { pitchVoiced: false, pitchHolding: false, pitchLevel: null, snap: SNAP, workerStatus: "ready", hasRef: true, ...fr };
    const h = hold.tick(inp, i * 250);
    const lk = trK.tick(M.cueRowStates({ ...inp, resonanceHold: h }).resonance, SNAP.u).length;
    const lb = trB.tick(M.cueRowStates(inp).resonance, SNAP.u).length;
    if (i >= k0) {
      if (lk === 0 && prevK > 0) clearsK++;
      if (lb === 0 && prevB > 0) clearsB++;
      if (fr.blink && lk === 0) lastBlinkClear = (i * 250) / 1000;
      sumK += lk; sumB += lb; n++;
    }
    prevK = lk; prevB = lb;
  });
  return { drop, clearsK, clearsB, meanK: sumK / n, meanB: sumB / n, lastBlinkClearAfterDropS: lastBlinkClear == null ? null : lastBlinkClear - BEFORE_S };
}
console.log("| voice drop | trail clears in the 90 s after it, K4 / BASE | mean trail, K4 / BASE | the last blink that clears the trail, after the drop |");
console.log("|---|---|---|---|");
for (const d of [0, 4, 7, 10]) {
  const r = run(d);
  console.log(`| ${d} dB | ${r.clearsK} / ${r.clearsB} | ${r.meanK.toFixed(1)} / ${r.meanB.toFixed(1)} | ${r.lastBlinkClearAfterDropS == null ? "none" : `${r.lastBlinkClearAfterDropS.toFixed(1)} s`} |`);
}
