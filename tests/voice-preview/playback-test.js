// playback-test.js — Voice Shaper's three-way playback (src/voice-preview/playback.js)
// against a fake AudioContext with a hand-moved clock: the context is created on the first
// play, each version plays at its own rate, A/B switching keeps the position, pressing the
// playing version stops it, a new preview takes over at the same position, the loop wraps
// and can be toggled mid-play, a version ending by itself stops, the context is suspended
// whenever nothing plays and closed by clear() (Discard / Record again: a suspended context
// kept the last-played AudioBuffer alive in Chrome) and close(); the next press makes a new
// context. measurements/voice-preview-phase1-2026-10-19.md §8, fix step.
//
//   node tests/voice-preview/playback-test.js
import { createPlayback } from "../../src/voice-preview/playback.js";
import { makeChecker } from "./vp-test-lib.js";

const T = makeChecker();

class FakeCtx {
  constructor() { this.currentTime = 0; this.state = "suspended"; this.nodes = []; this.buffers = []; this.closed = false; this.onstatechange = null; }
  _set(st) { this.state = st; this.onstatechange?.(); }
  resume() { this._set("running"); return Promise.resolve(); }
  suspend() { this._set("suspended"); return Promise.resolve(); }
  close() { this.closed = true; this._set("closed"); return Promise.resolve(); }
  get destination() { return { dest: true }; }
  createBuffer(ch, n, rate) {
    const b = { ch, length: n, sampleRate: rate, duration: n / rate, data: null, copyToChannel(x) { this.data = Float32Array.from(x); } };
    this.buffers.push(b);
    return b;
  }
  createBufferSource() {
    const node = { buffer: null, loop: false, started: null, stopped: false, connected: null, onended: null,
      connect(d) { this.connected = d; }, disconnect() { this.connected = null; },
      start(when, off) { this.started = { when, off }; }, stop() { this.stopped = true; } };
    this.nodes.push(node);
    return node;
  }
}

let ctx = null;
let created = 0;
const pb = createPlayback({ createContext: () => { created++; ctx = new FakeCtx(); return ctx; } });
const states = [];
pb.subscribe((s) => states.push(s));
const live = () => ctx.nodes.filter((n) => !n.stopped);

const capRate = 44100, engRate = 44100, sec = 5;
const tone = (rate) => Float32Array.from({ length: rate * sec }, (_, i) => Math.sin(i / 10));
pb.setSource("original", { pcm: tone(capRate), rate: capRate });
pb.setSource("rebuild", { pcm: tone(engRate), rate: engRate });

console.log("first play");
T.check("no AudioContext before the first press", created === 0 && pb.getState().audio === null);
T.check("preview without samples does not play", pb.play("preview") === false && created === 0);
T.check("play rebuild: context created and running, node at offset 0", pb.play("rebuild") === true && created === 1 && ctx.state === "running"
  && live().length === 1 && live()[0].started.off === 0 && live()[0].buffer.sampleRate === engRate && live()[0].connected?.dest === true);
T.check("state: playing rebuild", pb.getState().playing === "rebuild" && pb.getState().audio === "running");

console.log("\nA/B switching keeps the position");
ctx.currentTime = 1.25;
pb.play("original");
T.check("original starts at 1.25 s, the rebuild node stopped", live().length === 1 && Math.abs(live()[0].started.off - 1.25) < 1e-9 && ctx.nodes[0].stopped && ctx.nodes[0].onended === null);
T.check("buffers made once per version, at their own rates", ctx.buffers.length === 2 && ctx.buffers[1].sampleRate === capRate);
ctx.currentTime = 2.0;
pb.setSource("preview", { pcm: tone(engRate), rate: engRate });
pb.play("preview");
T.check("preview starts at 2.0 s", Math.abs(live()[0].started.off - 2.0) < 1e-9 && pb.getState().playing === "preview");

console.log("\na new preview while the preview plays");
ctx.currentTime = 2.5;
pb.setSource("preview", { pcm: tone(engRate), rate: engRate });
T.check("takes over at 2.5 s, still playing the preview", live().length === 1 && Math.abs(live()[0].started.off - 2.5) < 1e-9 && pb.getState().playing === "preview");
const nb = ctx.buffers.length;
ctx.currentTime = 2.6;
pb.play("rebuild");
T.check("the rebuild's AudioBuffer is reused", ctx.buffers.length === nb && Math.abs(live()[0].started.off - 2.6) < 1e-9);

console.log("\npressing the playing version stops it");
T.check("play(rebuild) again -> stopped, context suspended", pb.play("rebuild") === false && live().length === 0 && pb.getState().playing === null && ctx.state === "suspended");
T.check("a fresh play starts from the beginning", pb.play("original") && live()[0].started.off === 0 && ctx.state === "running");

console.log("\nloop");
const t0 = ctx.currentTime;
pb.setLoop(true);
T.check("loop applies to the playing node", live()[0].loop === true && pb.getState().loop === true);
ctx.currentTime = t0 + 6.5; // past the 5 s end, looped
T.check("position wraps", Math.abs(pb.position() - 1.5) < 1e-9, pb.position().toFixed(3));
pb.play("rebuild");
T.check("switching while looping keeps the wrapped position and the loop", Math.abs(live()[0].started.off - 1.5) < 1e-9 && live()[0].loop === true);
ctx.currentTime += 1;
pb.setLoop(false);
T.check("loop off mid-play: node loop off, position kept (2.5 s)", live()[0].loop === false && Math.abs(pb.position() - 2.5) < 1e-9);
ctx.currentTime += 1;
T.check("then it advances without wrapping (3.5 s)", Math.abs(pb.position() - 3.5) < 1e-9);

console.log("\na version ending by itself");
{ const n = live()[0]; n.stopped = true; n.onended(); } // the node finished playing
T.check("ended -> nothing plays, suspended", pb.getState().playing === null && ctx.state === "suspended");

console.log("\nstop, clear, close");
pb.play("preview");
pb.stop();
T.check("stop()", live().length === 0 && pb.getState().playing === null);
pb.play("rebuild");
const ctx1 = ctx;
pb.clear();
T.check("clear(): stopped, every version dropped", ctx1.nodes.every((n) => n.stopped) && !pb.has("preview") && !pb.has("rebuild") && !pb.has("original") && pb.play("rebuild") === false);
T.check("clear(): the context is closed, not suspended (nothing of the recording stays alive)", ctx1.closed && ctx1.state === "closed" && pb.getState().audio === null && pb.getState().playing === null);
T.check("clear(): no new context until the next press", created === 1);
pb.setSource("rebuild", { pcm: tone(engRate), rate: engRate });
pb.play("rebuild");
T.check("after clear a press makes a new context", created === 2 && ctx !== ctx1 && ctx.state === "running" && live().length === 1);
pb.close();
T.check("close(): node stopped, context closed, state cleared", live().length === 0 && ctx.closed && pb.getState().audio === null && pb.getState().playing === null);
pb.setSource("rebuild", { pcm: tone(engRate), rate: engRate });
pb.play("rebuild");
T.check("after close a press makes a new context", created === 3 && ctx.state === "running");
T.check("subscribers saw every change", states.length > 10);

T.done();
