// lab-layout-smoke.mjs — do any buttons move while the voice comes and goes?
// Headless check against the BUILT app (dist/, served by `vite preview`), with
// Chrome's fake mic playing speech with regular pauses, at 360 x 690 and
// 448 x 890 (phone emulation) and 1280 x 800 (desktop).
//
//   npm run build && node scripts/resonance-lab/lab-layout-smoke.mjs [--wav=<48 kHz 16-bit mono speech>]
//        [--seconds=20] [--panel-seconds=60] [--layout=0] [--panel=0] [--forced=0] [--out=build/lab-layout-smoke]
//   (--layout=0 skips parts 1-3, --panel=0 part 4, --forced=0 part 5)
//
// The source WAV (default build/cue-strip-smoke/speech-woman.wav, from
// scripts/cue-strip-smoke-wavs.mjs) is cut into 3 s of speech + 2.5 s of
// silence, repeated, so every readout passes through its voiced and its
// unvoiced text ("Pitch 276 Hz" in bright / grey, "— Hz", "—" st …).
// The Resonance lab tab is hidden by default (2026-10-21); each page switches it on in
// Settings first. Per viewport, every button's (and input's) box is sampled every 100 ms in:
//   1 the Dashboard cue strip      (the column "i"s, the steadiness "i")
//   2 the Resonance lab            (header buttons, view switch, card "i"s)
//   3 the lab's Weight × clarity   (header buttons, view switch, map button)
// each together with the practice dock under it (its voice status text
// changes with the voice). PASS when both states were seen (voiced and
// unvoiced pitch text) and no box moved by more than 0.5 px between any two
// samples. In the weight view it then starts "Map your voice" and steps
// Next … Done: the three mapping buttons must keep their boxes; then Cancel.
//   4 the "Likely heard as" panel switched ON (unless --panel=0; downloads the
//     voice model from Hugging Face): a second browser plays 9 s of speech +
//     7 s of silence, so the panel cycles through "Can't tell yet — keep
//     talking", "Could go either way", a range with its "unsure" line and "Older reading"; for
//     --panel-seconds the panel's own buttons, the practice dock (record, notes,
//     Mic off) must not move (one panel height in every state),
//     and neither may the boxes of the panel itself (its bottom edge), the
//     practice dock (user decision 2026-10-20 (2):
//     nothing below the panel moves more than 0.5 px).
//   5 the same panel in EVERY state, forced (unless --forced=0; no network —
//     the voice-model hosts are unreachable and the states are set with
//     scripts/heard-as/panel-force.mjs): loading (no progress / 7 % / 100 %),
//     model error, every hide reason (waiting, held note, "Keep talking",
//     whisper, stale, outside the tested range) and estimates over the whole
//     range (both "nearly all" ends, "can't tell yet", with and without the
//     unsure line, fresh and "Older reading", each with and without the
//     pitch-only note — its room is reserved from switch-on, review
//     2026-10-20): the dome (the bar until 2026-10-25) is on screen in every state, and the panel's box,
//     its buttons, the practice dock (record, notes, Mic off) keep
//     their boxes (<= 0.5 px). Part 5 also runs at 1366 x 657 (a short
//     desktop) and 890 x 448 (short landscape), where the panel is in its row
//     layout (the dome at the left, its key, unsure line and legend beside
//     it; 2026-10-26), so the one-height rule is checked there too; every
//     shown estimate's sentence must sit inside the dome's hollow. And the
//     meaning (three parts adding to 10, user decision 2026-10-26), in every
//     shown state: the drawn segments per kind = the tenths in the words
//     (data-tenths-*, the sentence and the line under it — sayText /
//     restText), summing to 10; all ten striped and no bracket when split;
//     otherwise the bracket's ends on segment boundaries, containing the
//     bigger side's edge; each estimate and its mirror (eta and -eta) draw
//     mirrored domes and say the same words with man / woman swapped.
// Screenshots of each part in both states go to <out>/<viewport>-<part>-<state>.png.
//
// Process hygiene (CLAUDE.md hard rule 2): Chrome is launched by puppeteer with a fresh
// temporary --user-data-dir (one per browser) and closed via browser.close(), falling back
// to taskkill of ITS pid only; the preview server is this script's own child, killed only by its PID.
// Cleanup is registered on exit / SIGINT / SIGTERM / uncaughtException.

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { CHROME_BLOCK_MODEL_ARGS, allPanelStates, installPanelForce, forcePanel } from "../heard-as/panel-force.mjs";
import { sayText, restText } from "../../src/components/heardAsAxisModel.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const SRC = arg("wav", path.join(repo, "build", "cue-strip-smoke", "speech-woman.wav"));
const SECONDS = Number(arg("seconds", "20"));
const OUT = arg("out", path.join(repo, "build", "lab-layout-smoke"));
const PANEL = arg("panel", "1") !== "0";
const PANEL_SECONDS = Number(arg("panel-seconds", "60"));
const FORCED = arg("forced", "1") !== "0";
const LAYOUT = arg("layout", "1") !== "0"; // parts 1-3
const PORT = Number(arg("port", "4193"));
const TOL = 0.5; // px
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!CHROME || !existsSync(SRC)) { console.error("need Chrome and a speech WAV (--wav, or scripts/cue-strip-smoke-wavs.mjs)"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  p360: { width: 360, height: 690, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  p448: { width: 448, height: 890, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
};
// Part 5 only: the heard-as panel's row layout (HeardAsPanel.jsx, heardrow).
const FORCED_ONLY_VIEWPORTS = {
  dshort: { width: 1366, height: 657, deviceScaleFactor: 1 },
  land: { width: 890, height: 448, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

// speechS of speech / gapS of silence, repeated, from the source WAV (PCM 16-bit mono).
function gappedWav(src, dst, speechS, gapS) {
  const b = readFileSync(src);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4), n = b.readUInt32LE(off + 4);
    if (id === "fmt ") fmt = { ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    if (id === "data") data = b.subarray(off + 8, off + 8 + n);
    off += 8 + n + (n & 1);
  }
  if (!fmt || !data || fmt.ch !== 1 || fmt.bits !== 16) throw new Error("need a 16-bit mono WAV");
  const sp = Math.round(speechS * fmt.sr) * 2, gap = Math.round(gapS * fmt.sr) * 2;
  const parts = [];
  for (let i = 0; i + sp <= data.length && parts.length < 16; i += sp) parts.push(data.subarray(i, i + sp), Buffer.alloc(gap));
  const pcm = Buffer.concat(parts);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(fmt.sr, 24); h.writeUInt32LE(2 * fmt.sr, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  writeFileSync(dst, Buffer.concat([h, pcm]));
}
const WAV = path.join(OUT, "speech-gapped.wav");
gappedWav(SRC, WAV, 3, 2.5);
const PANEL_WAV = path.join(OUT, "speech-gapped-panel.wav");
if (PANEL) gappedWav(SRC, PANEL_WAV, 9, 7);

let server = null;
let browser = null;
const profiles = [];
const newProfile = () => { const d = mkdtempSync(path.join(tmpdir(), "lab-layout-smoke-")); profiles.push(d); return d; };
function killBrowser() {
  const bp = browser?.process?.()?.pid;
  if (bp) { try { execFileSync("taskkill", ["/pid", String(bp), "/T", "/F"], { stdio: "ignore" }); } catch { /* closed */ } }
  browser = null;
}
function cleanup() {
  if (server?.pid) { try { execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } server = null; }
  killBrowser();
  for (const d of profiles.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch { /* locked */ } }
}
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const results = [];
const check = (vp, name, ok, detail = "") => {
  results.push({ vp, name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  [${vp}] ${name}${detail ? `  (${detail})` : ""}`);
};

async function startServer() {
  server = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: "ignore" });
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/Syrinx/`); if (r.ok) return; } catch { /* not yet */ }
    await sleep(200);
  }
  throw new Error("preview server did not start");
}

const clickText = (page, texts, scope = "") => page.evaluate((ts, scope) => {
  const root = scope ? document.querySelector(scope) : document;
  const b = [...(root?.querySelectorAll("button") ?? [])].find((x) => ts.some((t) => x.textContent.trim().includes(t)));
  if (b) b.click();
  return !!b;
}, texts, scope);

// Welcome -> (direction question: "Just exploring") -> listening, whatever order they come in.
async function startListening(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    const s = await page.evaluate(() => ({ text: document.body.innerText, dialog: !!document.querySelector("[role=dialog] input[data-direction]") }));
    if (s.dialog) {
      await page.evaluate(() => document.querySelector('[role=dialog] input[data-direction="exploring"]')?.closest("label")?.click());
      await sleep(200);
      await clickText(page, ["Start — allow the microphone", "Start practicing"], "[role=dialog]");
    } else if (s.text.includes("Mic off")) {
      return true;
    } else {
      await clickText(page, ["Start Listening"]);
    }
    await sleep(700);
  }
  return false;
}

// In the page: every button / input under the roots `scope` matches, by a stable
// key, sampled every 100 ms, with the state read by `stateFn` (source text,
// evaluated per sample). With `roots`, the roots' own boxes too (keyed
// "box:" + the first data-* attribute name), so a box that grows or moves is
// caught even where no button moves.
const sampleButtons = (page, scope, stateSrc, ms, roots = false) => page.evaluate(async (scope, stateSrc, ms, withRoots) => {
  const stateFn = new Function(`return (${stateSrc})();`);
  const out = [];
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const roots = [...document.querySelectorAll(scope)];
    // (fallback for builds before data-lab-root: the full lab layout's outer box)
    if (scope.includes("lab-root") && !roots.some((r) => r.matches("[data-lab-root], [data-lab-phone]"))) {
      const r = [...document.querySelectorAll("h2")].find((h) => h.textContent.startsWith("Resonance lab"))?.parentElement?.parentElement;
      if (r) roots.push(r);
    }
    const rects = {};
    const seen = {};
    if (withRoots) {
      for (const r of roots) {
        const name = [...r.attributes].map((a) => a.name).find((n) => n.startsWith("data-")) ?? r.tagName;
        const b = r.getBoundingClientRect();
        rects[`box:${name}`] = [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 100) / 100);
      }
    }
    for (const b of roots.flatMap((r) => [...r.querySelectorAll("button, input, textarea")])) {
      const base = b.getAttribute("aria-label") || (b.dataset.labView ? `view:${b.dataset.labView}` : "") || b.getAttribute("placeholder") || b.textContent.trim();
      const n = (seen[base] = (seen[base] ?? 0) + 1);
      const r = b.getBoundingClientRect();
      rects[n > 1 ? `${base}#${n}` : base] = [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 100) / 100);
    }
    out.push({ t: Math.round(performance.now() - t0), state: stateFn(), rects });
    await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}, scope, stateSrc, ms, roots);

// Biggest move of any button between two samples, and which.
function maxMove(samples) {
  const keys = new Set(samples.flatMap((s) => Object.keys(s.rects)));
  let worst = { d: 0, key: null, a: null, b: null };
  const missing = [];
  for (const k of keys) {
    const have = samples.filter((s) => s.rects[k]);
    if (have.length !== samples.length) missing.push(k);
    for (const s of have) {
      const r0 = have[0].rects[k], r = s.rects[k];
      const d = Math.max(...r.map((v, i) => Math.abs(v - r0[i])));
      if (d > worst.d) worst = { d, key: k, a: { state: have[0].state, r: r0 }, b: { state: s.state, r } };
    }
  }
  return { worst, missing, n: keys.size };
}

// Screenshot of the current part in a given state (polls until the state shows).
async function shotIn(page, stateSrc, want, file) {
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    const st = await page.evaluate((src) => new Function(`return (${src})();`)(), stateSrc);
    if (st === want) { await page.screenshot({ path: file }); return true; }
    await sleep(60);
  }
  return false;
}

// Voicing state of each part: "voiced" | "unvoiced" (anything else: in between).
const CUE_STATE = `() => {
  const f0 = document.querySelector('[data-cue="pitch"] [data-cue-f0]')?.innerText ?? ""; // visible text only
  return /\\d/.test(f0) ? "voiced" : f0.includes("—") ? "unvoiced" : "other";
}`;
const LAB_STATE = `() => {
  const p = document.querySelector("[data-lab-pitch]");
  if (p) return p.dataset.labPitch === "live" ? "voiced" : p.dataset.labPitch === "last" ? "unvoiced" : "other";
  const t = document.querySelector("[data-lab-header]")?.innerText ?? document.body.innerText;
  return /Pitch \\d+ Hz/.test(t) ? "voiced" : /\\(last \\d+ Hz\\)/.test(t) ? "unvoiced" : "other";
}`;
// The lab root: both layouts carry data-lab-root (after this change); before it, the
// phone layout had data-lab-phone and the full one only the header text.
const LAB_SCOPE = "[data-lab-root], [data-lab-phone]";
// The practice dock (its voice status text changes with the voice).
const BAR = "[data-practice-dock]";
// The heard-as panel: shown (wide / narrow, older reading, pitch-only note) or hidden (reason).
const PANEL_STATE = `() => {
  const p = document.querySelector("[data-heard-as]");
  if (!p) return "none";
  if (p.dataset.heardAs !== "shown") return p.dataset.heardAs + ":" + (p.dataset.reason || "");
  return "shown:" + (document.querySelector("[data-heard-as-axis]")?.dataset.axisWide === "1" ? "wide" : "narrow")
    + (document.querySelector("[data-heard-as-shares]")?.dataset.stale === "1" ? "+older" : "")
    + (p.querySelector("[data-pitch-only]") ? "+pitch-only" : "");
}`;

async function part(vp, page, name, scope, stateSrc) {
  const samples = await sampleButtons(page, scope, stateSrc, SECONDS * 1000);
  const counts = samples.reduce((a, s) => ((a[s.state] = (a[s.state] ?? 0) + 1), a), {});
  const both = (counts.voiced ?? 0) > 0 && (counts.unvoiced ?? 0) > 0;
  const m = maxMove(samples);
  check(vp, `${name}: voiced and unvoiced both seen`, both, JSON.stringify(counts));
  check(vp, `${name}: ${m.n} buttons, none moved (max ${m.worst.d.toFixed(2)} px <= ${TOL})`, m.n > 0 && m.worst.d <= TOL && m.missing.length === 0,
    m.worst.d > TOL ? `"${m.worst.key}" ${JSON.stringify(m.worst.a)} -> ${JSON.stringify(m.worst.b)}` : m.missing.length ? `appeared / disappeared: ${m.missing.join(", ")}` : "");
  for (const st of ["voiced", "unvoiced"]) await shotIn(page, stateSrc, st, path.join(OUT, `${vp}-${name}-${st}.png`));
}

log("starting preview server");
await startServer();
const launch = (wav) => puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: newProfile(),
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
});
async function openPage(viewport, errors) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.goto(`http://localhost:${PORT}/Syrinx/`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.bringToFront();
  return page;
}
// Settings' "Show the Resonance lab (experimental)" switch: on (the tab is hidden by default).
async function enableLab(page) {
  try {
    await page.evaluate(() => document.querySelector('button[aria-label="Settings & Data"]').click());
    await page.waitForSelector("[data-settings-lab-switch]", { timeout: 10000 });
    await page.evaluate(() => { const b = document.querySelector("[data-settings-lab-switch]"); if (b.getAttribute("aria-checked") !== "true") b.click(); });
    await page.waitForFunction(() => document.querySelector("[data-settings-lab-switch]")?.getAttribute("aria-checked") === "true", { timeout: 5000 });
    await page.evaluate(() => document.querySelector('button[aria-label="Close settings"]').click());
    await page.waitForFunction(() => [...document.querySelectorAll("nav button")].some((b) => b.textContent.trim() === "Resonance lab"), { timeout: 5000 });
    return true;
  } catch { return false; }
}
if (LAYOUT) browser = await launch(WAV);

for (const [vp, viewport] of Object.entries(LAYOUT ? VIEWPORTS : {})) {
  const errors = [];
  const page = await openPage(viewport, errors);
  const listening = await startListening(page);
  check(vp, "listening", listening);
  if (!listening) { await page.close(); continue; }
  // the Resonance lab tab is off by default (2026-10-21): switch it on in Settings
  check(vp, "Resonance lab switched on in Settings", await enableLab(page));

  // 1 Dashboard cue strip
  await page.waitForSelector('[data-cue="pitch"]', { timeout: 20000 }).catch(() => {});
  await sleep(4000);
  await part(vp, page, "cue-strip", `[data-cue-strip], ${BAR}`, CUE_STATE);

  // 2 Resonance lab
  await clickText(page, ["Resonance lab"]);
  await page.waitForFunction((scope) => {
    const root = document.querySelector(scope) ?? document.querySelector("main") ?? document.body;
    return !!root && !/Loading lab/.test(root.textContent) && /Voiced so far [1-9]/.test(root.textContent);
  }, { timeout: 60000 }, LAB_SCOPE).catch(() => log("lab not ready in 60 s"));
  await sleep(2000);
  await part(vp, page, "lab-resonance", `${LAB_SCOPE}, ${BAR}`, LAB_STATE);

  // 3 Weight × clarity view
  await page.evaluate(() => document.querySelector('[data-lab-view="weight"]')?.click());
  await page.waitForSelector("[data-weight-map-start]", { timeout: 30000 }).catch(() => log("weight view not ready in 30 s"));
  await sleep(2500);
  await part(vp, page, "lab-weight", `${LAB_SCOPE}, ${BAR}`, LAB_STATE);
  // The whole plot (with its bottom axis word) must be in the first screen,
  // above Mic off.
  const fit = await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const el of document.querySelectorAll("[data-lab-phone]")) el.scrollTop = 0;
    const plot = document.querySelector("[data-weight-plot]")?.getBoundingClientRect();
    const axis = document.querySelector("[data-weight-axis-bottom]")?.getBoundingClientRect();
    const stop = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Mic off"))?.getBoundingClientRect();
    return plot ? { top: Math.round(plot.top), bottom: Math.round(Math.max(plot.bottom, axis?.bottom ?? 0)), floor: Math.round(Math.min(innerHeight, stop?.top ?? innerHeight)) } : null;
  });
  check(vp, "lab-weight: plot in the first screen", !!fit && fit.top >= 0 && fit.bottom <= fit.floor, JSON.stringify(fit));

  // Mapping: "Next" ... "Done" keep one width, so "Finish now" and "Cancel" stay put.
  const startable = await page.evaluate(() => { const b = document.querySelector("[data-weight-map-start]"); return !!b && !b.disabled; });
  if (!startable) {
    console.log(`SKIP  [${vp}] lab-weight mapping: the map button is missing or disabled`);
  } else {
    await page.evaluate(() => document.querySelector("[data-weight-map-start]")?.click());
    await page.waitForSelector("[data-weight-mapping]", { timeout: 10000 }).catch(() => {});
    const boxes = [];
    for (let i = 0; i < 8; i++) {
      const b = await page.evaluate(() => {
        const m = document.querySelector("[data-weight-mapping]");
        if (!m) return null;
        const bs = [...m.querySelectorAll("button")];
        return { label: bs[0]?.innerText.trim(), rects: bs.map((x) => { const r = x.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 100) / 100); }) };
      });
      if (!b) break;
      boxes.push(b);
      if (b.label === "Done") break;
      await page.evaluate(() => document.querySelector("[data-weight-mapping] button")?.click());
      await sleep(400);
    }
    const labels = boxes.map((b) => b.label);
    let worst = 0;
    for (const b of boxes) for (let k = 0; k < b.rects.length; k++) worst = Math.max(worst, ...b.rects[k].map((v, i) => Math.abs(v - boxes[0].rects[k][i])));
    check(vp, `lab-weight mapping: Next … Done, the three buttons keep their boxes (max ${worst.toFixed(2)} px <= ${TOL})`,
      labels.includes("Next") && labels.at(-1) === "Done" && boxes.every((b) => b.rects.length === 3) && worst <= TOL, labels.join(" > "));
    await page.evaluate(() => [...document.querySelectorAll("[data-weight-mapping] button")].find((x) => x.textContent.trim() === "Cancel")?.click());
    await sleep(300);
  }

  check(vp, "no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
}

await browser?.close().catch(() => {});
killBrowser();

// 4 The "Likely heard as" panel switched on: one height in every state.
if (PANEL) {
  browser = await launch(PANEL_WAV);
  for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
    const errors = [];
    const page = await openPage(viewport, errors);
    const listening = await startListening(page);
    check(vp, "panel: listening", listening);
    if (!listening) { await page.close(); continue; }
    // The panel is on by default (2026-10-25: no turn-on button): it is there as soon as listening starts.
    await page.waitForSelector("[data-heard-as]", { timeout: 20000 }).catch(() => {});
    const t0 = Date.now();
    const ready = await page.waitForFunction(() => document.querySelector("[data-heard-as]")?.dataset.modelWorker === "ready", { timeout: 300000 })
      .then(() => true, () => false);
    check(vp, "panel: voice model ready", ready, `${Math.round((Date.now() - t0) / 1000)} s`);
    if (!ready) { await page.close(); continue; }
    const shownOnce = await page.waitForFunction(() => document.querySelector("[data-heard-as]")?.dataset.heardAs === "shown", { timeout: 60000 })
      .then(() => true, () => false);
    if (!shownOnce) log("panel: no estimate shown within 60 s of the model being ready");
    const scope = `[data-heard-as], ${BAR}`;
    const samples = await sampleButtons(page, scope, PANEL_STATE, PANEL_SECONDS * 1000, true);
    const counts = samples.reduce((a, s) => ((a[s.state] = (a[s.state] ?? 0) + 1), a), {});
    const shown = Object.keys(counts).some((k) => k.startsWith("shown:"));
    const hidden = Object.keys(counts).some((k) => k.startsWith("hidden:"));
    check(vp, "panel: shown and hidden states both seen", shown && hidden, JSON.stringify(counts));
    const m = maxMove(samples);
    check(vp, `panel: ${m.n} buttons / inputs / boxes (panel, practice dock), none moved (max ${m.worst.d.toFixed(2)} px <= ${TOL})`, m.n > 0 && m.worst.d <= TOL && m.missing.length === 0,
      m.worst.d > TOL ? `"${m.worst.key}" ${JSON.stringify(m.worst.a)} -> ${JSON.stringify(m.worst.b)}` : m.missing.length ? `appeared / disappeared: ${m.missing.join(", ")}` : "");
    const h = await page.evaluate(() => document.querySelector("[data-heard-as]")?.getBoundingClientRect().height ?? null);
    log(`  [${vp}] panel height ${h?.toFixed(1)} px; states ${JSON.stringify(counts)}`);
    for (const st of Object.keys(counts)) {
      await page.evaluate(() => document.querySelector("[data-heard-as]")?.scrollIntoView({ block: "center" }));
      await shotIn(page, PANEL_STATE, st, path.join(OUT, `${vp}-panel-${st.replace(/[:+]/g, "_")}.png`));
    }
    check(vp, "panel: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.close();
  }
  await browser.close().catch(() => {});
  killBrowser();
}

// 5 The panel in every state, forced: one height whatever it shows.
if (FORCED) {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: newProfile(),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", ...CHROME_BLOCK_MODEL_ARGS],
  });
  const STATES = allPanelStates();
  for (const [vp, viewport] of Object.entries({ ...VIEWPORTS, ...FORCED_ONLY_VIEWPORTS })) {
    const errors = [];
    const page = await openPage(viewport, errors);
    const listening = await startListening(page);
    check(vp, "forced: listening", listening);
    if (!listening) { await page.close(); continue; }
    await page.waitForSelector("[data-heard-as]", { timeout: 20000 }).catch(() => {});   // on by default
    await page.waitForFunction(() => ["error", "ready"].includes(document.querySelector("[data-heard-as]")?.dataset.modelWorker), { timeout: 60000 }).catch(() => {});
    const inst = await installPanelForce(page);
    check(vp, "forced: panel states can be set", inst.ok, inst.why ?? "");
    if (!inst.ok) { await page.close(); continue; }
    const scope = `[data-heard-as], ${BAR}`;
    const samples = [], seen = [], noBar = [], outOfDome = [], badMeaning = [], drawnByName = {};
    let inDomeChecked = 0;
    for (const st of STATES) {
      await forcePanel(page, st);
      await sleep(120);
      const [one] = await sampleButtons(page, scope, PANEL_STATE, 1, true);
      const bar = await page.evaluate(() => {
        const a = document.querySelector("[data-heard-as] [data-heard-as-axis], [data-heard-as] [data-heard-as-axis-empty]:not(.invisible *)");
        const r = a?.getBoundingClientRect();
        return !!r && r.width > 0 && r.height > 0;
      });
      if (!bar) noBar.push(st.name);
      // A shown estimate's sentence inside the dome's hollow (every line within the inner radius, above the
      // base; the same rule as cue-strip-smoke's), in every forced state — the cue strip smoke sees only the
      // two live voices' readings at its one viewport (2026-10-26 review).
      const inDome = await page.evaluate(() => {
        const p = document.querySelector("[data-heard-as]");
        const lines = [...(p?.querySelectorAll("[data-heard-as-range] > span") ?? [])].map((e) => { const g = document.createRange(); g.selectNodeContents(e); return g.getBoundingClientRect(); });
        const dome = p?.querySelector("[data-heard-as-axis] [data-split-bar]")?.getBoundingClientRect();
        if (!lines.length || !dome) return null;   // no estimate shown
        const k = dome.width / 300, cx = dome.left + 150 * k, cy = dome.top + 156 * k, r = 118 * k;
        return lines.every((l) => {
          const inkTop = l.top + (l.height * 0.35) / 2.7;
          return l.bottom <= cy + 0.5 && Math.hypot(l.left - cx, inkTop - cy) <= r + 1 && Math.hypot(l.right - cx, inkTop - cy) <= r + 1;
        });
      });
      // The meaning (2026-10-26): what is drawn = what is said.
      const drawn = await page.evaluate(() => {
        const a = document.querySelector("[data-heard-as] [data-heard-as-axis]");
        if (!a) return null;
        const kinds = [...a.querySelectorAll("[data-tenth]")].sort((x, y) => x.dataset.tenth - y.dataset.tenth).map((e) => e.dataset.tenthKind[0]).join("");
        const b = a.querySelector("[data-bracket]");
        const angle = (q) => (Math.atan2(156 - q.y, q.x - 150) * 180) / Math.PI;
        return { kinds, wide: a.dataset.axisWide === "1", split: a.dataset.axisSplit === "1",
          t: { man: Number(a.dataset.tenthsMan), unsure: Number(a.dataset.tenthsUnsure), woman: Number(a.dataset.tenthsWoman) },
          range: document.querySelector("[data-heard-as] [data-heard-as-range]")?.textContent ?? "",
          unsure: document.querySelector("[data-heard-as] [data-heard-as-unsure]")?.textContent ?? null,
          bracket: b ? { lo: Number(b.dataset.bracketLo), hi: Number(b.dataset.bracketHi), side: b.dataset.bracketSide,
            a0: angle(b.getPointAtLength(0)), a1: angle(b.getPointAtLength(b.getTotalLength())) } : null };
      });
      if (drawn) {
        const { t, kinds } = drawn, n = (c) => kinds.split("").filter((x) => x === c).length;
        const edge = t.man > t.woman ? t.man : 10 - t.woman, onB = (deg, k) => Math.abs(deg - (180 - 18 * k)) < 0.5;
        const ok = kinds.length === 10 && t.man + t.unsure + t.woman === 10 && drawn.range === sayText(t, drawn.wide)
          && (drawn.split ? kinds === "ssssssssss" && drawn.bracket === null && drawn.unsure === null
            : /^m*u*w*$/.test(kinds) && n("m") === t.man && n("u") === t.unsure && n("w") === t.woman && drawn.unsure === restText(t, drawn.wide)
              && !!drawn.bracket && drawn.bracket.lo <= edge && edge <= drawn.bracket.hi && onB(drawn.bracket.a0, drawn.bracket.lo) && onB(drawn.bracket.a1, drawn.bracket.hi));
        if (!ok) badMeaning.push(`${st.name}: ${JSON.stringify(drawn)}`);
        drawnByName[st.name] = drawn;
      }
      if (inDome !== null) inDomeChecked++;
      if (inDome === false) outOfDome.push(st.name);
      samples.push({ ...one, state: `${st.name} -> ${one.state}` });
      seen.push(one.state);
    }
    const reasons = new Set(seen.filter((x) => x.startsWith("hidden:")).map((x) => x.slice(7)));
    const wantReasons = ["loading", "error", "listening", "sustained", "short", "unvoiced", "stale", "outside"];
    const wantShown = ["shown:wide", "shown:narrow", "shown:narrow+older", "shown:wide+older"];
    check(vp, "forced: every hide reason, wide and narrow estimates, fresh and older, each with and without the pitch-only note, were shown",
      wantReasons.every((r) => reasons.has(r)) && [...wantShown, ...wantShown.map((k) => `${k}+pitch-only`)].every((k) => seen.includes(k)),
      JSON.stringify([...new Set(seen)]));
    check(vp, "forced: the dome is on screen in every state (empty and greyed without an estimate)", noBar.length === 0, noBar.join(", "));
    check(vp, `forced: in every shown state (${Object.keys(drawnByName).length}) the drawn segments per kind = the tenths in the words, summing to 10; split = all striped, no bracket, no line under it; else the bracket's ends on segment boundaries, containing the bigger side's edge`,
      Object.keys(drawnByName).length > 0 && badMeaning.length === 0, badMeaning.slice(0, 2).join(" | "));
    const swapW = (x) => x == null ? x : x.replace(/would say (man|woman)\b/g, (m0, w) => `would say ${w === "man" ? "woman" : "man"}`);
    const mirrorBad = [];
    for (const [name, A] of Object.entries(drawnByName)) {
      const mm = name.match(/^eta(\d[\d.]*)(.*)$/);
      const B = mm ? drawnByName[`eta-${mm[1]}${mm[2]}`] : null;
      if (!B) continue;
      const mk = A.kinds.split("").reverse().map((c) => (c === "m" ? "w" : c === "w" ? "m" : c)).join("");
      if (!(mk === B.kinds && swapW(A.range) === B.range && swapW(A.unsure) === B.unsure
        && (A.bracket ? !!B.bracket && A.bracket.lo === 10 - B.bracket.hi && A.bracket.hi === 10 - B.bracket.lo : B.bracket === null))) mirrorBad.push(name);
    }
    check(vp, "forced: mirrored estimates (eta / -eta) draw mirrored domes and say the same words with man / woman swapped", mirrorBad.length === 0, mirrorBad.join(", "));
    check(vp, `forced: every shown estimate's sentence is drawn inside the dome's hollow (${inDomeChecked} checked)`, inDomeChecked > 0 && outOfDome.length === 0, outOfDome.join(", "));
    const m = maxMove(samples);
    check(vp, `forced: ${STATES.length} states, ${m.n} buttons / inputs / boxes (panel, practice dock), none moved (max ${m.worst.d.toFixed(2)} px <= ${TOL})`,
      m.n > 0 && m.worst.d <= TOL && m.missing.length === 0,
      m.worst.d > TOL ? `"${m.worst.key}" ${JSON.stringify(m.worst.a)} -> ${JSON.stringify(m.worst.b)}` : m.missing.length ? `appeared / disappeared: ${m.missing.join(", ")}` : "");
    const h = samples[0]?.rects["box:data-heard-as"]?.[3];
    log(`  [${vp}] forced: panel height ${h} px over ${STATES.length} states`);
    check(vp, "forced: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.close();
  }
  await browser.close().catch(() => {});
  killBrowser();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${OUT}`);
cleanup();
process.exit(failed.length ? 1 : 0);
