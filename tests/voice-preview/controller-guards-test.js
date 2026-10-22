// controller-guards-test.js — the Voice Shaper controller's guards added in the fix step
// (src/voice-preview/controller.js), against a scripted fake worker and fake timers (no
// WebAssembly): a render error sends the setting that waited behind it at once and a later
// successful render clears the error (it used to replay the stale setting after a newer
// one); Record again refuses while the 6 s listening wait runs (it used to discard the
// preview and record nothing); a worker that never gets ready, or never finishes the
// analysis, is terminated by a watchdog and the card gets a way out (load-error / error,
// then Record again with a fresh worker); a render out of memory still goes to "memory".
// Re-arm (2026-10-21 phone report): for REARM_MS after a recording ends, Record / Record
// again refuse, so the press that stopped it (a finger touching down again as Stop turns
// into Record again) cannot start a new recording and drop the preview.
// measurements/voice-preview-phase1-2026-10-19.md, "Fix step".
//
//   node tests/voice-preview/controller-guards-test.js
import { setVoicePreviewCapture, voicePreviewPitchTap } from "../../src/voice-preview/bridge.js";
import * as controller from "../../src/voice-preview/controller.js";
const { createVoicePreviewController, LISTEN_BEFORE_RECORD_MS, LOAD_TIMEOUT_MS, ANALYSE_TIMEOUT_MS } = controller;
// (read through the namespace so this file still runs, and its re-arm checks fail, on code without it)
const REARM_MS = controller.REARM_MS ?? 1000;
import { makeChecker } from "./vp-test-lib.js";

const T = makeChecker();

// ---- fake clock + timers
let clock = 100000;
let timers = [];
let timerSeq = 0;
const setTimer = (fn, ms) => { const id = ++timerSeq; timers.push({ id, at: clock + ms, fn }); return id; };
const clearTimer = (id) => { timers = timers.filter((t) => t.id !== id); };
function advance(ms) {
  const end = clock + ms;
  for (;;) {
    const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    timers = timers.filter((t) => t !== due);
    clock = due.at;
    due.fn();
  }
  clock = end;
}

// ---- scripted fake worker
const workers = [];
function fakeWorker() {
  const w = { sent: [], terminated: false, onmessage: null, onerror: null,
    postMessage(m) { this.sent.push(m); }, terminate() { this.terminated = true; } };
  workers.push(w);
  return w;
}
const from = (w, m) => w.onmessage({ data: m });
const ready = (w) => from(w, { type: "ready", build: "simd", ms: 50, memBytes: 16 << 20 });
const ANALYSED = () => ({ type: "analysed", rate: 48000, captureRate: 48000, seconds: 5, check: { hum: false, noise: false, marginDb: 40, voicedS: 3 },
  pitch: { medianHz: 180, p5Hz: 140 }, limits: { stMin: -10, stMax: 12, pctMin: -21, pctMax: 26 }, hops: { recorded: 200, received: 200 },
  ms: { total: 800 }, memBytes: 76 << 20, original: new Float32Array(8), rebuild: new Float32Array(8) });
const rendered = (w, st, pct) => from(w, { type: "rendered", id: 0, st, pct, pcm: new Float32Array(8), rate: 48000, ms: { render: 200 } });
const renders = (w) => w.sent.filter((m) => m.type === "render").map((m) => `${m.st},${m.pct}`);

// ---- the capture handle, as useAudioPipeline registers it
const disconnected = [];
function listen(sinceMs) {
  setVoicePreviewCapture({
    sampleRate: 48000,
    connect() { const ch = new MessageChannel(); return ch.port2; },
    disconnect(p) { disconnected.push(p); try { p.close(); } catch { /* */ } },
    startedAt: clock - sinceMs,
  });
}

const make = () => createVoicePreviewController({ createWorker: fakeWorker, glueUrl: "glue", wasmUrls: { simd: "s", nosimd: "n" }, now: () => clock, setTimer, clearTimer });

/** A controller with a finished preview on worker `w`. */
function withPreview() {
  const ctl = make();
  const w = workers.at(-1);
  ready(w);
  listen(10000);
  T.check("record() starts", ctl.record() === true);
  from(w, { type: "recorded", seconds: 5, reason: "user" });
  from(w, ANALYSED());
  return { ctl, w };
}

console.log("render error with a setting waiting behind it");
{
  const { ctl, w } = withPreview();
  ctl.render(2, 3);             // in flight
  ctl.render(4, 0);             // waiting
  from(w, { type: "error", stage: "render", kind: "other", message: "boom", id: 1 });
  T.check("the waiting setting is sent at once", renders(w).join(" | ") === "2,3 | 4,0" && ctl.getState().rendering?.st === 4, renders(w).join(" | "));
  T.check("the error notice is set and the phase stays preview", ctl.getState().error?.stage === "render" && ctl.getState().phase === "preview");
  ctl.render(6, 0);             // the user moves on while 4,0 renders: waits
  rendered(w, 4, 0);            // 4,0 done -> 6,0 sent
  T.check("a successful render clears the error notice", ctl.getState().error === null);
  T.check("the newer setting follows", renders(w).at(-1) === "6,0" && ctl.getState().rendering?.st === 6, renders(w).join(" | "));
  rendered(w, 6, 0);
  T.check("the preview ends at the slider's setting, nothing stale replayed", ctl.getState().preview.st === 6 && ctl.getState().rendering === null && renders(w).length === 3, renders(w).join(" | "));
  ctl.dispose();
}

console.log("\nrender error with nothing waiting");
{
  const { ctl, w } = withPreview();
  ctl.render(2, 3);
  from(w, { type: "error", stage: "render", kind: "other", message: "boom", id: 1 });
  T.check("no render sent, the previous preview stays", renders(w).length === 1 && ctl.getState().rendering === null && ctl.getState().phase === "preview");
  T.check("the same setting can be tried again", ctl.render(2, 3) === true && renders(w).length === 2);
  ctl.dispose();
}

console.log("\nrender out of memory");
{
  const { ctl, w } = withPreview();
  ctl.render(2, 3);
  from(w, { type: "error", stage: "render", kind: "memory", message: "oom", id: 1 });
  T.check("-> phase memory (Record again / Discard)", ctl.getState().phase === "memory" && ctl.getState().rendering === null);
  ctl.dispose();
}

console.log("\nRecord again during the listening wait");
{
  const { ctl, w } = withPreview();
  // listening stopped and restarted 2 s ago, the preview still on screen
  setVoicePreviewCapture(null);
  listen(2000);
  T.check(`Record would wait ${(LISTEN_BEFORE_RECORD_MS - 2000) / 1000} s`, ctl.readyInMs() === LISTEN_BEFORE_RECORD_MS - 2000);
  T.check("Record again refused: returns false", ctl.recordAgain() === false);
  T.check("…the preview, its worker and its audio are kept", ctl.getState().phase === "preview" && ctl.getState().original !== null && !w.terminated && workers.at(-1) === w);
  setVoicePreviewCapture(null);
  T.check("not listening: refused too", ctl.recordAgain() === false && ctl.getState().phase === "preview");
  listen(2000);
  advance(LISTEN_BEFORE_RECORD_MS - 2000);
  T.check("after the wait: Record again discards and starts a fresh worker", ctl.recordAgain() === true && w.terminated && workers.at(-1) !== w && ctl.getState().original === null);
  const w2 = workers.at(-1);
  ready(w2);
  T.check("…which records as soon as it is ready", ctl.getState().phase === "recording" && w2.sent.some((m) => m.type === "record"));
  ctl.cancel();
  from(w2, { type: "cancelled", seconds: 0.2 });
  ctl.dispose();
}

console.log("\nwatchdog: a worker that never gets ready");
{
  timers = [];
  const ctl = make();
  const w = workers.at(-1);
  advance(LOAD_TIMEOUT_MS - 1);
  T.check("still loading just before the limit", ctl.getState().phase === "loading" && !w.terminated);
  advance(1);
  T.check(`after ${LOAD_TIMEOUT_MS / 1000} s: load-error, the worker terminated`, ctl.getState().phase === "load-error" && ctl.getState().error?.kind === "timeout" && w.terminated);
  from(w, { type: "ready", build: "simd", ms: 1, memBytes: 1 });
  T.check("a late answer from the old worker is ignored", ctl.getState().phase === "load-error");
  ctl.dispose();
}

console.log("\nwatchdog: a ready worker does not time out");
{
  timers = [];
  const ctl = make();
  ready(workers.at(-1));
  T.check("no timer left once ready", timers.length === 0);
  advance(LOAD_TIMEOUT_MS * 2);
  T.check("still ready", ctl.getState().phase === "ready");
  ctl.dispose();
}

console.log("\nwatchdog: an analysis that never finishes");
{
  timers = [];
  disconnected.length = 0;
  const ctl = make();
  const w = workers.at(-1);
  ready(w);
  listen(10000);
  ctl.record();
  from(w, { type: "recorded", seconds: 8, reason: "max" });
  T.check("analysing; the capture consumer released", ctl.getState().phase === "analysing" && disconnected.length === 1);
  let tapped = 0;
  const n0 = w.sent.length;
  voicePreviewPitchTap({ contextTime: 1, pitch: 200 });
  tapped = w.sent.length - n0;
  T.check("the pitch tap stays until the track is complete", tapped === 1);
  advance(ANALYSE_TIMEOUT_MS - 1);
  T.check("still analysing just before the limit", ctl.getState().phase === "analysing" && !w.terminated);
  advance(1);
  T.check(`after ${ANALYSE_TIMEOUT_MS / 1000} s: error, the worker terminated (its memory goes)`, ctl.getState().phase === "error" && ctl.getState().error?.kind === "timeout" && w.terminated);
  const n1 = w.sent.length;
  voicePreviewPitchTap({ contextTime: 2, pitch: 200 });
  T.check("…and the pitch tap removed", w.sent.length === n1);
  advance(REARM_MS);
  T.check("Record again: a fresh worker that records when ready", ctl.recordAgain() === true && workers.at(-1) !== w);
  ready(workers.at(-1));
  T.check("…recording", ctl.getState().phase === "recording");
  from(workers.at(-1), { type: "recorded", seconds: 5, reason: "user" });
  from(workers.at(-1), ANALYSED());
  T.check("a finished analysis clears the watchdog (only the re-arm timer is left)", ctl.getState().phase === "preview" && timers.length === 1 && ctl.getState().rearming === true);
  advance(REARM_MS);
  T.check("…and no timer once re-armed", timers.length === 0 && ctl.getState().rearming === false);
  ctl.dispose();
}

console.log("\nwatchdog: Discard while analysing");
{
  timers = [];
  const ctl = make();
  const w = workers.at(-1);
  ready(w);
  listen(10000);
  ctl.record();
  from(w, { type: "recorded", seconds: 8, reason: "max" });
  ctl.discard();
  T.check("Discard while analysing: the worker terminated, a fresh one loading", w.terminated && ctl.getState().phase === "loading" && workers.at(-1) !== w);
  T.check("only the fresh worker's load watchdog is left", timers.length === 1);
  ready(workers.at(-1));
  T.check("…ready, no timer", ctl.getState().phase === "ready" && timers.length === 0);
  ctl.dispose();
}

console.log("\nre-arm: a press right after a recording ends does not start the next one");
{
  timers = [];
  T.check("REARM_MS is about a second", REARM_MS >= 500 && REARM_MS <= 1500, String(REARM_MS));
  const ctl = make();
  const w = workers.at(-1);
  ready(w);
  listen(10000);
  T.check("not re-arming before any recording", ctl.getState().rearming === false && ctl.record() === true);
  ctl.stop();                                       // the Stop press
  T.check("Stop pressed: still recording until the worker answers", ctl.getState().phase === "recording" && ctl.getState().rearming === false);
  from(w, { type: "recorded", seconds: 3.5, reason: "user" });
  T.check("analysing: no re-arm yet (the button cannot act)", ctl.getState().phase === "analysing" && ctl.getState().rearming === false);
  from(w, ANALYSED());
  T.check("preview: the button re-arms", ctl.getState().phase === "preview" && ctl.getState().rearming === true);
  // the finger touches down again: Record again
  T.check("Record again right away: refused (returns false)", ctl.recordAgain() === false);
  T.check("…the preview, its worker and its audio are kept; no new recording", ctl.getState().phase === "preview" && ctl.getState().original !== null && !w.terminated && workers.at(-1) === w
    && w.sent.filter((m) => m.type === "record").length === 1);
  advance(REARM_MS - 1);
  T.check(`still refused ${REARM_MS - 1} ms after the preview appeared`, ctl.getState().rearming === true && ctl.recordAgain() === false && workers.at(-1) === w);
  advance(1);
  T.check(`re-armed ${REARM_MS} ms after it`, ctl.getState().rearming === false && timers.length === 0);
  T.check("…then Record again works", ctl.recordAgain() === true && w.terminated && workers.at(-1) !== w);
  const w2 = workers.at(-1);
  ready(w2);
  T.check("…and records with the fresh worker", ctl.getState().phase === "recording");
  // a stop before 3 s: too short, Record right away is the same press
  from(w2, { type: "too-short", seconds: 1.2 });
  T.check("too short: re-arming, Record refused", ctl.getState().phase === "too-short" && ctl.getState().rearming === true && ctl.record() === false
    && w2.sent.filter((m) => m.type === "record").length === 1);
  advance(REARM_MS);
  T.check("…and accepted once re-armed", ctl.record() === true && ctl.getState().phase === "recording");
  // no voice (the message the phone report saw): the same
  from(w2, { type: "recorded", seconds: 4, reason: "user" });
  from(w2, { type: "no-voice", voicedS: 0.2, check: {} });
  T.check("no voice: re-arming, Record refused", ctl.getState().phase === "no-voice" && ctl.getState().rearming === true && ctl.record() === false);
  // Discard is deliberate: a fresh worker is not re-arming
  ctl.discard();
  T.check("Discard clears the re-arm and its timer", ctl.getState().rearming === false && timers.filter((t) => t.at - clock === REARM_MS).length === 0);
  ready(workers.at(-1));
  T.check("…Record works at once on the fresh worker", ctl.record() === true);
  ctl.dispose();
}

setVoicePreviewCapture(null);
T.done();
