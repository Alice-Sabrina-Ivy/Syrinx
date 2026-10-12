// meters.mjs — Level 3 of the parity check (§P3): Syrinx's meters on this branch,
// run over a set of finished 16 kHz renders (parity/renders/<set>/<clip>/<cell>.f32).
//
//   node --import ./scripts/session-oracle/lib/register.mjs \
//        scripts/voice-preview/parity/meters.mjs --set=<pyworld|wasm-simd> --meter=<pitch|vtln>
//
// pitch: the real pitch chain (scripts/session-oracle/lib/chain.mjs runWorkers: real pitch
//        worker + DSP worker), posted pitch per 25 ms hop -> parity/meters/pitch/<set>/<clip>/<cell>.f32
// vtln:  the resonance lab's full live path (scripts/resonance-lab/node/lab_live.mjs ... vtln)
//        -> parity/meters/vtln/<set>.jsonl (one line per render: 150 ms bin readings)
// meters_score.py scores both sets against each other.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { P, REPO } from "../lib/paths.mjs";
import { readF32, writeArr } from "../lib/node-io.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const set = args.set, meter = args.meter;
const RD = path.join(P.parity, "renders", set);
const jobs = [];
for (const clip of readdirSync(RD).sort()) {
  for (const f of readdirSync(path.join(RD, clip)).filter((n) => n.endsWith(".f32")).sort()) {
    jobs.push({ key: `${set}/${clip}/${f.slice(0, -4)}`, audio: path.join(RD, clip, f), clip, cell: f.slice(0, -4) });
  }
}
// the original clips are measured once, with the pyworld set
if (set === "pyworld") {
  const clips = JSON.parse(readFileSync(path.join(P.clips, "proto16", "clips.json"), "utf8"));
  for (const c of clips) jobs.push({ key: `orig/${c.name}/orig`, audio: path.join(P.clips, "proto16", `${c.name}.f32`), clip: c.name, cell: "orig", orig: true });
}
const t0 = Date.now();
if (meter === "pitch") {
  const { loadSrc, runWorkers } = await import(pathToFileURL(path.join(REPO, "scripts/session-oracle/lib/chain.mjs")).href);
  const S = await loadSrc(path.join(REPO, "src"));
  for (const j of jobs) {
    const W = runWorkers(S, readF32(j.audio), 16000);
    const od = path.join(P.parity, "meters", "pitch", j.orig ? "orig" : set, j.clip);
    mkdirSync(od, { recursive: true });
    writeArr(path.join(od, `${j.cell}.f32`), Float32Array.from(W.col.post));
  }
} else if (meter === "vtln") {
  const od = path.join(P.parity, "meters", "vtln");
  mkdirSync(od, { recursive: true });
  const jp = path.join(od, `${set}.jobs.json`);
  writeFileSync(jp, JSON.stringify(jobs.map(({ key, audio }) => ({ key, audio }))));
  const r = spawnSync(process.execPath, [path.join(REPO, "scripts/resonance-lab/node/lab_live.mjs"), jp, path.join(od, `${set}.jsonl`), "vtln"],
    { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`lab_live.mjs failed (${r.status})`);
} else throw new Error("--meter=pitch|vtln");
console.log(`${meter} ${set}: ${jobs.length} files in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
