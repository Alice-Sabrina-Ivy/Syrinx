// pitch-only-warning.js — the "Likely heard as" panel's pitch-only-change
// warning (2026-10-07). The panel's estimate follows pitch more than
// listeners do: when the pitch moves and the resonance does not, it shows a
// bigger change than listeners hear (measurements/heard-as-calibration-
// 2026-10-07.md §6 row 1). This module says so live, relative to the
// session's own start. Pure; used by HeardAsPanel (via useAudioPipeline) and
// by the golden replay test.
//
// Rule: A40+KP8-3+DS10 + KS-Q5. A40+KP8-3+DS10 was adopted by user override
// 2026-10-12 (measurements/heard-as-pitch-only-warning-2026-10-07.md §8.6):
// the pre-registered men's-false-alarm study's pick (§8.5), which failed 2 of
// 15 held-out checks (male-base hits within 10 s 0.863 vs 0.898, female-base
// early-shift hits 0.863 vs 0.913) and was adopted for its false alarms: men's
// natural false alarms 3.39 -> 0.27 %, women's 0.33 -> 0 %. Until then the app
// ran S0 (`S0_CONFIG` below). KS-Q5, the late-panel fallback below, was
// adopted by user decision 2026-10-13 (§8.9) overriding the recorded FAIL of
// its pre-registered test (§8.8, 29 of 30 checks: one man's natural false
// alarms 16.76 % with the panel switched on at ~120 s, limit 15 %; post hoc,
// not pre-registered: the shipped rule with the panel on from the start gives
// him 18.57 % over the same span).
// With the panel on from the start KS-Q5 never runs and the warning is the
// §8.6 rule tick for tick (§8.9 (a)), except once the start cap below
// applies (more than 7,200 voiced frames before the cue sets its start, for
// example about 3 min of held notes or humming after the first words: no
// warning for that start, where the shipped module could still warn; it
// never applied on the recorded streams). The KS-Q5 code is ported from the
// round-2 harness (late-variants-r2.js, sha256 956061543a…; §8.9 (b): 0
// mismatches on every recorded late and on0 panel).
//
// Inputs (audio clock, ms):
//   addPitch({ audioMs, f0 })        every POSTED pitch-worker frame (f0 null
//                                    / 0 = unvoiced) — never the smoothed,
//                                    painted or held value — from the start
//                                    of listening, whether or not the panel
//                                    is on.
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
// Assumed (always true in the app and on every recorded stream, §8.9): frames
// arrive in time order and no update's audioMs is earlier than the newest
// frame. Under them the bounded storage below gives the outputs of the
// unbounded harness.
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
// >= 10 points from its median over the shown updates in [t_fill, t_start]
// (the start share).
//
// Late switch-on (KS-Q5, §8.8 / §8.9). The panel counts as switched on late
// when its first update() since creation or reset() comes after t_fill (a cue
// restart keeps this flag). An update is TRIGGERED when the panel came on
// late, t_start is known, the update is later than t_start and the start
// share is empty (no shown update in [t_fill, t_start]: the panel was off,
// loading or hidden throughout). On triggered updates:
//   - K-seed: KP8's quiet history comes from a background shadow kept from
//     the start of listening: every 2 s of audio a pseudo panel update from
//     the posted frames of the last 8 s with the panel's own pooling and hide
//     rules (HEARD_AS_CALIBRATION: lnF0 = ln median of the voiced frames,
//     shown when they cover >= 3 s, the newest is <= 5 s old, F0 is in the
//     tested range and the cue's verdict is not "sustained"), put through the
//     same KP8 bookkeeping against the A40 reference. At the first triggered
//     update the panel's quiet history and pending values are replaced by the
//     shadow's; the panel's shown updates add to it from then on.
//   - Q5: the start share is replaced by the median of the quiet drawn shares
//     (eligible, resonance within 0.6 u, |dP| below X) collected from the
//     first shown triggered update (fbT0) for 20 s, and after that until 5
//     are collected; while that window is open the gate fails (no warning).
// With the panel on from the start no update is triggered: the rule is §8.6's.
// Limits that remain (§8.9): a panel that was on before t_fill (first update
// before the cue filled) but showed no estimate in the start window — hidden
// throughout, its model still downloading, or the user on another of the
// app's tabs (Pitch, History, Resonance lab: the panel is not mounted and
// makes no updates; a different browser tab did not stop it in §8.9's
// round-3 test) — cannot warn until stop / start or a cue restart; nor
// can one that was on before t_fill, switched off, and switched on again
// after a cue restart's new t_fill (the late flag stays false). No panel,
// on from the start or switched on late, can warn for a start that more
// than 7,200 voiced frames reach before t_start (the cap below; e.g. about
// 3 min of held notes or humming after the first words) until stop / start
// or a cue restart.
//
// Bounded storage (§8.9 2). The shipped module kept every voiced posted frame
// until a panel update froze A40, i.e. for the whole session while the panel
// was off (~144,000 objects per hour). Now:
//   - S0's P0 is decided at the first posted frame later than t_start; when
//     it is null (or with ref "S0") the frame buffer is emptied and no frames
//     are kept until a cue restart or reset(); A40 is frozen at the first
//     posted frame later than max(t_start, t_fill + 40 s) and the buffer is
//     emptied. So the buffer holds at most the voiced frames from t_fill to
//     that point (~40-82 s on the recorded streams), in typed arrays.
//   - Cap (the one behaviour change outside KS-Q5; §8.9 2c', review fixes):
//     while S0's P0 is not decided, a voiced frame that would make the buffer
//     hold more than 7,200 frames (`maxStartVoicedMs` 180 s / the 25 ms frame
//     spacing) makes the module give up on this start: P0 is null (as with
//     fewer than 20 start frames), no warning and pitchStart() null until a
//     cue restart or reset(). Unvoiced frames and silence never count, so a
//     long pause after the cue fills does not end the start (the first cap,
//     t_fill + 180 s of audio time, did). It never applied on the recorded
//     streams.
//   - The K-seed ring holds the posted frames of the last 8 s (<= 321 with
//     25 ms capture chunks, also at 44.1 kHz) in typed arrays; it stops and
//     is released once the first panel update came before t_fill (the
//     shadow can then never be used before reset()).
//   - KP8's quiet histories are a count and a running sum of squares (the
//     same threshold bit for bit as summing the list in order).
// At the production ~25 ms frame spacing: at most 7,521 retained frames at
// any time (7,200 buffered + 321 in the ring), at most 321 once A40 is final
// (`retained()`, for tests). The `?chunk=N` diagnostic flag (5–50 ms)
// changes the frame spacing: the ring then holds 8 s of frames, the buffer
// between S0's P0 and A40's freeze up to 40 s of voiced frames (so up to
// 9,601 frames in all at ?chunk=5: 8,001 + 1,600), and the cap comes after
// proportionally less voiced audio.
//
// Eligible update: the panel shows an estimate (lnF0 known), startU, u and
// the reference known, fill ≥ 1, verdict ≠ "sustained", sinceResumeS ≥ 2.
// Condition: |12·(lnF0 − ref)/ln 2| ≥ X AND |u − startU| ≤ 0.6 u AND the
// DS10 gate — the same in both directions (absolute values only). u here is
// the cue's plain 5 s median (uPlain, warningU below), not the shown value,
// which restarts on a confirmed change since 2026-10-21 — so the warning's
// input is what it was when it was measured.
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
// drops the references, the histories, the late-panel state and the run (the
// late flag and the K-seed ring stay); resetRun() (panel switched off / on)
// drops only the run; reset() (stop / start listening) drops everything.

import { HEARD_AS_CALIBRATION } from "./heardAsCalibration.js";

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
  maxStartVoicedMs: 180000, // cap: give up on a start window holding more voiced frames than this / 25 ms (§8.9 2c')
  // KS-Q5 (§8.9): the late-switch-on fallback; null = none (the §8.6 rule).
  late: Object.freeze({
    // K-seed: the panel's own pooling and hide rules (heard-as.js)
    updateMs: HEARD_AS_CALIBRATION.updateMs,           // 2 s pseudo updates
    seedWindowMs: HEARD_AS_CALIBRATION.windowMs,       // 8 s of posted frames
    // >= 3 s voiced: the panel's rule when the warning was studied (the panel
    // needs 2 s since 2026-10-21, measurements/heard-as-low-pitch-and-pauses-
    // 2026-10-21.md); kept at 3 s so the warning is the one its study measured.
    seedMinVoicedMs: 3000,
    seedFreshMs: HEARD_AS_CALIBRATION.freshMs,         // newest voiced frame <= 5 s old
    seedLnF0: HEARD_AS_CALIBRATION.range.lnF0,         // [ln 81, ln 293.1] Hz
    // Q5: the fallback start share
    windowMs: 20000,      // collected for 20 s from the first shown triggered update …
    minShares: 5,         // … and after that until 5 quiet shares are in
  }),
});

/** The rule the app ran until 2026-10-12 (the original study's S0). */
export const S0_CONFIG = Object.freeze({ ...PITCH_ONLY_WARNING, ref: "S0", kp8: null, ds: null, late: null });

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
const FRAME_MS = 25;           // the production spacing of posted pitch frames (one per 25 ms capture chunk)
const SEED_FIRST_GAP_MS = 25;  // K-seed: the first frame's spacing
const SEED_MAX_GAP_MS = 100;   // K-seed: a frame's spacing is capped at this

function median(xs) {
  const q = [...xs].sort((a, b) => a - b);
  const n = q.length, h = n >> 1;
  return n % 2 ? q[h] : (q[h - 1] + q[h]) / 2;
}
// The same value as median() over the first n entries of a scratch array (sorted in place).
function medianTyped(a, n) {
  const q = a.subarray(0, n).sort();
  const h = n >> 1;
  return n % 2 ? q[h] : (q[h - 1] + q[h]) / 2;
}
const finite = (v) => typeof v === "number" && Number.isFinite(v);

/** The resonance value the warning compares with startU: the plain 5 s median
 *  (uPlain), not the shown value, which restarts on a confirmed change since
 *  2026-10-21 (src/resonance/resonanceCue.js RESTART). Snapshots without
 *  uPlain (recorded before it existed) carry the plain median in u. */
export function warningU(r) {
  return r.uPlain !== undefined ? r.uPlain : r.u;
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
  if (!r || r.startU == null || warningU(r) == null || !Number.isFinite(warningU(r)) || !Number.isFinite(r.startU)) return false;
  if (!((r.fill ?? 0) >= 1)) return false;
  if (r.verdict === "sustained") return false;
  return (r.sinceResumeS ?? 0) >= C.minSinceResumeS;
}

export function createPitchOnlyWarning(C = PITCH_ONLY_WARNING) {
  // KS-Q5 is on only with the DS gate it stands in for; the K-seed only with KP8.
  const L = C.late != null && C.ds != null ? C.late : null;
  const SEED = L !== null && C.kp8 != null;
  const CAP_FRAMES = typeof C.maxStartVoicedMs === "number" && Number.isFinite(C.maxStartVoicedMs)
    ? Math.floor(C.maxStartVoicedMs / FRAME_MS) : Infinity;   // 7,200

  // References
  let tFill = null, tStart = null;   // audio ms of the first fill >= 1 / startU snapshot
  let p0S0 = null, s0Done = false;   // S0's P0 (gate for every ref; KP8 back-fill reference)
  let a40Frozen = null;              // A40 value once frozen
  let sawStartU = false;
  let latestFrameMs = -Infinity;     // newest frame time seen (voiced or not)
  // Voiced posted frames with audioMs >= tFill (a 2 s pre-buffer before t_fill): entries [bLo, bN)
  let bT = null, bF = null, bLo = 0, bN = 0;
  let scratch = new Float64Array(512);
  // KP8: the quiet history as a count and a running sum of squares
  let histN = 0, histSS = 0;
  let pendingP8 = [];                // shown updates' lnF0 before the reference is known
  // DS
  let startShares = [];              // shown updates' drawn shares in [tFill, tStart]
  // KS-Q5: the late flag, the trigger state and Q5's fallback share
  let lateOn = null;                 // decided at the first update() since creation / reset() (null = no call yet)
  let fbState = "idle", fbT0 = null, fbShares = [], fbMedian = null;
  // K-seed shadow
  let shadowOn = SEED;               // false once the late flag is false (until reset())
  let rT = null, rF = null, rD = null, rHead = 0, rCount = 0; // ring: time, f0 (0 = unvoiced), spacing
  let sdLast = null, sdNext = null;
  let sdN = 0, sdSS = 0, sdPend = [], sdVerdict = null, seeded = false;
  // Display
  let run = 0, on = false, hidden = 0;

  function dropBuffer() {
    bT = null; bF = null; bLo = 0; bN = 0;
    if (scratch.length > 512) scratch = new Float64Array(512); // the median scratch grew with the buffer
  }
  // P0 is null for this start: nothing can read the frames, the pending values or new start shares (§8.9 2a, 2d).
  const startDead = () => s0Done && p0S0 === null;
  function giveUpStart() { pendingP8 = []; sdPend = []; dropBuffer(); }

  function resetReference() {
    tFill = null; tStart = null; p0S0 = null; s0Done = false; a40Frozen = null; dropBuffer();
    sawStartU = false; latestFrameMs = -Infinity; histN = 0; histSS = 0; pendingP8 = []; startShares = [];
    run = 0; on = false; hidden = 0;
    fbState = "idle"; fbT0 = null; fbShares = []; fbMedian = null;
    sdN = 0; sdSS = 0; sdPend = []; sdVerdict = null; seeded = false;
  }

  function bufPush(t, f) {
    if (bT === null) { bT = new Float64Array(1024); bF = new Float64Array(1024); bLo = 0; bN = 0; }
    if (bN === bT.length) {
      if (bLo > 0) { bT.copyWithin(0, bLo, bN); bF.copyWithin(0, bLo, bN); bN -= bLo; bLo = 0; }
      if (bN === bT.length) {
        const t2 = new Float64Array(bT.length * 2), f2 = new Float64Array(bT.length * 2);
        t2.set(bT.subarray(0, bN)); f2.set(bF.subarray(0, bN)); bT = t2; bF = f2;
      }
    }
    bT[bN] = t; bF[bN] = f; bN++;
  }
  function lnMedianUpTo(endMs) {
    if (bT === null) return { n: 0, v: null };
    if (scratch.length < bN - bLo) scratch = new Float64Array(2 * (bN - bLo));
    let n = 0;
    for (let i = bLo; i < bN; i++) if (bT[i] >= tFill && bT[i] <= endMs) scratch[n++] = bF[i];
    return n ? { n, v: Math.log(medianTyped(scratch, n)) } : { n: 0, v: null };
  }
  // S0's start P0; decided for good once a frame later than t_start has
  // arrived (frames arrive in time order, so every start-window frame is in).
  function s0P0() {
    if (s0Done) return p0S0;
    if (tFill === null || tStart === null) return null;
    const m = lnMedianUpTo(tStart);
    const v = m.n >= C.minStartFrames ? m.v : null;
    if (latestFrameMs > tStart) {
      p0S0 = v; s0Done = true;
      if (v === null) giveUpStart();
      else if (C.ref === "S0") dropBuffer();
    }
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
    if (end < audioMs && latestFrameMs > end) { a40Frozen = v; dropBuffer(); }
    return v;
  }
  function threshold() {
    if (C.kp8 == null || histN < C.kp8MinHistory) return C.minPitchSt;
    return Math.max(C.minPitchSt, C.kp8 * Math.sqrt(histSS / histN));
  }
  function pushHist(dh) { if (Number.isFinite(dh) && Math.abs(dh) < threshold()) { histN++; histSS += dh * dh; } }

  // K-seed shadow. Reads the reference state, never writes it.
  function s0Pure() {
    if (s0Done) return p0S0;
    if (tFill === null || tStart === null) return null;
    const m = lnMedianUpTo(tStart);
    return m.n >= C.minStartFrames ? m.v : null;
  }
  function refPure(t) {
    const s0 = s0Pure();
    if (s0 === null) return null;
    if (C.ref === "S0") return s0;
    if (a40Frozen !== null) return a40Frozen;
    return lnMedianUpTo(Math.max(tStart, Math.min(t, tFill + C.growMs))).v;
  }
  function sdThreshold() {
    if (C.kp8 == null || sdN < C.kp8MinHistory) return C.minPitchSt;
    return Math.max(C.minPitchSt, C.kp8 * Math.sqrt(sdSS / sdN));
  }
  function sdPush(dh) { if (Number.isFinite(dh) && Math.abs(dh) < sdThreshold()) { sdN++; sdSS += dh * dh; } }
  // One pseudo panel update at audio time t (every frame with audioMs <= t has arrived).
  function seedUpdate(t) {
    if (scratch.length < rCount) scratch = new Float64Array(2 * rCount);
    let n = 0, voiced = 0, newest = null;
    const cap = rT.length;
    for (let k = 0, i = rHead; k < rCount; k++, i = i + 1 === cap ? 0 : i + 1) {
      const ta = rT[i];
      if (ta <= t - L.seedWindowMs || ta > t || !(rF[i] > 0)) continue;
      scratch[n++] = rF[i]; voiced += rD[i]; newest = ta;
    }
    const lnF0 = n ? Math.log(medianTyped(scratch, n)) : null;
    const shown = lnF0 !== null && voiced >= L.seedMinVoicedMs && t - newest <= L.seedFreshMs
      && lnF0 >= L.seedLnF0[0] && lnF0 <= L.seedLnF0[1] && sdVerdict !== "sustained";
    const ref = (tStart !== null && t >= tStart) ? refPure(t) : null;
    if (ref !== null && sdPend.length) {
      const s0 = s0Pure();
      for (const p of sdPend) sdPush((p - s0) * ST_PER_LN);
      sdPend = [];
    }
    if (!shown) return;
    if (ref !== null) sdPush((lnF0 - ref) * ST_PER_LN);
    else if ((tStart === null || t < tStart) && !startDead()) sdPend.push(lnF0);
  }
  function seedFrame(audioMs, f0) {
    const U = L.updateMs;
    if (sdNext === null) sdNext = (Math.floor(audioMs / U) + 1) * U;
    if (rT === null) { rT = new Float64Array(512); rF = new Float64Array(512); rD = new Float64Array(512); rHead = 0; rCount = 0; }
    while (audioMs > sdNext) { seedUpdate(sdNext); sdNext += U; }
    const gap = sdLast === null ? SEED_FIRST_GAP_MS : Math.max(audioMs - sdLast, 0);
    sdLast = audioMs;
    let cap = rT.length;
    if (rCount === cap) { // grow (more frames than the capacity within the window), oldest first
      const t2 = new Float64Array(cap * 2), f2 = new Float64Array(cap * 2), d2 = new Float64Array(cap * 2);
      for (let k = 0, i = rHead; k < rCount; k++, i = i + 1 === cap ? 0 : i + 1) { t2[k] = rT[i]; f2[k] = rF[i]; d2[k] = rD[i]; }
      rT = t2; rF = f2; rD = d2; rHead = 0; cap *= 2;
    }
    const j = (rHead + rCount) % cap;
    rT[j] = audioMs; rF[j] = typeof f0 === "number" && f0 > 0 ? f0 : 0; rD[j] = Math.min(gap, SEED_MAX_GAP_MS);
    rCount++;
    while (rCount && rT[rHead] <= audioMs - L.seedWindowMs) { rHead = rHead + 1 === cap ? 0 : rHead + 1; rCount--; }
  }
  function stopShadow() { shadowOn = false; rT = null; rF = null; rD = null; rHead = 0; rCount = 0; }

  return {
    addPitch({ audioMs, f0 }) {
      if (typeof audioMs !== "number" || !Number.isFinite(audioMs)) return;
      latestFrameMs = Math.max(latestFrameMs, audioMs);
      if (shadowOn) seedFrame(audioMs, f0); // K-seed (every posted frame; its pseudo updates may still read the buffer)
      if (!s0Done && tFill !== null && tStart !== null && audioMs > tStart) s0P0(); // 2a: decide S0's P0 now (empties the buffer if null / S0)
      if (C.ref !== "S0" && a40Frozen === null && s0Done && p0S0 !== null) {   // 2b: freeze A40 now
        const E = Math.max(tStart, tFill + C.growMs);
        if (audioMs > E) { a40Frozen = lnMedianUpTo(E).v; dropBuffer(); }
      }
      if (a40Frozen !== null || (s0Done && (C.ref === "S0" || p0S0 === null))) return;
      if (!(typeof f0 === "number" && f0 > 0)) return;
      if (!s0Done && tFill !== null && bN - bLo >= CAP_FRAMES) { // 2c': the start window holds too much voiced audio
        p0S0 = null; s0Done = true; giveUpStart(); return;
      }
      bufPush(audioMs, f0);
      // Before the start window opens keep only a short pre-buffer (a frame
      // can arrive just after the snapshot that opens the window).
      if (tFill === null) while (bLo < bN && bT[bLo] < audioMs - PRE_BUFFER_MS) bLo++;
    },
    noteResonance(snap, audioMs) {
      if (!snap) { resetReference(); return; }
      if (snap.startU == null) {
        if (sawStartU) resetReference(); // the cue restarted (fresh engine)
      } else {
        sawStartU = true;
      }
      sdVerdict = snap.verdict ?? null; // K-seed: the latest resonance verdict
      if (typeof audioMs !== "number" || !Number.isFinite(audioMs)) return;
      if (tFill === null && (snap.fill ?? 0) >= 1) {
        tFill = audioMs;
        if (bT !== null) { // keep the buffered frames with audioMs >= t_fill, in order
          let k = 0;
          for (let i = bLo; i < bN; i++) if (bT[i] >= tFill) { bT[k] = bT[i]; bF[k] = bF[i]; k++; }
          bLo = 0; bN = k;
        }
      }
      if (tFill !== null && tStart === null && snap.startU != null) tStart = audioMs;
    },
    /** -> true while the warning is shown. lnF0 null = the panel is hidden. */
    update({ lnF0 = null, resonance = null, share = null, audioMs = null } = {}) {
      if (lateOn === null) { lateOn = tFill !== null; if (!lateOn) stopShadow(); } // switched on after t_fill?
      const shown = typeof lnF0 === "number" && Number.isFinite(lnF0);
      // KS-Q5's trigger (computed before the reference work, which cannot change it).
      const noStart = L !== null && tStart !== null && finite(audioMs) && audioMs > tStart && startShares.length === 0 && lateOn === true;
      if (noStart && SEED && !seeded) { seeded = true; histN = sdN; histSS = sdSS; pendingP8 = sdPend.slice(); } // K-seed
      const ref = (tStart !== null && audioMs >= tStart) ? refAt(audioMs) : null;
      const s0 = ref === null ? null : s0P0();
      if (C.kp8 != null && ref !== null && pendingP8.length) {   // back-fill against S0's P0
        for (const p of pendingP8) pushHist((p - s0) * ST_PER_LN);
        pendingP8 = [];
      }
      // DS: the start share (shown updates in [tFill, tStart])
      if (C.ds != null && shown && tFill !== null && audioMs >= tFill && (tStart === null || audioMs <= tStart)
          && finite(share) && !startDead()) startShares.push(share);
      const X = threshold();
      const dP = shown && ref !== null ? (lnF0 - ref) * ST_PER_LN : NaN;
      let c = false;
      const elig = shown && pitchOnlyEligible({ lnF0, p0: ref, resonance }, C);
      if (elig) {
        c = Math.abs(dP) >= X - EPS && Math.abs(warningU(resonance) - resonance.startU) <= C.maxResonanceU + EPS;
        if (c && C.ds != null) {
          if (noStart) { // Q5: no warning until the fallback share is known
            c = fbState === "closed" && finite(share) && Math.abs(share - fbMedian) * 100 >= C.ds;
          } else {
            const s0s = startShares.length ? median(startShares) : NaN;
            c = Number.isFinite(s0s) && finite(share) && Math.abs(share - s0s) * 100 >= C.ds;
          }
        }
      }
      if (noStart) { // Q5 collection (after this update's own gate)
        if (fbState === "idle" && shown) { fbState = "collecting"; fbT0 = audioMs; }
        if (fbState === "collecting") {
          const inWin = audioMs <= fbT0 + L.windowMs;
          if (shown && finite(share) && (inWin || fbShares.length < L.minShares)
              && elig && Math.abs(dP) < X - EPS && Math.abs(warningU(resonance) - resonance.startU) <= C.maxResonanceU + EPS) fbShares.push(share);
          if (!inWin && fbShares.length >= Math.max(1, L.minShares)) { fbState = "closed"; fbMedian = median(fbShares); fbShares = []; }
        }
      }
      // KP8 history: this update's dP (kept only if below this update's X)
      if (C.kp8 != null && shown) {
        if (ref !== null) pushHist(dP);
        else if ((tStart === null || audioMs < tStart) && !startDead()) pendingP8.push(lnF0);
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
    reset() { resetReference(); lateOn = null; stopShadow(); shadowOn = SEED; sdLast = null; sdNext = null; },
    /** For tests: pitch frames held (the A40 / P0 buffer, the K-seed ring). */
    retained: () => ({ a40Frames: bN - bLo, ringFrames: rCount }),
  };
}
