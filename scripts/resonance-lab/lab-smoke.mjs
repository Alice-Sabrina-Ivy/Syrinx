// lab-smoke.mjs — headless smoke test of the resonance lab against the BUILT app
// (docs/, served by `vite preview`), with and without ?resonance=lab.
//
//   npm run build && node scripts/resonance-lab/lab-smoke.mjs --wav=<48 kHz speech wav> [--seconds=40] [--shot=out.png]
//
// No-flag run: asserts that no lab chunk / worker / asset is requested and only the three
// production workers start. Flag run: opens the "Resonance lab" tab, waits, prints the
// lab's readout text and saves a screenshot.
//
// Process hygiene (CLAUDE.md hard rule 2): Chrome is launched by puppeteer with a fresh
// temporary --user-data-dir and closed via browser.close() (PID-scoped); the preview
// server is this script's own child, killed only by its PID (taskkill /pid <pid> /T /F).
// Cleanup is registered on exit / SIGINT / SIGTERM / uncaughtException.

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const WAV = arg("wav", "");
const SECONDS = Number(arg("seconds", "40"));
const SHOT = arg("shot", "");
const PORT = 4188;
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!CHROME || !WAV) { console.error("need Chrome and --wav"); process.exit(2); }

let server = null;
let browser = null;
const profile = mkdtempSync(path.join(tmpdir(), "reslab-smoke-"));
function cleanup() {
  if (server?.pid) { try { execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } server = null; }
  const bp = browser?.process?.()?.pid;
  if (bp) { try { execFileSync("taskkill", ["/pid", String(bp), "/T", "/F"], { stdio: "ignore" }); } catch { /* closed */ } }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
}
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

async function startServer() {
  server = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/Syrinx/`); if (r.ok) return; } catch { /* not yet */ }
    await sleep(200);
  }
  throw new Error("preview server did not start");
}

async function run(url, { lab }) {
  const page = await browser.newPage();
  const requests = [];
  const workers = [];
  const errors = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("workercreated", (w) => workers.push(w.url()));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  log("goto", url);
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.bringToFront();
  const clickText = async (texts) => page.evaluate((ts) => {
    const b = [...document.querySelectorAll("button")].find((x) => ts.some((t) => x.textContent.includes(t)));
    if (b) b.click();
    return !!b;
  }, texts);
  log("start clicked:", await clickText(["Get Started", "Start Listening"]));
  await sleep(1500);
  if (lab) {
    log("lab tab clicked:", await clickText(["Resonance lab"]));
    await sleep(SECONDS * 1000);
  } else {
    await sleep(8000);
  }
  const text = await page.evaluate(() => document.body.innerText);
  if (SHOT && lab) await page.screenshot({ path: SHOT, fullPage: true });
  await page.close();
  return { requests, workers, errors, text };
}

log("starting preview server");
await startServer();
log("launching chrome");
browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: profile,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${WAV}`, "--autoplay-policy=no-user-gesture-required"],
});

const base = `http://localhost:${PORT}/Syrinx/`;
const off = await run(base, { lab: false });
const labHits = off.requests.filter((u) => /LabView|labPipeline|lab-worker|resonance-lab/.test(u));
const offWorkers = off.workers.map((u) => u.split("/").pop());
console.log("NO FLAG: workers", offWorkers);
console.log("NO FLAG: lab requests", labHits.length ? labHits : "none");
console.log("NO FLAG: page errors", off.errors.length ? off.errors : "none");
const offOk = labHits.length === 0 && off.workers.length === 3 && !off.workers.some((u) => u.includes("lab-worker"));

const on = await run(`${base}?resonance=lab`, { lab: true });
console.log("FLAG: workers", on.workers.map((u) => u.split("/").pop()));
console.log("FLAG: lab requests", on.requests.filter((u) => /LabView|labPipeline|lab-worker|resonance-lab/.test(u)).map((u) => u.replace(base, "")));
console.log("FLAG: page errors", on.errors.length ? on.errors : "none");
const i = on.text.indexOf("Resonance lab");
console.log("FLAG: lab view text:\n" + on.text.slice(i, i + 2500));
console.log("FLAG: " + (on.text.match(/Lab cost here[^\n]*/) ?? ["(no cost line yet)"])[0]);
const onOk = on.workers.some((u) => u.includes("lab-worker")) && /Pitch \d+ Hz|Voiced so far [1-9]/.test(on.text);
await browser.close();
browser = null;
console.log(`\nno-flag isolation: ${offOk ? "PASS" : "FAIL"}; lab view live: ${onOk ? "PASS" : "FAIL"}`);
cleanup(); // the preview server child would otherwise keep the event loop alive
process.exit(offOk && onOk ? 0 : 1);
