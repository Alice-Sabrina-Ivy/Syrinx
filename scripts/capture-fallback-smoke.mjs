// capture-fallback-smoke.mjs — real-browser check of the MSTP runtime
// fallback (src/audio/captureSource.js: MSTP feature-detected but failing at
// start → AudioContext on the SAME MediaStream). tests/audio/capture-fallback-
// test.js covers the logic with fake objects; this drives the BUILT app
// (dist/, served by `vite preview`) in headless Chrome with the fake mic.
//
//   npm run build && node scripts/capture-fallback-smoke.mjs [--wav=<abs path>] [--port=4192] [--modes=a,b]
//
// Not part of `npm run test:unit` (needs Chrome). Default fake-mic WAV:
// tests/audio/fixtures/voice-200hz-10s.wav (synthetic 200 Hz voice, looped by
// Chrome). Pass --wav as an ABSOLUTE path — a relative one gives a silent mic.
//
// Per mode, a fresh browser context (fresh storage → first visit) with a
// MediaStreamTrackProcessor stub injected before the app loads:
//   ctor-throws        the constructor throws
//   getreader-throws   processor.readable.getReader() throws
//   read-rejects       reader.read() rejects (the reader errors)
//   no-frame           reader.read() never resolves (5 s first-frame timeout)
//   control            no stub — the real MSTP
// Welcome → Get Started → direction → Continue starts listening, then checks:
// listening ("Mic off"), no error / "denied" text, getUserMedia called
// exactly once, diag audio info (?diag=1) captureKind = audiocontext with
// captureFallback {kind: "mstp"} (control: mstp, no captureFallback), the diag
// overlay's fallback line, the console warning, frames arrive with pitch near
// the WAV's 200 Hz, the pitch cue row goes live and the pitch trace draws new
// points.
//
// Process hygiene (CLAUDE.md hard rule 2, as scripts/cue-strip-smoke.mjs):
// Chrome is launched by puppeteer with a temporary --user-data-dir and closed
// via browser.close(), falling back to taskkill of ITS pid only; the preview
// server is this script's own child, killed only by its PID. Cleanup runs on
// exit / SIGINT / SIGTERM / uncaughtException.

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const WAV = path.resolve(arg("wav", path.join(repo, "tests", "audio", "fixtures", "voice-200hz-10s.wav")));
const PORT = Number(arg("port", "4192"));
const ALL_MODES = ["ctor-throws", "getreader-throws", "read-rejects", "no-frame", "control"];
const MODES = arg("modes", ALL_MODES.join(",")).split(",").filter(Boolean);
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!CHROME || !existsSync(WAV) || !existsSync(path.join(repo, "dist", "index.html"))) {
  console.error("need Chrome, the WAV and a build (npm run build)"); process.exit(2);
}
if (MODES.some((m) => !ALL_MODES.includes(m))) { console.error(`modes: ${ALL_MODES.join(", ")}`); process.exit(2); }

let server = null;
let browser = null;
const profile = mkdtempSync(path.join(tmpdir(), "capture-fallback-smoke-"));
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
const check = (mode, name, ok, detail = "") => {
  results.push({ mode, name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${mode}] ${name}${detail ? `  (${detail})` : ""}`);
};

async function startServer() {
  server = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: "ignore" });
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/Syrinx/`); if (r.ok) return; } catch { /* not yet */ }
    await sleep(200);
  }
  throw new Error("preview server did not start");
}

// Runs in the page before any app script. Counts getUserMedia calls and, for
// a failure mode, replaces MediaStreamTrackProcessor (AudioData stays real, so
// the app still feature-detects MSTP and routes to it).
function inject(mode) {
  window.__gumCalls = 0;
  const md = navigator.mediaDevices;
  const gum = md.getUserMedia.bind(md);
  md.getUserMedia = (c) => { window.__gumCalls++; return gum(c); };
  if (mode === "control") return;
  window.__mstpConstructed = 0;
  window.MediaStreamTrackProcessor = class {
    constructor() {
      window.__mstpConstructed++;
      if (mode === "ctor-throws") throw new TypeError("smoke: MediaStreamTrackProcessor constructor failed");
      const reader = {
        read() {
          if (mode === "read-rejects") return Promise.reject(new DOMException("smoke: reader errored", "OperationError"));
          return new Promise(() => {}); // no-frame
        },
        cancel: () => Promise.resolve(),
        releaseLock() {},
      };
      this.readable = {
        getReader() {
          if (mode === "getreader-throws") throw new TypeError("smoke: getReader failed");
          return reader;
        },
      };
    }
  };
}

const clickButton = (page, texts, scope = "") => page.evaluate((ts, scope) => {
  const root = scope ? document.querySelector(scope) : document;
  const b = [...(root?.querySelectorAll("button") ?? [])].find((x) => ts.some((t) => x.textContent.trim().includes(t)));
  if (b) b.click();
  return !!b;
}, texts, scope);

async function runMode(mode) {
  log(`${mode}`);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [], warnings = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
    if (m.type() === "warn" || m.type() === "warning") warnings.push(m.text());
  });
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.evaluateOnNewDocument(inject, mode);
  await page.goto(`http://localhost:${PORT}/Syrinx/?diag=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.bringToFront();

  // Press Start: first visit → welcome → direction question → Continue.
  await page.waitForFunction(() => document.body.innerText.includes("Welcome to Syrinx"), { timeout: 60000 });
  await clickButton(page, ["Get Started"]);
  await page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
  await page.evaluate(() => document.querySelector('[role=dialog] input[data-direction="feminine"]')?.closest("label")?.click());
  await clickButton(page, ["Continue"], "[role=dialog]");

  // Listening (the no-frame mode waits out the 5 s first-frame timeout).
  let listening = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    if (await page.evaluate(() => document.body.innerText.includes("Mic off"))) { listening = true; break; }
    await sleep(250);
  }
  const startMs = Date.now() - t0;
  check(mode, "listening after Continue", listening, `${(startMs / 1000).toFixed(1)} s`);
  if (listening) await sleep(6000); // let frames, pitch and the trace accumulate

  const s = await page.evaluate(() => {
    const d = window.__syrinxDiag?.snapshot?.() ?? null;
    const frames = d?.frames ?? [];
    const pitches = frames.map((f) => f.pitch).filter((p) => typeof p === "number" && p > 0).sort((a, b) => a - b);
    const row = document.querySelector('[data-cue="pitch"]');
    const text = document.body.innerText;
    return {
      gum: window.__gumCalls, mstpConstructed: window.__mstpConstructed ?? null,
      audio: d?.audio ? { captureKind: d.audio.captureKind, captureFallback: d.audio.captureFallback ?? null } : null,
      captureAck: d?.status?.capture ?? null,
      diagErrors: (d?.status?.errors ?? []).map((e) => `${e.source}/${e.where}: ${e.message}`),
      frames: frames.length, voiced: pitches.length, medPitch: pitches.length ? pitches[pitches.length >> 1] : null,
      traceNew: (d?.paintLatency ?? []).length, // trace draws that showed a new voiced point
      row: row ? { state: row.dataset.state, dot: row.dataset.dot === "1", value: row.dataset.value } : null,
      denied: /denied/i.test(text),
      overlayFallback: /fallback: mstp failed at start/.test(text),
      errorText: document.querySelector("p.text-red-400")?.textContent ?? null,
    };
  });

  const fb = mode !== "control";
  check(mode, "getUserMedia called once", s.gum === 1, String(s.gum));
  check(mode, "no 'denied' text", !s.denied, s.errorText ?? "");
  if (fb) {
    check(mode, "stubbed MSTP was tried", s.mstpConstructed >= 1, String(s.mstpConstructed));
    check(mode, "audio info: captureKind audiocontext", s.audio?.captureKind === "audiocontext", JSON.stringify(s.audio));
    check(mode, "audio info: captureFallback recorded", s.audio?.captureFallback?.kind === "mstp" && !!s.audio.captureFallback.message,
      s.audio?.captureFallback?.message ?? "");
    check(mode, "capture init-ack from the AudioWorklet", s.captureAck?.kind === "audiocontext", JSON.stringify(s.captureAck));
    check(mode, "diag error capture/mstp-fallback", s.diagErrors.some((e) => e.startsWith("capture/mstp-fallback")), s.diagErrors.join(" | "));
    check(mode, "diag overlay shows the fallback line", s.overlayFallback);
    check(mode, "console warning names the fallback", warnings.some((w) => w.includes("[capture] MSTP failed at start")));
  } else {
    check(mode, "audio info: captureKind mstp, no captureFallback", s.audio?.captureKind === "mstp" && !s.audio.captureFallback, JSON.stringify(s.audio));
    check(mode, "capture init-ack from MSTP", s.captureAck?.kind === "mstp", JSON.stringify(s.captureAck));
    check(mode, "no fallback error / line / warning",
      !s.diagErrors.some((e) => e.includes("mstp-fallback")) && !s.overlayFallback && !warnings.some((w) => w.includes("MSTP failed")));
  }
  check(mode, "frames arrive", s.frames >= 100, String(s.frames));
  check(mode, "pitch near the WAV's 200 Hz", s.voiced >= 50 && s.medPitch > 190 && s.medPitch < 210, `${s.voiced} voiced, median ${s.medPitch?.toFixed(1)} Hz`);
  check(mode, "pitch cue row live with a dot", s.row?.state === "live" && s.row.dot, JSON.stringify(s.row));
  check(mode, "pitch trace draws new points", s.traceNew >= 10, String(s.traceNew));
  // ?diag=1 echoes every diag error to console.error; the fallback record is expected.
  const unexpected = errors.filter((e) => !(fb && e.startsWith("[diag] capture mstp-fallback")));
  check(mode, "no other page / console errors", unexpected.length === 0, unexpected.slice(0, 3).join(" | "));
  await ctx.close();
}

log("preview server");
await startServer();
browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: profile,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${WAV}`, "--autoplay-policy=no-user-gesture-required"],
});
for (const m of MODES) await runMode(m);
await browser.close().catch(() => {});
closeBrowserHard();

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
for (const m of MODES) {
  const r = results.filter((x) => x.mode === m);
  console.log(`  ${m}: ${r.filter((x) => x.ok).length}/${r.length}`);
}
cleanup();
process.exit(bad.length ? 1 : 0);
