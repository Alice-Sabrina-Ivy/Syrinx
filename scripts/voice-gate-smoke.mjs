// voice-gate-smoke.mjs — headless browser check of the voice gate ("Hide
// pitch when no voice is heard"; noise-detector try-out 2026-10-20, merged
// into cue-strip 2026-10-21; measurements/noise-detector-tryout-2026-10-20.md)
// against the BUILT app (dist/, served by `vite preview`), with Chrome's fake
// microphone playing public clips. The app loads the model from the Hugging
// Face mirror at FIRERED_MODEL.mirrorCommit (network needed); dist/ must not
// hold a local copy (models/firered/), so the run checks the mirror itself.
//
//   npm run build && node scripts/voice-gate-smoke.mjs [--noise=<16 kHz noise-only wav>] [--json=<out>] [--port=N]
//
// Fake-mic WAVs (written to build/voice-gate-smoke/, 48 kHz, band-limited
// x3 from the 16 kHz sources):
//   speech  the three committed LibriSpeech excerpts (tests/resonance-lab/
//           fixtures, CC BY 4.0), 15 s
//   held    the committed VocalSet long tones (tests/dsp/data/notch-real
//           vs_f2_262 + vs_m1_128, CC BY 4.0), 18.75 s
//   noise   --noise (16 kHz, 16-bit PCM or 32-bit float; e.g. one of the
//           screen's tuning machine-noise clips), default the committed
//           MS-SNSD air conditioner (ac114, CC0), 10 s. A clip FireRedVAD
//           itself hears as voice fails the hide check — that is the
//           detector, not the plumbing (e.g. Freesound hvac 121285: no
//           "no voice" hop even on its native 16 kHz samples;
//           scripts/firered/tune194-replay.mjs gives per-clip numbers)
// Chrome loops each file. One fresh temporary profile per run; Chrome and the
// preview server are closed by their own PIDs (CLAUDE.md hard rule 2).
//
// Runs (each a fresh Chrome on its WAV, ?diag=1 so the page exposes its
// per-frame display decisions through window.__syrinxDiag):
//   noise   the model: both files requested from huggingface.co/<mirror>/
//           resolve/<mirrorCommit>/ (none from the app's own server), the
//           detector "ready" (the loader's size + sha256 checks passed), and
//           both files in Cache Storage (syrinx-voice-detector-onnx / -cmvn)
//           with the pinned sha256, read back in the page;
//           then gate on 20 s -> switched off in Settings 12 s -> on again 8 s:
//           on hides the pitch line (shown <= 20 % of what the chain painted,
//           after the first 3 s, whose cold start the 2 s hangover keeps
//           open); off shows exactly what the chain paints; the switch flips.
//           The cue strip, sampled every 250 ms: with the gate on from the
//           start the resonance row never gets a position (the resonance
//           worker's pitch hint is gated; user decision 2026-10-21), the
//           row stays idle — "—", not "keep talking…" (it reads the gated
//           flags since 2026-10-21; measurements/
//           voice-gate-resonance-row-2026-10-21.md): idle on >= 80 % and
//           "keep talking…" on <= 10 % of the samples after the first 3 s —
//           and the HNR readout shows "—" on >= 80 % of them; with the gate
//           off it shows a number again (information:
//           whether the resonance row gets a position there — once it has
//           one it keeps it, so the last "on" part is not judged for it).
//   reload  the same browser profile, page reloaded, listening again: the
//           detector is ready with no request for the ONNX file (served from
//           Cache Storage).
//   noise-off  a fresh start with the gate off for 20 s: the ungated
//           resonance row gets a position on this clip and leaves "idle" on
//           more of the samples than with the gate on (the case is real; on
//           the committed air-conditioner clip the first position came after
//           ~10 s in the 2026-10-21 run).
//   speech  gate on 16 s: speech is kept (shown >= 97 % of painted frames);
//           the gate takes the resonance row to "idle" no more than a
//           gate-off run on the same clip does (speech-off, 16 s): idle
//           share at most 10 points above it, dot share at most 10 points
//           below it. One-sided: the gate can only add "idle" and remove
//           dots, and two live runs differ in timing by themselves (a gate-on
//           run once drew more dots than its gate-off run, 90 vs 75 %, with
//           the machine at ~90 % CPU from other work).
//   held    gate on 20 s: information (share of the held notes' painted
//           frames the gate hides; the screen's known cost).
//   unavailable the mirror unreachable (this Chrome resolves no
//           huggingface.co / hf.co host): before listening Settings says the
//           detector starts when you start listening; then the detector
//           reports "unavailable", Settings says it could not load and pitch
//           is shown as before (no developer command), nothing is hidden.
// Every run: no page errors or console errors. CPU: the pitch worker's own
// time per 25 ms hop for the detector (front end + model call), median / p95,
// from the diag ring, over the hops with a decision after the first one. The
// hops right after the model loads score the frames that waited for it (at
// most 50 per hop) and carry no decision: their time is reported separately
// and each must stay under one hop's 25 ms (no stalled pitch post).

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const OUT = path.join(repo, "build", "voice-gate-smoke");
const NOISE = arg("noise", path.join(repo, "tests/dsp/data/notch-real/ac114.wav"));
const JSON_OUT = arg("json", path.join(OUT, "result.json"));
const PORT = Number(arg("port", "4193"));
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!CHROME) { console.error("need Chrome"); process.exit(2); }
if (!existsSync(path.join(repo, "dist", "index.html"))) { console.error("run npm run build first"); process.exit(2); }
const { FIRERED_MODEL, FIRERED_CACHE_PREFIX } = await import(pathToFileURL(path.join(repo, "src/dsp/firered-vad.js")).href);
if (!FIRERED_MODEL.mirrorCommit) { console.error("FIRERED_MODEL.mirrorCommit is null: this smoke checks the mirror"); process.exit(2); }
const MIRROR_BASE = `https://huggingface.co/${FIRERED_MODEL.mirror}/resolve/${FIRERED_MODEL.mirrorCommit}/`;
// Hosts the "unavailable" run makes unreachable (the mirror and its CDNs).
const HF_BLOCK = "MAP huggingface.co ~NOTFOUND, MAP *.huggingface.co ~NOTFOUND, MAP hf.co ~NOTFOUND, MAP *.hf.co ~NOTFOUND";
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- WAVs
const { upsample } = await import(pathToFileURL(path.join(repo, "scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs")).href);
function readWav16k(file) {
  const b = readFileSync(file);
  let o = 12, fmt = null;
  while (o + 8 <= b.length) {
    const id = b.toString("ascii", o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === "fmt ") fmt = { tag: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === "data") {
      const f32 = fmt?.tag === 3 && fmt.bits === 32;
      if (!fmt || fmt.sr !== 16000 || !(fmt.bits === 16 || f32)) throw new Error(`${file}: expected 16 kHz, 16-bit PCM or 32-bit float`);
      const w = fmt.bits / 8;
      const n = Math.floor(size / w / fmt.ch);
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = f32 ? b.readFloatLE(o + 8 + w * i * fmt.ch) : b.readInt16LE(o + 8 + w * i * fmt.ch) / 32768;
      return x;
    }
    o += 8 + size + (size & 1);
  }
  throw new Error(`${file}: no data`);
}
function writeWav48(file, x16) {
  const x = upsample(x16);
  const buf = Buffer.alloc(44 + 2 * x.length);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + 2 * x.length, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(48000, 24); buf.writeUInt32LE(96000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(2 * x.length, 40);
  for (let i = 0; i < x.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + 2 * i);
  writeFileSync(file, buf);
  return x.length / 48000;
}
const cat = (...xs) => { const y = new Float32Array(xs.reduce((a, x) => a + x.length, 0)); let o = 0; for (const x of xs) { y.set(x, o); o += x.length; } return y; };
const WAV = {
  speech: path.join(OUT, "speech.wav"),
  held: path.join(OUT, "held.wav"),
  noise: path.join(OUT, "noise.wav"),
};
const fx = (f) => readWav16k(path.join(repo, f));
const durs = {
  speech: writeWav48(WAV.speech, cat(fx("tests/resonance-lab/fixtures/ls_woman_high.wav"), fx("tests/resonance-lab/fixtures/ls_man_low.wav"), fx("tests/resonance-lab/fixtures/ls_man_hi8_f105.wav"))),
  held: writeWav48(WAV.held, cat(fx("tests/dsp/data/notch-real/vs_f2_262.wav"), fx("tests/dsp/data/notch-real/vs_m1_128.wav"))),
  noise: writeWav48(WAV.noise, readWav16k(NOISE)),
};
console.log(`fake-mic WAVs: speech ${durs.speech.toFixed(1)} s, held ${durs.held.toFixed(1)} s, noise ${durs.noise.toFixed(1)} s (${path.basename(NOISE)})`);

// ---------------------------------------------------------------- browser
let server = null;
let browser = null;
const profiles = [];
function closeBrowserHard() {
  const bp = browser?.process?.()?.pid;
  if (bp) { try { execFileSync("taskkill", ["/pid", String(bp), "/T", "/F"], { stdio: "ignore" }); } catch { /* closed */ } }
  browser = null;
}
function cleanup() {
  if (server?.pid) { try { execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } server = null; }
  closeBrowserHard();
  for (const p of profiles) { try { rmSync(p, { recursive: true, force: true }); } catch { /* locked */ } }
}
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function startServer() {
  server = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: "ignore" });
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/Syrinx/`); if (r.ok) return; } catch { /* not yet */ }
    await sleep(200);
  }
  throw new Error("preview server did not start");
}

// Model requests seen by the page (its workers' too): the mirror, any other
// Hugging Face host, and the app's own models/firered/.
const isModelUrl = (u) => /huggingface\.co|(^|\.)hf\.co\/|models\/firered\//.test(u);
function watchModel(page, net) {
  page.on("request", (r) => { if (isModelUrl(r.url())) net.push({ url: r.url(), status: null, failed: null }); });
  page.on("response", (r) => {
    const e = [...net].reverse().find((x) => x.url === r.url() && x.status === null);
    if (e) e.status = r.status();
  });
  page.on("requestfailed", (r) => {
    const e = [...net].reverse().find((x) => x.url === r.url() && x.failed === null);
    if (e) e.failed = r.failure()?.errorText ?? "failed";
  });
}
async function launch(wav, { extraArgs = [] } = {}) {
  if (browser) { await browser.close().catch(() => {}); closeBrowserHard(); }
  const profile = mkdtempSync(path.join(tmpdir(), "voice-gate-smoke-"));
  profiles.push(profile);
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: profile,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required", ...extraArgs],
  });
  const page = await browser.newPage();
  const net = [];
  watchModel(page, net);
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.goto(`http://localhost:${PORT}/Syrinx/?diag=1`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.bringToFront();
  return { page, errors, net };
}
// The voice detector's Cache Storage entries, read back in the page:
// { name: [{ url, bytes, sha256 }] }.
const cachedModel = (page, prefix) => page.evaluate(async (pre) => {
  const out = {};
  for (const name of (await caches.keys()).filter((n) => n.startsWith(pre))) {
    const c = await caches.open(name);
    out[name] = [];
    for (const req of await c.keys()) {
      const b = await (await c.match(req)).arrayBuffer();
      const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
      out[name].push({ url: req.url, bytes: b.byteLength, sha256: h });
    }
  }
  return out;
}, prefix);

const clickButton = (page, texts, scope = "") => page.evaluate((ts, scope) => {
  const root = scope ? document.querySelector(scope) : document;
  const b = [...(root?.querySelectorAll("button") ?? [])].find((x) => ts.some((t) => x.textContent.trim().includes(t)));
  if (b) b.click();
  return !!b;
}, texts, scope);
// First visit: the welcome, then the direction question, answered with Escape
// (answers without starting). The "Likely heard as" panel is on by default
// since 2026-10-25, so it is switched off in Settings before listening: these
// runs measure the voice gate without the gender worker and its model
// download, as before. Then Start Listening, unless start: false.
async function startListening(page, { start = true } = {}) {
  await page.waitForFunction(() => !!document.querySelector("[data-dialog=direction]"), { timeout: 60000 });
  await page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
  await page.evaluate(() => document.querySelector('[role=dialog] input[data-direction="exploring"]')?.closest("label")?.click());
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await page.waitForFunction(() => !document.body.innerText.includes("What are you trying to sound like?"), { timeout: 10000 });
  await openSettings(page);
  await page.evaluate(() => {
    const s = document.querySelector("[data-settings-heard-as] [role=switch]");
    if (s?.getAttribute("aria-checked") === "true") s.click();
  });
  await closeSettings(page);
  if (!start) return;
  await clickButton(page, ["Start Listening"]);
  await page.waitForFunction(() => document.body.innerText.includes("Stop Listening"), { timeout: 30000 });
}
async function openSettings(page) {
  await page.evaluate(() => document.querySelector('[aria-label="Settings & Data"]')?.click());
  await page.waitForSelector("[data-dialog=settings]", { timeout: 5000 });
}
async function closeSettings(page) {
  await page.evaluate(() => document.querySelector('[aria-label="Close settings"]')?.click());
  await page.waitForFunction(() => !document.querySelector("[data-dialog=settings]"), { timeout: 5000 });
}
const gateSwitch = (page) => page.evaluate(() => document.querySelector("[data-voice-gate-switch]")?.getAttribute("aria-checked") ?? null);
const gateStatus = (page) => page.evaluate(() => ({
  diag: window.__syrinxDiag?.state?.voiceGate ?? null,
  text: document.querySelector("[data-voice-gate-status-text]")?.textContent ?? null,
}));
async function setGate(page, on) {
  await openSettings(page);
  const before = await gateSwitch(page);
  if ((before === "true") !== on) await page.evaluate(() => document.querySelector("[data-voice-gate-switch]")?.click());
  await sleep(150);
  const after = await gateSwitch(page);
  await closeSettings(page);
  return { before, after };
}
const now = (page) => page.evaluate(() => performance.timeOrigin + performance.now());
// The cue strip every 250 ms for `ms`: the resonance row's position (its
// data-value; "" = no position), its state and dot, and the HNR readout's
// text.
async function sampleStrip(page, ms) {
  const out = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    out.push(await page.evaluate(() => ({
      t: performance.timeOrigin + performance.now(),
      res: document.querySelector('[data-cue="resonance"]')?.dataset.value ?? null,
      resState: document.querySelector('[data-cue="resonance"]')?.dataset.state ?? null,
      resDot: document.querySelector('[data-cue="resonance"]')?.dataset.dot === "1",
      // the visible text (Fixed also lays out "HNR -00 dB" invisibly for its width)
      hnr: document.querySelector("[data-cue-hnr] span > span:not([aria-hidden])")?.textContent?.trim() ?? null,
    })));
    await sleep(250);
  }
  return out;
}
const hasPos = (x) => x.res !== null && x.res !== "";
// Row-state shares of strip samples: not idle (any state but idle /
// starting), "keep talking…" (warming), a drawn dot.
function rowShares(st) {
  const n = st.length || 1;
  return {
    n: st.length,
    notIdle: st.filter((x) => x.resState && !["idle", "starting"].includes(x.resState)).length / n,
    idle: st.filter((x) => x.resState === "idle").length / n,
    warming: st.filter((x) => x.resState === "warming").length / n,
    dot: st.filter((x) => x.resDot).length / n,
  };
}
const shareText = (r) => `not idle ${pct(r.notIdle)}, "keep talking…" ${pct(r.warming)}, dot ${pct(r.dot)} of ${r.n}`;
const hnrNumber = (x) => /HNR\s*-?\d+\s*dB/.test(x.hnr ?? "");
// Per-frame display decisions in [t0, t1] (epoch ms) from the diag ring.
async function frames(page, t0, t1) {
  return page.evaluate((a, b) => window.__syrinxDiag.state.frames.toArray()
    .filter((f) => f.tEpochMs >= a && f.tEpochMs <= b)
    .map((f) => ({ t: f.tEpochMs, painted: !!f.painted, shown: !!f.shown, hidden: !!f.vadHidden, vadVoice: f.vadVoice, vadP: f.vadP })), t0, t1);
}
function summary(fr) {
  const n = fr.length;
  const painted = fr.filter((f) => f.painted).length;
  const shown = fr.filter((f) => f.shown).length;
  const mismatch = fr.filter((f) => f.shown !== f.painted).length;
  const noVoice = fr.filter((f) => f.vadVoice === false).length;
  const decided = fr.filter((f) => f.vadVoice === true || f.vadVoice === false).length;
  return { n, painted, shown, hiddenPainted: painted - shown, mismatch, noVoice, decided,
    shownOfPainted: painted ? shown / painted : null };
}
const pct = (v) => (v == null ? "—" : `${(100 * v).toFixed(1)} %`);
async function vadTimes(page) {
  return page.evaluate(() => {
    const e = window.__syrinxDiag.state.pitchInferences.toArray();
    const decided = (x) => typeof x.vadVoice === "boolean";
    const firstDecided = e.findIndex(decided);
    const vad = e.slice(firstDecided + 1).filter(decided).map((x) => x.vadMs).filter((v) => typeof v === "number");
    const pitch = e.map((x) => x.inferMs).filter((v) => typeof v === "number");
    return { vad, pitch };
  });
}
// Right after the model is ready: the detector time of the hops that caught
// up on the waiting frames (model loaded, no decision yet) and of the first
// decided hop.
async function catchupTimes(page) {
  return page.evaluate(() => {
    const e = window.__syrinxDiag.state.pitchInferences.toArray();
    const firstDecided = e.findIndex((x) => typeof x.vadVoice === "boolean");
    if (firstDecided < 0) return null;
    return e.slice(0, firstDecided + 1).map((x) => x.vadMs).filter((v) => typeof v === "number");
  });
}
const quant = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
async function waitReady(page, status = "ready", ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await gateStatus(page);
    if (s.diag?.status === status) return true;
    await sleep(200);
  }
  return false;
}

const report = { noise: path.basename(NOISE), durs, runs: {} };
const cpu = { vad: [], pitch: [], catchup: [] };
async function noteCatchup(page, run) {
  await sleep(1500);
  const c = await catchupTimes(page);
  if (c) cpu.catchup.push(...c);
  console.log(`INFO  ${run}: model ready; ${c ? c.length : "?"} hop(s) caught up on the waiting frames, max ${c && c.length ? Math.max(...c).toFixed(2) : "—"} ms`);
}
await startServer();
console.log(`preview on :${PORT}`);

// ---------------------------------------------------------------- noise
{
  console.log("\n== noise-only, gate on / off / on (and the model from the mirror)");
  const { page, errors, net } = await launch(WAV.noise);
  await startListening(page);
  check("noise: detector ready (size + sha256 checks passed)", await waitReady(page), JSON.stringify((await gateStatus(page)).diag));
  await noteCatchup(page, "noise");
  // The model: from the mirror at the pinned commit, never the app's server.
  const want = FIRERED_MODEL.files.map((f) => MIRROR_BASE + f.name);
  const own = net.filter((e) => /models\/firered\//.test(e.url) && !e.url.startsWith("https://huggingface.co/"));
  check("model: both files requested from the mirror at the pinned commit",
    want.every((u) => net.some((e) => e.url === u)), net.map((e) => `${e.url.replace(MIRROR_BASE, "<mirror>/")} ${e.status ?? e.failed ?? "?"}`).join(" | "));
  check("model: no request to the app's own models/firered/", own.length === 0, own.map((e) => e.url).join(" | "));
  const cached = await cachedModel(page, FIRERED_CACHE_PREFIX);
  const cacheOk = FIRERED_MODEL.files.every((f) => (cached[FIRERED_CACHE_PREFIX + f.key] ?? []).some((e) =>
    e.url.startsWith(MIRROR_BASE + f.name) && e.bytes === f.bytes && e.sha256 === f.sha256));
  check("model: both files in Cache Storage with the pinned size and sha256", cacheOk,
    JSON.stringify(Object.fromEntries(Object.entries(cached).map(([k, v]) => [k, v.map((e) => `${e.bytes} B ${e.sha256.slice(0, 12)}`)]))));
  report.model = { requests: net, cached };
  const s0 = await now(page);
  const strip1 = await sampleStrip(page, 20000);
  const s1 = await now(page);
  const on1 = summary(await frames(page, s0 + 3000, s1));
  const sw1 = await setGate(page, false);
  const s2 = await now(page);
  const stripOff = await sampleStrip(page, 12000);
  const s3 = await now(page);
  const off = summary(await frames(page, s2 + 500, s3));
  const sw2 = await setGate(page, true);
  const s4 = await now(page);
  await sleep(8000);
  const s5 = await now(page);
  const on2 = summary(await frames(page, s4 + 500, s5));
  check("noise: the chain paints a false line here (the case is real)", on1.painted / on1.n > 0.05 || off.painted / off.n > 0.05,
    `painted ${pct(on1.painted / on1.n)} / ${pct(off.painted / off.n)} of frames`);
  check("noise, gate on: the pitch line is hidden (shown <= 20 % of painted)", on1.painted > 0 && on1.shownOfPainted <= 0.2,
    `shown ${on1.shown} of ${on1.painted} painted frames (${pct(on1.shownOfPainted)}); detector no-voice on ${on1.noVoice}/${on1.n}`);
  check("noise: Settings switch turns the gate off", sw1.before === "true" && sw1.after === "false", JSON.stringify(sw1));
  check("noise, gate off: shows exactly what the chain paints", off.n > 300 && off.mismatch === 0, `${off.mismatch} of ${off.n} frames differ; painted ${off.painted}`);
  check("noise: switch on again hides again", sw2.after === "true" && (on2.painted === 0 || on2.shownOfPainted <= 0.2),
    `shown ${on2.shown} of ${on2.painted} (${pct(on2.shownOfPainted)})`);
  // Resonance row and HNR readout (user decisions 2026-10-21).
  const posOn = strip1.filter(hasPos).length;
  check("noise, gate on from the start: the resonance row never gets a position", strip1.length > 30 && posOn === 0,
    `${posOn} of ${strip1.length} samples with a position; states ${[...new Set(strip1.map((x) => x.resState))].join(",")}`);
  const late1 = strip1.filter((x) => x.t >= s0 + 3000);
  const rowOn = rowShares(late1);
  check("noise, gate on: the resonance row stays idle (\"—\" on >= 80 %, \"keep talking…\" on <= 10 % of the samples after 3 s)",
    late1.length > 20 && rowOn.idle >= 0.8 && rowOn.warming <= 0.1, shareText(rowOn));
  const hnrOn = late1.filter(hnrNumber).length;
  const hnrOff = stripOff.filter((x) => x.t >= s2 + 500).filter(hnrNumber).length;
  check("noise, gate on: the HNR readout shows \"—\" (a number on <= 20 % of the samples after 3 s)", late1.length > 20 && hnrOn <= 0.2 * late1.length,
    `a number on ${hnrOn} of ${late1.length} samples; gate off: ${hnrOff} of ${stripOff.length}`);
  check("noise, gate off: the HNR readout shows numbers again (the case is real)", hnrOff > 0.3 * stripOff.length, `${hnrOff} of ${stripOff.length}`);
  const posOff = stripOff.filter(hasPos).length;
  console.log(`INFO  noise, gate off for 12 s after 12 s on: resonance position on ${posOff} of ${stripOff.length} samples`);
  const t = await vadTimes(page);
  cpu.vad.push(...t.vad); cpu.pitch.push(...t.pitch);
  report.runs.noise = { on1, off, on2, switch: [sw1, sw2], errors, row: rowOn,
    strip: { posOn, n: strip1.length, hnrOn, nLate: late1.length, hnrOff, posOff, nOff: stripOff.length } };

  // Reload (same profile): the model comes from Cache Storage.
  console.log("\n== reload, same profile: the model from Cache Storage");
  await clickButton(page, ["Stop Listening"]);
  const before = net.length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Start Listening")), { timeout: 30000 });
  await clickButton(page, ["Start Listening"]);
  await page.waitForFunction(() => document.body.innerText.includes("Stop Listening"), { timeout: 30000 });
  const readyAgain = await waitReady(page);
  const again = net.slice(before);
  const onnxAgain = again.filter((e) => e.url.includes(FIRERED_MODEL.files.find((f) => f.key === "onnx").name));
  check("reload: detector ready again, no request for the ONNX file (served from Cache Storage)", readyAgain && onnxAgain.length === 0,
    `ready ${readyAgain}; model requests after reload: ${again.map((e) => e.url).join(" | ") || "none"}`);
  report.runs.reload = { ready: readyAgain, requests: again };
  check("noise: no page or console errors (incl. the reload)", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
}

// ------------------------------------------------- noise, gate off (information)
{
  console.log("\n== noise-only, gate off from the start (is the resonance case real on this clip?)");
  const { page, errors } = await launch(WAV.noise);
  await startListening(page, { start: false });
  await setGate(page, false);
  await clickButton(page, ["Start Listening"]);
  await page.waitForFunction(() => document.body.innerText.includes("Stop Listening"), { timeout: 30000 });
  const st = await sampleStrip(page, 20000);
  const pos = st.filter(hasPos).length;
  check("noise, gate off from the start: the ungated resonance row gets a position on this clip (the case is real)", pos > 0,
    `position on ${pos} of ${st.length} samples, first at ${st.findIndex(hasPos) >= 0 ? (st.findIndex(hasPos) * 0.25).toFixed(1) + " s" : "—"}; HNR a number on ${st.filter(hnrNumber).length}`);
  const rowOff = rowShares(st.slice(12)); // after 3 s, as the gate-on run
  const rowOn = report.runs.noise?.row;
  check("noise, gate off: the resonance row leaves idle on more samples than with the gate on (the case is real)",
    rowOn && rowOff.notIdle > rowOn.notIdle + 0.1, `gate off ${shareText(rowOff)}; gate on ${rowOn ? shareText(rowOn) : "—"}`);
  check("noise-off: no page or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  report.runs.noiseOff = { pos, n: st.length, hnr: st.filter(hnrNumber).length, row: rowOff, errors };
  await page.close();
}

// ---------------------------------------------------------------- speech
{
  console.log("\n== speech, gate on");
  const { page, errors } = await launch(WAV.speech);
  await startListening(page);
  check("speech: detector ready", await waitReady(page));
  await noteCatchup(page, "speech");
  const s0 = await now(page);
  const st = await sampleStrip(page, 16000);
  const s1 = await now(page);
  const sm = summary(await frames(page, s0 + 3000, s1));
  check("speech, gate on: speech kept (shown >= 97 % of painted)", sm.painted > 100 && sm.shownOfPainted >= 0.97,
    `shown ${sm.shown} of ${sm.painted} painted (${pct(sm.shownOfPainted)}); hidden ${sm.hiddenPainted}`);
  const t = await vadTimes(page);
  cpu.vad.push(...t.vad); cpu.pitch.push(...t.pitch);
  check("speech: no page or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  report.runs.speech = { sm, row: rowShares(st), errors };
  await page.close();
}

// ---------------------------------------------------------------- speech, gate off
{
  console.log("\n== speech, gate off (the resonance row's reference)");
  const { page, errors } = await launch(WAV.speech);
  await startListening(page, { start: false });
  await setGate(page, false);
  await clickButton(page, ["Start Listening"]);
  await page.waitForFunction(() => document.body.innerText.includes("Stop Listening"), { timeout: 30000 });
  await sleep(1500); // the gate-on run waited this long for the model
  const st = await sampleStrip(page, 16000);
  const on = report.runs.speech.row, off = rowShares(st);
  check("speech: the gate does not take the resonance row to idle (gate on: idle <= gate off + 10 points, dot >= gate off - 10 points)",
    st.length > 40 && on.idle <= off.idle + 0.1 && on.dot >= off.dot - 0.1,
    `gate on ${shareText(on)}, idle ${pct(on.idle)}; gate off ${shareText(off)}, idle ${pct(off.idle)}`);
  check("speech-off: no page or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  report.runs.speechOff = { row: off, errors };
  await page.close();
}

// ---------------------------------------------------------------- held notes
{
  console.log("\n== held notes (VocalSet long tones), gate on — information");
  const { page, errors } = await launch(WAV.held);
  await startListening(page);
  check("held: detector ready", await waitReady(page));
  await noteCatchup(page, "held");
  const s0 = await now(page);
  await sleep(20000);
  const s1 = await now(page);
  const hm = summary(await frames(page, s0 + 1000, s1));
  console.log(`INFO  held notes: the gate hides ${hm.hiddenPainted} of ${hm.painted} painted frames (${pct(hm.painted ? hm.hiddenPainted / hm.painted : null)})`);
  const t = await vadTimes(page);
  cpu.vad.push(...t.vad); cpu.pitch.push(...t.pitch);
  check("held: no page or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  report.runs.held = { hm, errors };
  await page.close();
}

// ---------------------------------------------------------------- model unavailable
{
  console.log("\n== the mirror unreachable");
  {
    const { page, errors, net } = await launch(WAV.noise, { extraArgs: [`--host-resolver-rules=${HF_BLOCK}`] });
    await startListening(page, { start: false });
    await openSettings(page);
    await page.waitForFunction(() => /could not load|starts when/.test(document.querySelector("[data-voice-gate-status-text]")?.textContent ?? ""), { timeout: 15000 }).catch(() => {});
    const before = await gateStatus(page);
    const plain = (t) => /could not load/.test(t ?? "") && /pitch is shown as before/.test(t ?? "") && !/node |scripts\/|npm /.test(t ?? "");
    check("unavailable: before listening Settings says the detector starts when listening starts (the mirror is not probed)",
      /starts when you start listening/.test(before.text ?? "") && !/node |scripts\/|npm /.test(before.text ?? ""), before.text);
    await closeSettings(page);
    await clickButton(page, ["Start Listening"]);
    await page.waitForFunction(() => document.body.innerText.includes("Stop Listening"), { timeout: 30000 });
    check("unavailable: detector reports unavailable", await waitReady(page, "unavailable"), JSON.stringify((await gateStatus(page)).diag));
    const s0 = await now(page);
    await sleep(8000);
    const s1 = await now(page);
    const mm = summary(await frames(page, s0, s1));
    check("unavailable: nothing hidden (gate stays off)", mm.n > 200 && mm.mismatch === 0 && mm.decided === 0, `${mm.mismatch} differ, ${mm.decided} decided of ${mm.n}`);
    await openSettings(page);
    const during = await gateStatus(page);
    check("unavailable: Settings says so in plain words while listening", plain(during.text), during.text);
    await closeSettings(page);
    check("unavailable: the model was asked for at the mirror and failed", net.some((e) => e.url.startsWith(MIRROR_BASE) && e.failed),
      net.map((e) => `${e.url.replace(MIRROR_BASE, "<mirror>/")} ${e.status ?? e.failed ?? "?"}`).join(" | "));
    // Only the failed model requests may log console errors (net::ERR_NAME_NOT_RESOLVED).
    const other = errors.filter((e) => !/ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(e));
    check("unavailable: no page or console errors besides the blocked model requests", other.length === 0, other.slice(0, 3).join(" | "));
    report.runs.unavailable = { mm, before: before.text, during: during.text, errors, requests: net };
    await page.close();
  }
}

// ---------------------------------------------------------------- CPU
const vmed = quant(cpu.vad, 0.5), vp95 = quant(cpu.vad, 0.95), pmed = quant(cpu.pitch, 0.5);
console.log(`\nCPU (desktop Chrome, pitch worker): detector ${vmed?.toFixed(3)} ms median / ${vp95?.toFixed(3)} ms p95 per 25 ms hop over ${cpu.vad.length} hops; pitch detector itself ${pmed?.toFixed(3)} ms median`);
check("CPU measured", cpu.vad.length > 500);
const cmax = cpu.catchup.length ? Math.max(...cpu.catchup) : null;
console.log(`catch-up after the model loads: ${cpu.catchup.length} hops, max ${cmax?.toFixed(2)} ms`);
check("catch-up after the model loads: every hop's detector time < 25 ms (no stalled pitch post)", cpu.catchup.length > 0 && cmax < 25, `max ${cmax?.toFixed(2)} ms over ${cpu.catchup.length} hops`);
report.cpu = { hops: cpu.vad.length, vadMsMedian: vmed, vadMsP95: vp95, vadMsP99: quant(cpu.vad, 0.99), pitchInferMsMedian: pmed,
  catchupHops: cpu.catchup.length, catchupMsMax: cmax, ua: null };
report.results = results;
mkdirSync(path.dirname(JSON_OUT), { recursive: true });
writeFileSync(JSON_OUT, JSON.stringify(report, null, 1));
const failedN = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failedN} passed, ${failedN} failed  (${path.relative(repo, JSON_OUT)})`);
cleanup();
process.exit(failedN ? 1 : 0);
