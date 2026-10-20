// chrome-level-check.mjs — does the app in Chrome see the same DSP intensity
// as the Node chain? (measurements/pitch-quiet-floor-2026-10-20.md §1)
// Headless Chrome (puppeteer, temporary profile) plays a public speech WAV
// through its fake microphone into the BUILT app (`vite build --outDir DIST`,
// served here by this script's own `vite preview`), on the MSTP and the
// AudioWorklet capture path (?capture=mstp | audiocontext, ?diag=1), and the
// diag snapshot's per-frame DSP intensity is saved. Compare with
// chrome-level-compare.mjs.
//
// Process hygiene (CLAUDE.md hard rule 2, as scripts/cue-strip-smoke.mjs):
// Chrome is launched by puppeteer with a temporary --user-data-dir and closed
// via browser.close(), falling back to taskkill of ITS pid only; the preview
// server is this script's own child, killed only by its PID.
//
// Usage (repo root): npx vite build --outDir build/quiet-floor/chrome-check/dist &&
//   node scripts/quiet-floor/chrome-level-check.mjs --wav=<abs path> [--dist=build/quiet-floor/chrome-check/dist]
//        [--sec=40] [--out=build/quiet-floor/chrome-check] [--port=4291]
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const WAV = path.resolve(arg("wav", ""));
const DIST = path.resolve(repo, arg("dist", "build/quiet-floor/chrome-check/dist"));
const OUT = path.resolve(repo, arg("out", "build/quiet-floor/chrome-check"));
const SEC = Number(arg("sec", "40"));
const PORT = Number(arg("port", "4291"));
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!CHROME || !existsSync(WAV) || !existsSync(DIST)) { console.error("need Chrome, --wav and the built app (--dist)"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

let server = null, browser = null;
const profile = mkdtempSync(path.join(tmpdir(), "qf-level-check-"));
function closeBrowserHard() {
  const bp = browser?.process?.()?.pid;
  if (bp) { try { execFileSync("taskkill", ["/pid", String(bp), "/T", "/F"], { stdio: "ignore" }); } catch { /* closed */ } }
  browser = null;
}
function cleanup() {
  if (server?.pid) { try { execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } server = null; }
  closeBrowserHard();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
}
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

server = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "preview", "--outDir", DIST, "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: "ignore" });
for (let i = 0; ; i++) {
  try { const r = await fetch(`http://localhost:${PORT}/Syrinx/`); if (r.ok) break; } catch { /* not yet */ }
  if (i > 300) throw new Error("preview server did not start");
  await sleep(200);
}

const clickButton = (page, texts, scope = "") => page.evaluate((ts, scope) => {
  const root = scope ? document.querySelector(scope) : document;
  const b = [...(root?.querySelectorAll("button") ?? [])].find((x) => ts.some((t) => x.textContent.trim().includes(t)));
  if (b) b.click();
  return !!b;
}, texts, scope);

for (const kind of ["mstp", "audiocontext"]) {
  if (browser) { await browser.close().catch(() => {}); closeBrowserHard(); }
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir: profile,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${WAV}`, "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.goto(`http://localhost:${PORT}/Syrinx/?diag=1&capture=${kind}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.bringToFront();
  // First visit: welcome -> direction question -> Continue starts listening;
  // a returning profile gets the question again (Continue) or Start Listening.
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => document.body.innerText.includes("Stop Listening"))) break;
    if (!(await clickButton(page, ["Get Started"]))) {
      // the direction question needs a choice before Continue (first visit)
      await page.evaluate(() => {
        const input = document.querySelector('[role=dialog] input[data-direction="exploring"]');
        if (input && !input.checked) input.closest("label").click();
      });
      if (!(await clickButton(page, ["Continue"], "[role=dialog]"))) await clickButton(page, ["Start Listening"]);
    }
    await sleep(500);
  }
  const t0 = Date.now();
  while (Date.now() - t0 < SEC * 1000) await sleep(1000);
  const snap = await page.evaluate(() => window.__syrinxDiag.snapshot());
  const frames = snap.frames.map((f) => ({ t: f.tEpochMs, intensity: f.intensity, pitch: f.pitch, confidence: f.confidence }));
  const out = { kind, captureKind: snap.audio?.captureKind, sampleRate: snap.audio?.sampleRate,
    granted: snap.audio?.grantedSettings ?? snap.audio?.granted ?? null, userAgent: snap.userAgent, frames };
  writeFileSync(path.join(OUT, `${kind}.json`), JSON.stringify(out));
  console.log(`${kind}: captureKind ${out.captureKind}, ${out.sampleRate} Hz, ${frames.length} frames -> ${path.join(OUT, `${kind}.json`)}`);
  await browser.close().catch(() => {}); closeBrowserHard();
}
cleanup();
