// hirate-meters.mjs — Level 3 of the parity check at 32 000, 44 100 and 48 000 Hz (§ Addition
// 2026-10-12, A4, of measurements/voice-preview-spike-2026-10-12.md): Syrinx's meters on the
// finished pyworld renders, read exactly as fe/rate-check.mjs reads the finished WebAssembly
// renders (its post/ and vtln.jsonl are the WebAssembly side):
//   pitch  the real pitch chain (session-oracle runWorkers) on each render at its own rate
//          -> fe/<dir>/meters-pyworld/post/<rate>/<clip>/<cell>.f32
//   VTLN   the lab's live path (lab_live.mjs ... vtln, 16 kHz input) on each render brought to
//          16 kHz with the page's sinc resampler -> fe/<dir>/meters-pyworld/vtln.jsonl
//
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-preview/parity/hirate-meters.mjs
//        [--dir=rate-hi] [--rates=32000,44100,48000]
// Scored by parity/hirate_score.py.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P, REPO } from "../lib/paths.mjs";
import { readF32, writeArr } from "../lib/node-io.mjs";
import { resampleClip } from "../lib/preview-core.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const D = path.join(P.fe, args.dir || "rate-hi");
const RATES = (args.rates || "32000,44100,48000").split(",").map(Number);
const { loadSrc, runWorkers } = await import(pathToFileURL(path.join(REPO, "scripts/session-oracle/lib/chain.mjs")).href);
const S = await loadSrc(path.join(REPO, "src"));
const OUT = path.join(D, "meters-pyworld");
const mk = (...p) => { const d = path.join(...p); mkdirSync(d, { recursive: true }); return d; };
const t00 = Date.now();
const jobs = [];
for (const rate of RATES) {
  const RD = path.join(D, "pyworld", String(rate));
  for (const clip of readdirSync(RD).sort()) {
    const pd = mk(OUT, "post", String(rate), clip), rd = mk(OUT, "r16", String(rate), clip);
    for (const f of readdirSync(path.join(RD, clip)).filter((n) => n.endsWith(".f32")).sort()) {
      const y = readF32(path.join(RD, clip, f));
      writeArr(path.join(pd, f), Float32Array.from(runWorkers(S, y, rate).col.post));
      writeArr(path.join(rd, f), resampleClip(y, rate, 16000));
      jobs.push({ key: `${rate}/${clip}/${f.slice(0, -4)}`, audio: path.join(rd, f) });
    }
    console.log(`${rate} ${clip} done (${((Date.now() - t00) / 1000).toFixed(0)} s)`);
  }
}
const jp = path.join(OUT, "vtln.jobs.json");
writeFileSync(jp, JSON.stringify(jobs));
const r = spawnSync(process.execPath, [path.join(REPO, "scripts/resonance-lab/node/lab_live.mjs"), jp, path.join(OUT, "vtln.jsonl"), "vtln"], { stdio: "inherit" });
if (r.status !== 0) throw new Error(`lab_live.mjs failed (${r.status})`);
console.log(`done, ${jobs.length} renders, ${((Date.now() - t00) / 1000).toFixed(0)} s`);
