// gate-sched.mjs — as gate-lag.mjs, for the delivery schedules of
// audit-chain.mjs (dN, jN, stM:P): verdict shares at the chunks and the share
// of voiced chunks whose verdict drops bins (warming / sustained, or the
// latch after a sustained verdict, as resonanceCue.js applies it).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const { createUtteranceGate } = await import(pathToFileURL(path.join(repo, "src/ml/utterance-gate.js")).href);
const dir = path.resolve(repo, arg("pitch", "build/resonance-mobile/audit/pitch/c0"));
const files = readdirSync(dir).filter((f) => /__(L|N)\.json$/.test(f));
const V = ["silent", "warming", "score", "sustained", "pause", "stale"];
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function schedule(spec, nC) {
  const d = new Int32Array(nC); let m;
  if ((m = /^d(\d+)$/.exec(spec))) { for (let k = 0; k < nC; k++) d[k] = k + +m[1]; }
  else if ((m = /^j(\d+)$/.exec(spec))) { const r = rng(12345); let p = 0; for (let k = 0; k < nC; k++) { p = Math.max(p, k + Math.floor(r() * (+m[1] + 1))); d[k] = p; } }
  else if ((m = /^st(\d+):([\d.]+)$/.exec(spec))) { const M = Math.round(+m[1] / 25), P = Math.round(+m[2] * 40); for (let k = 0; k < nC; k++) { const ph = k % P; d[k] = ph >= P - M ? (k - ph + P - 1) + 1 : k; } }
  return d;
}
const specs = arg("scheds", "d0,d24,d28,d32,d36,j8,j20,j40,st300:2,st500:2,st750:3,st1000:3,st1500:5").split(",");
console.log("| schedule | " + V.join(" | ") + " | voiced chunks dropped |");
console.log("|---|" + V.map(() => "---").join("|") + "|---|");
for (const spec of specs) {
  const cnt = Object.fromEntries(V.map((v) => [v, 0]));
  let vc = 0, vdrop = 0;
  for (const f of files) {
    const j = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    const g = createUtteranceGate();
    const n = j.byChunk.length, del = schedule(spec, n);
    const after = new Map();
    for (let k = 0; k < n; k++) { if (!after.has(del[k])) after.set(del[k], []); after.get(del[k]).push(k); }
    let latched = false;
    for (let k = 0; k < n; k++) {
      const ct = (k + 1) * 0.025;
      const verdict = g.decide(ct * 1000).verdict;
      if (verdict === "sustained") latched = true; else if (verdict === "score" || verdict === "pause") latched = false;
      cnt[verdict]++;
      const kk = k + 2 < n ? j.byChunk[k + 2].find((mm) => Math.abs(mm[2] - ct) < 1e-9) : null;
      if (kk && kk[0] && kk[3] !== 0) { vc++; if (verdict === "warming" || verdict === "sustained" || latched) vdrop++; }
      for (const s of after.get(k) ?? []) for (const mm of j.byChunk[s]) g.notePitchHint({ voiced: mm[3] === 0 ? false : !!mm[0], pitch: mm[1], ts: mm[2] * 1000 });
    }
  }
  const tot = Object.values(cnt).reduce((a, b) => a + b, 0);
  console.log(`| ${spec} | ` + V.map((v) => (100 * cnt[v] / tot).toFixed(1) + " %").join(" | ") + ` | ${(100 * vdrop / vc).toFixed(1)} % |`);
}
