// cmpcells.mjs — cell-by-cell comparison of two variants in the notch work's
// SYNTHETIC interferer suites (scripts/notch-adversarial int.mjs, r2int.mjs,
// handoff-adv.mjs, dense.mjs, fda.mjs) — review fix, 2026-10-05: the
// real-noise candidate must not make any synthetic interferer cell worse.
//
//   NOTCH_ADV_TREES=base0=build/rnfv-trees/base0/src,fgA=build/rnfv-trees/fg/src \
//     node scripts/notch-adversarial/int.mjs --part=start --variants=base0,fgA ...   (see the measurement's §7)
//   node scripts/realnoise-fv/cmpcells.mjs --base=base0 --cand=fgA LABEL=DIR|FILE [...]
//
// Per cell and metric: false-voicing metrics (fv, pfv, fvSS, fvAll, pfvAll,
// pauseFV, gapFV, fv0, painted0, painted) are WORSE when the candidate is
// > 2 pp above the base; accuracy metrics (sp, spSS, voice, correct, ok)
// when > 1 pp below; promo (notch promotion, s) when later by > 0.3 s or
// never where the base promoted. Cells are counted identical / worse /
// worse within those tolerances / better in some metric; means per metric.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v = "1"] = a.slice(2).split("="); return [k, v]; }));
const sets = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((a) => a.split("="));
const B = args.base ?? "base0", C = args.cand ?? "fgA";
const FV = new Set(["fv", "pfv", "fvSS", "fvAll", "pfvAll", "pauseFV", "gapFV", "fv0", "painted0", "painted"]);
const ACC = new Set(["sp", "spSS", "voice", "correct", "ok"]);
const mean = (xs) => { const y = xs.filter((x) => typeof x === "number"); return y.length ? y.reduce((a, b) => a + b, 0) / y.length : NaN; };
for (const [label, p] of sets) {
  const files = statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith(".json")).map((f) => path.join(p, f)) : [p];
  const rows = files.flatMap((f) => JSON.parse(readFileSync(f, "utf8")));
  const groups = {};
  for (const r of rows) (groups[r.part ? `${label}:${r.part}` : label] ??= []).push(r);
  for (const [g, rs] of Object.entries(groups)) {
    let same = 0, worse = 0, better = 0, tol = 0;
    const metrics = new Set(), worseList = [], sr = new Set(rs.map((r) => r.sr ?? args.sr ?? "16000"));
    for (const r of rs) {
      const b = r.v[B], c = r.v[C];
      if (!b || !c) throw new Error(`${g}: row without ${B} / ${C}`);
      let w = false, bt = false, wt = false, changed = false;
      for (const k of Object.keys(b)) {
        if (!(FV.has(k) || ACC.has(k) || k === "promo")) continue;
        metrics.add(k);
        const x = b[k], y = c[k];
        if (x === y) continue;
        changed = true;
        if (k === "promo") {
          if (x !== null && (y === null || y > x + 0.3)) w = true; else if (y !== null && (x === null || y < x)) bt = true; else wt = true;
        } else if (typeof x === "number" && typeof y === "number") {
          if (FV.has(k)) { if (y > x + 2) w = true; else if (y < x) bt = true; else wt = true; }
          else { if (y < x - 1) w = true; else if (y > x) bt = true; else wt = true; }
        }
      }
      if (!changed) same++;
      if (w) { worse++; worseList.push(r); }
      if (bt) better++;
      if (wt && !w) tol++;
    }
    const ms = [...metrics].map((k) => `${k} ${mean(rs.map((r) => r.v[B][k])).toFixed(2)} -> ${mean(rs.map((r) => r.v[C][k])).toFixed(2)}`).join("; ");
    console.log(`${g} [${[...sr].join("/")} Hz] ${rs.length} cells: identical ${same}, worse ${worse}, worse within tolerance ${tol}, better in some metric ${better} | ${ms}`);
    for (const r of worseList.slice(0, 8)) console.log(`   WORSE ${JSON.stringify({ ...r, v: { [B]: r.v[B], [C]: r.v[C] } })}`);
  }
}
