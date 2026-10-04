// run-unit-tests.mjs — runs every self-contained test as CI does
// (`npm run test:unit`). Each test is a plain Node script that prints
// pass/fail and exits non-zero on failure (CLAUDE.md "Commands").
//
// Discovery: every tests/**/*-test.js, plus the EXTRA scripts below, minus
// SKIP. A new *-test.js joins CI automatically — keep it self-contained
// (committed fixtures only; skip gracefully when optional gitignored data
// is missing, as tests/dsp/cpp-corpus-test.js does) or add it to SKIP with
// the reason.
//
// Usage: node scripts/run-unit-tests.mjs [--list]

import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// Regression scripts that don't follow the *-test.js naming.
const EXTRA = [
  "tests/dsp/formant-debug.js",
  "tests/audio/pitch-smoothing-octave-shift-harness.js",
];

// Not runnable in CI, with the reason.
const SKIP = {
  "tests/ml/gender-model-accuracy-test.js": "downloads ~80 MB of model weights from Hugging Face",
  "tests/ml/perceived-voice-hillenbrand-test.js": "downloads the gender model from Hugging Face",
};

// Corpus/fixture directories (audio + references, not tests). tests/data/
// itself holds real tests, so match these exact paths, not every "data".
const NOT_TESTS = new Set(["tests/dsp/data", "tests/ml/data", "tests/audio/fixtures"]);

const rel = (p) => relative(ROOT, p).split(sep).join("/");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || NOT_TESTS.has(rel(p))) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith("-test.js")) out.push(p);
  }
  return out;
}
const discovered = walk(join(ROOT, "tests")).map(rel);
const tests = [...new Set([...discovered, ...EXTRA])]
  .filter((t) => !(t in SKIP))
  .sort();

if (process.argv.includes("--list")) {
  for (const t of tests) console.log(t);
  for (const [t, why] of Object.entries(SKIP)) console.log(`(skipped) ${t} — ${why}`);
  process.exit(0);
}

const failures = [];
for (const t of tests) {
  const start = Date.now();
  const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  if (r.status === 0) {
    console.log(`PASS  ${t}  (${secs} s)`);
  } else {
    failures.push(t);
    console.log(`FAIL  ${t}  (${secs} s, exit ${r.status ?? r.signal})`);
    // The failing test's own output is the useful part of a CI log.
    process.stdout.write(r.stdout ?? "");
    process.stderr.write(r.stderr ?? "");
  }
}

console.log(`\n${tests.length - failures.length}/${tests.length} test scripts passed` +
  (failures.length ? `; failed: ${failures.join(", ")}` : ""));
process.exit(failures.length === 0 ? 0 : 1);
