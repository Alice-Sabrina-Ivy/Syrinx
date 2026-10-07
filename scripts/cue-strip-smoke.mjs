// cue-strip-smoke.mjs — headless check of the Dashboard cue strip and the
// experimental "Likely heard as" panel against the BUILT app (dist/, served
// by `vite preview`), with Chrome's fake mic playing public / synthetic WAVs
// (scripts/cue-strip-smoke-wavs.mjs -> build/cue-strip-smoke/).
//
//   npm run build && node scripts/cue-strip-smoke-wavs.mjs --r1=<jobs> &&
//   node scripts/cue-strip-smoke.mjs --viewport=phone|p402|p360|landscape|desktop [--out=<dir>]
//
// Per viewport, one fresh profile (Chrome relaunched on it per WAV, since the
// fake-capture file is a launch flag):
//   1 speech-woman  first visit: welcome, the direction question (masculine),
//                   Continue starts listening. LAYOUT (the hard requirement):
//                   at scrollTop 0 the pitch trace and the whole cue strip are
//                   inside the viewport, no horizontal page scroll, no clipped
//                   strip header. Pitch live <= 3 s; resonance warming ->
//                   settling -> live (live <= 12 s); weight calibrating -> live
//                   (<= 45 s); every live row's trail reaches 8 dots. Settings:
//                   masculine / feminine / androgynous / exploring — each
//                   cue's highlight range per the spec table, the same fill /
//                   stroke in every direction, none for exploring. Heard-as:
//                   off at first visit (no gender worker); turned on in the
//                   panel -> the worker starts, Settings' switch agrees, three
//                   ranges appear with no "%" in the panel; reload -> still on;
//                   switched off in Settings -> the panel agrees, the worker is
//                   gone.
//   2 speech-man    (heard-as back on) pitch / resonance live, resonance reads
//                   lower than the woman's; three ranges.
//   3 held          resonance "sustained" for >= 60 % of the voiced hold after
//                   its first second; the panel says "sustained", never ranges.
//   4 noise / 5 silence  no dot on any row after the 5 s hold; the panel never
//                   shows ranges.
// Screenshots: <out>/<viewport>/.
//
// Process hygiene (CLAUDE.md hard rule 2, copied from voice-direction-smoke.mjs):
// Chrome is launched by puppeteer with a temporary --user-data-dir and closed
// via browser.close(), falling back to taskkill of ITS pid only; the preview
// server is this script's own child, killed only by its PID. Cleanup runs on
// exit / SIGINT / SIGTERM / uncaughtException.

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const WAVDIR = arg("wavs", path.join(repo, "build", "cue-strip-smoke"));
const WAV = Object.fromEntries(["speech-woman", "speech-man", "held", "noise", "silence"].map((k) => [k, path.join(WAVDIR, `${k}.wav`)]));
const VIEWPORT = arg("viewport", "phone");
const OUT = path.join(arg("out", path.join(repo, "build", "cue-strip-smoke")), VIEWPORT);
const PORT = Number(arg("port", "4191"));
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!CHROME || Object.values(WAV).some((w) => !existsSync(w))) { console.error("need Chrome and the WAVs (scripts/cue-strip-smoke-wavs.mjs)"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  phone: { width: 448, height: 890, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  p402: { width: 402, height: 750, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  p360: { width: 360, height: 690, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  landscape: { width: 890, height: 360, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
};

let server = null;
let browser = null;
const profile = mkdtempSync(path.join(tmpdir(), "cue-strip-smoke-"));
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
  results.push({ name, ok: !!ok, detail });
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
const clickButton = (page, texts, scope = "") => page.evaluate((ts, scope) => {
  const root = scope ? document.querySelector(scope) : document;
  const b = [...(root?.querySelectorAll("button") ?? [])].find((x) => ts.some((t) => x.textContent.trim().includes(t)));
  if (b) b.click();
  return !!b;
}, texts, scope);
const pickDirection = (page, id, scope = "[role=dialog]") => page.evaluate((id, scope) => {
  const root = scope ? document.querySelector(scope) : document;
  const input = root?.querySelector(`input[data-direction="${id}"]`);
  if (!input) return false;
  input.closest("label").click();
  return true;
}, id, scope);
const gw = (page) => page.workers().filter((w) => w.url().includes("gender-worker")).length;

// Everything the checks read, in one evaluate.
const state = (page) => page.evaluate(() => {
  const rows = {};
  for (const el of document.querySelectorAll("[data-cue]")) {
    const h = el.querySelector("[data-cue-highlight]");
    const cs = h ? getComputedStyle(h) : null;
    rows[el.dataset.cue] = {
      state: el.dataset.state, dot: el.dataset.dot === "1", trail: Number(el.dataset.trail), value: el.dataset.value === "" ? null : Number(el.dataset.value),
      low: el.dataset.targetLow ?? null, high: el.dataset.targetHigh ?? null,
      hl: h ? { fill: cs.fill, stroke: cs.stroke, strokeWidth: cs.strokeWidth, rx: h.getAttribute("rx") } : null,
      header: el.querySelector("[data-cue-value]")?.textContent ?? "",
    };
  }
  const p = document.querySelector("[data-heard-as]");
  return {
    rows,
    heardAs: p ? { mode: p.dataset.heardAs, reason: p.dataset.reason ?? null, worker: p.dataset.modelWorker ?? null, text: p.innerText,
      shares: p.querySelectorAll("[data-share]").length } : null,
    listening: document.body.innerText.includes("Stop Listening"),
  };
});

// Layout: trace box + strip inside the viewport at scrollTop 0.
const layout = (page) => page.evaluate(() => {
  const sc = [...document.querySelectorAll("*")].filter((e) => e.scrollTop > 0);
  for (const e of sc) e.scrollTop = 0;
  window.scrollTo(0, 0);
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
  const trace = r("[data-pitch-trace-box]"), strip = r("[data-cue-strip]");
  const clipped = [...document.querySelectorAll("[data-cue-strip] [data-cue-title], [data-cue-strip] [data-cue-value]")]
    .filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent);
  return { vh: innerHeight, vw: innerWidth, trace, strip, scrollW: document.documentElement.scrollWidth, clipped,
    panel: r("[data-heard-as]"), session: r("[data-session-row]") };
});
const inView = (b, L) => b && b.top >= 0 && b.bottom <= L.vh && b.left >= 0 && b.right <= L.vw;

async function startFirstVisit(page, direction) {
  await page.waitForFunction(() => document.body.innerText.includes("Welcome to Syrinx"), { timeout: 60000 });
  await clickButton(page, ["Get Started"]);
  await page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
  await pickDirection(page, direction);
  await clickButton(page, ["Continue"], "[role=dialog]");
  return waitListening(page);
}
async function waitListening(page, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(() => document.body.innerText.includes("Stop Listening"))) return true;
    await sleep(250);
  }
  return false;
}
// Reload: the question again; Continue confirms and starts listening.
async function continueAfterReload(page) {
  await page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
  await clickButton(page, ["Continue"], "[role=dialog]");
  return waitListening(page);
}
async function openSettings(page) {
  await page.evaluate(() => document.querySelector('[aria-label="Settings & Data"]')?.click());
  await page.waitForSelector("[data-dialog=settings]", { timeout: 5000 });
}
async function closeSettings(page) {
  await page.evaluate(() => document.querySelector('[aria-label="Close settings"]')?.click());
  await page.waitForFunction(() => !document.querySelector("[data-dialog=settings]"), { timeout: 5000 });
}
const settingsSwitch = (page) => page.evaluate(() => {
  const b = document.querySelector("[data-settings-heard-as] [role=switch]");
  return b ? b.getAttribute("aria-checked") : null;
});

// Samples state every 250 ms for ms, calling fn(s, tSec) each time.
async function sample(page, ms, fn) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await state(page);
    if (fn(s, (Date.now() - t0) / 1000) === true) return true;
    await sleep(250);
  }
  return false;
}

const SPEC_HL = {
  // cue -> direction -> [low, high] (rounded to 3 decimals as the attribute)
  pitch: { feminine: [165, 255], masculine: [85, 155], androgynous: [145, 175] },
  resonance: { feminine: [0.654, 1.549], masculine: [-0.53, 0.288], androgynous: [0.288, 0.654] },
  weight: { feminine: [0.5, 3], masculine: [-3, -0.5], androgynous: null },
};

log("preview server");
await startServer();

// ============================================================ 1 speech-woman
log("speech-woman: first visit");
await launch(WAV["speech-woman"]);
let { page, errors } = await open();
check("listening starts from the direction question (masculine)", await startFirstVisit(page, "masculine"));
await sleep(600);
{
  const L = await layout(page);
  await shot(page, "01-start");
  check("layout: pitch trace fully in the first screen", inView(L.trace, L), JSON.stringify(L.trace));
  check("layout: whole cue strip in the first screen", inView(L.strip, L), `${JSON.stringify(L.strip)} vh ${L.vh}`);
  check("layout: no horizontal page scroll", L.scrollW <= L.vw, `${L.scrollW} vs ${L.vw}`);
  check("layout: no clipped strip header text", L.clipped.length === 0, L.clipped.join(" | "));
  log(`  trace ${L.trace?.top}-${L.trace?.bottom}, strip ${L.strip?.top}-${L.strip?.bottom}, panel ${L.panel?.top}-${L.panel?.bottom}, session ${L.session?.top}-${L.session?.bottom}, vh ${L.vh}`);
}
{
  const s = await state(page);
  check("heard-as: off at first visit", s.heardAs?.mode === "off");
  check("heard-as off: no gender worker", gw(page) === 0, `${gw(page)} workers`);
}
// speech: states over time
{
  const seen = { pitch: new Set(), resonance: [], weight: new Set() };
  const tLive = {};
  const maxTrail = { pitch: 0, resonance: 0, weight: 0 };
  let weightLiveAt = null;
  await sample(page, 75000, (s, t) => {
    for (const cue of ["pitch", "resonance", "weight"]) {
      const r = s.rows[cue];
      if (!r) continue;
      if (r.state === "live" && tLive[cue] === undefined) tLive[cue] = t;
      maxTrail[cue] = Math.max(maxTrail[cue], r.trail);
      if (cue === "resonance") { if (seen.resonance[seen.resonance.length - 1] !== r.state) seen.resonance.push(r.state); }
      else seen[cue].add(r.state);
    }
    if (s.rows.weight?.state === "live" && weightLiveAt === null) weightLiveAt = t;
    return tLive.pitch !== undefined && tLive.resonance !== undefined && weightLiveAt !== null
      && maxTrail.pitch >= 8 && maxTrail.resonance >= 8 && maxTrail.weight >= 8;
  });
  check("pitch dot live within 3 s", tLive.pitch !== undefined && tLive.pitch <= 3, `${tLive.pitch?.toFixed(1)} s`);
  const rs = seen.resonance.join(">");
  check("resonance warming -> settling -> live", /warming.*settling.*live/.test(rs), rs);
  check("resonance live within 12 s", tLive.resonance !== undefined && tLive.resonance <= 12, `${tLive.resonance?.toFixed(1)} s`);
  check("weight calibrating, then live within 45 s", seen.weight.has("calibrating") && weightLiveAt !== null && weightLiveAt <= 45, `${weightLiveAt?.toFixed(1)} s`);
  check("trail reaches 8 dots on every row", maxTrail.pitch >= 8 && maxTrail.resonance >= 8 && maxTrail.weight >= 8, JSON.stringify(maxTrail));
  await shot(page, "02-woman-live-masculine");
}
// directions via Settings
{
  const styles = {};
  for (const dir of ["masculine", "feminine", "androgynous", "exploring"]) {
    await openSettings(page);
    await pickDirection(page, dir, "[data-dialog=settings]");
    await closeSettings(page);
    await sleep(600);
    const s = await state(page);
    for (const cue of ["pitch", "resonance", "weight"]) {
      const r = s.rows[cue];
      const want = dir === "exploring" ? null : SPEC_HL[cue][dir];
      if (want === null) {
        check(`${dir}: ${cue} has no highlight`, r.low === null && r.hl === null, `${r.low}–${r.high}`);
      } else {
        check(`${dir}: ${cue} highlight ${want[0]}–${want[1]}`, r.low !== null && Math.abs(Number(r.low) - want[0]) < 2e-3 && Math.abs(Number(r.high) - want[1]) < 2e-3, `${r.low}–${r.high}`);
        (styles[cue] ??= []).push(JSON.stringify(r.hl));
      }
    }
    await shot(page, `03-direction-${dir}`);
  }
  for (const cue of ["pitch", "resonance", "weight"]) {
    const u = new Set(styles[cue] ?? []);
    check(`${cue}: the highlight's computed fill / stroke are identical in every direction`, u.size === 1, [...u].join(" ≠ "));
  }
  // back to masculine for the rest
  await openSettings(page); await pickDirection(page, "masculine", "[data-dialog=settings]"); await closeSettings(page);
}
// heard-as on
{
  await page.evaluate(() => [...document.querySelectorAll("[data-heard-as] button")].find((b) => b.textContent.includes("Turn on"))?.click());
  await sleep(800);
  let s = await state(page);
  check("heard-as: turning it on starts the gender worker", s.heardAs?.mode !== "off" && gw(page) === 1, `${s.heardAs?.mode}/${s.heardAs?.reason}, ${gw(page)} workers`);
  await openSettings(page);
  check("Settings' switch agrees (on)", (await settingsSwitch(page)) === "true");
  await closeSettings(page);
  const shown = await sample(page, 120000, (st) => st.heardAs?.mode === "shown");
  s = await state(page);
  check("heard-as: three ranges appear on speech", shown && s.heardAs.shares === 3, `${s.heardAs?.mode}/${s.heardAs?.reason}`);
  check("heard-as: no '%' in the panel while it shows ranges", shown && !s.heardAs.text.includes("%"));
  check("heard-as: no verdict word", shown && !/likely (a )?(man|woman)|likely heard as a/i.test(s.heardAs.text.replace("Likely heard as", "")));
  await shot(page, "04-heard-as-woman");
  log(`  ranges: ${s.heardAs?.text.split("\n").slice(1, 7).join(" | ")}`);
}
// reload: persists
{
  await page.reload({ waitUntil: "domcontentloaded" });
  check("reload: listening again after Continue", await continueAfterReload(page));
  await sleep(1000);
  const s = await state(page);
  check("reload: heard-as is still on", s.heardAs?.mode !== "off" && gw(page) === 1, `${s.heardAs?.mode}, ${gw(page)} workers`);
}
// off via Settings
{
  await openSettings(page);
  await page.evaluate(() => document.querySelector("[data-settings-heard-as] [role=switch]")?.click());
  await sleep(300);
  check("Settings' switch now off", (await settingsSwitch(page)) === "false");
  await closeSettings(page);
  await sleep(500);
  const s = await state(page);
  check("panel agrees (off) and the gender worker is gone", s.heardAs?.mode === "off" && gw(page) === 0, `${s.heardAs?.mode}, ${gw(page)} workers`);
  // back on for the other voices
  await page.evaluate(() => [...document.querySelectorAll("[data-heard-as] button")].find((b) => b.textContent.includes("Turn on"))?.click());
  await sleep(300);
}
const womanU = (await state(page)).rows.resonance?.value;
check("no page errors (woman)", errors.length === 0, errors.slice(0, 3).join(" | "));

// ============================================================ 2 speech-man
log("speech-man");
await launch(WAV["speech-man"]);
({ page, errors } = await open());
check("man: listening", await continueAfterReload(page));
{
  let manU = null, pitchLive = false, resLive = false;
  await sample(page, 60000, (s) => {
    if (s.rows.pitch?.state === "live") pitchLive = true;
    if (s.rows.resonance?.state === "live") { resLive = true; manU = s.rows.resonance.value; }
    return pitchLive && resLive && s.heardAs?.mode === "shown";
  });
  const s = await state(page);
  check("man: pitch and resonance live", pitchLive && resLive);
  check("man: resonance reads lower than the woman's", manU !== null && womanU !== null && manU < womanU, `man ${manU} vs woman ${womanU}`);
  check("man: three ranges", s.heardAs?.mode === "shown" && s.heardAs.shares === 3 && !s.heardAs.text.includes("%"), `${s.heardAs?.mode}/${s.heardAs?.reason}`);
  await shot(page, "05-man-live");
  log(`  ranges: ${s.heardAs?.text.split("\n").slice(1, 7).join(" | ")}`);
  check("no page errors (man)", errors.length === 0, errors.slice(0, 3).join(" | "));
}

// ============================================================ 3 held
log("held vowel");
await launch(WAV.held);
({ page, errors } = await open());
check("held: listening", await continueAfterReload(page));
{
  let voiced = 0, sustained = 0, shownEver = false, reasonSustained = false;
  let voicedRun = 0;
  await sample(page, 22000, (s) => {
    const live = s.rows.pitch?.state === "live";
    voicedRun = live ? voicedRun + 1 : 0;
    if (voicedRun > 4) { voiced++; if (s.rows.resonance?.state === "sustained") sustained++; }
    if (s.heardAs?.mode === "shown") shownEver = true;
    if (s.heardAs?.reason === "sustained") reasonSustained = true;
  });
  check("held: resonance 'sustained' for >= 60 % of the voiced hold after its first second", voiced > 10 && sustained / voiced >= 0.6, `${sustained}/${voiced}`);
  check("held: the panel never shows ranges", !shownEver);
  check("held: the panel says it needs running speech", reasonSustained);
  await shot(page, "06-held");
}

// ============================================================ 4 noise / 5 silence
for (const kind of ["noise", "silence"]) {
  log(kind);
  await launch(WAV[kind]);
  ({ page, errors } = await open());
  check(`${kind}: listening`, await continueAfterReload(page));
  await sleep(6000);
  let dots = 0, shownEver = false, n = 0;
  await sample(page, 8000, (s) => {
    n++;
    for (const cue of ["pitch", "resonance", "weight"]) if (s.rows[cue]?.dot) dots++;
    if (s.heardAs?.mode === "shown") shownEver = true;
  });
  check(`${kind}: no dot on any row after the 5 s hold`, dots === 0, `${dots} dot-samples / ${n}`);
  check(`${kind}: the panel never shows ranges`, !shownEver);
  await shot(page, `07-${kind}`);
}

await browser.close().catch(() => {});
closeBrowserHard();
const failedN = results.filter((r) => !r.ok).length;
writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));
console.log(`\n[${VIEWPORT}] ${results.length - failedN}/${results.length} passed`);
cleanup();
process.exit(failedN ? 1 : 0);
