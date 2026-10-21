// review_checks.mjs — the 2026-10-21 review's extra checks of
// measurements/heard-as-low-pitch-and-pauses-2026-10-21.md §8.5 / §9, the old
// panel ("shipped" = before 2026-10-21) vs H1+H3, from the same run.mjs records:
//
//   node review_checks.mjs --runs=<run.0.jsonl,run.1.jsonl>
//
//   f0bias   WORLD 75 / 90 Hz and own-F0 streams with natural pauses (+ PTDB-TUG,
//            FDA), shown 2 s updates: pooled F0 / the WORLD reference F0 of the same
//            8 s, eta at the pooled vs the reference F0, and how often the reading
//            ("Can't tell yet" / side) changes with the reference F0
//   flicker  held-out LibriSpeech streams: hides between two readings per minute,
//            those <= 250 / <= 500 ms, shown <-> hidden changes per minute
//   newonly  held-out LibriSpeech streams: readings only H1+H3 shows, informative on
//            the side opposite the stream's settled reading (by voice family)
//   w185     the WORLD 185 Hz men streams with such readings, per split
//
// All four timer phases; 250 ms display samples as analyze.mjs simulates them.

import { readFileSync } from "node:fs";
import { VARIANTS, simulate, settled } from "./analyze.mjs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { heardAsShares, isWideShare } = await import(pathToFileURL(path.join(repo, "src/ml/heard-as.js")).href);
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const PH = [0, 500, 1000, 1500];
const OLD = VARIANTS.shipped, NEW = VARIANTS["H1+H3"];
const V = { shipped: OLD, "H1+H3": NEW };
const WIN_MS = 8000; // the panel's pool (HEARD_AS_CALIBRATION.windowMs)
const med = (a) => { const b = [...a].sort((x, y) => x - y); const h = b.length >> 1; return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; };

const streams = [];
for (const p of arg("runs", "").split(",")) for (const l of readFileSync(p, "utf8").split("\n")) if (l.trim()) streams.push(JSON.parse(l));

// ---------------------------------------------------------------- f0bias
console.log("f0bias (natural pauses, both splits; shown 2 s updates over the four phases)");
{
  const R = {};
  for (const s of streams) {
    if (!(s.family === "libri" && ["w75", "w90", "w1"].includes(s.voice) && s.pause === "pnat") && s.set !== "ptdb" && s.set !== "fda") continue;
    if (!s.ref) continue;
    const ref = new Float32Array(readFileSync(s.ref).buffer.slice(0)); const hop = s.refHopMs ?? 5;
    const key = `${s.set === "libri" ? s.voice : s.set}.${s.sex}`;
    for (const [vn, v] of Object.entries(V)) for (const ph of PH) {
      for (const u of simulate(s, v, ph).updates) {
        if (!u.shown) continue;
        const fr = [];
        for (let i = Math.max(0, Math.floor((u.t - WIN_MS) / hop)); i <= Math.min(ref.length - 1, Math.floor(u.t / hop)); i++) if (ref[i] > 0) fr.push(ref[i]);
        if (!fr.length) continue;
        const fref = med(fr), shRef = heardAsShares(u.meterLogit, Math.log(fref));
        const r = (R[key] ??= {})[vn] ??= { n: 0, ratio: [], deta: [], below81: 0, changes: 0, informative: 0 };
        r.n++; r.ratio.push(Math.exp(u.lnF0) / fref); r.deta.push(u.eta - shRef.eta);
        if (fref < 81) r.below81++;
        if (!u.wide) r.informative++;
        const wRef = isWideShare([shRef.sLow, shRef.sHigh]);
        if (u.wide !== wRef || (!u.wide && Math.sign(u.eta) !== Math.sign(shRef.eta))) r.changes++;
      }
    }
  }
  for (const [k, v] of Object.entries(R).sort()) for (const [vn, r] of Object.entries(v))
    console.log(`  ${k.padEnd(8)} ${vn.padEnd(8)} shown updates ${r.n}; pooled / reference F0 ${med(r.ratio).toFixed(3)}; eta(pooled) - eta(reference) ${med(r.deta).toFixed(2)} (< 0 = toward woman); reference < 81 Hz ${(100 * r.below81 / r.n).toFixed(0)} %; informative ${(100 * r.informative / r.n).toFixed(0)} %; changes with the reference F0 ${(100 * r.changes / r.n).toFixed(0)} %`);
}

// ---------------------------------------------------------------- flicker
console.log("\nflicker (held-out LibriSpeech, per minute of the visible span)");
{
  const R = {};
  for (const s of streams) {
    if (s.split !== "test" || s.family !== "libri") continue;
    const key = `${s.voice}-${s.pause}.${s.sex}`;
    const lead = s.leadMs ?? 1000, end = s.speechSpans[s.speechSpans.length - 1][1];
    for (const [vn, v] of Object.entries(V)) for (const ph of PH) {
      const sm = simulate(s, v, ph).samples.filter((q) => q.t >= lead && q.t <= end + 1000);
      const r = (R[key] ??= {})[vn] ??= { min: 0, hides: 0, le250: 0, le500: 0, changes: 0 };
      r.min += sm.length * 0.25 / 60;
      for (let i = 0; i < sm.length;) {
        if (!sm[i].shown && i > 0 && sm[i - 1].shown) {
          let j = i; while (j < sm.length && !sm[j].shown) j++;
          if (j < sm.length) { r.hides++; const len = (j - i) * 250; if (len <= 250) r.le250++; if (len <= 500) r.le500++; }
          i = j;
        } else i++;
      }
      for (let k = 1; k < sm.length; k++) if (sm[k].shown !== sm[k - 1].shown) r.changes++;
    }
  }
  const f = (x) => `hides ${(x.hides / x.min).toFixed(2)}, <= 250 ms ${(x.le250 / x.min).toFixed(2)}, <= 500 ms ${(x.le500 / x.min).toFixed(2)}, changes ${(x.changes / x.min).toFixed(2)}`;
  for (const [k, v] of Object.entries(R).sort()) console.log(`  ${k.padEnd(14)} shipped: ${f(v.shipped)} | H1+H3: ${f(v["H1+H3"])}`);
}

// ---------------------------------------------------------------- newonly + w185
console.log("\nreadings only H1+H3 shows (held-out LibriSpeech; opposite = informative on the other side of the settled eta)");
{
  const R = {}, w185 = { dev: [], test: [] };
  for (const s of streams) {
    if (s.family !== "libri") continue;
    const st = settled(s); if (!st) continue;
    const isW185m = s.voice === "w185" && s.sex === "m";
    if (s.split !== "test" && !isW185m) continue;
    const key = `${s.voice}.${s.sex}`;
    const r = R[key] ??= { old: 0, oldOpp: 0, only: 0, onlyInf: 0, onlyOpp: 0 };
    let n185 = 0; const ex = [];
    for (const ph of PH) {
      const a = simulate(s, OLD, ph).samples, b = simulate(s, NEW, ph).samples;
      b.forEach((x, i) => {
        if (a[i].shown) {
          if (s.split === "test") { r.old++; if (!a[i].wide && Math.sign(a[i].eta) !== Math.sign(st.eta)) r.oldOpp++; }
          return;
        }
        if (!x.shown) return;
        const opp = !x.wide && Math.sign(x.eta) !== Math.sign(st.eta);
        if (s.split === "test") { r.only++; if (!x.wide) r.onlyInf++; if (opp) r.onlyOpp++; }
        if (isW185m && opp) { n185++; if (ex.length < 2) ex.push(`phase ${ph}: ${((x.t - (s.leadMs ?? 1000)) / 1000).toFixed(2)} s eta ${x.eta.toFixed(2)}`); }
      });
    }
    if (n185) w185[s.split].push(`${s.id}: settled eta ${st.eta.toFixed(2)} (can't tell ${st.wide}); ${n185} samples, e.g. ${ex.join("; ")}`);
  }
  const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(2);
  for (const [k, r] of Object.entries(R).sort()) if (r.old || r.only) console.log(`  ${k.padEnd(8)} shipped shown ${r.old}: opposite ${pct(r.oldOpp, r.old)} % | only H1+H3 ${r.only}: informative ${pct(r.onlyInf, r.only)} %, opposite ${pct(r.onlyOpp, r.only)} %`);
  for (const sp of ["dev", "test"]) { console.log(`  WORLD 185 Hz men, ${sp === "test" ? "held-out" : "dev"}: ${w185[sp].length} streams`); for (const x of w185[sp]) console.log(`    ${x}`); }
}
