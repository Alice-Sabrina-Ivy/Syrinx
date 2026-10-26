// faster-candidates.mjs — the pre-registered candidates of the resonance
// responsiveness study (measurements/resonance-faster-prereg-2026-10-26.md).
//
// Every cue-only candidate is a SHOWN readout: add(stampS, s) per admitted
// vtln bin (stampS = the cue's voiced clock with dropped bins taken out, s =
// ln α or null), snapshot() -> { raw, u, restarts }, reset(). It replaces
// only the shown value (u / raw / clamp) of src/resonance/resonanceCue.js;
// fill, voicedS, n, sinceResumeS, the drop rules, narrowband, uPlain (the
// pitch-only warning's input) and the start collection stay the cue's plain
// 5 s readout, so positions and starts are unchanged by construction.
//
// Families (ids as in the pre-registration):
//   S0            the readout shipped at the study (createRestartReadout,
//                 RESTART, halfLifeS: null; E-ewm2.5 is shipped since the
//                 owner's decision of 2026-10-26)
//   P             the plain 5 s median (restart: null; before 2026-10-21)
//   R-s<S>-j<J>-n<N>   the shipped restart rule retuned: short median over the
//                 last S s of voiced time vs the 5 s median, |diff| >= J u with
//                 the same sign on N admitted bins in a row -> keep only the
//                 short window
//   T-s<S>-j<J>-n<N>   two-sample restart: the short median vs the median of
//                 the window's OLDER items (stamp <= newest − S; >= 7 of them,
//                 else no test), same J / N rule and the same restart
//   Z-k<K>-n<N>   scale-adaptive two-sample restart (S = 1.5 s): threshold =
//                 max(0.3 u, K × 1.4826 × MAD of the older items, in u)
//   H<h>          the shipped restart rule on an h s voiced horizon
//   E-tm20 / E-hub / E-ewm<hl>   the shipped restart rule; shown value = the
//                 20 % trimmed mean / Huber M-estimate (c 1.345, MAD scale,
//                 10 iterations from the median) / exponentially weighted
//                 median (weight 2^(−age / hl), age in voiced s) of the items
//   K-q<q>        robust level filter over admitted bins (no restart): random
//                 walk, process variance q u² per voiced s, measurement SD
//                 0.3 u, innovation clipped at 2 SD (Huber)
// Bin-level (not here; faster.mjs bins --trail=N): B-t70, B-t50 = vtln trail
// 70 / 50 voiced frames per bin with the shipped readout.
import { createRestartReadout, RESTART } from "../../src/resonance/resonanceCue.js";

function median(vals) {
  if (!vals.length) return null;
  const a = Float64Array.from(vals).sort();
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}
const trimmedMean = (vals, f) => {
  const a = Float64Array.from(vals).sort();
  const k = Math.floor(a.length * f);
  let s = 0, n = 0;
  for (let i = k; i < a.length - k; i++) { s += a[i]; n++; }
  return n ? s / n : median(vals);
};
function huber(vals, c = 1.345) {
  let m = median(vals);
  const mad = median(vals.map((v) => Math.abs(v - m))) * 1.4826;
  if (!(mad > 0)) return m;
  for (let it = 0; it < 10; it++) {
    let sw = 0, s = 0;
    for (const v of vals) {
      const r = Math.abs(v - m) / mad;
      const w = r <= c ? 1 : c / r;
      sw += w; s += w * v;
    }
    m = s / sw;
  }
  return m;
}
function weightedMedian(vals, ws) {
  const idx = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
  const tot = ws.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const i of idx) { acc += ws[i]; if (acc >= tot / 2) return vals[i]; }
  return vals[idx[idx.length - 1]];
}

/**
 * A generic shown readout: horizon h, a restart test and a statistic.
 * test: null | { kind: "short" | "two" | "z", shortS, jumpU, confirmN, k }
 */
function createShown({ ref, horizonS = 5, test = null, stat = "median", ewmHl = null }) {
  const gap = ref.womenMedian - ref.menMedian;
  let items = [];
  let raw = null, streak = 0, sign = 0, restarts = 0;
  const value = (its, now) => {
    const v = its.map((x) => x.s);
    if (stat === "median") return median(v);
    if (stat === "tm20") return trimmedMean(v, 0.2);
    if (stat === "huber") return huber(v);
    if (stat === "ewm") return weightedMedian(v, its.map((x) => 2 ** (-(now - x.v) / ewmHl)));
    throw new Error(stat);
  };
  return {
    add(stampS, s) {
      if (s === null || !Number.isFinite(s)) return false;
      items.push({ v: stampS, s });
      const lo = stampS - horizonS;
      let cut = 0;
      while (cut < items.length && items[cut].v <= lo) cut++;
      if (cut) items = items.slice(cut);
      const med = median(items.map((x) => x.s));
      if (test) {
        const lo2 = stampS - test.shortS;
        let c2 = 0;
        while (c2 < items.length && items[c2].v <= lo2) c2++;
        const short = items.slice(c2);
        const sm = median(short.map((x) => x.s));
        let d = null, thr = test.jumpU;
        if (test.kind === "short") d = (sm - med) / gap;
        else if (c2 >= 7) {
          const old = items.slice(0, c2).map((x) => x.s);
          const om = median(old);
          d = (sm - om) / gap;
          if (test.kind === "z") thr = Math.max(0.3, (test.k * 1.4826 * median(old.map((x) => Math.abs(x - om)))) / gap);
        }
        const sg = d !== null && Math.abs(d) >= thr ? Math.sign(d) : 0;
        if (sg !== 0 && sg === sign) streak++;
        else { sign = sg; streak = sg !== 0 ? 1 : 0; }
        if (streak >= test.confirmN) {
          items = short;
          streak = 0; sign = 0; restarts++;
        }
      }
      raw = value(items, stampS);
      return true;
    },
    snapshot() { return { raw, u: raw === null ? null : (raw - ref.menMedian) / gap, restarts }; },
    reset() { items = []; raw = null; streak = 0; sign = 0; },
  };
}

function createKalman({ ref, q, r = 0.3, c = 2 }) {
  const gap = ref.womenMedian - ref.menMedian;
  let x = null, P = 0, last = null;
  return {
    add(stampS, s) {
      if (s === null || !Number.isFinite(s)) return false;
      const z = (s - ref.menMedian) / gap;
      if (x === null) { x = z; P = r * r; last = stampS; return true; }
      P += q * Math.max(0, stampS - last);
      last = stampS;
      const S = P + r * r;
      const e = z - x, lim = c * Math.sqrt(S);
      const ec = Math.max(-lim, Math.min(lim, e));
      const K = P / S;
      x += K * ec;
      P = (1 - K) * P;
      return true;
    },
    snapshot() { return { raw: x === null ? null : x * gap + ref.menMedian, u: x, restarts: 0 }; },
    reset() { x = null; P = 0; last = null; },
  };
}

const sh = RESTART; // { shortS 1.5, jumpU 0.6, confirmN 4 }
const shipTest = { kind: "short", shortS: sh.shortS, jumpU: sh.jumpU, confirmN: sh.confirmN };
export const CANDIDATES = {
  // the study's S0 = the readout shipped until 2026-10-26 (shown as the median)
  S0: { family: "S0", make: (ref) => createRestartReadout({ ref, halfLifeS: null }) },
  P: { family: "P", make: (ref) => createRestartReadout({ ref, restart: null }) },
};
for (const kind of ["short", "two"]) {
  for (const shortS of [1.0, 1.5]) for (const jumpU of [0.4, 0.5, 0.6]) for (const confirmN of [2, 3, 4]) {
    const id = `${kind === "short" ? "R" : "T"}-s${shortS.toFixed(1)}-j${jumpU.toFixed(1)}-n${confirmN}`;
    CANDIDATES[id] = { family: id[0], make: (ref) => createShown({ ref, test: { kind, shortS, jumpU, confirmN } }) };
  }
}
for (const k of [1.5, 2.0, 2.5]) for (const confirmN of [2, 4]) {
  CANDIDATES[`Z-k${k.toFixed(1)}-n${confirmN}`] = { family: "Z", make: (ref) => createShown({ ref, test: { kind: "z", shortS: 1.5, jumpU: 0.3, confirmN, k } }) };
}
for (const h of [4.0, 3.5]) CANDIDATES[`H${h.toFixed(1)}`] = { family: "H", make: (ref) => createShown({ ref, horizonS: h, test: shipTest }) };
CANDIDATES["E-tm20"] = { family: "E", make: (ref) => createShown({ ref, test: shipTest, stat: "tm20" }) };
CANDIDATES["E-hub"] = { family: "E", make: (ref) => createShown({ ref, test: shipTest, stat: "huber" }) };
for (const hl of [2.5, 1.5]) CANDIDATES[`E-ewm${hl.toFixed(1)}`] = { family: "E", make: (ref) => createShown({ ref, test: shipTest, stat: "ewm", ewmHl: hl }) };
for (const q of [0.02, 0.05, 0.1]) CANDIDATES[`K-q${q}`] = { family: "K", make: (ref) => createKalman({ ref, q }) };
// bin-level: the shipped readout over bins of a vtln run with another trail
export const BIN_CANDIDATES = { "B-t70": 70, "B-t50": 50 };
export const FAMILY_ORDER = ["S0", "R", "T", "Z", "H", "E", "K", "B"];
// the generic readout with the shipped test must equal the shipped module
export const _createShown = createShown;
