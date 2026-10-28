// level-run.mjs — chain.mjs's run mode plus the SHORT-EXCURSION streams
// (mobile resonance diagnosis, level / noise / voice-gate area, 2026-10-28).
//
//   node scripts/resonance/mobile/level-run.mjs run --cond=<name> [--pert=<spec>] [--gate=on|off|both]
//        [--kinds=ctl,sw,long,exc] [--only=<ids or readers>] [--shard=i/n]
//        [--out=build/resonance-mobile/level] [--ref-pitch=<dir>[,<dir>...]]
//
// Same chain, same record as chain.mjs (it imports chain.mjs's pitchPass /
// binsPass / pitchStats unchanged), with:
//   kind "exc": per reader and direction V in {U10, D10} and duration D in
//     {3, 5, 8} s, the stream N 0..18 s, V 18..18+D s, N after, 10 ms
//     crossfades (faster.mjs's splice, copied verbatim), cut at 18 + D + 3.5 s
//     (the chain is causal, so the cut changes nothing before it).
//     id <reader>__N-<V>x<D>-N, seq [N, V, N], joins [18, 18 + D], excD = D.
//   levelQ: the 25 ms RMS (dBFS, full band, the diag's inputRms scale) at the
//     voiced hops, q10 / q50 / q90: "own" = the hops this condition's pitch
//     worker posted voiced; "ref" = the hops the CLEAN run posted voiced (the
//     same frames in every condition — for a gain-only condition exactly clean
//     + gain). The clean voicing is read from --ref-pitch dirs (pitch caches).
// Everything else (perturbation, both gates from one pitch pass, resumable
// output, pitch cache per condition) is chain.mjs's behaviour.
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// frozen clock before any chain module loads (chain.mjs installs its own self too)
Object.defineProperty(globalThis, "performance", { value: { now: () => 0, timeOrigin: 0, mark() {}, measure() {} }, configurable: true, writable: true });
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const C = await import("./chain.mjs");
const { parsePert, pertLabel, applyPert, activeLevelDb } = await import("./perturb.mjs");
const { SR, CH } = C;

export const EXC = { start: 18, durs: [3, 5, 8], dirs: ["U10", "D10"], tail: 3.5 };
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
// faster.mjs splice (verbatim, plus an output length)
function splice(parts, joins, len) {
  const n = Math.min(len, ...parts.map((p) => p.length)), y = new Float32Array(n), X = Math.round(0.005 * SR);
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
export function excItems(L) {
  const items = [];
  for (const r of L.readers) {
    for (const V of EXC.dirs) for (const D of EXC.durs) {
      const joins = [EXC.start, EXC.start + D], len = Math.round((EXC.start + D + EXC.tail) * SR);
      items.push({ id: `${r.id}__N-${V}x${D}-N`, reader: r.id, sex: r.sex, kind: "exc", variant: null, seq: ["N", V, "N"], joins, excD: D,
        load: () => splice([readF32(r.variants.N), readF32(r.variants[V]), readF32(r.variants.N)], joins, len) });
    }
  }
  return items;
}
const pct = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
/** 25 ms RMS (dBFS) of y ending at each voiced hop of byChunk: q10 / q50 / q90. */
export function hopRmsQ(y, byChunk) {
  const out = [];
  for (const c of byChunk) for (const m of c) {
    if (!m[0] || typeof m[2] !== "number") continue;
    const e = Math.min(y.length, Math.round(m[2] * SR)), b = Math.max(0, e - CH);
    if (e - b < CH / 2) continue;
    let s = 0; for (let i = b; i < e; i++) s += y[i] * y[i];
    out.push(10 * Math.log10(s / (e - b) + 1e-20));
  }
  return { q10: pct(out, 0.1), q50: pct(out, 0.5), q90: pct(out, 0.9), n: out.length };
}

if (process.argv[2] === "run") {
  const cond = arg("cond", "");
  if (!cond) throw new Error("--cond=<name> is required");
  const pertList = parsePert(arg("pert", ""));
  const gates = arg("gate", "both") === "both" ? ["on", "off"] : [arg("gate", "both")];
  const OUT = path.resolve(repo, arg("out", "build/resonance-mobile/level"), cond);
  const streamsDir = path.resolve(repo, arg("streams", "build/resonance-mobile/streams"));
  const kinds = arg("kinds", "ctl,sw,exc").split(",");
  const only = arg("only", "").split(",").filter(Boolean);
  const refDirs = arg("ref-pitch", "build/resonance-mobile/runs/clean/pitch,build/resonance-mobile/level/g0/pitch").split(",").filter(Boolean).map((d) => path.resolve(repo, d));
  const L = JSON.parse(readFileSync(path.join(streamsDir, "readers-dev.json"), "utf8"));
  let items = C.selectItems({ streamsDir, kinds: kinds.filter((k) => k !== "exc"), only });
  if (kinds.includes("exc")) {
    let ex = excItems(L);
    if (only.length) { const o = new Set(only); ex = ex.filter((it) => o.has(it.id) || o.has(it.reader)); }
    items = items.concat(ex);
  }
  const [si, sn] = arg("shard", "0/1").split("/").map(Number);
  items = items.filter((_, i) => i % sn === si);
  mkdirSync(path.join(OUT, "pitch"), { recursive: true });
  const out = path.join(OUT, `runs-${si}of${sn}.jsonl`);
  if (existsSync(out)) { const txt = readFileSync(out, "utf8"), cut = txt.lastIndexOf("\n") + 1; if (cut < txt.length) writeFileSync(out, txt.slice(0, cut)); }
  const done = new Set();
  for (const f of readdirSync(OUT).filter((f) => /^runs-.*\.jsonl$/.test(f))) {
    for (const l of readFileSync(path.join(OUT, f), "utf8").split("\n")) { if (!l) continue; try { const r = JSON.parse(l); done.add(`${r.id}|${r.gate}`); } catch { /* partial */ } }
  }
  const pertKey = JSON.stringify(pertList);
  writeFileSync(path.join(OUT, `cond-${si}of${sn}.json`), JSON.stringify({ cond, pert: pertList, label: pertLabel(pertList), gates, argv: process.argv.slice(2) }, null, 1));
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
    if (existsSync(pf)) {
      meta = JSON.parse(readFileSync(pf, "utf8"));
      if (meta.pertKey !== pertKey) throw new Error(`${pf}: cached for another perturbation`);
    } else {
      const t1 = Date.now();
      const byChunk = await C.pitchPass(y);
      msPitch = Date.now() - t1;
      const hr = C.voicedHopRms(y, byChunk);
      const own = hopRmsQ(y, byChunk);
      let ref = null;
      for (const d of refDirs) {
        const rf = path.join(d, `${it.id}.json`);
        if (path.resolve(rf) === path.resolve(pf)) { ref = own; break; }
        if (existsSync(rf)) { ref = hopRmsQ(y, JSON.parse(readFileSync(rf, "utf8")).byChunk); break; }
      }
      meta = { id: it.id, dur: y.length / SR, byChunk, pertKey, pertInfo: info, msPitch,
        level: { inActiveDb: activeLevelDb(y0, SR), outActiveDb: activeLevelDb(y, SR), voicedHopRmsMedDb: hr.med, voicedHopRmsP10Db: hr.p10 },
        levelQ: { own, ref } };
      writeFileSync(pf, JSON.stringify(meta));
    }
    for (const gate of todo) {
      const t2 = Date.now();
      const r = await C.binsPass(y, meta.byChunk, { gate, hintDelay: 0 });
      const msBins = Date.now() - t2;
      const rec = {
        id: it.id, reader: it.reader, sex: it.sex, kind: it.kind, variant: it.variant ?? null, seq: it.seq ?? null, joins: it.joins ?? null,
        excD: it.excD ?? null, trail: 100, n: r.n, nbResets: r.nbResets, bins: r.bins, posts: r.posts,
        cond, gate, pert: pertList, pertInfo: meta.pertInfo, hintDelay: 0, nbF: r.nbF, nbFinal: r.nbFinal,
        pitchStats: C.pitchStats(meta.byChunk), level: meta.level, levelQ: meta.levelQ ?? null,
        ms: { pert: msPert, pitch: msPitch || meta.msPitch, pitchCached: !msPitch, bins: msBins },
      };
      appendFileSync(out, JSON.stringify(rec) + "\n");
      console.log(`${it.id} gate ${gate} bins ${r.bins.length} posts ${r.posts.length} pitch ${(msPitch / 1000).toFixed(1)} s bins ${(msBins / 1000).toFixed(1)} s`);
    }
    audioS += y.length / SR;
    console.log(`  [${(audioS / ((Date.now() - t0) / 1000)).toFixed(1)}x real time]`);
  }
  process.exit(0);
}
