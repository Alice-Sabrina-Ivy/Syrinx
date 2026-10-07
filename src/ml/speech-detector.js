// speech-detector.js — streaming speech-presence detector for the
// Perceived Voice meter's utterance gate (low-voice-noise candidate
// "voice-detector-gate", 2026-10-07).
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
  // Fetched at runtime (not bundled): the official release file served by
  // jsDelivr from the GitHub tag, verified against the pinned sha256.
  modelUrl: "https://cdn.jsdelivr.net/gh/snakers4/silero-vad@v6.2.3/src/silero_vad/data/silero_vad.onnx",
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
