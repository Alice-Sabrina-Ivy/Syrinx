// desktop-diag-capture.js — Drive a freshly-spawned local Chrome instance
// to capture a `?diag=1` snapshot from the dev server. Mirror of
// scripts/mobile-diag-capture.js but for desktop measurement.
//
// DEPRECATED — prefer [scripts/desktop-diag-capture-attach.js](./desktop-diag-capture-attach.js)
// (Pattern A) for routine measurement. This script remains as a fallback
// for environments where the user can't or doesn't want to launch their
// primary Chrome with --remote-debugging-port. Limitation that motivated
// the move: the spawned-Chrome flow can't reliably address the user's
// real preferred microphone — its fresh profile picks Chrome's notion
// of "default device" which often isn't the right one. Testing real-mic
// behavior here therefore relies on the synthetic --voice-file fixture
// rather than the actual capture stack.
//
// IMPORTANT — process-management contract:
//
// This script SPAWNS a Chrome process and is responsible for cleaning up
// only the process it spawned (and its descendants). It MUST NOT pattern-
// match on `chrome.exe` or any similar broad selector — Alice runs Chrome
// as her primary browser and pattern-matched kills would terminate her
// active work. Cleanup uses the spawned PID exclusively, via
// `taskkill /pid <PID> /T /F` (the /T flag tree-kills descendants Chrome
// forks for renderers, GPU process, etc.).
//
// To guarantee process isolation regardless of any pre-existing Chrome
// instance, we always launch with --user-data-dir pointing at a fresh
// per-run temp directory. A different profile directory means Chrome
// can't merge with an already-running instance — our spawn ALWAYS
// produces a new top-level process tree.
//
// Usage:
//   node scripts/desktop-diag-capture.js [--kind=mstp] [--duration=120] [--url=...]
//
// Output:
//   measurements/desktop-diag-runs/<kind>-<ISO-timestamp>.json — full
//   snapshot for diff'ing across iterations.

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const RUNS_DIR = join(REPO_ROOT, "measurements", "desktop-diag-runs");

const args = parseArgs(process.argv.slice(2));
const KIND = args.kind ?? "mstp";
const DURATION = parseInt(args.duration ?? "120", 10);
const URL = args.url ?? `https://localhost:5173/Syrinx/?diag=1&capture=${KIND}`;
const PORT = parseInt(args.port ?? "9223", 10);

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? "true";
  }
  return out;
}

function findChrome() {
  for (const p of CHROME_PATHS) if (existsSync(p)) return p;
  throw new Error("Chrome not found. Tried:\n  " + CHROME_PATHS.join("\n  "));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Guarantee single cleanup per run: keeps PID-tree-kill idempotent and
// makes "did we already clean up?" a single boolean check.
let cleanedUp = false;
let spawnedPid = null;
let profileDir = null;

function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;

  // Tree-kill the spawned Chrome PID specifically. /T = include the
  // process tree (Chrome forks renderers, GPU process, network service,
  // etc. as descendants of the launched chrome.exe), /F = force.
  // CRITICAL: this targets ONLY the PID we spawned. Pattern-matching
  // on chrome.exe would kill Alice's main Chrome with all her tabs;
  // this is forbidden — see the file header.
  if (spawnedPid != null) {
    try {
      spawnSync("taskkill", ["/pid", String(spawnedPid), "/T", "/F"], { stdio: "ignore" });
    } catch { /* best effort */ }
  }

  // Profile dir was per-run; remove it after the kill so the leftover
  // tree of cache files doesn't accumulate in temp.
  if (profileDir && existsSync(profileDir)) {
    try {
      rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch { /* best effort */ }
  }
}

// Cleanup on any process exit path.
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });

// ---------------------------------------------------------------------------
//  Minimal CDP WebSocket client — same shape as the mobile harness.
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
  async reload() { await this.send("Page.reload", { ignoreCache: true }); }
  close() { try { this.ws?.close(); } catch { /* ignore */ } }
}

// ---------------------------------------------------------------------------
//  Main flow
// ---------------------------------------------------------------------------

(async () => {
  // Per-run profile dir: guarantees a fresh process tree (Chrome will
  // not merge with any pre-existing instance because the profile is
  // unique). Cleanup removes the dir after kill.
  profileDir = join(tmpdir(), `chrome-syrinx-diag-${Date.now()}`);
  mkdirSync(profileDir, { recursive: true });
  console.log(`[1/5] Launching Chrome (port=${PORT}, profile=${profileDir})…`);

  const chromeExe = findChrome();
  // Minimum-viable launch flag set. Three former flags were removed in favour
  // of CDP equivalents that apply per-target AFTER attach but BEFORE the dev-
  // server URL is loaded — so the security/permission profile that lets the
  // capture path run only ever applies to our page, not the whole browser:
  //   --ignore-certificate-errors    → Security.setIgnoreCertificateErrors
  //   --use-fake-ui-for-media-stream → Browser.grantPermissions(audioCapture)
  //   --autoplay-policy=...          → unneeded; AudioContext is created after
  //                                    our programmatic Input.dispatchMouseEvent
  //                                    click, which counts as user activation.
  // The audio-source flags below are not security-related — they pick which
  // signal Chrome's fake mic exposes — and are kept on the command line.
  const chromeArgs = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    // Belt-and-braces: even with a fresh --user-data-dir (which already
    // forces a separate process tree), --new-window guarantees the spawn
    // is its own visibly-distinct top-level window, never appended as a
    // tab to any other Chrome instance Alice has running.
    "--new-window",
  ];
  // Audio source priority (highest first):
  //   --voice-file=PATH  : play a WAV through Chrome's fake mic. Chrome
  //                        loops it indefinitely. Used as the ground-
  //                        truth reference for path-comparison testing
  //                        (MSTP vs AudioContext should produce
  //                        equivalent pitch readings on the same WAV).
  //   --no-fake-device   : real-mic capture (host's default device).
  //                        Useful for surfacing real-mic-only bugs.
  //   (default)          : Chrome's synthetic 1 kHz beep mono source.
  if (args["voice-file"]) {
    // The voice file flag REQUIRES --use-fake-device-for-media-stream;
    // without it Chrome ignores the file flag.
    chromeArgs.push("--use-fake-device-for-media-stream");
    chromeArgs.push(`--use-file-for-fake-audio-capture=${args["voice-file"]}`);
  } else if (args["no-fake-device"] !== "true") {
    chromeArgs.push("--use-fake-device-for-media-stream");
  }
  // Note: no URL on the command line. Chrome opens its default new-tab page;
  // we attach, install the per-target CDP overrides, then Page.navigate to URL.
  // Log the exact spawn command so any future "did the flags actually
  // apply" question can be answered by reading back the harness output.
  console.log(`      command: "${chromeExe}"`);
  for (const a of chromeArgs) console.log(`               ${a}`);
  const child = spawn(chromeExe, chromeArgs, { detached: true, stdio: "ignore" });
  spawnedPid = child.pid;
  child.unref();
  console.log(`      spawned chrome.exe pid=${spawnedPid}`);

  // Wait for CDP up.
  console.log(`[2/5] Waiting for CDP at http://localhost:${PORT}/json/version…`);
  let ver = null;
  const cdpDeadline = Date.now() + 30000;
  while (Date.now() < cdpDeadline) {
    try {
      const r = await fetch(`http://localhost:${PORT}/json/version`);
      if (r.ok) { ver = await r.json(); break; }
    } catch { /* not ready */ }
    await sleep(500);
  }
  if (!ver) throw new Error("CDP didn't come up within 30s");
  console.log(`      ${ver.Browser}`);

  // Find the initial page target. Chrome was launched without a URL, so this
  // is the default new-tab page. We attach to it, install the cert/permission
  // overrides, then navigate to the diag URL — the dev-server origin is never
  // visited until after the security setup is in place.
  console.log(`[3/5] Locating initial page target…`);
  let target = null;
  const tabDeadline = Date.now() + 15000;
  while (Date.now() < tabDeadline) {
    const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === "page");
    if (target) break;
    await sleep(500);
  }
  if (!target) throw new Error("No page target found within 15s");
  console.log(`      ${target.url || "(blank)"}`);

  // Attach via CDP, install per-target cert override and per-origin mic grant,
  // THEN navigate. Order matters: setIgnoreCertificateErrors must be in place
  // before the page loads or Chrome shows the interstitial.
  console.log(`[4/5] Attaching to target and installing CDP overrides…`);
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();

  // Replaces --ignore-certificate-errors. Per-target scope.
  await cdp.send("Security.enable", {});
  await cdp.send("Security.setIgnoreCertificateErrors", { ignore: true });

  // Replaces --use-fake-ui-for-media-stream. Browser-level, scoped to origin.
  // (globalThis.URL — the file-level `URL` constant shadows the global ctor.)
  const origin = new globalThis.URL(URL).origin;
  const browserCdp = new CdpClient(ver.webSocketDebuggerUrl);
  await browserCdp.connect();
  await browserCdp.send("Browser.grantPermissions", {
    origin,
    permissions: ["audioCapture"],
  });
  browserCdp.close();
  console.log(`      grantPermissions(audioCapture) for ${origin} ✓`);

  // Now navigate. Cert interstitial is suppressed by setIgnoreCertificateErrors.
  await cdp.send("Page.navigate", { url: URL });

  for (let i = 0; i < 60; i++) {
    try {
      if (await cdp.eval("!!window.__syrinxDiag")) break;
    } catch { /* page may still be navigating */ }
    await sleep(250);
  }
  console.log("      diag attached ✓");

  // Click the start button. Use mouse events so user-activation
  // is granted (programmatic .click() doesn't count).
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
  }

  // Permission probe — confirms Browser.grantPermissions actually took.
  // "granted" → permission applied, any 0-frames issue is downstream.
  // "prompt"  → grant didn't apply (wrong name? wrong origin?).
  // "denied"  → grant was rejected.
  try {
    const permState = await cdp.eval(
      `navigator.permissions.query({name:"microphone"}).then(r => r.state).catch(e => "query-error:"+e.message)`
    );
    console.log(`      permissions.query(microphone) → ${permState}`);
  } catch (err) {
    console.log(`      permission probe failed: ${err.message}`);
  }

  // Wait for first frame.
  for (let i = 0; i < 40; i++) {
    if (await cdp.eval("(window.__syrinxDiag?.state?.frames?.toArray()?.length ?? 0) > 0")) break;
    await sleep(250);
  }

  // If still no frames, run a parallel getUserMedia from CDP to surface
  // the actual error the app's call is hitting (the app's error goes to
  // React state, not the diag snapshot, so it's invisible otherwise).
  const haveFrames = await cdp.eval("(window.__syrinxDiag?.state?.frames?.toArray()?.length ?? 0) > 0");
  if (!haveFrames) {
    try {
      const probe = await cdp.eval(`
        navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}})
          .then(s => { s.getTracks().forEach(t => t.stop()); return "ok"; })
          .catch(e => "err:" + e.name + ":" + e.message)
      `, 15000);
      console.log(`      gUM probe → ${probe}`);
    } catch (err) {
      console.log(`      gUM probe failed: ${err.message}`);
    }
  }

  console.log(`[5/5] Capturing for ${DURATION}s…`);
  const t0 = Date.now();
  const heartbeatMs = 5000;
  while (Date.now() - t0 < DURATION * 1000) {
    await sleep(Math.min(heartbeatMs, DURATION * 1000 - (Date.now() - t0)));
    const elapsed = Math.round((Date.now() - t0) / 1000);
    // Light eval — short timeout so a stalled page doesn't block forever.
    try {
      const live = await cdp.eval(`
        (() => {
          const d = window.__syrinxDiag?.state;
          const frames = d?.frames.toArray() ?? [];
          const last = frames[frames.length - 1];
          return {
            n: frames.length,
            lastChunkArrivalMs: last?.timings?.chunkArrivalMs ?? null,
            captureKind: d?.audio?.captureKind,
            errors: d?.status?.errors?.length ?? 0,
          };
        })()
      `, 10000);
      console.log(
        `      ${elapsed}s/${DURATION}s n=${live.n} kind=${live.captureKind} ` +
        `last=${live.lastChunkArrivalMs?.toFixed(1) ?? "—"}ms` +
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

  // Quick summary.
  const frames = snap.frames || [];
  const arr = frames.map(f => f.timings?.chunkArrivalMs).filter(v => typeof v === "number" && Number.isFinite(v)).sort((a,b)=>a-b);
  const pct = (p) => arr[Math.floor(arr.length * p)];
  console.log("");
  console.log("─".repeat(72));
  console.log(` SUMMARY — kind=${snap.audio?.captureKind} ${snap.userAgent}`);
  console.log("─".repeat(72));
  console.log(`  saved: ${path}`);
  console.log(`  frames: ${frames.length}, lowRes: ${(snap.lowRes || []).length}`);
  if (arr.length > 0) {
    console.log(`  chunkArrival ms: median=${pct(0.5).toFixed(2)} p95=${pct(0.95).toFixed(2)} p99=${pct(0.99).toFixed(2)} max=${arr[arr.length-1].toFixed(2)}`);
  }
  console.log(`  baseLat: ${snap.audio?.baseLatencySec ? (snap.audio.baseLatencySec*1000).toFixed(1)+"ms" : "—"}, granted.latency: ${snap.audio?.grantedConstraints?.latency ?? "—"}`);
  console.log(`  status.errors: ${snap.status?.errors?.length ?? 0}`);
  console.log("─".repeat(72));

  console.log("✓ done");
  // Cleanup runs via process.on("exit") — kills the spawned PID tree
  // and removes the per-run profile dir.
})().catch((err) => {
  console.error("");
  console.error(`✗ ${err.message}`);
  if (process.env.DEBUG && err.stack) console.error(err.stack);
  process.exit(1);
});
