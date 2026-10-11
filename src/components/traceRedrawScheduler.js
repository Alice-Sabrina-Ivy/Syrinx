// traceRedrawScheduler.js — when the pitch trace redraws
// (measurements/main-thread-cpu-2026-10-08.md §1 K2, §3 F1).
//
// The trace draws when the hook appends a point (notify(): one animation
// frame per burst of notifications), not on every display frame. A timeout
// re-armed after every draw keeps it scrolling when data is late or has
// stopped: FALLBACK_MS while data is arriving (a notification within the
// last IDLE_AFTER_MS), IDLE_FALLBACK_MS otherwise — so a stalled feed still
// redraws at least every ~50 ms plus one display frame (guard 3c: gap
// <= 100 ms), and an idle trace about every 100 ms. On a 25 ms feed the
// timeout never fires (each draw re-arms it), so it adds no draws.
//
// Pure scheduling logic with injected timers so tests/audio/trace-redraw-test.js
// can drive it in Node.

export const FALLBACK_MS = 50;
export const IDLE_FALLBACK_MS = 100;
export const IDLE_AFTER_MS = 1000;

export function createTraceRedrawScheduler({
  draw,
  requestFrame = (cb) => requestAnimationFrame(cb),
  cancelFrame = (id) => cancelAnimationFrame(id),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  now = () => performance.now(),
  fallbackMs = FALLBACK_MS,
  idleFallbackMs = IDLE_FALLBACK_MS,
  idleAfterMs = IDLE_AFTER_MS,
}) {
  let frameId = null;
  let timer = null;
  let lastNotifyAt = -Infinity;
  let stopped = false;

  function arm() {
    if (timer !== null) clearTimer(timer);
    const delay = now() - lastNotifyAt < idleAfterMs ? fallbackMs : idleFallbackMs;
    timer = setTimer(onTimer, delay);
  }
  function onTimer() {
    timer = null;
    request();
  }
  function frame() {
    frameId = null;
    if (stopped) return;
    draw();
    arm();
  }
  // At most one pending frame: a burst of requests draws once. While the
  // page is hidden the frame stays pending (no duplicates pile up) and
  // draws when it is shown again.
  function request() {
    if (stopped || frameId !== null) return;
    frameId = requestFrame(frame);
  }
  function notify() {
    lastNotifyAt = now();
    request();
  }
  function stop() {
    stopped = true;
    if (frameId !== null) cancelFrame(frameId);
    if (timer !== null) clearTimer(timer);
    frameId = null;
    timer = null;
  }
  return { notify, request, stop };
}
