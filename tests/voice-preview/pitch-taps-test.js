// pitch-taps-test.js — Voice Shaper's posted-pitch taps when two controllers record at
// once (Voice Shaper's tab and the guided exercises' "Hear it first", review 2026-10-27):
// each controller adds and removes only its own tap, so disposing one (a lesson closed)
// or starting another never cuts the posted pitch off from a recording still running.
// Fake workers; the REAL bridge and controller.
//
//   node tests/voice-preview/pitch-taps-test.js
import { setVoicePreviewCapture, voicePreviewPitchTap, setVoicePreviewPitchTap, addVoicePreviewPitchTap } from "../../src/voice-preview/bridge.js";
import { createVoicePreviewController } from "../../src/voice-preview/controller.js";

let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  PASS ${name}`); } else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

class FakeWorker {
  constructor() { this.onmessage = null; this.got = []; this.terminated = false; }
  postMessage(m) { this.got.push(m); }
  terminate() { this.terminated = true; }
  pitches() { return this.got.filter((m) => m.type === "pitch").length; }
}

setVoicePreviewCapture({
  sampleRate: 16000,
  connect() { return new MessageChannel().port2; },
  disconnect() {},
  startedAt: -100000,
});
function make() {
  let w = null;
  const ctl = createVoicePreviewController({
    createWorker: () => (w = new FakeWorker()), glueUrl: "g", wasmUrls: {}, now: () => 0,
    setTimer: () => 0, clearTimer: () => {},
  });
  w.onmessage({ data: { type: "ready", build: "simd", ms: 1, memBytes: 1 } });
  return { ctl, worker: () => w };
}
const msg = { type: "pitch", pitch: 200, contextTime: 1 };

console.log("bridge");
{
  const got = [];
  const off1 = addVoicePreviewPitchTap(() => got.push(1));
  addVoicePreviewPitchTap(() => got.push(2));
  voicePreviewPitchTap(msg);
  off1();
  voicePreviewPitchTap(msg);
  check("two taps both get a message; removing one leaves the other", got.join() === "1,2,2", got.join());
  setVoicePreviewPitchTap(null);
  voicePreviewPitchTap(msg);
  check("setVoicePreviewPitchTap(null) removes every tap", got.join() === "1,2,2");
}

console.log("two controllers");
{
  const a = make(), b = make();
  check("both ready", a.ctl.getState().phase === "ready" && b.ctl.getState().phase === "ready", a.ctl.getState().phase);
  check("A records", a.ctl.record() === true);
  voicePreviewPitchTap(msg);
  check("A's worker gets the posted pitch", a.worker().pitches() === 1);
  b.ctl.dispose(); // e.g. the lesson closes while Voice Shaper's tab records
  voicePreviewPitchTap(msg);
  check("disposing another controller keeps A's tap", a.worker().pitches() === 2, String(a.worker().pitches()));
  const c = make();
  check("C records while A does", c.ctl.record() === true);
  voicePreviewPitchTap(msg);
  check("both recordings get the posted pitch", a.worker().pitches() === 3 && c.worker().pitches() === 1, `${a.worker().pitches()} ${c.worker().pitches()}`);
  a.ctl.dispose();
  voicePreviewPitchTap(msg);
  check("disposing A removes only A's tap", a.worker().pitches() === 3 && c.worker().pitches() === 2);
  c.ctl.dispose();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
