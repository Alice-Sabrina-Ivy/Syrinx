// fe-run.mjs — the F0 front-end comparison (§P4 of
// measurements/voice-preview-spike-2026-10-12.md), Node side. WORLD (WebAssembly, SIMD
// build) through the same engine as the Worker (lib/preview-core.js).
//
//   node scripts/voice-preview/fe/fe-run.mjs [--fe=H,D,S,L]
//
// 1. Renders for checks 1, 2 and 4: the 8 prototype clips (16 kHz) x 26 cells per front end
//    -> VP_CACHE/parity/renders/fe-<X>/<clip>/<cell>.f32 (finished float32), so
//    parity/meters.mjs --set=fe-<X> runs the real pitch chain and the lab VTLN meter on them.
//    F-S = the real pitch worker's posted track on the clip (proto16/<clip>.post.f32);
//    F-L = this branch's lab replica grid (proto16/<clip>.grid.f32).
// 2. Tracks for check 3 (PTDB-TUG laryngograph reference): the F0 each front end hands to
//    CheapTrick / D4C / synthesis (after StoneMask for D, S, L; Harvest's own for H), on
//    WORLD's 5 ms frames, at 16 kHz, for pt_m1 / pt_f1 and the 4 timing clips at 8 s
//    (48 kHz in, the page's resampler, F-S / F-L tracks from the 48 kHz clip)
//    -> VP_CACHE/fe/f0/<X>/<clip>.f64 (+ fe/f0/index.json).
// Also writes VP_CACHE/fe/run.json (analysis ms per clip, for information only).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { P } from "../lib/paths.mjs";
import { loadWorldNode, loadLab, readF32, writeArr, cells, cellName } from "../lib/node-io.mjs";
import { Preview } from "../lib/preview-core.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const FES = (args.fe || "H,D,S,L").split(",");
const world = await loadWorldNode("simd");
const lab = await loadLab();
const proto = JSON.parse(readFileSync(path.join(P.clips, "proto16", "clips.json"), "utf8"));
const timing = JSON.parse(readFileSync(path.join(P.clips, "timing", "index.json"), "utf8")).clips;
const t00 = Date.now();
const info = { renders: {}, tracks: {} };

function trackOpts(dir, base, fe) {
  if (fe === "S") return { posted: readF32(path.join(dir, `${base}.post.f32`)) };
  if (fe === "L") return { grid: readF32(path.join(dir, `${base}.grid.f32`)) };
  return {};
}

function saveTrack(fe, name, pv) {
  const od = path.join(P.fe, "f0", fe);
  mkdirSync(od, { recursive: true });
  writeArr(path.join(od, `${name}.f64`), pv.session.f0());
}

for (const fe of FES) {
  // 1. prototype clips: 26 cells
  for (const c of proto) {
    const D = path.join(P.clips, "proto16");
    const x = readF32(path.join(D, `${c.name}.f32`));
    const pv = new Preview({ engine: "world", world, lab });
    const r = pv.analyse(x, 16000, { rate: 16000, frontEnd: fe, framePeriod: 5, first: { st: 0, a: 1 }, ...trackOpts(D, c.name, fe) });
    info.renders[`${fe}/${c.name}`] = { analyseMs: r.ms };
    const od = path.join(P.parity, "renders", `fe-${fe}`, c.name);
    mkdirSync(od, { recursive: true });
    for (const [st, a] of cells(c.sex)) writeArr(path.join(od, `${cellName(st, a)}.f32`), pv.render(st, a).pcm);
    if (c.name === "pt_m1" || c.name === "pt_f1") saveTrack(fe, c.name, pv);
    pv.free();
  }
  // 2. timing clips at 8 s, 48 kHz -> 16 kHz
  for (const c of timing) {
    const e = c.lengths["8"];
    const D = path.join(P.clips, "timing");
    const x = readF32(path.join(D, e.pcm));
    const pv = new Preview({ engine: "world", world, lab });
    const r = pv.analyse(x, 48000, { rate: 16000, frontEnd: fe, framePeriod: 5, first: { st: 0, a: 1 }, ...trackOpts(D, e.pcm.replace(/\.f32$/, ""), fe) });
    info.tracks[`${fe}/${c.name}_8s`] = { analyseMs: r.ms };
    saveTrack(fe, `${c.name}_8s`, pv);
    pv.free();
  }
  console.log(`fe ${fe} done (${((Date.now() - t00) / 1000).toFixed(0)} s)`);
}
const idx = {
  framePeriodMs: 5, rate: 16000,
  clips: [
    ...proto.filter((c) => c.name.startsWith("pt_")).map((c) => ({ name: c.name, sex: c.sex, files: [{ file: c.src.match(/mic_\w+?\.wav/)[0], startSec: 0 }], durSec: c.dur })),
    ...timing.map((c) => {
      let off = 0;
      const files = c.files.map((f) => { const r = { file: f.file, startSec: off }; off += f.samples / 48000; return r; });
      return { name: `${c.name}_8s`, sex: c.sex, files, durSec: 8 };
    }),
  ],
};
mkdirSync(P.fe, { recursive: true });
writeFileSync(path.join(P.fe, "f0", "index.json"), JSON.stringify(idx, null, 1));
writeFileSync(path.join(P.fe, "run.json"), JSON.stringify(info, null, 1));
console.log(`all done, ${((Date.now() - t00) / 1000).toFixed(0)} s`);
