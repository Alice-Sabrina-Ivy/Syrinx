// takes.js — the lessons' recordings: a take recorder on the main thread and a small
// player (pure enough to test with fakes: tests/exercises/takes-test.js).
//
// Recorder: one extra capture consumer (Voice Shaper's capture handle, voice-preview/
// bridge.js) only while a take is being recorded — whole ~25 ms chunks copied into a
// buffer pre-allocated for maxS seconds at the capture rate; it stops itself before the
// chunk that would not fit. Nothing is analysed, and nothing leaves the page: the takes
// live in memory until the lesson closes (design §8: no audio is saved).
//
// Player: one AudioContext, made on the first Play press (a user gesture, as autoplay
// rules require), suspended while nothing plays and closed by close() (the lesson closes;
// closing, not suspending, lets the audio thread drop the last buffer — Voice Shaper's
// playback.js, verify step problem 1).

export const TAKE_MAX_S = 8;
/** A take shorter than this (e.g. Stop pressed at once) is dropped. */
export const TAKE_MIN_S = 0.5;

/**
 * Start recording from a capture handle ({ sampleRate, connect() -> MessagePort,
 * disconnect(port) }). Returns null without a handle, else { stop(), seconds() }.
 * onProgress(seconds) about every 100 ms of audio; onDone({ pcm, rate, seconds } | null)
 * once, when stopped (by stop(), the maxS limit, or abort()).
 */
export function recordTake(handle, { maxS = TAKE_MAX_S, onProgress = () => {}, onDone = () => {} } = {}) {
  if (!handle || !(handle.sampleRate > 0)) return null;
  const rate = handle.sampleRate;
  const buf = new Float32Array(Math.floor(maxS * rate));
  let fill = 0;
  let done = false;
  let lastProgress = 0;
  const port = handle.connect();

  function finish(keep) {
    if (done) return;
    done = true;
    port.onmessage = null;
    try { handle.disconnect(port); } catch { /* capture already closed */ }
    try { port.close(); } catch { /* already closed */ }
    const seconds = fill / rate;
    onDone(keep && seconds >= TAKE_MIN_S ? { pcm: buf.slice(0, fill), rate, seconds } : null);
  }

  port.onmessage = (e) => {
    const d = e.data;
    if (done || !d || !d.buffer) return;
    const x = d.buffer instanceof Float32Array ? d.buffer : new Float32Array(d.buffer);
    if (fill + x.length > buf.length) { finish(true); return; }
    buf.set(x, fill);
    fill += x.length;
    const s = fill / rate;
    if (s - lastProgress >= 0.0999) { lastProgress = s; onProgress(s); }
    // the next chunk of this size would not fit: stop now
    if (fill + x.length > buf.length) finish(true);
  };

  return {
    stop: () => finish(true),
    /** Listening stopped: keep what was recorded (if long enough). */
    abort: () => finish(true),
    seconds: () => fill / rate,
    get done() { return done; },
  };
}

/** A player for named takes ({ pcm, rate }); state { playing: name | null }. */
export function createTakePlayer({ createContext = () => new AudioContext() } = {}) {
  let ctx = null;
  let node = null;
  let playing = null;
  const listeners = new Set();
  let state = { playing: null };

  function emit() {
    state = { playing };
    for (const fn of listeners) fn(state);
  }

  function stopNode() {
    if (!node) return;
    const n = node;
    node = null;
    n.onended = null;
    try { n.stop(); } catch { /* not started */ }
    try { n.disconnect(); } catch { /* already */ }
  }

  function stop() {
    stopNode();
    playing = null;
    if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
    emit();
  }

  /** Play a take; pressing the playing one again stops it. Returns true if it started. */
  function play(name, take) {
    if (!take || !take.pcm || !take.pcm.length) return false;
    if (playing === name) { stop(); return false; }
    stopNode();
    if (!ctx) ctx = createContext();
    // a fresh AudioBuffer per press (an 8 s take copies in well under a millisecond), so
    // nothing of a replaced take is kept here
    const b = ctx.createBuffer(1, take.pcm.length, take.rate);
    b.copyToChannel(take.pcm, 0);
    const n = ctx.createBufferSource();
    n.buffer = b;
    n.connect(ctx.destination);
    n.onended = () => {
      if (node !== n) return;
      node = null;
      playing = null;
      if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
      emit();
    };
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    n.start(0);
    node = n;
    playing = name;
    emit();
    return true;
  }

  /** Stop and close the context (its audio thread and buffers go). The player can be used again (a new context). */
  function close() {
    stopNode();
    playing = null;
    if (ctx) {
      const c = ctx;
      ctx = null;
      c.close().catch(() => {});
    }
    emit();
  }

  return {
    subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    getState: () => state,
    play, stop, close,
  };
}
