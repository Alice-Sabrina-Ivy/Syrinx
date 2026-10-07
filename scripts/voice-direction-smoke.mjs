// voice-direction-smoke.mjs — headless check of the training-direction
// question and the Perceived Voice meter fixes against the BUILT app
// (dist/, served by `vite preview`), with Chrome's fake mic playing a WAV.
//
//   npm run build && node scripts/voice-direction-smoke.mjs --speech=<wav> --held=<wav> \
//     --noise=<wav> --silence=<wav> --out=<dir> [--viewport=desktop|phone]
//
// One fresh profile per run; Chrome is relaunched (same profile) for each
// WAV because the fake-capture file is a launch flag:
//   1 speech  first visit: welcome, then the question with nothing
//             preselected; pick "More masculine" (starts listening);
//             change direction in Settings mid-session — the pitch band
//             must follow at once (canvas data-target), "Just exploring"
//             must draw none; reload: the question again, last choice
//             preselected, one tap to continue.
//   2 held    a held vowel: the meter must show "needs running speech",
//             not a number, for most of the hold.
//   3 noise   / 4 silence: the meter must show no number.
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

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const WAV = { speech: arg("speech", ""), held: arg("held", ""), noise: arg("noise", ""), silence: arg("silence", "") };
const VIEWPORT = arg("viewport", "desktop");
const OUT = path.join(arg("out", path.join(tmpdir(), "voice-direction-smoke")), VIEWPORT);
const PORT = 4189;
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!CHROME || Object.values(WAV).some((w) => !w)) { console.error("need Chrome and --speech/--held/--noise/--silence"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

// Pixel 8 Pro visible area (CSS px) / a laptop window.
const VIEWPORTS = {
  phone: { width: 448, height: 890, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
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
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.goto(`http://localhost:${PORT}/Syrinx/`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.bringToFront();
  return { page, errors };
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
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

// ---- 1. speech: first visit, direction changes, reload
log("run 1: speech");
await launch(WAV.speech);
{
  const { page, errors } = await open();
  await page.waitForFunction(() => document.body.innerText.includes("Welcome to Syrinx"), { timeout: 30000 });
  check("first visit: welcome shown first, question not yet", (await promptState(page)) === null);
  await shot(page, "01-welcome");
  await clickButton(page, ["Get Started"]);
  await page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
  const first = await promptState(page);
  check("first visit: question after welcome, nothing preselected", first && first.checked === null && !first.continueEnabled,
    JSON.stringify(first));
  await shot(page, "02-question-first-visit");
  await pickDirection(page, "masculine");
  await sleep(200);
  await shot(page, "03-question-masculine-picked");
  await clickButton(page, ["Continue"]);
  const running = await page.waitForFunction(() => document.body.innerText.includes("Stop Listening"), { timeout: 30000 })
    .then(() => true, () => false);
  check("Continue after the welcome starts listening", running);
  check("model ready", await waitModel(page));
  await sleep(6000);
  check("masculine: pitch band 85–155 Hz", (await pitchTarget(page)).includes("85-155"), JSON.stringify(await pitchTarget(page)));
  const speechCounts = await sampleMeter(page, 10000);
  check("running speech: meter shows a number most of the time", share(speechCounts, "score") >= 0.6, JSON.stringify(speechCounts));
  await shot(page, "04-masculine-speech");

  await page.evaluate(() => document.querySelector('button[title="Settings & Data"]').click());
  await page.waitForFunction(() => document.body.innerText.includes("Settings & Data"), { timeout: 10000 });
  await shot(page, "05-settings-masculine");
  await pickDirection(page, "feminine", null);
  await sleep(150);
  check("settings mid-session -> feminine: band follows at once", (await pitchTarget(page)).includes("165-255"), JSON.stringify(await pitchTarget(page)));
  await shot(page, "06-settings-feminine");
  await clickButton(page, ["×"]);
  await sleep(1000);
  // Read the F0 readout while a pitch is showing (between phrases it is
  // the grey "—", which says nothing about the target colour).
  const f0cls = await f0WhileVoiced(page);
  check("feminine: a ~100 Hz voice reads out of target (red F0)", /text-red-400/.test(f0cls ?? ""), f0cls);
  await shot(page, "07-feminine-speech");

  await page.evaluate(() => document.querySelector('button[title="Settings & Data"]').click());
  await sleep(500);
  await pickDirection(page, "androgynous", null);
  await sleep(150);
  check("settings -> androgynous: band 145–175 Hz", (await pitchTarget(page)).includes("145-175"));
  await pickDirection(page, "exploring", null);
  await sleep(150);
  check("settings -> just exploring: no band", (await pitchTarget(page)).every((t) => t === "none"), JSON.stringify(await pitchTarget(page)));
  await clickButton(page, ["×"]);
  await sleep(1000);
  const f0x = await f0WhileVoiced(page);
  check("just exploring: neutral F0 readout", /text-neutral-200/.test(f0x ?? ""), f0x);
  await shot(page, "08-exploring-speech");
  check("no page errors (run 1)", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();

  const again = await open();
  await again.page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
  await sleep(300);
  const re = await promptState(again.page);
  check("reload: question asked again, last choice preselected, Continue focused (one tap)",
    re && re.checked === "exploring" && re.continueEnabled && re.continueFocused, JSON.stringify(re));
  check("reload: no welcome on the second visit", !(await again.page.evaluate(() => document.body.innerText.includes("Welcome to Syrinx"))));
  await shot(again.page, "09-reload-preselected");
  await clickButton(again.page, ["Continue"]);
  await sleep(500);
  check("reload: Continue closes the question (listening not auto-started)",
    (await promptState(again.page)) === null && (await again.page.evaluate(() => document.body.innerText.includes("Start Listening"))));
  await again.page.close();
}

// ---- 2-4: held vowel, noise, silence
for (const [run, wav, name] of [[2, WAV.held, "held"], [3, WAV.noise, "noise"], [4, WAV.silence, "silence"]]) {
  log(`run ${run}: ${name}`);
  await launch(wav);
  const { page, errors } = await open();
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
    await shot(page, "10-held-vowel");
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
    await shot(page, "11-noise");
    console.log(`        noise meter sequence: ${counts.seq}`);
    check("noise: a number at most a fifth of the time (old meter: ~98 % on this clip)", share(counts, "score") <= 0.2, JSON.stringify(counts));
    check("noise: no number once the notch has locked on (last 8 s)", !counts.seq.slice(-32).includes("N"));
  } else {
    counts = await sampleMeter(page, 16000);
    await shot(page, "12-silence");
    check("silence: meter shows no number", share(counts, "score") === 0, JSON.stringify(counts));
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
