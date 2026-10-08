// chrome-cpu.mjs — CPU cost of the listening app per thread in desktop Chrome
// (measurements/resonance-cue-production-path-2026-10-07.md §7,
// measurements/heard-as-cpu-2026-10-07.md).
//
//   npm run build && node scripts/cue-strip-smoke-wavs.mjs --r1=<jobs> &&
//   node scripts/resonance/chrome-cpu.mjs [--wav=build/cue-strip-smoke/speech-woman.wav]
//        [--seconds=60] [--panel=on|off] [--dist=dist] [--warmup=20] [--trace=30]
//        [--out=<result.json>] [--profile=<resonance-worker.cpuprofile>]
//        [--main-profile=<main-thread.cpuprofile>]
//
// The BUILT app (vite preview of --dist) in headless Chrome under ?diag=1, the
// fake mic playing a public LibriSpeech WAV (looped by Chrome). --panel=on
// turns the experimental "Likely heard as" panel on (the gender worker runs
// alongside); default off. Two kinds of numbers:
//
//   1. The resonance worker's own busy time (performance.now() around its
//      chunk + pitch-frame processing) per second of audio, from
//      window.__syrinxDiag.snapshot().resonancePerf, every 10 s for --seconds
//      (the original report; wall-clock, so it includes time the thread was
//      runnable but preempted — machine load inflates it).
//   2. (--trace > 0) THREAD CPU time per second of audio for every thread of
//      the page's renderer — main thread, each worker (gender / resonance /
//      pitch / dsp, identified by the script URL of their tasks), the rest —
//      from a Chrome trace of --trace seconds taken after --warmup seconds:
//      the sum of the thread-clock durations (tdur) of the top-level
//      scheduler tasks (category "toplevel"). Plus the renderer / GPU /
//      browser PROCESS CPU (SystemInfo.getProcessInfo) over the same window,
//      and the gender worker's inferences (count, median inferMs) in it.
//      Audio seconds = wall seconds of the trace (the fake mic runs in real
//      time).
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
const SECONDS = Number(arg("seconds", "60"));
const PORT = Number(arg("port", "4195"));
const PANEL = arg("panel", "off") === "on";
const DIST = arg("dist", "dist");
const WARMUP = Number(arg("warmup", "20"));
const TRACE = Number(arg("trace", "30"));
const OUT = arg("out", "");
const DIAG = arg("diag", "1") !== "0";       // --diag=0: production URL (no overlay / diag instrumentation; no resonancePerf, no inference count)
const MAIN_PROFILE = arg("main-profile", ""); // --main-profile=<file.cpuprofile>: main-thread JS profile of 15 s after the trace
const PROFILE = arg("profile", "");           // --profile=<file.cpuprofile>: resonance-worker JS profile over the 10 s report loop (measurements/resonance-cue-cpu-2026-10-07.md)
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!CHROME || !existsSync(WAV)) { console.error("need Chrome and the WAV"); process.exit(2); }

let server = null, browser = null;
const profile = mkdtempSync(path.join(tmpdir(), "resonance-cpu-"));
function cleanup() {
  if (server?.pid) { try { execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } server = null; }
  const bp = browser?.process?.()?.pid;
  if (bp) { try { execFileSync("taskkill", ["/pid", String(bp), "/T", "/F"], { stdio: "ignore" }); } catch { /* closed */ } }
  browser = null;
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
}
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

server = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort", "--outDir", DIST], { cwd: repo, stdio: "ignore" });
for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://localhost:${PORT}/Syrinx/`)).ok) break; } catch { /* */ } await sleep(200); }
browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: profile,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}`],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const ortFiles = new Set();
page.on("response", (r) => { const u = r.url(); if (/ort-wasm|onnx/.test(u)) ortFiles.add(u.replace(/\?.*$/, "")); });
const cdp = await page.createCDPSession();
await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await page.goto(`http://localhost:${PORT}/Syrinx/${DIAG ? "?diag=1" : ""}`, { waitUntil: "domcontentloaded" });
const click = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(t)); b?.click(); return !!b; }, t);
await page.waitForFunction(() => document.body.innerText.includes("Welcome to Syrinx"), { timeout: 60000 });
await click("Get Started");
await page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
await page.evaluate(() => document.querySelector('input[data-direction="exploring"]')?.closest("label").click());
await click("Continue");
await page.waitForFunction(() => document.body.innerText.includes("Stop Listening"), { timeout: 30000 });
if (PANEL) {
  await page.evaluate(() => [...document.querySelectorAll("[data-heard-as] button")].find((b) => b.textContent.includes("Turn on"))?.click());
  await page.waitForFunction(() => document.querySelector("[data-heard-as]")?.dataset.modelWorker === "ready", { timeout: 180000 });
}
const ua = await browser.version();
const t0 = Date.now();
const elapsed = () => (Date.now() - t0) / 1000;

// ---- per-thread trace ----
let traceResult = null;
async function processCpu() {
  const bs = await browser.target().createCDPSession();
  try {
    const { processInfo } = await bs.send("SystemInfo.getProcessInfo");
    return processInfo;
  } finally { await bs.detach().catch(() => {}); }
}
async function runTrace() {
  await sleep(Math.max(0, WARMUP * 1000 - (Date.now() - t0)));
  const s0 = await page.evaluate(() => window.__syrinxDiag?.snapshot());
  const p0 = await processCpu();
  const w0 = Date.now();
  await page.tracing.start({ categories: (process.env.TRACE_CATS ?? "toplevel,disabled-by-default-devtools.timeline").split(",") });
  await sleep(TRACE * 1000);
  const buf = await page.tracing.stop();
  if (process.env.TRACE_SAVE) writeFileSync(process.env.TRACE_SAVE, Buffer.from(buf));
  const wallS = (Date.now() - w0) / 1000;
  const p1 = await processCpu();
  const s1 = await page.evaluate(() => window.__syrinxDiag?.snapshot());
  const ev = JSON.parse(Buffer.from(buf).toString("utf8"));
  const events = Array.isArray(ev) ? ev : ev.traceEvents;
  // thread names, worker URLs by (pid, tid)
  const key = (e) => `${e.pid}:${e.tid}`;
  const names = new Map(), urls = new Map();
  for (const e of events) {
    if (e.ph === "M" && e.name === "thread_name") names.set(key(e), e.args?.name);
    const u = e.args?.data?.url ?? e.args?.data?.scriptName ?? e.args?.data?.stackTrace?.[0]?.url;
    if (typeof u === "string" && /\/Syrinx\//.test(u)) {
      const m = u.match(/(gender-worker|resonance-worker|pitch-worker|dsp-worker|lab-worker|transformers\.web|ort-wasm[^/]*)/);
      const label = m ? (m[1].startsWith("transformers") || m[1].startsWith("ort-wasm") ? "gender-worker" : m[1]) : null;
      if (label) {
        const c = urls.get(key(e)) ?? new Map();
        c.set(label, (c.get(label) ?? 0) + 1);
        urls.set(key(e), c);
      }
    }
    if (e.name === "TracingSessionIdForWorker" && e.args?.data?.workerThreadId) {
      const u2 = e.args.data.url ?? "";
      const m = u2.match(/(gender-worker|resonance-worker|pitch-worker|dsp-worker|lab-worker)/);
      if (m) { const k2 = `${e.pid}:${e.args.data.workerThreadId}`; const c = urls.get(k2) ?? new Map(); c.set(m[1], (c.get(m[1]) ?? 0) + 1e6); urls.set(k2, c); }
    }
  }
  // the page's renderer pid: the one whose CrRendererMain ran Syrinx script
  const syrinxPids = new Set([...urls.keys()].map((k) => k.split(":")[0]));
  for (const [k, n] of names) if (n === "CrRendererMain" && syrinxPids.has(k.split(":")[0])) urls.set(k, new Map([["main", 1e9]]));
  // top-level task thread time per thread (outermost RunTask only)
  const tasks = new Map();
  for (const e of events) {
    if (e.ph !== "X" || !String(e.cat).split(",").includes("toplevel") || typeof e.tdur !== "number") continue;
    if (!syrinxPids.has(String(e.pid))) continue;
    const a = tasks.get(key(e)) ?? [];
    a.push(e);
    tasks.set(key(e), a);
  }
  const perThread = {};
  let anyTdur = false;
  for (const [k, list] of tasks) {
    list.sort((p, q) => p.ts - q.ts);
    let end = -Infinity, cpu = 0, wall = 0;
    for (const e of list) {
      if (e.ts < end) continue; // nested in the previous top-level task
      end = e.ts + (e.dur ?? 0);
      cpu += e.tdur; wall += e.dur ?? 0;
      anyTdur = true;
    }
    const c = urls.get(k);
    const label = c ? [...c.entries()].sort((p, q) => q[1] - p[1])[0][0] : `other:${names.get(k) ?? "?"}`;
    const r = perThread[label] ?? { cpuMs: 0, wallMs: 0, threads: 0 };
    r.cpuMs += cpu / 1000; r.wallMs += wall / 1000; r.threads++;
    perThread[label] = r;
  }
  // audio seconds = the traced span of the page's renderer (the fake mic runs in real time)
  let tsMin = Infinity, tsMax = -Infinity;
  for (const list of tasks.values()) for (const e of list) { tsMin = Math.min(tsMin, e.ts); tsMax = Math.max(tsMax, e.ts + (e.dur ?? 0)); }
  const tracedS = tsMax > tsMin ? (tsMax - tsMin) / 1e6 : wallS;
  // Audio actually captured per wall second around the trace (the resonance
  // worker's audio count; 1.0 when the fake mic keeps real time — under heavy
  // machine load Chrome's fake capture can starve, and a run below 0.95 is
  // flagged invalid). CPU is divided by the AUDIO seconds of the traced span.
  const audioRate = (s1?.resonancePerf?.audioS != null && s0?.resonancePerf?.audioS != null)
    ? (s1.resonancePerf.audioS - s0.resonancePerf.audioS) / wallS : 1;
  const spanS = tracedS * Math.min(1, audioRate);
  const perAudioS = {};
  let total = 0;
  for (const [label, r] of Object.entries(perThread)) {
    perAudioS[label] = { cpuMsPerS: r.cpuMs / spanS, wallMsPerS: r.wallMs / spanS, threads: r.threads };
    total += r.cpuMs / spanS;
  }
  // process CPU deltas
  const proc = {};
  for (const p of p1) {
    const q = p0.find((x) => x.id === p.id);
    if (!q) continue;
    const d = (p.cpuTime - q.cpuTime) * 1000 / wallS; // cpuTime is seconds
    proc[p.type] = (proc[p.type] ?? 0) + d;
  }
  // gender inferences in the window
  const inf = (s1?.mlInferences ?? []).filter((m) => !(s0?.mlInferences ?? []).some((x) => x.tEpochMs === m.tEpochMs));
  const ims = inf.map((m) => m.inferMs).sort((a, b) => a - b);
  const app = ["gender-worker", "resonance-worker", "pitch-worker", "dsp-worker", "main"].reduce((a, k) => a + (perAudioS[k]?.cpuMsPerS ?? 0), 0);
  traceResult = {
    wallS, tracedS, audioRate, valid: audioRate >= 0.95, spanS, anyTdur, appCpuMsPerS: app, perAudioS, threadTotalCpuMsPerS: total, processCpuMsPerS: proc,
    gender: { inferences: inf.length, perS: inf.length / (wallS * Math.min(1, audioRate)), medianInferMs: ims.length ? ims[ims.length >> 1] : null, p90InferMs: ims.length ? ims[Math.floor(ims.length * 0.9)] : null },
  };
}
let profileTop = null;
async function runProfile() {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  await cdp.send("Profiler.start");
  await sleep(15000);
  const { profile } = await cdp.send("Profiler.stop");
  writeFileSync(MAIN_PROFILE, JSON.stringify(profile));
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]);
    const cf = n.callFrame;
    const k = `${cf.functionName || "(anon)"} ${cf.url.split("/").pop()}:${cf.lineNumber}`;
    self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000);
  }
  const totalMs = (profile.endTime - profile.startTime) / 1000;
  profileTop = { totalMs, top: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30) };
}
const tracing = (TRACE > 0 ? runTrace() : sleep(WARMUP * 1000)).then(() => (MAIN_PROFILE ? runProfile() : null));

const rows = [];
let prof = null;
for (let t = 10; t <= SECONDS; t += 10) {
  await sleep(Math.max(0, t * 1000 - (Date.now() - t0)));
  if (PROFILE && !prof) {
    const w = page.workers().find((x) => x.url().includes("resonance-worker"));
    if (w) {
      prof = w.client;
      await prof.send("Profiler.enable");
      await prof.send("Profiler.setSamplingInterval", { interval: 200 });
      await prof.send("Profiler.start");
    } else console.log("profile: resonance worker target not found yet");
  }
  const s = await page.evaluate(() => window.__syrinxDiag?.snapshot());
  const p = s?.resonancePerf;
  rows.push(p);
  console.log(`t=${t}s (${elapsed().toFixed(0)})  trailing10s ${p?.msPerAudioS?.toFixed(1)} ms/s  mean ${p?.meanMsPerAudioS?.toFixed(1)} ms/s  audio ${p?.audioS?.toFixed(0)} s  bins ${p?.binsAdmitted}+${p?.binsDropped} dropped  forced ${p?.gridForcedUnvoiced}  status ${s?.resonanceStatus?.status}  ml worker ${s?.mlWorkerAlive}`);
}
if (prof) {
  const { profile } = await prof.send("Profiler.stop");
  writeFileSync(PROFILE, JSON.stringify(profile));
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self_ = new Map();
  let total = 0, idle = 0;
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const name = n.callFrame.functionName || "(anonymous)";
    const k = `${name} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`;
    const d = profile.timeDeltas[i];
    total += d;
    if (name === "(idle)") { idle += d; return; }
    self_.set(k, (self_.get(k) ?? 0) + d);
  });
  const busy = total - idle;
  console.log(`worker profile: ${(busy / 1000).toFixed(0)} ms busy of ${(total / 1000).toFixed(0)} ms sampled -> ${PROFILE}`);
  for (const [k, v] of [...self_].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${(100 * v / busy).toFixed(1).padStart(5)} %  ${k}`);
}
await tracing;
const last = rows[rows.length - 1];
const peak = Math.max(...rows.map((r) => r?.msPerAudioS ?? 0));
console.log(`${ua} (panel ${PANEL ? "on" : "off"}, ${DIST}): resonance worker ${last?.meanMsPerAudioS?.toFixed(1)} ms per audio second (session mean), trailing 10 s ${last?.msPerAudioS?.toFixed(1)}, peak ${peak.toFixed(1)}, overloads ${last?.overloads ?? 0}`);
if (traceResult) {
  const tr = traceResult;
  console.log(`trace ${tr.tracedS.toFixed(1)} s traced (${tr.wallS.toFixed(1)} s wall), audio ${tr.audioRate.toFixed(2)} x real time${tr.valid ? "" : " — INVALID (capture starved)"}`);
  console.log(`  (per AUDIO second: ${tr.spanS.toFixed(1)} s) (thread clock ${tr.anyTdur ? "present" : "MISSING"}): thread CPU ms per audio second`);
  for (const [label, r] of Object.entries(tr.perAudioS).sort((a, b) => b[1].cpuMsPerS - a[1].cpuMsPerS)) {
    if (r.cpuMsPerS < 0.5 && label.startsWith("other")) continue;
    console.log(`  ${label.padEnd(34)} ${r.cpuMsPerS.toFixed(1).padStart(7)}  (wall ${r.wallMsPerS.toFixed(1)}, ${r.threads} thr)`);
  }
  console.log(`  ${"app (main + 4 workers)".padEnd(34)} ${tr.appCpuMsPerS.toFixed(1).padStart(7)}`);
  console.log(`  ${"renderer threads total".padEnd(34)} ${tr.threadTotalCpuMsPerS.toFixed(1).padStart(7)}`);
  console.log(`process CPU ms/s: ${Object.entries(tr.processCpuMsPerS).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(", ")}`);
  console.log(`gender inferences: ${tr.gender.inferences} (${tr.gender.perS.toFixed(2)}/s), median inferMs ${tr.gender.medianInferMs?.toFixed(1)}, p90 ${tr.gender.p90InferMs?.toFixed(1)}`);
}
if (profileTop) {
  console.log(`main-thread JS profile, ${(profileTop.totalMs / 1000).toFixed(1)} s (self ms per s):`);
  for (const [k, ms] of profileTop.top) console.log(`  ${(ms / (profileTop.totalMs / 1000)).toFixed(1).padStart(7)}  ${k}`);
}
console.log(`ORT files: ${[...ortFiles].join(" ")}`);
if (OUT) writeFileSync(OUT, JSON.stringify({ ua, panel: PANEL, dist: DIST, wav: path.basename(WAV), resonance: last, resonancePeak: peak, trace: traceResult, ortFiles: [...ortFiles] }, null, 1));
await browser.close().catch(() => {});
cleanup();
process.exit(0);
