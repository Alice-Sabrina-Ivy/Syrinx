// retrack.js — Voice Shaper's re-tracking: when the recording went through noise reduction, the
// pitch track WORLD is given is re-made from the cleaned recording by the app's own pitch worker
// (src/dsp/pitch-worker.js, unchanged: a fresh instance, without the voice detector), started by
// the voice-preview worker. The posted track was made from the noisy audio; on the noise study's
// mixtures this recovers about half of the gap between that track and the clean recording's
// (measurements/voice-shaper-noise-2026-10-25.md).
//
//   createRetracker(sampleRate, createWorker, { timeoutMs }) -> {
//     chunk(len)   a recorded chunk of `len` samples (in recording order): the result has one value
//                  per declared chunk (Hz, 0 = unvoiced) — the posted track's format
//     push(samples) cleaned audio, in order (any length); each declared chunk is sent to the pitch
//                  worker as soon as its samples are all there
//     finish()     -> Promise<Float32Array>: everything has been pushed; resolves when the last
//                  chunk's value has arrived, or timeoutMs after finish (missing values stay 0);
//                  rejects if the pitch worker reports an error
//     cancel()     stop and terminate the pitch worker }
//   createWorker() returns a Worker-like object (postMessage, onmessage, onerror, terminate)
//   running the pitch worker; it is started at once (so it is warm by the end of a recording)
//   and always terminated.
//
//   retrack(pcm, sampleRate, lens, createWorker, opts) -> Promise<Float32Array>: the same for a
//   whole recording at once.

/** Zero chunks fed after the recording so the decode delay (L = 2 hops) flushes its last frames. */
export const FLUSH_CHUNKS = 4;

export function createRetracker(sampleRate, createWorker, { timeoutMs = 5000 } = {}) {
  const lens = [];
  const ends = [];        // contextTime of each sent chunk: its end on the recording's clock (s)
  const values = [];
  let endSample = 0;      // end of the declared chunks, in samples
  let buf = new Float32Array(0), bufStart = 0, bufLen = 0; // cleaned audio not sent yet
  let sent = 0;           // chunks sent
  let w = null, port = null;
  let resolveP = null, rejectP = null, timer = null, settled = false, failed = null;
  let finishing = false;

  const close = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    try { w && w.terminate(); } catch { /* already gone */ }
    w = null;
  };
  const settle = (err) => {
    if (settled) return;
    settled = true;
    close();
    if (err) rejectP ? rejectP(err) : (failed = err);
    else resolveP && resolveP(Float32Array.from(values.slice(0, lens.length), (v) => v || 0));
  };
  /** The chunk whose end is the posted contextTime (exact, else nearest within half a chunk). */
  function chunkOf(ct) {
    let lo = 0, hi = ends.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ends[mid] === ct) return mid;
      if (ends[mid] < ct) lo = mid + 1; else hi = mid - 1;
    }
    let best = -1, bestD = Infinity;
    for (const k of [lo - 1, lo]) if (k >= 0 && k < ends.length && Math.abs(ends[k] - ct) < bestD) { best = k; bestD = Math.abs(ends[k] - ct); }
    return best >= 0 && bestD <= 0.5 * lens[Math.min(best, lens.length - 1)] / sampleRate ? best : -1;
  }
  function send(samples, end) {
    ends.push(end);
    port.postMessage({ buffer: samples.buffer, contextTime: end }, [samples.buffer]);
  }
  function drain() {
    if (!port) return;
    while (sent < lens.length) {
      const L = lens[sent];
      if (bufLen < L) break;
      const s = buf.slice(bufStart, bufStart + L);
      bufStart += L; bufLen -= L;
      let end = 0; for (let k = 0; k <= sent; k++) end += lens[k];
      send(s, end / sampleRate);
      sent++;
    }
  }

  try {
    w = createWorker();
    w.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.type === "status" && m.status === "error") { settle(new Error(`pitch worker: ${m.message}`)); return; }
      if (m.type !== "pitch") return;
      const k = chunkOf(m.contextTime);
      if (k < 0 || k >= lens.length) return;
      values[k] = m.pitch > 0 ? m.pitch : 0;
      if (finishing && k === lens.length - 1) settle(null);
    };
    w.onerror = (e) => settle(new Error(`pitch worker failed: ${e?.message ?? e}`));
    w.postMessage({ type: "init", inputSampleRate: sampleRate });
    const ch = new MessageChannel();
    port = ch.port1;
    w.postMessage({ type: "audioPort", port: ch.port2 }, [ch.port2]);
  } catch (err) {
    failed = err;
    close();
  }

  return {
    chunk(len) { lens.push(len); endSample += len; drain(); },
    push(samples) {
      if (failed || settled || samples.length === 0) return;
      if (bufStart + bufLen + samples.length > buf.length) {
        const nb = new Float32Array(Math.max(2 * buf.length, bufLen + samples.length));
        nb.set(buf.subarray(bufStart, bufStart + bufLen));
        buf = nb; bufStart = 0;
      }
      buf.set(samples, bufStart + bufLen);
      bufLen += samples.length;
      drain();
    },
    finish() {
      return new Promise((resolve, reject) => {
        if (failed) { reject(failed); return; }
        resolveP = resolve; rejectP = reject; finishing = true;
        drain();
        if (lens.length === 0) { settle(null); return; }
        const C = lens[lens.length - 1];
        let end = endSample;
        for (let j = 0; j < FLUSH_CHUNKS; j++) { end += C; ends.push(end / sampleRate); port.postMessage({ buffer: new Float32Array(C).buffer, contextTime: end / sampleRate }); }
        if (values[lens.length - 1] !== undefined) { settle(null); return; }
        timer = setTimeout(() => settle(null), timeoutMs);
      });
    },
    cancel() { settled = true; close(); },
  };
}

export function retrack(pcm, sampleRate, lens, createWorker, opts) {
  const r = createRetracker(sampleRate, createWorker, opts);
  for (const L of lens) r.chunk(L);
  r.push(pcm);
  return r.finish();
}
