// timing-drops-summary.mjs — tables of timing-drops.mjs results: each loss
// pattern paired with the no-loss run (synthetic 0) of the same WAV set.
//   node scripts/resonance/mobile/timing-drops-summary.mjs [--dir=build/resonance-mobile/timing/drops]
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const dir = path.resolve(repo, arg("dir", "build/resonance-mobile/timing/drops"));
const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const med = (a) => q(a, 0.5);
const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? "–" : x.toFixed(d));
const R = readdirSync(dir).filter((x) => x.endsWith(".json") && !x.startsWith("pitch-")).map((x) => JSON.parse(readFileSync(path.join(dir, x), "utf8")));
const base = Object.fromEntries(R.filter((r) => r.pattern === "synthetic:0:1").map((r) => [r.set, r]));
const key = (r) => (r.pattern.startsWith("replay:") ? "replay browser thr6 drops" : `synthetic loss ${r.pattern.split(":")[1]}${/f40/.test(r.tag) ? " (40 ms frames)" : ""}`);
const groups = new Map();
for (const r of R) { const k = key(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
let md = "| pattern | sex | runs | audio lost % | long T50 s | ΔT50 s | long size u | exc peak ratio 3 s | 5 s | 8 s | all | sens / no-loss | bias u (median signed Δu) | |Δu| med | bins dropped % |\n|" + "---|".repeat(15) + "\n";
const num = (k) => { const m = k.match(/loss ([0-9.]+)/); return m ? Number(m[1]) + (k.includes("40 ms") ? 0.001 : 0) : 9; };
const keys = [...groups.keys()].sort((a, b) => num(a) - num(b));
for (const k of keys) for (const sex of ["m", "f"]) {
  const rs = groups.get(k).filter((r) => base[r.set]);
  const ev = rs.flatMap((r) => r.events.map((e, i) => ({ e, b: base[r.set].events[i] })).filter((x) => x.e.sex === sex));
  const lo = ev.filter((x) => x.e.kind === "long"), ex = ev.filter((x) => x.e.kind === "exc");
  const ratio = (xs) => med(xs.filter((x) => x.b.peak > 0.05).map((x) => x.e.peak / x.b.peak));
  const sens = [];
  for (const r of rs) {
    const B = base[r.set];
    for (const rd of [...new Set(r.steady.filter((s) => s.sex === sex).map((s) => s.reader))]) {
      const lv = (x, blk) => x.steady.find((y) => y.reader === rd && y.block === blk)?.X;
      sens.push((lv(r, "A") - lv(r, "E")) / (lv(B, "A") - lv(B, "E")));
    }
  }
  const sg = [], ab = [];
  for (const r of rs) {
    const bs = base[r.set].st.filter((s) => s[1] != null);
    // each WAV: reader 1 (five 54 s blocks) in 0-270 s, reader 2 in 270-540 s
    const sexOf = (t) => r.events.find((e) => (t < 270) === (e.ts < 270))?.sex;
    let j = 0;
    for (const s of r.st) {
      if (s[1] == null) continue;
      while (j + 1 < bs.length && Math.abs(bs[j + 1][0] - s[0]) <= Math.abs(bs[j][0] - s[0])) j++;
      if (bs[j] && Math.abs(bs[j][0] - s[0]) <= 0.1 && sexOf(s[0]) === sex) { sg.push(s[1] - bs[j][1]); ab.push(Math.abs(s[1] - bs[j][1])); }
    }
  }
  const lossPct = med(rs.map((r) => 100 * r.lossShare));
  const bd = med(rs.map((r) => (100 * r.bins.dropped) / (r.bins.dropped + r.bins.admitted)));
  md += `| ${k} | ${sex} | ${rs.length} | ${f(lossPct, 1)} | ${f(med(lo.map((x) => x.e.t50)))} | ${f(med(lo.map((x) => (x.e.t50 != null && x.b.t50 != null ? x.e.t50 - x.b.t50 : null))))} | ${f(med(lo.map((x) => Math.abs(x.e.size ?? NaN))))} | ${f(ratio(ex.filter((x) => x.e.dur === 3)))} | ${f(ratio(ex.filter((x) => x.e.dur === 5)))} | ${f(ratio(ex.filter((x) => x.e.dur === 8)))} | ${f(ratio(ex))} | ${f(med(sens), 3)} | ${f(med(sg), 3)} | ${f(med(ab), 3)} | ${f(bd, 1)} |\n`;
}
process.stdout.write(md);
