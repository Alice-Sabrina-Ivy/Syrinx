// PARAMETRIC VARIANT of the 2026-10-03 pitchPaintGate.js (5ebe609) — a
// measurement tool, not shipped: make_tree.py copies it into
// build/trees/reacq-var/src/audio/pitchPaintGate.js. With no options it
// reproduces the 5ebe609 gate bit-exactly (verified on all 4 sessions).
// The shipped 2026-10-04 gate = { smResetGap: 2 (hook), rawAgree: true,
// excursionSustain: 7 }. Config comes from
// globalThis.__PGV at createPaintGate() time; per-call trace goes to
// globalThis.__PGLOG (typed arrays indexed by globalThis.__PGK) when set.
export const ONSET_CONFIRM_FRAMES = 3;
export const EXCURSION_SEMI = 9.5;
export const EXCURSION_SUSTAIN = 8;
export const LEVEL_RING_LEN = 15;
export const REACQUIRE_GAP_FRAMES = 2;
export const REACQUIRE_SUSTAIN = 4;
export const REACQUIRE_WINDOW = 8;
const MIN_RING_FOR_LEVEL = 5;

function median(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
const semitones = (a, b) => 12 * Math.log2(a / b);

// trace codes
export const C = {
  PAINT_ON: 1, PAINT_ACCEPT: 2, ONSET: 3, OFF_ARMED: 4, OFF_UNARMED: 5,
  HOLD_PAINT: 6, HOLD_BLOCK: 7, RESET_SEG: 8, RESET_SEG_QUIET: 9, RESET: 10,
};

export function createPaintGate(opts = {}) {
  const V = { ...(globalThis.__PGV || {}), ...opts };
  const onsetConfirm = V.onsetConfirm ?? ONSET_CONFIRM_FRAMES;
  const onsetAfterGap = V.onsetAfterGap ?? null;        // onset confirm when re-acquisition armed
  const excursionSemi = V.excursionSemi ?? EXCURSION_SEMI;
  const excursionSustain = V.excursionSustain ?? EXCURSION_SUSTAIN;
  const levelRingLen = V.levelRingLen ?? LEVEL_RING_LEN;
  const reacquireGapFrames = V.reacquireGapFrames ?? REACQUIRE_GAP_FRAMES;
  const reacquireSustain = V.reacquireSustain ?? REACQUIRE_SUSTAIN;
  const reacquireWindow = V.reacquireWindow ?? REACQUIRE_WINDOW;
  const windowMode = V.windowMode ?? "painted";         // "painted" | "fresh"
  const armAlways = !!V.armAlways;                      // bound: re-acquire sustain everywhere
  // arm on a voicing-quality dip: >= dipN consecutive fresh frames with
  // confidence < dipConf (no gap needed)
  const dipConf = V.dipConf ?? null;
  const dipN = V.dipN ?? 1;
  // arm on an intensity dip: current-or-recent frame >= intenDipDb below the
  // max of the previous intenWin fresh frames, then recovering
  const intenDipDb = V.intenDipDb ?? null;
  const intenWin = V.intenWin ?? 8;
  // arm on a fresh-off-level run that is internally tight: if the last
  // tightN off-level values span < tightSemi, accept with tightN frames
  // (evidence-free "consistent register" fast accept); null = off
  const tightN = V.tightN ?? null;
  const tightSemi = V.tightSemi ?? 1.0;
  // octave-ambiguity fast accept: off-level frames whose worker-reported
  // ambiguity margin >= ambMin count as unambiguous; ambN consecutive
  // unambiguous off-level frames accept (requires opts.amb in push)
  const ambMin = V.ambMin ?? null;
  const ambN = V.ambN ?? 2;
  // "armed" also when the level was not reinforced (painted on-level) for
  // >= staleN fresh frames before the off-level run began
  const staleN = V.staleN ?? null;
  // accept only when the RAW (unsmoothed) fresh pitch of the accepting frame
  // agrees with the accepted run (< rawSemi st from its median): a median-
  // extended lock (smoothed value still off-level while the raw value is back
  // on the old level) cannot reseed the level
  const rawAgree = !!V.rawAgree;
  const rawSemi = V.rawSemi ?? 9.5;

  let ring = [];
  let onStreak = 0;
  let offRun = [];
  let offAmb = 0;
  let gapFrames = 0;
  let reacquire = false;
  let paintedSinceGap = 0;
  let lastReason = null;
  let dipRun = 0;
  let intenHist = [];
  let sinceOnPaint = 0;     // fresh frames since the last on-level paint
  let staleAtRunStart = false;

  const LOG = globalThis.__PGLOG || null;
  const rec = (code) => {
    if (!LOG) return;
    const k = globalThis.__PGK;
    LOG.code[k] = code; LOG.armed[k] = reacquire ? 1 : 0; LOG.offLen[k] = offRun.length;
    LOG.level[k] = level() ?? 0; LOG.onStreak[k] = onStreak; LOG.psg[k] = paintedSinceGap;
  };

  const level = () => (ring.length >= MIN_RING_FOR_LEVEL ? median(ring) : null);

  function painted() {
    if (reacquire && windowMode === "painted" && ++paintedSinceGap >= reacquireWindow) reacquire = false;
    lastReason = "paint";
    return true;
  }

  function push(pitch, { fresh = true, conf = null, inten = null, amb = null, raw = null } = {}) {
    const est = level();
    const onLevel = est === null || Math.abs(semitones(pitch, est)) < excursionSemi;

    if (!fresh) {
      gapFrames++;
      const ok = onLevel && onStreak >= onsetConfirm;
      lastReason = ok ? "paint" : "hold";
      rec(ok ? C.HOLD_PAINT : C.HOLD_BLOCK);
      return ok;
    }

    let arm = gapFrames >= reacquireGapFrames;
    if (dipConf !== null && conf !== null) {
      dipRun = conf < dipConf ? dipRun + 1 : 0;
      if (dipRun >= dipN) arm = true;
    }
    if (intenDipDb !== null && inten !== null && Number.isFinite(inten)) {
      if (intenHist.length >= 2) {
        const mx = Math.max(...intenHist);
        if (mx - inten >= intenDipDb) arm = true;
      }
      intenHist.push(inten);
      if (intenHist.length > intenWin) intenHist.shift();
    }
    if (arm) { reacquire = true; paintedSinceGap = 0; }
    gapFrames = 0;
    if (reacquire && windowMode === "fresh" && ++paintedSinceGap > reacquireWindow) reacquire = false;

    const oc = reacquire && onsetAfterGap !== null ? onsetAfterGap : onsetConfirm;
    if (onLevel) {
      onStreak++;
      offRun = []; offAmb = 0;
      if (onStreak >= oc) {
        ring.push(pitch);
        if (ring.length > levelRingLen) ring.shift();
        sinceOnPaint = 0;
        const r = painted(); rec(C.PAINT_ON); return r;
      }
      sinceOnPaint++;
      lastReason = "onset";
      rec(C.ONSET);
      return false;
    }

    if (offRun.length === 0) staleAtRunStart = staleN !== null && sinceOnPaint >= staleN;
    sinceOnPaint++;
    offRun.push(pitch);
    if (offRun.length > excursionSustain) offRun.shift();
    if (ambMin !== null) {
      // direction-specific margin: upward departure -> alternative is pitch/2 (ambH); downward -> 2*pitch (ambD)
      const a = amb && est !== null ? (pitch > est ? amb.h : amb.d) : null;
      offAmb = (a !== null && Number.isFinite(a) && a >= ambMin) ? offAmb + 1 : 0;
    }
    const armedHere = reacquire || armAlways || staleAtRunStart;
    let need = armedHere ? reacquireSustain : excursionSustain;
    if (ambMin !== null && offAmb >= ambN) need = Math.min(need, ambN);
    const win = offRun.length > need ? offRun.slice(-need) : offRun;
    let spread = win.length > 1 ? Math.abs(semitones(Math.max(...win), Math.min(...win))) : 0;
    let accept = win.length >= need && spread < excursionSemi;
    if (!accept && tightN !== null && offRun.length >= tightN) {
      const w2 = offRun.slice(-tightN);
      const sp2 = Math.abs(semitones(Math.max(...w2), Math.min(...w2)));
      if (sp2 < tightSemi) accept = true;
    }
    if (accept && rawAgree && raw !== null) {
      const w0 = win.length >= need ? win : offRun.slice(-tightN);
      if (Math.abs(semitones(raw, median(w0))) >= rawSemi) accept = false;
    }
    if (accept) {
      const w = win.length >= need ? win : offRun.slice(-tightN);
      ring = w.slice(-levelRingLen);
      const accepted = median(ring);
      while (ring.length < MIN_RING_FOR_LEVEL) ring.push(accepted);
      onStreak = w.length;
      offRun = []; offAmb = 0;
      sinceOnPaint = 0;
      const r = painted(); rec(C.PAINT_ACCEPT); return r;
    }
    onStreak = 0;
    lastReason = "offlevel";
    rec(armedHere ? C.OFF_ARMED : C.OFF_UNARMED);
    return false;
  }

  function resetSegment(why) {
    onStreak = 0;
    offRun = []; offAmb = 0;
    gapFrames++;
    dipRun = 0;
    lastReason = null;
    rec(why === "quiet" ? C.RESET_SEG_QUIET : C.RESET_SEG);
  }

  function reset() {
    ring = [];
    onStreak = 0;
    offRun = []; offAmb = 0;
    gapFrames = 0;
    reacquire = false;
    paintedSinceGap = 0;
    lastReason = null;
    dipRun = 0; intenHist = []; sinceOnPaint = 0; staleAtRunStart = false;
    rec(C.RESET);
  }

  return { push, resetSegment, reset, lastReason: () => lastReason, level };
}
