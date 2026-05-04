// analyze-harmonic-sweep.js — Read the sweep CSV, compute Pareto frontier,
// dump a structured summary suitable for the analysis markdown.
//
// Usage: node scripts/analyze-harmonic-sweep.js measurements/harmonic-gate-sweep-<date>.csv

import { readFileSync } from "fs";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("usage: node analyze-harmonic-sweep.js <csv-path>");
  process.exit(1);
}

const lines = readFileSync(csvPath, "utf8").trim().split("\n");
const header = lines[0].split(",");
const rows = lines.slice(1).map((line) => {
  const parts = line.split(",");
  const r = {};
  header.forEach((h, i) => {
    const v = parts[i];
    r[h] = isNaN(+v) ? v : +v;
  });
  return r;
});

const baseline = rows.find(
  (r) => Math.abs(r.relativeK2 - 0.5) < 1e-9 &&
         Math.abs(r.improvementMin - 0.003) < 1e-9 &&
         Math.abs(r.absOk - 0.15) < 1e-9,
);
console.log("Baseline cell (default constants):");
console.log(`  relK2=${baseline.relativeK2} impMin=${baseline.improvementMin} absOk=${baseline.absOk}`);
console.log(`    femaleMean=${baseline.femaleMean.toFixed(2)}  maleMean=${baseline.maleMean.toFixed(2)}`);
console.log(`    2nd=${baseline.secondPass}/${baseline.secondTotal}  3rd=${baseline.thirdPass}/${baseline.thirdTotal}`);
console.log(`    subLocks=${baseline.subLocks}\n`);

// Strict dominance: A dominates B iff A is at least as good on every axis
// AND strictly better on at least one. Lower femaleMean / maleMean / subLocks
// is better; higher secondPass / thirdPass is better.
function dominates(a, b) {
  const atLeast =
    a.femaleMean <= b.femaleMean &&
    a.maleMean <= b.maleMean &&
    a.secondPass >= b.secondPass &&
    a.thirdPass >= b.thirdPass;
  if (!atLeast) return false;
  return (
    a.femaleMean < b.femaleMean ||
    a.maleMean < b.maleMean ||
    a.secondPass > b.secondPass ||
    a.thirdPass > b.thirdPass
  );
}

const pareto = rows.filter((r) => !rows.some((s) => dominates(s, r)));
pareto.sort((a, b) => a.femaleMean - b.femaleMean);

console.log(`Pareto frontier (${pareto.length} cells, sorted by femaleMean):`);
console.log(
  `  ${"relK2".padEnd(6)} ${"impMin".padEnd(7)} ${"absOk".padEnd(6)}  ` +
  `${"F".padStart(6)} ${"M".padStart(6)} ${"2nd".padStart(4)} ${"3rd".padStart(4)} ${"subL".padStart(5)}` +
  `   notes`,
);
for (const r of pareto) {
  const dominatesBaseline = dominates(r, baseline);
  const matchesBaseline =
    r.relativeK2 === baseline.relativeK2 &&
    r.improvementMin === baseline.improvementMin &&
    r.absOk === baseline.absOk;
  const tag = matchesBaseline ? "← baseline" : dominatesBaseline ? "★ dominates baseline" : "";
  console.log(
    `  ${String(r.relativeK2).padEnd(6)} ${String(r.improvementMin).padEnd(7)} ${String(r.absOk).padEnd(6)}  ` +
    `${r.femaleMean.toFixed(2).padStart(6)} ${r.maleMean.toFixed(2).padStart(6)} ` +
    `${(r.secondPass + "/" + r.secondTotal).padStart(4)} ${(r.thirdPass + "/" + r.thirdTotal).padStart(4)} ` +
    `${String(r.subLocks).padStart(5)}   ${tag}`,
  );
}

// Cells that strictly dominate baseline.
const strictImprovements = rows.filter((r) => dominates(r, baseline));
console.log(`\nStrict improvements over baseline: ${strictImprovements.length}`);
strictImprovements.sort((a, b) => a.femaleMean - b.femaleMean);
for (const r of strictImprovements) {
  console.log(
    `  relK2=${r.relativeK2} impMin=${r.improvementMin} absOk=${r.absOk}  ` +
    `F=${r.femaleMean.toFixed(2)} (Δ${(r.femaleMean - baseline.femaleMean).toFixed(2)})  ` +
    `M=${r.maleMean.toFixed(2)} (Δ${(r.maleMean - baseline.maleMean).toFixed(2)})  ` +
    `subLocks=${r.subLocks} (Δ${r.subLocks - baseline.subLocks})  2nd=${r.secondPass} 3rd=${r.thirdPass}`,
  );
}

// Top 10 by absolute femaleMean (regardless of dominance).
console.log("\nTop 10 cells by lowest femaleMean (any tradeoff):");
const sortedByF = [...rows].sort((a, b) => a.femaleMean - b.femaleMean);
for (const r of sortedByF.slice(0, 10)) {
  console.log(
    `  relK2=${r.relativeK2} impMin=${r.improvementMin} absOk=${r.absOk}  ` +
    `F=${r.femaleMean.toFixed(2)}  M=${r.maleMean.toFixed(2)}  ` +
    `2nd=${r.secondPass}/${r.secondTotal} 3rd=${r.thirdPass}/${r.thirdTotal}  subL=${r.subLocks}`,
  );
}

// How far is the best cell from the < 10 Hz target?
const bestF = sortedByF[0];
console.log(
  `\nBest femaleMean in grid: ${bestF.femaleMean.toFixed(2)} Hz ` +
  `(target is < 10 Hz; gap = ${(bestF.femaleMean - 10).toFixed(2)} Hz)`,
);

// Summary table grouped by absOk (the most discriminating axis for males).
console.log("\nGrid summary — femaleMean by (relK2, absOk) at impMin=0.010 (best impMin):");
console.log(`  ${"relK2".padEnd(7)}  absOk=0.05   absOk=0.10   absOk=0.15`);
for (const k of [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50]) {
  const cells = rows.filter((r) =>
    Math.abs(r.relativeK2 - k) < 1e-9 && Math.abs(r.improvementMin - 0.010) < 1e-9,
  ).sort((a, b) => a.absOk - b.absOk);
  const fields = cells.map((r) => `F=${r.femaleMean.toFixed(2)} M=${r.maleMean.toFixed(2)}`);
  console.log(`  ${String(k).padEnd(7)}  ${fields.join("   ")}`);
}
