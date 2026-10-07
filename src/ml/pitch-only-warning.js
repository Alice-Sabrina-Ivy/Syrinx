// pitch-only-warning.js — the "Likely heard as" panel's pitch-only-change
// warning (2026-10-07). The panel's estimate follows pitch more than
// listeners do: when the pitch moves and the resonance does not, it shows a
// bigger change than listeners hear (measurements/heard-as-calibration-
// 2026-10-07.md §6 row 1). This module says so live, relative to the
// session's own start. Pure; used by HeardAsPanel (via useAudioPipeline) and
// by the golden replay test. Rule chosen by a pre-registered study:
// measurements/heard-as-pitch-only-warning-2026-10-07.md.
//
// Inputs (audio clock, ms):
//   addPitch({ audioMs, f0 })        every POSTED pitch-worker frame (f0 null
//                                    / 0 = unvoiced) — never the smoothed,
//                                    painted or held value.
//   noteResonance(snapshot, audioMs) every resonance-cue state message
//                                    (resonanceCue.js snapshot fields), with
//                                    the audio clock when it arrived; null =
//                                    the worker backed off (overload) or
//                                    stopped.
//   update({ lnF0, resonance })      each panel update (every 2 s): lnF0 =
//                                    the panel's own estimate().lnF0 (null
//                                    when the panel is hidden), resonance =
//                                    the latest snapshot. -> boolean (show).
//
// Pitch start P0 = ln(median of the posted VOICED frames whose time lies in
// [t_fill, t_start]): t_fill = the first snapshot with fill ≥ 1, t_start =
// the first snapshot with startU set — the audio span the resonance cue
// collects its own start in. Fewer than 20 voiced frames -> null (no
// warning until the cue restarts). Frozen once a later frame arrives;
// frames after t_start never change it.
//
// Eligible update: the panel shows an estimate (lnF0 known), startU, u and
// P0 known, fill ≥ 1, verdict ≠ "sustained", sinceResumeS ≥ 2.
// Condition: |12·(lnF0 − P0)/ln 2| ≥ 4 st AND |u − startU| ≤ 0.6 u — the
// same in both directions (absolute values only).
// Shown when the condition holds on K = 2 consecutive SHOWN updates that are
// eligible (~2–4 s); cleared on the first shown update where it fails or is
// ineligible (resonance side: sustained, fill < 1, sinceResumeS < 2, no
// startU). (The study's mechanical choice was K = 1; K = 2 is in the
// pre-registered grid, passes every criterion on the test split too, and
// cuts the brief flash right after a pitch + resonance change from 44 % to
// 9 % of such sessions — measurement note §5.)
// Hidden-panel updates (lnF0 null: "Keep talking", "stale", …) are neutral:
// nothing is shown, but the run is kept, so when the panel comes back the
// warning is back at once if the first shown update still meets the
// condition; more than maxHiddenUpdates hidden updates in a row (~10 s) drop
// the run. (Post-hoc review fix 2026-10-07; replayed on the study's sessions:
// shown estimates in failure sessions after shift + 10 s carrying the warning
// 0.91 / 0.92 -> 0.95 / 0.96, every other figure unchanged —
// measurements/heard-as-panel-review-2-2026-10-07.md §2.)
//
// Resets: a resonance restart (snapshot null, or startU going back to null)
// drops P0 and the run; resetRun() (panel switched off / on) drops only the
// run; reset() (stop / start listening) drops everything.

export const PITCH_ONLY_WARNING = Object.freeze({
  minPitchSt: 4,          // X
  maxResonanceU: 0.6,     // Y
  consecutive: 2,         // K
  minStartFrames: 20,     // voiced frames needed for P0
  minSinceResumeS: 2,
  maxHiddenUpdates: 5,    // hidden-panel updates in a row (~10 s) that drop the run
});

// Same words in every direction; no direction, target or percent sign.
// The pre-registered direction-neutral wording (2026-10-07 review round 2):
// the "listeners usually heard less change" claim held pooled (83 %) but not
// for lowered women's voices (77 %; 68 % with the Jebens reference), and
// "than this shows" read as a contradiction while the axis said "Can't tell
// yet" (most of the warning's appearances).
export const PITCH_ONLY_TEXT =
  "Your pitch has moved a lot more than your resonance since you started — " +
  "this guess can be far off, in either direction, when only pitch changes.";

const ST_PER_LN = 12 / Math.LN2;
const EPS = 1e-9; // boundary values (4.00 st, 0.60 u) count as met despite float rounding
const PRE_BUFFER_MS = 2000;

function median(xs) {
  const q = [...xs].sort((a, b) => a - b);
  const n = q.length, h = n >> 1;
  return n % 2 ? q[h] : (q[h - 1] + q[h]) / 2;
}

/** The condition alone (no eligibility, no K): pure, symmetric. */
export function pitchOnlyCondition({ lnF0, p0, u, startU }, C = PITCH_ONLY_WARNING) {
  if (![lnF0, p0, u, startU].every((v) => typeof v === "number" && Number.isFinite(v))) return false;
  const dSt = Math.abs((lnF0 - p0) * ST_PER_LN);
  const dU = Math.abs(u - startU);
  return dSt >= C.minPitchSt - EPS && dU <= C.maxResonanceU + EPS;
}

/** Eligibility of one update (resonance side + panel shown + P0 known). */
export function pitchOnlyEligible({ lnF0, p0, resonance: r }, C = PITCH_ONLY_WARNING) {
  if (typeof lnF0 !== "number" || !Number.isFinite(lnF0)) return false;
  if (typeof p0 !== "number" || !Number.isFinite(p0)) return false;
  if (!r || r.startU == null || r.u == null || !Number.isFinite(r.u) || !Number.isFinite(r.startU)) return false;
  if (!((r.fill ?? 0) >= 1)) return false;
  if (r.verdict === "sustained") return false;
  return (r.sinceResumeS ?? 0) >= C.minSinceResumeS;
}

export function createPitchOnlyWarning(C = PITCH_ONLY_WARNING) {
  // Start-window state
  let tFill = null;     // audio ms of the first snapshot with fill >= 1
  let tStart = null;    // audio ms of the first snapshot with startU set
  let p0 = null;        // frozen ln F0 start, or null
  let p0Done = false;   // P0 decided (value or "not enough frames")
  let frames = [];      // { audioMs, f0 } voiced frames, candidates for P0
  let sawStartU = false;
  // Display state
  let run = 0;
  let on = false;
  let hidden = 0;       // hidden-panel updates in a row

  function resetReference() {
    tFill = null; tStart = null; p0 = null; p0Done = false; frames = []; sawStartU = false;
    run = 0; on = false; hidden = 0;
  }

  function startWindowP0() {
    const vs = frames.filter((f) => f.audioMs >= tFill && f.audioMs <= tStart).map((f) => f.f0);
    return vs.length >= C.minStartFrames ? Math.log(median(vs)) : null;
  }
  // Frozen once a frame later than t_start has arrived (frames arrive in
  // time order, so every frame of the start window is in by then).
  function finalizeP0() {
    if (p0Done || tFill === null || tStart === null) return;
    p0 = startWindowP0();
    p0Done = true;
    frames = [];
  }
  // Before that (the update right at t_start) the frames received so far.
  function currentP0() {
    if (p0Done) return p0;
    return tFill !== null && tStart !== null ? startWindowP0() : null;
  }

  return {
    addPitch({ audioMs, f0 }) {
      if (p0Done || typeof audioMs !== "number" || !Number.isFinite(audioMs)) return;
      if (tStart !== null && audioMs > tStart) { finalizeP0(); return; }
      if (!(typeof f0 === "number" && f0 > 0)) return;
      frames.push({ audioMs, f0 });
      // Before the start window opens keep only a short pre-buffer (a frame
      // can arrive just after the snapshot that opens the window).
      if (tFill === null) {
        let i = 0;
        while (i < frames.length && frames[i].audioMs < audioMs - PRE_BUFFER_MS) i++;
        if (i) frames = frames.slice(i);
      }
    },
    noteResonance(snap, audioMs) {
      if (!snap) { resetReference(); return; }
      if (snap.startU == null) {
        if (sawStartU) resetReference(); // the cue restarted (fresh engine)
      } else {
        sawStartU = true;
      }
      if (typeof audioMs !== "number" || !Number.isFinite(audioMs)) return;
      if (tFill === null && (snap.fill ?? 0) >= 1) {
        tFill = audioMs;
        frames = frames.filter((f) => f.audioMs >= tFill);
      }
      if (tFill !== null && tStart === null && snap.startU != null) tStart = audioMs;
    },
    /** -> true while the warning is shown. lnF0 null = the panel is hidden. */
    update({ lnF0 = null, resonance = null } = {}) {
      if (typeof lnF0 !== "number" || !Number.isFinite(lnF0)) {
        // Panel hidden: show nothing, keep the run unless hidden for long.
        hidden++;
        if (hidden > C.maxHiddenUpdates) run = 0;
        on = false;
        return false;
      }
      hidden = 0;
      const ref = currentP0();
      if (!pitchOnlyEligible({ lnF0, p0: ref, resonance }, C)) { run = 0; on = false; return false; }
      if (pitchOnlyCondition({ lnF0, p0: ref, u: resonance.u, startU: resonance.startU }, C)) run++;
      else run = 0;
      on = run >= C.consecutive;
      return on;
    },
    isOn: () => on,
    /** The run that showed the warning is still kept (true while shown, and
     *  through a brief hide after it was shown) — for the panel's live region. */
    held: () => run >= C.consecutive,
    pitchStart: () => currentP0(),
    /** The panel was switched off (or hidden for good): forget the run, keep P0. */
    resetRun() { run = 0; on = false; hidden = 0; },
    /** Stop / start listening. */
    reset: resetReference,
  };
}
