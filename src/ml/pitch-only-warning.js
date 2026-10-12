// pitch-only-warning.js — the "Likely heard as" panel's pitch-only-change
// warning (2026-10-07). The panel's estimate follows pitch more than
// listeners do: when the pitch moves and the resonance does not, it shows a
// bigger change than listeners hear (measurements/heard-as-calibration-
// 2026-10-07.md §6 row 1). This module says so live, relative to the
// session's own start. Pure; used by HeardAsPanel (via useAudioPipeline) and
// by the golden replay test.
//
// Rule: A40+KP8-3+DS10, adopted by user override 2026-10-12
// (measurements/heard-as-pitch-only-warning-2026-10-07.md §8.6). It was the
// pre-registered men's-false-alarm study's pick (§8.5); on its held-out test
// it failed 2 of 15 checks (male-base hits within 10 s 0.863 vs 0.898,
// female-base early-shift hits 0.863 vs 0.913) and the user adopted it for
// its false alarms: men's natural false alarms 3.39 -> 0.27 %, women's
// 0.33 -> 0 %, at the cost of some warnings a few seconds later. Until then
// the app ran S0 (the original study's rule, `S0_CONFIG` below). This code is
// the confirmation's scratch module (§8.5: 0 mismatches against the study
// harness on 1,492 test sessions x 4 panel phases) with comments added; the
// port was checked against it again, live in the app-cadence harness (§8.6).
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
//   update({ lnF0, resonance, share, audioMs })
//                                    each panel update (every 2 s, the 250 ms
//                                    hide checks, the switch-on update):
//                                    lnF0 = the panel's own estimate().lnF0
//                                    (null when the panel is hidden),
//                                    resonance = the latest snapshot, share =
//                                    the share the panel draws
//                                    (heardAsShares(...).s; null when hidden),
//                                    audioMs = the hook's audio clock at the
//                                    update. -> boolean (show).
//
// Times: t_fill = the first snapshot with fill >= 1, t_start = the first
// snapshot with startU set (the span the resonance cue collects its own
// start in).
//
// Pitch reference (A40). S0's start P0 = ln median of the posted VOICED
// frames in [t_fill, t_start]; fewer than 20 -> null and no warning until
// the cue restarts. The reference used is the ln median of the posted voiced
// frames in [t_fill, max(t_start, min(t, t_fill + 40 s))]: it grows with the
// session until t_fill + 40 s and is then frozen. It is known, like S0's,
// only from t_start on and only when S0's P0 is.
//
// Pitch threshold (KP8-3). X = max(4 st, 3 x RMS of this reader's quiet
// history) once the history holds >= 5 values, else 4 st. The history is the
// dP of the earlier SHOWN updates whose |dP| was below that update's
// threshold, in update order; shown updates before t_start are stored and
// back-filled against S0's P0 once it is known.
//
// Panel-moved gate (DS10). The share the panel draws must also have moved
// >= 10 points from its median over the shown updates in [t_fill, t_start].
//
// Eligible update: the panel shows an estimate (lnF0 known), startU, u and
// the reference known, fill ≥ 1, verdict ≠ "sustained", sinceResumeS ≥ 2.
// Condition: |12·(lnF0 − ref)/ln 2| ≥ X AND |u − startU| ≤ 0.6 u AND the
// DS10 gate — the same in both directions (absolute values only).
// Shown when the condition holds on K = 2 consecutive SHOWN updates that are
// eligible (~2–4 s); cleared on the first shown update where it fails or is
// ineligible. (The original study's mechanical choice was K = 1; K = 2 is in
// its pre-registered grid — measurement note §5.)
// Hidden-panel updates (lnF0 null: "Keep talking", "stale", …) are neutral:
// nothing is shown, but the run is kept, so when the panel comes back the
// warning is back at once if the first shown update still meets the
// condition; more than maxHiddenUpdates hidden updates in a row (~10 s) drop
// the run (review round 2, measurements/heard-as-panel-review-2-2026-10-07.md
// §2).
//
// Resets: a resonance restart (snapshot null, or startU going back to null)
// drops the references, the history and the run; resetRun() (panel switched
// off / on) drops only the run; reset() (stop / start listening) drops
// everything.

export const PITCH_ONLY_WARNING = Object.freeze({
  minPitchSt: 4,          // X (the floor of the adaptive threshold)
  maxResonanceU: 0.6,     // Y
  consecutive: 2,         // K
  minStartFrames: 20,     // voiced frames needed for S0's P0
  minSinceResumeS: 2,
  maxHiddenUpdates: 5,    // hidden-panel updates in a row (~10 s) that drop the run
  ref: "A40",             // "S0" | "A40"
  growMs: 40000,          // A40: the reference grows until t_fill + growMs
  kp8: 3,                 // KP8: threshold = max(X, kp8 x RMS(quiet history)); null = fixed X
  kp8MinHistory: 5,       // KP8: quiet values needed before the threshold adapts
  ds: 10,                 // DS: points the drawn share must have moved; null = no gate
});

/** The rule the app ran until 2026-10-12 (the original study's S0). */
export const S0_CONFIG = Object.freeze({ ...PITCH_ONLY_WARNING, ref: "S0", kp8: null, ds: null });

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

/** The pitch / resonance condition at threshold X alone (no eligibility, no
 *  DS gate, no K): pure, symmetric. */
export function pitchOnlyCondition({ lnF0, p0, u, startU, X = PITCH_ONLY_WARNING.minPitchSt }, C = PITCH_ONLY_WARNING) {
  if (![lnF0, p0, u, startU, X].every((v) => typeof v === "number" && Number.isFinite(v))) return false;
  const dSt = Math.abs((lnF0 - p0) * ST_PER_LN);
  const dU = Math.abs(u - startU);
  return dSt >= X - EPS && dU <= C.maxResonanceU + EPS;
}

/** Eligibility of one update (resonance side + panel shown + reference known). */
export function pitchOnlyEligible({ lnF0, p0, resonance: r }, C = PITCH_ONLY_WARNING) {
  if (typeof lnF0 !== "number" || !Number.isFinite(lnF0)) return false;
  if (typeof p0 !== "number" || !Number.isFinite(p0)) return false;
  if (!r || r.startU == null || r.u == null || !Number.isFinite(r.u) || !Number.isFinite(r.startU)) return false;
  if (!((r.fill ?? 0) >= 1)) return false;
  if (r.verdict === "sustained") return false;
  return (r.sinceResumeS ?? 0) >= C.minSinceResumeS;
}

export function createPitchOnlyWarning(C = PITCH_ONLY_WARNING) {
  // References
  let tFill = null, tStart = null;   // audio ms of the first fill >= 1 / startU snapshot
  let p0S0 = null, s0Done = false;   // S0's P0 (gate for every ref; KP8 back-fill reference)
  let a40Frozen = null;              // A40 value once frozen
  let frames = [];                   // voiced { audioMs, f0 } with audioMs >= tFill (pre-buffer before)
  let sawStartU = false;
  let latestFrameMs = -Infinity;     // newest frame time seen (voiced or not)
  // KP8
  let hist = [];                     // quiet dP values (st)
  let pendingP8 = [];                // shown updates' lnF0 before the reference is known
  // DS
  let startShares = [];              // shown updates' drawn shares in [tFill, tStart]
  // Display
  let run = 0, on = false, hidden = 0;

  function resetReference() {
    tFill = null; tStart = null; p0S0 = null; s0Done = false; a40Frozen = null; frames = [];
    sawStartU = false; latestFrameMs = -Infinity; hist = []; pendingP8 = []; startShares = [];
    run = 0; on = false; hidden = 0;
  }

  function lnMedianUpTo(endMs) {
    const vs = [];
    for (const f of frames) if (f.audioMs >= tFill && f.audioMs <= endMs) vs.push(f.f0);
    return vs.length ? { n: vs.length, v: Math.log(median(vs)) } : { n: 0, v: null };
  }
  // S0's start P0; decided for good once a frame later than t_start has
  // arrived (frames arrive in time order, so every start-window frame is in).
  function s0P0() {
    if (s0Done) return p0S0;
    if (tFill === null || tStart === null) return null;
    const m = lnMedianUpTo(tStart);
    const v = m.n >= C.minStartFrames ? m.v : null;
    if (latestFrameMs > tStart) { p0S0 = v; s0Done = true; }
    return v;
  }
  // The reference at audio time audioMs (A40: grows until t_fill + growMs,
  // frozen once a frame past that end has arrived).
  function refAt(audioMs) {
    const s0 = s0P0();
    if (s0 === null) return null;
    if (C.ref === "S0") return s0;
    if (a40Frozen !== null) return a40Frozen;
    const end = Math.max(tStart, Math.min(audioMs, tFill + C.growMs));
    const v = lnMedianUpTo(end).v;
    if (end < audioMs && latestFrameMs > end) { a40Frozen = v; frames = []; }
    return v;
  }
  function threshold() {
    if (C.kp8 == null || hist.length < C.kp8MinHistory) return C.minPitchSt;
    let ss = 0; for (const h of hist) ss += h * h;
    return Math.max(C.minPitchSt, C.kp8 * Math.sqrt(ss / hist.length));
  }
  function pushHist(dh) { if (Number.isFinite(dh) && Math.abs(dh) < threshold()) hist.push(dh); }

  return {
    addPitch({ audioMs, f0 }) {
      if (typeof audioMs !== "number" || !Number.isFinite(audioMs)) return;
      latestFrameMs = Math.max(latestFrameMs, audioMs);
      if (a40Frozen !== null || (C.ref === "S0" && s0Done)) return;
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
    update({ lnF0 = null, resonance = null, share = null, audioMs = null } = {}) {
      const shown = typeof lnF0 === "number" && Number.isFinite(lnF0);
      const ref = (tStart !== null && audioMs >= tStart) ? refAt(audioMs) : null;
      const s0 = ref === null ? null : s0P0();
      if (C.kp8 != null && ref !== null && pendingP8.length) {   // back-fill against S0's P0
        for (const p of pendingP8) pushHist((p - s0) * ST_PER_LN);
        pendingP8 = [];
      }
      // DS: the start share (shown updates in [tFill, tStart])
      if (C.ds != null && shown && tFill !== null && audioMs >= tFill && (tStart === null || audioMs <= tStart)
          && typeof share === "number" && Number.isFinite(share)) startShares.push(share);
      const X = threshold();
      const dP = shown && ref !== null ? (lnF0 - ref) * ST_PER_LN : NaN;
      let c = false;
      if (shown && pitchOnlyEligible({ lnF0, p0: ref, resonance }, C)) {
        c = Math.abs(dP) >= X - EPS && Math.abs(resonance.u - resonance.startU) <= C.maxResonanceU + EPS;
        if (c && C.ds != null) {
          const s0s = startShares.length ? median(startShares) : NaN;
          c = Number.isFinite(s0s) && typeof share === "number" && Number.isFinite(share) && Math.abs(share - s0s) * 100 >= C.ds;
        }
      }
      // KP8 history: this update's dP (kept only if below this update's X)
      if (C.kp8 != null && shown) {
        if (ref !== null) pushHist(dP);
        else if (tStart === null || audioMs < tStart) pendingP8.push(lnF0);
      }
      if (!shown) {
        // Panel hidden: show nothing, keep the run unless hidden for long.
        hidden++;
        if (hidden > C.maxHiddenUpdates) run = 0;
        on = false;
        return false;
      }
      hidden = 0;
      run = c ? run + 1 : 0;
      on = run >= C.consecutive;
      return on;
    },
    isOn: () => on,
    /** The run that showed the warning is still kept (true while shown, and
     *  through a brief hide after it was shown) — for the panel's live region. */
    held: () => run >= C.consecutive,
    /** S0's start P0 (ln Hz) or null. */
    pitchStart: () => s0P0(),
    /** The panel was switched off (or hidden for good): forget the run, keep
     *  the references and the history. */
    resetRun() { run = 0; on = false; hidden = 0; },
    /** Stop / start listening. */
    reset: resetReference,
  };
}
