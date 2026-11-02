// channel-split.mjs — where does a channel condition's bias come from? The
// resonance chain (bins pass only, chain.mjs binsPass, gate on) is replayed on
// the controls with the audio and the pitch track taken from different runs:
//   arm "vtln"  : perturbed audio + the CLEAN pitch track (runs/clean/pitch)
//                 -> the spectral effect on vtln / the narrowband detector alone
//   arm "pitch" : clean audio + the PERTURBED pitch track (channel/runs/<cond>/pitch)
//                 -> the effect through pitch values / voicing / the voice gate alone
// (mobile resonance diagnosis, channel area, 2026-10-28)
//
//   node scripts/resonance/mobile/channel-split.mjs --conds=a,b [--variants=N,U10,D10] [--arms=vtln,pitch]
// Output: build/resonance-mobile/channel/split/<cond>.jsonl, one line per (stream, arm):
//   { id, reader, sex, variant, arm, medU, nbF }  (medU: median shown u over posts with u != null, fill >= 1)
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
Object.defineProperty(globalThis, "performance", { value: { now: () => 0, timeOrigin: 0, mark() {}, measure() {} }, configurable: true, writable: true });
const { binsPass, SR } = await import("./chain.mjs");
const { applyPert } = await import("./perturb.mjs");
const { byName } = await import("./channel-conds.mjs");

const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) / 2, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const L = JSON.parse(readFileSync(path.join(repo, "build/resonance-mobile/streams/readers-dev.json"), "utf8"));
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
const outDir = path.join(repo, "build/resonance-mobile/channel/split");
mkdirSync(outDir, { recursive: true });
const variants = arg("variants", "N,U10,D10").split(",");
const arms = arg("arms", "vtln,pitch").split(",");
for (const cond of arg("conds", "").split(",").filter(Boolean)) {
  const pert = byName[cond]?.pert;
  if (!pert) throw new Error(`unknown condition ${cond}`);
  const out = path.join(outDir, `${cond}.jsonl`);
  const done = new Set(existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.id}|${r.arm}`; }) : []);
  for (const r of L.readers) for (const V of variants) {
    const id = `${r.id}__${V}`;
    const x = readF32(r.variants[V]);
    let y = null;
    for (const arm of arms) {
      if (done.has(`${id}|${arm}`)) continue;
      const pf = arm === "vtln" ? path.join(repo, "build/resonance-mobile/runs/clean/pitch", `${id}.json`) : path.join(repo, "build/resonance-mobile/channel/runs", cond, "pitch", `${id}.json`);
      if (!existsSync(pf)) { console.log(`skip ${id} ${arm}: no ${pf}`); continue; }
      const byChunk = JSON.parse(readFileSync(pf, "utf8")).byChunk;
      let audio = x;
      if (arm === "vtln") { if (!y) y = (await applyPert(pert, x, SR, { id, reader: r.id, sex: r.sex, kind: "ctl" })).y; audio = y; }
      const res = await binsPass(audio, byChunk, { gate: "on" });
      const medU = med(res.posts.filter((p) => p[2] != null && p[7] >= 1).map((p) => p[2]));
      appendFileSync(out, JSON.stringify({ id, reader: r.id, sex: r.sex, variant: V, arm, medU, nbF: res.nbFinal?.f ?? null }) + "\n");
      console.log(`${cond} ${id} ${arm} medU ${medU?.toFixed(3)}`);
    }
  }
}
process.exit(0);
