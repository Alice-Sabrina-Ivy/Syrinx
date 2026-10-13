// tracks.mjs — precomputed F0 tracks for the voice-preview spike (§P4 / §P5), on this
// branch's src/, written next to the clips (VP_CACHE/clips, not committed):
//   F-S  the REAL pitch worker's posted pitch per 25 ms hop (scripts/session-oracle/lib/chain.mjs
//        runWorkers; 0 = null), as the live chain would have posted it while recording
//   F-L  the resonance lab's production pitch replica (lab-engine.js gridTrack), 10 ms grid
// timing/<clip>_<L>s.{post,grid}.f32 at the 48 kHz capture rate (index.json gains the names);
// proto16/<clip>.{post,grid}.f32 for the 16 kHz prototype clips (F-S at 16 kHz input; F-L via
// the lab bench's band-limited x3 upsample, as the prototype's f0front.mjs ran it).
//
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-preview/prep/tracks.mjs
//        [--clipset=timing|timing-speech] [--no-proto]
// --clipset picks the 48 kHz clip folder (timing-speech = prep_speech_clips.py's speech-dense
// variant); --no-proto skips the 16 kHz prototype clips.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P, REPO } from "../lib/paths.mjs";
import { readF32, writeArr, loadLab } from "../lib/node-io.mjs";
import { labGridTrack } from "../lib/preview-core.js";

const { loadSrc, runWorkers } = await import(pathToFileURL(path.join(REPO, "scripts/session-oracle/lib/chain.mjs")).href);
const { upsample } = await import(pathToFileURL(path.join(REPO, "scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs")).href);
const S = await loadSrc(path.join(REPO, "src"));
const lab = await loadLab();

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const TD = path.join(P.clips, args.clipset || "timing");
const idx = JSON.parse(readFileSync(path.join(TD, "index.json"), "utf8"));
for (const c of idx.clips) {
  for (const [L, e] of Object.entries(c.lengths)) {
    const x = readF32(path.join(TD, e.pcm));
    const post = Float32Array.from(runWorkers(S, x, 48000).col.post);
    const grid = labGridTrack(lab, x, 48000);
    e.posted = e.pcm.replace(/\.f32$/, ".post.f32");
    e.grid = e.pcm.replace(/\.f32$/, ".grid.f32");
    writeArr(path.join(TD, e.posted), post);
    writeArr(path.join(TD, e.grid), Float32Array.from(grid));
    console.log(`${path.basename(TD)} ${c.name} ${L} s: ${post.length} hops (${post.filter((v) => v > 0).length} voiced), ${grid.length} grid frames`);
  }
}
writeFileSync(path.join(TD, "index.json"), JSON.stringify(idx, null, 1));

const PD = path.join(P.clips, "proto16");
if (!("no-proto" in args)) for (const c of JSON.parse(readFileSync(path.join(PD, "clips.json"), "utf8"))) {
  const x = readF32(path.join(PD, `${c.name}.f32`));
  writeArr(path.join(PD, `${c.name}.post.f32`), Float32Array.from(runWorkers(S, x, 16000).col.post));
  writeArr(path.join(PD, `${c.name}.grid.f32`), Float32Array.from(labGridTrack(lab, Float32Array.from(upsample(x)), 48000)));
  console.log(`proto16 ${c.name}`);
}
