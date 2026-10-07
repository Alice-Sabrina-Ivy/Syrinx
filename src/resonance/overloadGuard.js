// overloadGuard.js — the resonance worker's CPU guard (pure; unit-tested in
// tests/resonance/overload-guard-test.js).
//
// Judges the worker's own busy time per second of audio over a TRAILING
// window of audio (windowS), never from the start-up chunks: the first
// warmupS of audio (JIT warm-up, first buffer allocations — in Node the first
// chunk costs ~2.5× the steady rate) are not counted at all. Until the
// window holds minJudgeS of audio nothing is judged.
//
// Above overMsPerS the guard says "overloaded": the worker stops doing vtln
// work for a back-off of backoffS of audio (doubling on each repeat, up to
// maxBackoffS), then "resume" — the worker starts a fresh engine and the
// guard warms up again. So a transient spike (thermal throttling, a busy
// moment) costs the cue a pause, never the whole session.
//
// 2026-10-07 review: the first version seeded an EMA (τ 10 s) with the
// coldest chunk and latched "overloaded" for good — on a phone a first chunk
// of ~17 ms could switch the cue off for the session.

export const OVERLOAD_DEFAULTS = Object.freeze({
  warmupS: 3,
  windowS: 10,
  minJudgeS: 5,
  overMsPerS: 500,
  backoffS: 20,
  maxBackoffS: 160,
});

export function createOverloadGuard(opts = {}) {
  const C = { ...OVERLOAD_DEFAULTS, ...opts };
  let audioS = 0;          // audio seen since the last (re)start
  let win = [];            // [{ ms, s }] after warm-up, trailing windowS of audio
  let winMs = 0, winS = 0;
  let pausedLeftS = 0;     // > 0 while backing off
  let backoff = C.backoffS;
  let overloads = 0;

  function restart() {
    audioS = 0; win = []; winMs = 0; winS = 0;
  }

  return {
    /**
     * One processed chunk: busy ms and the chunk's audio seconds.
     * -> "ok" | "overloaded" (just tripped) | "paused" | "resume" (back-off over)
     */
    add(ms, s) {
      if (!(s > 0)) return pausedLeftS > 0 ? "paused" : "ok";
      if (pausedLeftS > 0) {
        pausedLeftS -= s;
        if (pausedLeftS > 0) return "paused";
        pausedLeftS = 0;
        restart();
        return "resume";
      }
      audioS += s;
      if (audioS <= C.warmupS) return "ok";
      win.push({ ms, s }); winMs += ms; winS += s;
      while (win.length > 1 && winS - win[0].s >= C.windowS) { const o = win.shift(); winMs -= o.ms; winS -= o.s; }
      if (winS < C.minJudgeS) return "ok";
      if (winMs / winS > C.overMsPerS) {
        overloads++;
        pausedLeftS = backoff;
        backoff = Math.min(C.maxBackoffS, backoff * 2);
        return "overloaded";
      }
      return "ok";
    },
    /** Mean busy ms per audio second over the trailing window (null before warm-up ends). */
    rate() { return winS > 0 ? winMs / winS : null; },
    overloads: () => overloads,
    paused: () => pausedLeftS > 0,
  };
}
