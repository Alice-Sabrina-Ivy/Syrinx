// narrow-confirm-chain.mjs — the QUIET chain runner for the confirmation data
// of the narrower resonance-row hold round
// (measurements/resonance-row-hold-narrow-2026-11-01.md §10 step 4, "Quiet
// rule"). It runs exactly what `chain.mjs run` (speech, via pause-queue.sh)
// and `hold-noise-run.mjs` (cold-start real noise) run — the same exported
// functions (pitchPass, binsPass, pitchStats, voicedHopRms from chain.mjs;
// clipPert from hold-noise-run.mjs) and the same record, field for field —
// but per stream it prints only the id, the worker parity, the level check and
// the timing: no bins, posts, voiced, shown, idle or drawn figure.
//
//   speech (one condition; pause-queue.sh's chain.mjs call):
//     node --max-old-space-size=4096 scripts/resonance/mobile/narrow-confirm-chain.mjs speech
//          --cond=<name> --pert=<json> [--worker] --streams=<dir> --tag=conf
//          --out=build/resonance-mobile/narrow/confirm/pause/runs [--shard=i/n]
//   cold-start noise (hold-noise-run.mjs):
//     node --max-old-space-size=4096 scripts/resonance/mobile/narrow-confirm-chain.mjs noise
//          --list=scripts/resonance/mobile/narrow-confirm-noise-list.json
//          [--root=<folder; default ../Syrinx-cache/noise-real-narrow beside the repo>] [--levels=-48,-40]
//          --out=build/resonance-mobile/narrow/confirm/hold/runs [--shard=i/n] [--worker]
//
// Level checks printed: speech — the active level of the speech after the
// level step (perturb.mjs activeLevelDb; must be the spec's dbfs within
// 0.01 dB) and, for a noise condition, the DSP median of the noise alone
// (pause-noise.mjs makeRoomNoise + dspMedianDb; must be floorDb within
// 0.01 dB); cold-start noise — the DSP median of the stream (must be the level
// within 0.01 dB). A failed check stops the run.
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CACHE = path.resolve(repo, "..", "Syrinx-cache"); // the local data cache beside the repo (outside it; not published)
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const mode = process.argv[2];
if (mode !== "speech" && mode !== "noise") throw new Error("mode: speech | noise");
const { pitchPass, binsPass, pitchStats, voicedHopRms, selectItems, SR } = await import("./chain.mjs");
const { parsePert, pertLabel, applyPert, activeLevelDb } = await import("./perturb.mjs");
const { makeRoomNoise, dspMedianDb } = await import("./pause-noise.mjs");
const { clipPert, CLIP_S } = await import("./hold-noise-run.mjs");
// chain.mjs's CLI installs a frozen performance clock for the whole run; do the same
Object.defineProperty(globalThis, "performance", { value: { now: () => 0, timeOrigin: 0, mark() {}, measure() {} }, configurable: true, writable: true });

const [si, sn] = arg("shard", "0/1").split("/").map(Number);
const withWorker = process.argv.includes("--worker");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const trimPartial = (f) => { if (!existsSync(f)) return; const t = readFileSync(f, "utf8"), c = t.lastIndexOf("\n") + 1; if (c < t.length) writeFileSync(f, t.slice(0, c)); };
const near = (a, b) => Math.abs(a - b) <= 0.01;

if (mode === "speech") {
  const cond = arg("cond", "");
  if (!cond) throw new Error("--cond=<name> is required");
  const pertList = parsePert(arg("pert", ""));
  const gate = "on", hintDelay = 0;           // pause-queue.sh: --gate=on, no hint delay
  const OUT = path.resolve(repo, arg("out", "build/resonance-mobile/narrow/confirm/pause/runs"), cond);
  const streamsDir = path.resolve(repo, arg("streams", "build/resonance-mobile/narrow/confirm/streams"));
  let items = selectItems({ streamsDir, tag: arg("tag", "conf"), set: "mobile", kinds: ["long"], only: arg("only", "").split(",").filter(Boolean) });
  items = items.filter((_, i) => i % sn === si);
  mkdirSync(path.join(OUT, "pitch"), { recursive: true });
  const out = path.join(OUT, `runs-${si}of${sn}.jsonl`);
  trimPartial(out);
  const done = new Set();
  for (const f of readdirSync(OUT).filter((f) => /^runs-.*\.jsonl$/.test(f))) {
    for (const l of readFileSync(path.join(OUT, f), "utf8").split("\n")) { if (!l) continue; try { const r = JSON.parse(l); done.add(`${r.id}|${r.gate}`); } catch { /* partial */ } }
  }
  const pertKey = JSON.stringify(pertList);
  // chain.mjs writes the same cond file (its argv names the original runner's flags)
  writeFileSync(path.join(OUT, `cond-${si}of${sn}.json`), JSON.stringify({ cond, pert: pertList, label: pertLabel(pertList), gates: [gate], hintDelay, argv: process.argv.slice(2) }, null, 1));
  const lvl = pertList.find((t) => t.type === "level");
  const mod = pertList.find((t) => t.type === "mod");
  let totMis = 0, totChk = 0;
  console.log(`${cond} shard ${si}/${sn}: ${items.length} streams`);
  for (const it of items) {
    if (done.has(`${it.id}|${gate}`)) continue;
    const tp0 = Date.now();
    const y0 = it.load();
    const ctx = { id: it.id, reader: it.reader, sex: it.sex, kind: it.kind };
    const { y, info } = await applyPert(pertList, y0, SR, ctx);
    const msPert = Date.now() - tp0;
    // level checks (integrity only)
    let chk = "";
    if (lvl) {
      const { y: ys } = await applyPert([lvl], y0, SR, ctx);
      const a = activeLevelDb(ys, SR);
      if (!near(a, lvl.dbfs)) throw new Error(`${it.id}: speech active level ${a}`);
      chk += `speech ${a.toFixed(2)} dBFS`;
    }
    if (mod) {
      const { z } = await makeRoomNoise(y0.length, SR, mod.params, ctx.reader ?? ctx.id ?? "");
      const m = dspMedianDb(z);
      if (!near(m, mod.params.floorDb)) throw new Error(`${it.id}: noise DSP median ${m}`);
      chk += `, noise ${m.toFixed(2)} dBFS`;
    }
    const pf = path.join(OUT, "pitch", `${it.id}.json`);
    let meta = null, msPitch = 0;
    if (existsSync(pf)) {
      meta = JSON.parse(readFileSync(pf, "utf8"));
      if (meta.pertKey !== pertKey) throw new Error(`${pf}: cached for another perturbation`);
    } else {
      const t1 = Date.now();
      const byChunk = await pitchPass(y);
      msPitch = Date.now() - t1;
      const hr = voicedHopRms(y, byChunk);
      meta = { id: it.id, dur: y.length / SR, byChunk, pertKey, pertInfo: info, msPitch,
        level: { inActiveDb: activeLevelDb(y0, SR), outActiveDb: activeLevelDb(y, SR), voicedHopRmsMedDb: hr.med, voicedHopRmsP10Db: hr.p10 } };
      writeFileSync(pf, JSON.stringify(meta));
    }
    const t2 = Date.now();
    const r = await binsPass(y, meta.byChunk, { gate, hintDelay, worker: withWorker });
    const msBins = Date.now() - t2;
    const rec = {
      id: it.id, reader: it.reader, sex: it.sex, kind: it.kind, variant: it.variant ?? null, seq: it.seq ?? null, joins: it.joins ?? null,
      trail: 100, n: r.n, nbResets: r.nbResets, bins: r.bins, posts: r.posts, ...(r.worker ? { worker: r.worker } : {}),
      cond, gate, pert: pertList, pertInfo: meta.pertInfo, hintDelay, nbF: r.nbF, nbFinal: r.nbFinal,
      pitchStats: pitchStats(meta.byChunk), level: meta.level, ms: { pert: msPert, pitch: msPitch || meta.msPitch, pitchCached: !msPitch, bins: msBins },
    };
    appendFileSync(out, JSON.stringify(rec) + "\n");
    if (r.worker) { totMis += r.worker.mismatch; totChk += r.worker.checked; }
    console.log(`${it.id}: ${chk}${r.worker ? `, worker ${r.worker.checked - r.worker.mismatch}/${r.worker.checked} equal` : ""}, pitch ${(msPitch / 1000).toFixed(1)} s bins ${(msBins / 1000).toFixed(1)} s`);
  }
  if (withWorker) console.log(`worker parity: ${totChk - totMis}/${totChk} posts equal`);
  process.exit(0);
}

// ---- cold-start noise: hold-noise-run.mjs's loop, quiet
const root = arg("root", path.join(CACHE, "noise-real-narrow"));
const listPath = path.resolve(repo, arg("list", "scripts/resonance/mobile/narrow-confirm-noise-list.json"));
const list = JSON.parse(readFileSync(listPath, "utf8")).clips;
const levels = arg("levels", "-48,-40").split(",").map(Number);
const outRoot = path.resolve(repo, arg("out", "build/resonance-mobile/narrow/confirm/hold/runs"));
const jobs = [];
for (const L of levels) for (const c of list) jobs.push({ L, c });
const mine = jobs.filter((_, i) => i % sn === si);
for (const L of levels) mkdirSync(path.join(outRoot, `RN_m${-L}`, "pitch"), { recursive: true });
const done = new Set();
for (const L of levels) {
  const dir = path.join(outRoot, `RN_m${-L}`);
  for (const f of readdirSync(dir).filter((f) => /^runs-.*\.jsonl$/.test(f))) {
    trimPartial(path.join(dir, f));
    for (const l of readFileSync(path.join(dir, f), "utf8").split("\n")) { if (!l) continue; try { const r = JSON.parse(l); done.add(`${L}|${r.id}`); } catch { /* partial */ } }
  }
}
console.log(`${mine.length} jobs (${mine.filter((j) => done.has(`${j.L}|${j.c.id}`)).length} done)`);
let totMis = 0, totChk = 0;
for (const { L, c } of mine) {
  if (done.has(`${L}|${c.id}`)) continue;
  const t0 = Date.now();
  const cond = `RN_m${-L}`;
  const dir = path.join(outRoot, cond);
  const out = path.join(dir, `runs-${si}of${sn}.jsonl`);
  const clipPath = path.join(root, "clips", `${c.id}.wav`);
  if (!existsSync(clipPath)) throw new Error(`missing clip ${clipPath}`);
  if (c.clipSha256 && sha256(readFileSync(clipPath)) !== c.clipSha256) throw new Error(`${clipPath}: sha256 differs from the list`);
  const pert = clipPert(clipPath, L);
  const y0 = new Float32Array(CLIP_S * SR);
  const ctx = { id: c.id, reader: c.id, sex: "na", kind: "ext" };
  const { y, info } = await applyPert(pert, y0, SR, ctx);
  const lv = dspMedianDb(y);
  if (!near(lv, L)) throw new Error(`${c.id}: stream DSP median ${lv}, not ${L}`);
  const tp = Date.now();
  const byChunk = await pitchPass(y);
  const msPitch = Date.now() - tp;
  const hr = voicedHopRms(y, byChunk);
  const meta = { id: c.id, dur: y.length / SR, byChunk, pertKey: JSON.stringify(pert), pertInfo: info, msPitch,
    level: { inActiveDb: activeLevelDb(y0, SR), outActiveDb: activeLevelDb(y, SR), voicedHopRmsMedDb: hr.med, voicedHopRmsP10Db: hr.p10 } };
  writeFileSync(path.join(dir, "pitch", `${c.id}.json`), JSON.stringify(meta));
  const tb = Date.now();
  const r = await binsPass(y, byChunk, { gate: "on", worker: withWorker });
  const rec = {
    id: c.id, reader: c.id, sex: "na", kind: "ext", variant: null, seq: null, joins: null, cls: c.cls, source: c.source,
    trail: 100, n: r.n, nbResets: r.nbResets, bins: r.bins, posts: r.posts, ...(r.worker ? { worker: r.worker } : {}),
    cond, gate: "on", pert, pertInfo: info, hintDelay: 0, nbF: r.nbF, nbFinal: r.nbFinal,
    pitchStats: pitchStats(byChunk), level: meta.level, ms: { pitch: msPitch, bins: Date.now() - tb },
  };
  appendFileSync(out, JSON.stringify(rec) + "\n");
  if (r.worker) { totMis += r.worker.mismatch; totChk += r.worker.checked; }
  console.log(`${cond} ${c.id}: level ${lv.toFixed(2)} dBFS${r.worker ? `, worker ${r.worker.checked - r.worker.mismatch}/${r.worker.checked} equal` : ""}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
if (withWorker) console.log(`worker parity: ${totChk - totMis}/${totChk} posts equal`);
process.exit(0);
