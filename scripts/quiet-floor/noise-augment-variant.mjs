// noise-augment-variant.mjs — copies of scripts/noise-augment-oracle.js that
// import a quiet-floor tree's src (make-trees.mjs) instead of the repo's, for
// the G·F check of measurements/pitch-quiet-floor-2026-10-20.md §4
// (speech-in-noise accuracy must be unchanged). The oracle replicates the
// pitch worker's post-decode chain in its own loop, so a G·F copy also gets
// the worker's guard-floor call: createHarmonicVoicingGuard({ floorDb }) and
// the decoded frame's own level (last 800 samples of its 16 kHz buffer).
// Every replacement must match exactly once.
//
// Usage (repo root): node scripts/quiet-floor/noise-augment-variant.mjs [--trees=build/trees] [--out=build/quiet-floor]
//   then: node build/quiet-floor/noise-augment-<tag>.mjs pitch --frontend=tracker --out=<json>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const TREES = resolve(args.trees ?? "build/trees");
const OUT = resolve(args.out ?? "build/quiet-floor");
const src = readFileSync(resolve("scripts/noise-augment-oracle.js"), "utf8");
const rep = (s, from, to) => {
  const n = s.split(from).length - 1;
  if (n < 1) throw new Error(`anchor missing: ${from}`);
  return s.split(from).join(to);
};
mkdirSync(OUT, { recursive: true });
for (const tag of ["base", "gf60", "gf65", "gf70", "gf75"]) {
  const tree = pathToFileURL(resolve(TREES, `qf-${tag}`)).href;
  let s = src;
  s = rep(s, '"../src/', `"${tree}/src/`);
  s = rep(s, '"../tests/', `"${pathToFileURL(resolve("tests")).href}/`);
  s = rep(s, '"./noise-synth.js"', `"${pathToFileURL(resolve("scripts/noise-synth.js")).href}"`);
  if (tag !== "base") {
    const F = -Number(tag.slice(2));
    s = rep(s, "const guard = createHarmonicVoicingGuard(); // production-parity",
      `const guard = createHarmonicVoicingGuard({ floorDb: ${F} }); // quiet-floor G·F`);
    s = rep(s, "  if (v > 0 && !guard.check(frameBuf, v, SR)) v = null;",
      "  if (v > 0 && !guard.check(frameBuf, v, SR, frameLevelDb(frameBuf))) v = null;");
    s = rep(s, "function postFilter(v, notch, guard, frameBuf) {",
      "function frameLevelDb(buf) {\n  let e = 0;\n  for (let i = buf.length - 800; i < buf.length; i++) e += buf[i] * buf[i];\n  return e > 0 ? 10 * Math.log10(e / 800) : -Infinity;\n}\nfunction postFilter(v, notch, guard, frameBuf) {");
  }
  writeFileSync(resolve(OUT, `noise-augment-${tag}.mjs`), s);
}
console.log(`wrote ${OUT}/noise-augment-{base,gf60,gf65,gf70,gf75}.mjs`);
