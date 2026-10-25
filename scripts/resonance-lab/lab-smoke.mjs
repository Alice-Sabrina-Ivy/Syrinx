// lab-smoke.mjs — headless smoke test of the resonance lab against the BUILT app
// (dist/, served by `vite preview`). The lab tab is shown only when Settings' "Show the
// Resonance lab (experimental)" is on (off by default since 2026-10-21; runs 2-5 switch it
// on in Settings); the lab itself starts only once the tab is opened.
//
//   npm run build && node scripts/resonance-lab/lab-smoke.mjs --wav=<48 kHz speech wav> [--seconds=40] [--shot=out.png]
//
// Run 1 (the setting left off, the default): asserts that there is no lab tab, that no lab
// chunk / worker / asset is requested and only the three production workers start (plus the
// gender worker of the "Likely heard as" panel, on by default since 2026-10-25). Run 2: opens the "Resonance lab" tab while
// listening, waits, prints the lab's readout text and saves a screenshot. Run 3: opens the
// tab BEFORE listening, then starts — the lab must start with the pipeline. Run 4: the lab
// on a phone (402x750 CSS px — an iPhone 16 Pro with Safari's toolbars showing; mobile
// emulation, DPR 3): the phone layout must show all four cards above the Stop Listening
// row with neither the lab area nor the page scrolling, and no horizontal overflow.
// Run 5: the experimental "Weight × clarity" view (measurements/weight-lab-prototype-2026-10-08.md):
// opens it, maps the voice (prompts advanced with Next / Done), waits for readings, checks
// that its model is fetched only then (runs 1-4 must never request weight_v5.json), prints
// the lab's cost with the weight analysis on, and checks the view at five viewports (no
// horizontal page overflow, the plot fully in the first screen; at least one readable bin
// after mapping, readable share reported; screenshots with --shot).
//
//   [--weight-map-seconds=75] [--weight-read-seconds=25]   run 5 timing
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
const WMAP_S = Number(arg("weight-map-seconds", "75"));
const WREAD_S = Number(arg("weight-read-seconds", "25"));
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

const isWeightAsset = (u) => /resonance-lab\/weight_v5\.json/.test(u);
const VIEWPORTS = [[448, 890, true], [402, 750, true], [360, 690, true], [890, 360, true], [1280, 800, false]];

async function run(url, { lab, tabFirst = false, viewport = null, wait = SECONDS, weight = false }) {
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
  // Settings' lab switch on (the tab is hidden by default); the profile keeps it.
  const enableLab = async () => {
    try {
      await page.waitForSelector('button[aria-label="Settings & Data"]', { timeout: 30000 });
      await page.evaluate(() => document.querySelector('button[aria-label="Settings & Data"]').click());
      await page.waitForSelector("[data-settings-lab-switch]", { timeout: 10000 });
      await page.evaluate(() => { const b = document.querySelector("[data-settings-lab-switch]"); if (b.getAttribute("aria-checked") !== "true") b.click(); });
      await page.waitForFunction(() => document.querySelector("[data-settings-lab-switch]")?.getAttribute("aria-checked") === "true", { timeout: 5000 });
      await page.evaluate(() => document.querySelector('button[aria-label="Close settings"]').click());
      return true;
    } catch { return false; }
  };
  let labTab = null;
  if (tabFirst) {
    // Get Started first if the welcome overlay is up, then the setting, the tab, then start.
    await clickText(["Get Started"]);
    await sleep(1000);
    log("lab switched on in Settings:", await enableLab());
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
  labTab = await page.evaluate(() => [...document.querySelectorAll("nav button")].some((b) => b.textContent.trim() === "Resonance lab"));
  if (lab && !tabFirst) log("lab switched on in Settings:", await enableLab());
  let weightOut = null;
  if (weight) {
    // The first-run training-direction dialog (if shown) would cover the screenshots:
    // pick the neutral "Just exploring" option and continue.
    const picked = await page.evaluate(() => {
      const l = [...document.querySelectorAll('[role="dialog"] label')].find((x) => x.textContent.includes("Just exploring"));
      if (l) l.click();
      return !!l;
    });
    if (picked) { await sleep(300); log("direction dialog dismissed:", await clickText(["Continue"])); await sleep(1500); }
    log("lab tab clicked:", await clickText(["Resonance lab"]));
    await sleep(3000);
    const before = requests.filter(isWeightAsset).length;
    log("weight view clicked:", await page.evaluate(() => { const b = document.querySelector('[data-lab-view="weight"]'); if (b) b.click(); return !!b; }));
    await page.waitForFunction(() => { const b = document.querySelector("[data-weight-map-start]"); return !!b && !b.disabled; }, { timeout: 20000 })
      .catch(() => log("map button not enabled (gain control?)"));
    const gain = await page.evaluate(() => (document.body.innerText.match(/Browser gain control: \w+/) ?? ["?"])[0]);
    log(gain);
    log("map clicked:", await page.evaluate(() => { const b = document.querySelector("[data-weight-map-start]"); if (b && !b.disabled) { b.click(); return true; } return false; }));
    for (let i = 0; i < 5; i++) {
      await sleep((WMAP_S / 5) * 1000);
      const label = await page.evaluate(() => document.querySelector("[data-weight-mapping]")?.innerText.split("\n")[0] ?? null);
      log("mapping:", label);
      await clickText(["Next", "Done"]);
    }
    await sleep(WREAD_S * 1000);
    const wtext = await page.evaluate(() => document.querySelector("[data-weight-view]")?.innerText ?? "");
    const counts = await page.evaluate(() => document.querySelector("[data-weight-view]")?.dataset.weightCounts ?? null);
    // lab cost with the weight analysis on: the resonance view's cost line
    await page.evaluate(() => document.querySelector('[data-lab-view="resonance"]')?.click());
    await sleep(800);
    const costOn = await page.evaluate(() => (document.body.innerText.match(/Lab cost here[^\n]*/) ?? [null])[0]);
    await page.evaluate(() => document.querySelector('[data-lab-view="weight"]')?.click());
    await sleep(800);
    const layouts = [];
    for (const [w, h, mobile] of VIEWPORTS) {
      // isMobile / hasTouch would make puppeteer reload the page (losing the map): size + DPR only
      await page.setViewport({ width: w, height: h, deviceScaleFactor: mobile ? 2 : 1 });
      await sleep(1200);
      const m = await page.evaluate(() => {
        // First screen: page and the lab's own scroll area at the top.
        window.scrollTo(0, 0);
        for (const el of document.querySelectorAll("[data-lab-phone]")) el.scrollTop = 0;
        const de = document.documentElement;
        const plot = document.querySelector("[data-weight-plot]")?.getBoundingClientRect();
        const axis = document.querySelector("[data-weight-axis-bottom]")?.getBoundingClientRect();
        const stop = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Stop Listening"))?.getBoundingClientRect();
        const layout = document.querySelector("[data-weight-view]")?.dataset.weightLayout ?? null;
        return { scrollW: de.scrollWidth, innerW: innerWidth, innerH: innerHeight, layout, stopTop: stop ? +stop.top.toFixed(0) : null,
          axisB: axis ? +axis.bottom.toFixed(0) : null,
          plot: plot ? { l: +plot.left.toFixed(0), r: +plot.right.toFixed(0), t: +plot.top.toFixed(0), b: +plot.bottom.toFixed(0), w: +plot.width.toFixed(0) } : null };
      });
      // Horizontally inside, and (2026-10-11 review) the whole plot visible in the
      // first screen (with its bottom axis word): below the top edge and above the
      // Stop Listening row.
      const floor = Math.min(m.innerH, m.stopTop ?? m.innerH);
      m.vertical = !!m.plot && m.plot.t >= -0.5 && Math.max(m.plot.b, m.axisB ?? 0) <= floor + 0.5;
      layouts.push({ vp: `${w}x${h}`, ...m, ok: m.scrollW <= m.innerW && !!m.plot && m.plot.r <= m.innerW + 0.5 && m.plot.l >= -0.5 && m.vertical });
      if (SHOT) await page.screenshot({ path: SHOT.replace(/(\.png)?$/i, `-weight-${w}x${h}.png`) });
    }
    weightOut = { before, after: requests.filter(isWeightAsset).length, wtext, costOn, layouts, gain, counts };
  } else if (lab) {
    if (!tabFirst) log("lab tab clicked:", await clickText(["Resonance lab"]));
    await sleep((tabFirst ? Math.min(wait, 20) : wait) * 1000);
  } else {
    await sleep(8000);
  }
  const text = await page.evaluate(() => document.body.innerText);
  const fit = viewport ? await page.evaluate(measurePhoneFit) : null;
  if (SHOT && lab) await page.screenshot({ path: viewport ? SHOT.replace(/(\.png)?$/i, "-phone.png") : SHOT, fullPage: !viewport });
  await page.close();
  return { requests, workers, errors, text, fit, weightOut, labTab };
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
// The Dashboard's resonance cue (production since 2026-10-07) loads three of the lab's
// assets itself; everything else under resonance-lab/ and every lab chunk is lab-only.
const CUE_ASSETS = /resonance-lab\/(reference|cue-bands|vtln_warp)\.json/;
const isLabRequest = (u) => /LabView|labPipeline|lab-worker|resonance-lab/.test(u) && !CUE_ASSETS.test(u);
const labHits = off.requests.filter(isLabRequest);
const offWorkers = off.workers.map((u) => u.split("/").pop());
console.log("TAB NOT OPENED: workers", offWorkers);
console.log("TAB NOT OPENED: lab requests", labHits.length ? labHits : "none");
console.log("TAB NOT OPENED: page errors", off.errors.length ? off.errors : "none");
console.log("SETTING OFF (default): lab tab shown", off.labTab);
// Three production workers, plus the "Likely heard as" panel's gender worker: the panel is on by
// default since 2026-10-25, so that worker starts with the others.
const offOk = off.labTab === false && labHits.length === 0 && !off.workers.some((u) => u.includes("lab-worker"))
  && off.workers.filter((u) => !u.includes("gender-worker")).length === 3 && off.workers.filter((u) => u.includes("gender-worker")).length === 1;

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
// The weight x clarity model is fetched only when its view is opened.
const weightNotFetched = ![off, on, first, phone].some((r) => r.requests.some(isWeightAsset));
console.log("WEIGHT MODEL requested without opening the weight view:", weightNotFetched ? "never" : "YES");
console.log("TAB OPENED (weight view never opened): " + (on.text.match(/Lab cost here[^\n]*/) ?? ["(no cost line)"])[0]);

const wv = await run(base, { lab: true, weight: true });
const W = wv.weightOut;
console.log("WEIGHT VIEW: page errors", wv.errors.length ? wv.errors : "none");
console.log(`WEIGHT VIEW: model requests before opening ${W.before}, after ${W.after}; ${W.gain}`);
console.log("WEIGHT VIEW: text:\n" + W.wtext.slice(0, 1800));
console.log("WEIGHT VIEW (weight analysis on): " + (W.costOn ?? "(no cost line)"));
console.log("WEIGHT VIEW: " + ((W.wtext.match(/Loudness check:[^\n]*/) ?? ["(no loudness check line)"])[0]));
console.log("WEIGHT VIEW: bin counts (bins / valid / readable / paused by reason)", W.counts);
for (const l of W.layouts) console.log(`WEIGHT VIEW ${l.vp}: ${l.ok ? "ok" : (l.vertical === false ? "PLOT NOT IN FIRST SCREEN" : "OVERFLOW")} ${JSON.stringify(l)}`);
// Readable share after mapping: readable / (readable + pauses other than "not mapped yet").
const wc = (() => { try { return JSON.parse(W.counts); } catch { return null; } })();
const pausedAfter = wc ? Object.entries(wc.paused).filter(([k]) => !/^Not mapped yet/.test(k)).reduce((a, [, v]) => a + v, 0) : 0;
const readable = wc?.readable ?? 0;
console.log(`WEIGHT VIEW: readable bins after mapping ${readable} of ${readable + pausedAfter} (${readable + pausedAfter ? ((100 * readable) / (readable + pausedAfter)).toFixed(0) : "—"} %)`);
const weightOk = wv.errors.length === 0 && W.before === 0 && W.after >= 1 && weightNotFetched
  && readable >= 1
  && /Experimental — not a measurement of vocal-fold weight or contact/.test(W.wtext)
  && /Your map: [1-9]/.test(W.wtext)
  && /What this can and can't tell you/.test(W.wtext)
  && W.layouts.every((l) => l.ok);

await browser.close();
browser = null;
console.log(`\nisolation until the tab is opened: ${offOk ? "PASS" : "FAIL"}; lab live after opening: ${onOk ? "PASS" : "FAIL"}; tab opened before listening: ${firstOk ? "PASS" : "FAIL"}; four cards fit on a ${PHONE.width}x${PHONE.height} phone: ${phoneOk ? "PASS" : "FAIL"}; weight x clarity view (model on demand, mapped, five viewports): ${weightOk ? "PASS" : "FAIL"}`);
cleanup(); // the preview server child would otherwise keep the event loop alive
process.exit(offOk && onOk && firstOk && phoneOk && weightOk ? 0 : 1);
