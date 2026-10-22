// ort-bench.mjs — per-inference CPU of the deployed gender classifier
// (q8-v2 ECAPA, 0.75 s window) under onnxruntime-web's WASM builds and session
// options, in Node (same V8 / WebAssembly engine as Chrome; single thread, as
// in the app, which is not cross-origin isolated)
// (measurements/heard-as-cpu-2026-10-07.md).
//
//   node scripts/heard-as/ort-bench.mjs [--n=80] [--variants=asyncify,plain,...]
//
// Variants (each a fresh Node process would be cleaner; one process per variant
// is used — the script re-spawns itself):
//   asyncify     ort.webgpu bundle + ort-wasm-simd-threaded.asyncify (what
//                transformers.js 4.x loads in Chrome / Firefox today)
//   plain        ort.webgpu bundle + ort-wasm-simd-threaded (what it loads on
//                Safari; no asyncify instrumentation)
//   plain-noopt  plain + graphOptimizationLevel "disabled"
//   plain-basic  plain + graphOptimizationLevel "basic"
//   plain-noarena plain + enableCpuMemArena false
//   plain-fixed  plain + freeDimensionOverrides (fixed 12000-sample input)
// Input: 0.75 s windows of the committed lab fixtures (public LibriSpeech),
// every 0.3 s. Output logits are compared with the asyncify run (max |Δ|).
// CPU = process.cpuUsage() around session.run only.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(here), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const N = Number(arg("n", "80"));
const VARIANT = arg("variant", "");
const MODEL = path.join(repo, "node_modules/@huggingface/transformers/.cache/Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2/onnx/model_quantized.onnx");
const DIST = path.join(repo, "node_modules/onnxruntime-web/dist");

if (!VARIANT) {
  const variants = arg("variants", "asyncify,plain,plain-noopt,plain-basic,plain-noarena,plain-fixed,asyncify-fixed").split(",");
  const out = {};
  for (const v of variants) {
    const r = spawnSync(process.execPath, [here, `--variant=${v}`, `--n=${N}`], { encoding: "utf8" });
    if (r.status !== 0) { console.log(`${v}: failed\n${r.stderr.slice(-2000)}`); continue; }
    out[v] = JSON.parse(r.stdout.trim().split("\n").pop());
  }
  const ref = out.asyncify?.logits;
  console.log(`node ${process.version}, ${N} inferences per variant (after 5 warm-up), single thread`);
  for (const [v, r] of Object.entries(out)) {
    const d = ref ? Math.max(...r.logits.map((x, i) => Math.abs(x - ref[i]))) : NaN;
    console.log(`${v.padEnd(15)} CPU median ${r.medCpu.toFixed(2)} ms  mean ${r.meanCpu.toFixed(2)}  wall median ${r.medWall.toFixed(2)}  session create ${r.createMs.toFixed(0)} ms  max |Δ logit| vs asyncify ${d.toExponential(2)}`);
  }
  process.exit(0);
}

const plain = VARIANT.startsWith("plain");
const ort = await import(pathToFileURL(path.join(DIST, "ort.webgpu.min.mjs")).href);
const base = plain ? "ort-wasm-simd-threaded" : "ort-wasm-simd-threaded.asyncify";
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmBinary = readFileSync(path.join(DIST, `${base}.wasm`));
ort.env.wasm.wasmPaths = { mjs: pathToFileURL(path.join(DIST, `${base}.mjs`)).href, wasm: pathToFileURL(path.join(DIST, `${base}.wasm`)).href };
const so = { executionProviders: ["wasm"] };
if (VARIANT.endsWith("-noopt")) so.graphOptimizationLevel = "disabled";
if (VARIANT.endsWith("-basic")) so.graphOptimizationLevel = "basic";
if (VARIANT.endsWith("-noarena")) so.enableCpuMemArena = false;
if (VARIANT.endsWith("-fixed")) so.freeDimensionOverrides = { batch_size: 1, sequence_length: 12000 };
const tc = performance.now();
const session = await ort.InferenceSession.create(readFileSync(MODEL), so);
const createMs = performance.now() - tc;
const inName = session.inputNames[0], outName = session.outputNames[0];

function readWav16(p) {
  const b = readFileSync(p);
  let off = 12, data = null;
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4); const len = b.readUInt32LE(off + 4);
    if (id === "data") { data = b.subarray(off + 8, off + 8 + len); break; }
    off += 8 + len + (len & 1);
  }
  const x = new Float32Array(data.length / 2);
  for (let i = 0; i < x.length; i++) x[i] = data.readInt16LE(2 * i) / 32768;
  return x;
}
const wins = [];
for (const n of ["ls_woman_high", "ls_man_low", "ls_man_hi8_f105"]) {
  const x = readWav16(path.join(repo, "tests/resonance-lab/fixtures", `${n}.wav`));
  for (let s = 0; s + 12000 <= x.length; s += 4800) wins.push(x.slice(s, s + 12000));
}
const cpu = [], wall = [], logits = [];
for (let i = 0; i < N + 5; i++) {
  const w = wins[i % wins.length];
  const feeds = { [inName]: new ort.Tensor("float32", w, [1, w.length]) };
  const u0 = process.cpuUsage(); const t0 = performance.now();
  const r = await session.run(feeds);
  const t1 = performance.now(); const u = process.cpuUsage(u0);
  if (i < 5) continue;
  cpu.push((u.user + u.system) / 1000); wall.push(t1 - t0);
  const d = r[outName].data; logits.push(d[1] - d[0]);
}
const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
console.log(JSON.stringify({ medCpu: med(cpu), meanCpu: cpu.reduce((a, b) => a + b, 0) / cpu.length, medWall: med(wall), createMs, logits, inputs: session.inputNames }));
