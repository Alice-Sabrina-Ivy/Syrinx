// recorder-test.js — the voice preview's recorder (src/voice-preview/recorder.js):
// the 8 s cap by whole capture chunks at 16 / 44.1 / 48 / 96 kHz, under 3 s = too short,
// level reports, and matching posted pitch to recorded chunks by contextTime (exact,
// nearest within half a chunk, late, missing, duplicates, outside the recording),
// float32 track with 0 = unvoiced. measurements/voice-preview-phase1-2026-10-19.md §3, §14 item 3.
//
//   node tests/voice-preview/recorder-test.js
import { createRecorder } from "../../src/voice-preview/recorder.js";
import { makeChecker, chunkFor } from "./vp-test-lib.js";

const T = makeChecker();
const ct = (k, C, sr, base = 10) => base + (k + 1) * C / sr;

console.log("8 s cap by whole chunks");
for (const sr of [16000, 44100, 48000, 96000]) {
  const C = chunkFor(sr);
  const r = createRecorder({ sampleRate: sr });
  const chunk = new Float32Array(C).fill(0.1);
  let k = 0, stopAt = -1, accepted = 0;
  for (; k < 400; k++) {
    const res = r.pushChunk(chunk, ct(k, C, sr));
    if (res.accepted) accepted++;
    if (res.stopped === "max") { stopAt = k; break; }
  }
  const want = Math.floor(Math.floor(8 * sr) / C);
  const after = r.pushChunk(chunk, ct(k + 1, C, sr));
  T.check(`${sr} Hz: ${want} chunks of ${C} (${(want * C / sr).toFixed(4)} s), stop reported with the last one that fits`,
    r.chunks === want && accepted === want && stopAt === want - 1 && r.stopped === "max" && !after.accepted && r.pcm().length === want * C,
    `${r.chunks} chunks, stop at ${stopAt}, ${r.seconds.toFixed(4)} s`);
}
{
  const r = createRecorder({ sampleRate: 44100 });
  const C = chunkFor(44100);
  for (let k = 0; k < 400 && !r.stopped; k++) r.pushChunk(new Float32Array(C), ct(k, C, 44100));
  T.check("44.1 kHz stops at 7.996 s (1102-sample chunks)", Math.abs(r.seconds - 7.9964) < 1e-4, r.seconds.toFixed(5));
}
{
  // a chunk that does not fit, though the previous chunks were smaller: stop, drop it
  const r = createRecorder({ sampleRate: 1000, maxS: 1 });
  r.pushChunk(new Float32Array(400), 0.4);
  const second = r.pushChunk(new Float32Array(400), 0.8);
  const third = r.pushChunk(new Float32Array(400), 1.2);
  T.check("a chunk past the cap is dropped (stop reported before it)", second.accepted && second.stopped === "max" && !third.accepted && r.pcm().length === 800);
}
{
  const r = createRecorder({ sampleRate: 1000, maxS: 1 });
  r.pushChunk(new Float32Array(300), 0.3);
  r.pushChunk(new Float32Array(300), 0.6);
  const odd = r.pushChunk(new Float32Array(500), 1.1);
  T.check("an oversized chunk that does not fit is dropped and stops the recording", !odd.accepted && odd.stopped === "max" && r.pcm().length === 600);
}

console.log("\nsamples, too short, levels");
{
  const sr = 16000, C = chunkFor(sr);
  const r = createRecorder({ sampleRate: sr });
  const levels = [];
  for (let k = 0; k < 119; k++) {
    const x = new Float32Array(C);
    for (let i = 0; i < C; i++) x[i] = Math.sin(0.01 * (k * C + i)) * (k < 4 ? 0.5 : 0.25);
    const res = r.pushChunk(x, ct(k, C, sr));
    if (res.level) levels.push(res.level);
  }
  T.check("2.975 s is too short", r.tooShort() && Math.abs(r.seconds - 2.975) < 1e-12);
  r.pushChunk(new Float32Array(C), ct(119, C, sr));
  T.check("3.000 s is long enough", !r.tooShort() && r.seconds === 3);
  T.check("chunks kept unchanged, in order", r.pcm()[5] === Math.fround(Math.sin(0.05) * 0.5) && r.pcm()[4 * C + 7] === Math.fround(Math.sin(0.01 * (4 * C + 7)) * 0.25));
  T.check("a level every 4th chunk, over those 4 chunks", levels.length === 29 && Math.abs(levels[0].peak - 0.5) < 1e-3 && levels[0].rms > 0.3 && levels[0].seconds === 0.1
    && Math.abs(levels[1].peak - 0.25) < 1e-3, `${levels.length} levels, first rms ${levels[0].rms.toFixed(3)}`);
  T.check("pcm() is a view of whole chunks", r.pcm().length === 120 * C);
}

console.log("\nposted pitch matched to chunks");
function rec(nChunks, sr = 48000) {
  const C = chunkFor(sr);
  const r = createRecorder({ sampleRate: sr });
  for (let k = 0; k < nChunks; k++) r.pushChunk(new Float32Array(C), ct(k, C, sr));
  return { r, C, sr };
}
{
  const { r, C, sr } = rec(140);
  // posted while recording (with the decode lag), then the rest after the stop
  for (let k = 0; k < 138; k++) r.addPitch({ contextTime: ct(k, C, sr), pitch: k % 3 === 0 ? null : 100 + k / 7, notched: k === 20 });
  T.check("values posted while recording are held until the stop", r.track() === null);
  r.stop("user");
  T.check("not complete without the last chunk's value", !r.trackComplete());
  r.addPitch({ contextTime: ct(138, C, sr), pitch: 150, notched: false });
  r.addPitch({ contextTime: ct(139, C, sr), pitch: 151, notched: false });
  const t = r.track();
  T.check("complete when the last chunk's value arrives", r.trackComplete() && r.received() === 140);
  T.check("Float32Array, one value per chunk, Hz", t instanceof Float32Array && t.length === 140 && t[1] === Math.fround(100 + 1 / 7) && t[139] === 151);
  T.check("unvoiced (null) -> 0", t[0] === 0 && t[3] === 0);
  T.check("notched flag per chunk", r.notched()[20] === 1 && r.notched().reduce((s, v) => s + v, 0) === 1);
}
{
  const { r, C, sr } = rec(130);
  r.stop("user");
  const half = 0.5 * C / sr;
  T.check("nearest within half a chunk: +0.45 chunk -> that chunk", r.addPitch({ contextTime: ct(10, C, sr) + 0.45 * C / sr, pitch: 210 }) && r.track()[10] === 210);
  T.check("…-0.45 chunk -> that chunk", r.addPitch({ contextTime: ct(11, C, sr) - 0.45 * C / sr, pitch: 211 }) && r.track()[11] === 211);
  T.check("exactly half a chunk is still matched", r.addPitch({ contextTime: ct(30, C, sr) + half, pitch: 230 }) && (r.track()[30] === 230 || r.track()[31] === 230));
  T.check("duplicate for a matched chunk: the first value stays", !r.addPitch({ contextTime: ct(10, C, sr), pitch: 999 }) && r.track()[10] === 210);
  T.check("before the recording (one chunk early): ignored", !r.addPitch({ contextTime: ct(-1, C, sr), pitch: 300 }) && r.track()[0] === 0);
  T.check("after the recording (one chunk late): ignored", !r.addPitch({ contextTime: ct(130, C, sr), pitch: 300 }) && r.track()[129] === 0);
  T.check("far before / not a number: ignored", !r.addPitch({ contextTime: 0, pitch: 300 }) && !r.addPitch({ contextTime: null, pitch: 300 }));
  r.finalise();
  T.check("after finalise (the 500 ms timeout) late values are ignored; missing stay 0",
    !r.addPitch({ contextTime: ct(50, C, sr), pitch: 250 }) && r.track()[50] === 0 && !r.trackComplete() && r.finalised);
}
{
  // contextTime off by more than half a chunk from every recorded chunk is rejected
  const sr = 1000;
  const r = createRecorder({ sampleRate: sr, maxS: 10 });
  r.pushChunk(new Float32Array(100), 1.0);
  r.pushChunk(new Float32Array(100), 1.1);
  r.pushChunk(new Float32Array(100), 1.5); // a gap in the clock
  r.stop("user");
  T.check("in a clock gap, more than half a chunk from any chunk: ignored", !r.addPitch({ contextTime: 1.3, pitch: 180 }));
  T.check("exact equality wins over nearest", r.addPitch({ contextTime: 1.1, pitch: 181 }) && r.track()[1] === 181);
}
{
  const r = createRecorder({ sampleRate: 16000 });
  T.check("stop with no chunks: empty track, never complete", r.stop("user") && r.track().length === 0 && !r.trackComplete());
  T.check("a second stop is a no-op", r.stop("user") === false);
}
T.done();
