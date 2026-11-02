// timing-run.mjs — the resonance cue in the BUILT app under a slow device:
// headless Chrome, the fake mic playing a timing-wav.mjs WAV, and every
// capture chunk / pitch message / resonance state post / displayed value
// logged with its wall-clock time. Diagnosis only; nothing under src/ changes.
//
//   node scripts/resonance/mobile/timing-run.mjs --wav=<abs .wav> --cond=<name>
//        [--throttle=0|4|6] [--throttle-workers=1|0] [--busy=40/100] [--affinity=0xC000]
//        [--seconds=<wall s; default manifest durS + 15>] [--port=4301]
//        [--dist=build/resonance-mobile/timing/dist] [--out=build/resonance-mobile/timing/runs]
//
// Conditions:
//   --throttle=N   CDP Emulation.setCPUThrottlingRate N on the page target and
//                  (unless --throttle-workers=0) on every worker target as it
//                  is created (pitch, dsp, resonance, gender) — whether each
//                  worker accepted it is logged.
//   --busy=a/b     an injected setInterval busy loop of a ms every b ms on the
//                  page's main thread (phone main-thread load stand-in).
//   --affinity=M   the page's renderer process(es) of THIS browser restricted
//                  to the CPU mask M (PowerShell ProcessorAffinity on those
//                  PIDs only), set after navigation, before Start.
//
// Instrumentation (installed before the app loads; it only listens and adds
// fields the app ignores):
//   * MessagePort.prototype.postMessage on the page: the MSTP capture
//     reader's chunk dispatch — wall time, contextTime, mean square, length;
//   * window.Worker wrapper: every pitch-worker "pitch" message (arrival wall,
//     contextTime, worker post time ts, voiced, pitch, vad.voice, inferMs,
//     vadMs) and every resonance-worker "state" post (arrival wall + fields);
//     status / vad-status messages of every worker;
//   * the resonance worker is started from a blob module that first imports
//     a hook module and then the app's own built resonance-worker file: the
//     hook records, inside the worker, the contextTime and handling-start
//     time of the latest audio chunk and of the latest pitch hint, and adds
//     them to each "state" post as __tm (the worker's own code is the
//     shipped file, unchanged; the hook only resolves its two "/Syrinx/..."
//     fetches against the page origin, which a blob worker cannot do);
//   * a MutationObserver on the resonance column's data-value / data-state
//     (what the row shows, with the DOM commit time);
//   * a 50 ms setInterval lateness probe of the main thread.
// Process hygiene (CLAUDE.md hard rule 2): puppeteer with a fresh
// --user-data-dir per run, browser.close() then taskkill of ITS pid only; the
// vite preview server is this script's child, killed by its PID.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const WAV = arg("wav", "");
const COND = arg("cond", "base");
const THROTTLE = Number(arg("throttle", "0"));
const THROTTLE_WORKERS = arg("throttle-workers", "1") !== "0";
const BUSY = arg("busy", "");
const AFFINITY = arg("affinity", "");
const PORT = Number(arg("port", "4301"));
const DIST = arg("dist", "build/resonance-mobile/timing/dist");
const OUTDIR = path.resolve(repo, arg("out", "build/resonance-mobile/timing/runs"));
const DIRECTION = arg("direction", "exploring");
const SR = arg("sr", "");
const URL_EXTRA = arg("url-extra", "");
const MSTP_BUFFER = Number(arg("mstp-buffer", "0")); // >0: MediaStreamTrackProcessor maxBufferSize (Chrome default 10 frames: 100 ms of the fake device's 10 ms frames, 400 ms of a phone's 40 ms frames) // e.g. "&latexact=0.04" (diag flag: 40 ms capture buffers, as the phone grants) // ?sr= diag flag: ask getUserMedia for the phone's 48 kHz (the fake device defaults to 44.1 kHz); "" = none
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!WAV || !path.isAbsolute(WAV) || !existsSync(WAV) || !CHROME) { console.error("need --wav=<absolute path> and Chrome"); process.exit(2); }
const manifest = JSON.parse(readFileSync(WAV.replace(/\.wav$/, ".json"), "utf8"));
const SECONDS = Number(arg("seconds", String(Math.ceil(manifest.durS + 15))));
const [busyMs, busyPeriod] = BUSY ? BUSY.split("/").map(Number) : [0, 0];
const tag = `${COND}__${path.basename(WAV, ".wav")}`;
mkdirSync(OUTDIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(path.join(tmpdir(), "rtiming-"));
let server = null, browser = null;
function killPid(pid) {
  if (!pid) return;
  try { execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ }
}
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  const bp = browser?.process?.()?.pid;
  try { await browser?.close(); } catch { /* closed */ }
  killPid(bp); browser = null;
  killPid(server?.pid); server = null;
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
}
function cleanupSync() {
  const bp = browser?.process?.()?.pid;
  killPid(bp); browser = null;
  killPid(server?.pid); server = null;
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
}
process.on("exit", cleanupSync);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { cleanupSync(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); cleanupSync(); process.exit(1); });

// ---- the resonance worker hook (a module imported before the app's worker file)
const HOOK = `
const ORIGIN = "__ORIGIN__";
const _f = self.fetch.bind(self);
self.fetch = (u, o) => _f(typeof u === "string" && u.startsWith("/") ? ORIGIN + u : u, o);
const T = () => performance.timeOrigin + performance.now();
const S = { ct: null, chArr: null, nCh: 0, hCt: null, hArr: null, nH: 0 };
const pd = Object.getOwnPropertyDescriptor(MessagePort.prototype, "onmessage");
Object.defineProperty(MessagePort.prototype, "onmessage", { configurable: true,
  get() { return pd.get.call(this); },
  set(h) { pd.set.call(this, typeof h === "function" ? function (ev) { const m = ev.data; if (m && typeof m.contextTime === "number") { S.ct = m.contextTime; S.chArr = T(); S.nCh++; } return h.call(this, ev); } : h); } });
let p = self, gd = null;
while (p && !(gd = Object.getOwnPropertyDescriptor(p, "onmessage"))) p = Object.getPrototypeOf(p);
Object.defineProperty(self, "onmessage", { configurable: true,
  get() { return gd.get.call(self); },
  set(h) { gd.set.call(self, typeof h === "function" ? function (ev) { const m = ev.data; if (m && m.type === "pitch-hint" && typeof m.contextTime === "number") { S.hCt = m.contextTime; S.hArr = T(); S.nH++; } return h.call(this, ev); } : h); } });
const _pm = self.postMessage.bind(self);
self.postMessage = function (m, t) {
  if (m && m.type === "state") m.__tm = { ct: S.ct, chArr: S.chArr, nCh: S.nCh, hCt: S.hCt, hArr: S.hArr, nH: S.nH, wt: T() };
  return arguments.length > 1 ? _pm(m, t) : _pm(m);
};
`;

function pageInstr(cfg, hook) {
  const T = () => performance.timeOrigin + performance.now();
  const L = (window.__tm = { cfg, chunks: [], pitch: [], states: [], wstatus: [], dom: [], lag: [], hints: 0, t0: T(), workers: [] });
  // capture chunk dispatch (MSTP reader runs on this thread)
  const PM = MessagePort.prototype.postMessage;
  let lastCt = -1;
  MessagePort.prototype.postMessage = function (m) {
    if (m && typeof m.contextTime === "number" && m.buffer instanceof ArrayBuffer && m.contextTime !== lastCt) {
      lastCt = m.contextTime;
      const x = new Float32Array(m.buffer);
      let s = 0;
      for (let i = 0; i < x.length; i++) s += x[i] * x[i];
      L.chunks.push(T(), m.contextTime, s / Math.max(1, x.length), x.length);
    }
    return PM.apply(this, arguments);
  };
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(url, opts) {
      const s = String(url);
      const isRes = s.includes("resonance-worker");
      let u = url;
      if (isRes) {
        const abs = new URL(s, location.href).href;
        const hookUrl = URL.createObjectURL(new Blob([hook.replace("__ORIGIN__", location.origin)], { type: "text/javascript" }));
        u = URL.createObjectURL(new Blob([`import "${hookUrl}";\nimport "${abs}";\n`], { type: "text/javascript" }));
      }
      super(u, opts);
      const kind = isRes ? "resonance" : (s.match(/(pitch|dsp|gender|lab|vp)-worker/)?.[1] ?? "other");
      L.workers.push({ t: T(), kind, url: s });
      this.addEventListener("message", (e) => {
        const m = e.data, now = T();
        if (!m || !m.type) return;
        if (kind === "pitch" && m.type === "pitch") {
          L.pitch.push(now, m.contextTime ?? NaN, m.ts ?? NaN, m.voiced ? 1 : 0, m.pitch ?? 0, m.vad ? (m.vad.voice ? 1 : 0) : -1, m.inferMs ?? -1, m.vadMs ?? -1);
        } else if (kind === "resonance" && m.type === "state") {
          L.states.push({
            a: now, u: m.u, raw: m.raw, uPlain: m.uPlain, n: m.n, fill: m.fill, voicedS: m.voicedS, clamp: m.clamp, verdict: m.verdict,
            startU: m.startU, shownStartU: m.shownStartU, sinceResumeS: m.sinceResumeS, framesDropped: m.framesDropped,
            nbOn: m.narrowband?.on ?? null, nbDecided: m.narrowband?.decided ?? null, nbF: m.narrowband?.f ?? null,
            perf: m.perf ?? null, tm: m.__tm ?? null,
          });
        } else if (m.type === "status" || m.type === "vad-status") {
          L.wstatus.push({ a: now, kind, type: m.type, status: m.status, message: m.message ?? null });
        }
      });
      if (isRes) {
        const P = this.postMessage;
        this.postMessage = function (m) { if (m && m.type === "pitch-hint") L.hints++; return P.apply(this, arguments); };
      }
    }
  };
  // what the resonance row shows
  const mo = new MutationObserver((recs) => {
    const now = T();
    for (const r of recs) {
      const el = r.target;
      if (el.getAttribute && el.getAttribute("data-cue") === "resonance") L.dom.push(now, r.attributeName === "data-value" ? 1 : 2, el.getAttribute(r.attributeName));
    }
  });
  const obs = () => mo.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-value", "data-state"] });
  if (document.documentElement) obs(); else document.addEventListener("DOMContentLoaded", obs);
  // main-thread lateness probe: per second, max and sum of setInterval lateness
  let last = performance.now(), sec = Math.floor(T() / 1000), mx = 0, sum = 0, cnt = 0;
  setInterval(() => {
    const now = performance.now(), late = Math.max(0, now - last - 50);
    last = now;
    const s = Math.floor(T() / 1000);
    if (s !== sec) { L.lag.push(sec, mx, sum, cnt); sec = s; mx = 0; sum = 0; cnt = 0; }
    mx = Math.max(mx, late); sum += late; cnt++;
  }, 50);
  if (cfg.mstpBuffer > 0 && window.MediaStreamTrackProcessor) {
    const M = window.MediaStreamTrackProcessor;
    const Wrapped = function (init) { return new M({ ...init, maxBufferSize: init?.maxBufferSize ?? cfg.mstpBuffer }); };
    Wrapped.prototype = M.prototype;
    window.MediaStreamTrackProcessor = Wrapped;
  }
  if (cfg.busyMs > 0) setInterval(() => { const t = performance.now(); while (performance.now() - t < cfg.busyMs) { /* busy */ } }, cfg.busyPeriod);
}

server = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort", "--outDir", DIST], { cwd: repo, stdio: "ignore" });
for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://localhost:${PORT}/Syrinx/`)).ok) break; } catch { /* not yet */ } await sleep(200); }
browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: profile,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}`,
    "--autoplay-policy=no-user-gesture-required"],
});
const ua = await browser.version();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const cdp = await page.createCDPSession();
await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
const throttleLog = [];
if (THROTTLE > 1) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  throttleLog.push({ target: "page", ok: true });
}
page.on("workercreated", async (w) => {
  const url = w.url();
  if (THROTTLE > 1 && THROTTLE_WORKERS) {
    try { await w.client.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE }); throttleLog.push({ target: url, ok: true }); }
    catch (e) { throttleLog.push({ target: url, ok: false, err: String(e?.message || e) }); }
  } else throttleLog.push({ target: url, ok: null });
});
page.on("pageerror", (e) => console.log("pageerror:", String(e?.message || e).slice(0, 200)));
await page.evaluateOnNewDocument(pageInstr, { cond: COND, throttle: THROTTLE, busyMs, busyPeriod, mstpBuffer: MSTP_BUFFER }, HOOK);
await page.goto(`http://localhost:${PORT}/Syrinx/?diag=1${SR ? `&sr=${SR}` : ""}${URL_EXTRA}`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.bringToFront();

async function processInfo() {
  const bs = await browser.target().createCDPSession();
  try { return (await bs.send("SystemInfo.getProcessInfo")).processInfo; } finally { await bs.detach().catch(() => {}); }
}
let affinityLog = null;
if (AFFINITY) {
  await sleep(500);
  const procs = await processInfo();
  const rend = procs.filter((p) => p.type === "renderer").map((p) => p.id);
  const ps = rend.map((pid) => `$p=Get-Process -Id ${pid}; $p.ProcessorAffinity=[IntPtr]${AFFINITY}; "${pid}:"+$p.ProcessorAffinity`).join("; ");
  const outp = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
  affinityLog = { mask: AFFINITY, renderers: rend, result: outp.trim() };
  console.log(`affinity: ${affinityLog.result.replace(/\s+/g, " ")}`);
}

await page.waitForFunction(() => !!document.querySelector("[data-dialog=direction]"), { timeout: 60000 });
await page.evaluate(async (dir) => {
  const root = document.querySelector("[role=dialog]");
  root.querySelector(`input[data-direction="${dir}"]`)?.closest("label").click();
  await new Promise((r) => setTimeout(r, 150));
  [...root.querySelectorAll("button")].find((b) => /Start — allow the microphone|Start practicing/.test(b.textContent))?.click();
}, DIRECTION);
const tClick = Date.now();
await page.waitForFunction(() => document.body.innerText.includes("Mic off"), { timeout: 30000 });
await cdp.send("Performance.enable");
const perfM = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
const m0 = await perfM();
const p0 = await processInfo();
const w0 = Date.now();
console.log(`${tag}: listening (${ua}); running ${SECONDS} s; throttle ${THROTTLE} (workers ${THROTTLE_WORKERS}), busy ${BUSY || "-"}, affinity ${AFFINITY || "-"}`);
for (let t = 30; t <= SECONDS; t += 30) {
  await sleep(Math.max(0, t * 1000 - (Date.now() - w0)));
  const s = await page.evaluate(() => {
    const L = window.__tm, st = L.states[L.states.length - 1];
    return { chunks: L.chunks.length / 4, pitch: L.pitch.length / 8, states: L.states.length, u: st?.u, perf: st?.perf, fd: st?.framesDropped, ws: L.wstatus.map((x) => `${x.kind}:${x.status}`).slice(-6).join(",") };
  });
  console.log(`  ${t}s chunks ${s.chunks} pitch ${s.pitch} states ${s.states} u ${s.u?.toFixed?.(2)} res ${s.perf?.msPerAudioS?.toFixed?.(1)} ms/s bins ${s.perf?.binsAdmitted}+${s.perf?.binsDropped} forced ${s.perf?.gridForcedUnvoiced} fd ${s.fd} | ${s.ws}`);
}
const wallS = (Date.now() - w0) / 1000;
const m1 = await perfM();
const mainThread = Object.fromEntries(["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "TaskOtherDuration"].map((k) => [k + "MsPerS", ((m1[k] - m0[k]) * 1000) / wallS]));
console.log(`main thread (Performance.getMetrics, wall ms per s): ${Object.entries(mainThread).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", ")}`);
const p1 = await processInfo();
const proc = {};
for (const p of p1) { const q = p0.find((x) => x.id === p.id); if (q) proc[`${p.type}:${p.id}`] = ((p.cpuTime - q.cpuTime) * 1000) / wallS; }
const log = await page.evaluate(() => {
  const d = window.__syrinxDiag?.snapshot?.();
  return { ...window.__tm, diagAudio: d?.audio ?? null, diagErrors: d?.errors ?? null };
});
const out = path.join(OUTDIR, `${tag}.json`);
writeFileSync(out, JSON.stringify({ tag, cond: COND, urlExtra: URL_EXTRA, mstpBuffer: MSTP_BUFFER, wav: WAV, ua, throttle: THROTTLE, throttleWorkers: THROTTLE_WORKERS, busy: BUSY, affinity: affinityLog, throttleLog, tClick, wallS, procCpuMsPerS: proc, mainThread, log }));
console.log(`${tag}: wrote ${out}; throttle targets ${throttleLog.map((x) => `${x.target.split("/").pop().slice(0, 24)}=${x.ok}`).join(" ")}`);
await cleanup();
process.exit(0);
