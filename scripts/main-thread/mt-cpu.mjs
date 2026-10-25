// mt-cpu.mjs — main-thread CPU of the listening app, attributed
// (measurements/main-thread-cpu-2026-10-08.md).
//
//   npm run build && node scripts/main-thread/mt-cpu.mjs [--dist=dist]
//        [--wav=build/cue-strip-smoke/speech-woman.wav] [--viewport=phone|desktop]
//        [--panel=on|off] [--diag=0|1] [--warmup=20] [--trace=20]
//        [--profile=<main.cpuprofile>] [--out=<result.json>] [--port=4196]
//
// The BUILT app (vite preview of --dist) in headless Chrome, the fake mic
// playing a public LibriSpeech WAV (looped by Chrome), direction "Just
// exploring" (as scripts/resonance/chrome-cpu.mjs). After --warmup s:
//
//   1. A Chrome trace of --trace s: THREAD CPU per audio second of every
//      renderer thread (main + each worker, as chrome-cpu.mjs: the thread-
//      clock durations of the top-level scheduler tasks), and the main
//      thread's time split (a) by the top-level task's first child
//      (rAF / timers / message handlers / style / layout / paint …) and
//      (b) by trace-event name, exclusive thread time, and (c) FunctionCall
//      inclusive time by function (name + script line).
//   2. An in-page frame probe over the same window: requestAnimationFrame
//      intervals (frames, intervals > 25 ms and > 50 ms) and long tasks
//      (PerformanceObserver "longtask").
//   3. (--diag=1) the painted-latency ring of window.__syrinxDiag
//      (capture -> the trace draw that first shows a voiced point) and the
//      handler latency (capture -> display-state update), and per frame
//      their difference, draw - readout update (the judged latency figure:
//      the capture epoch, which carries a run-to-run clock offset, cancels).
//      The trace redraw cadence: draws/s, draw-end gaps (guard 3c) and,
//      from builds whose diag records it, gaps between the frame timestamps
//      the redraw gate compared (no callback jitter or draw-time spread),
//      the loop's frames per draw and the frame-timestamp gaps > 25 ms split
//      into gate skips vs frames the browser never ran
//      (measurements/phone-cpu-2026-10-12.md §7.3 amendment).
//   (--panel=on) changes per second of the heard-as axis range and ring
//      (data-split-man / -woman, data-split-guess; data-axis-lo / -hi / -dot on builds before the 2026-10-20 split bar) during the CPU window.
//   4. (--profile) a 15 s main-thread JS sampling profile after the trace.
//
// Process hygiene (CLAUDE.md hard rule 2): puppeteer with a temporary
// --user-data-dir, browser.close() then taskkill of ITS pid only; the preview
// server is this script's own child, killed by its PID; cleanup on exit /
// SIGINT / SIGTERM / uncaughtException.

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const WAV = path.resolve(arg("wav", path.join(repo, "build/cue-strip-smoke/speech-woman.wav")));
const PORT = Number(arg("port", "4196"));
const PANEL = arg("panel", "off") === "on";
const DIST = arg("dist", "dist");
const WARMUP = Number(arg("warmup", "20"));
const TRACE = Number(arg("trace", "20"));
const OUT = arg("out", "");
const DIAG = arg("diag", "0") === "1";
const PROFILE = arg("profile", "");
const VIEWPORT = arg("viewport", "desktop");
const VIEWPORTS = {
  phone: { width: 448, height: 890, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
};
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!CHROME || !existsSync(WAV) || !VIEWPORTS[VIEWPORT]) { console.error("need Chrome, the WAV and --viewport=phone|desktop"); process.exit(2); }

let server = null, browser = null;
const profileDir = mkdtempSync(path.join(tmpdir(), "mt-cpu-"));
function cleanup() {
  if (server?.pid) { try { execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } server = null; }
  const bp = browser?.process?.()?.pid;
  if (bp) { try { execFileSync("taskkill", ["/pid", String(bp), "/T", "/F"], { stdio: "ignore" }); } catch { /* closed */ } }
  browser = null;
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* locked */ }
}
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

server = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort", "--outDir", DIST], { cwd: repo, stdio: "ignore" });
for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://localhost:${PORT}/Syrinx/`)).ok) break; } catch { /* */ } await sleep(200); }
browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: profileDir,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}`],
});
const page = await browser.newPage();
await page.setViewport(VIEWPORTS[VIEWPORT]);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// Frame probe: installed before the app. Long tasks are observed during the
// CPU window; the rAF interval recorder runs only in a separate smoothness
// window after it (a rAF loop of its own keeps Chrome producing frames, so
// it must not run while CPU is measured).
await page.evaluateOnNewDocument(() => {
  const st = { lt: false, raf: false, intervals: [], longTasks: [], last: null };
  const tick = (t) => {
    if (!st.raf) return;
    if (st.last !== null) st.intervals.push(t - st.last);
    st.last = t;
    requestAnimationFrame(tick);
  };
  try {
    new PerformanceObserver((l) => { if (st.lt) for (const e of l.getEntries()) st.longTasks.push(e.duration); })
      .observe({ type: "longtask", buffered: false });
  } catch { /* unsupported */ }
  window.__mtProbe = {
    armLongTasks() { st.lt = true; st.longTasks = []; },
    readLongTasks() { st.lt = false; return st.longTasks; },
    armRaf() { st.raf = true; st.last = null; st.intervals = []; requestAnimationFrame(tick); },
    readRaf() { st.raf = false; return st.intervals; },
  };
});
const cdp = await page.createCDPSession();
await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await page.goto(`http://localhost:${PORT}/Syrinx/${DIAG ? "?diag=1" : ""}`, { waitUntil: "domcontentloaded" });
await page.bringToFront();
const click = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(t)); b?.click(); return !!b; }, t);
await page.waitForFunction(() => !!document.querySelector("[data-dialog=direction]"), { timeout: 60000 });
await page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
await page.evaluate(() => document.querySelector('input[data-direction="exploring"]')?.closest("label").click());
if (PANEL) {
  await click("Start — allow the microphone");
} else {
  // "Likely heard as" is on by default since 2026-10-25 (no turn-on button): a panel-off run answers the question
  // with Escape, switches the panel off in Settings, then starts listening — the gender worker never starts.
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await page.waitForFunction(() => !document.body.innerText.includes("What are you trying to sound like?"), { timeout: 10000 });
  await page.evaluate(() => document.querySelector('[aria-label="Settings & Data"]')?.click());
  await page.waitForSelector("[data-dialog=settings]", { timeout: 5000 });
  await page.evaluate(() => { const s = document.querySelector("[data-settings-heard-as] [role=switch]"); if (s?.getAttribute("aria-checked") === "true") s.click(); });
  await page.evaluate(() => document.querySelector('[aria-label="Close settings"]')?.click());
  await page.waitForFunction(() => !document.querySelector("[data-dialog=settings]"), { timeout: 5000 });
  await click("Start Listening");
}
await page.waitForFunction(() => document.body.innerText.includes("Stop Listening"), { timeout: 30000 });
if (PANEL) {
  await page.waitForFunction(() => document.querySelector("[data-heard-as]")?.dataset.modelWorker === "ready", { timeout: 180000 });
} else if (page.workers().some((w) => w.url().includes("gender-worker"))) {
  throw new Error("panel-off run: the gender worker is running");
}
const ua = await browser.version();
const t0 = Date.now();
await sleep(Math.max(0, WARMUP * 1000 - (Date.now() - t0)));

// ---- trace ----
const s0 = DIAG ? await page.evaluate(() => window.__syrinxDiag?.snapshot()) : null;
await page.evaluate(() => window.__mtProbe.armLongTasks());
if (PANEL) {
  await page.evaluate(() => {
    const c = { range: 0, dot: 0 };
    window.__mtAxis = c;
    window.__mtAxisObs = new MutationObserver((list) => {
      for (const m of list) {
        if (m.attributeName === "data-split-guess" || m.attributeName === "data-axis-dot") c.dot++;
        else c.range++;
      }
    });
    window.__mtAxisObs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-split-man", "data-split-woman", "data-split-guess", "data-axis-lo", "data-axis-hi", "data-axis-dot"] });
  });
}
const w0 = Date.now();
await page.tracing.start({ categories: ["toplevel", "devtools.timeline", "disabled-by-default-devtools.timeline", "v8", "blink"] });
await sleep(TRACE * 1000);
const buf = await page.tracing.stop();
const wallS = (Date.now() - w0) / 1000;
const longTasks = await page.evaluate(() => window.__mtProbe.readLongTasks());
const axisChanges = PANEL ? await page.evaluate(() => { window.__mtAxisObs?.disconnect(); return window.__mtAxis ?? null; }) : null;
if (axisChanges) { axisChanges.rangePerS = +(axisChanges.range / wallS).toFixed(3); axisChanges.dotPerS = +(axisChanges.dot / wallS).toFixed(3); }
const SMOOTH = Number(arg("smooth", "10"));
await page.evaluate(() => window.__mtProbe.armRaf());
await sleep(SMOOTH * 1000);
const rafIntervals = await page.evaluate(() => window.__mtProbe.readRaf());
const probe = { intervals: rafIntervals, longTasks };
const s1 = DIAG ? await page.evaluate(() => window.__syrinxDiag?.snapshot()) : null;
if (process.env.TRACE_SAVE) writeFileSync(process.env.TRACE_SAVE, Buffer.from(buf));
const ev0 = JSON.parse(Buffer.from(buf).toString("utf8"));
const events = Array.isArray(ev0) ? ev0 : ev0.traceEvents;

const key = (e) => `${e.pid}:${e.tid}`;
const names = new Map(), urls = new Map();
for (const e of events) {
  if (e.ph === "M" && e.name === "thread_name") names.set(key(e), e.args?.name);
  const u = e.args?.data?.url ?? e.args?.data?.scriptName ?? e.args?.data?.stackTrace?.[0]?.url;
  if (typeof u === "string" && /\/Syrinx\//.test(u)) {
    const m = u.match(/(gender-worker|resonance-worker|pitch-worker|dsp-worker|lab-worker|transformers\.web|ort-wasm[^/]*)/);
    const label = m ? (m[1].startsWith("transformers") || m[1].startsWith("ort-wasm") ? "gender-worker" : m[1]) : null;
    if (label) { const c = urls.get(key(e)) ?? new Map(); c.set(label, (c.get(label) ?? 0) + 1); urls.set(key(e), c); }
  }
  if (e.name === "TracingSessionIdForWorker" && e.args?.data?.workerThreadId) {
    const m = (e.args.data.url ?? "").match(/(gender-worker|resonance-worker|pitch-worker|dsp-worker|lab-worker)/);
    if (m) { const k2 = `${e.pid}:${e.args.data.workerThreadId}`; const c = urls.get(k2) ?? new Map(); c.set(m[1], (c.get(m[1]) ?? 0) + 1e6); urls.set(k2, c); }
  }
}
const syrinxPids = new Set([...urls.keys()].map((k) => k.split(":")[0]));
const mainKeys = [];
for (const [k, n] of names) if (n === "CrRendererMain" && syrinxPids.has(k.split(":")[0])) { urls.set(k, new Map([["main", 1e9]])); mainKeys.push(k); }

// Normalise to complete events with tdur (X, or B/E pairs) per thread.
const perThreadEv = new Map();
const open = new Map();
for (const e of events) {
  if (!syrinxPids.has(String(e.pid))) continue;
  const k = key(e);
  if (e.ph === "X") {
    if (typeof e.tdur !== "number") continue;
    (perThreadEv.get(k) ?? perThreadEv.set(k, []).get(k)).push({ name: e.name, cat: e.cat, ts: e.ts, dur: e.dur ?? 0, tdur: e.tdur, args: e.args });
  } else if (e.ph === "B") {
    (open.get(k) ?? open.set(k, []).get(k)).push(e);
  } else if (e.ph === "E") {
    const st = open.get(k);
    const b = st?.pop();
    if (b && typeof b.tts === "number" && typeof e.tts === "number") {
      (perThreadEv.get(k) ?? perThreadEv.set(k, []).get(k)).push({ name: b.name, cat: b.cat, ts: b.ts, dur: e.ts - b.ts, tdur: e.tts - b.tts, args: b.args });
    }
  }
}
const isTop = (e) => String(e.cat).split(",").includes("toplevel");
const perThread = {};
let tsMin = Infinity, tsMax = -Infinity;
for (const [k, list] of perThreadEv) {
  const tops = list.filter(isTop).sort((p, q) => p.ts - q.ts);
  let end = -Infinity, cpu = 0;
  for (const e of tops) {
    if (e.ts < end) continue;
    end = e.ts + e.dur; cpu += e.tdur;
    tsMin = Math.min(tsMin, e.ts); tsMax = Math.max(tsMax, e.ts + e.dur);
  }
  const c = urls.get(k);
  const label = c ? [...c.entries()].sort((p, q) => q[1] - p[1])[0][0] : `other:${names.get(k) ?? "?"}`;
  const r = perThread[label] ?? { cpuMs: 0, threads: 0 };
  r.cpuMs += cpu / 1000; r.threads++;
  perThread[label] = r;
}
const tracedS = tsMax > tsMin ? (tsMax - tsMin) / 1e6 : wallS;
const perAudioS = Object.fromEntries(Object.entries(perThread).map(([l, r]) => [l, +(r.cpuMs / tracedS).toFixed(2)]));

// Main thread attribution: nesting tree by ts / dur.
const exclusive = new Map(), firstChild = new Map(), fnIncl = new Map();
const nodes = [];
for (const mk of mainKeys) {
  const list = (perThreadEv.get(mk) ?? []).sort((p, q) => (p.ts - q.ts) || (q.dur - p.dur));
  const stack = [];
  for (const e of list) {
    const n = { ...e, childT: 0, parent: null, top: null };
    while (stack.length && n.ts >= stack[stack.length - 1].ts + stack[stack.length - 1].dur) stack.pop();
    const p = stack[stack.length - 1] ?? null;
    n.parent = p;
    n.top = p?.top ?? (isTop(n) ? n : null);
    if (p) p.childT += n.tdur;
    stack.push(n);
    nodes.push(n);
  }
}
const fnLabel = (n) => { const d = n.args?.data ?? {}; return `${d.functionName || "(anon)"} ${(d.url ?? "").split("/").pop()}:${d.lineNumber ?? "?"}`; };
for (const n of nodes) {
  if (!n.top) continue; // outside a top-level task
  const self = Math.max(0, n.tdur - n.childT);
  exclusive.set(n.name, (exclusive.get(n.name) ?? 0) + self);
  if (n.parent === n.top) firstChild.set(n.name, (firstChild.get(n.name) ?? 0) + n.tdur);
  if (n === n.top && n.childT < n.tdur) firstChild.set("(task self)", (firstChild.get("(task self)") ?? 0) + (n.tdur - n.childT));
  if (n.name === "FunctionCall") {
    // innermost FunctionCall per stack only counted at the outermost level
    let q = n.parent, nested = false;
    while (q) { if (q.name === "FunctionCall") { nested = true; break; } q = q.parent; }
    if (!nested) {
      // name the call by its parent context (rAF / timer / event / message)
      const ctx = n.parent?.name ?? "?";
      const k = `${ctx} > ${fnLabel(n)}`;
      fnIncl.set(k, (fnIncl.get(k) ?? 0) + n.tdur);
    }
  }
}
const beginMainFrames = nodes.filter((n) => n.name === "WebFrameWidgetImpl::BeginMainFrame").length;
const mainTops = nodes.filter((n) => n.top === n);
const mainTaskOver16 = mainTops.filter((n) => n.dur > 16700).length;
const mainTaskOver50 = mainTops.filter((n) => n.dur > 50000).length;
const toMsPerS = (m) => [...m.entries()].map(([k, v]) => [k, +(v / 1000 / tracedS).toFixed(2)]).sort((a, b) => b[1] - a[1]);

// Frame probe
const iv = probe.intervals;
const frames = iv.length;
const sortedIv = [...iv].sort((a, b) => a - b);
const frameStats = {
  frames, fps: frames / SMOOTH,
  medianMs: sortedIv[sortedIv.length >> 1] ?? null,
  over25: iv.filter((x) => x > 25).length,
  over50: iv.filter((x) => x > 50).length,
  beginMainFramesPerS: beginMainFrames / tracedS, mainTaskOver16, mainTaskOver50,
  longTasks: probe.longTasks.length,
  longTaskMs: probe.longTasks.reduce((a, b) => a + b, 0),
};

// Diag latencies
let latency = null;
if (DIAG && s1) {
  const pl = (s1.paintLatency ?? []).filter((x) => !(s0?.paintLatency ?? []).some((y) => y.t === x.t));
  const tot = (s1.frames ?? []).map((f) => f.timings?.totalMs).filter((x) => typeof x === "number");
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  const t0d = s0?.capturedAtEpochMs ?? 0;
  const draws = (s1.traceDraws ?? []).filter((d) => d.t > t0d);
  const gaps = draws.slice(1).map((d, i) => d.t - draws[i].t).sort((a, b) => a - b);
  // Frame-timestamp gaps (the timestamp the redraw scheduler's gate compared,
  // phone-cpu-2026-10-12.md §7.3 amendment): no callback jitter or draw-time
  // spread, unlike the draw-end gaps above. Only between consecutive draws
  // that both carry one (builds before trace-vsync's fix round record none).
  const ftGaps = draws.slice(1).map((d, i) => (typeof d.ft === "number" && typeof draws[i].ft === "number" ? d.ft - draws[i].ft : null))
    .filter((x) => x !== null).sort((a, b) => a - b);
  const skips = draws.map((d) => d.sk).filter((x) => typeof x === "number");
  // Frame-timestamp gaps > 25 ms (1.5 frames at 60 Hz), split by whether the
  // loop skipped more callbacks before that draw than it usually does (the
  // gate's own cadence, e.g. 0 at 60 Hz, 2 at 180 Hz) — a gate skip — or not
  // — frames the browser never ran.
  const skCount = new Map();
  for (const k of skips) skCount.set(k, (skCount.get(k) ?? 0) + 1);
  const skMode = [...skCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  let longFrameGaps = 0, longWithExtraSkips = 0;
  for (let i = 1; i < draws.length; i++) {
    const d = draws[i], p = draws[i - 1];
    if (typeof d.ft !== "number" || typeof p.ft !== "number" || d.ft - p.ft <= 25) continue;
    longFrameGaps++;
    if (typeof d.sk === "number" && skMode !== null && d.sk > skMode) longWithExtraSkips++;
  }
  const steps = draws.map((d) => d.step).filter((x) => typeof x === "number").sort((a, b) => a - b);
  const q = (a, f) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * f))] : null);
  // Per frame: draw - readout update = paint latency - handler latency (same
  // capture epoch, so its clock offset cancels), joined on the point time.
  const handlerByT = new Map();
  for (const f of s1.frames ?? []) {
    if (typeof f.tEpochMs === "number" && typeof f.timings?.totalMs === "number") handlerByT.set(Math.round(f.tEpochMs), f.timings.totalMs);
  }
  const drawMinusHandler = pl.map((x) => (handlerByT.has(x.t) ? x.ms - handlerByT.get(x.t) : null)).filter((x) => x !== null);
  latency = {
    paintedMedianMs: med(pl.map((x) => x.ms)), paintedN: pl.length, handlerMedianMs: med(tot), handlerN: tot.length,
    drawMinusHandlerMedianMs: med(drawMinusHandler), drawMinusHandlerN: drawMinusHandler.length,
    drawsPerS: draws.length / ((s1.capturedAtEpochMs - t0d) / 1000), drawGapP99Ms: q(gaps, 0.99), drawGapMaxMs: gaps[gaps.length - 1] ?? null,
    frameGapN: ftGaps.length, frameGapMedianMs: q(ftGaps, 0.5), frameGapP99Ms: q(ftGaps, 0.99), frameGapMaxMs: ftGaps[ftGaps.length - 1] ?? null,
    // Loop frames per draw (1 + skipped callbacks): the loop's frame rate is
    // draws/s times this while it runs.
    loopFramesPerDraw: skips.length ? 1 + skips.reduce((a, b) => a + b, 0) / skips.length : null,
    skippedMode: skMode, longFrameGaps, longFrameGapsWithExtraSkips: longWithExtraSkips,
    stepP99CssPx: q(steps, 0.99), stepMaxCssPx: steps[steps.length - 1] ?? null,
  };
}

let profileTop = null;
if (PROFILE) {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  await sleep(15000);
  const { profile } = await cdp.send("Profiler.stop");
  writeFileSync(PROFILE, JSON.stringify(profile));
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const cf = byId.get(profile.samples[i]).callFrame;
    const k = `${cf.functionName || "(anon)"} ${cf.url.split("/").pop()}:${cf.lineNumber + 1}`;
    self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  }
  const totalS = (profile.endTime - profile.startTime) / 1e6;
  profileTop = [...self.entries()].filter(([k]) => !k.startsWith("(idle)")).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => [k, +(v / totalS).toFixed(2)]);
}

const result = {
  ua, dist: DIST, wav: path.basename(WAV), viewport: VIEWPORT, panel: PANEL, diag: DIAG, tracedS, wallS,
  mainMsPerS: perAudioS.main ?? null, perAudioS,
  mainByFirstChild: toMsPerS(firstChild).slice(0, 25),
  mainByExclusive: toMsPerS(exclusive).slice(0, 40),
  mainFunctionCalls: toMsPerS(fnIncl).slice(0, 30),
  frameStats, latency, axisChanges, profileTop, errors,
};
console.log(`${ua} ${DIST} ${VIEWPORT} panel ${PANEL ? "on" : "off"} diag ${DIAG ? 1 : 0} wav ${path.basename(WAV)}: MAIN ${result.mainMsPerS} ms/s; ` +
  Object.entries(perAudioS).filter(([k]) => !k.startsWith("other")).map(([k, v]) => `${k} ${v}`).join(", "));
console.log(`  CPU window: main frames ${frameStats.beginMainFramesPerS.toFixed(1)}/s, main tasks >16.7 ms ${mainTaskOver16}, >50 ms ${mainTaskOver50}, long tasks ${frameStats.longTasks} (${frameStats.longTaskMs.toFixed(0)} ms); rAF probe ${SMOOTH} s: ${frames} frames (${frameStats.fps.toFixed(1)} fps, median ${frameStats.medianMs?.toFixed(1)} ms), >25 ms ${frameStats.over25}, >50 ms ${frameStats.over50}`);
if (axisChanges) console.log(`  heard-as axis attribute changes: range lo/hi ${axisChanges.rangePerS}/s, ring ${axisChanges.dotPerS}/s`);
if (latency) console.log(`  latency: draw - readout update median ${latency.drawMinusHandlerMedianMs?.toFixed(2)} ms (n ${latency.drawMinusHandlerN}); painted median ${latency.paintedMedianMs?.toFixed(1)} ms (n ${latency.paintedN}), handler median ${latency.handlerMedianMs?.toFixed(1)} ms; trace draws ${latency.drawsPerS.toFixed(1)}/s, gap p99 ${latency.drawGapP99Ms?.toFixed(1)} max ${latency.drawGapMaxMs?.toFixed(1)} ms, step p99 ${latency.stepP99CssPx?.toFixed(2)} max ${latency.stepMaxCssPx?.toFixed(2)} CSS px` +
  (latency.frameGapN ? `; frame-timestamp gap median ${latency.frameGapMedianMs.toFixed(1)} p99 ${latency.frameGapP99Ms.toFixed(1)} max ${latency.frameGapMaxMs.toFixed(1)} ms (n ${latency.frameGapN}), loop frames per draw ${latency.loopFramesPerDraw?.toFixed(2)}, gaps > 25 ms ${latency.longFrameGaps} (with extra gate skips ${latency.longFrameGapsWithExtraSkips})` : ""));
if (process.env.MT_VERBOSE) {
  console.log("  by first child of top-level task (ms/s):"); for (const [k, v] of result.mainByFirstChild) console.log(`    ${String(v).padStart(7)}  ${k}`);
  console.log("  by exclusive event (ms/s):"); for (const [k, v] of result.mainByExclusive.slice(0, 25)) console.log(`    ${String(v).padStart(7)}  ${k}`);
  console.log("  FunctionCall inclusive (ms/s):"); for (const [k, v] of result.mainFunctionCalls.slice(0, 20)) console.log(`    ${String(v).padStart(7)}  ${k}`);
  if (profileTop) { console.log("  JS profile self (ms/s):"); for (const [k, v] of profileTop.slice(0, 30)) console.log(`    ${String(v).padStart(7)}  ${k}`); }
}
if (errors.length) console.log(`  page errors: ${errors.slice(0, 3).join(" | ")}`);
if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 1));
await browser.close().catch(() => {});
cleanup();
process.exit(0);
