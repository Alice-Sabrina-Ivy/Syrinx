// channel-run.mjs — chain.mjs's chain (REAL pitch worker + FireRedVAD, the
// resonance worker's chain replayed) over the mobile set's controls / switch
// streams PLUS short-excursion streams, under one channel condition of
// channel-conds.mjs (mobile resonance diagnosis, channel area, 2026-10-28).
//
//   node scripts/resonance/mobile/channel-run.mjs --cond=<name from channel-conds.mjs | clean>
//        [--shard=i/n] [--kinds=ctl,sw,exc] [--only=<reader ids>] [--out=build/resonance-mobile/channel/runs]
//        [--gate=on|off]
//
// Short-excursion streams (per reader, d = 3, 5, 8 s): N for 0-18 s, U10 (or
// D10) for 18 to 18 + d s, N again until 18 + d + 3.5 s (10 ms crossfades, as
// faster.mjs splice). ids <reader>__XU<d> / <reader>__XD<d>, kind "exc",
// seq ["N", "U10"|"D10", "N"], joins [18, 18 + d].
// Records: chain.mjs's format; ctl / sw in runs-<i>of<n>.jsonl (readable by
// summarize.mjs), exc in exc-<i>of<n>.jsonl (channel-report.mjs).
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
// the frozen performance clock for the whole run (chain.mjs installs the same on first pitch pass)
Object.defineProperty(globalThis, "performance", { value: { now: () => 0, timeOrigin: 0, mark() {}, measure() {} }, configurable: true, writable: true });
const { selectItems, pitchPass, binsPass, pitchStats, voicedHopRms, SR } = await import("./chain.mjs");
const { applyPert, activeLevelDb } = await import("./perturb.mjs");
const { byName } = await import("./channel-conds.mjs");

export const EXC_D = [3, 5, 8], EXC_T0 = 18, EXC_TAIL = 3.5;
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
function splice3(parts, joins, n) {
  const y = new Float32Array(n), X = Math.round(0.005 * SR), j1 = Math.round(joins[0] * SR), j2 = Math.round(joins[1] * SR);
  for (let i = 0; i < n; i++) {
    let w;
    if (i < j1 - X) w = [1, 0, 0];
    else if (i < j1 + X) { const a = (i - (j1 - X)) / (2 * X); w = [1 - a, a, 0]; }
    else if (i < j2 - X) w = [0, 1, 0];
    else if (i < j2 + X) { const a = (i - (j2 - X)) / (2 * X); w = [0, 1 - a, a]; }
    else w = [0, 0, 1];
    y[i] = w[0] * parts[0][i] + w[1] * parts[1][i] + w[2] * parts[2][i];
  }
  return y;
}
export function excItems(streamsDir, tag = "dev") {
  const L = JSON.parse(readFileSync(path.join(streamsDir, `readers-${tag}.json`), "utf8"));
  const items = [];
  for (const r of L.readers) for (const B of ["U10", "D10"]) for (const d of EXC_D) {
    const joins = [EXC_T0, EXC_T0 + d], n = Math.round((EXC_T0 + d + EXC_TAIL) * SR);
    items.push({ id: `${r.id}__X${B[0]}${d}`, reader: r.id, sex: r.sex, kind: "exc", variant: `X${B[0]}${d}`, seq: ["N", B, "N"], joins, dur: d,
      load: () => { const a = readF32(r.variants.N), b = readF32(r.variants[B]); return splice3([a, b, a], joins, n); } });
  }
  return items;
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const cond = arg("cond", "");
  if (!cond) throw new Error("--cond required");
  const pertList = cond === "clean" ? [] : byName[cond]?.pert;
  if (!pertList) throw new Error(`unknown condition ${cond}`);
  const gate = arg("gate", "on");
  const kinds = arg("kinds", "ctl,sw,exc").split(",");
  const only = arg("only", "").split(",").filter(Boolean);
  const streamsDir = path.resolve(repo, arg("streams", "build/resonance-mobile/streams"));
  const OUT = path.resolve(repo, arg("out", "build/resonance-mobile/channel/runs"), cond);
  let items = [
    ...selectItems({ streamsDir, kinds: kinds.filter((k) => k !== "exc"), only }),
    ...(kinds.includes("exc") ? excItems(streamsDir).filter((it) => !only.length || only.includes(it.reader) || only.includes(it.id)) : []),
  ];
  const [si, sn] = arg("shard", "0/1").split("/").map(Number);
  items = items.filter((_, i) => i % sn === si);
  mkdirSync(path.join(OUT, "pitch"), { recursive: true });
  const files = { run: path.join(OUT, `runs-${si}of${sn}.jsonl`), exc: path.join(OUT, `exc-${si}of${sn}.jsonl`) };
  for (const f of Object.values(files)) if (existsSync(f)) { const t = readFileSync(f, "utf8"), c = t.lastIndexOf("\n") + 1; if (c < t.length) writeFileSync(f, t.slice(0, c)); }
  const done = new Set();
  for (const f of readdirSync(OUT).filter((f) => /^(runs|exc)-.*\.jsonl$/.test(f)))
    for (const l of readFileSync(path.join(OUT, f), "utf8").split("\n")) { if (!l) continue; try { const r = JSON.parse(l); done.add(`${r.id}|${r.gate}`); } catch { /* partial */ } }
  const pertKey = JSON.stringify(pertList);
  writeFileSync(path.join(OUT, `cond-${si}of${sn}.json`), JSON.stringify({ cond, pert: pertList, desc: byName[cond]?.desc ?? "clean", gate, argv: process.argv.slice(2) }, null, 1));
  const t0 = Date.now();
  let audioS = 0;
  for (const it of items) {
    if (done.has(`${it.id}|${gate}`)) continue;
    const tp0 = Date.now();
    const y0 = it.load();
    const { y, info } = await applyPert(pertList, y0, SR, { id: it.id, reader: it.reader, sex: it.sex, kind: it.kind });
    const msPert = Date.now() - tp0;
    const pf = path.join(OUT, "pitch", `${it.id}.json`);
    let meta, msPitch = 0;
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
    const r = await binsPass(y, meta.byChunk, { gate, hintDelay: 0, worker: false });
    const rec = {
      id: it.id, reader: it.reader, sex: it.sex, kind: it.kind, variant: it.variant ?? null, seq: it.seq ?? null, joins: it.joins ?? null,
      trail: 100, n: r.n, nbResets: r.nbResets, bins: r.bins, posts: r.posts,
      cond, gate, pert: pertList, pertInfo: meta.pertInfo, hintDelay: 0, nbF: r.nbF, nbFinal: r.nbFinal,
      pitchStats: pitchStats(meta.byChunk), level: meta.level, ms: { pert: msPert, pitch: msPitch || meta.msPitch, pitchCached: !msPitch, bins: Date.now() - t2 },
    };
    appendFileSync(it.kind === "exc" ? files.exc : files.run, JSON.stringify(rec) + "\n");
    audioS += y.length / SR;
    console.log(`${it.id} ${gate} pitch ${(msPitch / 1000).toFixed(1)} s bins ${((Date.now() - t2) / 1000).toFixed(1)} s [${(audioS / ((Date.now() - t0) / 1000)).toFixed(1)}x]`);
  }
  process.exit(0);
}
