// den_dfn3js.mjs — the JS DeepFilterNet 3 port (dfn3.js, onnxruntime-web WASM, one thread) over a
// set's mixtures: <data>/den/dfn3js/<set>/<id>.f32. 48 kHz mixtures only (others skipped).
//   node scripts/voice-preview/noise-study/den_dfn3js.mjs --data=build/vsn/data --set=test [--ids=a,b]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createDfn3, denoiseClipDfn3 } from "./dfn3.js";
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] ?? "1"]; }));
const DATA = path.resolve(args.data ?? "build/vsn/data"), SET = args.set ?? "test";
const ORT_DIST = path.resolve("node_modules/onnxruntime-web/dist");
const ort = await import(pathToFileURL(path.join(ORT_DIST, "ort.wasm.bundle.min.mjs")).href);
ort.env.wasm.numThreads = 1; ort.env.wasm.wasmBinary = readFileSync(path.join(ORT_DIST, "ort-wasm-simd-threaded.wasm"));
const MD = path.resolve(args.models ?? "build/vsn/dfn3/onnx/tmp/export");
const S = (m) => ort.InferenceSession.create(readFileSync(path.join(MD, `${m}.onnx`)), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
const dfn = createDfn3(ort, { enc: await S("enc"), erbDec: await S("erb_dec"), dfDec: await S("df_dec") });
const dir = path.join(DATA, "mix", SET), out = path.join(DATA, "den", "dfn3js", SET);
mkdirSync(out, { recursive: true });
const ids = args.ids ? args.ids.split(",") : readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
let n = 0, ms = 0, sec = 0;
for (const id of ids) {
  const p = path.join(out, `${id}.f32`);
  if (existsSync(p)) continue;
  const meta = JSON.parse(readFileSync(path.join(dir, `${id}.json`), "utf8"));
  const b = readFileSync(path.join(dir, `${id}.f32`)); const x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice();
  // exactly the app's path (src/voice-preview/dfn3.js denoiseClipDfn3: level normalisation, 48 kHz)
  const t0 = performance.now();
  const y = await denoiseClipDfn3(dfn, x, meta.rate);
  const r = { ms: { total: performance.now() - t0 } };
  writeFileSync(p, Buffer.from(y.buffer, y.byteOffset, y.byteLength));
  n++; ms += r.ms.total; sec += x.length / 48000;
}
console.log(`${n} mixtures, ${(ms / Math.max(sec, 1e-9)).toFixed(0)} ms per audio s`);
