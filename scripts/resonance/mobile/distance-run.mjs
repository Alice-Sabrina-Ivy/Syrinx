// distance-run.mjs — chain.mjs's run, plus the SHORT-EXCURSION streams, for the
// distance / room area of the mobile resonance diagnosis (2026-10-28).
//
//   node scripts/resonance/mobile/distance-run.mjs go --cond=<name> [--pert=<spec>] [--gate=on|off|both]
//        [--kinds=ctl,sw,exc,long] [--exc=3,5,8] [--exc-len=30] [--only=<ids>] [--shard=i/n]
//        [--out=build/resonance-mobile/distance/runs] [--worker] [--pitch-from=<clean pitch cache dir>[,...]]
// --pitch-from: attribution mode � the pitch hints / voice-gate decisions come from the CLEAN
//   run's pitch cache (the real pitch worker on unperturbed audio); only the resonance chain
//   hears the perturbed audio (separates the resonance estimator from pitch / voice-gate effects).
//
// Streams: chain.mjs's mobile set (ctl N / U10 / D10, sw N-U10-N / N-D10-N, long L)
// plus, per reader and X in {U10, D10} and d in --exc (s):
//   exc  <reader>__N-<X>x<d>-N   N for 0-18 s, X for 18-(18+d) s, N after, 10 ms crossfades
//                                 (faster.mjs's splice), truncated to --exc-len s (30: the
//                                 8 s excursion's window ends at 29 s; the chain is causal).
// Everything else — perturbation, the REAL pitch worker + FireRedVAD, the resonance
// chain replay, the record format — is chain.mjs's (imported, unchanged).
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
if (process.argv[2] !== "go") throw new Error("usage: distance-run.mjs go --cond=... (see header)");
// frozen performance clock for the whole run, as chain.mjs / faster.mjs
Object.defineProperty(globalThis, "performance", { value: { now: () => 0, timeOrigin: 0, mark() {}, measure() {} }, configurable: true, writable: true });
const { pitchPass, binsPass, pitchStats, voicedHopRms, selectItems, SR } = await import("./chain.mjs");
const { parsePert, pertLabel, applyPert, activeLevelDb } = await import("./perturb.mjs");

const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
// faster.mjs's splice (not exported there): 10 ms linear crossfades at the joins
export function splice(parts, joins, lenS = null) {
  let n = Math.min(...parts.map((p) => p.length));
  if (lenS) n = Math.min(n, Math.round(lenS * SR));
  const y = new Float32Array(n), X = Math.round(0.005 * SR);
  const j1 = Math.round(joins[0] * SR), j2 = Math.round(joins[1] * SR);
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
export function excItems(streamsDir, tag, durs, lenS, only = []) {
  const L = JSON.parse(readFileSync(path.join(streamsDir, `readers-${tag}.json`), "utf8"));
  const items = [];
  for (const r of L.readers) {
    for (const X of ["U10", "D10"]) for (const d of durs) {
      items.push({ id: `${r.id}__N-${X}x${d}-N`, reader: r.id, sex: r.sex, kind: "exc", variant: null, seq: ["N", X, "N"], joins: [18, 18 + d], excS: d,
        load: () => splice([readF32(r.variants.N), readF32(r.variants[X]), readF32(r.variants.N)], [18, 18 + d], lenS) });
    }
  }
  if (only.length) { const o = new Set(only); return items.filter((it) => o.has(it.id) || o.has(it.reader)); }
  return items;
}

const cond = arg("cond", "");
if (!cond) throw new Error("--cond=<name> is required");
const pertList = parsePert(arg("pert", ""));
const gates = arg("gate", "both") === "both" ? ["on", "off"] : [arg("gate", "both")];
const withWorker = process.argv.includes("--worker");
const OUT = path.resolve(repo, arg("out", "build/resonance-mobile/distance/runs"), cond);
const streamsDir = path.resolve(repo, arg("streams", "build/resonance-mobile/streams"));
const kinds = arg("kinds", "ctl,sw,exc").split(",");
const only = arg("only", "").split(",").filter(Boolean);
const durs = arg("exc", "3,5,8").split(",").map(Number);
const pitchFrom = arg("pitch-from", "").split(",").filter(Boolean).map((d) => path.resolve(repo, d));
let items = [];
const chainKinds = kinds.filter((k) => k !== "exc");
if (chainKinds.length) items.push(...selectItems({ streamsDir, tag: "dev", set: "mobile", kinds: chainKinds, only }));
if (kinds.includes("exc")) items.push(...excItems(streamsDir, "dev", durs, Number(arg("exc-len", "30")), only));
// interleave by reader so shards balance and readers' gains are cached per process
items.sort((a, b) => (a.reader < b.reader ? -1 : a.reader > b.reader ? 1 : 0));
const [si, sn] = arg("shard", "0/1").split("/").map(Number);
items = items.filter((_, i) => i % sn === si);
mkdirSync(path.join(OUT, "pitch"), { recursive: true });
const out = path.join(OUT, `runs-${si}of${sn}.jsonl`);
if (existsSync(out)) {
  const txt = readFileSync(out, "utf8"), cut = txt.lastIndexOf("\n") + 1;
  if (cut < txt.length) writeFileSync(out, txt.slice(0, cut));
}
const done = new Set();
for (const f of readdirSync(OUT).filter((f) => /^runs-.*\.jsonl$/.test(f))) {
  for (const l of readFileSync(path.join(OUT, f), "utf8").split("\n")) {
    if (!l) continue;
    try { const r = JSON.parse(l); done.add(`${r.id}|${r.gate}`); } catch { /* partial line */ }
  }
}
const pertKey = JSON.stringify(pertList);
writeFileSync(path.join(OUT, `cond-${si}of${sn}.json`), JSON.stringify({ cond, pert: pertList, label: pertLabel(pertList), gates, kinds, durs, argv: process.argv.slice(2) }, null, 1));
const t0 = Date.now();
let audioS = 0;
for (const it of items) {
  const todo = gates.filter((g) => !done.has(`${it.id}|${g}`));
  if (!todo.length) continue;
  const tp0 = Date.now();
  const y0 = it.load();
  const { y, info } = await applyPert(pertList, y0, SR, { id: it.id, reader: it.reader, sex: it.sex, kind: it.kind });
  const msPert = Date.now() - tp0;
  const pf = path.join(OUT, "pitch", `${it.id}.json`);
  let meta = null, msPitch = 0;
  if (pitchFrom.length) {
    // attribution mode: the CLEAN run's pitch-worker output (hints + voice-gate decisions),
    // only the resonance worker hears the perturbed audio
    const src = pitchFrom.map((d) => path.join(d, `${it.id}.json`)).find((f) => existsSync(f));
    if (!src) throw new Error(`no clean pitch cache for ${it.id} in ${pitchFrom.join(", ")}`);
    const cm = JSON.parse(readFileSync(src, "utf8"));
    if (cm.pertKey !== "[]") throw new Error(`${src}: not a clean pitch cache`);
    const hr = voicedHopRms(y, cm.byChunk);
    meta = { id: it.id, dur: y.length / SR, byChunk: cm.byChunk, pertKey, pertInfo: info, msPitch: 0, pitchFrom: src,
      level: { inActiveDb: activeLevelDb(y0, SR), outActiveDb: activeLevelDb(y, SR), voicedHopRmsMedDb: hr.med, voicedHopRmsP10Db: hr.p10 } };
  } else if (existsSync(pf)) {
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
  for (const gate of todo) {
    const t2 = Date.now();
    const r = await binsPass(y, meta.byChunk, { gate, hintDelay: 0, worker: withWorker });
    const msBins = Date.now() - t2;
    const rec = {
      id: it.id, reader: it.reader, sex: it.sex, kind: it.kind, variant: it.variant ?? null, seq: it.seq ?? null, joins: it.joins ?? null, excS: it.excS ?? null,
      trail: 100, n: r.n, nbResets: r.nbResets, bins: r.bins, posts: r.posts, ...(r.worker ? { worker: r.worker } : {}),
      cond, gate, pert: pertList, pertInfo: meta.pertInfo, hintDelay: 0, pitchFrom: meta.pitchFrom ?? null, nbF: r.nbF, nbFinal: r.nbFinal,
      pitchStats: pitchStats(meta.byChunk), level: meta.level, ms: { pert: msPert, pitch: msPitch || meta.msPitch, pitchCached: !msPitch, bins: msBins },
    };
    appendFileSync(out, JSON.stringify(rec) + "\n");
    console.log(`${it.id} gate ${gate} bins ${r.bins.length} posts ${r.posts.length}${r.worker ? ` worker ${r.worker.checked - r.worker.mismatch}/${r.worker.checked}` : ""} pitch ${(msPitch / 1000).toFixed(1)} s bins ${(msBins / 1000).toFixed(1)} s`);
  }
  audioS += y.length / SR;
  console.log(`  [${(audioS / ((Date.now() - t0) / 1000)).toFixed(1)}x real time]`);
}
process.exit(0);
