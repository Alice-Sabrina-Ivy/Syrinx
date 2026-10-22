// hum-check-test.js — Voice Shaper's recording check end to end with Syrinx's own
// tonal-noise detector: the REAL pitch worker (src/dsp/pitch-worker.js, its noise notch;
// driven by the session oracle's chain, scripts/session-oracle/lib/chain.mjs) hears a
// 10 s lead-in and then the recording; its posted messages (contextTime, pitch,
// notchedFreqs) go through the recorder exactly as the bridge tap forwards them, and the
// recording through the level check. A synthetic fan hum or mains complex
// (scripts/noise-synth.js) under a clean committed LibriSpeech excerpt raises the hum
// notice; the clean excerpt raises neither; pink noise at +10 dB SNR raises the noise
// notice, and so does the LibriSpeech excerpt whose own recording has a noise floor about
// 19 dB below the speech. measurements/voice-preview-phase1-2026-10-19.md §7.
//
//   node tests/voice-preview/hum-check-test.js
import { register } from "node:module";

register(new URL("../../scripts/session-oracle/lib/hooks.mjs", import.meta.url));
const { loadSrc, runWorkers } = await import(new URL("../../scripts/session-oracle/lib/chain.mjs", import.meta.url).href);
const { fanHum, mainsComplex, pink, mix, SR } = await import(new URL("../../scripts/noise-synth.js", import.meta.url).href);
const { createRecorder } = await import(new URL("../../src/voice-preview/recorder.js", import.meta.url).href);
const { recordingCheck } = await import(new URL("../../src/voice-preview/checks.js", import.meta.url).href);
const { makeChecker, makeInput, chunkFor, REPO } = await import(new URL("./vp-test-lib.js", import.meta.url).href);
const path = await import("node:path");

const T = makeChecker();
const S = await loadSrc(path.join(REPO, "src"));
const LEAD_S = 10;
const speech = makeInput({ clip: "ls_woman_high", rate: SR }).pcm; // clean: level margin 42.3 dB

/** The pitch chain over lead-in + recording; the recorder and the check over the recording. */
function run(x) {
  const C = chunkFor(SR);
  const W = runWorkers(S, x, SR, { chunkMs: C / SR * 1000 });
  const lead = Math.round(LEAD_S * SR / C);
  const ct = (k) => (k + 1) * C / SR;
  const r = createRecorder({ sampleRate: SR });
  for (let k = lead; k < W.n; k++) r.pushChunk(x.subarray(k * C, (k + 1) * C), ct(k));
  r.stop("user");
  // every posted message, the lead-in's included (the tap forwards everything; the recorder keeps the recording's)
  for (let k = 0; k < W.n; k++) r.addPitch({ contextTime: ct(k), pitch: W.col.post[k] > 0 ? W.col.post[k] : null, notched: W.col.nnotch[k] > 0 });
  const leadNotched = W.col.nnotch.subarray(0, lead).some((v) => v > 0);
  return { check: recordingCheck({ pcm: r.pcm(), sampleRate: SR, track: r.track(), notched: r.notched() }), leadNotched, voiced: r.track().filter((v) => v > 0).length };
}
const withLead = (lead, rec) => { const x = new Float32Array(lead.length + rec.length); x.set(lead); x.set(rec, lead.length); return x; };

console.log("clean recording after 10 s of silence");
{
  const { check } = run(withLead(new Float32Array(LEAD_S * SR), speech));
  T.check("no hum, no noise notice; a preview would be made", !check.hum && !check.noise && check.enoughVoice, `margin ${check.marginDb.toFixed(1)} dB, ${check.voicedS} s voiced`);
}

console.log("\nsteady hum, 10 s alone before the recording");
for (const [name, gen, snr] of [["fan hum", fanHum, 20], ["fan hum", fanHum, 30], ["mains complex", mainsComplex, 20]]) {
  const { mixed } = mix(speech, gen(speech.length + LEAD_S * SR), snr, 0, LEAD_S);
  const { check, leadNotched } = run(mixed);
  T.check(`${name} ${snr} dB below the speech: hum notice (the notch promoted during the lead-in)`, check.hum && leadNotched && check.enoughVoice,
    `margin ${check.marginDb.toFixed(1)} dB, noise ${check.noise}`);
}

console.log("\nbroadband noise");
{
  const { mixed } = mix(speech, pink(speech.length + LEAD_S * SR), 10, 0, LEAD_S);
  const { check } = run(mixed);
  T.check("pink noise at +10 dB SNR: noise notice, no hum", check.noise && !check.hum, `margin ${check.marginDb.toFixed(1)} dB`);
}
{
  const noisy = makeInput({ clip: "ls_man_low", rate: SR }).pcm; // its recording's floor: about -37 dB, speech about -19 dB
  const { check } = run(withLead(new Float32Array(LEAD_S * SR), noisy));
  T.check("a LibriSpeech recording with a noise floor ~19 dB below the speech: noise notice, no hum", check.noise && !check.hum, `margin ${check.marginDb.toFixed(1)} dB`);
}
T.done();
