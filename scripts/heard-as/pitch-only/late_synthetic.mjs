// late_synthetic.mjs — deterministic synthetic sessions for the pitch-only
// warning's late-switch-on path (measurements/heard-as-pitch-only-warning-
// 2026-10-07.md §8.9 (f) 2 (ii)). Pure; used by make_fixture_late.mjs, which
// computes each case's expected values with the round-2 harness's KS-Q5
// variant, and by tests/ml/pitch-only-warning-test.js, which replays them.
//
// A case is a steady voice (120 Hz, u = startU = 0.2) with:
//   a posted pitch frame every 25 ms; a resonance state every 200 ms (fill
//   ramps to 1 at fillMs = t_fill, startU set from startMs = t_start, verdict
//   "score", or "sustained" inside `held`); a pitch-only shift of shiftSt
//   semitones from shiftMs (the drawn share moves shareBefore -> shareAfter);
//   panel updates every 2 s of audio time from panelOnMs, at the frame's
//   time, after the frame and the resonance state; the panel shows the
//   current pitch, and is hidden (lnF0 null) inside `hidden` and `held`.
//   `restart`: the resonance cue restarts at atMs (startU back to null, fill
//   from 0), fills at fillMs and sets its start at startMs. `heldSt`: the
//   held notes' pitch (semitones from 120 Hz).
//
//   callsFor(case) -> [["p", audioMs, f0 | null], ["r", snapshot, audioMs], ["u", lnF0, share, audioMs], ...]
//   play(w, calls) -> { on, held, p0 } (on / held as "0"/"1" strings, p0 = pitchStart() before each update)

const BASE = { endMs: 100000, fillMs: 10000, startMs: 20000, shiftMs: 60000, shiftSt: 8, shareBefore: 0.2, shareAfter: 0.6,
  panelOnMs: 0, hidden: [], held: [], heldSt: 5, restart: null };

export const LATE_CASES = Object.freeze({
  // §8.6's repro: on from 0, 10 or 19 s the panel gets a start share (first warning at 62 s, as shipped); on from
  // 22 or 30 s it does not (the shipped rule never warns; KS-Q5 does).
  repro_on0: { panelOnMs: 0 },
  repro_on10: { panelOnMs: 10000 },
  repro_on19: { panelOnMs: 19000 },
  repro_on22: { panelOnMs: 22000 },
  repro_on30: { panelOnMs: 30000 },
  // Switched on late, then the cue restarts: the panel is shown through the new start window (normal path) …
  late_restart: { panelOnMs: 30000, endMs: 160000, shiftMs: 130000, restart: { atMs: 80000, fillMs: 85000, startMs: 95000 } },
  // … or hidden through it (the trigger holds again; the K-seed is rebuilt from the frames after the restart).
  late_restart_hidden: { panelOnMs: 30000, endMs: 160000, shiftMs: 130000, restart: { atMs: 80000, fillMs: 85000, startMs: 95000 },
    hidden: [[80000, 100000]] },
  // Switched on during held notes (verdict "sustained", panel hidden), speech after them.
  late_held: { panelOnMs: 50000, endMs: 140000, shiftMs: 110000, held: [[40000, 70000]] },
  // The shift lands at the end of Q5's 20 s window (fbT0 = 30 s): sensitive to the window length.
  q5_edge: { panelOnMs: 30000, shiftMs: 50000 },
  // Only 4 quiet shares by the window end (hidden 38-52 s), the shift from 52 s: the window never gets its 5th.
  q5_four: { panelOnMs: 30000, shiftMs: 52000, hidden: [[38000, 52000]] },
  // On from the start but hidden (still loading) through the start window: the limit that remains — no warning.
  early_hidden: { panelOnMs: 0, hidden: [[0, 40000]] },
});

const inAny = (t, xs) => xs.some(([a, b]) => t >= a && t < b);

export function callsFor(spec) {
  const c = { ...BASE, ...spec };
  const calls = [];
  for (let t = 25; t <= c.endMs; t += 25) {
    const held = inAny(t, c.held);
    const st = held ? c.heldSt : t >= c.shiftMs ? c.shiftSt : 0;
    const f0 = 120 * 2 ** (st / 12);
    calls.push(["p", t, f0]);
    if (t % 200 === 0) {
      let fill, startU;
      if (c.restart && t >= c.restart.atMs) {
        fill = Math.min(1, (t - c.restart.atMs) / (c.restart.fillMs - c.restart.atMs));
        startU = t >= c.restart.startMs ? 0.2 : null;
      } else {
        fill = Math.min(1, t / c.fillMs);
        startU = t >= c.startMs ? 0.2 : null;
      }
      const since = (c.restart && t >= c.restart.atMs ? t - c.restart.atMs : t) / 1000;
      calls.push(["r", { type: "state", u: 0.2, startU, fill, verdict: held ? "sustained" : "score", sinceResumeS: since }, t]);
    }
    if (t % 2000 === 0 && t >= c.panelOnMs) {
      const hidden = held || inAny(t, c.hidden);
      calls.push(["u", hidden ? null : Math.log(f0), hidden ? null : t >= c.shiftMs ? c.shareAfter : c.shareBefore, t]);
    }
  }
  return calls;
}

export function play(w, calls) {
  let res = null;
  const on = [], held = [], p0 = [];
  for (const k of calls) {
    if (k[0] === "p") w.addPitch({ audioMs: k[1], f0: k[2] > 0 ? k[2] : null });
    else if (k[0] === "r") { res = k[1]; w.noteResonance(res, k[2]); }
    else {
      p0.push(w.pitchStart());
      on.push(w.update({ lnF0: k[1], resonance: res, share: k[2], audioMs: k[3] }) ? "1" : "0");
      held.push(w.held() ? "1" : "0");
    }
  }
  return { on: on.join(""), held: held.join(""), p0 };
}
