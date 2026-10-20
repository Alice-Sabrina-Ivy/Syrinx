// playback.js — the voice preview's three-way playback (preview / unchanged rebuild /
// original) with loop. measurements/voice-preview-phase1-2026-10-19.md §8.
//
// One AudioContext, created on the first Play press (a user gesture, as autoplay rules
// require), suspended whenever nothing plays, closed by close() (page hide). Each version
// is an AudioBuffer at its own rate (original: capture rate; rebuild and preview: engine
// rate) played through an AudioBufferSourceNode; the versions have the same duration and
// RMS (the engine's finish step), so switching keeps the position and the loudness.
//
//   setSource(which, { pcm, rate } | null)  a version's samples (the AudioBuffer is made on
//                                          first play); a new preview arriving while the
//                                          preview plays takes over at the same position
//   play(which)   start it (from the current position if another version plays; from the
//                 start otherwise); pressing the playing version again stops it
//   stop(), setLoop(on), clear() (stop + drop every version), close()
//   subscribe(fn) -> unsubscribe; state { playing, loop, audio (context state | null) }

export const VERSIONS = Object.freeze(["preview", "rebuild", "original"]);

export function createPlayback({ createContext = () => new AudioContext() } = {}) {
  let ctx = null;
  const sources = { preview: null, rebuild: null, original: null }; // { pcm, rate, buffer }
  let node = null;
  let playing = null;
  let loop = false;
  let offset0 = 0;   // position (s) at startedAt
  let startedAt = 0; // ctx.currentTime when the node started or the loop was toggled
  let state = { playing: null, loop: false, audio: null };
  const listeners = new Set();

  function emit() {
    state = { playing, loop, audio: ctx ? ctx.state : null };
    for (const fn of listeners) fn(state);
  }

  function ensureContext() {
    if (ctx) return ctx;
    ctx = createContext();
    ctx.onstatechange = () => emit();
    return ctx;
  }

  function bufferFor(which) {
    const s = sources[which];
    if (!s) return null;
    if (!s.buffer) {
      const b = ctx.createBuffer(1, s.pcm.length, s.rate);
      b.copyToChannel(s.pcm, 0);
      s.buffer = b;
    }
    return s.buffer;
  }

  /** Seconds into the version that plays now. */
  function position() {
    if (!node || !ctx) return 0;
    const d = node.buffer.duration;
    const p = offset0 + Math.max(0, ctx.currentTime - startedAt);
    return loop ? p % d : Math.min(p, d);
  }

  function stopNode() {
    if (!node) return;
    const n = node;
    node = null;
    n.onended = null;
    try { n.stop(); } catch { /* not started / already stopped */ }
    try { n.disconnect(); } catch { /* already disconnected */ }
  }

  function suspendIfIdle() {
    if (ctx && !node && ctx.state === "running") ctx.suspend().catch(() => {});
  }

  function startNode(which, at) {
    const buf = bufferFor(which);
    const n = ctx.createBufferSource();
    n.buffer = buf;
    n.loop = loop;
    n.connect(ctx.destination);
    const off = at > 0 && at < buf.duration - 0.01 ? at : 0;
    n.onended = () => {
      if (node !== n) return;
      node = null;
      playing = null;
      suspendIfIdle();
      emit();
    };
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    n.start(0, off);
    node = n;
    playing = which;
    offset0 = off;
    startedAt = ctx.currentTime;
  }

  function stop() {
    stopNode();
    playing = null;
    suspendIfIdle();
    emit();
  }

  function play(which) {
    if (!sources[which]) return false;
    if (playing === which) { stop(); return false; }
    ensureContext();
    const at = playing ? position() : 0;
    stopNode();
    startNode(which, at);
    emit();
    return true;
  }

  function setSource(which, src) {
    const had = sources[which];
    sources[which] = src ? { pcm: src.pcm, rate: src.rate, buffer: null } : null;
    if (playing !== which || !had) return;
    if (!src) { stop(); return; }
    const at = position();
    stopNode();
    startNode(which, at);
    emit();
  }

  function setLoop(on) {
    on = !!on;
    if (on === loop) return;
    if (node) {
      offset0 = position();
      startedAt = ctx.currentTime;
      node.loop = on;
    }
    loop = on;
    emit();
  }

  function clear() {
    stopNode();
    playing = null;
    for (const k of VERSIONS) sources[k] = null;
    suspendIfIdle();
    emit();
  }

  function close() {
    stopNode();
    playing = null;
    for (const k of VERSIONS) sources[k] = null;
    if (ctx) {
      const c = ctx;
      ctx = null;
      c.onstatechange = null;
      c.close().catch(() => {});
    }
    emit();
  }

  return {
    subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    getState: () => state,
    has: (which) => !!sources[which],
    position,
    play, stop, setSource, setLoop, clear, close,
  };
}
