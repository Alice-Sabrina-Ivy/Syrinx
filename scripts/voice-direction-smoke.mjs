// voice-direction-smoke.mjs — headless check of the training-direction
// question and the Perceived Voice meter fixes against the BUILT app
// **Historical (superseded 2026-10-07):** its Dashboard checks (Perceived
// Voice meter, vocal-weight gauge, F2 / stats row) target the dashboard the
// cue strip replaced; scripts/cue-strip-smoke.mjs checks the current one.
// (dist/, served by `vite preview`), with Chrome's fake mic playing a WAV.
//
//   npm run build && node scripts/voice-direction-smoke.mjs --speech=<wav> --held=<wav> \
//     --noise=<wav> --silence=<wav> --out=<dir> [--viewport=desktop|phone|landscape]
//
// One fresh profile per run; Chrome is relaunched (same profile) for each
// WAV because the fake-capture file is a launch flag:
//   1 speech  first visit: welcome (a modal, focus on Get Started), then
//             the question with nothing preselected — a real modal: the
//             page behind is inert (Tab, clicks on Start Listening / the
//             gear do nothing), the focused option shows an outline,
//             Escape needs an answer; pick "More masculine", Continue
//             starts listening; Settings mid-session (focus moves in,
//             Escape closes it and returns focus to the gear) — the pitch
//             band must follow at once (canvas data-target), "Just
//             exploring" must draw none; F0 colour judges the pitch level;
//             vocal weight: after calibration the heavier-side zone under
//             "More masculine", the lighter side under "More feminine",
//             none for androgynous / exploring, the pitch-confound note
//             whenever a zone is in effect, nothing clipped or overflowing
//             (gauge screenshots 04b / 07b / 07c / 08b);
//             History: old sessions neutral, a changed session lists its
//             goals in order; reload: the question again, last choice
//             preselected, Continue confirms and starts listening (one
//             tap); another reload: Escape confirms without the mic.
//   2 held    a held vowel: the meter must show "needs running speech",
//             not a number, for most of the hold.
//   3 noise   / 4 silence: the meter must show no number.
// The meter's speech detector is checked too: on the first visit its
// model is downloaded from SPEECH_DETECTOR.modelUrl (src/ml/speech-
// detector.js; HF answers 302 and the CDN 200, so the check follows the
// redirect chain); on the reload and in runs 2-4 (a new browser process
// on the same profile) it is read from Cache Storage, with no download.
// With --diag=1 the app is opened with ?diag=1: run 1 also reads the
// diag snapshot (detector "ready", from the network, and it ran) and
// prints inference + detector time per back-to-back hop (R3 of
// measurements/low-voice-noise-2026-10-07.md); runs 2-4 check the
// recorded source is "cache".
// --viewport=landscape (890 x 360, a phone held sideways with its browser
// bars): only the welcome and the question — both must scroll so their
// buttons can be reached.
// Screenshots go to <out>/<viewport>/.
//
// Process hygiene (CLAUDE.md hard rule 2): Chrome is launched by puppeteer
// with a temporary --user-data-dir and closed via browser.close(), falling
// back to taskkill of ITS pid only; the preview server is this script's
// own child, killed only by its PID. Cleanup runs on exit / SIGINT /
// SIGTERM / uncaughtException.

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { SPEECH_DETECTOR } from "../src/ml/speech-detector.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const WAV = { speech: arg("speech", ""), held: arg("held", ""), noise: arg("noise", ""), silence: arg("silence", "") };
const VIEWPORT = arg("viewport", "desktop");
const DIAG = arg("diag", "0") === "1";
const OUT = path.join(arg("out", path.join(tmpdir(), "voice-direction-smoke")), VIEWPORT);
const PORT = 4189;
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!CHROME || Object.values(WAV).some((w) => !w)) { console.error("need Chrome and --speech/--held/--noise/--silence"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

// Pixel 8 Pro visible area (CSS px) / the same phone in landscape with its
// browser bars / a laptop window.
const VIEWPORTS = {
  phone: { width: 448, height: 890, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  landscape: { width: 890, height: 360, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
};

let server = null;
let browser = null;
const profile = mkdtempSync(path.join(tmpdir(), "voice-direction-smoke-"));
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
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  [${VIEWPORT}] ${name}${detail ? `  (${detail})` : ""}`);
};

async function startServer() {
  server = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: "ignore" });
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/Syrinx/`); if (r.ok) return; } catch { /* not yet */ }
    await sleep(200);
  }
  throw new Error("preview server did not start");
}

async function launch(wav) {
  if (browser) { await browser.close().catch(() => {}); closeBrowserHard(); }
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: profile,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
  });
}

async function open() {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORTS[VIEWPORT]);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  // Speech-detector model downloads (the gender worker's; Puppeteer
  // reports dedicated-worker requests on the page). `start` = the URL that
  // began the redirect chain (HF: modelUrl -> 302 -> CDN 200, and the CDN
  // URL also names silero_vad.onnx in a query parameter).
  const vadFetches = [];
  page.on("response", (r) => {
    const chain = r.request().redirectChain();
    const start = chain.length ? chain[0].url() : r.url();
    if (/silero_vad[^/]*\.onnx/.test(r.url()) || /silero_vad[^/]*\.onnx/.test(start)) vadFetches.push({ start, url: r.url(), status: r.status() });
  });
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.goto(`http://localhost:${PORT}/Syrinx/${DIAG ? "?diag=1" : ""}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.bringToFront();
  return { page, errors, vadFetches };
}
// The detector model was downloaded from the pinned URL: every fetch
// chain starts there, and one ends in HTTP 200.
const vadFetchedOk = (f) => f.length > 0 && f.every((x) => x.start === SPEECH_DETECTOR.modelUrl) && f.some((x) => x.status === 200);
const diagModel = (page) => page.evaluate(() => window.__syrinxDiag?.snapshot()?.mlModel ?? null);
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : null; };

const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
// The live-stats row (F0 | F2 + vocal weight | HNR + the weight note),
// with a margin; `above` px more on top for the explainer popover.
const shotStats = async (page, name, above = 0) => {
  const r = await page.evaluate(() => {
    const el = document.querySelector("[data-live-stats]");
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  if (!r) return;
  const vp = page.viewport();
  const x = Math.max(0, r.x - 12), y = Math.max(0, r.y - 12 - above);
  await page.screenshot({ path: path.join(OUT, `${name}.png`),
    clip: { x, y, width: Math.min(vp.width - x, r.width + 24), height: Math.min(vp.height - y, r.height + 24 + above) } });
};
// Vocal-weight gauge state: zone side, calibrated, drawn band, the note,
// and whether anything is clipped or overflows the viewport.
const weightInfo = (page) => page.evaluate(() => {
  const g = document.querySelector("[data-weight-zone]");
  if (!g) return null;
  const band = g.querySelector("[data-weight-zone-band]");
  const note = document.querySelector("[data-weight-note]");
  const labels = g.querySelector("[data-weight-labels]");
  const nr = note?.getBoundingClientRect();
  const lr = labels?.getBoundingClientRect();
  return {
    zone: g.dataset.weightZone,
    ready: g.dataset.weightReady === "1",
    band: band ? { left: parseFloat(band.style.left), width: parseFloat(band.style.width) } : null,
    note: note?.textContent ?? null,
    noteLines: nr ? Math.round(nr.height / parseFloat(getComputedStyle(note).lineHeight)) : 0,
    noteInView: nr ? nr.left >= 0 && nr.right <= innerWidth : null,
    noteClipped: note ? note.scrollWidth > note.clientWidth + 1 : null,
    labelsClipped: labels ? labels.scrollWidth > labels.clientWidth + 1 : null,
    labelsInView: lr ? lr.left >= 0 && lr.right <= innerWidth : null,
    pageOverflowX: document.documentElement.scrollWidth > innerWidth,
    noteBottom: nr ? Math.round(nr.bottom + scrollY) : null,
    pageHeight: document.documentElement.scrollHeight,
    vh: innerHeight,
  };
});
const layoutOk = (w) => w && !w.pageOverflowX && !w.labelsClipped && w.labelsInView
  && (w.note == null || (!w.noteClipped && w.noteInView));
async function waitWeightReady(page, ms = 150000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const w = await weightInfo(page);
    if (w?.ready) return true;
    await sleep(1000);
  }
  return false;
}
const clickButton = (page, texts) => page.evaluate((ts) => {
  const b = [...document.querySelectorAll("button")].find((x) => ts.some((t) => x.textContent.trim().includes(t)));
  if (b) b.click();
  return !!b;
}, texts);
// Picks a direction in the question or the settings panel.
const pickDirection = (page, id, scope = "[role=dialog]") => page.evaluate((id, scope) => {
  const root = scope ? document.querySelector(scope) : document;
  const input = root?.querySelector(`input[data-direction="${id}"]`);
  if (!input) return false;
  input.closest("label").click();
  return true;
}, id, scope);
const promptState = (page) => page.evaluate(() => {
  const dlg = document.querySelector("[role=dialog]");
  if (!dlg || !dlg.textContent.includes("What are you trying to sound like?")) return null;
  const checked = dlg.querySelector("input[type=radio]:checked");
  const cont = [...dlg.querySelectorAll("button")].find((b) => b.textContent.includes("Continue"));
  return { checked: checked?.dataset.direction ?? null, continueEnabled: !!cont && !cont.disabled,
    continueFocused: document.activeElement === cont };
});
const pitchTarget = (page) => page.evaluate(() => {
  const c = [...document.querySelectorAll("canvas[data-target]")];
  return c.map((x) => x.dataset.target);
});
const meter = (page) => page.evaluate(() => {
  const c = [...document.querySelectorAll("canvas")].find((x) => (x.getAttribute("aria-label") ?? "").startsWith("Perceived voice"));
  return c ? { status: c.dataset.status ?? null, score: c.dataset.score ?? "", label: c.getAttribute("aria-label") } : null;
});
const readoutClass = (page, label) => page.evaluate((label) => {
  const lab = [...document.querySelectorAll("span")].find((s) => s.textContent.trim() === label);
  const val = lab?.nextElementSibling;
  return val ? val.className : null;
}, label);

// The open dialog, where focus is, whether the page behind is inert.
const dialogInfo = (page) => page.evaluate(() => {
  const d = document.querySelector("[role=dialog]");
  const a = document.activeElement;
  const lab = a?.closest("label");
  return {
    dialog: d?.dataset.dialog ?? null,
    modal: d?.getAttribute("aria-modal") === "true",
    inert: !!document.querySelector("header")?.inert,
    focus: (a?.getAttribute("aria-label") || a?.textContent || a?.tagName || "").trim().slice(0, 40),
    focusDirection: a?.dataset?.direction ?? null,
    focusOutline: lab ? getComputedStyle(lab).outlineStyle : null,
  };
});
// Adds two sessions recorded before training directions existed (no
// direction log; stored figures from the old fixed feminising range) and
// one whose direction changed and returned, straight into IndexedDB.
const injectSessions = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open("syrinx");
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const idb = req.result;
    const tx = idb.transaction("sessions", "readwrite");
    const store = tx.objectStore("sessions");
    const t = Date.now() - 86400000;
    const base = { sessionType: "freeform", notes: "", avgF1: 500, avgF3: 2700, avgSpectralTilt: 5, avgHnr: 15, pitchStdev: 20 };
    store.add({ ...base, startedAt: t, endedAt: t + 300000, durationSeconds: 300, avgF0: 205, medianF0: 204, avgF2: 1820, medianF2: 1790,
      pitchRangeLow: 170, pitchRangeHigh: 250, pctTimeInPitchTarget: 82, pctTimeInResonanceTarget: 63, voicedDurationSeconds: 150 });
    store.add({ ...base, startedAt: t + 400000, endedAt: t + 700000, durationSeconds: 300, avgF0: 115, medianF0: 114, avgF2: 1500, medianF2: 1480,
      pitchRangeLow: 95, pitchRangeHigh: 150, pctTimeInPitchTarget: 4, pctTimeInResonanceTarget: 41, voicedDurationSeconds: 140 });
    store.add({ ...base, startedAt: t + 800000, endedAt: t + 1100000, durationSeconds: 300, avgF0: 190, medianF0: 188, avgF2: 1700, medianF2: 1680,
      pitchRangeLow: 160, pitchRangeHigh: 240, pctTimeInPitchTarget: 75, pctVoicedWithPitchTarget: 57, pctTimeInResonanceTarget: null,
      voicedDurationSeconds: 150, directionLog: [{ atMs: 0, direction: "feminine" }, { atMs: 60000, direction: "exploring" },
        { atMs: 180000, direction: "feminine" }] });
    tx.oncomplete = () => { idb.close(); window.dispatchEvent(new CustomEvent("syrinx:data-changed")); resolve(true); };
    tx.onerror = () => reject(tx.error);
  };
}));
// Class of each session card's first percentage, and the goal line.
const historyInfo = (page) => page.evaluate(() => {
  const cards = [...document.querySelectorAll("button")].filter((b) => /Pitch (in|on) /.test(b.textContent));
  const pctClass = (card) => [...card.querySelectorAll("span")].find((s) => /^\d+%$/.test(s.textContent.trim()))?.className ?? null;
  const legacy = cards.filter((c) => c.textContent.includes("Pitch in 165–255 Hz")).map(pctClass);
  const cur = cards.find((c) => c.textContent.includes("Goal:"));
  return { legacy, current: cur ? pctClass(cur) : null,
    goal: cur ? [...cur.querySelectorAll("p")].find((p) => p.textContent.startsWith("Goal:"))?.textContent ?? null : null,
    text: cur?.textContent ?? "" };
});

async function f0WhileVoiced(page, ms = 8000) {
  const t0 = Date.now();
  let cls = null;
  while (Date.now() - t0 < ms) {
    cls = await readoutClass(page, "F0");
    if (cls && !/text-neutral-600/.test(cls)) return cls;
    await sleep(100);
  }
  return cls;
}

async function waitModel(page, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const m = await meter(page);
    if (m && m.status && !["loading"].includes(m.status) && !/loading/.test(m.label)) return true;
    await sleep(500);
  }
  return false;
}
// Samples the meter every 250 ms; returns status counts (+ the sequence,
// one letter per sample: N number, L listening, U updating, S sustained).
async function sampleMeter(page, ms) {
  const counts = {};
  let seq = "";
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const m = await meter(page);
    const s = m?.status ?? "none";
    counts[s] = (counts[s] ?? 0) + 1;
    seq += { score: "N", listening: "L", updating: "U", sustained: "S" }[s] ?? "?";
    await sleep(250);
  }
  Object.defineProperty(counts, "seq", { value: seq, enumerable: false });
  return counts;
}
const share = (counts, key) => (counts[key] ?? 0) / Object.values(counts).reduce((a, b) => a + b, 0);
async function startListening(page) {
  for (let i = 0; i < 6; i++) {
    if (await page.evaluate(() => document.body.innerText.includes("Stop Listening"))) return true;
    await clickButton(page, ["Start Listening"]);
    await sleep(1500);
  }
  return page.evaluate(() => document.body.innerText.includes("Stop Listening"));
}

log("preview server");
await startServer();

// ---- landscape: the welcome and the question must scroll to their buttons
// Whether `text`'s button can be brought fully into view inside its dialog.
const reachable = (page, text) => page.evaluate((text) => {
  const b = [...document.querySelectorAll("[role=dialog] button")].find((x) => x.textContent.includes(text));
  if (!b) return { found: false };
  b.scrollIntoView({ block: "nearest" });
  const r = b.getBoundingClientRect();
  return { found: true, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, inView: r.top >= 0 && r.bottom <= innerHeight };
}, text);
if (VIEWPORT === "landscape") {
  log("landscape: welcome + question");
  await launch(WAV.speech);
  const { page, errors } = await open();
  await page.waitForFunction(() => document.body.innerText.includes("Welcome to Syrinx"), { timeout: 30000 });
  await shot(page, "01-welcome-landscape");
  const g = await reachable(page, "Get Started");
  check("landscape: Get Started can be scrolled fully into view", g.inView, JSON.stringify(g));
  await clickButton(page, ["Get Started"]);
  await page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
  await sleep(300);
  const title = await page.evaluate(() => {
    const r = document.getElementById("direction-title").getBoundingClientRect();
    return { top: Math.round(r.top), inView: r.top >= 0 };
  });
  check("landscape: the question's title is not clipped", title.inView, JSON.stringify(title));
  await shot(page, "02-question-landscape-top");
  await pickDirection(page, "androgynous");
  const c = await reachable(page, "Continue");
  check("landscape: Continue can be scrolled fully into view", c.inView, JSON.stringify(c));
  await shot(page, "03-question-landscape-scrolled");
  await clickButton(page, ["Continue"]);
  const running = await page.waitForFunction(() => document.body.innerText.includes("Stop Listening"), { timeout: 30000 })
    .then(() => true, () => false);
  check("landscape: Continue starts listening", running);
  await sleep(3000);
  await shot(page, "04-listening-landscape");
  check("no page errors (landscape)", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
  await browser.close().catch(() => {});
  closeBrowserHard();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n[${VIEWPORT}] ${results.length - failed.length}/${results.length} checks passed${failed.length ? `; failed: ${failed.map((f) => f.name).join("; ")}` : ""}`);
  cleanup();
  process.exit(failed.length ? 1 : 0);
}

// ---- 1. speech: first visit, direction changes, reload
log("run 1: speech");
await launch(WAV.speech);
{
  const { page, errors, vadFetches } = await open();
  await page.waitForFunction(() => document.body.innerText.includes("Welcome to Syrinx"), { timeout: 30000 });
  check("first visit: welcome shown first, question not yet", (await promptState(page)) === null);
  const w = await dialogInfo(page);
  check("welcome is a modal dialog, focus on Get Started, page behind inert",
    w.dialog === "welcome" && w.modal && /Get Started/.test(w.focus) && w.inert, JSON.stringify(w));
  await shot(page, "01-welcome");
  await clickButton(page, ["Get Started"]);
  await page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
  await sleep(200);
  const first = await promptState(page);
  check("first visit: question after welcome, nothing preselected", first && first.checked === null && !first.continueEnabled,
    JSON.stringify(first));
  const q = await dialogInfo(page);
  check("question: modal, page behind inert, first option focused with a visible outline",
    q.dialog === "direction" && q.modal && q.inert && q.focusDirection === "feminine" && q.focusOutline !== "none",
    JSON.stringify(q));
  await shot(page, "02-question-first-visit");
  // Tab cycles inside the question; nothing behind it can take focus.
  const tabbed = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    tabbed.push(await page.evaluate(() => !!document.activeElement?.closest("[data-dialog=direction]")
      || document.activeElement === document.body));
  }
  // (?diag=1 adds the focusable diag overlay outside the app, so skip there.)
  if (!DIAG) check("Tab never leaves the question for the page behind it", tabbed.every(Boolean), JSON.stringify(tabbed));
  // What a user can do to the page behind: focus it (keyboard) or tap it.
  const behind = await page.evaluate(() => {
    const start = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Start Listening"));
    const gear = document.querySelector('button[title="Settings & Data"]');
    start?.focus(); const startFocus = document.activeElement === start;
    gear?.focus(); const gearFocus = document.activeElement === gear;
    // A tap lands on whatever is on top there: only tap where that is the
    // dimmed backdrop, not the question's own panel (a tap there would
    // pick an option).
    const tapAt = (el) => {
      const r = el?.getBoundingClientRect();
      if (!r) return null;
      const xy = [r.x + r.width / 2, r.y + r.height / 2];
      const top = document.elementFromPoint(...xy);
      return top && !top.closest("form") ? xy : null;
    };
    return { found: !!start && !!gear, startFocus, gearFocus, startXY: tapAt(start), gearXY: tapAt(gear) };
  });
  await page.keyboard.press("Enter");
  if (behind.startXY) await page.mouse.click(...behind.startXY);
  if (behind.gearXY) await page.mouse.click(...behind.gearXY);
  await sleep(600);
  check("the page behind the question can't be focused or tapped (no mic start, no Settings)",
    behind.found && !behind.startFocus && !behind.gearFocus
      && !(await page.evaluate(() => document.body.innerText.includes("Stop Listening")))
      && !(await page.evaluate(() => !!document.querySelector("[data-dialog=settings]"))), JSON.stringify(behind));
  await page.keyboard.press("Escape");
  await sleep(200);
  check("Escape with nothing chosen keeps the question open (an answer is required)", (await promptState(page)) !== null);
  await pickDirection(page, "masculine");
  await sleep(200);
  await shot(page, "03-question-masculine-picked");
  await clickButton(page, ["Continue"]);
  const running = await page.waitForFunction(() => document.body.innerText.includes("Stop Listening"), { timeout: 30000 })
    .then(() => true, () => false);
  check("Continue starts listening", running);
  check("model ready", await waitModel(page));
  await sleep(6000);
  check("masculine: pitch band 85–155 Hz", (await pitchTarget(page)).includes("85-155"), JSON.stringify(await pitchTarget(page)));
  const mcls = await f0WhileVoiced(page);
  check("masculine: a ~100 Hz voice is not marked off target (level in the band, or beyond it: neutral)",
    /text-green-400|text-neutral-200/.test(mcls ?? ""), mcls);
  const speechCounts = await sampleMeter(page, 10000);
  check("running speech: meter shows a number most of the time", share(speechCounts, "score") >= 0.6, JSON.stringify(speechCounts));
  check("speech detector model downloaded from the pinned URL (first visit)", vadFetchedOk(vadFetches), JSON.stringify(vadFetches));
  if (DIAG) {
    const d = await page.evaluate(() => {
      const s = window.__syrinxDiag?.snapshot();
      return s ? { model: s.mlModel, inf: s.mlInferences.map((e) => [e.inferMs, e.vadMs, e.tEpochMs]).sort((a, b) => a[2] - b[2]) } : null;
    });
    // vadMs = detector time since the previous posted score (0 while the
    // detector is not live; accumulates over unscored ticks), so keep
    // back-to-back hops only: not the first score, previous < 220 ms
    // earlier, vadMs > 0.
    const inf = d?.inf ?? [];
    const withVad = inf.filter(([, v, t], i) => i > 0 && t - inf[i - 1][2] < 220 && typeof v === "number" && v > 0);
    check("diag: speech detector ready, from the network, and running (vadMs > 0 on back-to-back inferences)",
      d?.model?.speechDetector === "ready" && d?.model?.speechDetectorSource === "network" && withVad.length > 0,
      JSON.stringify({ status: d?.model?.speechDetector, source: d?.model?.speechDetectorSource, error: d?.model?.speechDetectorError, inferences: inf.length, withVad: withVad.length }));
    const hop = withVad.map(([i, v]) => i + v);
    console.log(`        diag: infer p50 ${pct(withVad.map(([i]) => i), 0.5)?.toFixed(1)} / p95 ${pct(withVad.map(([i]) => i), 0.95)?.toFixed(1)} ms; `
      + `detector per hop p50 ${pct(withVad.map(([, v]) => v), 0.5)?.toFixed(1)} / p95 ${pct(withVad.map(([, v]) => v), 0.95)?.toFixed(1)} ms; `
      + `infer + detector p95 ${pct(hop, 0.95)?.toFixed(1)} ms (n=${hop.length}; R3 budget 150 ms)`);
  }
  check("F2 readout neutral (no resonance target)", /text-neutral-200/.test((await readoutClass(page, "F2")) ?? "text-neutral-200"));
  await shot(page, "04-masculine-speech");
  // Vocal weight under "More masculine": heavier-side zone once calibrated,
  // the pitch-confound note from the start.
  const NOTE_RE = /raising your pitch also reads lighter, lowering it reads heavier/i;
  const wm0 = await weightInfo(page);
  check("masculine: weight zone = heavier side, pitch note shown (also while calibrating)",
    wm0?.zone === "heavier" && NOTE_RE.test(wm0?.note ?? ""), JSON.stringify(wm0));
  check("masculine: weight calibration completes on running speech", await waitWeightReady(page));
  await sleep(1500);
  const wm = await weightInfo(page);
  check("masculine: heavier-side zone drawn at the Heavier end (58.3–100 %)",
    !!wm?.band && Math.abs(wm.band.left - 58.333) < 0.1 && Math.abs(wm.band.left + wm.band.width - 100) < 0.1, JSON.stringify(wm?.band));
  check("weight gauge + note fit: no clipping, no horizontal overflow", layoutOk(wm), JSON.stringify(wm));
  if (VIEWPORT === "desktop") {
    check("desktop: the note is on screen without scrolling (page fits the window)",
      wm?.noteBottom <= wm?.vh && wm?.pageHeight <= wm?.vh, JSON.stringify(wm));
  }
  await shot(page, "04a-masculine-weight-zone");
  await shotStats(page, "04b-gauge-masculine");

  await page.evaluate(() => document.querySelector('button[title="Settings & Data"]').click());
  await page.waitForFunction(() => !!document.querySelector("[data-dialog=settings]"), { timeout: 10000 });
  await sleep(200);
  const st = await dialogInfo(page);
  check("Settings: modal dialog, focus moved into it, page behind inert",
    st.dialog === "settings" && st.modal && st.inert && /Close settings/.test(st.focus), JSON.stringify(st));
  await shot(page, "05-settings-masculine");
  await pickDirection(page, "feminine", "[data-dialog=settings]");
  await sleep(150);
  check("settings mid-session -> feminine: band follows at once", (await pitchTarget(page)).includes("165-255"), JSON.stringify(await pitchTarget(page)));
  await shot(page, "06-settings-feminine");
  await page.keyboard.press("Escape");
  await sleep(300);
  const back = await page.evaluate(() => ({ open: !!document.querySelector("[data-dialog=settings]"),
    focus: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName }));
  check("Escape closes Settings and returns focus to the gear", !back.open && back.focus === "Settings & Data", JSON.stringify(back));
  await sleep(700);
  // Read the F0 readout while a pitch is showing (between phrases it is
  // the grey "—", which says nothing about the target colour).
  const f0cls = await f0WhileVoiced(page);
  check("feminine: a ~100 Hz voice reads off target (red F0)", /text-red-400/.test(f0cls ?? ""), f0cls);
  await shot(page, "07-feminine-speech");
  const wf = await weightInfo(page);
  check("feminine: lighter-side zone at the Lighter end (0–41.7 %), pitch note shown",
    wf?.zone === "lighter" && !!wf.band && wf.band.left === 0 && Math.abs(wf.band.width - 41.667) < 0.1
      && NOTE_RE.test(wf.note ?? ""), JSON.stringify(wf));
  check("feminine: gauge + note fit, no clipping or overflow", layoutOk(wf), JSON.stringify(wf));
  await shotStats(page, "07b-gauge-feminine");
  // The info explainer: opens on tap, states the pitch confound and the
  // lighter-side target, stays on screen.
  await page.evaluate(() => document.querySelector('button[aria-label="What does the vocal weight gauge show?"]')?.click());
  await sleep(300);
  const tip = await page.evaluate(() => {
    const t = document.querySelector("[data-weight-zone] [role=note]");
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { text: t.textContent, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0, h: Math.round(r.height) };
  });
  check("weight info: explainer opens on screen, states the pitch confound and the lighter-side target",
    !!tip?.inView && /raising your pitch reads lighter and lowering it reads heavier/.test(tip.text)
      && /Target for More feminine: the lighter side/.test(tip.text), JSON.stringify(tip));
  await shotStats(page, "07c-gauge-feminine-info", (tip?.h ?? 0) + 16);
  await page.keyboard.press("Escape");
  await sleep(200);
  // The Perceived Voice meter's explainer: opens on tap, discloses (in
  // neutral words) that other voices / a TV are scored too, stays fully
  // on screen, closes on Escape.
  await page.evaluate(() => document.querySelector('button[aria-label="What does the perceived voice meter show?"]')?.click());
  await sleep(300);
  const mtip = await page.evaluate(() => {
    const t = document.querySelector("[data-meter-info]");
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { text: t.textContent, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
  });
  check("meter info: explainer opens on screen and says it works best with one talker (other voices, TV)",
    !!mtip?.inView && /only one talking/.test(mtip.text) && /TV, radio or podcast/.test(mtip.text), JSON.stringify(mtip));
  await shot(page, "07d-meter-info");
  await page.keyboard.press("Escape");
  await sleep(200);
  check("meter info: Escape closes it", await page.evaluate(() => !document.querySelector("[data-meter-info]")));

  await page.evaluate(() => document.querySelector('button[title="Settings & Data"]').click());
  await sleep(500);
  await pickDirection(page, "androgynous", "[data-dialog=settings]");
  await sleep(150);
  check("settings -> androgynous: band 145–175 Hz", (await pitchTarget(page)).includes("145-175"));
  const wa = await weightInfo(page);
  check("androgynous: no weight zone, no pitch note", wa?.zone === "none" && wa.band === null && wa.note === null, JSON.stringify(wa));
  await pickDirection(page, "exploring", "[data-dialog=settings]");
  await sleep(150);
  check("settings -> just exploring: no band", (await pitchTarget(page)).every((t) => t === "none"), JSON.stringify(await pitchTarget(page)));
  const wx = await weightInfo(page);
  check("just exploring: no weight zone, no pitch note", wx?.zone === "none" && wx.band === null && wx.note === null, JSON.stringify(wx));
  await clickButton(page, ["×"]);
  await sleep(1000);
  const f0x = await f0WhileVoiced(page);
  check("just exploring: neutral F0 readout", /text-neutral-200/.test(f0x ?? ""), f0x);
  await shot(page, "08-exploring-speech");
  await shotStats(page, "08b-gauge-exploring");

  // History: a session from before training directions existed (no log)
  // must not be judged; a session whose direction changed lists its goals
  // in order and says how much of it had a target.
  await injectSessions(page);
  await clickButton(page, ["History"]);
  await page.waitForFunction(() => document.body.innerText.includes("Pitch in 165–255 Hz"), { timeout: 10000 }).catch(() => {});
  await sleep(500);
  const h = await historyInfo(page);
  check("History: old sessions' figures neutral (no green/red)", h.legacy.length === 2
    && h.legacy.every((c) => /text-neutral-300/.test(c) && !/green|red/.test(c)), JSON.stringify(h.legacy));
  check("History: new session coloured, goals in order incl. the return, coverage stated",
    /text-green-400/.test(h.current ?? "") && h.goal === "Goal: More feminine → Just exploring → More feminine"
      && /over the 57% of voiced time with a target/.test(h.text), JSON.stringify({ c: h.current, g: h.goal }));
  await shot(page, "09-history");
  check("no page errors (run 1)", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();

  const again = await open();
  await again.page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
  await sleep(300);
  const re = await promptState(again.page);
  check("reload: question asked again, last choice preselected, Continue focused (one tap)",
    re && re.checked === "exploring" && re.continueEnabled && re.continueFocused, JSON.stringify(re));
  check("reload: no welcome on the second visit", !(await again.page.evaluate(() => document.body.innerText.includes("Welcome to Syrinx"))));
  await shot(again.page, "10-reload-preselected");
  await clickButton(again.page, ["Continue"]);
  const started = await again.page.waitForFunction(() => document.body.innerText.includes("Stop Listening"), { timeout: 30000 })
    .then(() => true, () => false);
  check("reload: Continue confirms AND starts listening (one tap per load)", started && (await promptState(again.page)) === null);
  await waitModel(again.page);
  await sleep(3000);
  check("reload: speech detector model read from Cache Storage (no download)", again.vadFetches.length === 0, JSON.stringify(again.vadFetches));
  await shot(again.page, "11-reload-continue-listening");
  await again.page.close();

  const third = await open();
  await third.page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
  await sleep(300);
  await third.page.keyboard.press("Escape");
  await sleep(300);
  check("reload: Escape confirms the preselected answer without starting the mic",
    (await promptState(third.page)) === null && (await third.page.evaluate(() => document.body.innerText.includes("Start Listening"))));
  await third.page.close();
}

// ---- 2-4: held vowel, noise, silence
for (const [run, wav, name] of [[2, WAV.held, "held"], [3, WAV.noise, "noise"], [4, WAV.silence, "silence"]]) {
  log(`run ${run}: ${name}`);
  await launch(wav);
  const { page, errors, vadFetches } = await open();
  await page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
  await pickDirection(page, "feminine");
  await clickButton(page, ["Continue"]);
  check(`${name}: listening`, await startListening(page));
  check(`${name}: model ready`, await waitModel(page));
  await sleep(2000);
  let counts;
  if (name === "held") {
    // Grab a screenshot while the note is up.
    counts = await sampleMeter(page, 6000);
    for (let i = 0; i < 40; i++) {
      if ((await meter(page))?.status === "sustained") break;
      await sleep(200);
    }
    await shot(page, "12-held-vowel");
    const more = await sampleMeter(page, 8000);
    console.log(`        held-vowel meter sequence: ${counts.seq}|${more.seq}`);
    for (const [k, v] of Object.entries(more)) counts[k] = (counts[k] ?? 0) + v;
    check("held vowel: 'needs running speech' shown for a good part of it", share(counts, "sustained") >= 0.3, JSON.stringify(counts));
    check("held vowel: a number shown at most briefly", share(counts, "score") <= 0.2, JSON.stringify(counts));
  } else if (name === "noise") {
    // A refrigerator: the pitch detector false-voices its compressor tone
    // until the tonal notch locks on (>= 5 s of stability), and the meter
    // follows pitch voicing — so a short stretch of numbers after the
    // start is expected (the replay of this clip: 7 % of the time; the
    // old meter: 98 %). After that it must stay blank.
    counts = await sampleMeter(page, 20000);
    await shot(page, "13-noise");
    console.log(`        noise meter sequence: ${counts.seq}`);
    check("noise: a number at most a fifth of the time (old meter: ~98 % on this clip)", share(counts, "score") <= 0.2, JSON.stringify(counts));
    check("noise: no number once the notch has locked on (last 8 s)", !counts.seq.slice(-32).includes("N"));
  } else {
    counts = await sampleMeter(page, 16000);
    await shot(page, "14-silence");
    check("silence: meter shows no number", share(counts, "score") === 0, JSON.stringify(counts));
  }
  check(`${name}: speech detector model read from Cache Storage in a new browser process (no download)`,
    vadFetches.length === 0, JSON.stringify(vadFetches));
  if (DIAG) {
    const m = await diagModel(page);
    check(`${name}: diag: speech detector ready, source "cache"`, m?.speechDetector === "ready" && m?.speechDetectorSource === "cache", JSON.stringify(m));
  }
  check(`no page errors (${name})`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
}

await browser.close().catch(() => {});
closeBrowserHard();
const failed = results.filter((r) => !r.ok);
console.log(`\n[${VIEWPORT}] ${results.length - failed.length}/${results.length} checks passed${failed.length ? `; failed: ${failed.map((f) => f.name).join("; ")}` : ""}`);
cleanup();
process.exit(failed.length ? 1 : 0);
