// voice-gate-smoke.mjs — headless browser check of the TRY-OUT voice gate
// ("Hide pitch when no voice is heard", branch noise-detector-tryout,
// 2026-10-20; measurements/noise-detector-tryout-2026-10-20.md) against the
// BUILT app (dist/, served by `vite preview`), with Chrome's fake microphone
// playing public clips.
//
//   npm run build && node scripts/voice-gate-smoke.mjs [--noise=<16 kHz noise-only wav>] [--json=<out>]
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
//   noise   gate on 12 s -> switched off in Settings 12 s -> on again 8 s:
//           on hides the pitch line (shown <= 20 % of what the chain painted,
//           after the first 3 s, whose cold start the 2 s hangover keeps
//           open); off shows exactly what the chain paints; the switch flips.
//   speech  gate on 16 s: speech is kept (shown >= 97 % of painted frames).
//   held    gate on 20 s: information (share of the held notes' painted
//           frames the gate hides; the screen's known cost).
//   missing the model files hidden from the server: Settings says the model
//           is not installed, the detector reports "missing", nothing is
//           hidden.
// Every run: no page errors or console errors. CPU: the pitch worker's own
// time per 25 ms hop for the detector (front end + model call), median / p95,
// from the diag ring, over the hops with a decision after the first one. The
// hops right after the model loads score the frames that waited for it (at
// most 50 per hop) and carry no decision: their time is reported separately
// and each must stay under one hop's 25 ms (no stalled pitch post).

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
const DIST_MODEL = path.join(repo, "dist", "models", "firered");
const DIST_MODEL_AWAY = path.join(repo, "dist", "models", "firered-away");
if (!CHROME) { console.error("need Chrome"); process.exit(2); }
if (!existsSync(path.join(repo, "dist", "index.html"))) { console.error("run npm run build first"); process.exit(2); }
if (!existsSync(DIST_MODEL) && existsSync(DIST_MODEL_AWAY)) renameSync(DIST_MODEL_AWAY, DIST_MODEL); // an aborted run
if (!existsSync(path.join(DIST_MODEL, "fireredvad_stream_vad_with_cache.onnx"))) {
  console.error("dist/ has no model: node scripts/fetch-firered-model.mjs, then npm run build"); process.exit(2);
}
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
  if (!existsSync(DIST_MODEL) && existsSync(DIST_MODEL_AWAY)) { try { renameSync(DIST_MODEL_AWAY, DIST_MODEL); } catch { /* */ } }
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

async function launch(wav) {
  if (browser) { await browser.close().catch(() => {}); closeBrowserHard(); }
  const profile = mkdtempSync(path.join(tmpdir(), "voice-gate-smoke-"));
  profiles.push(profile);
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: profile,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.goto(`http://localhost:${PORT}/Syrinx/?diag=1`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.bringToFront();
  return { page, errors };
}

const clickButton = (page, texts, scope = "") => page.evaluate((ts, scope) => {
  const root = scope ? document.querySelector(scope) : document;
  const b = [...(root?.querySelectorAll("button") ?? [])].find((x) => ts.some((t) => x.textContent.trim().includes(t)));
  if (b) b.click();
  return !!b;
}, texts, scope);
// First visit: the welcome, then the direction question; Continue answers and
// starts listening, Escape only answers (start: false).
async function startListening(page, { start = true } = {}) {
  await page.waitForFunction(() => document.body.innerText.includes("Welcome to Syrinx"), { timeout: 60000 });
  await clickButton(page, ["Get Started"]);
  await page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
  await page.evaluate(() => document.querySelector('[role=dialog] input[data-direction="exploring"]')?.closest("label")?.click());
  if (!start) {
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await page.waitForFunction(() => !document.body.innerText.includes("What are you trying to sound like?"), { timeout: 10000 });
    return;
  }
  await clickButton(page, ["Continue"], "[role=dialog]");
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
  console.log("\n== noise-only, gate on / off / on");
  const { page, errors } = await launch(WAV.noise);
  await startListening(page);
  check("noise: detector ready", await waitReady(page), JSON.stringify((await gateStatus(page)).diag));
  await noteCatchup(page, "noise");
  const s0 = await now(page);
  await sleep(12000);
  const s1 = await now(page);
  const on1 = summary(await frames(page, s0 + 3000, s1));
  const sw1 = await setGate(page, false);
  const s2 = await now(page);
  await sleep(12000);
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
  const t = await vadTimes(page);
  cpu.vad.push(...t.vad); cpu.pitch.push(...t.pitch);
  check("noise: no page or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  report.runs.noise = { on1, off, on2, switch: [sw1, sw2], errors };
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
  await sleep(16000);
  const s1 = await now(page);
  const sm = summary(await frames(page, s0 + 3000, s1));
  check("speech, gate on: speech kept (shown >= 97 % of painted)", sm.painted > 100 && sm.shownOfPainted >= 0.97,
    `shown ${sm.shown} of ${sm.painted} painted (${pct(sm.shownOfPainted)}); hidden ${sm.hiddenPainted}`);
  const t = await vadTimes(page);
  cpu.vad.push(...t.vad); cpu.pitch.push(...t.pitch);
  check("speech: no page or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  report.runs.speech = { sm, errors };
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

// ---------------------------------------------------------------- model missing
{
  console.log("\n== model files missing");
  renameSync(DIST_MODEL, DIST_MODEL_AWAY);
  try {
    const { page, errors } = await launch(WAV.noise);
    await startListening(page, { start: false });
    await openSettings(page);
    await page.waitForFunction(() => /not installed|found/.test(document.querySelector("[data-voice-gate-status-text]")?.textContent ?? ""), { timeout: 15000 }).catch(() => {});
    const before = await gateStatus(page);
    check("missing: Settings says so before listening", /not installed/.test(before.text ?? ""), before.text);
    await closeSettings(page);
    await clickButton(page, ["Start Listening"]);
    await page.waitForFunction(() => document.body.innerText.includes("Stop Listening"), { timeout: 30000 });
    check("missing: detector reports missing", await waitReady(page, "missing"), JSON.stringify((await gateStatus(page)).diag));
    const s0 = await now(page);
    await sleep(8000);
    const s1 = await now(page);
    const mm = summary(await frames(page, s0, s1));
    check("missing: nothing hidden (gate stays off)", mm.n > 200 && mm.mismatch === 0 && mm.decided === 0, `${mm.mismatch} differ, ${mm.decided} decided of ${mm.n}`);
    await openSettings(page);
    const during = await gateStatus(page);
    check("missing: Settings says the model is not installed while listening", /not installed/.test(during.text ?? ""), during.text);
    await closeSettings(page);
    check("missing: no page or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    report.runs.missing = { mm, before: before.text, during: during.text, errors };
    await page.close();
  } finally {
    renameSync(DIST_MODEL_AWAY, DIST_MODEL);
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
