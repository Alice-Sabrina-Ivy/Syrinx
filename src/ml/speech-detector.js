// speech-detector.js — streaming speech-presence detector for the gender
// worker's utterance gate (low-voice-noise candidate "voice-detector-gate",
// 2026-10-07). It was built for the always-on Perceived Voice meter; since
// the cue strip replaced that meter it runs only while the opt-in "Likely
// heard as" panel is on (the gender worker's only consumer).
//
// Why: the utterance gate opened only on pitch voicing. At 0 dB SNR the
// pitch tracker loses men's (low) voices far more often than women's
// (confidence 0.35-0.5 frames, above-400 Hz harmonic locks, guard
// vetoes), so the meter showed a number for ~80 % of men's speaking time
// vs ~90 % of women's (measurements/low-voice-noise-2026-10-07.md). Every
// pitch-evidence lever that recovered men also voiced noise about 1:1.
// A dedicated speech detector separates speech from machine noise without
// periodicity evidence, so the gate can ask it "is someone speaking"
// while pitch only shapes the held-note test.
//
// Detector: Silero VAD v6.2.3 (MIT; github.com/snakers4/silero-vad tag
// v6.2.3, src/silero_vad/data/silero_vad.onnx, 2,327,524 bytes, sha256
// below), run exactly as its reference streaming wrapper
// (utils_vad.py OnnxWrapper): 16 kHz, 512-sample chunks, each prefixed
// with the previous chunk's last 64 samples (zeros before the first),
// LSTM state carried chunk to chunk. One speech probability per 32 ms.
// Benchmarked on the voice-detector branch
// (measurements/voice-detector-benchmark-2026-10-06.md): it separates
// running speech from machine noise well (at p >= 0.5 it removes 98 % of
// the app's false pitch line on real noise-only audio and keeps all
// FDA / PTDB-TUG speech) but scores held notes and sustained vowels near
// 0 — which is why it failed as a pitch-display gate and why it suits this
// meter, which scores running speech only.
//
// Pure framing logic here (Node-testable); the ONNX session is injected.

export const SPEECH_DETECTOR = Object.freeze({
  sampleRate: 16000,
  chunk: 512,      // samples per probability (32 ms)
  context: 64,     // past samples prefixed to each chunk
  stateSize: 2 * 128,
  // Fetched at runtime (not bundled) from the project's Hugging Face
  // mirror of the official release file (Alice-Sabrina-Ivy/
  // silero-vad-v6.2.3-onnx, byte-identical to the GitHub tag), pinned to
  // the mirror's commit and verified against the pinned sha256. HF's
  // /resolve/ redirect is `no-store`, so loadVerifiedModel keeps its own
  // Cache Storage copy (measurements/low-voice-noise-2026-10-07.md,
  // "Model hosting").
  modelUrl: "https://huggingface.co/Alice-Sabrina-Ivy/silero-vad-v6.2.3-onnx/resolve/6c8942f41b1e6a85ef5b092537f0db565f099c49/silero_vad.onnx",
  modelSha256: "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3",
});

// Cuts a 16 kHz stream into the detector's input frames and stamps each
// with the audio-clock time (ms) of its last sample.
//   push(samples16k, endTsMs) -> [{ input: Float32Array(context + chunk), ts }]
// endTsMs = audio-clock time of the last sample of `samples16k` (the
// capture chunk's contextTime, which both capture paths stamp at the
// chunk's end). The returned inputs are fresh copies.
export function createSpeechFramer({ chunk = SPEECH_DETECTOR.chunk, context = SPEECH_DETECTOR.context, sampleRate = SPEECH_DETECTOR.sampleRate } = {}) {
  const buf = new Float32Array(context + chunk); // [0, context) = past context
  let fill = 0;                                  // samples of the current chunk in buf[context..]
  return {
    push(samples, endTsMs) {
      const out = [];
      const n = samples.length;
      for (let i = 0; i < n; i++) {
        buf[context + fill] = samples[i];
        fill++;
        if (fill === chunk) {
          // the frame ends at sample i of this push
          const ts = endTsMs - ((n - 1 - i) * 1000) / sampleRate;
          out.push({ input: buf.slice(), ts });
          buf.copyWithin(0, chunk, chunk + context);
          fill = 0;
        }
      }
      return out;
    },
    reset() { buf.fill(0); fill = 0; },
  };
}

// Silero streaming runner over an onnxruntime(-web) session.
//   ort: the onnxruntime module (InferenceSession, Tensor); session: an
//   InferenceSession created from the model bytes.
//   run(input) -> Promise<probability>; reset() clears the LSTM state.
export function createSileroRunner(ort, session) {
  const { context, chunk, stateSize, sampleRate } = SPEECH_DETECTOR;
  const sr = new ort.Tensor("int64", BigInt64Array.from([BigInt(sampleRate)]), []);
  let state = new ort.Tensor("float32", new Float32Array(stateSize), [2, 1, 128]);
  return {
    async run(input) {
      const x = new ort.Tensor("float32", input, [1, context + chunk]);
      const out = await session.run({ input: x, state, sr });
      state = out.stateN;
      return out.output.data[0];
    },
    reset() { state = new ort.Tensor("float32", new Float32Array(stateSize), [2, 1, 128]); },
  };
}

// Hex sha256 of an ArrayBuffer (WebCrypto; workers and Node >= 19).
export async function sha256Hex(bytes) {
  const d = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const MODEL_CACHE_NAME = "syrinx-speech-detector";

// The model's bytes, verified against `sha256`, from Cache Storage when a
// good copy is there, else from the network (then stored for next time).
//   -> { bytes: ArrayBuffer, source: "cache" | "network" }
// Throws only on a network / HTTP failure or a hash mismatch of the
// fetched bytes. Cache Storage problems (missing outside secure contexts,
// throwing in some private windows, quota) fall back to a plain fetch.
// fetchFn / cachesApi are injectable for tests.
export async function loadVerifiedModel({ url, sha256, fetchFn = globalThis.fetch, cachesApi = globalThis.caches, cacheName = MODEL_CACHE_NAME } = {}) {
  const key = `${url}${url.includes("?") ? "&" : "?"}sha256=${sha256}`;
  let cache = null;
  try { cache = cachesApi ? await cachesApi.open(cacheName) : null; } catch { cache = null; }
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) {
        const bytes = await hit.arrayBuffer();
        if ((await sha256Hex(bytes)) === sha256) return { bytes, source: "cache" };
        await cache.delete(key);
      }
    } catch { /* unreadable entry: fetch instead */ }
  }
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`speech detector model HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  if ((await sha256Hex(bytes)) !== sha256) throw new Error("speech detector model hash mismatch");
  if (cache) {
    try {
      await cache.put(key, new Response(bytes.slice(0), { headers: { "content-type": "application/octet-stream" } }));
      // Drop copies of any other model version.
      for (const req of await cache.keys()) {
        if (req.url !== key) await cache.delete(req);
      }
    } catch { /* not cached this time; the model still loads */ }
  }
  return { bytes, source: "network" };
}
