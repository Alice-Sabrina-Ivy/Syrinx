// panel-shots.mjs — screenshots of the "Likely heard as" panel in chosen
// states, in the BUILT app (dist/, served by `vite preview`), at the phone
// and desktop viewports, in the dark and light colour schemes (the app is
// dark in both — the light shots check that nothing switches with the OS
// scheme). States are forced with scripts/heard-as/panel-force.mjs (the
// panel's real drawing path; no network, the voice model is never fetched).
//
//   npm run build && node scripts/heard-as/panel-shots.mjs [--out=build/heard-as-panel-shots]
//        [--states=mostly-man,mixed,...] [--viewports=p360,p448,desktop] [--schemes=dark,light]
//        [--forced-colors=1] [--css=<extra css to inject, e.g. to hide a part>] [--suffix=]
//
// Writes <out>/<viewport>-<scheme>-<state>.png (the viewport, panel centred)
// and <out>/panel-boxes.json (the panel's height and the practice dock's
// top per state — the one-height check is in lab-layout-smoke.mjs).
//
// Process hygiene (CLAUDE.md hard rule 2): Chrome is launched by puppeteer with
// a fresh temporary --user-data-dir and closed via browser.close(), falling
// back to taskkill of ITS pid only; the preview server is this script's own
// child, killed only by its PID. Cleanup runs on exit / SIGINT / SIGTERM /
// uncaughtException.

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { PANEL_STATES, CHROME_BLOCK_MODEL_ARGS, installPanelForce, forcePanel } from "./panel-force.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const OUT = arg("out", path.join(repo, "build", "heard-as-panel-shots"));
const PORT = Number(arg("port", "4195"));
const STATES = arg("states", Object.keys(PANEL_STATES).join(",")).split(",").filter(Boolean);
const SCHEMES = arg("schemes", "dark,light").split(",").filter(Boolean);
const FORCED = arg("forced-colors", "0") === "1";
const CSS = arg("css", "");
const SUFFIX = arg("suffix", "");
const ALL_VIEWPORTS = {
  p360: { width: 360, height: 690, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  p448: { width: 448, height: 890, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
};
const VIEWPORTS = Object.fromEntries(arg("viewports", Object.keys(ALL_VIEWPORTS).join(",")).split(",").map((k) => [k, ALL_VIEWPORTS[k]]));
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!CHROME || !existsSync(path.join(repo, "dist", "index.html"))) { console.error("need Chrome and a build (npm run build)"); process.exit(2); }
for (const s of STATES) if (!PANEL_STATES[s]) { console.error(`unknown state ${s}; known: ${Object.keys(PANEL_STATES).join(", ")}`); process.exit(2); }
mkdirSync(OUT, { recursive: true });

let server = null, browser = null;
const profile = mkdtempSync(path.join(tmpdir(), "heard-as-panel-shots-"));
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
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

server = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: "ignore" });
for (let i = 0; ; i++) {
  try { const r = await fetch(`http://localhost:${PORT}/Syrinx/`); if (r.ok) break; } catch { /* not yet */ }
  if (i > 300) throw new Error("preview server did not start");
  await sleep(200);
}

browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: profile,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", ...CHROME_BLOCK_MODEL_ARGS],
});

const clickText = (page, texts, scope = "") => page.evaluate((ts, scope) => {
  const root = scope ? document.querySelector(scope) : document;
  const b = [...(root?.querySelectorAll("button") ?? [])].find((x) => ts.some((t) => x.textContent.trim().includes(t)));
  if (b) b.click();
  return !!b;
}, texts, scope);
async function startListening(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    const s = await page.evaluate(() => ({ text: document.body.innerText, dialog: !!document.querySelector("[role=dialog] input[data-direction]") }));
    if (s.dialog) {
      await page.evaluate(() => document.querySelector('[role=dialog] input[data-direction="exploring"]')?.closest("label")?.click());
      await sleep(200);
      await clickText(page, ["Continue"], "[role=dialog]");
    } else if (s.text.includes("Mic off")) return true;
    else await clickText(page, ["Get Started", "Start Listening"]);
    await sleep(700);
  }
  return false;
}

const boxes = {};
let failed = 0;
for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.goto(`http://localhost:${PORT}/Syrinx/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.bringToFront();
  if (!(await startListening(page))) { console.log(`FAIL  [${vp}] listening`); failed++; await page.close(); continue; }
  await page.waitForSelector("[data-heard-as]", { timeout: 20000 });   // on by default since 2026-10-25
  // The blocked download fails fast; wait for the worker to settle.
  await page.waitForFunction(() => ["error", "ready"].includes(document.querySelector("[data-heard-as]")?.dataset.modelWorker), { timeout: 90000 }).catch(() => {});
  const inst = await installPanelForce(page);
  if (!inst.ok) { console.log(`FAIL  [${vp}] force: ${inst.why}`); failed++; await page.close(); continue; }
  if (CSS) await page.addStyleTag({ content: CSS });
  for (const scheme of SCHEMES) {
    const feats = [{ name: "prefers-color-scheme", value: scheme }];
    if (FORCED) feats.push({ name: "forced-colors", value: "active" });
    await cdp.send("Emulation.setEmulatedMedia", { features: feats }); // (puppeteer's emulateMediaFeatures rejects forced-colors)
    for (const name of STATES) {
      await forcePanel(page, PANEL_STATES[name]);
      await sleep(350);
      const b = await page.evaluate(() => {
        const p = document.querySelector("[data-heard-as]");
        p?.scrollIntoView({ block: "center" });
        const r = p?.getBoundingClientRect(), s = document.querySelector("[data-practice-dock]")?.getBoundingClientRect();
        return { panelH: r ? Math.round(r.height * 100) / 100 : null, rowTop: s ? Math.round((s.top - r.top) * 100) / 100 : null,
          reason: p?.dataset.reason ?? null, mode: p?.dataset.heardAs ?? null };
      });
      await sleep(150);
      const file = path.join(OUT, `${vp}-${scheme}${FORCED ? "-forced" : ""}-${name}${SUFFIX}.png`);
      await page.screenshot({ path: file });
      (boxes[vp] ??= {})[`${scheme}:${name}`] = b;
      log(`[${vp}] ${scheme} ${name}: ${b.mode}/${b.reason || "-"} panel ${b.panelH} px, row +${b.rowTop}`);
    }
  }
  await page.close();
}
writeFileSync(path.join(OUT, `panel-boxes${SUFFIX}.json`), JSON.stringify(boxes, null, 1));
await browser.close().catch(() => {});
cleanup();
console.log(`screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
