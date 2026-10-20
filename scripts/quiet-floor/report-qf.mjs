// report-qf.mjs — quiet-floor safety tables and the pre-registered decision
// (measurements/pitch-quiet-floor-2026-10-20.md §3, §5) from corpus-qf.mjs
// output. Per candidate × level × group (corpus × sex; vocadito mixed):
//   loss    display loss, pp of reference-voiced frames (decisive <= 0.5)
//   dAcc    painted correct share, candidate − baseline, pp (decisive >= −0.3)
//   dOct    painted octave share (down + up), candidate − baseline, pp (decisive <= +0.2)
//   ro/rec  readout / recorded-voiced loss, pp (reported)
//   on/off  onset / offset loss, pp of onset / offset hops (reported; caveat > 2)
//   post    posted-voicing loss, pp of reference-voiced worker hops (G·F; reported)
//   end     share of the lost hops that lie in the last 150 ms of a reference-
//           voiced run (diagnostic, runs with the lostEnd field only)
// Decisive levels nat, −40, −45, −50, −55; −60 is reported only. Also pooled
// per sex over the corpora (reported).
//
// Usage: node scripts/quiet-floor/report-qf.mjs [--tag=dev] [--dir=build/quiet-floor/corpus] [--json=OUT] [--md=OUT]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const TAG = args.tag ?? "dev";
const DIR = resolve(args.dir ?? "build/quiet-floor/corpus", TAG);
const DECISIVE = ["nat", "-40", "-45", "-50", "-55"];
const LEVELS = [...DECISIVE, "-60"];
const GROUPS = ["fda_m", "ptdb_m", "hil_m", "libri_m", "fda_f", "ptdb_f", "hil_f", "libri_f", "voc"];
const SEX = { m: ["fda_m", "ptdb_m", "hil_m", "libri_m"], f: ["fda_f", "ptdb_f", "hil_f", "libri_f"], mixed: ["voc"] };

const agg = {}; const skipped = {}; let cands = new Set();
for (const f of readdirSync(DIR).filter((x) => x.endsWith(".json"))) {
  const j = JSON.parse(readFileSync(resolve(DIR, f), "utf8"));
  for (const c of j.cands) cands.add(c);
  for (const [k, v] of Object.entries(j.res)) { const a = agg[k] ??= {}; for (const [m, x] of Object.entries(v)) a[m] = (a[m] ?? 0) + x; }
  for (const fi of j.files) for (const lv of fi.skipped) { const k = `${lv}|${fi.group}`; skipped[k] = (skipped[k] ?? 0) + 1; }
  for (const fi of j.files) { const k = `files|${fi.group}`; skipped[k] = (skipped[k] ?? 0) + 1; }
}
cands = [...cands];
const sum = (keys) => { const o = {}; for (const k of keys) for (const [m, x] of Object.entries(agg[k] ?? {})) o[m] = (o[m] ?? 0) + x; return o; };
function metrics(a) {
  if (!a || !a.n) return null;
  const p = (x, n) => (n ? 100 * x / n : NaN);
  return { n: a.n, loss: p(a.lost, a.n), dAcc: p(a.cc, a.cp) - p(a.bc, a.bp), dOct: p(a.co, a.cp) - p(a.bo, a.bp),
    ro: p(a.roLost, a.n), rec: p(a.recLost, a.n), on: p(a.onLost, a.onN), off: p(a.offLost, a.offN),
    post: p(a.bpost - a.cpost, a.wn), basePaint: p(a.bp, a.n), gained: p(a.gained, a.n),
    endShare: a.lostEnd !== undefined ? p(a.lostEnd, a.lost) : NaN };
}
const pass = (m) => m.loss <= 0.5 && !(m.dAcc < -0.3) && !(m.dOct > 0.2);

const out = { tag: TAG, groups: {}, sex: {}, decision: {}, skipped };
const lines = [];
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "-");
for (const c of cands) {
  let ok = true; const fails = [];
  for (const lv of LEVELS) for (const g of GROUPS) {
    const m = metrics(agg[`${c}|${lv}|${g}`]);
    if (!m) continue;
    out.groups[`${c}|${lv}|${g}`] = m;
    if (DECISIVE.includes(lv) && !pass(m)) { ok = false; fails.push(`${g}@${lv} loss ${f2(m.loss)} dAcc ${f2(m.dAcc)} dOct ${f2(m.dOct)}`); }
  }
  for (const lv of LEVELS) for (const [sx, gs] of Object.entries(SEX)) {
    const m = metrics(sum(gs.map((g) => `${c}|${lv}|${g}`)));
    if (m) out.sex[`${c}|${lv}|${sx}`] = m;
  }
  out.decision[c] = { pass: ok, fails };
}
// ---- print ----
for (const c of cands) {
  lines.push(`\n## ${c} — ${out.decision[c].pass ? "PASS" : "FAIL"} on ${TAG} (decisive: loss <= 0.5, dAcc >= -0.3, dOct <= +0.2 at nat..-55)`);
  lines.push("level  group     n      basePaint  loss   dAcc   dOct   ro     rec    on     off    post   end");
  for (const lv of LEVELS) for (const g of GROUPS) {
    const m = out.groups[`${c}|${lv}|${g}`]; if (!m) continue;
    lines.push(`${lv.padEnd(6)} ${g.padEnd(8)} ${String(m.n).padStart(6)}  ${f2(m.basePaint).padStart(6)}    ${[m.loss, m.dAcc, m.dOct, m.ro, m.rec, m.on, m.off, m.post, m.endShare].map((x) => f2(x).padStart(6)).join(" ")}${DECISIVE.includes(lv) && !pass(m) ? "  <- fails" : ""}`);
  }
}
lines.push(`\n## per sex, pooled over corpora (reported): display loss pp / dAcc / dOct / onset / offset`);
for (const c of cands) for (const lv of LEVELS) {
  lines.push(`${c.padEnd(5)} ${lv.padEnd(4)} ` + Object.keys(SEX).map((sx) => { const m = out.sex[`${c}|${lv}|${sx}`]; return m ? `${sx}: ${f2(m.loss)} / ${f2(m.dAcc)} / ${f2(m.dOct)} / ${f2(m.on)} / ${f2(m.off)} / ${f2(m.endShare)}` : `${sx}: -`; }).join("   "));
}
lines.push(`\nfiles per group: ${GROUPS.map((g) => `${g} ${skipped[`files|${g}`] ?? 0}`).join(", ")}`);
lines.push(`left out for clipping (peak > 0.99): ${Object.entries(skipped).filter(([k]) => !k.startsWith("files")).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
lines.push(`\nDECISION (${TAG}): ` + cands.map((c) => `${c} ${out.decision[c].pass ? "PASS" : "FAIL"}`).join(", "));
console.log(lines.join("\n"));
if (args.json) writeFileSync(resolve(args.json), JSON.stringify(out, null, 1));
if (args.md) writeFileSync(resolve(args.md), lines.join("\n"));
