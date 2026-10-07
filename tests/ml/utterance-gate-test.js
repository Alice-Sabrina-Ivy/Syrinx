// utterance-gate-test.js — the perceived-voice utterance gate
// (src/ml/utterance-gate.js) on synthetic pitch-hint streams, stepped the
// way gender-worker.js runs it: one hint per 25 ms pitch frame, a
// decision every 150 ms (the worker's inference hop).
//
// Usage: node tests/ml/utterance-gate-test.js

import {
  createUtteranceGate,
  meterStateForVerdict,
  UTTERANCE_GATE_DEFAULTS as D,
} from "../../src/ml/utterance-gate.js";

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`);
  }
}

const HOP = 25;
const TICK = 150;

// Runs a stream: `frame(t)` -> { voiced, pitch } for the frame ending at
// t ms. Returns the decisions [{ t, verdict, resetEma }] at every tick.
function run(frame, durationMs, gate = createUtteranceGate()) {
  const out = [];
  for (let t = HOP; t <= durationMs; t += HOP) {
    gate.notePitchHint({ ts: t, ...frame(t) });
    if (t % TICK === 0) out.push({ t, ...gate.decide(t) });
  }
  return out;
}

const silent = () => ({ voiced: false, pitch: null });
// Running speech: ~200 ms voiced syllables separated by ~75 ms
// consonants, intonation sweeping ~6 semitones over each 1.2 s phrase.
const speech = (base) => (t) => {
  const inSyll = t % 275 < 200;
  const st = 6 * Math.sin((2 * Math.PI * t) / 1200);
  return inSyll ? { voiced: true, pitch: base * 2 ** (st / 12) } : silent();
};
const heldNote = (f0, vibratoSt = 0) => (t) => ({
  voiced: true,
  pitch: f0 * 2 ** ((vibratoSt * Math.sin((2 * Math.PI * 5.5 * t) / 1000)) / 12),
});
const firstAt = (ds, verdict) => ds.find((d) => d.verdict === verdict);

console.log("defaults");
check("window matches the worker's 0.75 s", D.windowMs === 750);
check("held-phonation test spans a full second", D.sustainMs === 1000);
check("an utterance needs more than one or two voiced frames to open", D.onsetRunMs >= 3 * HOP);

console.log("\nno pitch feed / silence");
{
  const g = createUtteranceGate();
  check("no hints yet -> stale (worker falls back)", g.decide(1000).verdict === "stale");
  const ds = run(silent, 3000);
  check("silence -> always silent", ds.every((d) => d.verdict === "silent"));
  const g2 = createUtteranceGate();
  run(speech(120), 1500, g2);
  check("feed stops for > staleMs -> stale", g2.decide(1500 + D.staleMs + 100).verdict === "stale");
  g2.notePitchHint({ ts: 3700, voiced: false });
  g2.notePitchHint({ ts: 3725, voiced: true, pitch: 200 });
  check("garbage hint ignored", (g2.notePitchHint({ ts: NaN, voiced: true }), g2.notePitchHint(null), true));
}

console.log("\nnoise blips (short false-voiced runs) never score");
{
  // A 75 ms voiced blip every 600 ms — like sporadic false voicing on noise.
  const blips = (t) => (t % 600 < 75 ? { voiced: true, pitch: 140 } : silent());
  const ds = run(blips, 6000);
  check("no window scored", ds.every((d) => d.verdict !== "score"), ds.map((d) => d.verdict[0]).join(""));
  check("never even opens an utterance", ds.every((d) => d.verdict === "silent"));
}

console.log("\nrunning speech");
for (const base of [110, 210]) {
  const ds = run((t) => (t <= 1000 ? silent() : speech(base)(t - 1000)), 5000);
  const first = firstAt(ds, "score");
  check(`${base} Hz: scores`, !!first);
  check(`${base} Hz: first score only once >= half the window follows the onset`,
    first && first.t - 1000 >= D.minPostOnsetFrac * D.windowMs, first && `${first.t - 1000} ms after onset`);
  check(`${base} Hz: first score within 0.8 s of onset`, first && first.t - 1000 <= 800, first && `${first.t - 1000} ms`);
  check(`${base} Hz: first score restarts the EMA`, first?.resetEma === true);
  const later = ds.filter((d) => d.t > first.t && d.verdict === "score");
  check(`${base} Hz: later scores keep the EMA`, later.length > 10 && later.every((d) => !d.resetEma));
  const after = ds.filter((d) => d.t >= first.t);
  check(`${base} Hz: never 'sustained' on running speech`, after.every((d) => d.verdict !== "sustained"));
  check(`${base} Hz: scores >= 90 % of ticks once going`,
    after.filter((d) => d.verdict === "score").length >= 0.9 * after.length,
    `${after.filter((d) => d.verdict === "score").length}/${after.length}`);
}

console.log("\nutterances: a pause longer than gapMs starts a fresh one");
{
  const stream = (t) => (t <= 2000 ? speech(120)(t) : t <= 2000 + D.gapMs + 400 ? silent() : speech(220)(t));
  const ds = run(stream, 5500);
  const resets = ds.filter((d) => d.verdict === "score" && d.resetEma);
  check("two utterances -> two EMA restarts", resets.length === 2, `${resets.length}`);
  const restart = ds.find((d) => d.t > 2000 + D.gapMs && d.verdict === "score");
  check("second utterance waits for a mostly post-onset window",
    restart && restart.t - (2000 + D.gapMs + 400) >= D.minPostOnsetFrac * D.windowMs);
  const inGap = ds.filter((d) => d.t > 2000 + D.recencyMs + HOP && d.t < 2000 + D.gapMs);
  check("no scoring once voicing is older than recencyMs", inGap.every((d) => d.verdict !== "score"),
    inGap.map((d) => d.verdict).join(","));
  // A short pause (< gapMs) inside an utterance keeps the EMA going.
  const shortPause = (t) => (t > 1800 && t <= 2200 ? silent() : speech(120)(t));
  const ds2 = run(shortPause, 4000);
  check("a 400 ms pause doesn't restart the EMA",
    ds2.filter((d) => d.verdict === "score" && d.resetEma).length === 1);
}

console.log("\nheld vowels / sung notes -> 'sustained', never scored");
for (const [name, frame] of [
  ["steady 200 Hz", heldNote(200)],
  ["steady 110 Hz", heldNote(110)],
  ["vibrato +-0.7 st at 330 Hz", heldNote(330, 0.7)],
]) {
  const ds = run((t) => (t <= 500 ? silent() : frame(t)), 4500);
  check(`${name}: no window scored`, ds.every((d) => d.verdict !== "score"), ds.map((d) => d.verdict[0]).join(""));
  const s = firstAt(ds, "sustained");
  check(`${name}: 'sustained' within ~1.2 s of the onset`, s && s.t - 500 <= D.sustainMs + 300, s && `${s.t - 500} ms`);
  check(`${name}: stays 'sustained'`, ds.filter((d) => d.t > s.t).every((d) => d.verdict === "sustained"));
}
{
  // A pitch glide (siren) is not single-pitch phonation.
  const glide = (t) => (t <= 500 ? silent() : { voiced: true, pitch: 120 * 2 ** (((t - 500) / 1000) * 8 / 12) });
  const ds = run(glide, 3000);
  check("8 st/s glide is scored, not 'sustained'", ds.some((d) => d.verdict === "score") && ds.every((d) => d.verdict !== "sustained"));
}

console.log("\nheld note, then silence: the note's tail is not scored");
{
  const stream = (t) => (t <= 500 ? silent() : t <= 3500 ? heldNote(240)(t) : silent());
  const ds = run(stream, 6000);
  check("nothing scored during or after the note", ds.every((d) => d.verdict !== "score"), ds.map((d) => d.verdict[0]).join(""));
  check("back to silent after the note", ds.filter((d) => d.t > 3700).every((d) => d.verdict === "silent"));
}

console.log("\nheld note then speech");
{
  const stream = (t) => (t <= 3000 ? heldNote(220)(t) : t <= 3300 ? silent() : speech(220)(t));
  const ds = run(stream, 6000);
  const back = ds.find((d) => d.t > 3000 && d.verdict === "score");
  check("speech after a held note is scored again", !!back);
  check("...with a fresh EMA", back?.resetEma === true);
  check("...once the window is mostly past the note", back && back.t - 3000 >= D.minPostOnsetFrac * D.windowMs);
}

console.log("\nbursty delivery (capture frames of B ms, chunks emitted back to back)");
{
  // Wall time w = B, 2B, ...: every complete 25 ms chunk up to w arrives
  // at once. The ML worker sees each chunk (now = its audio end time) and
  // decides at most every 150 ms of wall time; the pitch hint for frame c
  // (ts = its audio end) is posted when chunk c+2 is processed (L = 2
  // decode delay) and relayed through the main thread AFTER the burst's
  // chunks reached the ML worker. Before the 2026-10-07 review the hints
  // carried decode wall time, and with B >= 64 ms no utterance ever opened.
  const stream = (t) => (t > 1000 && t <= 7000 ? speech(120)(t - 1000) : silent());
  for (const B of [10, 25, 40, 64, 80, 100]) {
    const g = createUtteranceGate();
    let nextChunk = 0, lastDecideWall = -1e9, pendingHints = [];
    let ticks = 0, scored = 0, first = null;
    for (let wall = B; wall <= 8500; wall += B) {
      const burst = [];
      while ((nextChunk + 1) * HOP <= wall) burst.push(++nextChunk);
      // hints relayed from the previous burst land first
      for (const h of pendingHints) g.notePitchHint(h);
      pendingHints = [];
      for (const c of burst) {
        const now = c * HOP;
        if (wall - lastDecideWall >= TICK) {
          lastDecideWall = wall;
          const d = g.decide(now);
          if (now > 2000 && now <= 7000) { ticks++; if (d.verdict === "score") scored++; }
          if (d.verdict === "score" && first === null) first = now - 1000;
        }
        const frame = c - 2;
        if (frame >= 1) pendingHints.push({ ts: frame * HOP, ...stream(frame * HOP) });
      }
    }
    check(`B = ${B} ms: scores >= 85 % of decisions 1-6 s into speech`, ticks > 0 && scored >= 0.85 * ticks, `${scored}/${ticks}`);
    check(`B = ${B} ms: first score within 0.9 s of onset`, first !== null && first <= 900, first === null ? "never" : `${first} ms`);
  }
}

console.log("\naudio clock restarting (a new capture stream) resets the gate");
{
  const g = createUtteranceGate();
  run(speech(120), 4000, g);
  check("speech scores before the restart", g.decide(4000).verdict === "score");
  // New stream: the clock starts again near 0 with silence.
  for (let t = HOP; t <= 600; t += HOP) g.notePitchHint({ ts: t, voiced: false, pitch: null });
  check("old stream's voicing doesn't carry over", g.decide(600).verdict === "silent");
}

console.log("\nheld-phonation share: 95 % voiced over the second");
{
  // Flat pitch with an unvoiced frame every 300 ms (~92 % voiced): speech
  // on a deliberately level pitch, not a held vowel.
  const flatSpeech = (t) => (t % 300 < 25 ? silent() : { voiced: true, pitch: 180 });
  const ds = run((t) => (t <= 500 ? silent() : flatSpeech(t)), 5000);
  check("~92 % voiced flat-pitch speech is not 'sustained'", ds.every((d) => d.verdict !== "sustained"),
    ds.map((d) => d.verdict[0]).join(""));
  check("default share is 0.95", D.sustainMinShare === 0.95);
}

console.log("\nspeech-detector evidence (noteSpeech, 32 ms frames)");
{
  const SP = 32;
  // Pitch hints every 25 ms and speech hints every 32 ms (both on the
  // audio clock); a decision every 150 ms after feeding everything <= now.
  function runBoth(pitchFrame, speechP, durationMs, gate = createUtteranceGate()) {
    const out = [];
    let tp = HOP, ts = SP;
    for (let now = TICK; now <= durationMs; now += TICK) {
      for (; tp <= now; tp += HOP) gate.notePitchHint({ ts: tp, ...pitchFrame(tp) });
      for (; ts <= now; ts += SP) gate.noteSpeech({ ts, p: speechP(ts) });
      out.push({ t: now, ...gate.decide(now) });
    }
    return out;
  }
  const talking = (from, to) => (t) => (t > from && t <= to ? 0.95 : 0.02);
  // Speech the pitch tracker mostly loses (heavy noise on a low voice):
  // one voiced frame in four.
  const lostPitch = (t) => (t > 1000 && t <= 6000 && t % 100 < 25 ? { voiced: true, pitch: 95 } : silent());
  const ds = runBoth(lostPitch, talking(1000, 6000), 6000);
  const first = firstAt(ds, "score");
  check("speech the pitch tracker loses still scores", !!first);
  check("...first score within 0.8 s of the onset", first && first.t - 1000 <= 800 && first.t - 1000 >= D.speechMinPostOnsetFrac * D.windowMs, first && `${first.t - 1000} ms`);
  check("...and keeps scoring", ds.filter((d) => d.t >= 2000 && d.t <= 6000).every((d) => d.verdict === "score"));
  const pitchOnly = run(lostPitch, 6000);
  check("(the same pitch stream alone never scores)", pitchOnly.every((d) => d.verdict !== "score"));

  // Noise the pitch tracker voices but the detector rejects: never scored.
  const dsN = runBoth((t) => (t % 400 < 200 ? { voiced: true, pitch: 120 + (t % 7) } : silent()), () => 0.03, 6000);
  check("pitch-voiced noise without speech is never scored", dsN.every((d) => d.verdict !== "score"),
    dsN.map((d) => d.verdict[0]).join(""));

  // Speech probability blips (< onsetRunMs) never open an utterance.
  const dsB = runBoth(silent, (t) => (t % 800 < 64 ? 0.9 : 0.05), 6000);
  check("short speech blips never open", dsB.every((d) => d.verdict === "silent"));

  // Held note: pitch steady, detector near 0 -> 'sustained', never scored.
  const dsH = runBoth((t) => (t > 500 ? heldNote(220)(t) : silent()), () => 0.05, 4500);
  check("held note: never scored", dsH.every((d) => d.verdict !== "score"));
  check("held note: 'sustained' after ~1 s", dsH.some((d) => d.verdict === "sustained"));

  // A steady hum the pitch tracker calls a held note, under continuous
  // speech: once the hold verdict ends, the still-running speech reopens.
  const humThenVoice = (t) => (t <= 3000 ? { voiced: true, pitch: 100 } : speech(200)(t));
  const dsR = runBoth(humThenVoice, talking(2000, 7000), 7000);
  const back = dsR.find((d) => d.t > 3000 && d.verdict === "score");
  check("speech running through the end of a hold verdict is scored again", !!back);
  check("...with a fresh EMA, once >= 40 % of the window is past the hold",
    back?.resetEma === true && back.t - 3000 >= D.speechMinPostOnsetFrac * D.windowMs, back && `${back.t - 3000} ms`);
  const dsR0 = runBoth(humThenVoice, talking(2000, 7000), 7000, createUtteranceGate({ speechReopenAfterHold: false }));
  check("(speechReopenAfterHold off: shut until the speech run breaks)", dsR0.every((d) => d.t <= 3000 || d.verdict !== "score"));

  // Gap / recency on speech evidence.
  const dsG = runBoth(silent, (t) => (t > 1000 && t <= 3000 ? 0.95 : 0.02), 5000);
  check("scores during speech", dsG.some((d) => d.verdict === "score"));
  check("no score once speech is older than recencyMs",
    dsG.filter((d) => d.t > 3000 + D.recencyMs + SP).every((d) => d.verdict !== "score"));
  check("closed after gapMs", dsG.filter((d) => d.t > 3000 + D.gapMs + SP).every((d) => d.verdict === "silent"));

  // Detector stops (failed / stalled): pitch voicing decides again after staleMs.
  {
    const g = createUtteranceGate();
    runBoth(silent, () => 0.02, 1500, g);
    let scored = false;
    for (let t = 1525; t <= 7000 && !scored; t += HOP) {
      g.notePitchHint({ ts: t, ...speech(150)(t) });
      if (t % TICK === 0 && g.decide(t).verdict === "score") scored = true;
    }
    check("stale speech hints -> pitch voicing decides again", scored);
  }

  // A vowel held after speech, with the detector still calling it speech:
  // the background pitch utterance restarts at the vowel (>= gapMs of
  // unvoiced pitch before it) and is watched at "warming", as on pitch alone.
  {
    const pitchF = (t) => (t <= 3000 ? speech(200)(t) : t <= 4200 ? silent() : heldNote(200)(t));
    const dsV = runBoth(pitchF, talking(0, 7000), 7000);
    check("vowel held after speech (detector on): never scored once the vowel starts",
      dsV.filter((d) => d.t > 4200 + D.windowMs).every((d) => d.verdict !== "score"),
      dsV.filter((d) => d.t > 4200).map((d) => d.verdict[0]).join(""));
    check("...and 'sustained' after ~1 s", dsV.some((d) => d.t > 4200 && d.verdict === "sustained"));
  }
  const dsS = runBoth(speech(150), () => 0.02, 4000);
  check("default: the detector decides (pitch voicing alone does not open)", dsS.every((d) => d.verdict !== "score"));
  check("speech defaults: Silero threshold 0.5, 32 ms frames", D.speechThreshold === 0.5 && D.speechHopMs === 32);
  check("speech mode: >= 40 % of a scored window follows the speech onset", D.speechMinPostOnsetFrac === 0.4);
}

console.log("\nmeter state mapping");
check("score -> scoring", meterStateForVerdict("score") === "scoring");
check("warming -> updating", meterStateForVerdict("warming") === "updating");
check("pause -> pause", meterStateForVerdict("pause") === "pause");
check("sustained -> sustained", meterStateForVerdict("sustained") === "sustained");
check("silent -> listening", meterStateForVerdict("silent") === "listening");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
