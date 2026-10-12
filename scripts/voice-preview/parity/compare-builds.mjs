// compare-builds.mjs — are two builds' parity outputs bit-identical?
//   node scripts/voice-preview/parity/compare-builds.mjs simd nosimd [level=all]
// Compares the sha256 of every output in VP_CACHE/parity/<a>/manifest-<level>.json
// with <b>'s (run-wasm.mjs; the second build can use --hashes-only).
import { readFileSync } from "node:fs";
import path from "node:path";
import { P } from "../lib/paths.mjs";

const [a = "simd", b = "nosimd", level = "all"] = process.argv.slice(2);
const load = (v) => JSON.parse(readFileSync(path.join(P.parity, v, `manifest-${level}.json`), "utf8")).files;
const A = load(a), B = load(b);
const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();
const diff = keys.filter((k) => !A[k] || !B[k] || A[k].sha256 !== B[k].sha256);
console.log(`${a} vs ${b}: ${keys.length - diff.length} of ${keys.length} outputs bit-identical`);
for (const k of diff.slice(0, 50)) console.log(`  differs: ${k}`);
process.exitCode = diff.length ? 1 : 0;
