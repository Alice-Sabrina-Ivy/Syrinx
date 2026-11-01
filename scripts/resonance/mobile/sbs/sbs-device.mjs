// sbs-device.mjs — the device side of the phone-vs-headset kit: a minimal CDP
// client, the recorder (pulls the page logger's rows and PCM every second
// into a run folder, min-round-trip clock sync), and three ways to get a page
// with the logger in it:
//   desktopAttach  the owner's Chrome started with --remote-debugging-port
//                  (9223) and its own --user-data-dir: opens ITS OWN window
//                  (Target.createTarget newWindow) and closes only that target;
//   desktopSpawn   a fresh Chrome (unique --user-data-dir, fake mic = a WAV):
//                  the validation's stand-in device; only ITS pid is killed
//                  (taskkill /pid <pid> /T /F) and its profile removed;
//   phone          Chrome on an Android phone over ADB, USB or wireless
//                  debugging (am start, adb forward to chrome_devtools_remote),
//                  as mobile-diag-capture.js: the tab the intent opened is
//                  picked (ids compared with the list before the intent), every
//                  other Syrinx tab is closed, the tab is brought to the front;
//                  dryRun: no adb at all, the CDP part pointed at another
//                  Chrome's debugging endpoint (cdpUrl).
// Every device object has reconnect(): the recorder calls it when its pulls
// fail (a dropped USB / wireless link, a closed socket) and goes on; the page
// logger keeps buffering meanwhile (up to 180 s of PCM), so nothing is lost.
// CLAUDE.md hard rule 2: nothing here kills by image name or pattern.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { WebSocket } from "ws";
import { loggerScript } from "./sbs-logger.mjs";

export const pcNow = () => performance.timeOrigin + performance.now();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const DEFAULT_URL = "https://alice-sabrina-ivy.github.io/Syrinx/";

// ---------------------------------------------------------------- CDP client
export class CdpClient {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.ws = null; this.nextId = 1; this.pending = new Map(); this.handlers = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.wsUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
    await new Promise((res, rej) => { this.ws.once("open", res); this.ws.once("error", rej); });
    this.ws.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.code}: ${msg.error.message}`)); else resolve(msg.result);
      } else if (msg.method) for (const fn of this.handlers.get(msg.method) ?? []) { try { fn(msg.params); } catch { /* ignore */ } }
    });
    this.ws.on("close", () => { for (const { reject } of this.pending.values()) reject(new Error("CDP socket closed")); this.pending.clear(); this.closed = true; });
    this.ws.on("error", (e) => { this.lastError = String(e?.message || e); }); // after open: a dropped link must not crash the session (close follows)
  }
  on(method, fn) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(fn); }
  send(method, params = {}, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error("CDP socket closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP ${method} timed out after ${timeoutMs} ms`)); } }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(to); resolve(v); }, reject: (e) => { clearTimeout(to); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, timeoutMs = 30000) {
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
export async function jsonFetch(url, opts) { const r = await fetch(url, opts); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); }
export const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
/** Is something already listening on this local port? */
export const portBusy = (port) => new Promise((res) => { const s = net.createServer(); s.once("error", () => res(true)); s.listen(port, "127.0.0.1", () => s.close(() => res(false))); });
/** A page target's CDP client again (same target id), after the socket dropped. */
async function reattach(base, targetId) {
  const list = await jsonFetch(`${base}/json/list`);
  const t = list.find((x) => x.id === targetId);
  if (!t?.webSocketDebuggerUrl) throw new Error(`target ${String(targetId).slice(0, 8)} is gone from ${base}/json/list`);
  const c = new CdpClient(t.webSocketDebuggerUrl);
  await c.connect();
  return c;
}

// ---------------------------------------------------------------- recorder
/**
 * Pulls the page logger into <dir>:
 *   log.jsonl   one line per pull { pc, dev, id, drops, pcmDropped, nChunks, rows: { chunk, pitch, dsp, state, ... } }
 *   pcm.f32     the captured samples (float32, in chunk order), pcm.jsonl { pc, id, off, idx: [[ct, len], ...] }
 *   clock.jsonl min-round-trip syncs { pc, label, n, rtt, offset (dev - pc, ms), samples }
 *   meta.json   written by the caller (device, url, ...)
 */
export class Recorder {
  /** dev: a device object { cdp, reconnect? } (its cdp may be replaced on reconnect), or a bare CdpClient. */
  constructor(name, dir, dev, { pcm = true, log = console.log } = {}) {
    this.name = name; this.dir = dir; this.dev = dev && typeof dev.send === "function" ? { cdp: dev } : dev; this.pcm = pcm; this.log = log;
    this.fails = 0; this.outage = null; this.reconnecting = false;
    mkdirSync(dir, { recursive: true });
    this.files = { log: path.join(dir, "log.jsonl"), pcm: path.join(dir, "pcm.f32"), pcmIdx: path.join(dir, "pcm.jsonl"), clock: path.join(dir, "clock.jsonl") };
    for (const f of [this.files.log, this.files.pcmIdx, this.files.clock]) if (!existsSync(f)) writeFileSync(f, "");
    if (pcm && !existsSync(this.files.pcm)) writeFileSync(this.files.pcm, Buffer.alloc(0));
    this.pcmOff = existsSync(this.files.pcm) ? readFileSync(this.files.pcm).length / 4 : 0;
    this.busy = false; this.timer = null; this.stats = { pulls: 0, errors: 0, chunks: 0, pitch: 0, state: 0, pcmSamples: 0, lastErr: null, docs: new Set(), reconnects: 0, outages: [] };
    // validation only: SBS_TEST_DROP=<device name>:<s> closes this recorder's socket once after <s> s (the reconnect path)
    const drop = (process.env.SBS_TEST_DROP || "").split(":");
    if (drop[0] === name && Number(drop[1]) > 0) setTimeout(() => { this.log(`[${name}] TEST: dropping the CDP socket`); try { this.cdp.ws?.terminate?.(); } catch { /* ignore */ } }, Number(drop[1]) * 1000).unref?.();
  }
  get cdp() { return this.dev.cdp; }
  /** After failed pulls: a loud warning once per outage, then dev.reconnect() (retried on the next pulls). */
  async onPullError(e) {
    this.fails++;
    if (this.fails < 2 && !this.cdp?.closed) return;
    if (!this.outage) {
      this.outage = { from: pcNow(), err: String(e.message || e) };
      this.log(`
!!! [${this.name}] pulls are failing (${this.outage.err}) — reconnecting; the page keeps recording meanwhile (up to ~3 min of audio is buffered there).`);
    }
    if (!this.dev.reconnect || this.reconnecting) return;
    this.reconnecting = true;
    try {
      try { this.cdp?.close(); } catch { /* ignore */ }
      await this.dev.reconnect();
      this.stats.reconnects++;
      this.log(`[${this.name}] reconnected after ${((pcNow() - this.outage.from) / 1000).toFixed(1)} s`);
      this.stats.outages.push({ ...this.outage, to: pcNow() });
      this.outage = null; this.fails = 0;
    } catch (e2) { this.stats.lastErr = `reconnect: ${e2.message || e2}`; } finally { this.reconnecting = false; }
  }
  async pullOnce() {
    if (this.busy) return;
    this.busy = true;
    try {
      const has = await this.cdp.eval("!!window.__sbs", 10000);
      if (!has) return;
      const pc = pcNow();
      const L = await this.cdp.eval("window.__sbs.pull()", 20000);
      if (L) {
        appendFileSync(this.files.log, JSON.stringify({ pc, pcRecv: pcNow(), ...L }) + "\n");
        this.stats.pulls++; this.stats.docs.add(L.id);
        this.stats.chunks += L.rows.chunk.length; this.stats.pitch += L.rows.pitch.length; this.stats.state += L.rows.state.length;
      }
      if (this.pcm) {
        for (let i = 0; i < 6; i++) {
          const P = await this.cdp.eval("window.__sbs.pullPcm(96000)", 20000);
          if (!P || !P.n) break;
          const buf = Buffer.from(P.b64, "base64");
          appendFileSync(this.files.pcm, buf);
          appendFileSync(this.files.pcmIdx, JSON.stringify({ pc, id: P.id, off: this.pcmOff, idx: P.idx }) + "\n");
          this.pcmOff += buf.length / 4;
          this.stats.pcmSamples += P.n;
        }
      }
      this.fails = 0;
    } catch (e) { this.stats.errors++; this.stats.lastErr = String(e.message || e); await this.onPullError(e); } finally { this.busy = false; }
  }
  start(everyMs = 1000) { if (!this.timer) this.timer = setInterval(() => { this.pullOnce(); }, everyMs); }
  async stop() { clearInterval(this.timer); this.timer = null; for (let i = 0; i < 50 && this.busy; i++) await sleep(100); await this.pullOnce(); }
  /** n round trips; the min-RTT sample's offset = dev - (send + recv) / 2 (ms). */
  async clockSync(label, n = 25) {
    const samples = [];
    let fails = 0;
    for (let i = 0; i < n && fails < 3; i++) {
      const a = pcNow();
      let d;
      try { d = await this.cdp.eval("performance.timeOrigin + performance.now()", 5000); fails = 0; } catch { fails++; continue; } // a dead link: give up after 3 in a row
      const b = pcNow();
      samples.push([a, d, b]);
      await sleep(20);
    }
    if (!samples.length) return null;
    const best = samples.reduce((m, s) => (s[2] - s[0] < m[2] - m[0] ? s : m));
    const rec = { pc: (best[0] + best[2]) / 2, label, n: samples.length, rtt: best[2] - best[0], offset: best[1] - (best[0] + best[2]) / 2, samples };
    appendFileSync(this.files.clock, JSON.stringify(rec) + "\n");
    return rec;
  }
}

// ---------------------------------------------------------------- the app on the page
/** Inject the logger before the next document and load url. */
export async function injectAndLoad(cdp, url, cfg, { reload = false } = {}) {
  await cdp.send("Page.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: loggerScript(cfg) });
  try { await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }); } catch { /* old Chrome */ }
  if (reload) await cdp.send("Page.reload", { ignoreCache: false });
  else await cdp.send("Page.navigate", { url });
  for (let i = 0; i < 240; i++) {
    try { if (await cdp.eval("!!window.__sbs && document.readyState !== 'loading' && !!document.querySelector('#root > *')", 5000)) return true; } catch { /* navigating */ }
    await sleep(250);
  }
  throw new Error("the app did not load with the logger within 60 s");
}
/** Where the app stands: the goal sheet, listening, or neither. */
export async function appState(cdp, { scroll = false } = {}) {
  return cdp.eval(`(() => {
    const dlg = document.querySelector("[data-dialog=direction]");
    const listening = !!document.querySelector("[data-dock-mic-off]");
    const checked = dlg && dlg.querySelector("input[data-direction]:checked");
    const btn = [...document.querySelectorAll("button")].find((b) => /Start — allow the microphone|Start practicing|Start Listening/.test(b.textContent) && !b.disabled);
    if (btn && ${scroll ? "true" : "false"}) btn.scrollIntoView({ block: "center" });
    const r = btn && btn.getBoundingClientRect();
    return { dialog: !!dlg, goal: checked ? checked.getAttribute("data-direction") : null, listening, start: r ? { x: r.x + r.width / 2, y: r.y + r.height / 2, text: btn.textContent.trim() } : null,
      vis: document.visibilityState, sbs: !!window.__sbs };
  })()`, 10000);
}
/** Start listening by clicking (a trusted CDP mouse event: getUserMedia needs the activation). goal only when none is chosen. */
export async function autoStart(cdp, { goal = "exploring" } = {}) {
  let s = await appState(cdp);
  if (s.listening) return s;
  if (s.dialog && !s.goal) {
    await cdp.eval(`(() => { const i = document.querySelector('[data-dialog=direction] input[data-direction="${goal}"]'); i && i.closest("label").click(); })()`);
    await sleep(300);
    s = await appState(cdp);
  }
  s = await appState(cdp, { scroll: true });
  if (!s.start) throw new Error("no Start button found");
  await cdp.clickAt(s.start.x, s.start.y);
  for (let i = 0; i < 12; i++) { await sleep(250); const t = await appState(cdp); if (t.listening || !t.start) return t; }
  // still there: a plain element click (Chrome's fake media UI needs no activation)
  await cdp.eval(`(() => { const b = [...document.querySelectorAll("button")].find((b) => /Start — allow the microphone|Start practicing|Start Listening/.test(b.textContent) && !b.disabled); b && b.click(); })()`);
  return s;
}
export async function waitListening(cdp, timeoutMs = 180000, onTick = null) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let s = null;
    try { s = await appState(cdp); } catch { /* reloading */ }
    if (s?.listening) return s;
    if (onTick) onTick(s);
    await sleep(500);
  }
  throw new Error("not listening after " + timeoutMs / 1000 + " s");
}
/** Validation only: switch the "Likely heard as" panel off in this profile (Dexie "syrinx", settings row "default"), then reload. */
export async function heardAsOff(cdp) {
  await cdp.eval(`new Promise((res, rej) => { const r = indexedDB.open("syrinx"); r.onsuccess = () => { const db = r.result;
    if (!db.objectStoreNames.contains("settings")) { db.close(); return res(false); }
    const tx = db.transaction("settings", "readwrite"), st = tx.objectStore("settings"), g = st.get("default");
    g.onsuccess = () => { const row = g.result || { id: "default", createdAt: Date.now() }; row.heardAsEnabled = false; row.updatedAt = Date.now(); st.put(row); };
    tx.oncomplete = () => { db.close(); res(true); }; tx.onerror = () => rej(tx.error); }; r.onerror = () => rej(r.error); })`);
  await cdp.send("Page.reload", { ignoreCache: false });
  await sleep(500);
  for (let i = 0; i < 120; i++) { try { if (await cdp.eval("!!window.__sbs && !!document.querySelector('#root > *')", 5000)) return; } catch { /* reloading */ } await sleep(250); }
}

// ---------------------------------------------------------------- desktop: attach to the owner's Chrome
/** Best-effort download cap for a page (the app's models on first use; the PC's ~100 MB/s rule). Applies to the page target. */
async function capDownloads(cdp, mbps, log) {
  try { await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: mbps * 1024 * 1024, uploadThroughput: -1 }); }
  catch (e) { log(`download cap not applied (${e.message})`); }
}
/** Grant the microphone to the app's origin in that browser (no prompt); best effort. */
async function grantMic(browser, origin, log, where) {
  try { await browser.send("Browser.grantPermissions", { origin, permissions: ["audioCapture"] }); return true; }
  catch (e) { log(`mic permission grant skipped (${e.message}); if ${where} asks for the microphone, allow it`); return false; }
}
export async function desktopAttach({ port = 9223, url = DEFAULT_URL, cfg = {}, netCapMBps = 25, log = console.log } = {}) {
  let ver;
  try { ver = await jsonFetch(`http://127.0.0.1:${port}/json/version`); } catch {
    throw new Error(`no Chrome debugging endpoint on port ${port}. Start the debug Chrome (your normal Chrome can stay open: its own --user-data-dir makes it a separate browser):\n` +
      `  & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=${port} --user-data-dir="C:\\temp\\chrome-debug-profile"\n` +
      `and check http://localhost:${port}/json/version answers.`);
  }
  const base = `http://127.0.0.1:${port}`;
  const browser = new CdpClient(ver.webSocketDebuggerUrl);
  await browser.connect();
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", newWindow: true });
  let target = null;
  for (let i = 0; i < 60 && !target?.webSocketDebuggerUrl; i++) { target = (await jsonFetch(`${base}/json/list`)).find((t) => t.id === targetId); if (!target?.webSocketDebuggerUrl) await sleep(250); }
  if (!target?.webSocketDebuggerUrl) { await browser.send("Target.closeTarget", { targetId }).catch(() => {}); throw new Error("the new window did not appear in /json/list"); }
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  let closed = false;
  const handle = { kind: "desktop-attach", cdp, info: { browser: ver.Browser, port, targetId, url } };
  handle.close = async () => { if (closed) return; closed = true; handle.cdp.close(); try { await browser.send("Target.closeTarget", { targetId }); } catch { /* already closed */ } browser.close(); };
  handle.reconnect = async () => { handle.cdp = await reattach(base, targetId); return handle.cdp; };
  log(`desktop: ${ver.Browser}, own window ${targetId.slice(0, 8)}`);
  handle.info.micGranted = await grantMic(browser, new URL(url).origin, log, "the desktop window");
  await capDownloads(cdp, netCapMBps, log);
  await injectAndLoad(cdp, url, cfg);
  try { await cdp.send("Page.bringToFront"); } catch { /* ignore */ }
  return handle;
}

// ---------------------------------------------------------------- desktop: a spawned Chrome with a fake mic (validation)
export const CHROME_EXE = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
export function pidAlive(pid) {
  const r = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { encoding: "utf8" });
  return new RegExp(`\\b${pid}\\b`).test(r.stdout || "");
}
export function killPid(pid) {
  if (!pid) return true;
  try { execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ }
  for (let i = 0; i < 20; i++) { if (!pidAlive(pid)) return true; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150); }
  return !pidAlive(pid);
}
// every Chrome this process spawned: killed by PID on any exit path (hard rule 2)
const SPAWNED = new Set();
let exitHooked = false;
function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.on("exit", () => { for (const c of SPAWNED) c(); });
  for (const sig of ["SIGTERM", "SIGHUP"]) process.on(sig, () => { for (const c of SPAWNED) c(); process.exit(143); });
  process.on("uncaughtException", (e) => { console.error(e); for (const c of SPAWNED) c(); process.exit(1); });
}
export async function spawnChrome({ wav = null, headless = true, extraArgs = [], log = console.log } = {}) {
  if (!CHROME_EXE) throw new Error("Chrome not found");
  const profile = mkdtempSync(path.join(tmpdir(), "sbs-chrome-"));
  const args = [`--user-data-dir=${profile}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows", "--use-fake-ui-for-media-stream",
    ...(wav ? ["--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`] : []),
    ...(headless ? ["--headless=new"] : []), "--window-size=448,890", ...extraArgs, "about:blank"];
  const child = spawn(CHROME_EXE, args, { stdio: "ignore", windowsHide: true });
  const pid = child.pid;
  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    const f = path.join(profile, "DevToolsActivePort");
    if (existsSync(f)) { const l = readFileSync(f, "utf8").split(/\r?\n/); if (Number(l[0]) > 0) port = Number(l[0]); }
    if (!port) await sleep(150);
  }
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return true;
    cleaned = true;
    SPAWNED.delete(cleanup);
    const gone = killPid(pid);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked for a moment */ }
    return gone;
  };
  SPAWNED.add(cleanup);
  hookExit();
  if (!port) { cleanup(); throw new Error("spawned Chrome gave no debugging port"); }
  log(`spawned Chrome pid ${pid}, port ${port}, profile ${path.basename(profile)}${wav ? `, fake mic ${path.basename(wav)}` : ""}`);
  return { pid, port, profile, cleanup };
}
export async function desktopSpawn({ wav, url, cfg = {}, headless = true, heardAs = true, netCapMBps = 25, log = console.log } = {}) {
  const ch = await spawnChrome({ wav, headless, log });
  try {
    const base = `http://127.0.0.1:${ch.port}`;
    const list = await jsonFetch(`${base}/json/list`);
    const t = list.find((x) => x.type === "page");
    const cdp = new CdpClient(t.webSocketDebuggerUrl);
    await cdp.connect();
    // best-effort download cap (models from huggingface.co on first use)
    await capDownloads(cdp, netCapMBps, log);
    await injectAndLoad(cdp, url, cfg);
    if (!heardAs) await heardAsOff(cdp);
    const handle = { kind: "desktop-spawn", cdp, port: ch.port, pid: ch.pid, info: { pid: ch.pid, port: ch.port, wav, url } };
    handle.close = async () => { handle.cdp.close(); return ch.cleanup(); };
    handle.reconnect = async () => { handle.cdp = await reattach(base, t.id); return handle.cdp; };
    return handle;
  } catch (e) { ch.cleanup(); throw e; }
}

// ---------------------------------------------------------------- phone over ADB
let ADB_SERIAL = null; // set by adbCheck: every adb call then targets that device (-s)
function adbRun(args, { dry = false, log = console.log } = {}) {
  const full = ADB_SERIAL && !dry ? ["-s", ADB_SERIAL, ...args] : args;
  if (dry) { log(`  [dry-run] adb ${args.join(" ")}`); return { stdout: "", stderr: "", status: 0, dry: true }; }
  const r = spawnSync("adb", full, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`adb not on PATH (${r.error.message}). Install Android Platform Tools (CLAUDE.md "Mobile diag capture harness").`);
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}
/** A serial of a wireless-debugging connection (adb connect ip:port, or an mDNS name). */
export const isWirelessSerial = (s) => /:\d+$/.test(s || "") || /_adb-tls-connect/.test(s || "");
export function adbCheck({ dry = false, serial = null, log = console.log } = {}) {
  if (dry) { log("  [dry-run] skipping the ADB device check"); return { serial: "dry-run", model: "dry-run", release: "-", wireless: false }; }
  ADB_SERIAL = null;
  const out = adbRun(["devices"]).stdout.trim().split("\n").slice(1).filter((l) => l.trim()).map((l) => { const [sr, state] = l.split(/\s+/); return { serial: sr, state }; });
  const pin = serial || process.env.ANDROID_SERIAL;
  const dev = pin ? out.find((d) => d.serial === pin) : out.length === 1 ? out[0] : null;
  if (!out.length) throw new Error("no phone on ADB: plug it in by USB (mode \"File transfer\"), unlock it, accept \"Allow USB debugging\" (or connect over wireless debugging: README).");
  if (!dev) throw new Error(pin ? `${pin} is not in 'adb devices' (${out.map((d) => d.serial).join(", ")})` : `${out.length} devices on ADB (${out.map((d) => d.serial).join(", ")}): pass --phone-serial=<one of them> (the ip:port one for wireless debugging)`);
  if (dev.state === "unauthorized") throw new Error(`${dev.serial} is unauthorized: accept "Allow USB debugging" on the phone ("Always allow"), then run again.`);
  if (dev.state !== "device") throw new Error(`${dev.serial} is in state ${dev.state}`);
  ADB_SERIAL = dev.serial;
  const model = adbRun(["shell", "getprop", "ro.product.model"]).stdout.trim();
  const release = adbRun(["shell", "getprop", "ro.build.version.release"]).stdout.trim();
  if (!adbRun(["shell", "pm", "list", "packages", "com.android.chrome"]).stdout.includes("com.android.chrome")) throw new Error("Chrome is not installed on the phone");
  adbRun(["shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
  const wireless = isWirelessSerial(dev.serial);
  let stayOnWas = null;
  if (wireless) {
    // no USB power: keep the screen on while the session runs; the old value is restored at close
    stayOnWas = adbRun(["shell", "settings", "get", "global", "stay_on_while_plugged_in"]).stdout.trim();
    adbRun(["shell", "svc", "power", "stayon", "true"]);
    log(`phone: wireless debugging; screen kept on for the session (stay_on_while_plugged_in was ${stayOnWas}, restored at the end)`);
  } else adbRun(["shell", "svc", "power", "stayon", "usb"]);
  return { serial: dev.serial, model, release, wireless, stayOnWas };
}
/** dumpsys snapshots of the audio input path (raw text + the lines that name the input source / preset / device / rate). */
export function adbAudioDump(dir, tag, { dry = false, log = console.log } = {}) {
  const out = {};
  const devIn = new Set(), active = [];
  for (const [name, args] of [["audio_flinger", ["shell", "dumpsys", "media.audio_flinger"]], ["audio_policy", ["shell", "dumpsys", "media.audio_policy"]], ["audio", ["shell", "dumpsys", "audio"]]]) {
    const r = adbRun(args, { dry, log });
    const txt = r.stdout || "";
    writeFileSync(path.join(dir, `dumpsys-${name}-${tag}.txt`), txt);
    const lines = txt.split(/\r?\n/);
    const keep = lines.filter((l) => /(Input thread|AudioIn|RecordThread|Sample rate|HAL format|HAL frame count|Input device|Input source|input preset|AUDIO_SOURCE|source:|Source:|preset|Effect|NoiseSuppress|AutomaticGain|AcousticEcho|ns:|agc:|aec:|RecordActivityMonitor|recording config|session:|Device:|in_device|AUDIO_DEVICE_IN)/i.test(l));
    out[name] = keep.slice(0, 120).map((l) => l.trim());
    for (const l of lines) {
      for (const m of l.matchAll(/AUDIO_DEVICE_IN_[A-Z_]+/g)) devIn.add(m[0]);
      if (/AUDIO_DEVICE_IN_/.test(l) && /(activ|record|source|session|client|preset|routed|selected)/i.test(l)) active.push(`${name}: ${l.trim()}`);
    }
  }
  out.inputDevices = [...devIn];
  out.activeInputLines = [...new Set(active)].slice(0, 12);
  // the input the recording uses: the AUDIO_DEVICE_IN_* named on the "active" lines (unknown when none or ambiguous)
  const named = [...new Set(out.activeInputLines.flatMap((l) => [...l.matchAll(/AUDIO_DEVICE_IN_[A-Z_]+/g)].map((m) => m[0])))].filter((d) => !/DEFAULT|REMOTE_SUBMIX|TELEPHONY|ECHO_REFERENCE|FM_TUNER/.test(d));
  out.activeInput = named.length === 1 ? named[0] : named.length ? named.join(" / ") : null;
  writeFileSync(path.join(dir, `dumpsys-summary-${tag}.json`), JSON.stringify(out, null, 1));
  return out;
}
const targetMatches = (want) => (t) => t.type === "page" && t.url && (() => { try { const u = new URL(t.url); return u.origin === want.origin && u.pathname.startsWith(want.pathname); } catch { return false; } })();
/** Newest first: numeric tab ids (Android Chrome) compared as numbers; other ids keep the list order. */
const byNewest = (a, b) => (/^\d+$/.test(a.id) && /^\d+$/.test(b.id) ? Number(b.id) - Number(a.id) : 0);
export async function phone({ url = DEFAULT_URL, cdpPort = 0, cfg = {}, dryRun = false, cdpUrl = null, heardAs = true, serial = null, needWireless = false, log = console.log } = {}) {
  const dev = adbCheck({ dry: dryRun, serial, log });
  log(`phone: ${dev.serial} ${dev.model} (Android ${dev.release})${dev.wireless ? ", wireless debugging" : ""}`);
  if (needWireless && !dryRun && !dev.wireless) throw new Error("the --dongle step needs the phone on WIRELESS debugging: its only USB-C port takes the Maxwell's dongle, and the session's link to the phone runs over ADB (README \"Wireless debugging\"). Pair it, then run again with --phone-serial=<ip:port>.");
  if (url.includes("'")) throw new Error("URL with a single quote");
  // the PC port for the forward: a free one unless given (9222 is often taken by another Chrome debug instance)
  let port = cdpPort;
  if (!dryRun) {
    if (!port) port = await freePort();
    else if (await portBusy(port)) throw new Error(`PC port ${port} is already in use (another Chrome debug instance?): pass another --phone-cdp-port, or leave it out to pick a free one`);
  }
  const base = cdpUrl ?? `http://127.0.0.1:${port}`;
  const forward = () => {
    if (dryRun) { adbRun(["forward", `tcp:${port}`, "localabstract:chrome_devtools_remote"], { dry: true, log }); return; }
    adbRun(["forward", "--remove", `tcp:${port}`]);
    const f = adbRun(["forward", `tcp:${port}`, "localabstract:chrome_devtools_remote"]);
    if (f.status !== 0) throw new Error(`adb forward failed: ${f.stderr}`);
  };
  const want = new URL(url);
  const listMatching = async () => (await jsonFetch(`${base}/json/list`)).filter(targetMatches(want));
  forward();
  // the Syrinx tabs before the intent (Chrome's debugging socket only exists while Chrome runs: none if this fails)
  let before = null;
  try { before = new Set((await listMatching()).map((t) => t.id)); } catch { before = null; }
  if (!dryRun) {
    const r = adbRun(["shell", `am start -a android.intent.action.VIEW -d '${url}' com.android.chrome`]);
    if (r.status !== 0) throw new Error(`am start failed: ${r.stderr || r.stdout}`);
  } else {
    adbRun(["shell", `am start -a android.intent.action.VIEW -d '${url}' com.android.chrome`], { dry: true, log });
    // stand-in for the intent: open the URL in the other Chrome
    await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: "PUT" }).catch(() => fetch(`${base}/json/new?${encodeURIComponent(url)}`));
  }
  let ver = null;
  for (let i = 0; i < 40 && !ver; i++) { try { ver = await jsonFetch(`${base}/json/version`); } catch { await sleep(500); } }
  if (!ver) throw new Error(`no CDP at ${base}: is Chrome in front on the phone? (chrome://inspect on the PC should list the phone)`);
  if (!before) { before = new Set(); log("phone: Chrome was not running before the intent: every Syrinx tab counts as new"); }
  // the tab the intent opened: a matching target that was not there before (newest if several); else the newest matching one
  let target = null, all = [];
  for (let i = 0; i < 40 && !target; i++) {
    all = (await listMatching()).sort(byNewest);
    target = all.find((t) => !before.has(t.id)) ?? null;
    if (!target && i >= 10) target = all[0] ?? null; // no new tab after 5 s: the intent reused one
    if (!target) await sleep(500);
  }
  if (!target) throw new Error(`no tab with ${url} on the phone after 20 s (accept any prompt on the phone and run again)`);
  // close every other Syrinx tab: a second listening copy would load the phone and hold the microphone
  const others = all.filter((t) => t.id !== target.id);
  for (const t of others) { try { await fetch(`${base}/json/close/${t.id}`); } catch { /* best effort */ } }
  if (others.length) log(`phone: closed ${others.length} other Syrinx tab(s) (${others.map((t) => t.id).join(", ")})`);
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  log(`phone: ${ver.Browser}, tab ${target.id.slice(0, 8)} ${target.url}`);
  try { await cdp.send("Page.bringToFront"); } catch { /* ignore */ }
  let micGranted = false;
  try {
    const b = new CdpClient(ver.webSocketDebuggerUrl ?? `ws://127.0.0.1:${port}/devtools/browser`);
    await b.connect();
    micGranted = await grantMic(b, want.origin, log, "the phone");
    b.close();
  } catch (e) { log(`phone: mic permission grant skipped (${e.message}); accept the prompt on the phone if it shows`); }
  await injectAndLoad(cdp, url, cfg, { reload: true });
  try { await cdp.send("Page.bringToFront"); } catch { /* ignore */ }
  if (dryRun && !heardAs) await heardAsOff(cdp); // validation stand-in only
  const handle = { kind: dryRun ? "phone-dry" : "phone", cdp, info: { ...dev, browser: ver.Browser, url, cdp: base, port, dryRun, targetId: target.id, closedTabs: others.map((t) => t.id), micGranted } };
  handle.reconnect = async () => { if (!dryRun) forward(); handle.cdp = await reattach(base, target.id); return handle.cdp; };
  handle.close = async () => {
    handle.cdp.close();
    if (!dryRun) {
      adbRun(["forward", "--remove", `tcp:${port}`]);
      if (dev.wireless && dev.stayOnWas != null && /^\d+$/.test(dev.stayOnWas)) adbRun(["shell", "settings", "put", "global", "stay_on_while_plugged_in", dev.stayOnWas]);
    }
    return true;
  };
  return handle;
}
