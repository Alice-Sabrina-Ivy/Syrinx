// checks-test.js — Voice Shaper's recording check (src/voice-preview/checks.js):
// hum flag from the forwarded notch flags (recorded chunks only), the background-noise
// level margin on synthetic signals (clean voice with digital silence: no flag; with
// pink noise at +10 dB SNR: flag; the 28 dB boundary; the floor at the 5th percentile, so
// a recording with pauses in only 6 % of its frames is judged on its pauses — fix step),
// and voice sufficiency at 39 / 40
// voiced hops. measurements/voice-preview-phase1-2026-10-19.md §7, §14 item 5.
//
//   node tests/voice-preview/checks-test.js
import {
  levelMargin, noiseFlag, humFlag, voicedHops, recordingCheck, NOISE_MARGIN_DB, FLOOR_PERCENTILE, MIN_VOICED_HOPS,
} from "../../src/voice-preview/checks.js";
import { createRecorder } from "../../src/voice-preview/recorder.js";
import { makeChecker, makeInput, chunkFor } from "./vp-test-lib.js";

const T = makeChecker();
const SR = 16000;

// deterministic noise
let seed = 20261019;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
/** Pink noise (Paul Kellet's filter on white noise), unit RMS. */
function pink(n) {
  const y = new Float64Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, ss = 0;
  for (let i = 0; i < n; i++) {
    const w = gauss();
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    y[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    ss += y[i] * y[i];
  }
  const r = Math.sqrt(ss / n);
  for (let i = 0; i < n; i++) y[i] /= r;
  return y;
}
/** A synthetic voice: 150 Hz harmonic stack in 200 ms syllables, 100 ms of digital silence between. */
function voice(seconds) {
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR, ph = t % 0.3;
    if (ph >= 0.2) continue;
    const env = Math.sin(Math.PI * ph / 0.2);
    let v = 0;
    for (let h = 1; h <= 20; h++) v += Math.sin(2 * Math.PI * 150 * h * t) / h;
    x[i] = 0.2 * env * v;
  }
  return x;
}
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

console.log("background noise: level margin (95th - 5th percentile of 20 ms frame energies)");
T.check("threshold 28 dB, floor at the 5th percentile", NOISE_MARGIN_DB === 28 && FLOOR_PERCENTILE === 0.05);
{
  const v = voice(4);
  const clean = levelMargin(v, SR);
  T.check("clean voice with digital silence: large margin, no flag", clean.margin > 100 && !noiseFlag(clean.margin), `${clean.margin.toFixed(1)} dB`);
  const pn = pink(v.length);
  const g = rms(v) / Math.pow(10, 10 / 20); // +10 dB SNR (whole-clip RMS)
  const noisy = Float32Array.from(v, (s, i) => s + g * pn[i]);
  const m = levelMargin(noisy, SR);
  T.check("with pink noise at +10 dB SNR: flagged", noiseFlag(m.margin), `${m.margin.toFixed(1)} dB`);
  const g30 = rms(v) / Math.pow(10, 40 / 20);
  const quiet = Float32Array.from(v, (s, i) => s + g30 * pn[i]);
  const mq = levelMargin(quiet, SR);
  T.check("with pink noise at +40 dB SNR: not flagged", !noiseFlag(mq.margin), `${mq.margin.toFixed(1)} dB`);
}
{
  // a committed clean LibriSpeech excerpt (the spike measured clean clips at 39-60 dB)
  const { pcm } = makeInput({ clip: "ls_woman_high", rate: SR });
  const m = levelMargin(pcm, SR);
  T.check("a clean LibriSpeech excerpt: not flagged", !noiseFlag(m.margin), `${m.margin.toFixed(1)} dB`);
}
{
  // two-level signals around the boundary: half the frames at A, half at B (margin = B - A)
  const frame = Math.round(SR * 0.02);
  const twoLevel = (dB) => {
    const x = new Float32Array(frame * 100);
    const lo = 0.001, hi = lo * Math.pow(10, dB / 20);
    for (let f = 0; f < 100; f++) for (let i = 0; i < frame; i++) x[f * frame + i] = (f % 2 ? hi : lo) * (i % 2 ? 1 : -1);
    return levelMargin(x, SR).margin;
  };
  const a = twoLevel(28.5), b = twoLevel(27.5);
  T.check("margin 28.5 dB: not flagged; 27.5 dB: flagged", !noiseFlag(a) && noiseFlag(b), `${a.toFixed(3)} / ${b.toFixed(3)} dB`);
  T.check("exact boundary: 28 dB is not flagged, just below is", !noiseFlag(28) && noiseFlag(27.999999) && noiseFlag(NaN));
  // continuous speech with short gaps: 94 % of the frames loud (spread over 18 dB), 6 % quiet
  // gaps at the room floor 43 dB below the loudest: the floor comes from the gaps
  const sixPct = (() => {
    const x = new Float32Array(frame * 100);
    for (let f = 0; f < 100; f++) {
      const amp = f % 17 === 0 ? 0.001 * Math.pow(10, 0 / 20) : 0.001 * Math.pow(10, (25 + (f % 10) * 2) / 20);
      for (let i = 0; i < frame; i++) x[f * frame + i] = amp * (i % 2 ? 1 : -1);
    }
    return levelMargin(x, SR);
  })();
  T.check("gaps in 6 % of the frames set the floor (5th percentile): no flag", !noiseFlag(sixPct.margin) && sixPct.margin > 40, `${sixPct.margin.toFixed(1)} dB`);
}

console.log("\nhum: any posted message for a recorded chunk with an active notch line");
T.check("no notched chunk -> no hum", !humFlag(Uint8Array.from([0, 0, 0])) && !humFlag(null));
T.check("one notched chunk -> hum", humFlag(Uint8Array.from([0, 1, 0])));
{
  const C = chunkFor(SR), ct = (k) => 7 + (k + 1) * C / SR;
  const r = createRecorder({ sampleRate: SR });
  for (let k = 0; k < 130; k++) r.pushChunk(new Float32Array(C), ct(k));
  r.stop("user");
  r.addPitch({ contextTime: ct(-1), pitch: 120, notched: true }); // before the recording
  r.addPitch({ contextTime: ct(130), pitch: 120, notched: true }); // after it
  for (let k = 0; k < 130; k++) r.addPitch({ contextTime: ct(k), pitch: 150, notched: false });
  T.check("notched messages outside the recording do not count", !recordingCheck({ pcm: r.pcm(), sampleRate: SR, track: r.track(), notched: r.notched() }).hum);
  const r2 = createRecorder({ sampleRate: SR });
  for (let k = 0; k < 130; k++) r2.pushChunk(new Float32Array(C), ct(k));
  r2.stop("user");
  for (let k = 0; k < 130; k++) r2.addPitch({ contextTime: ct(k), pitch: 150, notched: k === 77 });
  T.check("a notched message for a recorded chunk counts", recordingCheck({ pcm: r2.pcm(), sampleRate: SR, track: r2.track(), notched: r2.notched() }).hum);
}

console.log("\nenough voice: at least 40 voiced hops (1.0 s)");
{
  const pcm = voice(4);
  const mk = (nv) => Float32Array.from({ length: 160 }, (_, k) => (k < nv ? 150 : 0));
  const c39 = recordingCheck({ pcm, sampleRate: SR, track: mk(39), notched: new Uint8Array(160) });
  const c40 = recordingCheck({ pcm, sampleRate: SR, track: mk(40), notched: new Uint8Array(160) });
  T.check("39 voiced hops: not enough (0.975 s)", MIN_VOICED_HOPS === 40 && !c39.enoughVoice && c39.voicedS === 0.975);
  T.check("40 voiced hops: enough (1.0 s)", c40.enoughVoice && c40.voicedS === 1);
  T.check("voicedHops counts values > 0", voicedHops(Float32Array.from([0, 80, 0, 300])) === 2);
  T.check("the whole check reports hum, noise, margin, voiced seconds", ["hum", "noise", "marginDb", "voicedS", "enoughVoice"].every((k) => k in c40));
}
T.done();
