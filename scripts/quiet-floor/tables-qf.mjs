// tables-qf.mjs — Markdown tables for measurements/pitch-quiet-floor-2026-10-20.md
// from report-qf.mjs JSON (public corpora only) and noise-qf.mjs output.
//
// Usage: node scripts/quiet-floor/tables-qf.mjs --dev=build/quiet-floor/report-dev.json
//          [--sweep=build/quiet-floor/report-sweep.json] [--noise=build/quiet-floor] [--naug=build/quiet-floor]
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const DEC = ["nat", "-40", "-45", "-50", "-55"];
const LV = [...DEC, "-60"];
const GROUPS = ["fda_m", "ptdb_m", "hil_m", "libri_m", "fda_f", "ptdb_f", "hil_f", "libri_f", "voc"];
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "–");
const lvName = (l) => (l === "nat" ? "natural" : `${l} dB`);
const out = [];

function sexTable(R, cands, title) {
  out.push(`\n${title}\n`);
  out.push(`| Floor | Voices | ${LV.map(lvName).join(" | ")} |`);
  out.push(`|---|---|${LV.map(() => "---:").join("|")}|`);
  for (const c of cands) {
    for (const [sx, name] of [["m", "men"], ["f", "women"], ["mixed", "sung (vocadito)"]]) {
      out.push(`| ${sx === "m" ? `**${c}** ${R.decision[c].pass ? "PASS" : "FAIL"}` : ""} | ${name} | ${LV.map((l) => f2(R.sex[`${c}|${l}|${sx}`]?.loss)).join(" | ")} |`);
    }
    const worst = LV.map((l) => { let w = -1, g = ""; for (const gg of GROUPS) { const m = R.groups[`${c}|${l}|${gg}`]; if (m && m.loss > w) { w = m.loss; g = gg; } } return `${f2(w)} (${g})`; });
    out.push(`| | worst group | ${worst.join(" | ")} |`);
  }
}

const dev = JSON.parse(readFileSync(resolve(args.dev), "utf8"));
const cands = Object.keys(dev.decision);
sexTable(dev, cands, "Display loss, pp of reference-voiced frames (dev speakers; decisive ≤ 0.5 for every corpus × sex group at natural … −55 dB; −60 dB reported). Men / women pooled over FDA, PTDB-TUG, Hillenbrand and LibriSpeech; \"worst group\" = the largest single corpus × sex value.");

out.push("\nPainted accuracy and octave errors, worst corpus × sex group over the decisive levels (dev; decisive: correct share falls ≤ 0.3 pp, octave share rises ≤ 0.2 pp):\n");
out.push("| Floor | min Δ correct (pp) | max Δ octave (pp) |");
out.push("|---|---:|---:|");
for (const c of cands) {
  let a = Infinity, o = -Infinity;
  for (const l of DEC) for (const g of GROUPS) { const m = dev.groups[`${c}|${l}|${g}`]; if (!m) continue; a = Math.min(a, m.dAcc); o = Math.max(o, m.dOct); }
  out.push(`| ${c} | ${f2(a)} | ${f2(o)} |`);
}

out.push("\nOnsets / offsets (first / last 50 ms of every reference-voiced run of ≥ 4 hops), loss in pp of those hops, men / women / sung, at −45 and −55 dB (dev; caveat above 2 pp):\n");
out.push("| Floor | onset −45 | offset −45 | onset −55 | offset −55 |");
out.push("|---|---|---|---|---|");
for (const c of cands) {
  const cell = (l, k) => ["m", "f", "mixed"].map((sx) => f2(dev.sex[`${c}|${l}|${sx}`]?.[k])).join(" / ");
  out.push(`| ${c} | ${cell("-45", "on")} | ${cell("-45", "off")} | ${cell("-55", "on")} | ${cell("-55", "off")} |`);
}

if (args.sweep && existsSync(resolve(args.sweep))) {
  const sw = JSON.parse(readFileSync(resolve(args.sweep), "utf8"));
  out.push("\nExploratory gate-only floor sweep (dev, added after the result): worst corpus × sex display loss (pp) per level, the dev decision, and the share of lost hops that lie in the last 150 ms of a reference-voiced run (all groups, −55 dB):\n");
  out.push(`| Floor | ${LV.map(lvName).join(" | ")} | dev | lost in last 150 ms |`);
  out.push(`|---|${LV.map(() => "---:").join("|")}|---|---:|`);
  for (const c of Object.keys(sw.decision)) {
    const worst = LV.map((l) => { let w = -1; for (const g of GROUPS) { const m = sw.groups[`${c}|${l}|${g}`]; if (m && m.loss > w) w = m.loss; } return f2(w); });
    let lost = 0, end = 0;
    for (const g of GROUPS) { const m = sw.groups[`${c}|-55|${g}`]; if (m && Number.isFinite(m.endShare)) { const l = m.loss * m.n / 100; lost += l; end += l * m.endShare / 100; } }
    out.push(`| ${c.replace("g", "−")} dB | ${worst.join(" | ")} | ${sw.decision[c].pass ? "pass" : "fail"} | ${lost ? (100 * end / lost).toFixed(0) + " %" : "–"} |`);
  }
}

if (args.noise) {
  const sc = [["0.03", "−30 dB"], ["0.001", "−60 dB"], ["0.000316", "−70 dB"], ["0.0001", "−80 dB"]];
  const N = {};
  for (const [s] of sc) { const p = resolve(args.noise, `noise-${s}.json`); if (existsSync(p)) Object.assign(N, JSON.parse(readFileSync(p, "utf8"))); }
  const C = ["base", "g60", "g65", "g70", "g75", "gf60", "gf65", "gf70", "gf75"];
  out.push("\nNoise-only false voicing, % of display hops painted (3 seeds × 30 s, noise-fv classes; only classes where any tree paints ≥ 0.1 % at any scale):\n");
  out.push(`| Class | Scale (RMS) | ${C.join(" | ")} |`);
  out.push(`|---|---|${C.map(() => "---:").join("|")}|`);
  const classes = [...new Set(Object.keys(N).map((k) => k.split("|")[1]))];
  for (const nz of classes) {
    if (!sc.some(([s]) => N[`${s}|${nz}`] && C.some((c) => N[`${s}|${nz}`][c].painted >= 0.1))) continue;
    for (const [s, name] of sc) { const r = N[`${s}|${nz}`]; if (r) out.push(`| ${nz} | ${name} | ${C.map((c) => r[c].painted.toFixed(1)).join(" | ")} |`); }
  }
  let changed = [];
  for (const nz of classes) { const r = N[`0.03|${nz}`]; if (!r) continue; for (const c of C.slice(1)) for (const k of ["posted", "painted"]) if (Math.abs(r[c][k] - r.base[k]) > 1e-9) changed.push(`${nz} ${c} ${k} ${r.base[k].toFixed(2)} → ${r[c][k].toFixed(2)}`); }
  out.push(`\nAt the committed scale (RMS 0.03) every class is identical to the baseline${changed.length ? ` except: ${changed.join("; ")}` : ""}.`);
}

if (args.naug) {
  const C = ["base", "gf60", "gf65", "gf70", "gf75"];
  const R = {};
  for (const c of C) { const p = resolve(args.naug, `naug-${c}.json`); if (existsSync(p)) R[c] = JSON.parse(readFileSync(p, "utf8")).results; }
  if (R.base) {
    const diffs = [];
    for (const c of C.slice(1)) {
      if (!R[c]) continue;
      let maxd = 0, cell = "";
      R.base.forEach((b, i) => { for (const k of ["correct", "octUp", "octDown", "other", "null", "falseVoiced"]) { const d = Math.abs((R[c][i][k] ?? 0) - (b[k] ?? 0)); if (d > maxd) { maxd = d; cell = `${b.noise} ${b.snr} dB ${k} ${b[k]} → ${R[c][i][k]}`; } } });
      diffs.push(`${c}: ${maxd === 0 ? "identical in every cell" : `largest change ${cell}`}`);
    }
    out.push(`\nnoise-augment-oracle (pitch, --frontend=tracker, FDA speech in noise), G·F against the baseline: ${diffs.join("; ")}.`);
  }
}
console.log(out.join("\n"));
