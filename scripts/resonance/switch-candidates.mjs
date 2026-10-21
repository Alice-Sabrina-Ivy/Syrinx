// switch-candidates.mjs — the pre-registered candidates of
// measurements/resonance-switch-asymmetry-2026-10-21.md (§Plan), as a display
// readout next to the cue's own 5 s readout. Everything except the shown
// value (u / raw / clamp) stays the cue's: fill, voicedS, the drop rules,
// narrowband, sinceResumeS and the start collection (startU) all come from
// the unchanged 5 s readout, so a candidate shows a position exactly when
// BASE does.
//
//   C1 "restart": the 5 s voiced median, plus a short median over the last
//      shortS s of voiced time. When |short − long| >= jumpU (u) on confirmN
//      consecutive added values with the same sign, the window drops its
//      items older than the short window (the readout becomes the short
//      median and grows back to 5 s). Every value shown is a median of
//      admitted bins.
//   C2 "horizon": the same median over a shorter voiced horizon.
//
// createDisplayReadout({ ref, horizonS: 5, restart: null }) equals
// src/resonance-lab/readout.js's median readout value for value (checked by
// switch-cand.mjs).
//
// Shipped 2026-10-21 (user decision): c1-s1.5-j0.6-n4 is now the cue itself
// (src/resonance/resonanceCue.js RESTART / createRestartReadout, the same
// code), so in a new run the worker's posts (BASE) already restart. To
// compare against the pre-ship readout, build the cue with restart: null.

export const CANDIDATES = {
  base: null,
  ...Object.fromEntries(
    [1.5, 2.0].flatMap((shortS) => [0.4, 0.6].flatMap((jumpU) => [4, 7].map((confirmN) =>
      [`c1-s${shortS.toFixed(1)}-j${jumpU.toFixed(1)}-n${confirmN}`, { kind: "restart", horizonS: 5, restart: { shortS, jumpU, confirmN } }])))),
  "c2-h3.0": { kind: "horizon", horizonS: 3.0, restart: null },
  "c2-h2.5": { kind: "horizon", horizonS: 2.5, restart: null },
};

function median(vals) {
  if (!vals.length) return null;
  const a = Float64Array.from(vals).sort();
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}

export function createDisplayReadout({ ref, horizonS = 5, restart = null }) {
  const gap = ref.womenMedian - ref.menMedian;
  let items = [];
  let raw = null;
  let streak = 0, sign = 0, restarts = 0;
  return {
    add(stampS, s) {
      if (s === null || !Number.isFinite(s)) return false;
      items.push({ v: stampS, s });
      const lo = stampS - horizonS;
      let cut = 0;
      while (cut < items.length && items[cut].v <= lo) cut++;
      if (cut) items = items.slice(cut);
      raw = median(items.map((x) => x.s));
      if (restart) {
        const lo2 = stampS - restart.shortS;
        let c2 = 0;
        while (c2 < items.length && items[c2].v <= lo2) c2++;
        const short = items.slice(c2);
        const sm = median(short.map((x) => x.s));
        const d = (sm - raw) / gap;
        const sg = Math.abs(d) >= restart.jumpU ? Math.sign(d) : 0;
        if (sg !== 0 && sg === sign) streak++;
        else { sign = sg; streak = sg !== 0 ? 1 : 0; }
        if (streak >= restart.confirmN) {
          items = short;
          raw = sm;
          streak = 0; sign = 0; restarts++;
        }
      }
      return true;
    },
    snapshot() {
      return { raw, u: raw === null ? null : (raw - ref.menMedian) / gap, n: items.length, restarts };
    },
    reset() { items = []; raw = null; streak = 0; sign = 0; },
  };
}

/** A resonanceCue whose shown value comes from the candidate's display readout. */
export function wrapCue(cue, cand, ref, clampEdge) {
  if (!cand) return cue;
  const disp = createDisplayReadout({ ref, horizonS: cand.horizonS, restart: cand.restart });
  let last = null, dropped = 0, nb = false;
  return {
    ...cue,
    noteNarrowband(on) {
      if (on && !nb) disp.reset();
      nb = !!on;
      cue.noteNarrowband(on);
    },
    onStamped(te, stampS, value) {
      const delta = last === null ? 0 : Math.max(0, stampS - last);
      last = stampS;
      const adm = cue.onStamped(te, stampS, value);
      if (!adm) dropped += delta;
      else disp.add(stampS - dropped, value);
      return adm;
    },
    snapshot() {
      const s = cue.snapshot();
      const d = disp.snapshot();
      const clamp = d.raw === null ? 0 : d.raw >= clampEdge ? 1 : d.raw <= -clampEdge ? -1 : 0;
      return { ...s, u: d.u, raw: d.raw, clamp, restarts: d.restarts };
    },
  };
}
