// probe.mjs — what the Dashboard's live HNR readout shows in the built app
// (measurements/hnr-readout-2026-11-02.md). Serves dist/ with `vite preview`,
// opens it in a headless Chrome with its own temp profile and a fake mic
// playing <wav>, picks the goal, starts listening and samples the readout
// ([data-cue-hnr]) and the cue-strip row states every 250 ms for 72 s.
// Kills only the PIDs it started (CLAUDE.md hard rule 2).
//
//   npm run build && node scripts/hnr-readout/probe.mjs --wav=<abs path> --goal=feminine --out=<dir> [--port=4325]
//   node scripts/hnr-readout/stats.cjs <dir>
import puppeteer from "puppeteer-core";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const WAV = arg("wav", ""), GOAL = arg("goal", "feminine"), OUT = path.resolve(arg("out", "build/hnr-readout/run")), PORT = arg("port", "4325");
const NAME = path.basename(WAV, ".wav");
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!WAV || !existsSync(WAV) || !CHROME) { console.error("need --wav=<absolute path> and Chrome"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

let server = null, browser = null;
const profile = mkdtempSync(path.join(tmpdir(), "hnr-probe-"));
function cleanup() {
  const bp = browser?.process?.()?.pid;
  if (bp) { try { execFileSync("taskkill", ["/pid", String(bp), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } }
  browser = null;
  if (server?.pid) { try { execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } server = null; }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
}
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

server = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "preview", "--port", PORT, "--strictPort"], { cwd: repo, stdio: "ignore" });
for (let i = 0; i < 300; i++) { try { const r = await fetch(`http://localhost:${PORT}/Syrinx/`); if (r.ok) break; } catch { /* not yet */ } await sleep(200); }
browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: profile,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}`, "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
await page.setViewport({ width: 448, height: 890, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const cdp = await page.createCDPSession();
await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await page.goto(`http://localhost:${PORT}/Syrinx/`, { waitUntil: "networkidle2", timeout: 120000 });
await sleep(1500);
await page.evaluate((id) => { document.querySelector(`input[data-direction="${id}"]`).closest("label").click(); }, GOAL);
await sleep(300);
await page.click("[data-start-listening]");
const samples = [];
const t0 = Date.now();
while (Date.now() - t0 < 72000) {
  samples.push(await page.evaluate(() => ({
    hnr: document.querySelector("[data-cue-hnr]")?.textContent ?? null,
    pitch: document.querySelector("[data-cue=pitch]")?.dataset.state,
    res: document.querySelector("[data-cue=resonance]")?.dataset.state,
  })));
  await sleep(250);
}
writeFileSync(path.join(OUT, `${NAME}.json`), JSON.stringify({ wav: path.basename(WAV), goal: GOAL, samples, errors }));
console.log("wrote", path.join(OUT, `${NAME}.json`), `${samples.length} samples, ${errors.length} page errors`);
cleanup();
process.exit(0);
