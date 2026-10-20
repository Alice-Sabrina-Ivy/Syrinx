// voice-preview-smoke.mjs — headless check of the "Voice preview" card (the Resonance lab's
// third view) against the BUILT app, with Chrome's fake microphone playing public /
// synthetic WAVs (scripts/voice-preview-smoke-wavs.mjs -> build/voice-preview-smoke/wavs/).
// measurements/voice-preview-phase1-2026-10-19.md §14 "Smoke".
//
//   npm run build && node scripts/voice-preview-smoke-wavs.mjs &&
//   node scripts/voice-preview-smoke.mjs [--parts=layout,flow,checks,dev,preview,fallback] [--out=<dir>]
//        [--viewports=p360,p402,phone,landscape,desktop] [--chrome=<exe>]
//        [--port=4193] [--dev-port=5193] [--preview-port=4194]
//
// layout  (clean.wav) per viewport, one page: the lab opened on Resonance requests nothing
//         of the voice preview (card chunk, worker, glue, .wasm); opening the view requests
//         exactly one .wasm and the card gets ready (SIMD in Chrome); at 360 x 690 the lab's
//         Resonance view still fits its four cards (the lab smoke's check). Record waits for
//         6 s of listening, the recording auto-stops at 8 s, then "Preview ready". Then, in
//         prefers-color-scheme dark AND light: no horizontal page scroll; heading, status
//         line and Record inside the lab area at scrollTop 0; every control reachable by
//         scrolling it and on top there; no clipped text; targets (Record / Play >= 44 x 44
//         on phones, everything else >= 24 x 24, ranges 44 px tall); text >= 4.5:1 against
//         the card; computed color-scheme dark. Screenshots per viewport and scheme.
//         Then, with the viewport's own input (touch on the phone viewports, the mouse on
//         desktop; verify step): both sliders dragged to each end, the release commits ONE
//         render matching the slider (limits: pitch -12..0 .. +12, resonance -21 .. +26);
//         every quick setting and the target row render; each Play button plays (the
//         AudioContext running), Loop, Stop; Discard frees the recording's memory — the
//         page's AudioBuffers and array-buffer backing store back to what they were before
//         the recording (CDP queryObjects / getHeapUsage after a forced GC), the old worker
//         gone and the fresh worker's WebAssembly memory at its initial size.
// flow    (clean.wav, 1280 x 800, direction "More feminine" for the target prefill): a stop
//         at 2 s -> too short; a full recording; keyboard order (Record, sliders, quick
//         settings, Play group, Discard / Download), arrow keys -> aria-valuetext and ONE
//         render 400 ms after the last key; presets; the target row (prefill 205 Hz, focus,
//         Apply, Escape); playback (each version plays with the AudioContext running, A/B,
//         loop, stop, live-region text); the Dashboard session guard; Download (RIFF/WAVE,
//         16-bit mono, engine rate, the recording's duration); Discard (the worker target
//         goes, a fresh one comes, back to ready, focus on Record); listening stopped during
//         a recording -> cancelled. No gender words in the card, no console errors.
// checks  hum.wav (10 s of fan hum first) -> the hum notice; noise.wav (pink, +10 dB SNR)
//         -> the noise notice; the layout part's clean runs show neither. Every run makes a
//         preview.
// dev     one run against `vite` (dev server): the ?url glue import works there too.
// preview one run against `vite preview` of the same build: the .wasm is served as
//         application/wasm, the SIMD build loads, record -> preview -> quick setting -> play.
// fallback the static server hands out a SIMD .wasm that fails to compile: the worker loads
//         the non-SIMD build (fetched once), which records, renders and plays.
// Every part also fails on console errors, the workers' included.
// timing  (not in the default parts; needs timing.wav, i.e. $VP_CACHE) desktop timing in the
//         spike's browser (--chrome=<Chrome for Testing 154>, default $VP_CACHE/browsers/…),
//         1280 x 800, ?diag=1&capture=audiocontext&sr=48000 (the fake microphone runs at 44.1 kHz;
//         the AudioContext path takes the rate override), listening on: --timing-n recordings of 5 s (user
//         stop once 5 s are in) and of 8 s (auto-stop), each followed by one slider change (+2 st, +3 %).
//         The worker's analysis + rebuild and render times (median / pooled p90) against the
//         spike's A5 desktop values; end to end (stop -> "Preview ready", press -> "Preview
//         updated") and the machine's busy share during each recording are reported. The
//         page and worker memory after the first and the last 8 s recording must not grow
//         over the Record again cycles.
//
// Serving: the built app is served by a small static server inside this script (dist/
// under /Syrinx/), which logs every request — worker and WebAssembly fetches included,
// which page-level request events miss. Screenshots: <out>/<viewport>-<scheme>-<state>.png.
//
// Process hygiene (CLAUDE.md hard rule 2): Chrome is launched by puppeteer with a fresh
// temporary --user-data-dir per launch and closed with browser.close(), falling back to
// taskkill of ITS pid only (/T /F); the dev server is this script's own child, killed only
// by its PID. Cleanup runs on exit / SIGINT / SIGTERM / uncaughtException.

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { P } from "./voice-preview/lib/paths.mjs";
import { applyPreset } from "../src/voice-preview/controls.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const PARTS = new Set(arg("parts", "layout,flow,checks,dev,preview,fallback").split(",").filter(Boolean));
const WAVDIR = arg("wavs", path.join(repo, "build", "voice-preview-smoke", "wavs"));
const OUT = arg("out", path.join(repo, "build", "voice-preview-smoke", "shots"));
const PORT = Number(arg("port", "4193"));
const DEV_PORT = Number(arg("dev-port", "5193"));
const PREVIEW_PORT = Number(arg("preview-port", "4194"));
const CFT = path.join(P.browsers, "chrome", "win64-154.0.8037.57", "chrome-win64", "chrome.exe"); // the spike's timing browser
const CHROME = arg("chrome", "") || (PARTS.has("timing") && existsSync(CFT) ? CFT : "") || ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
const WAV = Object.fromEntries(["clean", "hum", "noise"].map((k) => [k, path.join(WAVDIR, `${k}.wav`)]));
const TIMING_WAV = path.join(WAVDIR, "timing.wav");
const TIMING_N = Number(arg("timing-n", "10"));
if (!CHROME || Object.values(WAV).some((w) => !existsSync(w))) { console.error("need Chrome and the WAVs (scripts/voice-preview-smoke-wavs.mjs)"); process.exit(2); }
if (!existsSync(path.join(repo, "dist", "index.html"))) { console.error("need a build (npm run build)"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  p360: { width: 360, height: 690, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  p402: { width: 402, height: 750, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  phone: { width: 448, height: 890, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  landscape: { width: 890, height: 360, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
};
const LAYOUT_VIEWPORTS = arg("viewports", "p360,p402,phone,landscape,desktop").split(",").filter(Boolean);

// ---------------------------------------------------------------- processes

let browser = null;
let profile = null;
let devServer = null;
let httpServer = null;
function closeBrowserHard() {
  const bp = browser?.process?.()?.pid;
  if (bp) { try { execFileSync("taskkill", ["/pid", String(bp), "/T", "/F"], { stdio: "ignore" }); } catch { /* closed */ } }
  browser = null;
  if (profile) { try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ } profile = null; }
}
function cleanup() {
  if (devServer?.pid) { try { execFileSync("taskkill", ["/pid", String(devServer.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } devServer = null; }
  closeBrowserHard();
  try { httpServer?.close(); } catch { /* closed */ }
}
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const results = [];
const warns = [];
let scope = "";
const check = (name, ok, detail = "") => {
  results.push({ name: `[${scope}] ${name}`, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${scope}] ${name}${detail ? `  (${detail})` : ""}`);
};
// a synthetic input that did not arrive and was repeated once (listed in the summary)
const warn = (name, detail = "") => {
  warns.push(`[${scope}] ${name}${detail ? `  (${detail})` : ""}`);
  console.log(`WARN  [${scope}] ${name}${detail ? `  (${detail})` : ""}`);
};

// A static server for dist/ under /Syrinx/ that logs every request path.
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".onnx": "application/octet-stream" };
const served = [];
let corruptSimd = false; // the fallback part: serve a SIMD .wasm that fails to compile
function startStatic() {
  const root = path.join(repo, "dist");
  httpServer = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    served.push(u.pathname);
    let p = decodeURIComponent(u.pathname.replace(/^\/Syrinx\/?/, "/"));
    let f = path.join(root, p);
    if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(f) || statSync(f).isDirectory()) f = path.join(root, "index.html");
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    let body = readFileSync(f);
    if (corruptSimd && path.basename(f) === simdWasm) { body = Buffer.from(body); body.fill(0xff, 8, 64); } // valid magic, broken sections
    res.end(body);
  });
  return new Promise((r) => httpServer.listen(PORT, "127.0.0.1", r));
}
const isVp = (p) => /VoicePreviewCard|vp-worker|vp_world/.test(p);
const wasmName = (p) => p.split("/").pop();
const distWasm = readdirSync(path.join(repo, "dist", "assets")).filter((f) => /^vp_world-.*\.wasm$/.test(f))
  .map((f) => ({ f, size: statSync(path.join(repo, "dist", "assets", f)).size }));
const simdWasm = distWasm.sort((a, b) => b.size - a.size)[0]?.f; // the SIMD build is the larger (115 874 B vs 111 276 B)

async function launch(wav) {
  if (browser) { await browser.close().catch(() => {}); closeBrowserHard(); }
  profile = mkdtempSync(path.join(tmpdir(), "vp-smoke-"));
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: profile,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
  });
}

async function open(viewport, base = `http://127.0.0.1:${PORT}/Syrinx/`) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORTS[viewport]);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  // worker console errors: puppeteer reports worker exceptions as pageerror; console.error
  // calls inside workers are collected here explicitly
  page.on("workercreated", (w) => w.on("console", (m) => { if (m.type() === "error") errors.push(`[worker ${w.url().split("/").pop()}] ${m.text()}`); }));
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.bringToFront();
  return { page, errors, cdp };
}

const clickButton = (page, texts, sel = "button") => page.evaluate((ts, sel) => {
  const b = [...document.querySelectorAll(sel)].find((x) => ts.some((t) => x.textContent.trim() === t || x.textContent.trim().includes(t)));
  if (b) b.click();
  return !!b;
}, texts, sel);
const clickSel = (page, sel) => page.evaluate((sel) => { const b = document.querySelector(sel); if (b) b.click(); return !!b; }, sel);

async function startListening(page, direction = "exploring") {
  await page.waitForFunction(() => /Welcome to Syrinx|What are you trying to sound like/.test(document.body.innerText), { timeout: 60000 });
  if (await page.evaluate(() => document.body.innerText.includes("Welcome to Syrinx"))) {
    await clickButton(page, ["Get Started"]);
    await page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
  }
  await page.evaluate((id) => { document.querySelector(`[role=dialog] input[data-direction="${id}"]`)?.closest("label")?.click(); }, direction);
  await sleep(200);
  await clickButton(page, ["Continue"], "[role=dialog] button");
  await page.waitForFunction(() => document.body.innerText.includes("Stop Listening"), { timeout: 30000 });
  return Date.now();
}
const openLab = async (page) => {
  await clickButton(page, ["Resonance lab"]);
  await page.waitForSelector("[data-lab-view]", { timeout: 30000 });
};
const openPreview = async (page) => {
  await clickSel(page, '[data-lab-view="preview"]');
  await page.waitForSelector("[data-voice-preview]", { timeout: 30000 });
};
const vp = (page) => page.evaluate(() => {
  const c = document.querySelector("[data-voice-preview]");
  if (!c) return null;
  const d = { ...c.dataset };
  d.status = c.querySelector("[data-vp-status]")?.textContent ?? "";
  d.record = c.querySelector("[data-vp-record]")?.textContent ?? "";
  d.recordInactive = c.querySelector("[data-vp-record]")?.getAttribute("aria-disabled") === "true";
  d.live = c.querySelector("[data-vp-live]")?.textContent.trim() ?? "";
  d.notices = [...c.querySelectorAll("[data-vp-notice]")].map((n) => n.dataset.vpNotice);
  d.text = c.innerText;
  return d;
});
const waitVp = (page, pred, label, timeout = 30000) => page.waitForFunction(pred, { timeout, polling: 100 }).then(() => true, () => { log(`timeout: ${label}`); return false; });
const phaseIs = (page, ph, timeout) => waitVp(page, `document.querySelector("[data-voice-preview]")?.dataset.vpPhase === ${JSON.stringify(ph)}`, `phase ${ph}`, timeout);
const recordReady = (page, timeout = 20000) => waitVp(page, () => { const b = document.querySelector("[data-vp-record]"); return !!b && b.getAttribute("aria-disabled") !== "true" && b.textContent.trim() === "Record"; }, "record ready", timeout);

// ---------------------------------------------------------------- memory census
// What a JS context holds after a forced GC, so "Discard frees memory" is checked on what
// the page and the worker actually keep:
//   page:   AudioBuffer objects (the playback sources; CDP Runtime.queryObjects by
//           prototype) and V8's heap and array-buffer backing store (Runtime.getHeapUsage;
//           the controller's original / rebuild / preview Float32Arrays live there —
//           queryObjects does not list typed arrays in Chrome 155, checked);
//   worker: WebAssembly.Memory instances and their size (the WORLD heap; it never shrinks,
//           so Discard terminates the worker and a fresh one starts at the initial size).
async function census(session, protoExpr, fn) {
  const { result: proto } = await session.send("Runtime.evaluate", { expression: protoExpr });
  const { objects } = await session.send("Runtime.queryObjects", { prototypeObjectId: proto.objectId, objectGroup: "vp-census" });
  const { result } = await session.send("Runtime.callFunctionOn", { objectId: objects.objectId, functionDeclaration: fn, returnByValue: true });
  await session.send("Runtime.releaseObjectGroup", { objectGroup: "vp-census" });
  await session.send("Runtime.releaseObject", { objectId: proto.objectId }).catch(() => {});
  return result.value;
}
async function pageMem(cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  const audio = await census(cdp, "AudioBuffer.prototype", "function () { return { n: this.length, bytes: this.reduce((s, b) => s + b.length * b.numberOfChannels * 4, 0) }; }");
  await cdp.send("HeapProfiler.collectGarbage");
  const hu = await cdp.send("Runtime.getHeapUsage");
  return { audio, heap: hu.usedSize, backing: hu.backingStorageSize ?? null };
}
const vpWorkers = (page) => page.workers().filter((w) => /vp-worker/.test(w.url()));
async function workerMem(page) {
  const ws = vpWorkers(page);
  if (ws.length !== 1) return { workers: ws.length, n: null, bytes: null };
  const r = await census(ws[0].client, "WebAssembly.Memory.prototype", "function () { return { n: this.length, bytes: this.reduce((s, m) => s + m.buffer.byteLength, 0) }; }");
  return { workers: 1, ...r };
}
const MB = (b) => (b / 1048576).toFixed(1);
const memLine = (m) => `AudioBuffers ${m.audio.n} (${MB(m.audio.bytes)} MB), V8 heap ${MB(m.heap)} MB, array-buffer backing ${m.backing != null ? `${MB(m.backing)} MB` : "n/a"}`;

// Every live-region text, in order (installed per page).
const watchLive = (page) => page.evaluate(() => {
  window.__vpLive = [];
  let last = "";
  const tick = () => {
    const t = document.querySelector("[data-vp-live]")?.textContent.trim() ?? "";
    const seq = document.querySelector("[data-vp-live]")?.textContent ?? "";
    if (seq !== last) { last = seq; if (t) window.__vpLive.push(t); }
  };
  new MutationObserver(tick).observe(document.body, { subtree: true, childList: true, characterData: true });
});
const liveLog = (page) => page.evaluate(() => window.__vpLive ?? []);

// ---------------------------------------------------------------- in-page measurements

function measureLayout() {
  const card = document.querySelector("[data-voice-preview]");
  let sc = card.parentElement;
  while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
  const out = { scrollW: document.documentElement.scrollWidth, innerW: innerWidth, innerH: innerHeight };
  if (sc) sc.scrollTop = 0;
  window.scrollTo(0, 0);
  const area = sc ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
  const vis = (el) => { if (!el) return false; const b = el.getBoundingClientRect(); return b.height > 0 && b.top >= Math.max(0, area.top) - 0.5 && b.bottom <= Math.min(innerHeight, area.bottom) + 0.5 && b.left >= -0.5 && b.right <= innerWidth + 0.5; };
  out.firstScreen = { heading: vis(card.querySelector("h3")), status: vis(card.querySelector("[data-vp-status]")), record: vis(card.querySelector("[data-vp-record]")) };
  // every control reachable by scrolling the lab area, and on top there
  const controls = [...card.querySelectorAll("button, input")];
  const unreachable = [];
  for (const el of controls) {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const b = el.getBoundingClientRect();
    const a2 = sc ? sc.getBoundingClientRect() : area;
    const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
    const hit = document.elementFromPoint(cx, cy);
    if (!(b.top >= a2.top - 0.5 && b.bottom <= a2.bottom + 0.5 && b.bottom <= innerHeight + 0.5 && hit && (hit === el || el.contains(hit)))) {
      unreachable.push(el.textContent.trim() || el.id || el.type);
    }
  }
  out.unreachable = unreachable;
  if (sc) sc.scrollTop = 0;
  // clipped text: overflowing boxes that clip, or text past the card's edges
  const cb = card.getBoundingClientRect();
  out.clipped = [...card.querySelectorAll("*")].filter((e) => {
    if (e.closest(".sr-only")) return false;
    const cs = getComputedStyle(e);
    const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) return false;
    const b = e.getBoundingClientRect();
    return (cs.overflowX !== "visible" && e.scrollWidth > e.clientWidth + 1) || (cs.overflowY !== "visible" && e.scrollHeight > e.clientHeight + 1)
      || b.left < cb.left - 0.5 || b.right > cb.right + 0.5;
  }).map((e) => e.textContent.trim().slice(0, 40));
  // targets
  const phone = matchMedia("(width < 40rem), (height < 30rem)").matches || navigator.maxTouchPoints > 0;
  out.smallTargets = [];
  for (const el of controls) {
    const b = el.getBoundingClientRect();
    const big = el.matches("[data-vp-record], [data-vp-play-version], [data-vp-loop], [data-vp-stop]");
    const need = big && phone ? 44 : 24;
    if (el.type === "range" ? b.height < 44 - 0.5 : (b.width < need - 0.5 || b.height < need - 0.5)) out.smallTargets.push(`${el.textContent.trim() || el.type} ${b.width.toFixed(0)}x${b.height.toFixed(0)}`);
  }
  out.colorScheme = getComputedStyle(card).colorScheme;
  out.rangeScheme = [...card.querySelectorAll("input")].map((i) => getComputedStyle(i).colorScheme);
  return out;
}

function measureContrast() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const rgba = (c) => {
    if (!c || c === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  };
  const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => { const ch = []; for (let e = el; e; e = e.parentElement) ch.push(e); let bg = { r: 255, g: 255, b: 255, a: 1 }; for (const e of ch.reverse()) { const c = rgba(getComputedStyle(e).backgroundColor); if (c.a > 0) bg = over(c, bg); } return bg; };
  const opOf = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  const card = document.querySelector("[data-voice-preview]");
  let min = Infinity, worst = "", n = 0;
  for (const el of card.querySelectorAll("*")) {
    if (el.closest(".sr-only") || el.closest('[aria-disabled="true"]')) continue;
    const t = [...el.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent).join("").trim();
    if (!t) continue;
    n++;
    const bg = bgOf(el), fg0 = rgba(getComputedStyle(el).color), fg = over({ ...fg0, a: fg0.a * opOf(el) }, bg);
    const q = ratio(fg, bg);
    if (q < min) { min = q; worst = t.slice(0, 40); }
  }
  return { min: +min.toFixed(2), worst, n };
}

// Screen-reader wiring: labels, valuetext, pressed state, reasons that resolve to visible text.
function measureA11y() {
  const card = document.querySelector("[data-voice-preview]");
  const out = {};
  const h = document.getElementById(card.getAttribute("aria-labelledby"));
  out.section = card.tagName === "SECTION" && !!h && h.textContent.startsWith("Voice preview");
  out.sliders = [...card.querySelectorAll("input[type=range]")].map((i) => ({
    label: document.querySelector(`label[for="${CSS.escape(i.id)}"]`)?.textContent ?? null, valuetext: i.getAttribute("aria-valuetext"),
    described: (i.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? null) }));
  out.live = card.querySelector("[role=status]") ? card.querySelector("[role=status]").getAttribute("class").includes("sr-only") : null;
  out.pressed = [...card.querySelectorAll("[data-vp-play-version], [data-vp-loop]")].every((b) => b.hasAttribute("aria-pressed"));
  out.reasons = [...card.querySelectorAll('[aria-disabled="true"]')].map((b) => ({
    btn: b.textContent.trim(),
    reasons: (b.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id) => { const e = document.getElementById(id); return e && e.getClientRects().length > 0 ? e.textContent.trim() : null; }),
  }));
  out.about = card.querySelector("[data-vp-about-toggle]")?.getAttribute("aria-label");
  return out;
}

const GENDER = /\b(male|female|man|men|woman|women|masc\w*|femin\w*|gender\w*|girl|boy|lady|guy)\b/i;

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}
async function shotCard(page, name) {
  // the whole card, scrolled through: one screenshot per screenful of the lab area
  const steps = await page.evaluate(() => {
    const card = document.querySelector("[data-voice-preview]");
    let sc = card.parentElement;
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    window.__vpSc = sc;
    return sc ? Math.max(1, Math.ceil(sc.scrollHeight / sc.clientHeight)) : 1;
  });
  for (let i = 0; i < Math.min(steps, 4); i++) {
    await page.evaluate((i) => { const sc = window.__vpSc; if (sc) sc.scrollTop = i * sc.clientHeight * 0.9; }, i);
    await sleep(150);
    await shot(page, `${name}${i ? `-${i + 1}` : ""}`);
  }
  await page.evaluate(() => { if (window.__vpSc) window.__vpSc.scrollTop = 0; });
}

// The lab's Resonance view at a phone viewport: all four cards above the Stop Listening row.
const phoneFit = (page) => page.evaluate(() => {
  const area = document.querySelector("[data-lab-phone]");
  const cards = [...document.querySelectorAll("[data-lab-phone] section")];
  const stop = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Stop Listening"));
  const barTop = stop ? stop.parentElement.getBoundingClientRect().top : null;
  const de = document.documentElement;
  return { phone: !!area, scrollH: area?.scrollHeight, clientH: area?.clientHeight, barTop, bottoms: cards.map((c) => +c.getBoundingClientRect().bottom.toFixed(1)),
    doc: { scrollH: de.scrollHeight, innerH: innerHeight, scrollW: de.scrollWidth, innerW: innerWidth } };
});

/** Record until auto-stop (or stopAfterMs), wait for the preview. Returns the card state. */
async function recordToPreview(page, { stopAfterMs = null } = {}) {
  await recordReady(page, 30000);
  const t0 = Date.now();
  await clickSel(page, "[data-vp-record]");
  await phaseIs(page, "recording", 5000);
  if (stopAfterMs) { await sleep(stopAfterMs); await clickSel(page, "[data-vp-record]"); }
  await phaseIs(page, "analysing", 15000);
  const tStop = Date.now();
  const ok = await phaseIs(page, "preview", 30000);
  const st = await vp(page);
  return { ok, st, recordMs: tStop - t0, endToEndMs: Date.now() - tStop };
}

// ---------------------------------------------------------------- parts

async function partLayout() {
  await launch(WAV.clean);
  for (const v of LAYOUT_VIEWPORTS) {
    scope = `layout ${v}`;
    const { page, errors, cdp } = await open(v);
    const before = served.length;
    await startListening(page);
    await openLab(page);
    await sleep(2500);
    const vpBefore = served.slice(before).filter(isVp);
    check("lab open on Resonance: nothing of the voice preview requested", vpBefore.length === 0, vpBefore.join(", "));
    if (v === "p360" || v === "p402") {
      await page.waitForFunction(() => document.querySelectorAll("[data-lab-phone] section").length === 4, { timeout: 30000 }).catch(() => {});
      await sleep(1000);
      const f = await phoneFit(page);
      check("the lab's Resonance view still fits its four cards above Stop Listening, no scroll",
        f.phone && f.bottoms.length === 4 && f.scrollH <= f.clientH + 1 && f.bottoms.every((b) => b <= f.barTop + 0.5) && f.doc.scrollH <= f.doc.innerH + 1 && f.doc.scrollW <= f.doc.innerW, JSON.stringify(f));
      await shot(page, `${v}-dark-lab-resonance`);
    }
    const mark = served.length;
    await openPreview(page);
    const ready = await waitVp(page, () => ["ready"].includes(document.querySelector("[data-voice-preview]")?.dataset.vpPhase), "card ready", 20000);
    await sleep(500);
    const req = served.slice(mark).filter(isVp);
    const wasm = req.filter((p) => p.endsWith(".wasm"));
    const st0 = await vp(page);
    check("view opened: card chunk, worker, glue, exactly one .wasm (the SIMD build)", ready && req.some((p) => /VoicePreviewCard/.test(p)) && req.some((p) => /vp-worker/.test(p))
      && req.some((p) => /vp_world-.*\.mjs$/.test(p)) && wasm.length === 1 && wasmName(wasm[0]) === simdWasm && st0.vpBuild === "simd", `${req.map(wasmName).join(", ")}; build ${st0.vpBuild}`);
    await shot(page, `${v}-dark-ready`);
    const memBase = await pageMem(cdp);
    const wBase = await workerMem(page);
    const rec = await recordToPreview(page);
    check("recorded, auto-stopped at 8 s, preview ready", rec.ok && Math.abs(Number(rec.st.vpSeconds) - 8) < 0.01, `${rec.st.vpSeconds} s, ${rec.st.vpRate} Hz, stop -> preview ${rec.endToEndMs} ms`);
    check("clean recording: no hum or noise notice", rec.st.vpHum === "false" && rec.st.vpNoise === "false" && rec.st.notices.length === 0, `margin ${rec.st.vpMargin} dB`);
    for (const scheme of ["dark", "light"]) {
      scope = `layout ${v} ${scheme}`;
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
      await sleep(300);
      const L = await page.evaluate(measureLayout);
      check("no horizontal page scroll", L.scrollW <= L.innerW, `${L.scrollW} > ${L.innerW}`);
      check("heading, status line and Record visible at scrollTop 0", L.firstScreen.heading && L.firstScreen.status && L.firstScreen.record, JSON.stringify(L.firstScreen));
      check("every control reachable by scrolling, on top there", L.unreachable.length === 0, L.unreachable.join(", "));
      check("no clipped text", L.clipped.length === 0, L.clipped.join(" | "));
      check("targets (Record / Play >= 44x44 on phones, others >= 24x24, ranges 44 px tall)", L.smallTargets.length === 0, L.smallTargets.join(", "));
      check("computed color-scheme dark (card and its inputs)", L.colorScheme === "dark" && L.rangeScheme.every((s) => s === "dark"), `${L.colorScheme} / ${L.rangeScheme.join(",")}`);
      const C = await page.evaluate(measureContrast);
      check("text >= 4.5:1 against the card", C.min >= 4.5, JSON.stringify(C));
      await shotCard(page, `${v}-${scheme}-preview`);
    }
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
    if (v === "phone" || v === "p360") {
      // the about panel and the target row, open
      await clickSel(page, "[data-vp-about-toggle]");
      await sleep(200);
      await shot(page, `${v}-dark-about`);
      await clickSel(page, "[data-vp-about-toggle]");
      await clickSel(page, '[data-vp-preset="target"]');
      await sleep(200);
      await page.evaluate(() => document.querySelector("[data-vp-target]")?.scrollIntoView({ block: "center" }));
      await shot(page, `${v}-dark-target-row`);
      await clickSel(page, '[data-vp-preset="target"]');
    }
    scope = `layout ${v}`;
    const text = (await vp(page)).text;
    check("no gender words in the card", !GENDER.test(text), (text.match(GENDER) ?? [""])[0]);
    await interact(page, cdp, v, memBase, wBase);
    check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.close();
  }
}

// Per viewport, with the input the viewport has (touch on the phone viewports, the mouse on
// desktop): both sliders dragged to their ends (the release commits ONE render, matching the
// slider), every quick setting and the target row render, each playback button plays, then
// Discard frees the recording's memory (page and worker census against before the recording).
async function interact(page, cdp, v, memBase, wBase) {
  const touch = !!VIEWPORTS[v].hasTouch;
  const how = touch ? "tap" : "click";
  await watchLive(page);
  // what is under a point (for the WARN lines): the element and whether it is the target
  const hitAt = (el, x, y) => el.evaluate((t, x, y) => {
    const e = document.elementFromPoint(x, y);
    return { onTarget: !!e && (e === t || t.contains(e)), what: e ? `${e.tagName.toLowerCase()} "${(e.textContent || "").trim().slice(0, 24)}"` : "nothing" };
  }, x, y);
  const press = async (sel) => {
    const el = await page.$(sel);
    if (!el) return { hit: null };
    await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await sleep(150);
    const b = await el.boundingBox();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const hit = await hitAt(el, cx, cy);
    if (touch) await page.touchscreen.tap(cx, cy); else await page.mouse.click(cx, cy);
    await el.dispose();
    return { hit, at: [Math.round(cx), Math.round(cy)] };
  };
  const inputsAre = (st, pct, ms = 2000) => waitVp(page, `(() => { const q = (k) => document.querySelector('[data-vp-slider="' + k + '"] input'); return Number(q("pitch").value) === ${st} && Number(q("resonance").value) === ${pct}; })()`, `inputs ${st},${pct}`, ms);
  const settled = (want) => waitVp(page, `(() => { const c = document.querySelector("[data-voice-preview]"); return c?.dataset.vpRendered === ${JSON.stringify(want)} && c.dataset.vpRendering === "0"; })()`, `render ${want}`, 15000);
  const inputs = () => page.evaluate(() => {
    const q = (k) => document.querySelector(`[data-vp-slider="${k}"] input`);
    return { st: Number(q("pitch").value), pct: Number(q("resonance").value), stMin: Number(q("pitch").min), stMax: Number(q("pitch").max), pctMin: Number(q("resonance").min), pctMax: Number(q("resonance").max) };
  });
  const lim0 = await inputs();
  const lim = { stMin: lim0.stMin, stMax: lim0.stMax, pctMin: lim0.pctMin, pctMax: lim0.pctMax };
  check("slider limits: pitch min in [-12, 0] (low-contour rule), max +12; resonance -21 .. +26", lim.stMax === 12 && lim.stMin >= -12 && lim.stMin <= 0 && lim.pctMin === -21 && lim.pctMax === 26, JSON.stringify(lim));

  // drag a slider from its thumb past an end: mouse down / move / up, or touch start / move / end
  async function drag(which, toEnd) {
    const el = await page.$(`[data-vp-slider="${which}"] input`);
    await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await sleep(150);
    const b = await el.boundingBox();
    const cur = await el.evaluate((e) => (Number(e.value) - Number(e.min)) / (Number(e.max) - Number(e.min)));
    const thumb = 8; // about half the thumb: the track's usable span is the width minus one thumb
    const x0 = b.x + thumb + cur * (b.width - 2 * thumb);
    const x1 = toEnd > 0 ? b.x + b.width + 20 : b.x - 20;
    const y = b.y + b.height / 2;
    await page.evaluate(() => { window.__vpLive.length = 0; });
    const before = await inputs();
    // drag, stop, lift: a release while still moving (a flick) starts a fling in Chrome, and
    // the next tap then only stops the fling — at 890 x 360 that swallowed the first tap on
    // a quick setting every time (verify step, 2026-10-19); a 250 ms hold removed it
    const gesture = async () => {
      if (touch) {
        await page.touchscreen.touchStart(x0, y);
        for (let i = 1; i <= 8; i++) { await page.touchscreen.touchMove(x0 + ((x1 - x0) * i) / 8, y); await sleep(16); }
        await sleep(250);
        await page.touchscreen.touchEnd();
      } else {
        await page.mouse.move(x0, y);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++) { await page.mouse.move(x0 + ((x1 - x0) * i) / 8, y); await sleep(16); }
        await sleep(250);
        await page.mouse.up();
      }
      await sleep(150);
    };
    const hit = await hitAt(el, x0, y);
    await gesture();
    let after = await inputs();
    if (after.st === before.st && after.pct === before.pct) {
      warn(`${which} slider: the ${touch ? "touch" : "mouse"} drag did not move it; repeated once`, `start ${Math.round(x0)},${Math.round(y)} on ${hit.what}${hit.onTarget ? " (the slider)" : " (NOT the slider)"}`);
      await gesture();
      after = await inputs();
    }
    await el.dispose();
    const want = `${after.st},${after.pct}`;
    const ok = await settled(want);
    await sleep(500); // a second render would show in the live log
    const renders = (await liveLog(page)).filter((t) => t === "Updating the preview…").length;
    return { ok, after, want, renders };
  }
  for (const [which, end, field, limKey] of [["pitch", 1, "st", "stMax"], ["resonance", -1, "pct", "pctMin"], ["pitch", -1, "st", "stMin"], ["resonance", 1, "pct", "pctMax"]]) {
    const r = await drag(which, end);
    check(`${which} slider ${touch ? "touch" : "mouse"}-dragged to its ${end > 0 ? "top" : "bottom"} end -> one render on release, matching the slider`,
      r.ok && r.after[field] === lim[limKey] && r.renders === 1, `${r.want}; ${r.renders} render(s)`);
  }

  // quick settings, in an order where each one changes the setting
  let cur = await inputs();
  for (const k of ["higherBrighter", "pitchOnly", "lowerDarker", "resonanceOnly", "unchanged"]) {
    const exp = applyPreset(k, { st: cur.st, pct: cur.pct }, lim);
    const pr = await press(`[data-vp-preset="${k}"]`);
    if (!(await inputsAre(exp.st, exp.pct))) {
      warn(`quick setting ${k}: the ${how} did not arrive; repeated once`, `at ${pr.at} on ${pr.hit?.what}${pr.hit?.onTarget ? " (the button)" : " (NOT the button)"}`);
      await press(`[data-vp-preset="${k}"]`);
    }
    const ok = await settled(`${exp.st},${exp.pct}`);
    cur = await inputs();
    check(`quick setting ${k} (${how}) -> ${exp.st},${exp.pct} rendered`, ok && cur.st === exp.st && cur.pct === exp.pct, `${cur.st},${cur.pct}`);
  }
  // the target row: type a pitch, Apply
  await press('[data-vp-preset="target"]');
  await sleep(250);
  await page.evaluate(() => { const i = document.querySelector("[data-vp-target] input"); i.focus(); i.select(); });
  await page.keyboard.type("240"); // about +5 st above the clean phrase's ~182 Hz median, so a render must follow
  await press("[data-vp-apply]");
  await sleep(300);
  cur = await inputs();
  const tr = await page.$eval("[data-vp-target-result]", (e) => e.textContent).catch(() => "");
  check(`target row (${how} Apply, 240 Hz) -> a raised setting rendered`, (await settled(`${cur.st},${cur.pct}`)) && /^Set to /.test(tr) && cur.st > 0, `${tr}; ${cur.st},${cur.pct}`);
  await press('[data-vp-preset="target"]'); // close the row

  // playback: each version plays with the AudioContext running; loop; stop
  for (const which of ["preview", "rebuild", "original"]) {
    await press(`[data-vp-play-version="${which}"]`);
    const ok = await waitVp(page, `(() => { const c = document.querySelector("[data-voice-preview]"); return c?.dataset.vpPlaying === ${JSON.stringify(which)} && c.dataset.vpAudio === "running"; })()`, `play ${which}`, 5000);
    check(`Play ${which} (${how}) -> plays, AudioContext running`, ok);
  }
  await press("[data-vp-loop]");
  await sleep(150);
  check(`Loop (${how}) -> aria-pressed`, await page.$eval("[data-vp-loop]", (b) => b.getAttribute("aria-pressed") === "true"));
  for (const scheme of ["dark", "light"]) {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
    await sleep(150);
    await page.evaluate(() => document.querySelector("[data-vp-play]")?.scrollIntoView({ block: "center" }));
    await shot(page, `${v}-${scheme}-playing`);
  }
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await press("[data-vp-stop]");
  const stopped = await waitVp(page, () => { const c = document.querySelector("[data-voice-preview]"); return c?.dataset.vpPlaying === "" && c.dataset.vpAudio === "suspended"; }, "stopped", 5000);
  check(`Stop (${how}) -> nothing plays, AudioContext suspended`, stopped);
  await press("[data-vp-loop]");

  // Discard frees the recording's memory
  const memPeak = await pageMem(cdp);
  const wPeak = await workerMem(page);
  const oldWorker = vpWorkers(page)[0];
  await press("[data-vp-discard]");
  await phaseIs(page, "ready", 15000);
  await sleep(800);
  const memAfter = await pageMem(cdp);
  const wAfter = await workerMem(page);
  log(`memory ${v}: before recording: ${memLine(memBase)}; worker WebAssembly ${MB(wBase.bytes)} MB`);
  log(`memory ${v}: preview + playback: ${memLine(memPeak)}; worker WebAssembly ${MB(wPeak.bytes)} MB`);
  log(`memory ${v}: after Discard: ${memLine(memAfter)}; worker WebAssembly ${MB(wAfter.bytes)} MB`);
  check("Discard: the old worker target is gone, one fresh worker", !vpWorkers(page).includes(oldWorker) && wAfter.workers === 1, `${vpWorkers(page).length} worker(s)`);
  check("Discard: the fresh worker's WebAssembly memory is back at the initial size", wBase.bytes > 0 && wAfter.bytes === wBase.bytes && wPeak.bytes > wBase.bytes,
    `${MB(wBase.bytes)} -> ${MB(wPeak.bytes)} -> ${MB(wAfter.bytes)} MB`);
  // the recording's PCM (original + rebuild + preview Float32Arrays, 8 s each here) must go
  check("Discard: the recording's PCM released (array-buffer backing back within 256 KB of before the recording)",
    memBase.backing != null && memPeak.backing - memBase.backing > 3 * 3 * 44100 * 4 && memAfter.backing <= memBase.backing + 262144,
    `${MB(memBase.backing)} -> ${MB(memPeak.backing)} -> ${MB(memAfter.backing)} MB`);
  // the playback's AudioBuffers (one per version played) must go too
  check("Discard: no AudioBuffer left on the page (playback sources released)", memPeak.audio.n >= 3 && memAfter.audio.n === memBase.audio.n,
    `${memBase.audio.n} -> ${memPeak.audio.n} -> ${memAfter.audio.n}${memAfter.audio.n > memBase.audio.n ? `; ${MB(memAfter.audio.bytes)} MB still held` : ""}`);
  await shot(page, `${v}-dark-after-discard`);
}


async function partFlow() {
  scope = "flow";
  await launch(WAV.clean);
  const { page, errors } = await open("desktop");
  await startListening(page, "feminine");
  await openLab(page);
  await openPreview(page);
  await watchLive(page);
  // Record waits for 6 s of listening
  await phaseIs(page, "ready", 20000);
  const early = await vp(page);
  check("Record waits for 6 s of listening (countdown shown)", early.recordInactive && /Ready to record in \d s/.test(early.status), early.status);
  await recordReady(page);

  // too short
  await clickSel(page, "[data-vp-record]");
  await phaseIs(page, "recording", 5000);
  await sleep(1000);
  const mid = await vp(page);
  check("recording: Stop, timer, level bar", mid.record === "Stop" && /Recording… \d s of 8/.test(mid.status) && await page.$("[data-vp-level]") !== null, mid.status);
  await shot(page, "desktop-dark-recording");
  await sleep(1000);
  await clickSel(page, "[data-vp-record]");
  const tooShort = await phaseIs(page, "too-short", 5000);
  const ts = await vp(page);
  check("a stop at 2 s -> too short, Record available again", tooShort && ts.status.startsWith("That was under 3 seconds.") && ts.record === "Record" && !ts.recordInactive, ts.status);

  // a full recording, stopped by the user after ~5 s
  const rec = await recordToPreview(page, { stopAfterMs: 5200 });
  check("user stop after ~5 s -> preview ready", rec.ok && Number(rec.st.vpSeconds) > 5 && Number(rec.st.vpSeconds) < 6, `${rec.st.vpSeconds} s; stop -> preview ${rec.endToEndMs} ms; analysis + rebuild ${rec.st.vpAnalysisMs} ms`);
  check("first render is the unchanged rebuild; Preview waits for a change (reason shown)", rec.st.vpRendered === ""
    && await page.$eval('[data-vp-play-version="preview"]', (b) => b.getAttribute("aria-disabled") === "true" && document.getElementById(b.getAttribute("aria-describedby"))?.textContent === "Move a slider or pick a quick setting to hear a change."));
  await shot(page, "desktop-dark-preview-ready");

  // keyboard order
  const order = await page.evaluate(async () => {
    const card = document.querySelector("[data-voice-preview]");
    card.querySelector("[data-vp-record]").focus();
    const seq = [];
    for (let i = 0; i < 20; i++) {
      const a = document.activeElement;
      if (!card.contains(a)) break;
      seq.push(a.dataset.vpRecord !== undefined ? "record" : a.type === "range" ? `range:${a.closest("[data-vp-slider]").dataset.vpSlider}`
        : a.dataset.vpPreset ? `preset:${a.dataset.vpPreset}` : a.dataset.vpPlayVersion ? `play:${a.dataset.vpPlayVersion}`
          : a.dataset.vpLoop !== undefined ? "loop" : a.dataset.vpStop !== undefined ? "stop" : a.dataset.vpDiscard !== undefined ? "discard" : a.dataset.vpDownload !== undefined ? "download" : a.tagName);
      // move focus as Tab does: the next focusable element in document order
      const all = [...document.querySelectorAll("button, input, [tabindex]")].filter((e) => e.tabIndex >= 0 && !e.disabled && e.getClientRects().length);
      all[all.indexOf(a) + 1]?.focus();
    }
    return seq;
  });
  const want = ["record", "range:pitch", "range:resonance", "preset:higherBrighter", "preset:lowerDarker", "preset:pitchOnly", "preset:resonanceOnly", "preset:target", "preset:unchanged",
    "play:rebuild", "play:preview", "play:original", "loop", "stop", "discard", "download"];
  check("Tab order: Record, sliders, quick settings, Play group, Discard / Download", JSON.stringify(order) === JSON.stringify(want), order.join(" > "));
  // real Tab key presses from Record reach the pitch slider next
  await page.focus("[data-vp-record]");
  await page.keyboard.press("Tab");
  check("Tab from Record lands on the pitch slider", await page.evaluate(() => document.activeElement?.closest("[data-vp-slider]")?.dataset.vpSlider === "pitch"));

  // arrow keys: labels follow at once, ONE render 400 ms after the last key
  const median = Number((await page.$eval("[data-vp-median]", (e) => e.textContent)).match(/about (\d+) Hz/)[1]);
  await page.focus('[data-vp-slider="pitch"] input');
  await page.keyboard.press("ArrowRight");
  await sleep(150);
  await page.keyboard.press("ArrowRight");
  await sleep(200);
  const mid2 = await page.evaluate(() => ({ vt: document.querySelector('[data-vp-slider="pitch"] input').getAttribute("aria-valuetext"), rendering: document.querySelector("[data-voice-preview]").dataset.vpRendering, rendered: document.querySelector("[data-voice-preview]").dataset.vpRendered }));
  check("arrow keys: aria-valuetext follows, nothing rendered yet", /^2 semitones higher, about \d+ hertz$/.test(mid2.vt) && mid2.rendering === "0" && mid2.rendered === "", JSON.stringify(mid2));
  await waitVp(page, () => document.querySelector("[data-voice-preview]")?.dataset.vpRendered === "2,0", "render 2,0", 10000);
  const live1 = await liveLog(page);
  check("one render 400 ms after the last key (Updating -> Preview updated, once)", live1.filter((t) => t === "Updating the preview…").length === 1 && live1.filter((t) => t === "Preview updated.").length === 1, live1.join(" | "));
  const vt2 = await page.$eval('[data-vp-slider="pitch"] input', (i) => i.getAttribute("aria-valuetext"));
  check("pitch label: the median times the ratio", vt2 === `2 semitones higher, about ${Math.round(median * 2 ** (2 / 12))} hertz` || Math.abs(Number(vt2.match(/about (\d+)/)[1]) - median * 2 ** (2 / 12)) <= 1, vt2);
  await page.keyboard.press("Home");
  await sleep(100);
  const home = await page.$eval('[data-vp-slider="pitch"] input', (i) => ({ v: i.value, min: i.min, vt: i.getAttribute("aria-valuetext") }));
  check("Home -> the lowest setting, labelled \"may sound buzzier\"", home.v === home.min && /lower, about \d+ hertz, may sound buzzier$/.test(home.vt), JSON.stringify(home));
  await page.keyboard.press("End");
  await waitVp(page, () => document.querySelector("[data-voice-preview]")?.dataset.vpRendered === "12,0", "render 12,0", 10000);
  check("End -> +12 st rendered", (await vp(page)).vpRendered === "12,0");
  await page.focus('[data-vp-slider="resonance"] input');
  await page.keyboard.press("PageUp");
  await waitVp(page, () => document.querySelector("[data-voice-preview]")?.dataset.vpRendered === "12,3", "render 12,3", 10000);
  check("Page Up on resonance -> +3 %", (await page.$eval('[data-vp-slider="resonance"] input', (i) => i.getAttribute("aria-valuetext"))) === "3 percent brighter");

  // presets
  for (const [k, want2] of [["higherBrighter", "2,3"], ["lowerDarker", "-2,-3"], ["pitchOnly", "-2,0"], ["higherBrighter", "2,3"], ["resonanceOnly", "0,3"], ["unchanged", "0,0"]]) {
    await clickSel(page, `[data-vp-preset="${k}"]`);
    const ok = await waitVp(page, `document.querySelector("[data-voice-preview]")?.dataset.vpRendered === ${JSON.stringify(want2)} && document.querySelector("[data-voice-preview]")?.dataset.vpRendering === "0"`, `preset ${k}`, 10000);
    check(`preset ${k} -> ${want2}`, ok);
  }
  // the target row
  await clickSel(page, '[data-vp-preset="target"]');
  await sleep(200);
  const tr = await page.evaluate(() => ({ focused: document.activeElement?.type === "number", value: document.activeElement?.value }));
  check("target row: field focused, prefilled with the direction band's centre (205 Hz)", tr.focused && tr.value === "205", JSON.stringify(tr));
  await clickSel(page, "[data-vp-apply]");
  await sleep(300);
  const result = await page.$eval("[data-vp-target-result]", (e) => e.textContent).catch(() => "");
  const wantSt = Math.max(-12, Math.min(12, Math.round(12 * Math.log2(205 / median))));
  check("Apply -> \"Set to … st (about … Hz)\"", /^Set to [+\u22120-9]+ st \(about \d+ Hz\)(, the (highest|lowest) setting)?$/.test(result), `${result} (median ~${median} Hz, expected ~${wantSt} st)`);
  await page.focus("[data-vp-target] input");
  await page.keyboard.press("Escape");
  await sleep(150);
  check("Escape closes the row, focus back on its button", await page.evaluate(() => !document.querySelector("[data-vp-target]") && document.activeElement?.dataset.vpPreset === "target"));
  await waitVp(page, () => document.querySelector("[data-voice-preview]")?.dataset.vpRendering === "0" && document.querySelector("[data-voice-preview]")?.dataset.vpRendered !== "0,0", "target render", 10000);

  // the about toggle: Escape closes it and returns focus
  await clickSel(page, "[data-vp-about-toggle]");
  await sleep(150);
  check("About: seven paragraphs", await page.$$eval("[data-vp-about] p", (ps) => ps.length) === 7);
  await page.focus("[data-vp-about-toggle]");
  await page.keyboard.press("Escape");
  await sleep(150);
  check("About closes on Escape, focus on its button", await page.evaluate(() => !document.querySelector("[data-vp-about]") && document.activeElement?.dataset.vpAboutToggle !== undefined));

  // playback
  await page.evaluate(() => { window.__vpLive.length = 0; });
  await clickSel(page, '[data-vp-play-version="preview"]');
  await sleep(600);
  let p = await vp(page);
  check("Preview plays (AudioContext running, aria-pressed)", p.vpPlaying === "preview" && p.vpAudio === "running"
    && await page.$eval('[data-vp-play-version="preview"]', (b) => b.getAttribute("aria-pressed") === "true"), `${p.vpPlaying} ${p.vpAudio}`);
  await clickSel(page, '[data-vp-play-version="rebuild"]');
  await sleep(400);
  p = await vp(page);
  check("switch to the unchanged rebuild", p.vpPlaying === "rebuild" && p.vpAudio === "running");
  await clickSel(page, '[data-vp-play-version="original"]');
  await sleep(400);
  p = await vp(page);
  check("switch to the original", p.vpPlaying === "original" && p.vpAudio === "running");
  await clickSel(page, "[data-vp-loop]");
  await sleep(200);
  check("Loop on (aria-pressed)", await page.$eval("[data-vp-loop]", (b) => b.getAttribute("aria-pressed") === "true"));
  await shot(page, "desktop-dark-playing");
  await clickSel(page, "[data-vp-stop]");
  await sleep(300);
  p = await vp(page);
  check("Stop -> nothing plays, context suspended", p.vpPlaying === "" && p.vpAudio === "suspended", p.vpAudio);
  await clickSel(page, "[data-vp-loop]");
  await clickSel(page, '[data-vp-play-version="preview"]');
  await sleep(300);
  await clickSel(page, '[data-vp-play-version="preview"]');
  await sleep(300);
  const live2 = await liveLog(page);
  check("live region: playing / switching / loop / stop announced", ["Playing the preview.", "Playing the unchanged rebuild.", "Playing the original.", "Loop on.", "Stopped.", "Loop off."].every((t) => live2.includes(t))
    && live2.at(-1) === "Stopped.", live2.join(" | "));

  // the Dashboard session guard
  await clickButton(page, ["Dashboard"]);
  await sleep(800);
  check("Dashboard session recording started", await clickButton(page, ["Save Session"]));
  await sleep(1500);
  await openLab(page);
  await page.waitForSelector("[data-voice-preview]", { timeout: 10000 });
  await sleep(1500);
  const guard = await page.evaluate(() => {
    const c = document.querySelector("[data-voice-preview]");
    const btns = [...c.querySelectorAll("[data-vp-play-version]")];
    return { inactive: btns.every((b) => b.getAttribute("aria-disabled") === "true"), reason: c.querySelector("[data-vp-guard]")?.textContent ?? null,
      linked: btns.every((b) => (b.getAttribute("aria-describedby") ?? "").split(" ").includes(c.querySelector("[data-vp-guard]")?.id)) };
  });
  check("Play is off during a session recording, reason shown and linked", guard.inactive && guard.reason === "Playback is off while a session is being recorded, so the preview isn't saved as your voice." && guard.linked, JSON.stringify(guard));
  await clickSel(page, '[data-vp-play-version="rebuild"]');
  await sleep(300);
  check("a press does not play", (await vp(page)).vpPlaying === "");
  await shot(page, "desktop-dark-session-guard");
  await clickButton(page, ["Dashboard"]);
  await sleep(500);
  await clickButton(page, ["Stop & Save"]);
  await sleep(2500);
  await openLab(page);
  await page.waitForSelector("[data-voice-preview]", { timeout: 10000 });
  await sleep(1500);
  check("Play available again after the session", await page.$eval('[data-vp-play-version="rebuild"]', (b) => b.getAttribute("aria-disabled") !== "true"));

  // a11y wiring
  const A = await page.evaluate(measureA11y);
  check("section labelled by its heading; sliders labelled, with valuetext; live region; aria-pressed", A.section && A.sliders.length === 2 && A.sliders.every((s) => s.label && s.valuetext) && A.live === true && A.pressed, JSON.stringify(A.sliders));
  check("inactive controls give a visible reason", A.reasons.every((r) => r.reasons.length > 0 && r.reasons.every(Boolean)), JSON.stringify(A.reasons));

  // download
  const dl = mkdtempSync(path.join(tmpdir(), "vp-dl-"));
  try {
    const bcdp = await browser.target().createCDPSession();
    await bcdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl, eventsEnabled: true });
    const st = await vp(page);
    await clickSel(page, "[data-vp-download]");
    let file = null;
    for (let i = 0; i < 50 && !file; i++) { await sleep(200); file = readdirSync(dl).find((f) => f.endsWith(".wav")); }
    const b = file ? readFileSync(path.join(dl, file)) : null;
    const ok = b && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE" && b.readUInt16LE(20) === 1 && b.readUInt16LE(22) === 1 && b.readUInt16LE(34) === 16;
    const rate = b?.readUInt32LE(24), dur = b ? b.readUInt32LE(40) / 2 / rate : null;
    let rms = 0, clipped = 0;
    if (b) {
      const n = b.readUInt32LE(40) / 2;
      for (let i = 0; i < n; i++) { const x = b.readInt16LE(44 + 2 * i); rms += x * x; if (Math.abs(x) >= 32767) clipped++; }
      rms = Math.sqrt(rms / n) / 32768;
      clipped /= n;
    }
    check("Download: the samples carry sound (RMS >= 0.01, < 0.1 % at full scale)", rms >= 0.01 && clipped < 0.001, `rms ${rms.toFixed(4)}, clipped ${(clipped * 100).toFixed(3)} %`);
    const [rst, rpct] = st.vpRendered.split(",").map(Number);
    const name = `syrinx-voice-preview-${rst < 0 ? "minus" : "plus"}${Math.abs(rst)}st-${rpct < 0 ? "minus" : "plus"}${Math.abs(rpct)}pct.wav`;
    check("Download: RIFF/WAVE, 16-bit mono, engine rate, the recording's duration, the setting in the name", ok && rate === Number(st.vpRate) && Math.abs(dur - Number(st.vpSeconds)) < 0.002 && file === name,
      `${file}, ${rate} Hz, ${dur?.toFixed(3)} s vs ${st.vpSeconds} s`);
  } finally { rmSync(dl, { recursive: true, force: true }); }

  // discard: the worker goes, a fresh one comes
  const workersBefore = page.workers().filter((w) => /vp-worker/.test(w.url()));
  await page.evaluate(() => { window.__vpLive.length = 0; });
  await clickSel(page, "[data-vp-discard]");
  await phaseIs(page, "ready", 10000);
  await sleep(500);
  const workersAfter = page.workers().filter((w) => /vp-worker/.test(w.url()));
  check("Discard: the old worker target is gone, one fresh worker, back to ready", workersBefore.length === 1 && workersAfter.length === 1 && workersAfter[0] !== workersBefore[0],
    `${workersBefore.length} -> ${workersAfter.length}`);
  check("Discard: focus on Record, \"Recording discarded.\" announced", await page.evaluate(() => document.activeElement?.dataset.vpRecord !== undefined)
    && (await liveLog(page)).includes("Recording discarded."));
  await shot(page, "desktop-dark-after-discard");

  // listening stopped during a recording -> cancelled
  await recordReady(page);
  await clickSel(page, "[data-vp-record]");
  await phaseIs(page, "recording", 5000);
  await sleep(1500);
  await clickButton(page, ["Stop Listening"]);
  await sleep(1000);
  await clickButton(page, ["Start Listening"]);
  await page.waitForFunction(() => document.body.innerText.includes("Stop Listening"), { timeout: 20000 });
  await page.waitForSelector("[data-voice-preview]", { timeout: 20000 });
  await sleep(500);
  const c = await vp(page);
  check("listening stopped during a recording -> cancelled; Record waits for listening again", c.vpPhase === "cancelled" && c.status.startsWith("Recording stopped because listening was turned off.") && c.recordInactive && /Ready to record in \d s/.test(c.status), c.status);
  await shot(page, "desktop-dark-cancelled");
  const text = (await vp(page)).text;
  check("no gender words in the card", !GENDER.test(text));
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
}

async function partChecks() {
  for (const [name, wav, leadS] of [["hum", WAV.hum, 10.5], ["noise", WAV.noise, 0]]) {
    scope = `checks ${name}`;
    await launch(wav);
    const { page, errors } = await open("phone");
    const t0 = await startListening(page);
    await openLab(page);
    await openPreview(page);
    await recordReady(page);
    const wait = t0 + leadS * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    const rec = await recordToPreview(page);
    const want = name;
    check(`${name}.wav: the ${name} notice, and a preview is still made`, rec.ok && rec.st.notices.includes(want) && rec.st.text.includes("A quieter spot gives a cleaner preview."),
      `hum ${rec.st.vpHum}, noise ${rec.st.vpNoise}, margin ${rec.st.vpMargin} dB`);
    // (the hum 20 dB below the speech also lowers the level margin under 30 dB, so the noise
    // notice may show too — as the design's numbers say: hum at -20 dB measured 26.8-28.9 dB)
    await shot(page, `phone-dark-${name}-notice`);
    check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.close();
  }
}

async function partDev() {
  scope = "dev";
  devServer = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "--port", String(DEV_PORT), "--strictPort"], { cwd: repo, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 300 && !up; i++) {
    try { const r = await fetch(`http://localhost:${DEV_PORT}/Syrinx/`); up = r.ok; } catch { /* not yet */ }
    if (!up) await sleep(200);
  }
  check("dev server up", up);
  await launch(WAV.clean);
  const { page, errors } = await open("desktop", `http://localhost:${DEV_PORT}/Syrinx/`);
  // a page reload by the dev server (dependency re-optimisation) would reset the card:
  // log the server's messages and every main-frame navigation after the first
  const viteMsgs = [];
  let navs = 0;
  page.on("console", (m) => { if (/\[vite\]/.test(m.text())) viteMsgs.push(m.text().slice(0, 160)); });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) navs++; });
  const navs0 = navs;
  await startListening(page);
  await openLab(page);
  await openPreview(page);
  const ready = await waitVp(page, () => document.querySelector("[data-voice-preview]")?.dataset.vpPhase === "ready", "dev ready", 60000);
  const st = await vp(page);
  check("dev server: the ?url glue import loads, worker ready", ready && st?.vpBuild === "simd", st?.vpBuild);
  const rec = await recordToPreview(page, { stopAfterMs: 4000 });
  check("dev server: record -> preview", rec.ok, `${rec.st?.vpSeconds ?? "card gone"} s; reloads ${navs - navs0}${viteMsgs.length ? `; vite: ${viteMsgs.join(" | ")}` : ""}`);
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
  try { execFileSync("taskkill", ["/pid", String(devServer.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ }
  devServer = null;
}

// One run against `vite preview` of the same build (the task's serving path; the static
// server above logs requests but sets its own MIME types): the .wasm comes with
// application/wasm, the SIMD build loads, record -> preview -> a quick setting -> playback.
async function partPreview() {
  scope = "vite preview";
  devServer = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PREVIEW_PORT), "--strictPort"], { cwd: repo, stdio: "ignore" });
  const base = `http://localhost:${PREVIEW_PORT}/Syrinx/`;
  let up = false;
  for (let i = 0; i < 300 && !up; i++) {
    try { const r = await fetch(base); up = r.ok; } catch { /* not yet */ }
    if (!up) await sleep(200);
  }
  check("vite preview up", up);
  const wr = await fetch(`${base}assets/${simdWasm}`).catch(() => null);
  check("vite preview serves the .wasm as application/wasm", wr?.ok && wr.headers.get("content-type") === "application/wasm", wr?.headers.get("content-type") ?? "no response");
  await launch(WAV.clean);
  const { page, errors } = await open("desktop", base);
  await startListening(page);
  await openLab(page);
  await openPreview(page);
  const ready = await waitVp(page, () => document.querySelector("[data-voice-preview]")?.dataset.vpPhase === "ready", "preview ready", 60000);
  check("vite preview: worker ready with the SIMD build", ready && (await vp(page)).vpBuild === "simd");
  const rec = await recordToPreview(page, { stopAfterMs: 4000 });
  check("vite preview: record -> preview", rec.ok, `${rec.st.vpSeconds} s at ${rec.st.vpRate} Hz, stop -> preview ${rec.endToEndMs} ms`);
  await clickSel(page, '[data-vp-preset="higherBrighter"]');
  const r = await waitVp(page, () => { const c = document.querySelector("[data-voice-preview]"); return c?.dataset.vpRendered === "2,3" && c.dataset.vpRendering === "0"; }, "render 2,3", 15000);
  check("vite preview: a quick setting renders", r);
  await clickSel(page, '[data-vp-play-version="preview"]');
  check("vite preview: Play preview runs the AudioContext", await waitVp(page, () => { const c = document.querySelector("[data-voice-preview]"); return c?.dataset.vpPlaying === "preview" && c.dataset.vpAudio === "running"; }, "play", 5000));
  await clickSel(page, "[data-vp-stop]");
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
  try { execFileSync("taskkill", ["/pid", String(devServer.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ }
  devServer = null;
}

// The non-SIMD fallback in a real browser: the static server hands out a SIMD .wasm that
// fails to compile (valid magic, broken sections); the worker retries with the non-SIMD
// build, which then records, renders and plays.
async function partFallback() {
  scope = "fallback";
  corruptSimd = true;
  try {
    await launch(WAV.clean);
    const { page, errors } = await open("desktop");
    await startListening(page);
    await openLab(page);
    const mark = served.length;
    await openPreview(page);
    const ready = await waitVp(page, () => document.querySelector("[data-voice-preview]")?.dataset.vpPhase === "ready", "fallback ready", 30000);
    await sleep(500);
    const wasm = served.slice(mark).filter((x) => x.endsWith(".wasm")).map(wasmName);
    const nosimd = distWasm.find((d) => d.f !== simdWasm)?.f;
    const st = await vp(page);
    check("a SIMD build that fails to compile -> the non-SIMD build loads (one fetch of it)", ready && st.vpBuild === "nosimd" && wasm.filter((f) => f === nosimd).length === 1 && wasm.includes(simdWasm),
      `${wasm.join(", ")}; build ${st.vpBuild}`);
    const rec = await recordToPreview(page, { stopAfterMs: 4000 });
    check("non-SIMD: record -> preview", rec.ok, `${rec.st.vpSeconds} s, analysis + rebuild ${rec.st.vpAnalysisMs} ms`);
    await clickSel(page, '[data-vp-preset="lowerDarker"]');
    const r = await waitVp(page, () => { const c = document.querySelector("[data-voice-preview]"); return c?.dataset.vpRendered?.startsWith("-") && c.dataset.vpRendering === "0"; }, "render lower", 15000);
    check("non-SIMD: a quick setting renders", r, `${(await vp(page)).vpRendered}, render ${(await vp(page)).vpRenderMs} ms`);
    await clickSel(page, '[data-vp-play-version="preview"]');
    check("non-SIMD: Play preview runs the AudioContext", await waitVp(page, () => { const c = document.querySelector("[data-voice-preview]"); return c?.dataset.vpPlaying === "preview" && c.dataset.vpAudio === "running"; }, "play", 5000));
    await clickSel(page, "[data-vp-stop]");
    check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.close();
  } finally {
    corruptSimd = false;
  }
}

// The spike's A5 desktop Chrome values at 48 kHz, speech-dense clips (design note §14).
const TIMING_LIMITS = { 5: { analysis: [1130, 1420], render: [220, 350] }, 8: { analysis: [1690, 2220], render: [360, 550] } };
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const p90 = (a) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return NaN; const h = (s.length - 1) * 0.9, lo = Math.floor(h), hi = Math.ceil(h); return s[lo] + (s[hi] - s[lo]) * (h - lo); };
const cpuSnap = () => cpus().map((c) => c.times);
const busy = (a, b) => { let idle = 0, tot = 0; b.forEach((t, i) => { const d = Object.keys(t).reduce((s, k) => s + t[k] - a[i][k], 0); tot += d; idle += t.idle - a[i].idle; }); return tot ? 1 - idle / tot : 0; };

async function partTiming() {
  scope = "timing";
  if (!existsSync(TIMING_WAV)) { check("timing.wav present (scripts/voice-preview-smoke-wavs.mjs with $VP_CACHE)", false); return; }
  await launch(TIMING_WAV);
  log(`browser ${await browser.version()}`);
  const { page, errors, cdp } = await open("desktop", `http://127.0.0.1:${PORT}/Syrinx/?diag=1&capture=audiocontext&sr=48000`);
  const mems = [];
  await startListening(page);
  await openLab(page);
  await openPreview(page);
  await recordReady(page, 30000);
  const rows = [];
  for (const phrase of [5, 8]) {
    for (let i = 0; i < TIMING_N; i++) {
      const c0 = cpuSnap();
      const label = await page.$eval("[data-vp-record]", (b) => b.textContent.trim());
      await clickSel(page, "[data-vp-record]"); // Record, or Record again (a fresh worker records as soon as it is ready)
      if (!(await phaseIs(page, "recording", 15000))) { check(`${phrase} s #${i + 1}: recording started`, false, label); continue; }
      // 5 s: Stop once 5 s of audio are in (the status line), not after 5 s of wall time — in
      // headless Chrome the AudioContext capture path can deliver audio slower than real time
      // under load (the fake output device clocks it), which shortened wall-clock recordings.
      if (phrase === 5) {
        await waitVp(page, () => /Recording… [5-8] s of 8/.test(document.querySelector("[data-vp-status]")?.textContent ?? ""), "5 s recorded", 20000);
        await clickSel(page, "[data-vp-record]");
      }
      await phaseIs(page, "analysing", 15000);
      const tStop = Date.now();
      if (!(await phaseIs(page, "preview", 30000))) {
        // which state the card ended in instead (diag line included: ?diag=1)
        const bad = await page.evaluate(() => { const c = document.querySelector("[data-voice-preview]"); return c ? { phase: c.dataset.vpPhase, status: c.querySelector("[data-vp-status]")?.textContent, diag: c.querySelector("[data-vp-diag]")?.textContent } : null; });
        check(`${phrase} s #${i + 1}: preview ready`, false, JSON.stringify(bad));
        await recordReady(page, 15000).catch(() => {});
        continue;
      }
      const e2eFirst = Date.now() - tStop;
      const st = await vp(page);
      const tPress = Date.now();
      await clickSel(page, '[data-vp-preset="higherBrighter"]');
      await waitVp(page, () => { const c = document.querySelector("[data-voice-preview]"); return c?.dataset.vpRendered === "2,3" && c.dataset.vpRendering === "0"; }, "render 2,3", 15000);
      const e2eRender = Date.now() - tPress;
      const st2 = await vp(page);
      const load = busy(c0, cpuSnap());
      rows.push({ phrase, i, seconds: Number(st.vpSeconds), rate: Number(st.vpRate), capture: Number(st.vpCaptureRate), build: st.vpBuild,
        analysis: Number(st.vpAnalysisMs), render: Number(st2.vpRenderMs), e2eFirst, e2eRender, busy: load });
      log(`${phrase} s #${i + 1}: ${Number(st.vpSeconds).toFixed(2)} s @ ${st.vpRate} Hz (${st.vpBuild}), analysis + rebuild ${st.vpAnalysisMs} ms, render ${st2.vpRenderMs} ms; end to end ${e2eFirst} / ${e2eRender} ms; busy ${(load * 100).toFixed(0)} %`);
      // memory (outside the timed spans): after the first and the last 8 s recording
      if (phrase === 8 && (i === 0 || i === TIMING_N - 1)) mems.push({ i, page: await pageMem(cdp), worker: await workerMem(page) });
    }
  }
  if (mems.length === 2) {
    const [a, b] = mems;
    log(`memory after 8 s #1: ${memLine(a.page)}; worker WebAssembly ${MB(a.worker.bytes)} MB`);
    log(`memory after 8 s #${TIMING_N}: ${memLine(b.page)}; worker WebAssembly ${MB(b.worker.bytes)} MB`);
    check(`no growth over ${2 * TIMING_N - 1} Record again cycles (AudioBuffers, array-buffer backing, worker memory)`, b.page.audio.n <= a.page.audio.n && b.page.backing <= a.page.backing + 262144 && b.worker.workers === 1 && b.worker.bytes <= a.worker.bytes,
      `AudioBuffers ${a.page.audio.n} -> ${b.page.audio.n}; backing ${MB(a.page.backing)} -> ${MB(b.page.backing)} MB; worker ${MB(a.worker.bytes)} -> ${MB(b.worker.bytes)} MB`);
  }
  const f = (v) => v.toFixed(0);
  for (const phrase of [5, 8]) {
    const r = rows.filter((x) => x.phrase === phrase);
    if (!r.length) continue;
    const L = TIMING_LIMITS[phrase];
    const a = r.map((x) => x.analysis), rd = r.map((x) => x.render);
    check(`${phrase} s phrases at 48 kHz, SIMD`, r.every((x) => x.rate === 48000 && x.capture === 48000 && x.build === "simd"), `${r.length} runs`);
    check(`${phrase} s: analysis + rebuild median / p90 <= ${L.analysis.join(" / ")} ms`, median(a) <= L.analysis[0] && p90(a) <= L.analysis[1], `${f(median(a))} / ${f(p90(a))} ms`);
    check(`${phrase} s: render (slider change) median / p90 <= ${L.render.join(" / ")} ms`, median(rd) <= L.render[0] && p90(rd) <= L.render[1], `${f(median(rd))} / ${f(p90(rd))} ms`);
    const e1 = r.map((x) => x.e2eFirst), e2 = r.map((x) => x.e2eRender);
    check(`${phrase} s: end to end under the gate (3 s / 1 s, p90)`, p90(e1) <= 3000 && p90(e2) <= 1000, `stop -> preview ${f(median(e1))} / ${f(p90(e1))} ms; press -> updated ${f(median(e2))} / ${f(p90(e2))} ms`);
    log(`${phrase} s: machine busy median ${(median(r.map((x) => x.busy)) * 100).toFixed(0)} % (a run above 55 % is to be repeated)`);
  }
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
}

// ---------------------------------------------------------------- run

await startStatic();
log(`serving dist/ on ${PORT}; SIMD .wasm = ${simdWasm}; Chrome ${CHROME}`);
try {
  if (PARTS.has("layout")) await partLayout();
  if (PARTS.has("flow")) await partFlow();
  if (PARTS.has("checks")) await partChecks();
  if (PARTS.has("dev")) await partDev();
  if (PARTS.has("preview")) await partPreview();
  if (PARTS.has("fallback")) await partFallback();
  if (PARTS.has("timing")) await partTiming();
} catch (e) {
  console.error(e);
  results.push({ name: `[${scope}] exception: ${e.message}`, ok: false });
}
if (browser) { await browser.close().catch(() => {}); closeBrowserHard(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, ${warns.length} input(s) repeated; screenshots in ${OUT}`);
for (const w of warns) console.log(`  WARN ${w}`);
for (const f of failed) console.log(`  FAIL ${f.name}${f.detail ? `  (${f.detail})` : ""}`);
cleanup();
process.exit(failed.length ? 1 : 0);
