// hold-noise-run.mjs — the resonance row hold's noise-only guard (G1,
// measurements/resonance-row-hold-2026-10-28.md), stage 1 of 3: the fresh
// real-noise clips (hold-noise-list.json, fetched by hold-noise-fetch.py)
// through chain.mjs's REAL pitch worker + real FireRedVAD and the resonance
// worker's chain (gate on), at a phone level.
//
//   node scripts/resonance/mobile/hold-noise-run.mjs [--levels=-48,-40] [--shard=i/n]
//        [--root=C:/Coding Projects/Syrinx-cache/noise-real] [--out=build/resonance-mobile/hold/runs]
//
// Each clip (60 s, mono PCM16 WAV at its source rate) becomes a 60 s, 48 kHz
// noise-only stream exactly as pause-noise.mjs builds room noise: resampled
// with the app's resampleClip, from the clip's start (offset 0, no loop seam),
// a 50 Hz high-pass (one 12 dB/oct section: a phone microphone's low cut) and
// scaled so that the MEDIAN of the DSP worker's 50 ms full-band intensity is
// the level (dBFS). The stream = 60 s of zeros + that noise (a perturb.mjs
// `mod` spec in the record), so pause-row.mjs rebuilds it identically (kind
// "ext"). Output per level: <out>/RN_m<level>/runs-<i>of<n>.jsonl and
// pitch/<clip id>.json, in chain.mjs's format (resumable).
// Then: pause-row.mjs --runs=<out> --out=build/resonance-mobile/hold/hook, and
// hold-report.mjs.
// Narrower-hold round (2026-11-01, measurements/resonance-row-hold-narrow-
// 2026-11-01.md §4.2): --quiet prints per stream only its id, the level check
// (the stream's DSP median, dBFS) and the timing — no voiced or shown figures;
// --list=<clip list json> (default the dev list hold-noise-list.json).
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const { pitchPass, binsPass, pitchStats, voicedHopRms, SR } = await import("./chain.mjs");
const { applyPert, activeLevelDb } = await import("./perturb.mjs");

export const CLIP_S = 60;
export const SEED = 20261101;
const MOD = path.join(repo, "scripts/resonance/mobile/pause-noise.mjs").replace(/\\/g, "/");
/** The perturbation that turns 60 s of zeros into the clip's noise-only stream at floorDb. */
export const clipPert = (clipPath, floorDb) => [{ type: "mod", path: MOD, params: { kind: "file", path: clipPath.replace(/\\/g, "/"), floorDb, hp: 50, hpN: 1, seed: SEED, offset: 0 } }];

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const root = arg("root", "C:/Coding Projects/Syrinx-cache/noise-real");
  const list = JSON.parse(readFileSync(path.resolve(repo, arg("list", "scripts/resonance/mobile/hold-noise-list.json")), "utf8")).clips;
  const QUIET = process.argv.includes("--quiet");
  const { dspMedianDb } = await import("./pause-noise.mjs");
  const levels = arg("levels", "-48,-40").split(",").map(Number);
  const outRoot = path.resolve(repo, arg("out", "build/resonance-mobile/hold/runs"));
  const [si, sn] = arg("shard", "0/1").split("/").map(Number);
  const jobs = [];
  for (const L of levels) for (const c of list) jobs.push({ L, c });
  const mine = jobs.filter((_, i) => i % sn === si);
  const t0 = Date.now();
  let audioS = 0;
  for (const L of levels) mkdirSync(path.join(outRoot, `RN_m${-L}`, "pitch"), { recursive: true });
  const done = new Set();
  for (const L of levels) {
    const dir = path.join(outRoot, `RN_m${-L}`);
    for (const f of readdirSync(dir).filter((f) => /^runs-.*\.jsonl$/.test(f))) {
      const txt = readFileSync(path.join(dir, f), "utf8");
      for (const l of txt.split("\n")) { if (!l) continue; try { const r = JSON.parse(l); done.add(`${L}|${r.id}`); } catch { /* partial line */ } }
    }
  }
  console.log(`${mine.length} jobs (${mine.filter((j) => done.has(`${j.L}|${j.c.id}`)).length} done)`);
  for (const { L, c } of mine) {
    if (done.has(`${L}|${c.id}`)) continue;
    const cond = `RN_m${-L}`;
    const dir = path.join(outRoot, cond);
    const out = path.join(dir, `runs-${si}of${sn}.jsonl`);
    const clipPath = path.join(root, "clips", `${c.id}.wav`);
    if (!existsSync(clipPath)) throw new Error(`missing clip ${clipPath} (run hold-noise-fetch.py)`);
    const pert = clipPert(clipPath, L);
    const y0 = new Float32Array(CLIP_S * SR);
    const ctx = { id: c.id, reader: c.id, sex: "na", kind: "ext" };
    const { y, info } = await applyPert(pert, y0, SR, ctx);
    const tp = Date.now();
    const byChunk = await pitchPass(y);
    const msPitch = Date.now() - tp;
    const hr = voicedHopRms(y, byChunk);
    const meta = { id: c.id, dur: y.length / SR, byChunk, pertKey: JSON.stringify(pert), pertInfo: info, msPitch,
      level: { inActiveDb: activeLevelDb(y0, SR), outActiveDb: activeLevelDb(y, SR), voicedHopRmsMedDb: hr.med, voicedHopRmsP10Db: hr.p10 } };
    writeFileSync(path.join(dir, "pitch", `${c.id}.json`), JSON.stringify(meta));
    const tb = Date.now();
    const r = await binsPass(y, byChunk, { gate: "on" });
    const rec = {
      id: c.id, reader: c.id, sex: "na", kind: "ext", variant: null, seq: null, joins: null, cls: c.cls, source: c.source,
      trail: 100, n: r.n, nbResets: r.nbResets, bins: r.bins, posts: r.posts,
      cond, gate: "on", pert, pertInfo: info, hintDelay: 0, nbF: r.nbF, nbFinal: r.nbFinal,
      pitchStats: pitchStats(byChunk), level: meta.level, ms: { pitch: msPitch, bins: Date.now() - tb },
    };
    appendFileSync(out, JSON.stringify(rec) + "\n");
    audioS += CLIP_S;
    const ps = rec.pitchStats;
    if (QUIET) console.log(`${cond} ${c.id}: level ${dspMedianDb(y).toFixed(2)} dBFS, pitch ${(msPitch / 1000).toFixed(1)} s [${(audioS / ((Date.now() - t0) / 1000)).toFixed(1)}x real time]`);
    else console.log(`${cond} ${c.id}: voiced ${(100 * ps.voiced / ps.hops).toFixed(1)} % shown ${(100 * (ps.voiced - ps.hidden) / ps.hops).toFixed(1)} % [${(audioS / ((Date.now() - t0) / 1000)).toFixed(1)}x real time]`);
  }
  process.exit(0);
}
