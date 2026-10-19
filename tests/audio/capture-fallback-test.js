// capture-fallback-test.js — MSTP runtime fallback to AudioContext.
//
// pickKind() only feature-detects MediaStreamTrackProcessor. A browser can
// expose it and still fail at runtime; before 2026-10-19 that ended the start
// with an error. createCaptureSource now retries the SAME MediaStream on the
// AudioContext path (no second getUserMedia / permission prompt) and records
// the fallback.
//
// Part 1 drives src/audio/captureSource.js with fake MSTP / AudioContext /
// AudioWorkletNode objects: the MSTP constructor throws, getReader() throws,
// the reader errors, AudioData.copyTo rejects the first frame, no first frame
// arrives, the stream closes before the first frame while the track is still
// live — each must resolve as "audiocontext" on the same stream with
// `fallbackFrom` set, the track not stopped, and onError never called. A
// working MSTP stays "mstp"; ?capture=mstp (forceKind) still fails without
// fallback; a track that ended does not fall back. A failed AudioContext
// setup (addModule rejects, createMediaStreamSource throws) closes the context
// it created.
//
// Part 2 drives the REAL useAudioPipeline hook (session-oracle module hooks,
// as pipeline-worker-errors-test.js): an MSTP constructor that throws still
// reaches "running" with one getUserMedia call; a real permission refusal
// (NotAllowedError) still says "denied"; any other start failure does not.
//
// Usage: node tests/audio/capture-fallback-test.js

import { register } from "node:module";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`); }
}

// ---- fake browser APIs ----
function makeTrack() {
  return {
    readyState: "live", stopped: false, listeners: {},
    stop() { this.stopped = true; this.readyState = "ended"; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((g) => g !== f); },
    getSettings: () => ({}), label: "fake",
  };
}
function makeStream(track = makeTrack()) {
  return { track, getAudioTracks: () => [track], getTracks: () => [track] };
}
function goodFrame(over = {}) {
  return { timestamp: 0, duration: 10000, sampleRate: 48000, numberOfFrames: 480, numberOfChannels: 1, format: "f32-planar", copyTo() {}, close() {}, ...over };
}

// MSTP behaviour for the next construction.
//   "ok" | "ctor-throws" | "getreader-throws" | "read-rejects" | "no-frame"
//   | "copyto-throws" | "ends" | "closes-live" (done:true, track still live)
let mstpMode = "ok";
let readerCancelled = 0;
globalThis.AudioData = class {};
globalThis.MediaStreamTrackProcessor = class {
  constructor({ track }) {
    if (mstpMode === "ctor-throws") throw new TypeError("Failed to construct 'MediaStreamTrackProcessor'");
    const mode = mstpMode;
    let first = true; let pendingResolve = null;
    this.readable = {
      getReader: () => {
        if (mode === "getreader-throws") throw new TypeError("ReadableStream is locked");
        return {
          read: () => {
            if (mode === "read-rejects") return Promise.reject(new Error("read failed: source error"));
            if (mode === "ends") { track.readyState = "ended"; return Promise.resolve({ done: true }); }
            if (mode === "closes-live") return Promise.resolve({ done: true });
            if (mode === "no-frame" || !first) return new Promise((r) => { pendingResolve = r; });
            first = false;
            return Promise.resolve({ done: false, value: goodFrame(mode === "copyto-throws" ? { copyTo() { throw new Error("unsupported format"); } } : {}) });
          },
          cancel: () => { readerCancelled++; pendingResolve?.({ done: true }); return Promise.resolve(); },
        };
      },
    };
  }
};

const audioContexts = [];
// AudioContext setup failure for the next construction: null | "addmodule" | "source"
let ctxFail = null;
class FakeAudioContext {
  constructor(o) {
    this.opts = o; this.sampleRate = 44100; this.state = "running"; this.closed = false;
    this.baseLatency = 0.01; this.outputLatency = 0.02; this.destination = {}; this.sources = [];
    const fail = ctxFail;
    this.audioWorklet = { addModule: () => (fail === "addmodule" ? Promise.reject(new Error("addModule failed")) : Promise.resolve()) };
    this.fail = fail;
    audioContexts.push(this);
  }
  createMediaStreamSource(stream) {
    if (this.fail === "source") throw new Error("NotSupportedError: sample-rate mismatch");
    this.sources.push(stream); return { connect() {}, disconnect() {} };
  }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
  resume() { return Promise.resolve(); }
  close() { this.closed = true; this.state = "closed"; return Promise.resolve(); }
}
globalThis.AudioContext = FakeAudioContext;
globalThis.AudioWorkletNode = class {
  constructor() { this.port = { addEventListener() {}, start() {}, postMessage() {} }; }
  connect() {} disconnect() {}
};

// ---- Part 1: captureSource ----
const CS = new URL("../../src/audio/captureSource.js", import.meta.url).href;
const { createCaptureSource } = await import(CS);

async function attempt(mode, extra = {}) {
  mstpMode = mode; readerCancelled = 0; audioContexts.length = 0;
  const stream = makeStream();
  const errors = [], fallbacks = [], acks = [];
  let src = null, thrown = null;
  try {
    src = await createCaptureSource(stream, {
      firstFrameTimeoutMs: 60,
      onError: (e) => errors.push(e),
      onFallback: (f) => fallbacks.push(f),
      onInitAck: (a) => acks.push(a),
      ...extra,
    });
  } catch (err) { thrown = err; }
  await new Promise((r) => setTimeout(r, 20)); // let any late read settle
  return { stream, src, thrown, errors, fallbacks, acks };
}

console.log("captureSource: MSTP runtime failures fall back to AudioContext");
for (const mode of ["ctor-throws", "getreader-throws", "read-rejects", "copyto-throws", "no-frame", "closes-live"]) {
  const r = await attempt(mode);
  check(`${mode}: resolves`, !r.thrown, r.thrown?.message);
  check(`${mode}: kind audiocontext`, r.src?.kind === "audiocontext", r.src?.kind);
  check(`${mode}: same stream reused`, audioContexts.length === 1 && audioContexts[0].sources[0] === r.stream);
  check(`${mode}: track not stopped`, !r.stream.track.stopped);
  check(`${mode}: fallbackFrom recorded`, r.src?.fallbackFrom?.kind === "mstp" && r.src.fallbackFrom.message.length > 0);
  check(`${mode}: audioInfoExtra has captureFallback`, r.src?.audioInfoExtra().captureFallback?.kind === "mstp");
  check(`${mode}: onFallback called once`, r.fallbacks.length === 1);
  check(`${mode}: onError not called`, r.errors.length === 0, JSON.stringify(r.errors));
  check(`${mode}: no mstp init-ack`, !r.acks.some((a) => a.kind === "mstp"));
  r.src?.close();
}
{
  const r = await attempt("no-frame");
  check("no-frame: reader cancelled", readerCancelled === 1, String(readerCancelled));
  check("no-frame: timeout named in fallback", /first-frame timeout/.test(r.src?.fallbackFrom?.message ?? ""));
  r.src?.close();
}

console.log("captureSource: unchanged paths");
{
  const r = await attempt("ok");
  check("working MSTP stays mstp", r.src?.kind === "mstp" && !r.src.fallbackFrom, r.thrown?.message);
  check("working MSTP: no fallback, no AudioContext", r.fallbacks.length === 0 && audioContexts.length === 0);
  check("working MSTP: init-ack once", r.acks.length === 1 && r.acks[0].kind === "mstp");
  check("working MSTP: no captureFallback field", r.src && !("captureFallback" in r.src.audioInfoExtra()));
  r.src?.close();
  check("working MSTP: close() stops the track", r.stream.track.stopped);
}
{
  const r = await attempt("ctor-throws", { forceKind: "mstp" });
  check("forceKind mstp: no fallback, rejects", r.thrown && !r.src && r.fallbacks.length === 0 && audioContexts.length === 0);
}
{
  const r = await attempt("ctor-throws", { forceKind: "audiocontext" });
  check("forceKind audiocontext: audiocontext, no fallback record", r.src?.kind === "audiocontext" && !r.src.fallbackFrom && r.fallbacks.length === 0);
  r.src?.close();
}
{
  const r = await attempt("ends");
  check("track ended before first frame: rejects with track-ended, no fallback",
    r.thrown && /microphone disconnected/.test(r.thrown.message) && r.fallbacks.length === 0, r.thrown?.message);
}

console.log("captureSource: a failed AudioContext setup closes its context");
for (const fail of ["addmodule", "source"]) {
  for (const [label, extra, mode] of [["fallback", {}, "ctor-throws"], ["audiocontext path", { forceKind: "audiocontext" }, "ok"]]) {
    ctxFail = fail;
    const r = await attempt(mode, extra);
    ctxFail = null;
    check(`${fail} fails (${label}): rejects`, r.thrown && !r.src, r.src?.kind);
    check(`${fail} fails (${label}): context closed`, audioContexts.length === 1 && audioContexts[0].closed);
    check(`${fail} fails (${label}): track not stopped by the factory`, !r.stream.track.stopped);
  }
}

// ---- Part 2: the real hook ----
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

class FakeWorker {
  constructor(url) { this.url = String(url); this.onmessage = null; this.onerror = null; }
  postMessage() {} terminate() {} addEventListener() {} removeEventListener() {}
}
globalThis.Worker = FakeWorker;
globalThis.window ||= { location: { search: "" }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };

let gumCalls = 0;
let gumImpl = null;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { userAgent: "node", mediaDevices: { getUserMedia: (c) => { gumCalls++; return gumImpl(c); } } },
});

let gen = 0;
async function runHook() {
  M.refs = []; M.effects = []; M.state = null; gumCalls = 0;
  const mod = await import(`${HOOK}?g=${++gen}`);
  const api = mod.useAudioPipeline();
  for (const e of M.effects) { try { e(); } catch { /* effects that need a DOM */ } }
  await api.start();
  return M.state;
}

console.log("useAudioPipeline: fallback and permission wording");
const warn = console.warn; console.warn = () => {};
{
  mstpMode = "ctor-throws";
  const stream = makeStream();
  gumImpl = () => Promise.resolve(stream);
  const st = await runHook();
  check("hook: MSTP ctor throws -> running", st?.status === "running", `${st?.status} ${st?.error ?? ""}`);
  check("hook: one getUserMedia call", gumCalls === 1, String(gumCalls));
  check("hook: stream kept alive", !stream.track.stopped);
}
{
  gumImpl = () => Promise.reject(Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }));
  const st = await runHook();
  check("hook: NotAllowedError -> error that says denied", st?.status === "error" && /denied/i.test(st.error ?? ""), st?.error);
  check("hook: NotAllowedError -> tells the user to allow the mic", /Allow the microphone/.test(st?.error ?? ""), st?.error);
}
{
  // A message-less non-permission failure used to fall back to "Microphone access denied".
  gumImpl = () => Promise.reject(Object.assign(new Error(""), { name: "NotReadableError" }));
  const st = await runHook();
  check("hook: message-less NotReadableError -> not 'denied'",
    st?.status === "error" && !/denied/i.test(st.error ?? "") && /could not be started/.test(st.error ?? ""), st?.error);
}
{
  mstpMode = "ctor-throws";
  const track = makeTrack(); track.readyState = "ended";
  gumImpl = () => Promise.resolve(makeStream(track));
  const st = await runHook();
  check("hook: dead track -> error, not 'denied'", st?.status === "error" && !/denied/i.test(st.error ?? ""), st?.error);
}
console.warn = warn;

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
