// swift-f0-wasm-probe.js — Stage 3.5 SwiftF0 browser ORT-WASM latency probe.
//
// Two modes:
//   --mode=desktop (default): spawn isolated Chrome via puppeteer-core, drive
//                              tests/dsp/swift-f0-wasm-probe/index.html, read
//                              window.__swiftF0WasmProbe.
//   --mode=mobile           : connect via ADB + CDP to Chrome on a USB-attached
//                              Android phone, drive the same probe URL through
//                              `adb forward tcp:9222 localabstract:chrome_devtools_remote`.
//
// The probe page (tests/dsp/swift-f0-wasm-probe/index.html) loads
// onnxruntime-web 1.16.3 from jsdelivr, fetches the SwiftF0 ONNX model
// (served by the local http server on port 8765), runs warmup + 100x
// inferences on a 1-second buffer + 200x inferences on a 1024-sample
// (single-frame) buffer, and exposes per-call timings on
// window.__swiftF0WasmProbe.
//
// Output: measurements/swift-f0-wasm-probe-{desktop|mobile}-<ISO>.json
//
// Usage:
//   node scripts/swift-f0-wasm-probe.js [--mode=desktop|mobile] [--port=8765]
//
// Spawned-process cleanup contract (from CLAUDE.md): the desktop mode spawns
// a Chrome process via puppeteer-core's launch, which provides PID-scoped
// cleanup via browser.close(). No pattern-matched chrome.exe kill anywhere.

import http from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import puppeteer from "puppeteer-core";
import { networkInterfaces } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PROBE_DIR = join(ROOT, "tests/dsp/swift-f0-wasm-probe");
const MODEL_PATH = join(ROOT, "tests/dsp/data/swift-f0/model.onnx");
const MEASUREMENTS_DIR = join(ROOT, "measurements");

// ---------------------------------------------------------------------------
//  Args
// ---------------------------------------------------------------------------

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);
const MODE = args.mode || "desktop";
const PORT = parseInt(args.port || "8765", 10);
const TIMEOUT_MS = parseInt(args.timeout || "60000", 10);

// ---------------------------------------------------------------------------
//  Tiny static HTTP server for the probe assets
// ---------------------------------------------------------------------------

function startStaticServer(port, hostBindAll) {
  return new Promise((resolve, reject) => {
    const indexBytes = readFileSync(join(PROBE_DIR, "index.html"));
    const modelBytes = readFileSync(MODEL_PATH);
    const ortDir = join(ROOT, "node_modules/onnxruntime-web/dist");
    const ctype = (p) => {
      const e = extname(p).toLowerCase();
      if (e === ".js" || e === ".mjs") return "application/javascript";
      if (e === ".wasm") return "application/wasm";
      if (e === ".html") return "text/html; charset=utf-8";
      if (e === ".map") return "application/json";
      return "application/octet-stream";
    };
    const server = http.createServer((req, res) => {
      const url = (req.url || "/").split("?")[0];
      if (url === "/" || url === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(indexBytes);
        return;
      }
      if (url === "/model.onnx") {
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": modelBytes.length,
        });
        res.end(modelBytes);
        return;
      }
      if (url === "/healthz") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }
      // Serve onnxruntime-web assets from node_modules under /ort/
      if (url.startsWith("/ort/")) {
        const rel = url.replace(/^\/ort\//, "");
        if (rel.includes("..")) { res.writeHead(403).end(); return; }
        const p = join(ortDir, rel);
        if (existsSync(p)) {
          try {
            const buf = readFileSync(p);
            res.writeHead(200, { "Content-Type": ctype(p), "Content-Length": buf.length });
            res.end(buf);
            return;
          } catch (e) {
            res.writeHead(500).end(e.message);
            return;
          }
        }
      }
      res.writeHead(404).end();
    });
    const host = hostBindAll ? "0.0.0.0" : "127.0.0.1";
    server.listen(port, host, () => resolve(server));
    server.on("error", reject);
  });
}

function localLanIp() {
  const ifs = networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const it of ifs[name] || []) {
      if (it.family === "IPv4" && !it.internal && it.address.startsWith("192.168.")) return it.address;
      if (it.family === "IPv4" && !it.internal && it.address.startsWith("10.")) return it.address;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
//  Desktop mode: puppeteer-core launches isolated Chrome, opens probe page
// ---------------------------------------------------------------------------

async function runDesktopMode() {
  const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  if (!existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath}`);

  console.log("Starting static server on http://127.0.0.1:" + PORT);
  const server = await startStaticServer(PORT, false);

  console.log("Launching isolated Chrome via puppeteer-core …");
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  let result;
  try {
    const page = await browser.newPage();
    page.on("console", (msg) => console.log("  [page]", msg.text()));
    page.on("pageerror", (err) => console.log("  [page error]", err.message));
    console.log(`Opening http://127.0.0.1:${PORT}/`);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
    console.log("Waiting for probe to complete (max " + (TIMEOUT_MS/1000) + " s) …");

    const start = Date.now();
    while (true) {
      const state = await page.evaluate(() => window.__swiftF0WasmProbe);
      if (state && state.status === "done") {
        result = state;
        break;
      }
      if (state && state.status === "error") {
        result = state;
        break;
      }
      if (Date.now() - start > TIMEOUT_MS) {
        result = { status: "timeout", lastState: state };
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    await browser.close();
    server.close();
  }
  return result;
}

// ---------------------------------------------------------------------------
//  Mobile mode: ADB + CDP, drives Chrome on the phone
// ---------------------------------------------------------------------------

function adb(args) {
  const r = spawnSync("adb", args, { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

async function runMobileMode() {
  const lanIp = localLanIp();
  if (!lanIp) throw new Error("Couldn't find a LAN IP for serving probe to phone");
  console.log("LAN IP: " + lanIp);

  // Verify ADB sees the phone authorized
  const dev = adb(["devices"]);
  const lines = dev.stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("List"));
  const devices = lines.map((l) => l.split(/\s+/));
  const authorized = devices.filter((d) => d[1] === "device");
  if (authorized.length === 0) {
    if (devices.find((d) => d[1] === "unauthorized")) {
      throw new Error("Phone is unauthorized. Tap Allow on the device when prompted.");
    }
    throw new Error("No ADB devices attached. Plug in the phone with USB debugging enabled.");
  }
  if (authorized.length > 1) throw new Error("Multiple ADB devices attached. Disconnect extras.");
  const deviceId = authorized[0][0];
  console.log("Phone: " + deviceId);

  // Wake screen and stayon
  adb(["-s", deviceId, "shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
  adb(["-s", deviceId, "shell", "svc", "power", "stayon", "usb"]);

  // Start the static server bound to all interfaces so the phone can reach it
  console.log("Starting static server on http://" + lanIp + ":" + PORT);
  const server = await startStaticServer(PORT, true);
  const probeUrl = `http://${lanIp}:${PORT}/`;
  console.log("Probe URL: " + probeUrl);

  let browser;
  try {
    // Forward the phone's CDP socket
    adb(["-s", deviceId, "forward", "--remove", "tcp:9222"]);
    const fr = adb(["-s", deviceId, "forward", "tcp:9222", "localabstract:chrome_devtools_remote"]);
    if (fr.code !== 0) console.log("  forward warning:", fr.stderr.trim());

    // Launch Chrome on the phone
    console.log("Launching Chrome on the phone via am start …");
    const start = adb(["-s", deviceId, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", probeUrl, "com.android.chrome"]);
    if (start.code !== 0) {
      console.log("  am start error:", start.stderr.trim() || start.stdout.trim());
    }

    // Wait for CDP to come up
    console.log("Waiting for CDP at http://localhost:9222/json/version …");
    let cdpReady = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      try {
        const r = await fetch("http://localhost:9222/json/version");
        if (r.ok) { cdpReady = true; break; }
      } catch { /* CDP not up yet — keep polling */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!cdpReady) throw new Error("CDP didn't come up. Is Chrome foregrounded on the phone?");

    // Connect puppeteer to remote browser
    console.log("Connecting puppeteer-core to phone Chrome …");
    browser = await puppeteer.connect({
      browserURL: "http://localhost:9222",
      defaultViewport: null,
    });

    // Find the probe tab
    let page = null;
    const tEnd = Date.now() + 15000;
    while (Date.now() < tEnd && !page) {
      const targets = await browser.targets();
      for (const t of targets) {
        if (t.type() === "page" && t.url().startsWith(`http://${lanIp}:${PORT}`)) {
          page = await t.page();
          break;
        }
      }
      if (!page) await new Promise((r) => setTimeout(r, 500));
    }
    if (!page) throw new Error("Couldn't find probe tab in remote Chrome.");
    console.log("Found tab: " + page.url());

    page.on("console", (msg) => console.log("  [page]", msg.text()));
    page.on("pageerror", (err) => console.log("  [page error]", err.message));

    console.log("Waiting for probe to complete (max " + (TIMEOUT_MS/1000) + " s) …");
    let result;
    const probeStart = Date.now();
    while (true) {
      let state = null;
      try {
        state = await page.evaluate(() => window.__swiftF0WasmProbe || null);
      } catch {
        // tab can navigate away if the user touches the device — keep trying
      }
      if (state && state.status === "done") {
        result = state;
        break;
      }
      if (state && state.status === "error") {
        result = state;
        break;
      }
      if (Date.now() - probeStart > TIMEOUT_MS) {
        result = { status: "timeout", lastState: state };
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return result;
  } finally {
    if (browser) await browser.disconnect();
    server.close();
    adb(["-s", deviceId || "*", "forward", "--remove", "tcp:9222"]);
  }
}

// ---------------------------------------------------------------------------
//  Entry
// ---------------------------------------------------------------------------

if (!existsSync(MODEL_PATH)) {
  console.error(`Model missing at ${MODEL_PATH}. Run the SwiftF0 fetch command first.`);
  process.exit(1);
}
if (!existsSync(MEASUREMENTS_DIR)) mkdirSync(MEASUREMENTS_DIR, { recursive: true });

console.log(`Mode: ${MODE}`);
let result;
try {
  if (MODE === "desktop") result = await runDesktopMode();
  else if (MODE === "mobile") result = await runMobileMode();
  else throw new Error(`unknown --mode=${MODE}`);
} catch (e) {
  console.error("\nERROR:", e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
}

// Print summary
if (result.status !== "done") {
  console.error("\nProbe did not complete cleanly:", result);
  process.exit(2);
}
const s = result.summary;
console.log("\n=== summary ===");
console.log(`mode: ${MODE}`);
console.log(`UA: ${s.ua}`);
console.log(`Session load: ${s.sessionLoadMs.toFixed(0)} ms`);
console.log(`Model size: ${(s.modelBytes / 1024).toFixed(0)} KB`);
console.log(`\nInference latency:`);
console.log(`  1-second buffer (n=${s.longBuffer.n}): ` +
  `min ${s.longBuffer.min.toFixed(2)} / median ${s.longBuffer.p50.toFixed(2)} / ` +
  `p95 ${s.longBuffer.p95.toFixed(2)} / max ${s.longBuffer.max.toFixed(2)} ms`);
console.log(`  1024 samples  (n=${s.shortBuffer.n}): ` +
  `min ${s.shortBuffer.min.toFixed(2)} / median ${s.shortBuffer.p50.toFixed(2)} / ` +
  `p95 ${s.shortBuffer.p95.toFixed(2)} / max ${s.shortBuffer.max.toFixed(2)} ms`);

// Save JSON
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = join(MEASUREMENTS_DIR, `swift-f0-wasm-probe-${MODE}-${stamp}.json`);
writeFileSync(outPath, JSON.stringify({
  mode: MODE,
  ts: new Date().toISOString(),
  ...result,
}, null, 2));
console.log(`\nSaved: ${outPath}`);
