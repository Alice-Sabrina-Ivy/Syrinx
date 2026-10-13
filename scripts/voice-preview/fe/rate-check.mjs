// rate-check.mjs — render quality at 22.05 and 24 kHz against 16 kHz, a labelled addition to
// §P4 of measurements/voice-preview-spike-2026-10-12.md (review, 2026-10-12). The front-end
// checks 1, 2 and 4 ran on 16 kHz renders only; §P6's rule ("the highest passing rate wins")
// assumes a higher rate is never worse. This re-runs checks 1, 2 and 4 with the selected front
// end (F-S) at all three rates on the same 48 kHz sources, so the rates are compared like for like:
//   clips   the speech-dense timing clips at 5 s and the pre-registered timing clips at 8 s
//           (PTDB-TUG M01, M02, F01, F02; 48 kHz; F-S = the real pitch chain's posted track on
//           the 48 kHz clip, as the timing page passes it)
//   renders WORLD (WebAssembly, SIMD build) via lib/preview-core.js at r = 16 000 / 22 050 /
//           24 000 Hz, the prototype grid (26 cells per clip)
//   meters  the real pitch chain (session-oracle runWorkers) on each render at its own rate
//           (checks 1 and 2, against the posted track of the 48 kHz original); the lab VTLN
//           meter (lab_live.mjs, 16 kHz input) on each render brought to 16 kHz with the same
//           sinc resampler (check 4; the meter reads below 8 kHz only)
//
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-preview/fe/rate-check.mjs
// Outputs under VP_CACHE/fe/rate: post/<rate>/<clip>/<cell>.f32, r16/<rate>/<clip>/<cell>.f32,
// vtln.jsonl, clips.json. Scored by fe/rate_score.py.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P, REPO } from "../lib/paths.mjs";
import { loadWorldNode, readF32, writeArr, cells, cellName } from "../lib/node-io.mjs";
import { Preview, resampleClip } from "../lib/preview-core.js";

const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { loadSrc, runWorkers } = await imp("scripts/session-oracle/lib/chain.mjs");
const S = await loadSrc(path.join(REPO, "src"));
const world = await loadWorldNode("simd");
const OUT = path.join(P.fe, "rate");
const RATES = [16000, 22050, 24000];
const mk = (...p) => { const d = path.join(...p); mkdirSync(d, { recursive: true }); return d; };
const t00 = Date.now();

const clips = [];
for (const [set, len] of [["timing-speech", "5"], ["timing", "8"]]) {
  const idx = JSON.parse(readFileSync(path.join(P.clips, set, "index.json"), "utf8"));
  for (const c of idx.clips) {
    const e = c.lengths[len];
    clips.push({ name: `${set === "timing" ? "pre" : "sd"}_${c.name}_${len}s`, sex: c.sex, pcm: path.join(P.clips, set, e.pcm), posted: path.join(P.clips, set, e.posted) });
  }
}
const jobs = [];
for (const c of clips) {
  const x = readF32(c.pcm);
  const posted = readF32(c.posted);
  for (const rate of RATES) {
    const pv = new Preview({ engine: "world", world, lab: null });
    pv.analyse(x, 48000, { rate, frontEnd: "S", posted, framePeriod: 5, first: { st: 0, a: 1 } });
    const pd = mk(OUT, "post", String(rate), c.name), rd = mk(OUT, "r16", String(rate), c.name);
    for (const [st, a] of cells(c.sex)) {
      const y = pv.render(st, a).pcm;
      writeArr(path.join(pd, `${cellName(st, a)}.f32`), Float32Array.from(runWorkers(S, y, rate).col.post));
      const y16 = rate === 16000 ? y : resampleClip(y, rate, 16000);
      writeArr(path.join(rd, `${cellName(st, a)}.f32`), y16);
      jobs.push({ key: `${rate}/${c.name}/${cellName(st, a)}`, audio: path.join(rd, `${cellName(st, a)}.f32`) });
    }
    pv.free();
  }
  console.log(`${c.name} done (${((Date.now() - t00) / 1000).toFixed(0)} s)`);
}
writeFileSync(path.join(OUT, "clips.json"), JSON.stringify(clips, null, 1));
const jp = path.join(OUT, "vtln.jobs.json");
writeFileSync(jp, JSON.stringify(jobs));
const r = spawnSync(process.execPath, [path.join(REPO, "scripts/resonance-lab/node/lab_live.mjs"), jp, path.join(OUT, "vtln.jsonl"), "vtln"], { stdio: "inherit" });
if (r.status !== 0) throw new Error(`lab_live.mjs failed (${r.status})`);
console.log(`done, ${jobs.length} renders, ${((Date.now() - t00) / 1000).toFixed(0)} s`);
