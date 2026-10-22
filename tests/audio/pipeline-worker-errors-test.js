// pipeline-worker-errors-test.js — drives the REAL useAudioPipeline
// start / stop / setHeardAsEnabled with fake browser APIs (MSTP capture,
// Worker) and fires the "error" event a Worker gets when its script fails to
// load (e.g. a hashed worker file that 404s after a deploy while the tab was
// open). 2026-10-19 pre-PR review S-1: no worker had an error handler, so the
// heard-as panel stayed "Loading voice model… 0 %" and the cue strip's
// resonance row "starting…" forever.
//
// Checks: a gender / resonance worker error shows as "error" (the session
// goes on); a DSP / pitch worker that fails before posting anything ends the
// session with an error and terminates every worker; a later uncaught error
// in a running pitch worker does not; errors from a replaced gender worker or
// a stopped session are ignored.
//
// Loads the hook in Node with the session oracle's module hooks ("react" ->
// react-mock.mjs, extensionless imports) plus a load hook that gives the hook
// an import.meta.env.BASE_URL.
//
// Usage: node tests/audio/pipeline-worker-errors-test.js

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

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`); }
}

// ---- fake browser APIs ----
const workers = [];
class FakeWorker {
  constructor(url) { this.url = String(url); this.terminated = false; this.onmessage = null; this.onerror = null; this.listeners = {}; workers.push(this); }
  postMessage() {}
  terminate() { this.terminated = true; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((g) => g !== f); }
  // What the browser fires when the module script fails to load.
  fireError(message = "Failed to fetch dynamically imported module") {
    const ev = { type: "error", message, preventDefault() {} };
    this.onerror?.(ev);
    for (const f of this.listeners.error || []) f(ev);
  }
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
  const mod = await import(`${HOOK}?g=${++gen}`);
  const api = mod.useAudioPipeline();
  for (const e of M.effects) { try { e(); } catch { /* effects that need a DOM */ } }
  return api;
}
const find = (name) => workers.filter((w) => w.url.includes(`${name}-worker`)).at(-1);
const liveCount = () => workers.filter((w) => !w.terminated).length;

console.log("gender worker fails to load (panel switched on mid-session)");
{
  const api = await fresh();
  await api.start();
  check("session running", M.state.status === "running", M.state.status);
  api.setHeardAsEnabled(true);
  const ml = find("gender");
  check("gender worker started", !!ml);
  ml.fireError();
  check("modelStatus -> error (panel shows unavailable, not Loading… forever)", M.state.modelStatus === "error", M.state.modelStatus);
  check("modelError carries the reason", typeof M.state.modelError === "string" && M.state.modelError.length > 0, String(M.state.modelError));
  check("session keeps running", M.state.status === "running", M.state.status);
  // Off and on again: a fresh worker; the failed one's late error is ignored.
  api.setHeardAsEnabled(false);
  check("switch off clears the error", M.state.modelStatus === "idle", M.state.modelStatus);
  api.setHeardAsEnabled(true);
  const ml2 = find("gender");
  check("switch on starts a new gender worker", ml2 && ml2 !== ml && !ml2.terminated);
  ml.fireError();
  check("error from the replaced worker is ignored", M.state.modelStatus === "idle", M.state.modelStatus);
  ml2.send({ type: "status", status: "ready" });
  check("new worker reaches ready", M.state.modelStatus === "ready", M.state.modelStatus);
  ml2.fireError();
  check("an uncaught error in a running gender worker is only recorded (panel stays ready)", M.state.modelStatus === "ready", M.state.modelStatus);
  api.stop();
  ml2.fireError();
  check("error after stop() is ignored", M.state.modelStatus === "idle" && M.state.status === "idle", `${M.state.modelStatus} / ${M.state.status}`);
  api.setHeardAsEnabled(false);
}

console.log("resonance worker error statuses");
{
  const api = await fresh();
  await api.start();
  const res = find("resonance");
  res.send({ type: "status", status: "ready" });
  res.send({ type: "status", status: "error", message: "x", recovering: true });
  check("a recoverable runtime error -> restarting (not 'on this device')", M.state.resonanceStatus === "restarting", M.state.resonanceStatus);
  res.send({ type: "status", status: "ready" });
  check("ready again after it recovers", M.state.resonanceStatus === "ready", M.state.resonanceStatus);
  res.send({ type: "status", status: "error", message: "x", reason: "load" });
  check("an asset-load failure -> reload", M.state.resonanceStatus === "reload", M.state.resonanceStatus);
  res.send({ type: "status", status: "error", message: "x" });
  check("given up after repeated errors -> error", M.state.resonanceStatus === "error", M.state.resonanceStatus);
  api.stop();
}

console.log("resonance worker fails to load");
{
  const api = await fresh();
  await api.start();
  const res = find("resonance");
  res.fireError();
  check("resonanceStatus -> reload (row says unavailable — reload the page, not starting…)", M.state.resonanceStatus === "reload", M.state.resonanceStatus);
  check("session keeps running", M.state.status === "running", M.state.status);
  api.stop();
  res.fireError();
  check("error after stop() is ignored", M.state.resonanceStatus === "idle", M.state.resonanceStatus);
}

for (const name of ["dsp", "pitch"]) {
  console.log(`${name} worker fails to load`);
  const api = await fresh();
  await api.start();
  find(name).fireError();
  check("session ends with an error", M.state.status === "error", M.state.status);
  check("error text names the worker", typeof M.state.error === "string" && M.state.error.includes(`${name}-worker`), String(M.state.error));
  check("every worker terminated", liveCount() === 0, `${liveCount()} live`);
}

console.log("uncaught error in a running pitch worker");
{
  const api = await fresh();
  await api.start();
  const pw = find("pitch");
  pw.send({ type: "status", status: "ready", detector: "boersma-ac", device: "js" });
  pw.fireError("TypeError: x is undefined");
  check("session keeps running (the worker survives an uncaught exception)", M.state.status === "running", M.state.status);
  api.stop();
}

console.log("every worker has an error handler");
{
  const api = await fresh();
  await api.start();
  api.setHeardAsEnabled(true);
  for (const name of ["dsp", "pitch", "resonance", "gender"]) {
    const w = find(name);
    check(`${name}-worker`, !!w && (typeof w.onerror === "function" || (w.listeners.error || []).length > 0));
  }
  api.stop();
  api.setHeardAsEnabled(false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
