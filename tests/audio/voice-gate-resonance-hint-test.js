// voice-gate-resonance-hint-test.js — the voice gate on the resonance row,
// through the REAL useAudioPipeline hook's start() / pitch-worker relay with
// fake browser APIs (Worker, MSTP capture), as
// tests/audio/pipeline-worker-errors-test.js does.
//
// The measured variant (measurements/noise-detector-tryout-resonance-
// 2026-10-21.md; built at 73 % against an 80 % bar, user decision
// 2026-10-21): the resonance worker's pitch hint says voiced: false on a hop
// whose detector decision is "no voice" while the setting is on; pitch and
// contextTime are unchanged. No decision (detector loading / unavailable /
// off / switched off as too slow) or the setting off: the hint exactly as
// before. The DSP and ML hints never change.
//
// Also: the init message carries the model source (the app's own
// models/firered/ while FIRERED_MODEL.mirrorCommit is null), and the
// detector's "unavailable" status reaches the hook's state.
//
//   node tests/audio/voice-gate-resonance-hint-test.js

import { register } from "node:module";

register(new URL("../../scripts/session-oracle/lib/hooks.mjs", import.meta.url));
register("data:text/javascript," + encodeURIComponent(`
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function load(url, ctx, next) {
  if (/\\/useAudioPipeline\\.js(\\?|$)/.test(url)) {
    const src = readFileSync(fileURLToPath(url.split("?")[0]), "utf8").replaceAll("import.meta.env.BASE_URL", '"/Syrinx/"');
    return { format: "module", source: src, shortCircuit: true };
  }
  return next(url, ctx);
}`));
const { M } = await import(new URL("../../scripts/session-oracle/lib/react-mock.mjs", import.meta.url).href);
const HOOK = new URL("../../src/audio/useAudioPipeline.js", import.meta.url).href;
const { FIRERED_MODEL } = await import("../../src/dsp/firered-vad.js");

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

// ---- fake browser APIs ----
const workers = [];
class FakeWorker {
  constructor(url) { this.url = String(url); this.terminated = false; this.onmessage = null; this.onerror = null; this.sent = []; workers.push(this); }
  postMessage(m) { this.sent.push(m); }
  terminate() { this.terminated = true; }
  addEventListener() {}
  removeEventListener() {}
  send(data) { this.onmessage?.({ data }); }
}
globalThis.Worker = FakeWorker;
globalThis.AudioData = class {};
globalThis.MediaStreamTrackProcessor = class {
  constructor() {
    let first = true; let cancelResolve = null;
    this.readable = { getReader: () => ({
      read: () => (first
        ? (first = false, Promise.resolve({ done: false, value: { timestamp: 0, duration: 10000, sampleRate: 48000, numberOfFrames: 480, numberOfChannels: 1, format: "f32-planar", copyTo() {}, close() {} } }))
        : new Promise((r) => { cancelResolve = r; })),
      cancel: () => { cancelResolve?.({ done: true }); },
    }) };
  }
};
const track = { stop() {}, addEventListener() {}, removeEventListener() {}, getSettings: () => ({}), label: "fake" };
const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "node", mediaDevices: { getUserMedia: () => Promise.resolve(stream) } } });
globalThis.window ||= { location: { search: "" }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
// A page location, so the hook names a model source (as in the browser).
globalThis.location = { href: "https://example.test/Syrinx/", search: "" };

let gen = 0;
async function fresh() {
  M.refs = []; M.effects = []; M.state = null; workers.length = 0;
  const mod = await import(`${HOOK}?g=${++gen}`);
  const api = mod.useAudioPipeline();
  for (const e of M.effects) { try { e(); } catch { /* effects that need a DOM */ } }
  await api.start();
  return api;
}
const find = (name) => workers.filter((w) => w.url.includes(`${name}-worker`)).at(-1);
const hintsTo = (w) => w.sent.filter((m) => m && m.type === "pitch-hint");

// A sequence of pitch messages: a false line at 117 Hz (the detector says no
// voice), speech at 205 Hz (voice), unvoiced hops (no voice), and hops with
// no decision. vad: true | false | undefined (no decision).
const SEQ = [
  ...Array.from({ length: 30 }, () => ({ pitch: 117, vad: false })),
  ...Array.from({ length: 30 }, () => ({ pitch: 205, vad: true })),
  ...Array.from({ length: 10 }, () => ({ pitch: null, vad: false })),
  ...Array.from({ length: 20 }, () => ({ pitch: 117, vad: undefined })),
];
async function drive({ gateOn = true, statusFirst = null } = {}) {
  const api = await fresh();
  api.setVoiceGateEnabled(gateOn);
  api.setHeardAsEnabled(true); // the ML worker: its hint must stay raw
  const pw = find("pitch"), res = find("resonance"), ml = find("gender"), dsp = find("dsp");
  if (statusFirst) pw.send({ type: "vad-status", status: statusFirst, message: "test" });
  const n0 = { res: hintsTo(res).length, ml: hintsTo(ml).length, dsp: hintsTo(dsp).length };
  let t = 10;
  for (const h of SEQ) {
    t += 0.025;
    pw.send({
      type: "pitch", pitch: h.pitch, confidence: h.pitch ? 0.8 : 0.2, voiced: h.pitch !== null, ts: t * 1000, contextTime: t,
      ...(h.vad === undefined ? {} : { vad: { p: h.vad ? 0.9 : 0.1, voice: h.vad } }),
    });
  }
  const out = { api, pw, res: hintsTo(res).slice(n0.res), ml: hintsTo(ml).slice(n0.ml), dsp: hintsTo(dsp).slice(n0.dsp), state: M.state };
  api.stop();
  return out;
}

console.log("init: the model source");
{
  const api = await fresh();
  const init = find("pitch").sent.find((m) => m && m.type === "init");
  if (FIRERED_MODEL.mirrorCommit) {
    check("mirror pinned: init names the Hugging Face mirror", init?.vad?.source === "mirror" &&
      init.vad.modelBase === `https://huggingface.co/${FIRERED_MODEL.mirror}/resolve/${FIRERED_MODEL.mirrorCommit}/`, JSON.stringify(init?.vad));
  } else {
    check("mirrorCommit null: init names the app's own models/firered/", init?.vad?.source === "app" &&
      init.vad.modelBase === "https://example.test/Syrinx/models/firered/", JSON.stringify(init?.vad));
  }
  find("pitch").send({ type: "vad-status", status: "unavailable", message: "cmvn.ark: HTTP 404" });
  check("vad-status unavailable reaches the state (Settings reads it)", M.state.voiceGateStatus === "unavailable", M.state.voiceGateStatus);
  api.stop();
}

console.log("\nsetting on: the resonance hint");
{
  const r = await drive();
  check("one resonance hint per pitch message", r.res.length === SEQ.length, `${r.res.length} of ${SEQ.length}`);
  const noVoice = SEQ.map((h) => h.vad === false);
  check("detector says no voice -> voiced: false", r.res.every((h, i) => !noVoice[i] || h.voiced === false),
    r.res.map((h, i) => (!noVoice[i] || h.voiced === false ? "" : i)).filter(String).slice(0, 6).join(","));
  check("the false line was voiced (the case is real)", SEQ.filter((h, i) => noVoice[i] && h.pitch !== null).length === 30);
  check("pitch and contextTime unchanged on every hint", r.res.every((h, i) => h.pitch === SEQ[i].pitch && Math.abs(h.contextTime - (10 + 0.025 * (i + 1))) < 1e-9));
  check("detector says voice -> the hint as before (voiced)", r.res.every((h, i) => SEQ[i].vad !== true || h.voiced === true));
  check("no decision -> the hint as before (voiced)", r.res.every((h, i) => SEQ[i].vad !== undefined || h.voiced === (SEQ[i].pitch !== null)));
  check("ML hints raw (the \"Likely heard as\" panel is not gated)", r.ml.length === SEQ.length && r.ml.every((h, i) => h.voiced === (SEQ[i].pitch !== null) && h.pitch === SEQ[i].pitch));
  check("DSP hints raw", r.dsp.length === SEQ.length && r.dsp.every((h, i) => h.pitch === SEQ[i].pitch));
}

console.log("\nsetting off: today's behaviour");
{
  const r = await drive({ gateOn: false });
  check("every resonance hint as before", r.res.length === SEQ.length && r.res.every((h, i) => h.voiced === (SEQ[i].pitch !== null) && h.pitch === SEQ[i].pitch));
}

console.log("\ndetector unavailable / slow (no decisions on the messages): today's behaviour");
for (const st of ["unavailable", "slow"]) {
  const api = await fresh();
  api.setVoiceGateEnabled(true);
  const pw = find("pitch"), res = find("resonance");
  pw.send({ type: "vad-status", status: st, message: "test" });
  const n0 = hintsTo(res).length;
  let t = 10;
  for (const h of SEQ) { t += 0.025; pw.send({ type: "pitch", pitch: h.pitch, confidence: 0.8, voiced: h.pitch !== null, ts: t * 1000, contextTime: t }); }
  const hs = hintsTo(res).slice(n0);
  check(`${st}: every resonance hint as before`, hs.length === SEQ.length && hs.every((h, i) => h.voiced === (SEQ[i].pitch !== null)));
  api.stop();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
