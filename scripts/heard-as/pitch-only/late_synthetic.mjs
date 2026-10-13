// late_synthetic.mjs — deterministic synthetic sessions for the pitch-only
// warning's late-switch-on path (measurements/heard-as-pitch-only-warning-
// 2026-10-07.md §8.9 (f) 2 (ii)). Pure; used by make_fixture_late.mjs, which
// computes each case's expected values with the round-2 harness's KS-Q5
// variant, and by tests/ml/pitch-only-warning-test.js, which replays them.
// The seed_* cases (§8.9 review fixes) each make one K-seed rule change the
// output: the panel is off until 100 s (late), so the warning's threshold
// after the shift depends on what the background seed put in KP8's history.
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
//   held notes' pitch (semitones from 120 Hz). `frames`: posted-frame
//   segments [fromMs, toMs, kind, st] overriding the frames above (not the
//   panel's estimate or the verdict): kind "v" = voiced at st semitones,
//   "u" = unvoiced (f0 null), "x" = no frame posted (a stall); the first
//   segment covering a frame time wins.
//
//   callsFor(case) -> [["p", audioMs, f0 | null], ["r", snapshot, audioMs], ["u", lnF0, share, audioMs], ...]
//   play(w, calls) -> { on, held, p0 } (on / held as "0"/"1" strings, p0 = pitchStart() before each update)

const BASE = { endMs: 100000, fillMs: 10000, startMs: 20000, shiftMs: 60000, shiftSt: 8, shareBefore: 0.2, shareAfter: 0.6,
  panelOnMs: 0, hidden: [], held: [], heldSt: 5, restart: null, frames: [] };

// Voiced at st for the first `on` ms of every `period` ms in [from, to), unvoiced otherwise (a sparse reference
// voice: no 8 s window holds the 3 s of voicing a seed pseudo update needs).
function refBursts(from, to, st = 0, period = 4000, on = 1000) {
  const out = [];
  for (let p = from; p < to; p += period) { out.push([p, Math.min(p + on, to), "v", st]); out.push([p + on, Math.min(p + period, to), "u"]); }
  return out;
}
// n voiced frames at st from s0 + 25 ms, after a stall (no frames at s0 - 50, s0 - 25, s0): the first burst frame's
// spacing is 100 ms, so 118 frames count 3,025 ms (>= 3 s) with the 100 ms gap cap and 2,975 ms with a 50 ms one;
// the pseudo update 8 s after s0 sees the whole burst with its newest frame 5,050 ms old (stale).
function staleBurst(s0, st, n = 118) { return [[s0 - 50, s0 + 25, "x"], [s0 + 25, s0 + 25 + 25 * n, "v", st]]; }
const SEED = { panelOnMs: 100000, shiftMs: 130000, endMs: 160000 };
const STALE = [50000, 60000, 70000, 80000].flatMap((s0) => staleBurst(s0, 3.5));

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
  // K-seed rules (§8.9 review fixes). A sparse 120 Hz reference voice to 50 s (A40 = 120 Hz), the panel switched on
  // at 100 s, a pitch-only shift at 130 s. Notes at +3.5 st while the panel is off raise KP8's threshold above a 5 st
  // shift if the seed takes them in.
  // Held notes (verdict "sustained") are not seeded: threshold 4 st, the 5 st shift warns ...
  seed_sustained: { ...SEED, shiftSt: 5, held: [[50000, 90000]], heldSt: 3.5, frames: [...refBursts(0, 50000), [90000, 100000, "u"]] },
  // ... the same notes spoken are: the shift does not warn.
  seed_spoken: { ...SEED, shiftSt: 5, frames: [...refBursts(0, 50000), [50000, 90000, "v", 3.5], [90000, 100000, "u"]] },
  // Four stale bursts: each is shown twice while fresh, not a third time once its newest frame is over 5 s old
  // (threshold ~6.2 st, so a 6.5 st shift warns; ~7 st if the stale ones counted) ...
  seed_fresh: { ...SEED, shiftSt: 6.5, frames: [...STALE, ...refBursts(0, 50000), [0, 100000, "u"]] },
  // ... and each reaches 3 s only through its 100 ms stall spacing (a 5 st shift does not warn; with a 50 ms cap it would).
  seed_gap: { ...SEED, shiftSt: 5, frames: [...STALE, ...refBursts(0, 50000), [0, 100000, "u"]] },
  // The session's first 120 frames at +3.9 st reach 3 s only with the first frame's 25 ms (three pending values,
  // threshold ~4.8 st: a 4.4 st shift does not warn; it would if the first frame counted 0 ms).
  seed_first: { ...SEED, shiftSt: 4.4, frames: [[0, 3025, "v", 3.9], [3025, 10000, "u"], ...refBursts(10000, 50000), [0, 100000, "u"]] },
  // 160 frames at +3.9 st from 52 s, 160 at -3.9 st from 56 s, no frame at 60 s: the pseudo update at 60 s reads
  // (52, 60] s, without the frame at 52 s (median -3.9 st; with it, the two middle values average to +0.4 st), so the
  // threshold is ~6.25 st and a 6 st shift does not warn (it would, from ~5.75 st, with the frame at 52 s counted).
  seed_edge: { ...SEED, shiftSt: 6, frames: [...refBursts(0, 50000), [52000, 56000, "v", 3.9], [56000, 60000, "v", -3.9], [60000, 60025, "x"], [0, 100000, "u"]] },
  // The cue restarts at 60 s just after 8 s at +3.9 st: the ring keeps those frames, so the new start's seed gets
  // three pending values from them (a 4.4 st shift does not warn; with the ring cleared at the restart it would).
  seed_restart: { panelOnMs: 110000, shiftMs: 140000, shiftSt: 4.4, endMs: 170000, restart: { atMs: 60000, fillMs: 65000, startMs: 75000 },
    frames: [...refBursts(0, 50000), [50000, 52000, "u"], [52000, 60025, "v", 3.9], [60025, 66000, "u"], ...refBursts(66000, 110000)] },
});

const inAny = (t, xs) => xs.some(([a, b]) => t >= a && t < b);

export function callsFor(spec) {
  const c = { ...BASE, ...spec };
  const calls = [];
  for (let t = 25; t <= c.endMs; t += 25) {
    const held = inAny(t, c.held);
    const st = held ? c.heldSt : t >= c.shiftMs ? c.shiftSt : 0;
    const f0 = 120 * 2 ** (st / 12);
    const seg = c.frames.find(([a, b]) => t >= a && t < b);
    if (!seg) calls.push(["p", t, f0]);
    else if (seg[2] === "v") calls.push(["p", t, 120 * 2 ** (seg[3] / 12)]);
    else if (seg[2] === "u") calls.push(["p", t, null]);
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
