// recorder.js — Voice Shaper's recording, inside the voice-preview worker
// (pure; tests/voice-preview/recorder-test.js). measurements/voice-preview-phase1-2026-10-19.md §3.
//
// Raw audio: whole capture chunks ({ buffer, contextTime }, ~25 ms each, broadcast to
// every capture consumer) copied unchanged into a buffer pre-allocated for maxS seconds
// at the capture rate. Auto-stop before the chunk that would take the recording past
// maxS x rate samples (8.000 s at 48 kHz, 7.996 s at 44.1 kHz with 1102-sample chunks);
// chunks after the stop are dropped.
//
// Posted pitch track (F-S): the pitch worker posts each decoded frame with the
// contextTime of its own chunk, and every consumer port receives the same contextTime,
// so a posted value is assigned to recorded chunk k by exact equality; failing that, to
// the nearest recorded chunk within half a chunk. Values for chunks outside the
// recording are ignored, and the first value for a chunk wins. The track is a
// Float32Array with one value per recorded chunk (Hz, 0 = unvoiced) — the spike's
// format; it is complete when the last chunk's value has arrived (or when the worker's
// 500 ms timeout finalises it: missing values stay 0).

export function createRecorder({ sampleRate, maxS = 8, minS = 3 }) {
  if (!(sampleRate > 0)) throw new Error("recorder: sampleRate required");
  const cap = Math.floor(maxS * sampleRate);
  const buf = new Float32Array(cap);
  const times = [];       // contextTime of each recorded chunk
  const starts = [];      // first sample of each recorded chunk
  const lens = [];
  let fill = 0;
  let stopped = null;     // null while recording; "user" | "max" | "cancel" after
  let track = null;       // Float32Array once stopped
  let notched = null;     // Uint8Array once stopped
  let got = null;         // Uint8Array: value received for chunk k
  let pendingPitch = [];  // posted values that arrived while recording
  let finalised = false;
  let levelAcc = { ss: 0, n: 0, peak: 0, chunks: 0 };

  const seconds = () => fill / sampleRate;

  function stop(reason) {
    if (stopped) return false;
    stopped = reason;
    const n = times.length;
    track = new Float32Array(n);
    notched = new Uint8Array(n);
    got = new Uint8Array(n);
    const early = pendingPitch;
    pendingPitch = [];
    for (const m of early) assign(m);
    return true;
  }

  /** Index of the recorded chunk a posted contextTime belongs to, or -1. */
  function chunkOf(ct) {
    if (typeof ct !== "number" || !Number.isFinite(ct) || times.length === 0) return -1;
    // exact equality (the normal case)
    let lo = 0, hi = times.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] === ct) return mid;
      if (times[mid] < ct) lo = mid + 1; else hi = mid - 1;
    }
    // nearest within half a chunk (lo = first index with times[lo] > ct)
    let best = -1, bestD = Infinity;
    for (const k of [lo - 1, lo]) {
      if (k < 0 || k >= times.length) continue;
      const d = Math.abs(times[k] - ct);
      if (d < bestD) { best = k; bestD = d; }
    }
    if (best < 0) return -1;
    return bestD <= 0.5 * lens[best] / sampleRate ? best : -1;
  }

  function assign(m) {
    const k = chunkOf(m.contextTime);
    if (k < 0 || got[k]) return false;
    got[k] = 1;
    track[k] = m.pitch > 0 ? m.pitch : 0;
    notched[k] = m.notched ? 1 : 0;
    return true;
  }

  return {
    sampleRate,
    capSamples: cap,
    /**
     * One capture chunk. Returns { accepted, stopped: null | "max", level: null | { rms, peak, seconds } }
     * (level every 4th accepted chunk, over those 4 chunks).
     */
    pushChunk(samples, contextTime) {
      if (stopped) return { accepted: false, stopped: null, level: null };
      const len = samples.length;
      if (len === 0) return { accepted: false, stopped: null, level: null };
      if (fill + len > cap) {
        stop("max");
        return { accepted: false, stopped: "max", level: null };
      }
      buf.set(samples, fill);
      times.push(contextTime);
      starts.push(fill);
      lens.push(len);
      fill += len;
      for (let i = 0; i < len; i++) {
        const v = samples[i];
        levelAcc.ss += v * v;
        const a = Math.abs(v);
        if (a > levelAcc.peak) levelAcc.peak = a;
      }
      levelAcc.n += len;
      levelAcc.chunks++;
      let level = null;
      if (levelAcc.chunks === 4) {
        level = { rms: Math.sqrt(levelAcc.ss / levelAcc.n), peak: levelAcc.peak, seconds: seconds() };
        levelAcc = { ss: 0, n: 0, peak: 0, chunks: 0 };
      }
      // the next chunk of this size would not fit: stop now, before it arrives
      if (fill + len > cap) {
        stop("max");
        return { accepted: true, stopped: "max", level };
      }
      return { accepted: true, stopped: null, level };
    },
    /** End the recording (user Stop / cancel). Returns false if it had already stopped. */
    stop,
    /** One posted pitch value ({ contextTime, pitch (Hz or null), notched }). Returns true if it was used. */
    addPitch(m) {
      if (finalised || !m) return false;
      if (!stopped) { pendingPitch.push(m); return false; }
      return assign(m);
    },
    get stopped() { return stopped; },
    get seconds() { return seconds(); },
    get chunks() { return times.length; },
    tooShort: () => seconds() < minS,
    /** True once every recorded chunk has its posted value (the last one included). */
    trackComplete: () => !!stopped && times.length > 0 && got[times.length - 1] === 1,
    /** Stop accepting posted values; missing ones stay 0. */
    finalise() { finalised = true; },
    get finalised() { return finalised; },
    /** The recording (a view of the pre-allocated buffer: whole chunks only). */
    pcm: () => buf.subarray(0, fill),
    track: () => track,
    notched: () => notched,
    /** Hops whose posted value arrived (diagnostics). */
    received: () => (got ? got.reduce((s, v) => s + v, 0) : 0),
    chunkTimes: () => times.slice(),
    chunkStarts: () => starts.slice(),
    chunkLens: () => lens.slice(),
  };
}
