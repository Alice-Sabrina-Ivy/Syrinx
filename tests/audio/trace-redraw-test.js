// trace-redraw-test.js — when the pitch trace redraws
// (src/components/traceRedrawScheduler.js;
// measurements/main-thread-cpu-2026-10-08.md §3 F1).
//
// A virtual clock with a 60 Hz display (animation frames on vsync ticks,
// none while "hidden") and timers drives the scheduler:
//   1. a steady 25 ms feed draws once per point, never from the fallback;
//   2. a feed that stalls redraws at least every FALLBACK_MS + 1 frame;
//   3. after the feed stops for IDLE_AFTER_MS the cadence is ~IDLE_FALLBACK_MS;
//   4. a phone-like feed (40 ms buffers, 1-2 points each) draws every 40 ms;
//   5. a burst of notifications draws once;
//   6. while hidden, requests do not pile up; one draw when shown;
//   7. stop() cancels the pending frame and the timer.
//
// Run: node tests/audio/trace-redraw-test.js

import {
  createTraceRedrawScheduler,
  FALLBACK_MS,
  IDLE_FALLBACK_MS,
  IDLE_AFTER_MS,
} from "../../src/components/traceRedrawScheduler.js";

let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++; else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const VSYNC = 1000 / 60;

function makeSim() {
  const sim = { t: 0, hidden: false, timers: new Map(), frames: new Map(), nextId: 1, draws: [], events: [] };
  sim.sched = createTraceRedrawScheduler({
    draw: () => sim.draws.push(sim.t),
    requestFrame: (cb) => { const id = sim.nextId++; sim.frames.set(id, cb); return id; },
    cancelFrame: (id) => { sim.frames.delete(id); },
    setTimer: (fn, ms) => { const id = sim.nextId++; sim.timers.set(id, { at: sim.t + ms, fn }); return id; },
    clearTimer: (id) => { sim.timers.delete(id); },
    now: () => sim.t,
  });
  // Scheduled external events (data notifications), sorted by time.
  sim.at = (t, fn) => sim.events.push({ t, fn });
  sim.runUntil = (end) => {
    sim.events.sort((a, b) => a.t - b.t);
    let nextVsync = Math.ceil(sim.t / VSYNC + 1e-9) * VSYNC;
    for (;;) {
      const ev = sim.events[0]?.t ?? Infinity;
      let tm = Infinity, tmId = null;
      for (const [id, x] of sim.timers) if (x.at < tm) { tm = x.at; tmId = id; }
      const t = Math.min(ev, tm, nextVsync);
      if (t > end) { sim.t = end; return; }
      sim.t = t;
      if (t === ev) { sim.events.shift().fn(); continue; }
      if (t === tm) { const x = sim.timers.get(tmId); sim.timers.delete(tmId); x.fn(); continue; }
      nextVsync += VSYNC;
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

// 1. Steady 25 ms feed for 10 s: one draw per point, no fallback draws.
{
  const sim = makeSim();
  for (let t = 0; t < 10000; t += 25) sim.at(t, () => sim.sched.notify());
  sim.runUntil(10000);
  const n = sim.draws.length;
  check("steady 25 ms feed: one draw per point (400 points)", n === 400, `${n} draws`);
  check("steady 25 ms feed: longest gap between draws <= 25 ms + 1 frame", max(gaps(sim.draws)) <= 25 + VSYNC + 1e-9,
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
  check(`stalled feed: longest gap between draws <= FALLBACK_MS (${FALLBACK_MS}) + 1 frame`, mg <= FALLBACK_MS + VSYNC + 1e-9,
    `max ${mg.toFixed(1)} ms`);
  check("stalled feed: longest gap <= 100 ms (guard 3c)", mg <= 100, `max ${mg.toFixed(1)} ms`);
}

// 3. Idle: notifications stop; after IDLE_AFTER_MS the cadence is ~IDLE_FALLBACK_MS.
{
  const sim = makeSim();
  for (let t = 0; t < 1000; t += 25) sim.at(t, () => sim.sched.notify());
  sim.runUntil(6000);
  const late = sim.draws.filter((x) => x > 1000 + IDLE_AFTER_MS + 200);
  const g = gaps(late);
  const ok = g.length > 10 && g.every((x) => x >= IDLE_FALLBACK_MS - 1e-9 && x <= IDLE_FALLBACK_MS + VSYNC + 1e-9);
  check(`idle: redraws every ${IDLE_FALLBACK_MS} ms + <= 1 frame`, ok,
    `${late.length} draws, gaps ${Math.min(...g).toFixed(1)}–${max(g).toFixed(1)} ms`);
  const early = sim.draws.filter((x) => x > 1000 && x < 1000 + IDLE_AFTER_MS - 100);
  const ge = gaps(early);
  check(`just after data stops: redraws every ${FALLBACK_MS} ms + <= 1 frame`, ge.length > 5 && max(ge) <= FALLBACK_MS + VSYNC + 1e-9,
    `max ${max(ge).toFixed(1)} ms`);
}

// 4. Phone-like delivery: 40 ms hardware buffers cut into 25 ms chunks
// (1 or 2 points per buffer, notified back to back).
{
  const sim = makeSim();
  let carry = 0;
  for (let t = 40; t <= 10000; t += 40) {
    carry += 40;
    const n = Math.floor(carry / 25);
    carry -= n * 25;
    for (let k = 0; k < n; k++) sim.at(t, () => sim.sched.notify());
  }
  sim.runUntil(10000 + VSYNC + 1);
  const g = gaps(sim.draws);
  check("40 ms buffers: one draw per buffer (250)", sim.draws.length === 250, `${sim.draws.length} draws`);
  check("40 ms buffers: gaps <= 40 ms + 1 frame, no fallback draws", max(g) <= 40 + VSYNC + 1e-9, `max ${max(g).toFixed(1)} ms`);
}

// 5. Burst: 10 notifications at once draw once.
{
  const sim = makeSim();
  for (let k = 0; k < 10; k++) sim.at(5, () => sim.sched.notify());
  sim.runUntil(30);
  check("burst of 10 notifications: one draw", sim.draws.length === 1, `${sim.draws.length} draws`);
}

// 6. Hidden page: no frames run; requests don't pile up; one draw on show.
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

// 7. stop(): nothing pending, nothing drawn afterwards.
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
