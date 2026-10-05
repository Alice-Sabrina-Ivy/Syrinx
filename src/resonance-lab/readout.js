// readout.js — sliding voiced-time readout for one resonance-lab finalist.
//
// Each finalist emits a value every 150 ms (null when it has nothing). Every
// value is stamped with the cumulative VOICED time of the stream at its
// output time (as the benchmark's horizon readouts are), and the readout is
// the candidate's own pooling (median, or mean for le) over the values whose
// stamps fall in the trailing `horizonS` seconds of voiced speech (5 s =
// the benchmark's headline R1 horizon). Silence therefore freezes the
// readout instead of draining it.
//
// Display units: u = (readout - men median) / (women median - men median),
// using the finalist's own 5 s readout distribution over LibriSpeech
// test-clean speakers (reference.json) — 0 = typical adult man in that
// corpus, 1 = typical adult woman. "Jitter" = SD of the last 20 readouts
// (3 s of output) in the same units.

export function createReadout({ agg = "median", horizonS = 5, ref, jitterN = 20 }) {
  const gap = ref.womenMedian - ref.menMedian;
  let items = []; // {v: voiced stamp, s}
  let firstStamp = null;
  let lastStamp = 0;
  const recentU = [];
  let readout = null;
  let n = 0;

  function aggregate(vals) {
    if (!vals.length) return null;
    if (agg === "mean") return vals.reduce((a, b) => a + b, 0) / vals.length;
    const a = Float64Array.from(vals).sort();
    const h = a.length >> 1;
    return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
  }

  return {
    /** Add a stamped value; returns true when the readout changed. */
    add(stampS, s) {
      lastStamp = stampS;
      if (firstStamp === null) firstStamp = stampS;
      if (s === null || !Number.isFinite(s)) return false;
      items.push({ v: stampS, s });
      const lo = stampS - horizonS;
      let cut = 0;
      while (cut < items.length && items[cut].v <= lo) cut++;
      if (cut) items = items.slice(cut);
      const vals = items.map((x) => x.s);
      readout = aggregate(vals);
      n = vals.length;
      const u = (readout - ref.menMedian) / gap;
      recentU.push(u);
      if (recentU.length > jitterN) recentU.shift();
      return true;
    },
    snapshot() {
      let jitter = null;
      if (recentU.length >= 4) {
        const m = recentU.reduce((a, b) => a + b, 0) / recentU.length;
        jitter = Math.sqrt(recentU.reduce((a, b) => a + (b - m) * (b - m), 0) / (recentU.length - 1));
      }
      return {
        raw: readout,
        u: readout === null ? null : (readout - ref.menMedian) / gap,
        n,
        fill: firstStamp === null ? 0 : Math.min(1, (lastStamp - firstStamp) / horizonS),
        voicedS: lastStamp,
        jitter,
      };
    },
    reset() { items = []; firstStamp = null; lastStamp = 0; recentU.length = 0; readout = null; n = 0; },
  };
}
