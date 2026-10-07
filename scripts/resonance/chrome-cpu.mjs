// chrome-cpu.mjs — the resonance cue worker's cost in desktop Chrome
// (measurements/resonance-cue-production-path-2026-10-07.md §7).
//
//   npm run build && node scripts/cue-strip-smoke-wavs.mjs --r1=<jobs> &&
//   node scripts/resonance/chrome-cpu.mjs [--wav=build/cue-strip-smoke/speech-woman.wav] [--seconds=60]
//
// The BUILT app (vite preview) in headless Chrome under ?diag=1, the fake mic
// playing a public LibriSpeech WAV. Reads window.__syrinxDiag.snapshot()
// .resonancePerf: the worker's own busy time (performance.now() around its
// chunk + pitch-frame processing) per second of audio — an EMA (τ 10 s) and
// the session mean. The panel stays off (no gender worker).
//
// Process hygiene (CLAUDE.md hard rule 2): puppeteer with a temporary
// --user-data-dir, browser.close() then taskkill of ITS pid only; the preview
// server is this script's own child, killed by its PID; cleanup on exit /
// SIGINT / SIGTERM / uncaughtException.

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const WAV = arg("wav", path.join(repo, "build/cue-strip-smoke/speech-woman.wav"));
const SECONDS = Number(arg("seconds", "60"));
const PORT = Number(arg("port", "4195"));
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!CHROME || !existsSync(WAV)) { console.error("need Chrome and the WAV"); process.exit(2); }

let server = null, browser = null;
const profile = mkdtempSync(path.join(tmpdir(), "resonance-cpu-"));
function cleanup() {
  if (server?.pid) { try { execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } server = null; }
  const bp = browser?.process?.()?.pid;
  if (bp) { try { execFileSync("taskkill", ["/pid", String(bp), "/T", "/F"], { stdio: "ignore" }); } catch { /* closed */ } }
  browser = null;
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
}
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

server = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: "ignore" });
for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://localhost:${PORT}/Syrinx/`)).ok) break; } catch { /* */ } await sleep(200); }
browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: profile,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}`],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const cdp = await page.createCDPSession();
await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await page.goto(`http://localhost:${PORT}/Syrinx/?diag=1`, { waitUntil: "domcontentloaded" });
const click = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(t)); b?.click(); return !!b; }, t);
await page.waitForFunction(() => document.body.innerText.includes("Welcome to Syrinx"), { timeout: 60000 });
await click("Get Started");
await page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
await page.evaluate(() => document.querySelector('input[data-direction="exploring"]')?.closest("label").click());
await click("Continue");
await page.waitForFunction(() => document.body.innerText.includes("Stop Listening"), { timeout: 30000 });
const ua = await browser.version();
const rows = [];
for (let t = 10; t <= SECONDS; t += 10) {
  await sleep(10000);
  const s = await page.evaluate(() => window.__syrinxDiag?.snapshot());
  const p = s?.resonancePerf;
  rows.push(p);
  console.log(`t=${t}s  ema ${p?.msPerAudioS?.toFixed(1)} ms/s  mean ${p?.meanMsPerAudioS?.toFixed(1)} ms/s  audio ${p?.audioS?.toFixed(0)} s  bins ${p?.binsAdmitted}+${p?.binsDropped} dropped  forced ${p?.gridForcedUnvoiced}  status ${s?.resonanceStatus?.status}  ml worker ${s?.mlWorkerAlive}`);
}
const last = rows[rows.length - 1];
console.log(`${ua}: resonance worker ${last?.meanMsPerAudioS?.toFixed(1)} ms per audio second (session mean), EMA ${last?.msPerAudioS?.toFixed(1)}`);
await browser.close().catch(() => {});
cleanup();
process.exit(0);
