// make-trees.mjs — the quiet-floor candidate src trees (2026-10-20,
// measurements/pitch-quiet-floor-2026-10-20.md §2). Baseline = `src` of the
// pre-registered base commit via `git archive`; every variant is that tree
// with ONLY the pre-registered change, applied by exact string replacement
// (the script fails if an anchor is missing, so a drifted base cannot be
// patched silently).
//
//   gNN   gate floor F = -NN dB (src/audio/pitchGate.js):
//         frameQuiet = intensity < -50 && (confidence < 0.5 || intensity < F)
//   gfNN  gate floor F plus the guard floor: a decoded frame whose own level
//         (20·log10 RMS of the last 800 samples = 50 ms of the 16 kHz buffer
//         the harmonic guard checks) is below F and that fails the harmonic
//         test is vetoed at once (src/dsp/boersma-ac.js + pitch-worker.js)
//
//   --extra=80,85,...  also gate-only trees qf-gNN at these floors (the
//         exploratory safe-floor sweep reported after the pre-registered
//         result; not candidates)
//
// Usage (repo root): node scripts/quiet-floor/make-trees.mjs [--base=82d4b93] [--out=build/trees] [--extra=...] [--extra-only]
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const BASE = args.base ?? "82d4b93";
const OUT = resolve(args.out ?? "build/trees");
export const FLOORS = [60, 65, 70, 75];

function patch(file, pairs) {
  let s = readFileSync(file, "utf8");
  const eol = s.includes("\r\n") ? "\r\n" : "\n"; // git archive follows core.autocrlf
  for (let [from, to] of pairs) {
    from = from.replace(/\n/g, eol); to = to.replace(/\n/g, eol);
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: anchor found ${n}x (want 1): ${from.slice(0, 80)}`);
    s = s.replace(from, to);
  }
  writeFileSync(file, s);
}

function gatePatch(tree, F) {
  patch(resolve(tree, "src/audio/pitchGate.js"), [
    ["export const SILENCE_THRESHOLD_DB = -50;\n",
      `export const SILENCE_THRESHOLD_DB = -50;\n\n// quiet-floor candidate (measurement tree): below this level a frame is\n// quiet whatever the pitch confidence.\nexport const QUIET_FLOOR_DB = ${-F};\n`],
    ["  const frameQuiet = intensityQuiet && voicednessQuiet;\n",
      "  const frameQuiet = intensityQuiet && (voicednessQuiet || intensity < QUIET_FLOOR_DB);\n"],
  ]);
}

function guardPatch(tree, F) {
  patch(resolve(tree, "src/dsp/boersma-ac.js"), [
    ["export function createHarmonicVoicingGuard({ ratio = 10, debounce = 4 } = {}) {",
      "export function createHarmonicVoicingGuard({ ratio = 10, debounce = 4, floorDb = null } = {}) {"],
    ["    check(buffer, f0, sampleRate) {", "    check(buffer, f0, sampleRate, levelDb) {"],
    ["      failStreak++;\n      return failStreak < debounce;",
      "      failStreak++;\n      if (floorDb !== null && typeof levelDb === \"number\" && levelDb < floorDb) return false;\n      return failStreak < debounce;"],
  ]);
  patch(resolve(tree, "src/dsp/pitch-worker.js"), [
    ["      harmonicGuard = createHarmonicVoicingGuard();",
      `      harmonicGuard = createHarmonicVoicingGuard({ floorDb: ${-F} });`],
    ["  if (vetoed > 0 && !harmonicGuard.check(bufferDelayLine[0], vetoed, TARGET_SAMPLE_RATE)) {",
      "  if (vetoed > 0 && !harmonicGuard.check(bufferDelayLine[0], vetoed, TARGET_SAMPLE_RATE, frameLevelDb(bufferDelayLine[0]))) {"],
    ["function processChunk(msg) {",
      "// quiet-floor candidate (measurement tree): level of the last 50 ms\n// (800 samples) of a 16 kHz analysis buffer, dB re full scale.\nfunction frameLevelDb(buf) {\n  let s = 0;\n  for (let i = buf.length - 800; i < buf.length; i++) s += buf[i] * buf[i];\n  return s > 0 ? 10 * Math.log10(s / 800) : -Infinity;\n}\n\nfunction processChunk(msg) {"],
  ]);
}

mkdirSync(OUT, { recursive: true });
const base = resolve(OUT, "qf-base");
const EXTRA_ONLY = args["extra-only"] === "1"; // add extra trees, leave the existing ones alone
if (!EXTRA_ONLY) {
  if (existsSync(base)) rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  execSync(`git archive ${BASE} src | tar -x -C "${base.replace(/\\/g, "/")}"`, { stdio: "inherit", shell: "bash" });
  for (const F of FLOORS) {
    for (const kind of ["g", "gf"]) {
      const t = resolve(OUT, `qf-${kind}${F}`);
      if (existsSync(t)) rmSync(t, { recursive: true, force: true });
      cpSync(resolve(base, "src"), resolve(t, "src"), { recursive: true });
      gatePatch(t, F);
      if (kind === "gf") guardPatch(t, F);
    }
  }
}
const EXTRA = (args.extra ?? "").split(",").filter(Boolean).map(Number);
for (const F of EXTRA) {
  const t = resolve(OUT, `qf-g${F}`);
  if (existsSync(t)) rmSync(t, { recursive: true, force: true });
  cpSync(resolve(base, "src"), resolve(t, "src"), { recursive: true });
  gatePatch(t, F);
}
console.log(`trees in ${OUT}: qf-base + ${FLOORS.map((F) => `qf-g${F}, qf-gf${F}`).join(", ")} (base ${BASE})${EXTRA.length ? `; extra gate-only ${EXTRA.map((F) => `qf-g${F}`).join(", ")}` : ""}`);
