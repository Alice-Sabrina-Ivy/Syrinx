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

console.log("\nweak hints (pitch worker's subharmonic flag): keep an open utterance alive only");
{
  const weak = () => ({ voiced: false, weak: true, pitch: null });
  // Weak-only evidence never opens an utterance.
  const ds = run(weak, 4000);
  check("weak hints alone never open an utterance", ds.every((d) => d.verdict === "silent"),
    ds.map((d) => d.verdict[0]).join(""));
  // Weak frames between short voiced fragments (< the onset run) never open one either.
  const frag = (t) => (t % 300 < 50 ? { voiced: true, pitch: 100 } : weak());
  const ds2 = run(frag, 4000);
  check("weak frames don't extend a voiced run", ds2.every((d) => d.verdict === "silent"),
    ds2.map((d) => d.verdict[0]).join(""));
  // Speech, then 1.6 s of weak-only frames (a low voice whose voicing the
  // tracker lost to noise), then speech again: the utterance stays open
  // and the EMA is not restarted.
  const stream = (t) => (t <= 2000 ? speech(100)(t) : t <= 3600 ? weak() : speech(100)(t));
  const ds3 = run(stream, 5500);
  check("weak frames keep an open utterance alive past gapMs",
    ds3.filter((d) => d.verdict === "score" && d.resetEma).length === 1);
  const mid = ds3.filter((d) => d.t > 2200 && d.t <= 3600);
  check("an open utterance keeps scoring on weak evidence", mid.every((d) => d.verdict === "score"),
    mid.map((d) => d.verdict[0]).join(""));
  // The same stream with plain unvoiced frames closes and restarts.
  const ds4 = run((t) => (t <= 2000 ? speech(100)(t) : t <= 3600 ? silent() : speech(100)(t)), 5500);
  check("(control: unvoiced frames close it)", ds4.filter((d) => d.verdict === "score" && d.resetEma).length === 2);
  // Weak frames count as unvoiced in the held-phonation test: a held note
  // whose every 4th frame is weak (75 % voiced) is not 'sustained'; a
  // voiced hint that also carries the flag is simply voiced.
  const heldWeak = (t) => (t % 100 === 0 ? weak() : { voiced: true, pitch: 200 });
  const ds5 = run((t) => (t <= 500 ? silent() : heldWeak(t)), 4000);
  check("weak frames are not voiced for the held-note test", ds5.every((d) => d.verdict !== "sustained"),
    ds5.map((d) => d.verdict[0]).join(""));
  check("a voiced hint flagged weak is just voiced",
    run((t) => (t <= 500 ? silent() : { ...heldNote(200)(t), weak: true }), 4000).some((d) => d.verdict === "sustained"));
}

console.log("\nmeter state mapping");
check("score -> scoring", meterStateForVerdict("score") === "scoring");
check("warming -> updating", meterStateForVerdict("warming") === "updating");
check("pause -> pause", meterStateForVerdict("pause") === "pause");
check("sustained -> sustained", meterStateForVerdict("sustained") === "sustained");
check("silent -> listening", meterStateForVerdict("silent") === "listening");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
