// gender-ort-probe.js — Desktop browser ORT latency probe for the
// ECAPA-TDNN gender model (2026-07-19). Drives
// tests/ml/gender-ort-probe/index.html through an isolated spawned
// Chrome and saves the (dtype × execution provider × window) timing
// matrix. Browser runtime only — Node ORT is ~18× faster and invalid
// for ship decisions (CLAUDE.md §Binding methodology rules).
//
// Model files are staged OUTSIDE the repo (they're measurement inputs,
// not shippable artifacts): pass --models-dir=DIR containing
//   jaesunghuh-q8/onnx/model_quantized.onnx     (production artifact, HF)
//   jaesunghuh-fp32/onnx/model.onnx             (self-contained fp32 export)
//   jaesunghuh-fp16/onnx/model_fp16.onnx        (fp16, float32 I/O)
// Regeneration: scripts/export-jaesunghuh-onnx.py on the preserved
// branch perceived-voice-jaesunghuh-tdnn-investigation, then
// onnxconverter_common.float16 (keep_io_types) for the fp16 variant.
//
// Spawned-process cleanup contract (CLAUDE.md hard rule 2): Chrome is
// launched via puppeteer-core with an isolated user-data-dir;
// browser.close() is PID-scoped cleanup. No pattern-matched kills.
//
// Usage:
//   node scripts/gender-ort-probe.js --models-dir=DIR [--port=8766]
//     [--iters=30] [--headful] [--out=measurements/...json]

import http from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PROBE_DIR = join(ROOT, "tests/ml/gender-ort-probe");
const ORT_DIST = join(ROOT, "node_modules/onnxruntime-web/dist");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);
const MODELS_DIR = args["models-dir"];
if (!MODELS_DIR || !existsSync(MODELS_DIR)) {
  console.error("--models-dir=DIR is required (see header for expected layout)");
  process.exit(1);
}
const PORT = parseInt(args.port || "8766", 10);
const ITERS = parseInt(args.iters || "30", 10);
const TIMEOUT_MS = parseInt(args.timeout || "600000", 10);

const MODEL_FILES = {
  q8: "jaesunghuh-q8/onnx/model_quantized.onnx",
  fp32: "jaesunghuh-fp32/onnx/model.onnx",
  fp16: "jaesunghuh-fp16/onnx/model_fp16.onnx",
};

const cells = [];
for (const [model, file] of Object.entries(MODEL_FILES)) {
  if (!existsSync(join(MODELS_DIR, file))) {
    console.warn(`skipping ${model}: ${file} not found under --models-dir`);
    continue;
  }
  for (const ep of ["webgpu", "wasm"]) {
    for (const windowSec of [0.75, 0.625]) {
      cells.push({ model, ep, windowSec, file: file.replace(/\\/g, "/") });
    }
  }
}
const probeConfig = { cells, warmup: 3, iters: ITERS };

function ctype(p) {
  const e = extname(p).toLowerCase();
  if (e === ".js" || e === ".mjs") return "application/javascript";
  if (e === ".wasm") return "application/wasm";
  if (e === ".html") return "text/html; charset=utf-8";
  if (e === ".json") return "application/json";
  if (e === ".onnx") return "application/octet-stream";
  return "application/octet-stream";
}

function serveFile(res, path) {
  try {
    const data = readFileSync(path);
    res.writeHead(200, { "Content-Type": ctype(path), "Content-Length": data.length });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = (req.url || "/").split("?")[0];
      if (url === "/" || url === "/index.html") return serveFile(res, join(PROBE_DIR, "index.html"));
      if (url === "/probe-config.json") {
        const body = JSON.stringify(probeConfig);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(body);
      }
      if (url.startsWith("/ort/")) return serveFile(res, join(ORT_DIST, url.slice(5)));
      if (url.startsWith("/models/")) return serveFile(res, join(MODELS_DIR, decodeURIComponent(url.slice(8))));
      res.writeHead(404); res.end("not found");
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  if (!existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath}`);
  console.log(`${cells.length} cells; starting server on 127.0.0.1:${PORT}`);
  const server = await startServer();

  // Headful by default: WebGPU adapter availability in headless Chrome is
  // spottier than headful on Windows; a probe that silently measured a
  // CPU fallback would corrupt the comparison.
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: args.headful ? false : false,
    args: ["--no-first-run", "--no-default-browser-check", "--window-size=500,400"],
  });
  try {
    const page = await browser.newPage();
    page.on("console", (msg) => console.log("  [page]", msg.text()));
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
    const start = Date.now();
    let result = null;
    while (Date.now() - start < TIMEOUT_MS) {
      result = await page.evaluate(() => window.__genderOrtProbe);
      if (result && result.done) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!result || !result.done) throw new Error("probe timed out");

    const out = {
      capturedAtIso: new Date().toISOString(),
      userAgent: await browser.userAgent(),
      ortWebVersion: JSON.parse(readFileSync(join(ROOT, "node_modules/onnxruntime-web/package.json"), "utf8")).version,
      webgpuAdapter: result.webgpuAdapter,
      iters: ITERS,
      modelBytes: Object.fromEntries(Object.entries(MODEL_FILES)
        .filter(([, f]) => existsSync(join(MODELS_DIR, f)))
        .map(([k, f]) => [k, statSync(join(MODELS_DIR, f)).size])),
      results: result.results,
      errors: result.errors,
    };
    const outPath = args.out
      || join(ROOT, "measurements", `gender-ort-probe-desktop-${out.capturedAtIso.replace(/[:.]/g, "-")}.json`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log(`\nsaved ${outPath}`);
    console.log("\nmodel | ep | window | median | p95 | min");
    for (const r of result.results) {
      console.log(`${r.model.padEnd(5)} | ${r.ep.padEnd(6)} | ${String(r.windowSec).padEnd(6)} | ${String(r.medianMs).padStart(6)} | ${String(r.p95Ms).padStart(6)} | ${String(r.minMs).padStart(6)}`);
    }
    for (const e of result.errors) console.log(`ERROR ${e.cell}: ${e.message}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
