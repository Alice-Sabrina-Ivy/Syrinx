// takes-test.js — the guided exercises' recordings and the open-lesson state
// (src/exercises/takes.js, session.js, hear.js), with fake capture ports, a fake
// AudioContext and a fake Voice Shaper controller.
//   - recordTake: copies whole chunks, stops itself before the chunk that would pass
//     8 s, takes itself off the capture (disconnect + close), drops a take under 0.5 s.
//   - the player: one context made on the first play, a press on the playing take stops
//     it, a new take stops the old one, close() closes the context.
//   - the lesson state: open / close drop takes, frames and the player's context; a card
//     change stops a running take; only one take at a time.
//   - "Hear it first": after a recording is analysed, the resonance-only versions for the
//     direction are rendered (pitch 0 st) and kept side by side; a new recording drops
//     them; Record again goes through the controller's recordAgain from a preview.
//
//   node tests/exercises/takes-test.js
import { recordTake, createTakePlayer, TAKE_MAX_S } from "../../src/exercises/takes.js";
import { createLessonSession } from "../../src/exercises/session.js";
import { createHear } from "../../src/exercises/hear.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

function fakeHandle(rate = 48000) {
  const h = {
    sampleRate: rate, ports: [], disconnected: [],
    connect() { const p = { onmessage: null, closed: false, close() { this.closed = true; } }; h.ports.push(p); return p; },
    disconnect(p) { h.disconnected.push(p); return true; },
    send(n, value = 0.1) { const p = h.ports.at(-1); p.onmessage?.({ data: { buffer: new Float32Array(n).fill(value).buffer, contextTime: 0 } }); },
  };
  return h;
}

console.log("recordTake");
{
  check("no capture handle: nothing starts", recordTake(null) === null);
  const h = fakeHandle();
  let done = null, progress = 0;
  const r = recordTake(h, { onProgress: () => progress++, onDone: (t) => { done = t; } });
  for (let i = 0; i < 40; i++) h.send(1200, i / 100); // 1 s at 48 kHz
  r.stop();
  check("a take of whole chunks at the capture rate", done && done.pcm.length === 48000 && done.rate === 48000 && Math.abs(done.seconds - 1) < 1e-9);
  check("samples copied in order", done.pcm[0] === 0 && Math.abs(done.pcm[1200] - 0.01) < 1e-7 && Math.abs(done.pcm[47999] - 0.39) < 1e-7);
  check("progress reported while recording", progress >= 9);
  check("stop takes the consumer off the capture and closes the port", h.disconnected.length === 1 && h.ports[0].closed && h.ports[0].onmessage === null);
}
{
  const h = fakeHandle();
  let done = null;
  recordTake(h, { onDone: (t) => { done = t; } });
  for (let i = 0; i < 400 && !done; i++) h.send(1200);
  check(`stops itself before passing ${TAKE_MAX_S} s`, done && done.seconds <= TAKE_MAX_S && done.seconds > TAKE_MAX_S - 0.03 && h.disconnected.length === 1, String(done?.seconds));
}
{
  const h = fakeHandle();
  let done = "unset";
  const r = recordTake(h, { onDone: (t) => { done = t; } });
  h.send(1200);
  r.stop();
  check("under 0.5 s: dropped (onDone(null))", done === null);
}

console.log("\nplayer");
function fakeContextFactory() {
  const made = [];
  const create = () => {
    const ctx = {
      state: "running", closed: false, started: [],
      createBuffer: (ch, len, rate) => ({ len, rate, copyToChannel() {} }),
      createBufferSource() {
        const n = { buffer: null, onended: null, connect() {}, disconnect() {}, start() { ctx.started.push(n); }, stop() { n.stopped = true; } };
        return n;
      },
      get destination() { return {}; },
      resume() { ctx.state = "running"; return Promise.resolve(); },
      suspend() { ctx.state = "suspended"; return Promise.resolve(); },
      close() { ctx.closed = true; ctx.state = "closed"; return Promise.resolve(); },
    };
    made.push(ctx);
    return ctx;
  };
  return { made, create };
}
{
  const f = fakeContextFactory();
  const p = createTakePlayer({ createContext: f.create });
  const take = { pcm: new Float32Array(4800), rate: 48000 };
  check("no context before the first play", f.made.length === 0);
  check("play starts", p.play("a", take) === true && p.getState().playing === "a" && f.made.length === 1);
  check("another take stops the first", p.play("b", take) === true && f.made[0].started[0].stopped && p.getState().playing === "b");
  check("pressing the playing take stops it", p.play("b", take) === false && p.getState().playing === null);
  p.play("a", take);
  f.made[0].started.at(-1).onended();
  check("the end of a take clears playing", p.getState().playing === null);
  check("an empty take does not play", p.play("x", { pcm: new Float32Array(0), rate: 48000 }) === false);
  p.close();
  check("close() closes the context; the next play makes a new one", f.made[0].closed && p.play("a", take) && f.made.length === 2);
}

console.log("\nlesson state");
{
  const f = fakeContextFactory();
  const session = createLessonSession({ createPlayer: () => createTakePlayer({ createContext: f.create }) });
  session.open("R3", { now: 5 });
  check("open: lesson, card 0, start time", session.getState().lessonId === "R3" && session.getState().card === 0 && session.getState().startedAt === 5);
  const h = fakeHandle();
  const start = (onProgress, onDone) => recordTake(h, { onProgress, onDone });
  check("start a take", session.startTake("bright", start) === true && session.getState().recording?.takeId === "bright");
  check("only one take at a time", session.startTake("dark", start) === false);
  for (let i = 0; i < 40; i++) h.send(1200);
  session.setCard(1);
  check("a card change stops the take and keeps it", session.getState().recording === null && session.getState().takes.bright?.seconds === 1);
  session.frameLog(3).push({ voiced: true, f0: 200 }, 1);
  session.frameLog(4).push({ voiced: true, f0: 210 }, 0);
  check("frames of every measuring card, in time order", session.allFrames().map((x) => x.f0).join() === "210,200");
  session.player.play("bright", session.getState().takes.bright);
  let disposed = 0;
  session.setHear({ dispose: () => disposed++ });
  session.close();
  check("close drops takes, frames, the player's context and the Voice Shaper wrapper", session.getState().lessonId === null
    && Object.keys(session.getState().takes).length === 0 && session.allFrames().length === 0 && f.made[0].closed && disposed === 1);
}

console.log("\nhear it first");
function fakeController() {
  let state = { phase: "loading", analysis: null, original: null, preview: null, rendering: null, level: null, analysingStage: null };
  const ls = new Set();
  const c = {
    renders: [], again: 0, recorded: 0,
    set(patch) { state = { ...state, ...patch }; for (const fn of ls) fn(state); },
    subscribe(fn) { ls.add(fn); fn(state); return () => ls.delete(fn); },
    getState: () => state,
    readyInMs: () => 0,
    record() { c.recorded++; c.set({ phase: "recording" }); return true; },
    stop() {},
    recordAgain() { c.again++; return true; },
    render(st, pct) {
      if (state.rendering) { if (state.rendering.pct !== pct) c.waiting = { st, pct }; return true; }
      c.renders.push(pct); c.set({ rendering: { st, pct } }); return true;
    },
    finishRender() {
      const r = state.rendering;
      c.set({ rendering: null, preview: { st: r.st, pct: r.pct, pcm: new Float32Array([r.pct]), rate: 44100 } });
      if (c.waiting) { const w = c.waiting; c.waiting = null; c.render(w.st, w.pct); }
    },
    dispose() { c.disposed = true; },
  };
  return c;
}
{
  const ctl = fakeController();
  const hear = createHear({ shifts: [10, -10], createController: () => ctl });
  hear.record();
  ctl.set({ phase: "analysing" });
  check("nothing rendered before the analysis", ctl.renders.length === 0);
  ctl.set({ phase: "preview", analysis: { take: 1, captureRate: 48000, rate: 44100 }, original: new Float32Array(48000) });
  check("after the analysis: the first version is rendered (pitch 0 st)", ctl.renders.join() === "10" && ctl.getState().rendering.st === 0);
  check("the original at the capture rate", hear.getState().original?.rate === 48000 && hear.getState().original.pcm.length === 48000);
  ctl.finishRender();
  check("…then the second", ctl.renders.join() === "10,-10" && hear.getState().versions[10]?.pcm[0] === 10);
  ctl.finishRender();
  check("both versions kept side by side", hear.getState().versions[10] && hear.getState().versions[-10]?.pcm[0] === -10 && ctl.renders.length === 2);
  hear.recordAgain();
  check("Record again from a preview uses the controller's recordAgain", ctl.again === 1);
  ctl.set({ phase: "preview", analysis: { take: 2, captureRate: 48000, rate: 44100 }, original: new Float32Array(10), preview: null });
  check("a new recording drops the old versions and renders again", Object.keys(hear.getState().versions).length === 0 && ctl.renders.length === 3);
  hear.dispose();
  check("dispose ends the controller", ctl.disposed === true);
}
{
  const ctl = fakeController();
  const hear = createHear({ shifts: [10], createController: () => ctl });
  ctl.set({ phase: "preview", analysis: { take: 1, captureRate: 192000, rate: 48000 }, original: new Float32Array(10) });
  check("above 96 kHz the original is at the engine rate (as Voice Shaper's card)", hear.getState().original.rate === 48000);
  ctl.finishRender();
  hear.setShifts([10, -10]);
  check("a direction change asks for the missing version only", ctl.renders.join() === "10,-10");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
