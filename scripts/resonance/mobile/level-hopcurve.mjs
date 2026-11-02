// level-hopcurve.mjs — FireRedVAD's "no voice" share on pitch-voiced hops as a
// function of the HOP's own level (gain-only conditions): per voiced hop of the
// N / U10 / D10 controls, the 25 ms RMS of the clean audio ending at the hop +
// the condition's gain = the hop's level in that condition; hidden = the
// condition's detector said "no voice" there. Pooled per sex, 5 dB bins.
//   node scripts/resonance/mobile/level-hopcurve.mjs [--conds=clean:0,g-20:-20,...]
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath as toPath } from "node:url";
const repo = path.resolve(path.dirname(toPath(import.meta.url)), "../../.."), SR = 48000, CH = 1200;
const conds = ((process.argv.find((a) => a.startsWith("--conds=")) ?? "--conds=clean:0,g-10:-10,g-20:-20,g-30:-30,g-40:-40").slice(8)).split(",").map((s) => s.split(":"));
const L = JSON.parse(readFileSync(path.join(repo, "build/resonance-mobile/streams/readers-dev.json"), "utf8"));
const rd = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const acc = {}; // sex|bin -> [hidden, voiced]
const accV = {}; // sex|variant|bin
for (const r of L.readers) for (const v of ["N", "U10", "D10"]) {
  const y = rd(r.variants[v]);
  for (const [c, g] of conds) {
    const dir = c === "clean" ? "build/resonance-mobile/runs/clean/pitch" : `build/resonance-mobile/level/${c}/pitch`;
    const pf = path.join(repo, dir, `${r.id}__${v}.json`);
    if (!existsSync(pf)) continue;
    const pc = JSON.parse(readFileSync(pf, "utf8"));
    for (const ch of pc.byChunk) for (const m of ch) {
      if (!m[0]) continue;
      const e = Math.min(y.length, Math.round(m[2] * SR)), b = e - CH; if (b < 0) continue;
      let s = 0; for (let i = b; i < e; i++) s += y[i] * y[i];
      const lv = 10 * Math.log10(s / CH + 1e-20) + Number(g), bin = Math.floor(lv / 5) * 5;
      for (const [A, k] of [[acc, `${r.sex}|${bin}`], [accV, `${r.sex}|${v}|${bin}`]]) { A[k] ??= [0, 0]; A[k][1]++; if (m[3] === 0) A[k][0]++; }
    }
  }
}
const bins = [...new Set(Object.keys(acc).map((k) => Number(k.split("|")[1])))].sort((a, b) => b - a);
console.log("| hop level (25 ms RMS, dBFS) | men: hidden % (voiced hops) | women: hidden % (voiced hops) | men N / U10 / D10 hidden % | women N / U10 / D10 hidden % |");
console.log("|---|---|---|---|---|");
const cell = (k) => (acc[k] ? `${(100 * acc[k][0] / acc[k][1]).toFixed(1)} (${acc[k][1]})` : "—");
const cv = (s, b) => ["N", "U10", "D10"].map((v) => { const x = accV[`${s}|${v}|${b}`]; return x && x[1] >= 50 ? (100 * x[0] / x[1]).toFixed(0) : "—"; }).join(" / ");
for (const b of bins) if (b >= -100) console.log(`| ${b} … ${b + 5} | ${cell(`m|${b}`)} | ${cell(`f|${b}`)} | ${cv("m", b)} | ${cv("f", b)} |`);
