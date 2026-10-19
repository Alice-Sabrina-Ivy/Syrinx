// traceRedrawScheduler.js — when the pitch trace redraws
// (measurements/phone-cpu-2026-10-12.md §4, §7; history in
// measurements/main-thread-cpu-2026-10-08.md §1 K2, §3 F1).
//
// While data is arriving (a notification within the last IDLE_AFTER_MS) the
// trace runs an animation-frame loop and draws when the frame's timestamp
// (the requestAnimationFrame argument: the same for every callback in a
// frame, tied to the display frame, not to when the callback ran) is at least
// MIN_DRAW_MS - DRAW_TOLERANCE_MS = 15 ms past the last draw's. Callback
// jitter therefore no longer skips frames (gating on performance.now() inside
// the callback, as before 2026-10-12 §7, left 0.67 ms of slack at 60 Hz and
// doubled ~12 % of the phone's gaps: ~53 draws/s, gap p99 34 ms). With 15 ms:
// 60 Hz draws every frame (1.67 ms of margin for frame-timestamp noise),
// 120 Hz every other frame (60/s), 144 Hz every third (48/s), 180 Hz every
// third (60/s), 90 Hz every other (45/s); no display exceeds 1000/15 = 66.7
// draws/s. Stall bound: a feed that stalls keeps the loop running, so no
// freeze exceeds 15 ms + one frame, inside the 2026-10-08 review fix's 50 ms
// + one frame and guard 3c (gap <= 100 ms). After the feed has stopped for
// IDLE_AFTER_MS the loop ends and an idle trace redraws every
// IDLE_FALLBACK_MS. If a caller passes no timestamp, now() is used. A frame
// timestamp below the last draw's (a clock that went backwards: a polyfill or
// an injected requestFrame on another time base; conforming browsers pass
// monotonic timestamps) draws and resyncs, so the trace never waits for the
// clock to catch up (§7.5).
//
// draw(frameTs, skipped) receives the timestamp the gate compared and the
// number of frame callbacks since the previous draw that drew nothing; the
// diag records both (diag.noteTraceDraw: frame-timestamp gaps and the loop's
// frame rate, §7.3 amendment). PitchTrace's draw ignores them otherwise.
//
// Pure scheduling logic with injected timers so tests/audio/trace-redraw-test.js
// can drive it in Node (that test also holds the 50 ms stall bound as its
// guard; no code path here schedules a 50 ms timeout any more).

export const IDLE_FALLBACK_MS = 100;
export const IDLE_AFTER_MS = 1000;
export const MIN_DRAW_MS = 16;
export const DRAW_TOLERANCE_MS = 1;

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
  let lastDrawTs = -Infinity;
  let skipped = 0;
  let stopped = false;
  const gateMs = MIN_DRAW_MS - DRAW_TOLERANCE_MS;

  function frame(frameTs) {
    frameId = null;
    if (stopped) return;
    const t = now();
    const ts = typeof frameTs === "number" && Number.isFinite(frameTs) ? frameTs : t;
    const listening = t - lastNotifyAt < idleAfterMs;
    const dt = ts - lastDrawTs;
    if (!listening || dt >= gateMs || dt < 0) {
      draw(ts, skipped);
      lastDrawTs = ts;
      skipped = 0;
    } else {
      skipped++;
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
