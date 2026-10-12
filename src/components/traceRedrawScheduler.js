// traceRedrawScheduler.js — when the pitch trace redraws
// (measurements/phone-cpu-2026-10-12.md §4; history in
// measurements/main-thread-cpu-2026-10-08.md §1 K2, §3 F1).
//
// While data is arriving (a notification within the last IDLE_AFTER_MS) the
// trace runs an animation-frame loop and draws when at least MIN_DRAW_MS have
// passed since its last draw, measured with now() (performance.now()) inside
// the frame callback. A 60 Hz frame is 16.67 ms, so the gate has 0.67 ms of
// slack: with a jitter-free clock it draws every frame at 60 Hz and every
// other frame at 120 Hz, but when a callback runs late (jitter J) the next
// frame can measure < 16 ms and skip, doubling that gap. On the phone
// (measurements/phone-cpu-2026-10-12.md §3.1, §4) ~12 % of gaps were doubled,
// ~53 draws/s, gap p99 34 ms. A 90 Hz display draws every other frame (45/s),
// 144 Hz every third (48/s). Stall bound: a feed that stalls keeps the loop
// running, so no freeze exceeds MIN_DRAW_MS + J + one frame (60 Hz, J < 1
// frame: two frames, 33 ms; 120 Hz, J 2 ms: 25 ms), inside the 2026-10-08
// review fix's 50 ms + one frame and guard 3c (gap <= 100 ms). After the feed
// has stopped for IDLE_AFTER_MS the loop ends and an idle trace redraws every
// IDLE_FALLBACK_MS.
//
// Adopted 2026-10-12 by user decision over the data-driven redraw (one draw
// per appended point, 2026-10-08): on a phone that delivers audio in 40 ms
// frames that cadence is ~25 draws/s (guard 3c p99 52 ms); this loop draws
// ~53/s there, at ~+27 % main-thread CPU on the phone. Gating on the frame
// timestamp instead of now() would draw every 60 Hz frame (~60/s on the
// phone, more draws than the user priced) — not adopted without a phone
// re-measure.
//
// Pure scheduling logic with injected timers so tests/audio/trace-redraw-test.js
// can drive it in Node (that test also holds the 50 ms stall bound as its
// guard; no code path here schedules a 50 ms timeout any more).

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
