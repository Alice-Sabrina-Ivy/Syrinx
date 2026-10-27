// frame-tap-hook-test.js — the guided exercises' frame tap (src/exercises/bridge.js) in the
// REAL useAudioPipeline hook (driven in Node as tests/voice-preview/bridge-hook-test.js
// does: fake MSTP capture and Workers, the session oracle's module hooks).
//   - With a tap installed, the tap receives every frame the session recording's frame
//     callback receives — the same object, in order — and frames also without a frame
//     callback (no session recording).
//   - Everything else is bit-identical with and without the tap: the painted trace, every
//     throttled state update, the frame callback and every message relayed to the workers.
//   - A throwing tap does not break the hook.
// docs/guided-exercises-design.md §8.
//
//   node tests/exercises/frame-tap-hook-test.js
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
const tapMod = await import(new URL("../../src/exercises/bridge.js", import.meta.url).href);
const { makeChecker, PARITY_JSON } = await import(new URL("../voice-preview/vp-test-lib.js", import.meta.url).href);

const T = makeChecker();

let fakeNow = 0;
Object.defineProperty(globalThis, "performance", {
  value: { now: () => (fakeNow += 37), timeOrigin: 0, mark() {}, measure() {} }, configurable: true, writable: true,
});

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

const fx = JSON.parse(readFileSync(PARITY_JSON, "utf8"));
const trackHz = fx.inputs.find((i) => i.name === "ls_woman_high@16000").track;

async function session({ withTap, withCallback = true }) {
  const api = await fresh();
  await api.start();
  const frames = [];
  const frameObjs = [];
  if (withCallback) api.frameCallbackRef.current = (f) => { frames.push(JSON.stringify(f)); frameObjs.push(f); };
  const tapped = [];
  if (withTap) tapMod.setExerciseFrameTap((f) => tapped.push(f));
  const pw = find("pitch"), dw = find("dsp");
  const states = [];
  const traces = [];
  const C = 0.025;
  for (let k = 0; k < trackHz.length; k++) {
    const f = trackHz[k];
    pw.send({ type: "pitch", pitch: f > 0 ? f : null, confidence: f > 0 ? 0.8 : 0.2, voiced: f > 0, ts: 1000 + k * 25, contextTime: (k + 1) * C });
    // a stretch of silence in the middle (the silence-gate branch of the hook)
    const silent = k >= 60 && k < 90;
    dw.send({ type: "analysis", data: { intensity: f > 0 && !silent ? -28 : -70, formants: null, spectralTilt: null, hnr: null, cpp: null, absoluteTime: 1000 + k * 25 } });
    states.push(JSON.stringify(M.state));
    traces.push(JSON.stringify(api.pitchTraceRef.current.at(-1) ?? null));
  }
  tapMod.setExerciseFrameTap(null);
  const relayed = workers.filter((w) => !w.url.includes("pitch-worker")).map((w) => `${w.url.split("/").at(-1)}:${w.sent.join("|")}`);
  api.stop();
  return { states, traces, frames, frameObjs, relayed, tapped };
}

console.log("with and without the exercise tap");
const a = await session({ withTap: false });
const b = await session({ withTap: true });
const c = await session({ withTap: true, withCallback: false });
T.check("the tap gets every frame the frame callback gets — the same objects, in order",
  b.tapped.length === b.frameObjs.length && b.tapped.length > 0 && b.tapped.every((f, i) => f === b.frameObjs[i]),
  `${b.tapped.length} of ${b.frameObjs.length}`);
T.check("…voiced frames and silence-gated frames both", b.tapped.some((f) => f.voiced) && b.tapped.some((f) => !f.voiced && f.f0 === null));
T.check("without a frame callback (no session recording) the tap still gets every frame",
  c.tapped.length === b.tapped.length && c.tapped.every((f, i) => JSON.stringify(f) === JSON.stringify(b.tapped[i])));
T.check("painted trace identical with the tap", a.traces.join() === b.traces.join() && a.traces.some((t) => t !== "null"));
T.check("every state update identical", JSON.stringify(a.states) === JSON.stringify(b.states));
T.check("frame callback identical", a.frames.length > 0 && a.frames.join() === b.frames.join(), `${a.frames.length} frames`);
T.check("messages relayed to the workers identical", a.relayed.join() === b.relayed.join() && a.relayed.some((r) => r.includes("pitch-hint")));
T.check("no tap installed: nothing to call", tapMod.hasExerciseFrameTap() === false);
T.check("a throwing tap does not break the hook", await (async () => {
  const api = await fresh();
  await api.start();
  const origError = console.error;
  console.error = () => {};
  tapMod.setExerciseFrameTap(() => { throw new Error("tap failed"); });
  let ok = true;
  try {
    find("pitch").send({ type: "pitch", pitch: 200, confidence: 0.8, voiced: true, ts: 1, contextTime: 0.025 });
    find("dsp").send({ type: "analysis", data: { intensity: -28, formants: null, spectralTilt: null, hnr: null, cpp: null, absoluteTime: 1 } });
  } catch { ok = false; }
  tapMod.setExerciseFrameTap(null);
  console.error = origError;
  api.stop();
  return ok;
})());
T.done();
