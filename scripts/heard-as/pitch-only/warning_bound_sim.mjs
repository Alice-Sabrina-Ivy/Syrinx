// warning_bound_sim.mjs — a deterministic simulated listening session for the
// pitch-only warning's memory / CPU checks (measurements/heard-as-pitch-only-
// warning-2026-10-07.md §8.9 (c), (d), (f) 3). Pure (no Node or DOM APIs):
// used by warning_bound.mjs in Node and in Chrome, and by
// tests/ml/pitch-only-warning-test.js.
//
// The session, as the hook and the panel call the module:
//   - a posted pitch frame every 25 ms (addPitch), speech-like voicing: voiced
//     runs of 100-500 ms between 40-200 ms gaps and a 0.5-2 s pause every
//     5-10 s (about 60 % of frames voiced), pitch 120 Hz +- a slow drift and
//     a per-run step;
//   - a resonance-cue state every 200 ms (noteResonance) with fill reaching
//     1 at `fillMs` (t_fill, default 10 s) and startU set from `startMs`
//     (t_start, default 30 s; null = never), verdict "score";
//   - panel updates every 2 s (update) from `panelOnMs` (null = the panel is
//     off throughout), with the panel's own estimate from the last 8 s of
//     voiced frames (hidden below 3 s voiced) and a drawn share near 0.3.
//
//   buildSession({ hours, seed, fillMs, startMs }) -> { n, t, f0, voicedFrac, ... }
//   eventsFor(session, { panelOnMs }) -> Int32Array of call codes (see `drive`)
//   drive(w, session, events, onCall?, clock?) -> { on, updates } (+ per-call times with a clock)

const FRAME_MS = 25, RES_EVERY = 8, UPDATE_MS = 2000;

/** The frames of an `hours`-long session (deterministic for a given seed). */
export function buildSession({ hours = 1, seed = 1, fillMs = 10000, startMs = 30000, startU = 0.2 } = {}) {
  const n = Math.round((hours * 3600 * 1000) / FRAME_MS);
  const t = new Float64Array(n), f0 = new Float64Array(n);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  let i = 0, voicedN = 0, nextPause = 5000 + rnd() * 5000, stepSt = 0;
  while (i < n) {
    const tm = (i + 1) * FRAME_MS;
    if (tm >= nextPause) {                               // a pause between phrases
      const len = Math.round((500 + rnd() * 1500) / FRAME_MS);
      for (let k = 0; k < len && i < n; k++, i++) { t[i] = (i + 1) * FRAME_MS; f0[i] = 0; }
      nextPause = (i + 1) * FRAME_MS + 5000 + rnd() * 5000;
      continue;
    }
    const vLen = Math.round((100 + rnd() * 400) / FRAME_MS), gLen = Math.round((40 + rnd() * 160) / FRAME_MS);
    stepSt = (rnd() - 0.5) * 3;
    for (let k = 0; k < vLen && i < n; k++, i++) {
      const tt = (i + 1) * FRAME_MS;
      const st = 1.5 * Math.sin((2 * Math.PI * tt) / 47000) + stepSt + (rnd() - 0.5) * 0.4;
      t[i] = tt; f0[i] = 120 * 2 ** (st / 12); voicedN++;
    }
    for (let k = 0; k < gLen && i < n; k++, i++) { t[i] = (i + 1) * FRAME_MS; f0[i] = 0; }
  }
  return { n, t, f0, voicedFrac: voicedN / n, fillMs, startMs, startU, hours };
}

// Call codes: >= 0 frame index (addPitch), -1 resonance state (for the frame before it), -2 panel update.
/** The call sequence: each frame, then (every 200 ms) the resonance state, then (every 2 s while the panel is on) the
 *  panel update, all at that frame's audio time. */
export function eventsFor(S, { panelOnMs = null } = {}) {
  const ev = [];
  for (let i = 0; i < S.n; i++) {
    ev.push(i);
    if ((i + 1) % RES_EVERY === 0) ev.push(-1);
    if (panelOnMs !== null && S.t[i] >= panelOnMs && S.t[i] % UPDATE_MS === 0) ev.push(-2);
  }
  return Int32Array.from(ev);
}

/** The resonance-cue snapshot at audio time tm. */
export function snapshotAt(S, tm) {
  const fill = Math.min(1, tm / S.fillMs);
  const started = S.startMs !== null && tm >= S.startMs;
  return { type: "state", u: S.startU + 0.05 * Math.sin(tm / 3000), startU: started ? S.startU : null, fill,
    verdict: "score", sinceResumeS: tm / 1000 };
}

/** Feeds the calls to warning w; onCall(kind, i) after each call ("p" / "r" / "u", the frame index). With `clock`
 *  (a now() in ms) each call is timed: -> also { ms: { p, r, u }, maxMs: { p, r, u } }. */
export function drive(w, S, ev, onCall = null, clock = null) {
  let res = null, on = 0, updates = 0, last = -1;
  const scratch = new Float64Array(400);
  const ms = { p: 0, r: 0, u: 0 }, maxMs = { p: 0, r: 0, u: 0 };
  let t0 = 0;
  for (let k = 0; k < ev.length; k++) {
    const c = ev[k];
    if (c >= 0) {
      const a = { audioMs: S.t[c], f0: S.f0[c] > 0 ? S.f0[c] : null };
      if (clock) t0 = clock();
      w.addPitch(a);
      if (clock) { const d = clock() - t0; ms.p += d; if (d > maxMs.p) maxMs.p = d; }
      last = c;
      if (onCall) onCall("p", c);
    } else if (c === -1) {
      res = snapshotAt(S, S.t[last]);
      if (clock) t0 = clock();
      w.noteResonance(res, S.t[last]);
      if (clock) { const d = clock() - t0; ms.r += d; if (d > maxMs.r) maxMs.r = d; }
      if (onCall) onCall("r", last);
    } else {
      // the panel's estimate: ln median of the voiced frames in the last 8 s, hidden below 3 s voiced
      const tm = S.t[last];
      let m = 0;
      for (let j = last; j >= 0 && S.t[j] > tm - 8000; j--) if (S.f0[j] > 0) scratch[m++] = S.f0[j];
      let lnF0 = null, share = null;
      if (m * FRAME_MS >= 3000) {
        const q = scratch.subarray(0, m).sort(), h = m >> 1;
        lnF0 = Math.log(m % 2 ? q[h] : (q[h - 1] + q[h]) / 2);
        share = 0.3 + 0.08 * Math.sin(tm / 11000);
      }
      const a = { lnF0, resonance: res, share, audioMs: tm };
      if (clock) t0 = clock();
      const o = w.update(a);
      if (clock) { const d = clock() - t0; ms.u += d; if (d > maxMs.u) maxMs.u = d; }
      if (o) on++;
      updates++;
      if (onCall) onCall("u", last);
    }
  }
  return clock ? { on, updates, ms, maxMs } : { on, updates };
}

/** The three panel scenarios of §8.9 (c). */
export const SCENARIOS = Object.freeze({
  off: { panelOnMs: null },
  on0: { panelOnMs: 0 },
  on30min: { panelOnMs: 30 * 60 * 1000 },
});
