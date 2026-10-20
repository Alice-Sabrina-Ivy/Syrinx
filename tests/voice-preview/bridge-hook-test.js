// bridge-hook-test.js — Voice Shaper's bridge in the REAL useAudioPipeline hook
// (driven in Node as tests/audio/pipeline-worker-errors-test.js does: fake MSTP capture
// and Workers, the session oracle's module hooks, import.meta.env.BASE_URL supplied).
//   - The capture handle is registered when listening starts (sample rate, a working
//     connect / disconnect on the real capture source) and cleared on stop.
//   - With a tap installed, the tap receives every posted pitch message, the very object
//     handlePitchMessage handled, in order.
//   - Everything else is bit-identical with and without the tap: the painted trace,
//     every throttled state update (readout, note, steadiness, …), the frame callback
//     and every message the hook relays to the DSP / resonance workers.
// measurements/voice-preview-phase1-2026-10-19.md §2, §3, §14 item 9.
//
//   node tests/voice-preview/bridge-hook-test.js
import { register } from "node:module";
import { readFileSync } from "node:fs";

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
const bridge = await import(new URL("../../src/voice-preview/bridge.js", import.meta.url).href);
const { makeChecker, PARITY_JSON } = await import(new URL("./vp-test-lib.js", import.meta.url).href);

const T = makeChecker();

// deterministic clock: the hook throttles state updates on performance.now()
let fakeNow = 0;
Object.defineProperty(globalThis, "performance", {
  value: { now: () => (fakeNow += 37), timeOrigin: 0, mark() {}, measure() {} }, configurable: true, writable: true,
});

// ---- fake browser APIs (as tests/audio/pipeline-worker-errors-test.js) ----
const workers = [];
class FakeWorker {
  constructor(url) { this.url = String(url); this.terminated = false; this.onmessage = null; this.onerror = null; this.sent = []; workers.push(this); }
  postMessage(m) { this.sent.push(m && typeof m === "object" ? JSON.stringify(m, (k, v) => (v && typeof v === "object" && v.constructor?.name === "MessagePort" ? "<port>" : v)) : m); }
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

let gen = 0;
async function fresh() {
  M.refs = []; M.effects = []; M.state = null; workers.length = 0;
  fakeNow = 0;
  const mod = await import(`${HOOK}?g=${++gen}`);
  const api = mod.useAudioPipeline();
  for (const e of M.effects) { try { e(); } catch { /* effects that need a DOM */ } }
  return api;
}
const find = (name) => workers.filter((w) => w.url.includes(`${name}-worker`)).at(-1);

console.log("capture handle");
{
  const seen = [];
  const unsub = bridge.onVoicePreviewCapture((h) => seen.push(h));
  const api = await fresh();
  T.check("no handle before listening", bridge.getVoicePreviewCapture() === null);
  await api.start();
  const h = bridge.getVoicePreviewCapture();
  T.check("listening: handle registered with the capture rate and start time", M.state.status === "running" && h && h.sampleRate === 48000 && typeof h.startedAt === "number" && seen.length === 1 && seen[0] === h);
  const port = h.connect();
  T.check("connect() hands out a capture consumer port", port && typeof port.postMessage === "function");
  let removed = false;
  try { removed = h.disconnect(port) === true; } catch { removed = false; }
  T.check("disconnect(port) takes it off the capture's broadcast list", removed);
  try { port.close(); } catch { /* ignore */ }
  api.stop();
  T.check("stop: handle cleared (listeners told)", bridge.getVoicePreviewCapture() === null && seen.length === 2 && seen[1] === null);
  unsub();
}

// ---- the same session with and without a tap ----
const fx = JSON.parse(readFileSync(PARITY_JSON, "utf8"));
const trackHz = fx.inputs.find((i) => i.name === "ls_woman_high@16000").track;
async function session(withTap) {
  const api = await fresh();
  await api.start();
  const frames = [];
  api.frameCallbackRef.current = (f) => frames.push(JSON.stringify(f));
  const tapped = [];
  if (withTap) bridge.setVoicePreviewPitchTap((m) => tapped.push(m));
  const pw = find("pitch"), dw = find("dsp");
  const sentMsgs = [];
  const states = [];
  const traces = [];
  const C = 0.025;
  for (let k = 0; k < trackHz.length; k++) {
    const f = trackHz[k];
    // posted message for chunk k (some carry notch lines), then the DSP frame
    const msg = { type: "pitch", pitch: f > 0 ? f : null, confidence: f > 0 ? 0.8 : 0.2, voiced: f > 0, ts: 1000 + k * 25, contextTime: (k + 1) * C,
      ...(k % 17 === 5 ? { notchedFreqs: [120] } : {}) };
    sentMsgs.push(msg);
    pw.send(msg);
    dw.send({ type: "analysis", data: { intensity: f > 0 ? -28 : -70, formants: null, spectralTilt: null, hnr: null, cpp: null, absoluteTime: 1000 + k * 25 } });
    states.push(JSON.stringify(M.state));
    traces.push(JSON.stringify(api.pitchTraceRef.current.at(-1) ?? null));
  }
  bridge.setVoicePreviewPitchTap(null);
  const relayed = workers.filter((w) => !w.url.includes("pitch-worker")).map((w) => `${w.url.split("/").at(-1)}:${w.sent.join("|")}`);
  api.stop();
  return { states, traces, frames, relayed, tapped, sentMsgs };
}
console.log("\nwith and without a tap");
const a = await session(false);
const a2 = await session(false);
const b = await session(true);
T.check("control: two runs without a tap are identical", JSON.stringify(a.states) === JSON.stringify(a2.states) && a.traces.join() === a2.traces.join()
  && a.frames.join() === a2.frames.join() && a.relayed.join() === a2.relayed.join());
T.check("the tap gets every posted message, the same objects, in order", b.tapped.length === b.sentMsgs.length && b.tapped.every((m, i) => m === b.sentMsgs[i]),
  `${b.tapped.length} of ${b.sentMsgs.length}`);
T.check("painted trace identical with the tap", a.traces.join() === b.traces.join() && a.traces.some((t) => t !== "null"));
T.check("every state update identical (readout, note, steadiness, …)", JSON.stringify(a.states) === JSON.stringify(b.states));
T.check("frame callback identical", a.frames.length > 0 && a.frames.join() === b.frames.join(), `${a.frames.length} frames`);
T.check("messages relayed to the DSP / resonance workers identical", a.relayed.join() === b.relayed.join() && a.relayed.some((r) => r.includes("pitch-hint")));
T.check("a throwing tap does not break the hook", await (async () => {
  const api = await fresh();
  await api.start();
  const origError = console.error;
  console.error = () => {};
  bridge.setVoicePreviewPitchTap(() => { throw new Error("tap failed"); });
  let ok = true;
  try { find("pitch").send({ type: "pitch", pitch: 200, confidence: 0.8, voiced: true, ts: 1, contextTime: 0.025 }); } catch { ok = false; }
  bridge.setVoicePreviewPitchTap(null);
  console.error = origError;
  api.stop();
  return ok;
})());
T.done();
