// prep.mjs — copies the bench's assets into the gitignored build/vsn/dfbench/: onnxruntime-web's
// plain WASM build (the app's own dependency), the three DFN3 graphs, dfn3.js and one 7.4 s
// held-out mixture.   node scripts/voice-preview/noise-study/dfbench/prep.mjs
import { mkdirSync, copyFileSync } from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const out = path.join(repo, "build/vsn/dfbench");
for (const d of ["ort", "models"]) mkdirSync(path.join(out, d), { recursive: true });
const dist = path.join(repo, "node_modules/onnxruntime-web/dist");
for (const f of ["ort.wasm.min.mjs", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) copyFileSync(path.join(dist, f), path.join(out, "ort", f));
for (const m of ["enc", "erb_dec", "df_dec"]) copyFileSync(path.join(repo, "build/vsn/dfn3/onnx/tmp/export", `${m}.onnx`), path.join(out, "models", `${m}.onnx`));
copyFileSync(path.join(repo, "scripts/voice-preview/noise-study/dfn3.js"), path.join(out, "dfn3.js"));
copyFileSync(path.join(repo, "build/vsn/data/mix/test/irm_03397_01780880794__10dB_0.f32"), path.join(out, "clip.f32"));
console.log("assets in", out);
