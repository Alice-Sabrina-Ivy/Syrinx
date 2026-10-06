// lab-smoke.mjs — headless smoke test of the resonance lab against the BUILT app
// (dist/, served by `vite preview`). The lab tab is visible to everyone; the lab
// itself starts only once the tab is opened.
//
//   npm run build && node scripts/resonance-lab/lab-smoke.mjs --wav=<48 kHz speech wav> [--seconds=40] [--shot=out.png]
//
// Run 1 (tab never opened): asserts that no lab chunk / worker / asset is requested and
// only the three production workers start. Run 2: opens the "Resonance lab" tab while
// listening, waits, prints the lab's readout text and saves a screenshot. Run 3: opens the
// tab BEFORE listening, then starts — the lab must start with the pipeline. Run 4: the lab
// on a phone (402x750 CSS px — an iPhone 16 Pro with Safari's toolbars showing; mobile
// emulation, DPR 3): the phone layout must show all four cards above the Stop Listening
// row with neither the lab area nor the page scrolling, and no horizontal overflow.
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
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/Syrinx/`); if (r.ok) return; } catch { /* not yet */ }
    await sleep(200);
  }
  throw new Error("preview server did not start");
}

// Runs in the page: does the phone lab fit? (the lab's own scroll area, each card vs the
// top of the Stop Listening row, page overflow both ways)
function measurePhoneFit() {
  const area = document.querySelector("[data-lab-phone]");
  const cards = [...document.querySelectorAll("[data-lab-phone] section")];
  const stop = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Stop Listening"));
  const barTop = stop ? stop.parentElement.getBoundingClientRect().top : null;
  const de = document.documentElement;
  return {
    phoneLayout: !!area,
    area: area && { scrollH: area.scrollHeight, clientH: area.clientHeight },
    barTop,
    cardBottoms: cards.map((c) => +c.getBoundingClientRect().bottom.toFixed(1)),
    doc: { scrollH: de.scrollHeight, innerH: innerHeight, scrollW: de.scrollWidth, innerW: innerWidth },
  };
}

async function run(url, { lab, tabFirst = false, viewport = null, wait = SECONDS }) {
  const page = await browser.newPage();
  if (viewport) await page.setViewport(viewport);
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
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.bringToFront();
  const clickText = async (texts) => page.evaluate((ts) => {
    const b = [...document.querySelectorAll("button")].find((x) => ts.some((t) => x.textContent.includes(t)));
    if (b) b.click();
    return !!b;
  }, texts);
  if (tabFirst) {
    // Get Started first if the welcome overlay is up, then the tab, then start.
    await clickText(["Get Started"]);
    await sleep(1000);
    log("lab tab clicked before listening:", await clickText(["Resonance lab"]));
    await sleep(1500);
  }
  // click until the pipeline is running (a click before hydration is a no-op)
  let running = false;
  for (let attempt = 0; attempt < 5 && !running; attempt++) {
    log("start clicked:", await clickText(["Get Started", "Start Listening"]));
    running = await page.waitForFunction(() => document.body.innerText.includes("Stop Listening"), { timeout: 4000 })
      .then(() => true, () => false);
  }
  log("pipeline running:", running);
  await sleep(1500);
  if (lab) {
    if (!tabFirst) log("lab tab clicked:", await clickText(["Resonance lab"]));
    await sleep((tabFirst ? Math.min(wait, 20) : wait) * 1000);
  } else {
    await sleep(8000);
  }
  const text = await page.evaluate(() => document.body.innerText);
  const fit = viewport ? await page.evaluate(measurePhoneFit) : null;
  if (SHOT && lab) await page.screenshot({ path: viewport ? SHOT.replace(/(\.png)?$/i, "-phone.png") : SHOT, fullPage: !viewport });
  await page.close();
  return { requests, workers, errors, text, fit };
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
console.log("TAB NOT OPENED: workers", offWorkers);
console.log("TAB NOT OPENED: lab requests", labHits.length ? labHits : "none");
console.log("TAB NOT OPENED: page errors", off.errors.length ? off.errors : "none");
const offOk = labHits.length === 0 && off.workers.length === 3 && !off.workers.some((u) => u.includes("lab-worker"));

const on = await run(base, { lab: true });
console.log("TAB OPENED: workers", on.workers.map((u) => u.split("/").pop()));
console.log("TAB OPENED: lab requests", on.requests.filter((u) => /LabView|labPipeline|lab-worker|resonance-lab/.test(u)).map((u) => u.replace(base, "")));
console.log("TAB OPENED: page errors", on.errors.length ? on.errors : "none");
const i = on.text.indexOf("Resonance lab");
console.log("TAB OPENED: lab view text:\n" + on.text.slice(i, i + 2500));
console.log("TAB OPENED: " + (on.text.match(/Lab cost here[^\n]*/) ?? ["(no cost line yet)"])[0]);
const onOk = on.workers.some((u) => u.includes("lab-worker")) && /Pitch \d+ Hz|Voiced so far [1-9]/.test(on.text);

const first = await run(base, { lab: true, tabFirst: true });
console.log("TAB FIRST: workers", first.workers.map((u) => u.split("/").pop()));
console.log("TAB FIRST: page errors", first.errors.length ? first.errors : "none");
const firstOk = first.workers.some((u) => u.includes("lab-worker")) && /Pitch \d+ Hz|Voiced so far [1-9]/.test(first.text);

const PHONE = { width: 402, height: 750, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const phone = await run(base, { lab: true, viewport: PHONE, wait: Math.min(SECONDS, 30) });
const f = phone.fit;
console.log(`PHONE ${PHONE.width}x${PHONE.height}: page errors`, phone.errors.length ? phone.errors : "none");
console.log(`PHONE ${PHONE.width}x${PHONE.height}: fit`, JSON.stringify(f));
const phoneOk = f.phoneLayout && f.cardBottoms.length === 4 && f.barTop !== null
  && f.area.scrollH <= f.area.clientH + 1 // the lab area does not scroll
  && f.cardBottoms.every((b) => b <= f.barTop + 0.5) // every card ends above the Stop Listening row
  && f.doc.scrollH <= f.doc.innerH + 1 && f.doc.scrollW <= f.doc.innerW // nor does the page, either way
  && /Voiced so far [1-9]/.test(phone.text);
await browser.close();
browser = null;
console.log(`\nisolation until the tab is opened: ${offOk ? "PASS" : "FAIL"}; lab live after opening: ${onOk ? "PASS" : "FAIL"}; tab opened before listening: ${firstOk ? "PASS" : "FAIL"}; four cards fit on a ${PHONE.width}x${PHONE.height} phone: ${phoneOk ? "PASS" : "FAIL"}`);
cleanup(); // the preview server child would otherwise keep the event loop alive
process.exit(offOk && onOk && firstOk && phoneOk ? 0 : 1);
