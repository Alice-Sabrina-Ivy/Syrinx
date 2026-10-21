// firered-vad.js — the voice gate: a FireRedVAD voice detector on the pitch
// worker's 16 kHz stream, and the gate that hides the pitch display (and the
// resonance position and HNR readout) while it hears no voice.
//
// Why: the pitch line paints on machine noise (fans, hums) that the notch
// and the harmonic guard let through. The 2026-10-20 off-the-shelf screen
// (measurements/offtheshelf-screen-2026-10-20.md, "Addendum: relaxed rules")
// picked FireRedVAD at the "R1 h" point — smoothing w5, p >= 0.55, 2 s
// hangover — at a cost on held notes / sustained vowels the user accepted
// (user decision 2026-10-20). The pre-registered confirmation on fresh public
// data passed (measurements/firered-confirmation-2026-10-21.md). Built as a
// PC try-out on branch noise-detector-tryout, merged into cue-strip on
// 2026-10-21 (user decision). Design note:
// measurements/noise-detector-tryout-2026-10-20.md.
//
// Model: FireRedVAD Stream-VAD, the official streaming ONNX with cache I/O
// (github.com/FireRedTeam/FireRedVAD @ c30ec49, Apache-2.0). Loaded at runtime
// from the project's Hugging Face mirror once its commit is pinned below
// (`mirrorCommit`), else from the app's own models/firered/ (filled by
// scripts/fetch-firered-model.mjs; not committed). Inputs: `feat` [1, T, 80]
// (CMVN'd log-mel fbank) and `caches_in` [8, 1, 128, 19]; outputs `probs`
// [1, T, 1] and `caches_out`.
// The DFSMN looks back 19 frames per layer and never ahead, so frame i
// depends on 16 kHz samples [0, 160 i + 400) only.
//
// Everything here is pure (Node-testable); onnxruntime-web is injected.
//   createFireRedFrontend(cmvn)   Kaldi 80-band fbank + CMVN, streaming
//   createVoiceGate()             the R1 h decision, exactly as the screen
//                                 scored it (see createVoiceGate)
//   createFireRedRunner(ort, s)   the ONNX session with its cache carried
//   createVoiceDetector(...)      the three, per pitch-worker hop
//   fireredModelSource(...)       where the model files come from
//   loadFireRedFiles(source)      both files, size + sha256 checked
//   loadVerified(url, spec)       fetch one model file, size + sha256 checked

import { loadVerifiedModel } from "../ml/speech-detector.js";

export const FIRERED_MODEL = Object.freeze({
  repo: "https://github.com/FireRedTeam/FireRedVAD",
  commit: "c30ec49e8cc69642b0ee65362eba11b9d11c6e54",
  license: "Apache-2.0",
  // Hosting (user decision 2026-10-21), as the Silero speech detector
  // (src/ml/speech-detector.js SPEECH_DETECTOR): the project's Hugging Face
  // mirror of the two official files (plus LICENSE and README.md there),
  // pinned to the mirror's commit and checked against the sha256 below, with
  // a Cache Storage copy (loadVerifiedModel). The mirror is uploaded by the
  // repo owner; until its commit is filled in here, `mirrorCommit` stays null
  // and the files load from the app's own `dir` instead.
  mirror: "Alice-Sabrina-Ivy/fireredvad-stream-vad-onnx",
  mirrorCommit: null,
  // Under the app's base URL (public/models/firered/ in the source tree,
  // filled by scripts/fetch-firered-model.mjs): used while mirrorCommit is null.
  dir: "models/firered/",
  files: Object.freeze([
    Object.freeze({
      key: "onnx",
      name: "fireredvad_stream_vad_with_cache.onnx",
      upstreamPath: "pretrained_models/onnx_models/fireredvad_stream_vad_with_cache.onnx",
      bytes: 2306042,
      sha256: "b3c97836130dc34fc32d56fab551e88cf9454511de2b3c250a5e6578dee74b93",
    }),
    Object.freeze({
      key: "cmvn",
      name: "cmvn.ark",
      upstreamPath: "pretrained_models/onnx_models/cmvn.ark",
      bytes: 1311,
      sha256: "c87f6f13edf0f0ec7535ddfc9cc3387d9268cb234b70182d566c5e2edf3ca473",
    }),
  ]),
});

// The operating point: the screen's "R1 h" point (w5, p >= 0.55, 2000 ms).
export const FIRERED_GATE = Object.freeze({ smooth: 5, threshold: 0.55, hangoverMs: 2000 });

// When a frame may be used: the screen's rule. Its candidate.json declared
// first_avail_ms 26 (frame i needs 16 kHz samples [0, 160 i + 400), complete
// at 25 + 10 i ms, plus 1 ms the screen added for its resampled streams; one
// value for every stream), and score.py hop_probs counts the frames available
// at hop time t as floor((t - 0.026) / 0.010 + 1e-9) + 1. The app uses the
// same count (capped at the frames the front end has produced), so it makes
// the decisions the screen scored hop for hop. (Until the 2026-10-20 review
// the app used frames as soon as their samples arrived, 25 + 10 i ms: 1 ms
// earlier, which changed the decisions near the start of some streams.)
export const FIRST_AVAIL_MS = 26;
export function framesAvailableAt(t) {
  const i = Math.floor((t - FIRST_AVAIL_MS / 1000) / (FBANK.frameShift / FBANK.sampleRate) + 1e-9);
  return i < 0 ? 0 : i + 1;
}

export const FBANK = Object.freeze({
  sampleRate: 16000,
  frameLength: 400,   // 25 ms
  frameShift: 160,    // 10 ms
  nfft: 512,
  numMel: 80,
  lowHz: 20,
  preemph: 0.97,
});
export const CACHE_DIMS = Object.freeze([8, 1, 128, 19]);
const FLT_EPSILON = 1.1920928955078125e-7; // float32 machine epsilon (Kaldi's log floor)

// ------------------------------------------------------------------ files
// A load failure of a model file (not there, not the pinned file, network
// error) carries code "unavailable": the gate then stays off, pitch is shown
// as before, and Settings says the detector could not load.
function unavailable(message) {
  return Object.assign(new Error(message), { code: "unavailable" });
}

// Fetches one model file and checks its size and sha256 (WebCrypto, where the
// context has it). Throws code "unavailable" when the file is not there or is
// not the pinned file (e.g. a dev server's HTML fallback page).
export async function loadVerified(url, spec, { fetchFn = globalThis.fetch } = {}) {
  let res;
  try { res = await fetchFn(url); } catch (err) { throw unavailable(`${spec.name}: ${err?.message || err}`); }
  if (!res.ok) throw unavailable(`${spec.name}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length !== spec.bytes) throw unavailable(`${spec.name}: ${bytes.length} bytes, expected ${spec.bytes}`);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const d = new Uint8Array(await subtle.digest("SHA-256", bytes));
    const hex = Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
    if (hex !== spec.sha256) throw unavailable(`${spec.name}: sha256 mismatch`);
  }
  return bytes;
}

// Where the model files come from:
//   { kind: "mirror", base }  the Hugging Face mirror at the pinned commit
//                             (when model.mirrorCommit is set)
//   { kind: "app", base }     the app's own models/firered/ (appBaseUrl: that
//                             folder's absolute URL), while mirrorCommit is null
//   null                      no source (no mirror and no app URL, e.g. the
//                             Node harnesses that drive the hook)
export function fireredModelSource({ appBaseUrl = null, model = FIRERED_MODEL } = {}) {
  if (model.mirrorCommit) {
    return { kind: "mirror", base: `https://huggingface.co/${model.mirror}/resolve/${model.mirrorCommit}/` };
  }
  return appBaseUrl ? { kind: "app", base: appBaseUrl } : null;
}

// Cache Storage name of the mirrored files: one cache per file, because
// loadVerifiedModel drops every other entry of its cache (older versions).
export const FIRERED_CACHE_PREFIX = "syrinx-voice-detector-";

// Both model files from `source` -> { onnx: Uint8Array, cmvn: Uint8Array },
// each checked against its pinned size and sha256. Mirror: through
// loadVerifiedModel (a good Cache Storage copy first, else the network, then
// stored). App: a plain fetch of the app's own static files, as before the
// mirror. Any failure throws code "unavailable". fetchFn / cachesApi / model
// are injectable for tests.
export async function loadFireRedFiles(source, { fetchFn = globalThis.fetch, cachesApi = globalThis.caches, model = FIRERED_MODEL } = {}) {
  if (!source || typeof source.base !== "string") throw unavailable("no model source");
  const spec = (k) => model.files.find((f) => f.key === k);
  const one = async (f) => {
    if (source.kind !== "mirror") return loadVerified(source.base + f.name, f, { fetchFn });
    let got;
    try {
      got = await loadVerifiedModel({ url: source.base + f.name, sha256: f.sha256, fetchFn, cachesApi, cacheName: FIRERED_CACHE_PREFIX + f.key });
    } catch (err) {
      // (loadVerifiedModel words its errors for the Silero model it was written for)
      throw unavailable(`${f.name}: ${String(err?.message || err).replace(/^speech detector model /, "")}`);
    }
    const bytes = new Uint8Array(got.bytes);
    if (bytes.length !== f.bytes) throw unavailable(`${f.name}: ${bytes.length} bytes, expected ${f.bytes}`);
    return bytes;
  };
  const [onnx, cmvn] = await Promise.all([one(spec("onnx")), one(spec("cmvn"))]);
  return { onnx, cmvn };
}

// Are the app's own model files there (source kind "app")? cmvn.ark fetched
// and checked; the ONNX file by a HEAD request (its size when the server
// sends one). Throws like loadVerified.
export async function probeModel(base, { fetchFn = globalThis.fetch } = {}) {
  const [onnxSpec, cmvnSpec] = ["onnx", "cmvn"].map((k) => FIRERED_MODEL.files.find((f) => f.key === k));
  await loadVerified(base + cmvnSpec.name, cmvnSpec, { fetchFn });
  let res;
  try { res = await fetchFn(base + onnxSpec.name, { method: "HEAD" }); } catch (err) { throw unavailable(String(err?.message || err)); }
  const len = res.headers?.get?.("content-length");
  if (!res.ok || (len && Number(len) !== onnxSpec.bytes)) throw unavailable(`${onnxSpec.name}: not found`);
  return true;
}

// ------------------------------------------------------------------ CMVN
// Kaldi binary matrix (DM / FM) of global CMVN stats -> { mean, istd }
// (Float64Array(80) each), as fireredvad's CMVN.read_kaldi_cmvn and the
// screen's firered.py read_kaldi_cmvn.
export function parseKaldiCmvn(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] !== 0 || b[1] !== 0x42) throw new Error("cmvn.ark: not a Kaldi binary matrix");
  const tok = String.fromCharCode(b[2], b[3], b[4]);
  let o = 5;
  if (b[o] !== 4 || b[o + 5] !== 4) throw new Error("cmvn.ark: unexpected int size");
  const rows = dv.getInt32(o + 1, true);
  const cols = dv.getInt32(o + 6, true);
  o += 10;
  let read;
  if (tok === "DM ") read = (i) => dv.getFloat64(o + 8 * i, true);
  else if (tok === "FM ") read = (i) => dv.getFloat32(o + 4 * i, true);
  else throw new Error(`cmvn.ark: unknown matrix type "${tok}"`);
  if (rows !== 2) throw new Error("cmvn.ark: stats must have 2 rows");
  const dim = cols - 1;
  const count = read(dim);
  const mean = new Float64Array(dim);
  const istd = new Float64Array(dim);
  for (let j = 0; j < dim; j++) {
    const m = read(j) / count;
    const v = Math.max(read(cols + j) / count - m * m, 1e-20);
    mean[j] = m;
    istd[j] = 1 / Math.sqrt(v);
  }
  return { mean, istd, dim };
}

// ------------------------------------------------------------------ fbank
function melScale(f) { return 1127.0 * Math.log(1.0 + f / 700.0); }

// Kaldi MelBanks (20 Hz .. Nyquist, 80 bins, no VTLN): for each bin the
// first FFT bin index and its weights; the Nyquist bin gets weight 0 (Kaldi).
function melBanks() {
  const { sampleRate, nfft, numMel, lowHz } = FBANK;
  const nb = nfft / 2;
  const lo = melScale(lowHz);
  const hi = melScale(sampleRate / 2);
  const d = (hi - lo) / (numMel + 1);
  const m = new Float64Array(nb);
  for (let k = 0; k < nb; k++) m[k] = melScale((k * sampleRate) / nfft);
  const banks = [];
  for (let b = 0; b < numMel; b++) {
    const l = lo + b * d, c = lo + (b + 1) * d, r = lo + (b + 2) * d;
    let first = -1;
    const w = [];
    for (let k = 0; k < nb; k++) {
      if (m[k] > l && m[k] < r) {
        if (first < 0) first = k;
        w.push(m[k] <= c ? (m[k] - l) / (c - l) : (r - m[k]) / (r - c));
      }
    }
    banks.push({ first: Math.max(first, 0), w: Float64Array.from(w) });
  }
  return banks;
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const { frameLength, nfft } = FBANK;
  const win = new Float64Array(frameLength);
  for (let n = 0; n < frameLength; n++) win[n] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (frameLength - 1)), 0.85); // povey
  const bits = Math.log2(nfft);
  const rev = new Uint32Array(nfft);
  for (let i = 0; i < nfft; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(nfft / 2), sin = new Float64Array(nfft / 2);
  for (let i = 0; i < nfft / 2; i++) { cos[i] = Math.cos((-2 * Math.PI * i) / nfft); sin[i] = Math.sin((-2 * Math.PI * i) / nfft); }
  SHARED = { win, rev, cos, sin, banks: melBanks() };
  return SHARED;
}

// In-place radix-2 complex FFT (re, im of length nfft).
function fft(re, im, S) {
  const n = re.length;
  const { rev, cos, sin } = S;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let s = 0; s < n; s += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = sin[k * step];
        const a = s + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

// Log-mel fbank of one 400-sample frame (16 kHz float samples, int16 scale
// applied here: x * 32768, not rounded) -> out (Float64Array(80)). Kaldi
// options of fireredvad/core/audio_feat.py: dither 0, DC removal,
// pre-emphasis 0.97, povey window, 512-point power spectrum, log floored at
// FLT_EPSILON (the screen's firered.py fbank, checked against
// kaldi_native_fbank there).
//   params: { preemph, scale } — only tests change them (a deliberately broken
//   front end must fail the parity test).
export const FBANK_PARAMS = Object.freeze({ preemph: FBANK.preemph, scale: 32768.0 });
export function fbankFrame(samples, offset, out, work, params = FBANK_PARAMS) {
  const S = shared();
  const { frameLength, nfft } = FBANK;
  const { preemph, scale } = params;
  const re = work.re, im = work.im, pw = work.pw;
  let sum = 0;
  for (let n = 0; n < frameLength; n++) { const v = samples[offset + n] * scale; re[n] = v; sum += v; }
  const mean = sum / frameLength;
  for (let n = 0; n < frameLength; n++) re[n] -= mean;
  for (let n = frameLength - 1; n > 0; n--) re[n] -= preemph * re[n - 1];
  re[0] -= preemph * re[0];
  for (let n = 0; n < frameLength; n++) re[n] *= S.win[n];
  re.fill(0, frameLength);
  im.fill(0);
  fft(re, im, S);
  for (let k = 0; k <= nfft / 2; k++) pw[k] = re[k] * re[k] + im[k] * im[k];
  for (let b = 0; b < S.banks.length; b++) {
    const { first, w } = S.banks[b];
    let e = 0;
    for (let j = 0; j < w.length; j++) e += w[j] * pw[first + j];
    out[b] = Math.log(Math.max(e, FLT_EPSILON));
  }
  return out;
}

export function makeFbankWork() {
  return { re: new Float64Array(FBANK.nfft), im: new Float64Array(FBANK.nfft), pw: new Float64Array(FBANK.nfft / 2 + 1) };
}

// Streaming front end: push 16 kHz float samples, get the CMVN'd feature
// frames (Float32Array(80) each) of every 400-sample window that completed.
// Frame i = samples [160 i, 160 i + 400) of the stream since reset().
// cmvn null -> the raw log-mel frames (Float64Array(80)); applyCmvn() turns
// one into the model's input, bit for bit what the cmvn path gives.
export function createFireRedFrontend(cmvn, { params: paramsIn } = {}) {
  const params = { ...FBANK_PARAMS, ...(paramsIn ?? {}) };
  const { frameLength, frameShift, numMel } = FBANK;
  const work = makeFbankWork();
  const logmel = new Float64Array(numMel);
  let buf = new Float32Array(4096);
  let len = 0;          // valid samples in buf
  let bufStart = 0;     // stream index of buf[0]
  let frames = 0;       // frames emitted
  let samples = 0;      // samples seen
  return {
    push(x) {
      if (len + x.length > buf.length) {
        const nb = new Float32Array(Math.max(buf.length * 2, len + x.length));
        nb.set(buf.subarray(0, len));
        buf = nb;
      }
      buf.set(x, len);
      len += x.length;
      samples += x.length;
      const out = [];
      while (frames * frameShift + frameLength <= bufStart + len) {
        fbankFrame(buf, frames * frameShift - bufStart, logmel, work, params);
        out.push(cmvn ? applyCmvn(logmel, cmvn) : Float64Array.from(logmel));
        frames++;
      }
      // keep from the next frame's first sample
      const keepFrom = frames * frameShift - bufStart;
      if (keepFrom > 0) {
        const k = Math.min(keepFrom, len);
        buf.copyWithin(0, k, len);
        len -= k;
        bufStart += k;
      }
      return out;
    },
    get frames() { return frames; },
    get samples() { return samples; },
    reset() { len = 0; bufStart = 0; frames = 0; samples = 0; },
  };
}

// (log-mel - mean) * istd in float64, rounded to float32 (firered.py features).
export function applyCmvn(logmel, cmvn) {
  const f = new Float32Array(FBANK.numMel);
  for (let j = 0; j < FBANK.numMel; j++) f[j] = (logmel[j] - cmvn.mean[j]) * cmvn.istd[j];
  return f;
}

// ------------------------------------------------------------------ gate
// The R1 h decision, exactly as the screen scored it:
//   smoothing (offtheshelf/common.py smooth, adapt.py --smooth=5): frame i's
//     score is the mean of the raw probabilities of frames max(0, i-4)..i,
//     computed as a difference of the float64 running sum, rounded to float32;
//   threshold (score.py voice_flags): hop k is "on" when the score of the
//     newest frame available at the hop (agg "last"; 0 before the first
//     frame, p_before_first) is >= 0.55;
//   hangover (score.py voice_flags): hop k is voice when it is on, or when a
//     hop at or before it that was on lies within 2000 ms of hop time
//     (t_k - t_last_on <= 2.0 s + 1e-9).
// Hop time t is the stream time (s) at the end of the pitch worker's chunk;
// the frames available at hop k are framesAvailableAt(t) (below: the screen's
// own timing rule), never more than the front end has produced.
export function createVoiceGate({ smooth = FIRERED_GATE.smooth, threshold = FIRERED_GATE.threshold, hangoverMs = FIRERED_GATE.hangoverMs } = {}) {
  const cums = new Float64Array(smooth + 1); // c[i+1-smooth .. i+1] ring
  let n = 0;           // frames added
  let cum = 0;         // c[n] = sum of the first n raw probabilities (float64, sequential)
  let score = 0;       // smoothed score of the newest frame (float32 value)
  let lastOnT = -Infinity;
  cums[0] = 0;
  const hang = hangoverMs / 1000 + 1e-9;
  return {
    addFrame(p) {
      cum += p;
      n++;
      cums[n % (smooth + 1)] = cum;
      const lo = Math.max(n - smooth, 0);
      score = Math.fround((cum - cums[lo % (smooth + 1)]) / (n - lo));
      return score;
    },
    hop(t) {
      const p = n > 0 ? score : 0.0;
      const on = p >= threshold;
      if (on) lastOnT = t;
      const voice = on || t - lastOnT <= hang;
      return { p, on, voice };
    },
    get frames() { return n; },
    reset() { n = 0; cum = 0; score = 0; lastOnT = -Infinity; cums.fill(0); },
  };
}

// ------------------------------------------------------------------ model
// The streaming ONNX with its cache carried call to call; fresh (zero)
// caches at reset() = the model's zero padding at stream start.
//   run(frames: Float32Array(80)[]) -> Promise<Float32Array> (one probability per frame)
export function createFireRedRunner(ort, session) {
  const cacheSize = CACHE_DIMS.reduce((a, b) => a * b, 1);
  let cache = new ort.Tensor("float32", new Float32Array(cacheSize), CACHE_DIMS.slice());
  return {
    async run(frames) {
      const T = frames.length;
      if (T === 0) return new Float32Array(0);
      const data = new Float32Array(T * FBANK.numMel);
      for (let i = 0; i < T; i++) data.set(frames[i], i * FBANK.numMel);
      const out = await session.run({ feat: new ort.Tensor("float32", data, [1, T, FBANK.numMel]), caches_in: cache });
      cache = out.caches_out;
      return Float32Array.from(out.probs.data);
    },
    reset() { cache = new ort.Tensor("float32", new Float32Array(cacheSize), CACHE_DIMS.slice()); },
  };
}

// ------------------------------------------------------------------ detector
// Front end + model + gate per pitch-worker hop. The front end runs from the
// first sample; until the model is ready (setModel: the runner and the
// parsed cmvn.ark) its log-mel frames wait in a backlog and hops get no
// decision (null: the display is not gated). Once the model is there the
// backlog is scored from zero caches, at most CATCHUP_FRAMES per hop so no
// single pitch post waits for all of it, and the gate replays the hops that
// went out undecided; hops keep getting null until it has caught up.
//   pushAudio(x16)           every 16 kHz sample of the stream, in order
//   then, once per chunk, in order:
//     noteHop(t) -> null                                 while !ready (synchronous)
//     hop(t) -> Promise<{ p, on, voice } | null>         once ready (null while catching up)
//
// The backlog keeps the last MAX_BACKLOG_FRAMES frames (4 s) and drops older
// ones. That loses nothing the later decisions depend on: the model's output
// for a frame depends on that frame and the 152 before it, no others (8
// layers with a 19-frame cache; measured on the parity fixture: after a
// zero-cache restart the outputs are bit-identical from the 153rd frame on),
// the gate's smoothing on 5 frames and its hangover on the last 2 s of hops —
// 152 + 5 frames + 2 s < 4 s. So once it has caught up, every decision equals
// that of a run from the start of the stream.
export const MAX_BACKLOG_FRAMES = 400;
export const CATCHUP_FRAMES = 50;       // per hop; ~2.5 new frames arrive per 25 ms hop
const RUN_CHUNK = 100;                  // frames per model call at most (as the screen's runner)

export function createVoiceDetector({ gateOptions, maxBacklog = MAX_BACKLOG_FRAMES, catchup = CATCHUP_FRAMES } = {}) {
  const frontend = createFireRedFrontend(null);
  const gate = createVoiceGate(gateOptions);
  let runner = null;
  let cmvn = null;
  let feats = [];          // log-mel frames not yet scored; feats[0] is frame featStart
  let featStart = 0;
  let probs = [];          // scored probabilities not yet in the gate; probs[0] is frame gateNext
  let gateNext = 0;
  let hops = [];           // hops not yet decided: { t, avail } (avail = frames usable at the hop)
  let truncated = false;

  function addHop(t) {
    const h = { t, avail: Math.min(framesAvailableAt(t), frontend.frames) };
    hops.push(h);
    return h;
  }
  async function score(n) {
    const batch = feats.splice(0, n);
    featStart += batch.length;
    for (let a = 0; a < batch.length; a += RUN_CHUNK) {
      const p = await runner.run(batch.slice(a, a + RUN_CHUNK).map((f) => applyCmvn(f, cmvn)));
      for (let i = 0; i < p.length; i++) probs.push(p[i]);
    }
  }
  // Decide the waiting hops, in order, whose frames are all scored; returns
  // the last decision made (null if none).
  function decide() {
    let last = null;
    let used = 0;
    while (hops.length > 0 && gateNext + (probs.length - used) >= hops[0].avail) {
      const h = hops.shift();
      while (gateNext < h.avail) { gate.addFrame(probs[used++]); gateNext++; }
      last = { h, d: gate.hop(h.t) };
    }
    if (used) probs = probs.slice(used);
    return last;
  }
  return {
    pushAudio(x16) {
      const f = frontend.push(x16);
      for (const fr of f) feats.push(fr);
      if (!runner && feats.length > maxBacklog) {
        const drop = feats.length - maxBacklog;
        feats = feats.slice(drop);
        featStart += drop;
        gateNext = featStart;  // nothing has reached the gate before the model is there
        truncated = true;
        // hops that can see none of the kept frames have nothing to replay
        while (hops.length > 0 && hops[0].avail <= featStart) hops.shift();
      }
    },
    setModel(m) { cmvn = m.cmvn; runner = m.runner; },
    get ready() { return runner !== null; },
    get truncated() { return truncated; },
    get frames() { return frontend.frames; },
    // frames still to score / hops still to decide (non-zero while catching up)
    get backlog() { return feats.length; },
    get waitingHops() { return hops.length; },
    noteHop(t) {
      addHop(t);
      return null;
    },
    async hop(t) {
      const h = addHop(t);
      if (!runner) return null;
      if (feats.length > 0) await score(Math.min(feats.length, catchup));
      const last = decide();
      return last && last.h === h ? last.d : null;
    },
    reset() {
      frontend.reset(); gate.reset(); runner?.reset?.();
      feats = []; featStart = 0; probs = []; gateNext = 0; hops = []; truncated = false;
    },
  };
}
