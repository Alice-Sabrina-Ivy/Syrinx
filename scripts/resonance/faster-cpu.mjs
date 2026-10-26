// faster-cpu.mjs — G5 of measurements/resonance-faster-prereg-2026-10-26.md:
// the resonance chain's CPU per audio second in Node (the worker's
// startEngine / onChunk / onPitchHint path, as faster.mjs bins, no logging),
// for the shipped vtln trail (100) and the bin-level candidates, interleaved.
//
//   node scripts/resonance/faster-cpu.mjs --tag=dev [--reps=3] [--trails=100,70,50] [--n=6]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const SR = 48000, CH = 1200;
const OUT = path.join(repo, "build/resonance-faster");
const tag = arg("tag", "dev");
const { createLabEngine } = await imp("src/resonance-lab/lab-engine.js");
const { createNarrowbandDetector } = await imp("src/resonance/narrowband.js");
const { createResonanceCue } = await imp("src/resonance/resonanceCue.js");
const resDir = path.join(repo, "public/resonance-lab");
const VTLN = JSON.parse(readFileSync(path.join(resDir, "vtln_warp.json"), "utf8"));
const REF = JSON.parse(readFileSync(path.join(resDir, "reference.json"), "utf8"));
const L = JSON.parse(readFileSync(path.join(OUT, `readers-${tag}.json`), "utf8"));
const n = Number(arg("n", "6"));
const readers = [...L.readers.filter((r) => r.sex === "m").slice(0, n / 2), ...L.readers.filter((r) => r.sex === "f").slice(0, n / 2)];
const streams = readers.map((r) => {
  const b = readFileSync(r.variants.L);
  return { y: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(), meta: JSON.parse(readFileSync(path.join(OUT, "pitch", `${r.id}__L.json`), "utf8")) };
});
function run(trail, { y, meta }) {
  const cue = createResonanceCue({ reference: REF });
  const nb = createNarrowbandDetector();
  const engine = createLabEngine({
    sampleRate: SR, models: { vtln: VTLN }, reference: REF, pitchSource: "frames", vtln: trail !== 100 ? { trail } : {},
    onStamped: (name, te, s, v) => { if (name === "vtln") cue.onStamped(te, s, v); },
    onGridFrame: (j, f0, ring16) => { if (!(f0 > 0)) return; cue.noteNarrowband(nb.frame((i) => ring16.at(i), Math.round((0.005 + 0.01 * j) * 16000)).on); },
  });
  let since = 0;
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < meta.byChunk.length; k++) {
    const x = y.subarray(k * CH, Math.min(y.length, (k + 1) * CH));
    const ct = Math.min(y.length, (k + 1) * CH) / SR;
    cue.noteChunk(ct);
    engine.pushChunk(x, null, ct);
    since += x.length / SR;
    if (since >= 0.2) { since = 0; cue.snapshot(); }
    for (const m of meta.byChunk[k]) {
      const voiced = m[3] === 0 ? false : !!m[0];
      cue.notePitchHint({ voiced, pitch: m[1], contextTime: m[2] });
      engine.pushPitchFrame(m[2], voiced ? m[1] : 0);
    }
  }
  return Number(process.hrtime.bigint() - t0) / 1e6;
}
const trails = arg("trails", "100,70,50").split(",").map(Number);
const reps = Number(arg("reps", "3"));
const tot = Object.fromEntries(trails.map((t) => [t, 0]));
const audio = streams.reduce((a, s) => a + s.y.length / SR, 0);
run(100, streams[0]); // warm-up
for (let r = 0; r < reps; r++) for (const s of streams) for (const t of (r % 2 ? [...trails].reverse() : trails)) tot[t] += run(t, s);
for (const t of trails) console.log(`trail ${t}: ${(tot[t] / (reps * audio)).toFixed(2)} ms per audio s (${(tot[t] / tot[100]).toFixed(3)} x trail 100)`);
