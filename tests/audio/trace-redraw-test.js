// trace-redraw-test.js — when the pitch trace redraws
// (src/components/traceRedrawScheduler.js; measurements/phone-cpu-2026-10-12.md
// §4 — the rAF loop capped at ~60 Hz adopted 2026-10-12; before it,
// main-thread-cpu-2026-10-08.md §3 F1).
//
// A virtual clock with a display (animation frames on vsync ticks, none while
// "hidden"; 60 Hz unless stated) and timers drives the scheduler:
//   1. a steady 25 ms feed draws on every 60 Hz display frame;
//   2. a feed that stalls keeps drawing every frame: no gap > MIN_DRAW_MS +
//      1 frame, inside the review fix's FALLBACK_MS + 1 frame and guard 3c;
//   3. after the feed stops for IDLE_AFTER_MS the loop ends and the cadence is
//      ~IDLE_FALLBACK_MS (few frames requested); before that, every frame;
//   4. a phone-like feed (40 ms buffers, 1-2 points each) draws every frame;
//   5. on a 120 Hz display the loop draws at most every MIN_DRAW_MS (~60/s),
//      on a 144 Hz one every third frame, never a gap > MIN_DRAW_MS + 1 frame;
//   6. a burst of notifications draws once;
//   7. while hidden, requests do not pile up; one draw when shown;
//   8. stop() cancels the pending frame and the timer.
//
// Run: node tests/audio/trace-redraw-test.js

import {
  createTraceRedrawScheduler,
  FALLBACK_MS,
  IDLE_FALLBACK_MS,
  IDLE_AFTER_MS,
  MIN_DRAW_MS,
} from "../../src/components/traceRedrawScheduler.js";

let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++; else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const VSYNC = 1000 / 60;

function makeSim(vsync = VSYNC) {
  const sim = { t: 0, hidden: false, timers: new Map(), frames: new Map(), nextId: 1, draws: [], events: [], frameRequests: [] };
  sim.sched = createTraceRedrawScheduler({
    draw: () => sim.draws.push(sim.t),
    requestFrame: (cb) => { const id = sim.nextId++; sim.frames.set(id, cb); sim.frameRequests.push(sim.t); return id; },
    cancelFrame: (id) => { sim.frames.delete(id); },
    setTimer: (fn, ms) => { const id = sim.nextId++; sim.timers.set(id, { at: sim.t + ms, fn }); return id; },
    clearTimer: (id) => { sim.timers.delete(id); },
    now: () => sim.t,
  });
  // Scheduled external events (data notifications), sorted by time.
  sim.at = (t, fn) => sim.events.push({ t, fn });
  sim.runUntil = (end) => {
    sim.events.sort((a, b) => a.t - b.t);
    let nextVsync = Math.ceil(sim.t / vsync + 1e-9) * vsync;
    for (;;) {
      const ev = sim.events[0]?.t ?? Infinity;
      let tm = Infinity, tmId = null;
      for (const [id, x] of sim.timers) if (x.at < tm) { tm = x.at; tmId = id; }
      const t = Math.min(ev, tm, nextVsync);
      if (t > end) { sim.t = end; return; }
      sim.t = t;
      if (t === ev) { sim.events.shift().fn(); continue; }
      if (t === tm) { const x = sim.timers.get(tmId); sim.timers.delete(tmId); x.fn(); continue; }
      nextVsync += vsync;
      if (sim.hidden) continue;
      const q = [...sim.frames.values()];
      sim.frames.clear();
      for (const cb of q) cb(sim.t);
    }
  };
  return sim;
}
const gaps = (d) => d.slice(1).map((x, i) => x - d[i]);
const max = (a) => a.reduce((m, x) => Math.max(m, x), -Infinity);
const min = (a) => a.reduce((m, x) => Math.min(m, x), Infinity);
const EPS = 1e-9;
const feed25 = (sim, from, to) => { for (let t = from; t < to; t += 25) sim.at(t, () => sim.sched.notify()); };

// 1. Steady 25 ms feed for 10 s at 60 Hz: a draw on every display frame.
{
  const sim = makeSim();
  feed25(sim, 0, 10000);
  sim.runUntil(10000);
  const n = sim.draws.length;
  check("steady 25 ms feed, 60 Hz: a draw on every display frame (~600 in 10 s)", n >= 595 && n <= 601, `${n} draws`);
  check("steady 25 ms feed, 60 Hz: longest gap between draws <= 1 frame", max(gaps(sim.draws)) <= VSYNC + EPS,
    `max ${max(gaps(sim.draws)).toFixed(1)} ms`);
}

// 2. Feed stalls: 25 ms points, then stalls of 60, 90, 120, 200 and 400 ms.
{
  const sim = makeSim();
  let t = 0;
  const stalls = [60, 90, 120, 200, 400];
  for (const s of stalls) {
    for (let k = 0; k < 40; k++, t += 25) { const tt = t; sim.at(tt, () => sim.sched.notify()); }
    t += s;
  }
  sim.runUntil(t);
  const mg = max(gaps(sim.draws));
  check(`stalled feed: longest gap between draws <= MIN_DRAW_MS (${MIN_DRAW_MS}) + 1 frame`, mg <= MIN_DRAW_MS + VSYNC + EPS,
    `max ${mg.toFixed(1)} ms`);
  check(`stalled feed: inside the review fix's bound, FALLBACK_MS (${FALLBACK_MS}) + 1 frame`, mg <= FALLBACK_MS + VSYNC + EPS,
    `max ${mg.toFixed(1)} ms`);
  check("stalled feed: longest gap <= 100 ms (guard 3c)", mg <= 100, `max ${mg.toFixed(1)} ms`);
}

// 3. Idle: notifications stop at 1 s; until IDLE_AFTER_MS later the loop keeps
// drawing every frame, then the cadence is ~IDLE_FALLBACK_MS and the loop no
// longer asks for every display frame.
{
  const sim = makeSim();
  feed25(sim, 0, 1000);
  sim.runUntil(6000);
  const late = sim.draws.filter((x) => x > 1000 + IDLE_AFTER_MS + 200);
  const g = gaps(late);
  const ok = g.length > 10 && g.every((x) => x >= IDLE_FALLBACK_MS - EPS && x <= IDLE_FALLBACK_MS + VSYNC + EPS);
  check(`idle: redraws every ${IDLE_FALLBACK_MS} ms + <= 1 frame`, ok,
    `${late.length} draws, gaps ${min(g).toFixed(1)}–${max(g).toFixed(1)} ms`);
  const lateReq = sim.frameRequests.filter((x) => x > 1000 + IDLE_AFTER_MS + 200 && x <= 6000).length;
  const lateSec = (6000 - (1000 + IDLE_AFTER_MS + 200)) / 1000;
  check("idle: the frame loop has stopped (<= 1 frame request per idle redraw)", lateReq <= late.length + 1,
    `${(lateReq / lateSec).toFixed(1)} requests/s, ${(late.length / lateSec).toFixed(1)} draws/s`);
  const early = sim.draws.filter((x) => x > 1000 && x < 1000 + IDLE_AFTER_MS - 100);
  const ge = gaps(early);
  check("just after data stops (within IDLE_AFTER_MS): a draw on every frame", ge.length > 40 && max(ge) <= VSYNC + EPS,
    `${early.length} draws, max gap ${max(ge).toFixed(1)} ms`);
}

// 4. Phone-like delivery: 40 ms hardware buffers cut into 25 ms chunks
// (1 or 2 points per buffer, notified back to back), 60 Hz display.
{
  const sim = makeSim();
  let carry = 0;
  for (let t = 40; t <= 10000; t += 40) {
    carry += 40;
    const n = Math.floor(carry / 25);
    carry -= n * 25;
    for (let k = 0; k < n; k++) sim.at(t, () => sim.sched.notify());
  }
  sim.runUntil(10000);
  const g = gaps(sim.draws);
  const rate = sim.draws.length / ((sim.draws.at(-1) - sim.draws[0]) / 1000);
  check("40 ms buffers: ~60 draws/s (not 25, one per buffer)", rate > 59 && rate < 61, `${rate.toFixed(1)} draws/s`);
  check("40 ms buffers: gaps <= 1 frame", max(g) <= VSYNC + EPS, `max ${max(g).toFixed(1)} ms`);
}

// 5. Fast displays: the loop draws at most every MIN_DRAW_MS.
for (const hz of [120, 144]) {
  const vs = 1000 / hz;
  const sim = makeSim(vs);
  feed25(sim, 0, 10000);
  sim.runUntil(10000);
  const g = gaps(sim.draws);
  const rate = sim.draws.length / ((sim.draws.at(-1) - sim.draws[0]) / 1000);
  check(`${hz} Hz display: no two draws closer than MIN_DRAW_MS`, min(g) >= MIN_DRAW_MS - EPS, `min gap ${min(g).toFixed(2)} ms`);
  check(`${hz} Hz display: no gap > MIN_DRAW_MS + 1 frame`, max(g) <= MIN_DRAW_MS + vs + EPS, `max gap ${max(g).toFixed(2)} ms`);
  check(`${hz} Hz display: ${hz === 120 ? "~60" : "~48"} draws/s`, hz === 120 ? rate > 59 && rate <= 60.5 : rate > 47 && rate < 49,
    `${rate.toFixed(1)} draws/s`);
}

// 6. Burst: 10 notifications at once draw once.
{
  const sim = makeSim();
  for (let k = 0; k < 10; k++) sim.at(5, () => sim.sched.notify());
  sim.runUntil(30);
  check("burst of 10 notifications: one draw", sim.draws.length === 1, `${sim.draws.length} draws`);
}

// 7. Hidden page: no frames run; requests don't pile up; one draw on show.
{
  const sim = makeSim();
  for (let t = 0; t < 500; t += 25) sim.at(t, () => sim.sched.notify());
  sim.runUntil(500);
  const before = sim.draws.length;
  sim.hidden = true;
  for (let t = 500; t < 3000; t += 25) sim.at(t, () => sim.sched.notify());
  sim.runUntil(3000);
  check("hidden: no draws", sim.draws.length === before, `${sim.draws.length - before} draws`);
  check("hidden: at most one pending frame", sim.frames.size <= 1, `${sim.frames.size} pending`);
  sim.hidden = false;
  sim.runUntil(3000 + VSYNC + 1);
  check("shown again: one draw on the next frame", sim.draws.length === before + 1, `${sim.draws.length - before} draws`);
}

// 8. stop(): nothing pending, nothing drawn afterwards.
{
  const sim = makeSim();
  sim.at(0, () => sim.sched.notify());
  sim.runUntil(100);
  sim.sched.notify();
  sim.sched.stop();
  const n = sim.draws.length;
  sim.runUntil(2000);
  check("stop(): frame and timer cancelled", sim.frames.size === 0 && sim.timers.size === 0, `${sim.frames.size} frames, ${sim.timers.size} timers`);
  check("stop(): no draws afterwards", sim.draws.length === n, `${sim.draws.length - n} draws`);
  sim.sched.notify();
  sim.sched.request();
  check("stop(): later requests ignored", sim.frames.size === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
