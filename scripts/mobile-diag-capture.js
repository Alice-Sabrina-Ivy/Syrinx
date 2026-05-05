// mobile-diag-capture.js — Drive Chrome on a USB-attached Android phone
// to capture a `?diag=1` snapshot from the live Vite dev server, pull
// the JSON back to the PC, and print a summary. Iterating mobile latency
// fixes without manual phone interaction.
//
// Usage:
//   node scripts/mobile-diag-capture.js [--duration=30] [--url=<url>]
//
// Defaults:
//   duration: 30 seconds of capture window
//   url:      https://10.0.0.41:5173/Syrinx/?diag=1
//
// Prerequisites (one-time): see CLAUDE.md "Mobile diag capture harness".
//
// Output:
//   - Console summary of the captured snapshot.
//   - measurements/mobile-diag-runs/<ISO-timestamp>.json — full snapshot
//     for diff'ing across iterations.

import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const RUNS_DIR = join(REPO_ROOT, "measurements", "mobile-diag-runs");

const DEFAULT_URL = "https://10.0.0.41:5173/Syrinx/?diag=1";
const DEFAULT_DURATION_SEC = 30;
const CDP_PORT = 9222;

// ---------------------------------------------------------------------------
//  Args
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const url = args.url ?? DEFAULT_URL;
const durationSec = parseInt(args.duration ?? DEFAULT_DURATION_SEC, 10);
if (!Number.isFinite(durationSec) || durationSec < 5 || durationSec > 600) {
  console.error("--duration must be between 5 and 600 seconds");
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? "true";
  }
  return out;
}

// ---------------------------------------------------------------------------
//  ADB helpers — all the harness's shell-out points are funneled through
//  these so error reporting is consistent.
// ---------------------------------------------------------------------------

function adb(...adbArgs) {
  const r = spawnSync("adb", adbArgs, { encoding: "utf8" });
  if (r.error) {
    throw new Error(
      `adb not on PATH or failed to spawn: ${r.error.message}\n` +
      `Install Android Platform Tools (see CLAUDE.md "Mobile diag capture harness").`,
    );
  }
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

function adbCheckOk(label, ...adbArgs) {
  const r = adb(...adbArgs);
  if (r.status !== 0) {
    throw new Error(`${label} failed (exit ${r.status}):\n${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

function adbDevices() {
  const out = adbCheckOk("adb devices", "devices").trim();
  // Skip header line "List of devices attached"
  const lines = out.split("\n").slice(1).filter((l) => l.trim().length > 0);
  return lines.map((l) => {
    const [serial, state] = l.split(/\s+/);
    return { serial, state };
  });
}

// ---------------------------------------------------------------------------
//  Phase 1: device check
// ---------------------------------------------------------------------------

function phaseDeviceCheck() {
  console.log("[1/6] Checking ADB device…");
  const v = adb("version").stdout.trim().split("\n")[0];
  console.log(`      ${v}`);

  const devices = adbDevices();
  if (devices.length === 0) {
    console.error("");
    console.error("✗ No device attached.");
    console.error("  Plug the phone into the PC via USB, ensure it's UNLOCKED,");
    console.error("  and that the USB mode is set to 'File transfer / Android Auto'");
    console.error("  (NOT 'Charging only' — ADB needs the data lines).");
    console.error("");
    console.error("  If a 'Allow USB debugging?' prompt appears on the phone,");
    console.error("  tap 'Always allow from this computer' → 'OK'.");
    console.error("");
    console.error("  Then re-run this script.");
    process.exit(3);
  }

  if (devices.length > 1) {
    console.error(`✗ ${devices.length} devices attached. Disconnect one or set ANDROID_SERIAL.`);
    devices.forEach((d) => console.error(`    ${d.serial}  ${d.state}`));
    process.exit(3);
  }

  const dev = devices[0];
  if (dev.state === "unauthorized") {
    console.error("");
    console.error(`✗ Device ${dev.serial} is unauthorized.`);
    console.error("  Look at the phone — there should be a prompt asking to authorize");
    console.error("  this computer's RSA key. Tap 'Always allow from this computer' → 'OK'.");
    console.error("  Then re-run this script.");
    process.exit(3);
  }
  if (dev.state !== "device") {
    console.error(`✗ Device ${dev.serial} state '${dev.state}' is unexpected. Expected 'device'.`);
    process.exit(3);
  }

  const model = adb("shell", "getprop", "ro.product.model").stdout.trim();
  const release = adb("shell", "getprop", "ro.build.version.release").stdout.trim();
  console.log(`      device: ${dev.serial} — ${model} (Android ${release})`);

  // Verify Chrome is installed.
  const pkgs = adb("shell", "pm", "list", "packages", "com.android.chrome").stdout;
  if (!pkgs.includes("com.android.chrome")) {
    console.error("✗ com.android.chrome not installed on device.");
    console.error("  Install Chrome on the phone before running this script.");
    process.exit(3);
  }
  console.log("      Chrome present ✓");

  // Wake the device and keep it awake while plugged in. AudioWorklet
  // processing is suspended by Android when the device dozes; without
  // this, captures spanning more than a few seconds randomly fail
  // (depending on whether the phone happens to still be awake from
  // recent user interaction). `svc power stayon usb` requires no
  // special permissions on user-level Android and is reversible.
  adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  adb("shell", "svc", "power", "stayon", "usb");
  const wakefulness = adb("shell", "dumpsys", "power").stdout
    .split("\n")
    .find((l) => l.includes("mWakefulness="))
    ?.trim();
  if (wakefulness) console.log(`      wake: ${wakefulness}, stay-on: usb`);

  // Detect lock screen — if present, we can wake the screen via keyevent
  // but can't dismiss the keyguard from ADB without keystone passcode
  // automation. Tell the user to unlock and try again.
  const win = adb("shell", "dumpsys", "window").stdout;
  if (/mDreamingLockscreen=true|isStatusBarKeyguard=true|KeyguardServiceDelegate.*showing.*true/.test(win)) {
    console.error("");
    console.error("✗ Phone appears to be on the lock screen.");
    console.error("  Unlock the phone (face/fingerprint/PIN) and re-run.");
    console.error("  Tip: 'Stay awake while charging' (Settings → System →");
    console.error("  Developer options) avoids this on subsequent runs.");
    process.exit(3);
  }
}

// ---------------------------------------------------------------------------
//  Phase 2: launch Chrome with the diag URL
// ---------------------------------------------------------------------------

function phaseLaunchChrome(targetUrl) {
  console.log("[2/6] Launching Chrome on device…");
  // Build the entire shell command as one string and let adb shell pass
  // it through. If the URL is provided as a separate argv element, adb
  // concatenates with spaces on the device side and the device shell
  // re-tokenizes — `&` in query strings becomes a job-control separator,
  // truncating the URL to everything before the first `&`. Wrapping the
  // URL in single quotes preserves it intact across the adb-shell
  // re-tokenization step. The URL itself shouldn't contain single
  // quotes (would need escaping); reject if it does.
  if (targetUrl.includes("'")) {
    throw new Error(`URL contains single quote, refusing to inject: ${targetUrl}`);
  }
  const cmd = `am start -a android.intent.action.VIEW -d '${targetUrl}' com.android.chrome`;
  const r = adb("shell", cmd);
  if (r.status !== 0) {
    throw new Error(`am start failed: ${r.stderr || r.stdout}`);
  }
  console.log(`      intent dispatched: ${targetUrl}`);
}

// ---------------------------------------------------------------------------
//  Minimal CDP client over a single page's WebSocket
// ---------------------------------------------------------------------------
//
// Why not Puppeteer: puppeteer.connect() attaches to every target in the
// browser (including unrelated user tabs) and issues Network.enable on
// each. On a phone with a dozen+ tabs, this trips the protocolTimeout
// even with `targetFilter` set. We only need three CDP commands —
// Runtime.evaluate, Input.dispatchMouseEvent, Page.reload — so a tiny
// hand-rolled client over the page's webSocketDebuggerUrl is faster
// and much more reliable than wrapping Puppeteer.

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
        // Events (msg.method without msg.id) ignored — we don't need them.
      } catch { /* malformed frame; ignore */ }
    });
  }

  async send(method, params, timeoutMs = 30000) {
    const id = this.nextId++;
    let timeoutHandle = null;
    const promise = new Promise((resolve, reject) => {
      const wrappedResolve = (v) => { clearTimeout(timeoutHandle); resolve(v); };
      const wrappedReject = (e) => { clearTimeout(timeoutHandle); reject(e); };
      this.pending.set(id, { resolve: wrappedResolve, reject: wrappedReject });
      timeoutHandle = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  // Run JS in the page, return its value. Awaits promises automatically.
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        `page eval threw: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`
      );
    }
    return r.result?.value;
  }

  async clickAt(x, y) {
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x, y, button: "left", clickCount: 1, buttons: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x, y, button: "left", clickCount: 1, buttons: 0,
    });
  }

  async reload() {
    await this.send("Page.reload", { ignoreCache: true });
  }

  close() {
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
//  Phase 3: forward CDP socket + locate the right target
// ---------------------------------------------------------------------------

async function phaseConnectCdp(targetUrl) {
  console.log("[3/6] Setting up CDP forward (localhost:9222 → device chrome_devtools_remote)…");
  adb("forward", "--remove", `tcp:${CDP_PORT}`); // ignore failure
  adbCheckOk("adb forward", "forward", `tcp:${CDP_PORT}`, "localabstract:chrome_devtools_remote");

  const startedAt = Date.now();
  const timeoutMs = 15000;
  let cdpInfo = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${CDP_PORT}/json/version`);
      if (res.ok) { cdpInfo = await res.json(); break; }
    } catch { /* not ready */ }
    await sleep(500);
  }
  if (!cdpInfo) {
    throw new Error(
      `CDP never came up at http://localhost:${CDP_PORT}/json/version after ${timeoutMs} ms.\n` +
      `  - Make sure Chrome is foregrounded on the phone.\n` +
      `  - Verify in chrome://inspect on the PC that the device shows up.\n` +
      `  - Some Android Chrome variants need 'Enable USB debugging' in chrome://flags.`
    );
  }
  console.log(`      CDP up: ${cdpInfo.Browser} (${cdpInfo["Protocol-Version"]})`);

  // Find the diag tab via /json/list. Each `am start ... VIEW` intent
  // creates a new tab on Android Chrome — so on subsequent runs there
  // may be multiple matching tabs from prior harness invocations.
  // Close all but the most recent (highest target id, last-launched)
  // and use that one. Keeps the tab count from drifting upward across
  // many harness runs.
  console.log("[4/6] Locating Syrinx tab among all open tabs…");
  const targetOrigin = new URL(targetUrl).origin;
  const listRes = await fetch(`http://localhost:${CDP_PORT}/json/list`);
  const list = await listRes.json();
  const total = list.length;
  const matches = list
    .filter((t) => t.type === "page" && t.url && originSafe(t.url) === targetOrigin);
  console.log(`      ${total} total tabs on phone, ${matches.length} match origin ${targetOrigin}`);

  if (matches.length === 0) {
    throw new Error(
      `No tab matched origin ${targetOrigin}.\n` +
      `  - Open ${targetUrl} on the phone manually first (accept cert warning if needed).\n` +
      `  - Then re-run this script.`
    );
  }

  // Pick the most-recently-created (lexicographic id is a safe proxy on
  // Android Chrome; ids monotonically increase). Close the rest.
  matches.sort((a, b) => (a.id < b.id ? 1 : -1));
  const target = matches[0];
  for (const dup of matches.slice(1)) {
    try {
      await fetch(`http://localhost:${CDP_PORT}/json/close/${dup.id}`);
    } catch { /* best-effort */ }
  }
  if (matches.length > 1) {
    console.log(`      closed ${matches.length - 1} duplicate Syrinx tab(s); keeping id=${target.id}`);
  }

  return { target, total };
}

// ---------------------------------------------------------------------------
//  Phase 5: capture
// ---------------------------------------------------------------------------

async function phaseCapture(target, targetUrl, durationSec) {
  console.log(`[5/6] Attaching directly to target id=${target.id} via WebSocket…`);
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  console.log(`      ws connected`);

  // Force a fresh page load. Without this, the harness inherits the
  // previous run's audio pipeline + stale module instance.
  console.log("      reloading page for fresh state…");
  await cdp.reload();
  const ready = await waitForEval(cdp, "!!window.__syrinxDiag", 15000);
  if (!ready) {
    throw new Error(
      `window.__syrinxDiag never attached. The page didn't load with ?diag=1, or\n` +
      `the JS failed to evaluate.`
    );
  }
  console.log("      diag module attached ✓");

  // Click via Input.dispatchMouseEvent (NOT element.click()). Programmatic
  // .click() doesn't grant user activation, so getUserMedia silently fails
  // — symptom: status.worklet/worker stay null, no error logged.
  const btn = await cdp.eval(`
    (() => {
      const el = [...document.querySelectorAll("button")].find((b) =>
        b.textContent.includes("Get Started") ||
        b.textContent.includes("Start Listening"));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { text: el.textContent.trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()
  `);
  if (btn) {
    await cdp.clickAt(btn.x, btn.y);
    console.log(`      clicked: ${btn.text} (mouse @ ${Math.round(btn.x)},${Math.round(btn.y)})`);
  } else {
    console.log(`      no start button visible (audio likely already running)`);
  }

  const firstFrameOk = await waitForEval(
    cdp,
    "(window.__syrinxDiag?.state.frames.toArray().length ?? 0) > 0",
    8000,
  );
  if (!firstFrameOk) {
    const status = await cdp.eval("JSON.stringify(window.__syrinxDiag.state.status)");
    throw new Error(
      `No frames within 8s of clicking start. Status:\n${status}\n` +
      `  - Mic permission may not be granted on the phone.\n` +
      `  - Or the AudioWorklet is throwing — check status.errors above.`
    );
  }

  console.log(`[6/6] Collecting for ${durationSec}s…`);
  const tCapStart = Date.now();
  const heartbeatMs = 5000;
  while (Date.now() - tCapStart < durationSec * 1000) {
    await sleep(Math.min(heartbeatMs, durationSec * 1000 - (Date.now() - tCapStart)));
    const elapsed = Math.round((Date.now() - tCapStart) / 1000);
    const live = await cdp.eval(`
      (() => {
        const d = window.__syrinxDiag?.state;
        const frames = d?.frames.toArray() ?? [];
        const last = frames[frames.length - 1];
        return {
          nFrames: frames.length,
          nLowRes: d?.lowRes.toArray().length ?? 0,
          lastChunkArrivalMs: last?.timings?.chunkArrivalMs ?? null,
          nErrors: d?.status?.errors?.length ?? 0,
        };
      })()
    `);
    console.log(
      `      collecting… ${elapsed}s/${durationSec}s ` +
      `(n=${live.nFrames} lowRes=${live.nLowRes}, last chunkArrival=${
        live.lastChunkArrivalMs == null ? "—" : live.lastChunkArrivalMs.toFixed(1) + "ms"
      }${live.nErrors > 0 ? `, errors=${live.nErrors}` : ""})`
    );
  }

  console.log("      reading snapshot directly from page…");
  // The snapshot can be large enough that bouncing it through
  // Runtime.evaluate's returnByValue path is slow. Stringify on the
  // page side and parse here.
  const snapJson = await cdp.eval("JSON.stringify(window.__syrinxDiag.snapshot())");
  cdp.close();
  return JSON.parse(snapJson);
}

// ---------------------------------------------------------------------------
//  Phase 5: summarize + persist
// ---------------------------------------------------------------------------

function summarize(snap) {
  const frames = snap.frames ?? [];
  const lowRes = snap.lowRes ?? [];
  if (frames.length === 0) {
    return { error: "no frames in snapshot" };
  }
  // Use lowRes for full-session timeline; frames cap at ~30 s.
  // Fall back to frames if lowRes is empty (older snapshot).
  const longSession = lowRes.length > 0 ? lowRes : frames;
  const t0 = longSession[0].tEpochMs;
  const t1 = longSession[longSession.length - 1].tEpochMs;
  const sessionDurSec = (t1 - t0) / 1000;

  // High-res stats from frames (last ~30 s)
  const arrivalSeries = frames
    .map((f) => f.timings?.chunkArrivalMs)
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  const totalSeries = frames
    .map((f) => f.timings?.totalMs)
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  // Long-session series from lowRes — survives the high-res ring scrolling.
  // lowRes entries store chunkArrivalMs/totalMs as direct fields (not nested
  // under timings), since the structure is intentionally flat for tooling.
  const longArrival = lowRes
    .map((f) => f.chunkArrivalMs)
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  const longTotal = lowRes
    .map((f) => f.totalMs)
    .filter((v) => typeof v === "number" && Number.isFinite(v));

  const stats = (a) => {
    if (a.length === 0) return null;
    const s = [...a].sort((x, y) => x - y);
    return {
      n: a.length,
      median: s[Math.floor(s.length / 2)],
      p95: s[Math.floor(s.length * 0.95)],
      max: s[s.length - 1],
      min: s[0],
      mean: a.reduce((x, y) => x + y, 0) / a.length,
    };
  };

  // Linear-fit slope of `field` vs tEpochMs, in ms-per-second-of-session.
  // `source` is "frames" (high-res, last ~30 s) or "lowRes" (long-session).
  const drift = (source, getY) => {
    const arr = source === "frames" ? frames : lowRes;
    let n = 0, sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    let tBase = null;
    for (const f of arr) {
      const t = f.tEpochMs;
      const y = getY(f);
      if (typeof t !== "number" || typeof y !== "number") continue;
      if (!Number.isFinite(t) || !Number.isFinite(y)) continue;
      if (tBase === null) tBase = t;
      const dt = t - tBase;
      n++; sumX += dt; sumY += y; sumXY += dt * y; sumX2 += dt * dt;
    }
    if (n < 2) return null;
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return null;
    return ((n * sumXY - sumX * sumY) / denom) * 1000; // ms per second
  };

  // Phase-change detection: split the frames into two halves, compare
  // mean chunkArrivalMs. If second half is >2× first half (or absolute
  // jump > 100 ms), call it bimodal and return the split point.
  let bimodal = null;
  if (frames.length >= 20) {
    const mid = Math.floor(frames.length / 2);
    const a1 = arrivalSeries.slice(0, mid);
    const a2 = arrivalSeries.slice(mid);
    const m1 = a1.reduce((x, y) => x + y, 0) / a1.length;
    const m2 = a2.reduce((x, y) => x + y, 0) / a2.length;
    if (m2 > m1 * 2 || (m2 - m1) > 100) {
      bimodal = {
        firstHalfMean: m1,
        secondHalfMean: m2,
        splitTimeSec: (frames[mid].tEpochMs - t0) / 1000,
      };
    }
  }

  // Drift-onset detection from lowRes — find the first second where
  // chunkArrivalMs jumps > 50 ms above the median of the first 10
  // entries. Useful for catching the bimodal kick-in pattern.
  let driftOnsetSec = null;
  if (lowRes.length >= 12) {
    const baseline = [...lowRes.slice(0, 10).map((e) => e.chunkArrivalMs).filter((v) => typeof v === "number")];
    if (baseline.length > 0) {
      const m = [...baseline].sort((a, b) => a - b)[Math.floor(baseline.length / 2)];
      for (let i = 10; i < lowRes.length; i++) {
        const v = lowRes[i].chunkArrivalMs;
        if (typeof v === "number" && v > m + 50) {
          driftOnsetSec = (lowRes[i].tEpochMs - lowRes[0].tEpochMs) / 1000;
          break;
        }
      }
    }
  }

  return {
    sessionDurSec,
    nFrames: frames.length,
    nLowRes: lowRes.length,
    diagFlags: snap.diagFlags ?? null,
    chunkArrivalMs: stats(arrivalSeries),
    totalMs: stats(totalSeries),
    longSession: {
      chunkArrivalMs: stats(longArrival),
      totalMs: stats(longTotal),
    },
    chunkArrivalDriftMsPerSec_recent: drift("frames", (f) => f.timings?.chunkArrivalMs),
    chunkArrivalDriftMsPerSec_long: drift("lowRes", (f) => f.chunkArrivalMs),
    totalDriftMsPerSec_recent: drift("frames", (f) => f.timings?.totalMs),
    totalDriftMsPerSec_long: drift("lowRes", (f) => f.totalMs),
    driftOnsetSec,
    bimodal,
    audio: snap.audio,
    statusErrors: snap.status?.errors?.length ?? 0,
    framesWhileHidden: snap.framesWhileHidden ?? 0,
  };
}

function printSummary(s) {
  console.log("");
  console.log("─".repeat(78));
  console.log(" SUMMARY");
  console.log("─".repeat(78));
  console.log(`  session: ${s.sessionDurSec.toFixed(1)}s, ${s.nFrames} frames (high-res), ${s.nLowRes} low-res samples`);
  if (s.diagFlags) {
    const f = s.diagFlags;
    const overrides = [];
    if (f.DIAG_SR_OVERRIDE) overrides.push(`sr=${f.DIAG_SR_OVERRIDE}`);
    if (f.DIAG_LATENCY_HINT != null) overrides.push(`lat=${f.DIAG_LATENCY_HINT}`);
    if (f.DIAG_NO_LATENCY_CONSTRAINT) overrides.push("nolatconstraint=1");
    if (overrides.length) console.log(`  flags:   ${overrides.join(" ")}`);
  }
  if (s.audio) {
    const granted = s.audio.grantedConstraints ?? {};
    const reqSr = s.audio.requestedConstraints?.sampleRate;
    console.log(`  audio:   sampleRate=${s.audio.sampleRate}Hz${
      reqSr ? ` (requested ${reqSr})` : ""
    } baseLat=${
      ((s.audio.baseLatencySec ?? 0) * 1000).toFixed(1)
    }ms outputLat=${
      ((s.audio.outputLatencySec ?? 0) * 1000).toFixed(1)
    }ms granted.latency=${granted.latency ?? "—"}`);
  }
  if (s.statusErrors > 0) {
    console.log(`  ⚠ status errors: ${s.statusErrors}`);
  }
  if (s.framesWhileHidden > 0) {
    console.log(`  ⚠ frames while page hidden: ${s.framesWhileHidden}`);
  }
  // High-res window (last ~30 s) — shows worst-case latency state.
  if (s.chunkArrivalMs) {
    const c = s.chunkArrivalMs;
    console.log(
      `  chunkArrival (last ~30s): median=${c.median.toFixed(1)}ms ` +
      `p95=${c.p95.toFixed(1)}ms max=${c.max.toFixed(1)}ms (n=${c.n})`,
    );
  }
  if (s.totalMs) {
    const t = s.totalMs;
    console.log(
      `  end-to-end   (last ~30s): median=${t.median.toFixed(1)}ms ` +
      `p95=${t.p95.toFixed(1)}ms max=${t.max.toFixed(1)}ms`,
    );
  }
  // Long session — covers the full capture, drift slope is the load-bearing
  // signal here.
  if (s.longSession?.chunkArrivalMs) {
    const c = s.longSession.chunkArrivalMs;
    console.log(
      `  chunkArrival (full ${s.sessionDurSec.toFixed(0)}s): median=${c.median.toFixed(1)}ms ` +
      `p95=${c.p95.toFixed(1)}ms min=${c.min.toFixed(1)}ms max=${c.max.toFixed(1)}ms`,
    );
  }
  const driftFlag = (d) => Math.abs(d) > 1 ? " ⚠ HIGH" : Math.abs(d) > 0.2 ? " (elevated)" : " ✓";
  if (s.chunkArrivalDriftMsPerSec_long != null) {
    const d = s.chunkArrivalDriftMsPerSec_long;
    console.log(`  drift (chunkArrival, full session): ${d >= 0 ? "+" : ""}${d.toFixed(2)}ms/s${driftFlag(d)}`);
  }
  if (s.chunkArrivalDriftMsPerSec_recent != null) {
    const d = s.chunkArrivalDriftMsPerSec_recent;
    console.log(`  drift (chunkArrival, last ~30s):    ${d >= 0 ? "+" : ""}${d.toFixed(2)}ms/s${driftFlag(d)}`);
  }
  if (s.driftOnsetSec != null) {
    console.log(`  drift onset: t≈${s.driftOnsetSec.toFixed(1)}s (first +50ms above baseline)`);
  }
  if (s.bimodal) {
    const b = s.bimodal;
    console.log(
      `  ⚠ phase change in last ~30s at t≈${b.splitTimeSec.toFixed(1)}s: ` +
      `first-half ${b.firstHalfMean.toFixed(1)}ms → ` +
      `second-half ${b.secondHalfMean.toFixed(1)}ms`,
    );
  }
  console.log("─".repeat(78));
}

function persist(snap, summary) {
  if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(RUNS_DIR, `${ts}.json`);
  writeFileSync(path, JSON.stringify({ summary, snapshot: snap }, null, 2));
  console.log(`  saved: ${path.replace(REPO_ROOT + "\\", "")}`);
}

// ---------------------------------------------------------------------------
//  Utilities
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function originSafe(u) {
  try { return new URL(u).origin; } catch { return null; }
}

async function waitForEval(cdp, expression, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ok = await cdp.eval(expression).catch(() => false);
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

(async () => {
  try {
    phaseDeviceCheck();
    phaseLaunchChrome(url);
    const { target } = await phaseConnectCdp(url);
    const snap = await phaseCapture(target, url, durationSec);
    if (!snap) throw new Error("snapshot() returned null — diag not enabled?");
    const summary = summarize(snap);
    printSummary(summary);
    persist(snap, summary);
    console.log("");
    console.log("✓ done — phone can stay plugged in for the next run.");
  } catch (err) {
    console.error("");
    console.error(`✗ ${err.message}`);
    if (process.env.DEBUG && err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
