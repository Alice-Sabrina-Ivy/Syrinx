// start-reference-browser.mjs — the resonance row's start reference in the
// BUILT app (measurements/resonance-start-reference-2026-10-26.md).
//
//   npm run build && node scripts/cue-strip-smoke-wavs.mjs --r1=<jobs> &&
//   node scripts/resonance/start-reference-browser.mjs --wav=<absolute 48 kHz wav> [--seconds=90]
//        [--chrome=<path>] [--port=4193] [--viewport=desktop|phone] [--out=<json>]
//
// Serves dist/ with `vite preview`, launches Chrome on a fresh profile with
// the fake mic playing --wav (Chrome loops it), answers the first-visit
// direction question as cue-strip-smoke.mjs part 1 does (masculine, the
// "Likely heard as" panel on by default), then every 0.5 s of wall time
// records the resonance row (data-state, header text) and the resonance
// worker's latest `state` / `status` posts (startU, shownStartU, …) (a wrapper around window.Worker
// installed before the app loads: it only listens). Prints the time the row
// first goes live, the first start-relative word, the time startU is first
// set and the header then.
// Cleanup kills only the PIDs it spawned (CLAUDE.md hard rule 2).

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const WAV = arg("wav", "");
const SECONDS = Number(arg("seconds", "90"));
const PORT = Number(arg("port", "4193"));
const CHROME = arg("chrome", "") || ["/opt/pw-browsers/chromium-1243/chrome-linux64/chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!WAV || !path.isAbsolute(WAV) || !existsSync(WAV) || !CHROME) { console.error("need --wav=<absolute path> and Chrome"); process.exit(2); }
const VIEWPORT = arg("viewport", "desktop") === "phone"
  ? { width: 448, height: 890, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
  : { width: 1280, height: 800, deviceScaleFactor: 1 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(path.join(tmpdir(), "rstart-"));
let server = null, browser = null;
function killPid(pid) {
  if (!pid) return;
  if (process.platform === "win32") { try { spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } }
  else { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
}
function cleanup() {
  killPid(server?.pid); server = null;
  killPid(browser?.process?.()?.pid); browser = null;
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
}
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });

server = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: "ignore" });
for (let i = 0; i < 300; i++) {
  try { const r = await fetch(`http://localhost:${PORT}/Syrinx/`); if (r.ok) break; } catch { /* not yet */ }
  await sleep(200);
}
browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: profile,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${WAV}`, "--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport(VIEWPORT);
const cdp = await page.createCDPSession();
await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await page.evaluateOnNewDocument(() => {
  window.__res = { state: null, statuses: [] };
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(url, opts) {
      super(url, opts);
      if (String(url).includes("resonance-worker")) {
        this.addEventListener("message", (e) => {
          const m = e.data;
          if (m?.type === "state") window.__res.state = m;
          else if (m?.type === "status") window.__res.statuses.push({ t: performance.now(), status: m.status });
        });
      }
    }
  };
});
await page.goto(`http://localhost:${PORT}/Syrinx/`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.bringToFront();
await page.waitForFunction(() => !!document.querySelector("[data-dialog=direction]"), { timeout: 60000 });
await page.evaluate(async () => {
  const root = document.querySelector("[role=dialog]");
  root.querySelector('input[data-direction="masculine"]')?.closest("label").click();
  await new Promise((r) => setTimeout(r, 100));
  [...root.querySelectorAll("button")].find((b) => /Start — allow the microphone|Start practicing/.test(b.textContent))?.click();
});
await page.waitForFunction(() => document.body.innerText.includes("Mic off"), { timeout: 20000 });
const t0 = Date.now();
const log = [];
let tLive = null, tStart = null, headerAtStart = null, tWord = null;
const WORDS = /^(about where you started|brighter than your start|darker than your start)$/;
while (Date.now() - t0 < SECONDS * 1000) {
  const s = await page.evaluate(() => {
    const el = document.querySelector('[data-cue="resonance"]');
    const st = window.__res.state;
    return {
      row: el?.dataset.state ?? null, header: el?.querySelector("[data-cue-value]")?.textContent ?? "",
      voicedS: st?.voicedS ?? null, fill: st?.fill ?? null, startU: st?.startU ?? null, shownStartU: st?.shownStartU ?? null, startProgress: st?.startProgress ?? null,
      verdict: st?.verdict ?? null, nb: st?.narrowband?.on ?? null, statuses: window.__res.statuses.map((x) => x.status).join(","),
    };
  });
  const t = (Date.now() - t0) / 1000;
  log.push({ t: +t.toFixed(1), ...s });
  if (tLive === null && s.row === "live") tLive = t;
  if (tWord === null && WORDS.test(s.header)) tWord = t;
  if (tStart === null && s.startU !== null) { tStart = t; headerAtStart = s.header; }
  await sleep(500);
}
const last = log[log.length - 1];
console.log(`row live at ${tLive?.toFixed(1)} s; first start-relative word at ${tWord?.toFixed(1) ?? "never"} s; startU set at ${tStart?.toFixed(1) ?? "never"} s (header then "${headerAtStart}"); at ${last.t} s: row ${last.row}, "${last.header}", voicedS ${last.voicedS?.toFixed(1)}, startProgress ${last.startProgress?.toFixed(2)}; worker statuses ${last.statuses}`);
for (const k of [10, 20, 25, 30, 40, 50, 60, 75, 90]) {
  const r = log.find((x) => x.t >= k);
  if (r) console.log(`  ${k} s: row ${r.row}, "${r.header}", fill ${r.fill?.toFixed(2)}, voicedS ${r.voicedS?.toFixed(1)}, startProgress ${r.startProgress?.toFixed(2)}`);
}
if (arg("out", "")) writeFileSync(arg("out", ""), JSON.stringify({ wav: path.basename(WAV), tLive, tWord, tStart, log }, null, 1));
cleanup();
process.exit(0);
