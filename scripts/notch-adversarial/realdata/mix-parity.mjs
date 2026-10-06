// mix-parity.mjs — realdata.mjs renderMix(spec) must reproduce the WAVs that
// build_mixes.py rendered from the same spec, so evaluation code can build
// variants in JS with the identical definition (the WAVs are PCM16: the two
// agree to <= half an LSB). Prints max |diff| per set.
//   node scripts/notch-adversarial/realdata/mix-parity.mjs [--n=6]
import { loadIndex, readClip, renderMix } from "./realdata.mjs";
const n = Number((process.argv.find((a) => a.startsWith("--n=")) ?? "--n=6").slice(4));
const mixes = loadIndex("mix");
const bySet = {};
for (const m of mixes) (bySet[m.set] ??= []).push(m);
let worst = 0;
for (const [set, ms] of Object.entries(bySet)) {
  const step = Math.max(1, Math.floor(ms.length / n));
  let mx = 0, cnt = 0;
  for (let i = 0; i < ms.length && cnt < n; i += step, cnt++) {
    const a = readClip(ms[i].path), b = renderMix(ms[i].spec);
    if (a.length !== b.length) { console.log(`${ms[i].id}: length ${a.length} vs ${b.length}`); mx = Infinity; continue; }
    for (let k = 0; k < a.length; k++) mx = Math.max(mx, Math.abs(a[k] - b[k]));
  }
  console.log(`${set}: ${cnt} streams, max |py - js| = ${mx.toExponential(2)}`);
  worst = Math.max(worst, mx);
}
// mixes are PCM16 (k / 32768): JS float vs the stored file differ by <= half an LSB
process.exit(worst <= 0.5 / 32768 + 1e-7 ? 0 : 1);
