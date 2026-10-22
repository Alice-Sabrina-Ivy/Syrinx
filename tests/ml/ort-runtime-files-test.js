// ort-runtime-files-test.js — the app ships the ONNX Runtime Web runtime
// files itself (2026-10-07, measurements/self-hosted-ort-2026-10-07.md).
//
// Guards:
//   1. selfHostedWasmPaths keeps Transformers.js's variant choice
//      (asyncify; plain on Safari) and only swaps the host.
//   2. The installed Transformers.js still asks only for variants the app
//      ships (an upgrade that picks another variant fails here, not in a
//      user's browser).
//   3. The shipped files come from the one onnxruntime-web the bundle uses:
//      the version Transformers.js pins, no nested second copy.
//   4. Both ORT users (gender worker incl. the speech detector, lab worker)
//      re-point wasmPaths.
//
// Run: node tests/ml/ort-runtime-files-test.js

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ORT_RUNTIME_VARIANTS, selfHostedWasmPaths, wasmVariantOf } from "../../src/ml/ort-wasm-paths.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failed = 0;
let passed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/";
const URLS = {
  "ort-wasm-simd-threaded.asyncify.mjs": "https://app.example/Syrinx/assets/ort-wasm-simd-threaded.asyncify-AAAA.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm": "https://app.example/Syrinx/assets/ort-wasm-simd-threaded.asyncify-BBBB.wasm",
  "ort-wasm-simd-threaded.mjs": "https://app.example/Syrinx/assets/ort-wasm-simd-threaded-CCCC.mjs",
  "ort-wasm-simd-threaded.wasm": "https://app.example/Syrinx/assets/ort-wasm-simd-threaded-DDDD.wasm",
};

console.log("1. selfHostedWasmPaths");
{
  const a = selfHostedWasmPaths({ mjs: `${CDN}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${CDN}ort-wasm-simd-threaded.asyncify.wasm` }, URLS);
  check("asyncify (non-Safari default) -> app asyncify files",
    a.mjs === URLS["ort-wasm-simd-threaded.asyncify.mjs"] && a.wasm === URLS["ort-wasm-simd-threaded.asyncify.wasm"], JSON.stringify(a));
  const p = selfHostedWasmPaths({ mjs: `${CDN}ort-wasm-simd-threaded.mjs`, wasm: `${CDN}ort-wasm-simd-threaded.wasm` }, URLS);
  check("plain (Safari) -> app plain files",
    p.mjs === URLS["ort-wasm-simd-threaded.mjs"] && p.wasm === URLS["ort-wasm-simd-threaded.wasm"], JSON.stringify(p));
  check("query string / fragment ignored", wasmVariantOf({ wasm: `${CDN}ort-wasm-simd-threaded.wasm?v=1#x` }) === "plain");
  check("unset -> asyncify", wasmVariantOf(undefined) === "asyncify");
  check("string prefix -> asyncify", wasmVariantOf(CDN) === "asyncify");
  check("unknown variant -> asyncify", wasmVariantOf({ wasm: `${CDN}ort-wasm-simd-threaded.jsep.wasm` }) === "asyncify");
  for (const u of Object.values({ ...a, ...p })) check(`no jsDelivr in ${u.split("/").pop()}`, !u.includes("jsdelivr"));
  let threw = false;
  try { selfHostedWasmPaths(undefined, { "ort-wasm-simd-threaded.asyncify.mjs": "x" }); } catch { threw = true; }
  check("missing shipped file throws (never falls back to a CDN)", threw);
  // the result is a fresh object (Transformers.js later mutates wasmPaths.mjs)
  const again = selfHostedWasmPaths(undefined, URLS);
  check("returns a fresh object", again !== selfHostedWasmPaths(undefined, URLS));
}

console.log("2. Transformers.js asks only for shipped variants");
const shipped = new Set(Object.values(ORT_RUNTIME_VARIANTS).flatMap((v) => [v.mjs, v.wasm]));
const tfPkgDir = join(ROOT, "node_modules", "@huggingface", "transformers");
const ortPkgDir = join(ROOT, "node_modules", "onnxruntime-web");
if (!existsSync(tfPkgDir) || !existsSync(ortPkgDir)) {
  console.log("  skip (node_modules not installed)");
} else {
  const tfWeb = readFileSync(join(tfPkgDir, "dist", "transformers.web.js"), "utf8");
  const asked = new Set(tfWeb.match(/ort-wasm-simd-threaded[a-z.]*\.(?:mjs|wasm)/g) ?? []);
  check("Transformers.js names ORT runtime files", asked.size > 0);
  for (const f of asked) check(`shipped: ${f}`, shipped.has(f), "Transformers.js now selects a variant the app does not ship — add it to ORT_RUNTIME_VARIANTS and ort-runtime-files.js");

  console.log("3. one onnxruntime-web, the version Transformers.js pins");
  const tfPkg = JSON.parse(readFileSync(join(tfPkgDir, "package.json"), "utf8"));
  const ortPkg = JSON.parse(readFileSync(join(ortPkgDir, "package.json"), "utf8"));
  const pinned = tfPkg.dependencies?.["onnxruntime-web"];
  check(`installed onnxruntime-web ${ortPkg.version} matches Transformers.js's ${pinned}`, pinned === ortPkg.version || pinned === `^${ortPkg.version}` || pinned === `~${ortPkg.version}`);
  check("no nested onnxruntime-web under Transformers.js", !existsSync(join(tfPkgDir, "node_modules", "onnxruntime-web")));
  for (const f of shipped) {
    check(`package exports ./${f}`, ortPkg.exports?.[`./${f}`] != null);
    check(`file exists: dist/${f}`, existsSync(join(ortPkgDir, "dist", f)));
  }
}

console.log("4. both ORT users re-point wasmPaths");
{
  const gw = readFileSync(join(ROOT, "src", "ml", "gender-worker.js"), "utf8");
  check("gender worker: pointOrtAtAppRuntime(env.backends.onnx.wasm)", /\npointOrtAtAppRuntime\(env\.backends\.onnx\.wasm\);/.test(gw));
  check("gender worker: speech detector shares the Transformers.js ORT instance", gw.includes('import * as ort from "onnxruntime-web/webgpu"'));
  const lw = readFileSync(join(ROOT, "src", "resonance-lab", "lab-worker.js"), "utf8");
  const imp = lw.indexOf('await import("@huggingface/transformers")');
  const point = lw.indexOf("pointOrtAtAppRuntime(T.env.backends.onnx.wasm)");
  const load = lw.indexOf("from_pretrained(");
  check("lab worker: re-points after importing Transformers.js, before loading the model", imp >= 0 && point > imp && load > point);
  const files = readFileSync(join(ROOT, "src", "ml", "ort-runtime-files.js"), "utf8");
  for (const f of shipped) check(`ort-runtime-files.js imports ${f}?url`, files.includes(`"onnxruntime-web/${f}?url"`));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
