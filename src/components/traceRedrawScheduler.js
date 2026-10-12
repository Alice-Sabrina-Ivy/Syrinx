// traceRedrawScheduler.js — when the pitch trace redraws
// (measurements/phone-cpu-2026-10-12.md §4; history in
// measurements/main-thread-cpu-2026-10-08.md §1 K2, §3 F1).
//
// While data is arriving (a notification within the last IDLE_AFTER_MS) the
// trace runs an animation-frame loop and draws at most every MIN_DRAW_MS
// (~60 Hz: every display frame at 60 Hz, every other one at 120 Hz). A
// stalled feed therefore keeps scrolling every display frame — no freeze
// longer than MIN_DRAW_MS plus a frame, inside the review fix's bound of
// FALLBACK_MS plus a frame (guard 3c: gap <= 100 ms). After the feed has
// stopped for IDLE_AFTER_MS the loop ends and an idle trace redraws every
// IDLE_FALLBACK_MS.
//
// Adopted 2026-10-12 by user decision over the data-driven redraw (one draw
// per appended point, 2026-10-08): on a phone that delivers audio in 40 ms
// frames that cadence is ~25 draws/s (guard 3c p99 52 ms); this loop draws
// ~53/s there, at ~+27 % main-thread CPU on the phone.
//
// Pure scheduling logic with injected timers so tests/audio/trace-redraw-test.js
// can drive it in Node.

// Stall bound kept from the 2026-10-08 review fix (F1): no freeze while
// listening may exceed FALLBACK_MS plus one display frame (the unit test's
// guard; the loop below stays far inside it).
export const FALLBACK_MS = 50;
export const IDLE_FALLBACK_MS = 100;
export const IDLE_AFTER_MS = 1000;
export const MIN_DRAW_MS = 16;

export function createTraceRedrawScheduler({
  draw,
  requestFrame = (cb) => requestAnimationFrame(cb),
  cancelFrame = (id) => cancelAnimationFrame(id),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  now = () => performance.now(),
  idleFallbackMs = IDLE_FALLBACK_MS,
  idleAfterMs = IDLE_AFTER_MS,
}) {
  let frameId = null;
  let timer = null;
  let lastNotifyAt = -Infinity;
  let lastDrawAt = -Infinity;
  let stopped = false;

  function frame() {
    frameId = null;
    if (stopped) return;
    const t = now();
    const listening = t - lastNotifyAt < idleAfterMs;
    if (!listening || t - lastDrawAt >= MIN_DRAW_MS) {
      draw();
      lastDrawAt = t;
    }
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (listening) request();
    else timer = setTimer(() => { timer = null; request(); }, idleFallbackMs);
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
