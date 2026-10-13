// fp10-renders.mjs — renders for the 10 ms frame-period lever's quality cost (§P5 "Also
// reported": the log-spectral distance between the 10 ms and 5 ms renders). WORLD
// (WebAssembly, SIMD build) through the Worker's engine, front end F-S, the 4 timing clips at
// 5 s (48 kHz in), at 16 000, 22 050 and 24 000 Hz, for the unchanged rebuild (0, 1.00), the
// first render (+2, 1.03) and the ten G2 settings, at frame periods 5 and 10 ms, plus the clip
// resampled to each rate (the page's resampler). fp10_lsd.py scores them.
//
//   node scripts/voice-preview/timing/fp10-renders.mjs [--clipset=timing]
// Output: VP_CACHE/timing/fp10/<clipset>/<clip>_<rate>_fp<5|10>_<cell>.f32 + index.json
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { P } from "../lib/paths.mjs";
import { loadWorldNode, readF32, writeArr } from "../lib/node-io.mjs";
import { Preview, resampleClip } from "../lib/preview-core.js";
import { FIRST, G2_SETTINGS } from "./matrix.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const clipset = args.clipset || "timing";
const world = await loadWorldNode("simd");
const idx = JSON.parse(readFileSync(path.join(P.clips, clipset, "index.json"), "utf8"));
const OUT = path.join(P.timing, "fp10", clipset);
mkdirSync(OUT, { recursive: true });
const cells = [[0, 1.0], [FIRST.st, FIRST.a], ...G2_SETTINGS.filter(([s, a]) => !(s === FIRST.st && a === FIRST.a))];
const cn = (s, a) => `p${s >= 0 ? "+" : "-"}${Math.abs(s)}_a${a.toFixed(2)}`;
const files = [];
for (const c of idx.clips) {
  const e = c.lengths["5"];
  const x = readF32(path.join(P.clips, clipset, e.pcm));
  const posted = readF32(path.join(P.clips, clipset, e.posted));
  for (const rate of [16000, 22050, 24000]) {
    const of = `${c.name}_${rate}_orig.f32`;
    writeArr(path.join(OUT, of), resampleClip(x, 48000, rate));
    files.push({ clip: c.name, rate, fp: 0, file: of });
    for (const fp of [5, 10]) {
      const pv = new Preview({ engine: "world", world, lab: null });
      pv.analyse(x, 48000, { rate, frontEnd: "S", posted, framePeriod: fp, first: FIRST });
      for (const [st, a] of cells) {
        const f = `${c.name}_${rate}_fp${fp}_${cn(st, a)}.f32`;
        writeArr(path.join(OUT, f), pv.render(st, a).pcm);
        files.push({ clip: c.name, rate, fp, st, a, file: f });
      }
      pv.free();
    }
  }
  console.log(`${c.name} done`);
}
writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ clipset, files }, null, 1));
