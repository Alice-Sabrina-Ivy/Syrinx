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

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

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
}

// ---------------------------------------------------------------------------
//  Phase 2: launch Chrome with the diag URL
// ---------------------------------------------------------------------------

function phaseLaunchChrome(targetUrl) {
  console.log("[2/6] Launching Chrome on device…");
  // Set the URL via the standard browser intent. Android's Chrome accepts
  // this even if it's not the default browser, and brings the relevant
  // tab to foreground if the URL matches. Adding a cache-buster query
  // would force a fresh load but breaks the diag flag — keep as-is and
  // accept that hot-reload may serve a stale page if the URL was open
  // before. (Vite dev's HMR usually fixes this, but if you change schema
  // mid-iteration, manually close Chrome's tab on the phone first.)
  const r = adb(
    "shell", "am", "start",
    "-a", "android.intent.action.VIEW",
    "-d", targetUrl,
    "com.android.chrome",
  );
  if (r.status !== 0) {
    throw new Error(`am start failed: ${r.stderr || r.stdout}`);
  }
  console.log(`      intent dispatched: ${targetUrl}`);
}

// ---------------------------------------------------------------------------
//  Phase 3: forward CDP socket and connect via Puppeteer
// ---------------------------------------------------------------------------

async function phaseConnectCdp() {
  console.log("[3/6] Setting up CDP forward (localhost:9222 → device chrome_devtools_remote)…");
  // Tear down any prior forward to avoid "address already in use" weirdness.
  adb("forward", "--remove", `tcp:${CDP_PORT}`); // ignore failure
  adbCheckOk("adb forward", "forward", `tcp:${CDP_PORT}`, "localabstract:chrome_devtools_remote");

  // CDP can take a beat to come up after Chrome launches. Poll the
  // /json/version endpoint until it responds or we time out.
  const startedAt = Date.now();
  const timeoutMs = 15000;
  let cdpInfo = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${CDP_PORT}/json/version`);
      if (res.ok) { cdpInfo = await res.json(); break; }
    } catch { /* CDP not ready yet */ }
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

  console.log("[4/6] Connecting Puppeteer to remote browser…");
  const browser = await puppeteer.connect({
    browserURL: `http://localhost:${CDP_PORT}`,
    defaultViewport: null,
  });
  return browser;
}

// ---------------------------------------------------------------------------
//  Phase 4: find the diag tab and run the capture window
// ---------------------------------------------------------------------------

async function phaseCapture(browser, targetUrl, durationSec) {
  // The intent above asks Chrome to navigate. Find the tab whose URL
  // matches our origin (case-insensitive) — Chrome may add a fragment
  // or normalize trailing slashes.
  const targetOrigin = new URL(targetUrl).origin;
  console.log(`[5/6] Locating Syrinx tab (origin=${targetOrigin})…`);

  let page = null;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20000) {
    const pages = await browser.pages();
    page = pages.find((p) => {
      try { return new URL(p.url()).origin === targetOrigin; }
      catch { return false; }
    });
    if (page) break;
    await sleep(500);
  }
  if (!page) {
    const known = (await browser.pages()).map((p) => p.url()).join("\n        ");
    throw new Error(
      `No tab matched origin ${targetOrigin}. Open tabs:\n        ${known || "(none)"}\n` +
      `  - Make sure the cert warning was accepted on the phone the first time.\n` +
      `  - If "Your connection is not private" is showing, tap Advanced → Proceed.\n`
    );
  }
  console.log(`      tab url: ${page.url()}`);

  // Force a fresh page load. Without this, the harness inherits whatever
  // state the previous run left behind: stale workers, an HMR'd diag.js
  // module instance pointing at empty state, etc. Reloading is the only
  // reliable way to ensure window.__syrinxDiag and the React app share
  // the same module instance.
  console.log("      reloading page for fresh state…");
  await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });

  // Wait for the React app + diag overlay to mount. We poll for the
  // window.__syrinxDiag handle that diag.js attaches when DIAG_ENABLED.
  // This is more reliable than DOM polling because the Welcome overlay
  // can defer the audio pipeline until the user taps "Get Started",
  // but __syrinxDiag is attached at module load regardless.
  const ready = await waitFor(page, () => !!window.__syrinxDiag, 10000);
  if (!ready) {
    throw new Error(
      `window.__syrinxDiag never attached. The page didn't load with ?diag=1, or\n` +
      `the JS failed to evaluate. Check the device for an error overlay.`
    );
  }
  console.log("      diag module attached ✓");

  // Click "Get Started" or "Start Listening" if either is present —
  // dismisses the welcome overlay and triggers start() which kicks
  // off the audio pipeline.
  //
  // Must use CDP mouse-driven click (page.mouse.click on element coords),
  // NOT page.evaluate(() => btn.click()). Programmatic .click() does not
  // count as user activation in modern Chromium, so getUserMedia silently
  // fails on mobile (the permission gate requires a user gesture).
  // Symptom of getting this wrong: status.worklet/worker stay null,
  // status.errors stays empty (no throw — just permission denied with
  // no surface signal).
  const targetText = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent.includes("Get Started") ||
      b.textContent.includes("Start Listening"));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { text: btn.textContent.trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (targetText) {
    await page.mouse.click(targetText.x, targetText.y);
    console.log(`      clicked: ${targetText.text} (mouse @ ${Math.round(targetText.x)},${Math.round(targetText.y)})`);
  } else {
    console.log(`      no start button visible (audio likely already running)`);
  }

  // Wait for at least one frame so we know the pipeline is alive before
  // committing to the full duration. If frames don't appear in 5s, bail
  // — cuts down debugging time when something's broken upstream.
  const firstFrameOk = await waitFor(
    page,
    () => (window.__syrinxDiag.state.frames.toArray().length ?? 0) > 0,
    8000,
  );
  if (!firstFrameOk) {
    const status = await page.evaluate(() => window.__syrinxDiag.state.status);
    throw new Error(
      `No frames within 8s of clicking start. Status:\n${JSON.stringify(status, null, 2)}\n` +
      `  - Mic permission may not be granted on the phone.\n` +
      `  - Or the AudioWorklet is throwing — check status.errors above.`
    );
  }

  // Capture window with periodic heartbeat
  console.log(`[6/6] Collecting for ${durationSec}s…`);
  const tCapStart = Date.now();
  const heartbeatMs = 5000;
  while (Date.now() - tCapStart < durationSec * 1000) {
    await sleep(Math.min(heartbeatMs, durationSec * 1000 - (Date.now() - tCapStart)));
    const elapsed = Math.round((Date.now() - tCapStart) / 1000);
    const liveStats = await page.evaluate(() => {
      const d = window.__syrinxDiag?.state;
      const frames = d?.frames.toArray() ?? [];
      const last = frames[frames.length - 1];
      return {
        nFrames: frames.length,
        lastChunkArrivalMs: last?.timings?.chunkArrivalMs ?? null,
        nErrors: d?.status?.errors?.length ?? 0,
      };
    });
    console.log(
      `      collecting… ${elapsed}s/${durationSec}s ` +
      `(n=${liveStats.nFrames}, last chunkArrival=${
        liveStats.lastChunkArrivalMs == null ? "—" : liveStats.lastChunkArrivalMs.toFixed(1) + "ms"
      }${liveStats.nErrors > 0 ? `, errors=${liveStats.nErrors}` : ""})`
    );
  }

  // Pull the snapshot via the same path the overlay button uses, but
  // skip the download dance (which depends on Chrome's download-manager
  // on Android being able to write to /sdcard/Download — sometimes
  // sandboxed). Read the snapshot object directly out of the page.
  //
  // Uses window.__syrinxDiag.snapshot rather than `await import(...)` of
  // diag.js because Vite serves the module differently between eager
  // imports (React graph) and ad-hoc dynamic imports — the dynamic
  // import resolves to a fresh module instance with empty state. The
  // window handle always points at the React app's actual state.
  console.log("      reading snapshot directly from page (avoids Android download path)…");
  const snapshot = await page.evaluate(() => {
    const d = window.__syrinxDiag;
    if (!d) throw new Error("window.__syrinxDiag not attached — page didn't load with ?diag=1");
    return d.snapshot();
  });

  return snapshot;
}

// ---------------------------------------------------------------------------
//  Phase 5: summarize + persist
// ---------------------------------------------------------------------------

function summarize(snap) {
  const frames = snap.frames ?? [];
  if (frames.length === 0) {
    return { error: "no frames in snapshot" };
  }
  const t0 = frames[0].tEpochMs;
  const t1 = frames[frames.length - 1].tEpochMs;
  const sessionDurSec = (t1 - t0) / 1000;

  const arrivalSeries = frames
    .map((f) => f.timings?.chunkArrivalMs)
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  const totalSeries = frames
    .map((f) => f.timings?.totalMs)
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

  const drift = (field) => {
    let n = 0, sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    let tBase = null;
    for (const f of frames) {
      const t = f.tEpochMs;
      const y = f.timings?.[field];
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

  return {
    sessionDurSec,
    nFrames: frames.length,
    chunkArrivalMs: stats(arrivalSeries),
    totalMs: stats(totalSeries),
    chunkArrivalDriftMsPerSec: drift("chunkArrivalMs"),
    totalDriftMsPerSec: drift("totalMs"),
    bimodal,
    audio: snap.audio,
    statusErrors: snap.status?.errors?.length ?? 0,
    framesWhileHidden: snap.framesWhileHidden ?? 0,
  };
}

function printSummary(s) {
  console.log("");
  console.log("─".repeat(72));
  console.log(" SUMMARY");
  console.log("─".repeat(72));
  console.log(`  session: ${s.sessionDurSec.toFixed(1)}s, ${s.nFrames} frames`);
  if (s.audio) {
    const granted = s.audio.grantedConstraints ?? {};
    console.log(`  audio:   sampleRate=${s.audio.sampleRate}Hz baseLat=${
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
  if (s.chunkArrivalMs) {
    const c = s.chunkArrivalMs;
    console.log(
      `  chunkArrival: median=${c.median.toFixed(1)}ms ` +
      `p95=${c.p95.toFixed(1)}ms max=${c.max.toFixed(1)}ms (n=${c.n})`,
    );
  }
  if (s.totalMs) {
    const t = s.totalMs;
    console.log(
      `  end-to-end:   median=${t.median.toFixed(1)}ms ` +
      `p95=${t.p95.toFixed(1)}ms max=${t.max.toFixed(1)}ms`,
    );
  }
  if (s.chunkArrivalDriftMsPerSec != null) {
    const d = s.chunkArrivalDriftMsPerSec;
    const flag = Math.abs(d) > 1 ? " ⚠ HIGH" : Math.abs(d) > 0.2 ? " (elevated)" : "";
    console.log(`  drift (chunkArrival): ${d >= 0 ? "+" : ""}${d.toFixed(2)}ms/s${flag}`);
  }
  if (s.totalDriftMsPerSec != null) {
    const d = s.totalDriftMsPerSec;
    console.log(`  drift (total):        ${d >= 0 ? "+" : ""}${d.toFixed(2)}ms/s`);
  }
  if (s.bimodal) {
    const b = s.bimodal;
    console.log(
      `  ⚠ phase change at t≈${b.splitTimeSec.toFixed(1)}s: ` +
      `first-half ${b.firstHalfMean.toFixed(1)}ms → ` +
      `second-half ${b.secondHalfMean.toFixed(1)}ms`,
    );
  }
  console.log("─".repeat(72));
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

async function waitFor(page, predicate, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ok = await page.evaluate(predicate).catch(() => false);
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

(async () => {
  let browser = null;
  try {
    phaseDeviceCheck();
    phaseLaunchChrome(url);
    browser = await phaseConnectCdp();
    const snap = await phaseCapture(browser, url, durationSec);
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
  } finally {
    // Disconnect Puppeteer (don't close the browser — it's the user's
    // running Chrome instance on the phone, not ours).
    if (browser) {
      try { await browser.disconnect(); } catch { /* ignore */ }
    }
  }
})();
