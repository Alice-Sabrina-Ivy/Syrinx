// desktop-diag-capture-attach.js — Pattern A: attach to the user's existing
// Chrome via --remote-debugging-port and run the capture there. Replaces the
// spawn-fresh-Chrome harness ([scripts/desktop-diag-capture.js](./desktop-diag-capture.js))
// for routine measurement, and gives us access to the user's real microphone
// and persisted permissions instead of a synthetic WAV proxy.
//
// IMPORTANT — boundary contract:
//
// This script ONLY closes the target it created via Target.closeTarget(targetId).
// It MUST NOT call Browser.close, kill any process, or touch any other tab or
// window. The user is running their primary Chrome on this debug port —
// disrupting their session is unacceptable. The CDP API contract makes this
// safe by construction: Target.closeTarget addresses a specific targetId,
// not a pattern.
//
// Also IMPORTANT: the test target opens in a NEW WINDOW (Target.createTarget
// with newWindow: true), not a tab in an existing window. Tabs added to an
// active window grab focus and break flow; a separate window is ignorable.
//
// Prerequisite — user's Chrome must be launched with the debug port. From
// PowerShell, with all existing Chrome instances closed:
//
//   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9223
//
// Or modify the Chrome shortcut's Target field to append --remote-debugging-port=9223.
// The flag only takes effect on a fresh Chrome launch (not when an existing
// instance is already running and absorbs the launch).
//
// Usage:
//   node scripts/desktop-diag-capture-attach.js [--kind=mstp] [--duration=120]
//                                               [--url=...] [--port=9223]
//                                               [--play-wav=PATH]
//
// --play-wav: optional. Plays a WAV file through the system speakers during
// capture (looping, via PowerShell System.Media.SoundPlayer). The user's real
// microphone picks it up, providing a known reference signal for end-to-end
// verification — e.g. --play-wav=tests/audio/fixtures/voice-200hz-10s.wav
// lets the harness confirm pitch detection ≈ 200 Hz on the real-mic real-MSTP
// path. The PowerShell child is tracked by PID and tree-killed on exit.
//
// Output:
//   measurements/desktop-diag-runs/<kind>-<ISO-timestamp>.json — same shape as
//   the spawned-harness output, so existing analysis scripts work unchanged.

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const RUNS_DIR = join(REPO_ROOT, "measurements", "desktop-diag-runs");

const args = parseArgs(process.argv.slice(2));
const KIND = args.kind ?? "mstp";
const DURATION = parseInt(args.duration ?? "120", 10);
const URL = args.url ?? `https://localhost:5173/Syrinx/?diag=1&capture=${KIND}`;
const PORT = parseInt(args.port ?? "9223", 10);
const PLAY_WAV = args["play-wav"] ? pathResolve(args["play-wav"]) : null;

// Track the audio-playback PowerShell PID so we can tree-kill it on exit.
// PID-scoped only — never pattern-match. Same rule as the rest of the
// harness ecosystem.
let playerPid = null;
let playerCleanedUp = false;
function killPlayer() {
  if (playerCleanedUp || playerPid == null) return;
  playerCleanedUp = true;
  try {
    spawnSync("taskkill", ["/pid", String(playerPid), "/T", "/F"], { stdio: "ignore" });
  } catch { /* best effort */ }
}
process.on("exit", killPlayer);
process.on("SIGINT", () => { killPlayer(); process.exit(130); });
process.on("SIGTERM", () => { killPlayer(); process.exit(143); });

function startAudioPlayback(wavPath, durationSec) {
  if (!existsSync(wavPath)) {
    throw new Error(`--play-wav: file not found: ${wavPath}`);
  }
  // Single-quoted PS string; double any embedded apostrophes.
  const psPath = wavPath.replace(/'/g, "''");
  const psCommand =
    `$p = New-Object Media.SoundPlayer '${psPath}'; ` +
    `$p.PlayLooping(); Start-Sleep -Seconds ${durationSec + 5}; $p.Stop()`;
  const child = spawn("powershell", ["-NoProfile", "-Command", psCommand], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  return child.pid;
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? "true";
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
//  Minimal CDP WebSocket client
// ---------------------------------------------------------------------------

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id != null && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(`${msg.error.code}: ${msg.error.message}`));
          else resolve(msg.result);
        }
      } catch { /* ignore */ }
    });
  }
  async send(method, params, timeoutMs = 60000) {
    const id = this.nextId++;
    let timeoutHandle = null;
    return new Promise((resolve, reject) => {
      const wrap = (fn) => (v) => { clearTimeout(timeoutHandle); fn(v); };
      this.pending.set(id, { resolve: wrap(resolve), reject: wrap(reject) });
      timeoutHandle = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, timeoutMs) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (r.exceptionDetails) throw new Error(`page eval threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value;
  }
  async clickAt(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });
  }
  close() { try { this.ws?.close(); } catch { /* ignore */ } }
}

// ---------------------------------------------------------------------------
//  Main flow
// ---------------------------------------------------------------------------

(async () => {
  // 1. Verify Chrome is up on the debug port. If not, print a launch hint.
  console.log(`[1/5] Checking for Chrome on port ${PORT}…`);
  let ver = null;
  try {
    const r = await fetch(`http://localhost:${PORT}/json/version`);
    if (r.ok) ver = await r.json();
  } catch { /* not up */ }
  if (!ver) {
    console.error(`✗ No CDP endpoint at http://localhost:${PORT}/json/version`);
    console.error("");
    console.error("Launch your Chrome with the debug port enabled. From an");
    console.error("elevated PowerShell, with all current Chrome windows closed:");
    console.error("");
    console.error(`    & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=${PORT}`);
    console.error("");
    console.error("Or modify your Chrome shortcut's Target field to append");
    console.error(`--remote-debugging-port=${PORT}. The flag only takes effect on a`);
    console.error("fresh Chrome launch — if Chrome was already running, the second");
    console.error("invocation gets absorbed into the existing instance and the flag");
    console.error("is silently ignored.");
    process.exit(1);
  }
  if (!String(ver.Browser).startsWith("Chrome")) {
    console.error(`✗ CDP endpoint is not Chrome (Browser: ${ver.Browser})`);
    process.exit(1);
  }
  console.log(`      ${ver.Browser}`);

  // 2. Connect browser-level CDP — needed to open a new window via
  //    Target.createTarget. Also lets us close that target by id later.
  const browserCdp = new CdpClient(ver.webSocketDebuggerUrl);
  await browserCdp.connect();

  // 3. Open the diag URL in a NEW WINDOW (not a tab in an existing window).
  //    newWindow: true is the CDP-spec mechanism for "separate top-level
  //    window." Verified to produce a separate window on Chrome 147.
  console.log(`[2/5] Opening test page in new window: ${URL}`);
  const { targetId } = await browserCdp.send("Target.createTarget", {
    url: URL,
    newWindow: true,
  });
  console.log(`      targetId=${targetId}`);

  // Idempotent close of OUR target only. Belt-and-braces against early exit.
  // CRITICAL: addresses a specific targetId, never a pattern. Cannot affect
  // any other tab or window.
  let closed = false;
  async function closeOurTarget() {
    if (closed) return;
    closed = true;
    try {
      await browserCdp.send("Target.closeTarget", { targetId });
    } catch { /* user may have already closed it */ }
  }
  // Async paths only — process.on("exit") would run synchronously and can't
  // fire a CDP close. Main-flow await + signal handlers cover the realistic
  // exit paths.
  process.on("SIGINT", async () => { await closeOurTarget(); process.exit(130); });
  process.on("SIGTERM", async () => { await closeOurTarget(); process.exit(143); });
  process.on("uncaughtException", async (e) => { console.error(e); await closeOurTarget(); process.exit(1); });

  // 4. Find our target's WS URL via /json/list and connect page-level CDP.
  console.log(`[3/5] Locating new target via /json/list…`);
  let target = null;
  const tabDeadline = Date.now() + 15000;
  while (Date.now() < tabDeadline) {
    const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
    target = list.find((t) => t.id === targetId);
    if (target?.webSocketDebuggerUrl) break;
    await sleep(250);
  }
  if (!target?.webSocketDebuggerUrl) {
    await closeOurTarget();
    throw new Error("New target not visible in /json/list within 15s");
  }
  console.log(`      ${target.url || "(loading)"}`);

  console.log(`[4/5] Attaching to target…`);
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();

  // Defensive: user's profile already has the dev cert accepted and mic
  // granted, but if either isn't, this turns potential failures into
  // success. Per-target / per-origin scope; harmless when already allowed.
  try {
    await cdp.send("Security.enable", {});
    await cdp.send("Security.setIgnoreCertificateErrors", { ignore: true });
  } catch { /* may not be needed */ }

  for (let i = 0; i < 60; i++) {
    try {
      if (await cdp.eval("!!window.__syrinxDiag")) break;
    } catch { /* navigation in progress */ }
    await sleep(250);
  }
  console.log("      diag attached ✓");

  // Start speaker playback BEFORE the click so the first capture frames see
  // signal rather than silence. Player loops the WAV for capture duration
  // + 5 s safety margin and then exits on its own.
  if (PLAY_WAV) {
    console.log(`      starting playback: ${PLAY_WAV}`);
    playerPid = startAudioPlayback(PLAY_WAV, DURATION);
    console.log(`      powershell pid=${playerPid} (tracked for PID-scoped kill on exit)`);
    // Brief settle — give the OS audio stack a moment so the mic isn't
    // capturing the trailing silence between SoundPlayer init and audio out.
    await sleep(300);
  }

  // Click start. Fall through (no error) if neither button is visible —
  // user may have left the dev session in a state where audio is already
  // running.
  const btn = await cdp.eval(`
    (() => {
      const el = [...document.querySelectorAll("button")].find((b) =>
        b.textContent.includes("Get Started") || b.textContent.includes("Start Listening"));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { text: el.textContent.trim(), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
    })()
  `);
  if (btn) {
    await cdp.clickAt(btn.x, btn.y);
    console.log(`      clicked: ${btn.text} @ ${btn.x},${btn.y}`);
  } else {
    console.log("      no start button visible — assuming audio already running");
  }

  for (let i = 0; i < 40; i++) {
    if (await cdp.eval("(window.__syrinxDiag?.state?.frames?.toArray()?.length ?? 0) > 0")) break;
    await sleep(250);
  }

  console.log(`[5/5] Capturing for ${DURATION}s…`);
  const t0 = Date.now();
  const heartbeatMs = 5000;
  while (Date.now() - t0 < DURATION * 1000) {
    await sleep(Math.min(heartbeatMs, DURATION * 1000 - (Date.now() - t0)));
    const elapsed = Math.round((Date.now() - t0) / 1000);
    try {
      const live = await cdp.eval(`
        (() => {
          const d = window.__syrinxDiag?.state;
          const frames = d?.frames.toArray() ?? [];
          const last = frames[frames.length - 1];
          return {
            n: frames.length,
            lastChunkArrivalMs: last?.timings?.chunkArrivalMs ?? null,
            lastPitch: last?.pitch ?? null,
            captureKind: d?.audio?.captureKind,
            errors: d?.status?.errors?.length ?? 0,
          };
        })()
      `, 10000);
      console.log(
        `      ${elapsed}s/${DURATION}s n=${live.n} kind=${live.captureKind} ` +
        `last=${live.lastChunkArrivalMs?.toFixed(1) ?? "—"}ms ` +
        `pitch=${live.lastPitch?.toFixed(1) ?? "—"}Hz` +
        (live.errors > 0 ? ` errors=${live.errors}` : "")
      );
    } catch (err) {
      console.log(`      ${elapsed}s/${DURATION}s heartbeat eval failed: ${err.message}`);
    }
  }

  console.log("      reading snapshot…");
  const snapJson = await cdp.eval("JSON.stringify(window.__syrinxDiag.snapshot())");
  const snap = JSON.parse(snapJson);

  if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(RUNS_DIR, `${KIND}-${ts}.json`);
  writeFileSync(path, JSON.stringify({ snapshot: snap }, null, 2));

  cdp.close();

  const frames = snap.frames || [];
  const arr = frames.map(f => f.timings?.chunkArrivalMs).filter(v => typeof v === "number" && Number.isFinite(v)).sort((a,b)=>a-b);
  const pct = (p) => arr[Math.floor(arr.length * p)];
  const pitches = frames.map(f => f.pitch).filter(p => typeof p === "number" && Number.isFinite(p) && p > 0).sort((a,b)=>a-b);
  const pp = (p) => pitches[Math.floor(pitches.length * p)];
  console.log("");
  console.log("─".repeat(72));
  console.log(` SUMMARY — kind=${snap.audio?.captureKind} ${snap.userAgent}`);
  console.log("─".repeat(72));
  console.log(`  saved: ${path}`);
  console.log(`  frames: ${frames.length}, lowRes: ${(snap.lowRes || []).length}, voiced: ${pitches.length}`);
  if (arr.length > 0) {
    console.log(`  chunkArrival ms: median=${pct(0.5).toFixed(2)} p95=${pct(0.95).toFixed(2)} p99=${pct(0.99).toFixed(2)} max=${arr[arr.length-1].toFixed(2)}`);
  }
  if (pitches.length > 0) {
    console.log(`  pitch Hz:        median=${pp(0.5).toFixed(2)} p5=${pp(0.05).toFixed(2)} p95=${pp(0.95).toFixed(2)}`);
  }
  console.log(`  baseLat: ${snap.audio?.baseLatencySec ? (snap.audio.baseLatencySec*1000).toFixed(1)+"ms" : "—"}, granted.latency: ${snap.audio?.grantedConstraints?.latency ?? "—"}`);
  console.log(`  status.errors: ${snap.status?.errors?.length ?? 0}`);
  console.log("─".repeat(72));

  // Close ONLY our target. User's other tabs/windows untouched.
  await closeOurTarget();
  browserCdp.close();
  console.log("✓ done — closed harness window");
})().catch((err) => {
  console.error("");
  console.error(`✗ ${err.message}`);
  if (process.env.DEBUG && err.stack) console.error(err.stack);
  process.exit(1);
});
