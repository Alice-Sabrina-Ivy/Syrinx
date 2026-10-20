// file-qf.mjs — one WAV (e.g. a noise-only room recording) through the
// baseline and every quiet-floor candidate (real chain, lib.mjs): posted,
// painted, readout-shown and recorded-voiced shares, and the painted-share
// drop against the baseline (benefit check, measurements/pitch-quiet-floor-
// 2026-10-20.md §4: decisive >= 90 %).
//
// Usage (repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/quiet-floor/file-qf.mjs \
//        --wav=PATH --out=JSON [--trees=build/trees] [--cands=g60,...]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readWav } from "../session-oracle/lib/wav.mjs";
import { ALL_CANDS, loadTrees, runAll, shares } from "./lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const CANDS = args.cands ? args.cands.split(",") : ALL_CANDS;
const T = await loadTrees(resolve(args.trees ?? "build/trees"), CANDS);
const { samples, sr } = readWav(resolve(args.wav));
const R = await runAll(T, samples, sr, CANDS);
const res = {};
const pct = (v, p) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const inten = Array.from(R.base.W.col.inten);
const paintedInten = inten.filter((_, k) => R.base.D.paint[k] > 0);
res.intensity = { all: [0.05, 0.5, 0.95, 1].map((p) => pct(inten, p)), painted: [0.05, 0.5, 0.95, 1].map((p) => pct(paintedInten, p)) };
for (const c of ["base", ...CANDS]) {
  res[c] = shares(R[c]);
  if (c !== "base") res[c].paintDrop = 100 * (1 - res[c].painted / res.base.painted);
  console.log(`${c.padEnd(5)} posted ${res[c].posted.toFixed(1).padStart(5)} %  painted ${res[c].painted.toFixed(1).padStart(5)} %  readout ${res[c].ro.toFixed(1).padStart(5)} %  recorded ${res[c].rec.toFixed(1).padStart(5)} %` +
    (c !== "base" ? `  painted drop ${res[c].paintDrop.toFixed(1)} %` : ""));
}
console.log(`intensity p5/p50/p95/max all ${res.intensity.all.map((v) => v.toFixed(1)).join(" / ")}; painted (base) ${res.intensity.painted.map((v) => v?.toFixed(1)).join(" / ")}`);
writeFileSync(resolve(args.out), JSON.stringify(res, null, 1));
