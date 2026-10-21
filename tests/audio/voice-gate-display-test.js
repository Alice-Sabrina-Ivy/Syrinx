// voice-gate-display-test.js — the voice gate's display mask, on the REAL
// useAudioPipeline hook (noise-detector try-out 2026-10-20, merged into
// cue-strip 2026-10-21; measurements/noise-detector-tryout-2026-10-20.md).
//
// The hook is loaded in Node exactly as tests/audio/display-hook-test.js
// does (scripts/session-oracle/lib/react-mock.mjs). Each case runs a frame
// sequence twice — with the detector's decision on the pitch messages, and
// without any decision (the pre-try-out app) — and checks:
//   - "no voice" + setting on: the trace shows a gap, the Hz / note, the
//     steadiness and the HNR readouts are empty, pitchVoiced / pitchHolding
//     are false (HNR: user decision 2026-10-21, display only — the recorded
//     hnr is unchanged);
//   - the cue strip's rows (cueStripModel.js cueRowStates on these flags):
//     the resonance row stays idle on hidden noise — no "keep talking…" —
//     and shows the ungated app's state on every frame the gate does not
//     hide (user decision 2026-10-21; measurements/
//     voice-gate-resonance-row-2026-10-21.md);
//   - nothing else moves: the recorded voiced / f0 (what session stats read),
//     the raw voiced / holding flags, formants, the HNR
//     readout on frames the gate does not hide, the recorded hnr, and the
//     painted value of every frame the gate does not hide are bit-identical
//     to the run without decisions (a mask on the unchanged chain — the veto
//     the 2026-10-20 screen scored);
//   - recorded frames carry voiceGate "hidden" / "voice" / "novoice";
//   - setting off: the display is exactly the run without decisions;
//   - decision "voice", or no decision: nothing changes;
//   - silence after speech: the dim held readout AND the held HNR keep their
//     5 s silence hold (the detector's "no voice" 2 s into the silence does
//     not clear them; HNR: user decision 2026-10-21), unless the gate hid
//     painted frames after the held value — then both show "—".
//
//   node tests/audio/voice-gate-display-test.js

import { register } from "node:module";

register(new URL("../../scripts/session-oracle/lib/hooks.mjs", import.meta.url));
const { M } = await import(new URL("../../scripts/session-oracle/lib/react-mock.mjs", import.meta.url).href);
const HOOK = new URL("../../src/audio/useAudioPipeline.js", import.meta.url).href;
const CS = await import(new URL("../../src/components/cueStripModel.js", import.meta.url).href);

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

// The throttled readout state updates at most every 200 ms of
// performance.now(): advance a fake clock 250 ms per frame so every frame's
// readout lands in the state.
let fakeNow = 0;
performance.now = () => fakeNow;

let gen = 0;
// frames: [{ x: Hz | "q" (quiet) | "l" (loud, no pitch), vad: true | false | undefined }]
async function run(frames, { gateOn = true } = {}) {
  M.refs = []; M.effects = []; M.state = null;
  const mod = await import(`${HOOK}?g=${++gen}`);
  const api = mod.useAudioPipeline();
  for (const e of M.effects) { try { e(); } catch { /* effects that need a DOM */ } }
  const har = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handleAnalysisResult");
  const hpm = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handlePitchMessage");
  if (!har || !hpm) throw new Error("hook refs not found — did useAudioPipeline's ref layout change?");
  api.setVoiceGateEnabled(gateOn);
  const rec = [];
  api.frameCallbackRef.current = (f) => rec.push(f);
  const out = [];
  let t = 1e6;
  for (const fr of frames) {
    t += 25;
    fakeNow += 250;
    let intensity, pitch = null, confidence;
    if (typeof fr.x === "number") { intensity = -28; pitch = fr.x; confidence = 0.8; }
    else if (fr.x === "q") { intensity = -70; confidence = 0.2; }
    else { intensity = -38; confidence = 0.3; }
    hpm.current({
      type: "pitch", pitch, confidence, voiced: pitch !== null, ts: t, contextTime: t / 1000,
      ...(fr.vad === undefined ? {} : { vad: { p: fr.vad ? 0.9 : 0.1, voice: fr.vad } }),
    });
    har.current({ intensity, formants: { f1: 500, f2: 1500, f3: 2500 }, spectralTilt: -10, hnr: 12, cpp: null, absoluteTime: t });
    const trace = api.pitchTraceRef.current;
    const e = trace[trace.length - 1];
    const s = M.state;
    out.push({
      painted: e && e.time === Math.round(t) && e.pitch !== null ? e.pitch : 0,
      pitch: s.pitch, note: s.noteName, level: s.pitchLevel, steadiness: s.steadiness,
      voiced: s.voiced, holding: s.holding, pitchVoiced: s.pitchVoiced, pitchHolding: s.pitchHolding,
      formants: s.formants, hnr: s.hnr,
    });
  }
  return { out, rec };
}

const rep = (v, n, vad) => Array.from({ length: n }, () => ({ x: v, vad }));
const strip = (frames) => frames.map((f) => ({ x: f.x }));

// A false pitch line (noise decoded at 117 Hz) with the detector saying no
// voice, then speech (detector: voice), then the line again.
const SEQ = [
  ...rep(117, 60, false),
  ...rep("l", 4, false),
  ...rep(205, 60, true),
  ...rep(117, 40, true),     // still inside the hangover: shown
  ...rep(117, 40, false),    // hangover over: hidden
  ...rep("q", 30, false),    // quiet with a decision of no voice
  ...rep(210, 20, true),
];
const hidden = SEQ.map((f) => f.vad === false);

const base = await run(strip(SEQ));
const gated = await run(SEQ);
const off = await run(SEQ, { gateOn: false });

console.log("setting on, detector says no voice");
check("the trace shows nothing on hidden frames", gated.out.every((o, i) => !hidden[i] || o.painted === 0));
check("the baseline did paint the false line there (the case is real)", base.out.filter((o, i) => hidden[i] && o.painted > 0).length > 60);
check("Hz / note / level readouts empty on hidden frames", gated.out.every((o, i) => !hidden[i] || (o.pitch === null && o.note === null && o.level === null)));
check("steadiness readout empty on hidden frames", gated.out.every((o, i) => !hidden[i] || o.steadiness === null));
check("pitchVoiced / pitchHolding false on hidden frames", gated.out.every((o, i) => !hidden[i] || (!o.pitchVoiced && !o.pitchHolding)));
check("HNR readout empty on hidden frames", gated.out.every((o, i) => !hidden[i] || o.hnr === null),
  gated.out.map((o, i) => (!hidden[i] || o.hnr === null ? "" : i)).filter(String).slice(0, 8).join(","));
check("the baseline did show an HNR there (the case is real: noise-derived values)", base.out.filter((o, i) => hidden[i] && o.hnr !== null).length > 60);

console.log("\nnothing else moves");
check("frames the gate does not hide paint exactly what the ungated app paints",
  gated.out.every((o, i) => hidden[i] || o.painted === base.out[i].painted),
  gated.out.map((o, i) => (hidden[i] || o.painted === base.out[i].painted ? "" : i)).filter(String).join(","));
check("raw voiced / holding unchanged", gated.out.every((o, i) => o.voiced === base.out[i].voiced && o.holding === base.out[i].holding));
check("formants unchanged", gated.out.every((o, i) => JSON.stringify(o.formants) === JSON.stringify(base.out[i].formants)));
check("HNR readout unchanged on frames the gate does not hide", gated.out.every((o, i) => hidden[i] || o.hnr === base.out[i].hnr));
check("recorded hnr unchanged (the DSP value; display-only gate)", gated.rec.every((r, i) => r.hnr === base.rec[i].hnr));
check("recorded voiced / f0 unchanged (session stats)", gated.rec.length === base.rec.length &&
  gated.rec.every((r, i) => r.voiced === base.rec[i].voiced && r.f0 === base.rec[i].f0 && r.intensity === base.rec[i].intensity));
check("recorded painted = what the live trace drew", gated.rec.every((r, i) => r.painted === (gated.out[i].painted > 0)));
check("recorded voiceGate: hidden / voice", gated.rec.every((r, i) => r.voiceGate === (hidden[i] ? "hidden" : "voice")));
check("no voiceGate field without decisions", base.rec.every((r) => !("voiceGate" in r)));

console.log("\nthe cue strip's rows (cueRowStates on the hook's flags)");
{
  // Two resonance worker states: one with a position (the row would draw
  // it), one still warming up (the row would say "keep talking…").
  const SNAPS = {
    live: { u: 0.5, raw: 0, verdict: "score", voicedS: 30, fill: 1, sinceResumeS: 30, narrowband: { on: false, decided: true } },
    warming: { u: null, raw: null, verdict: "warming", voicedS: 0.5, fill: 0, sinceResumeS: null, narrowband: { on: false, decided: true } },
  };
  const rowsOf = (o, snap) => CS.cueRowStates({ pitchVoiced: o.pitchVoiced, pitchHolding: o.pitchHolding, pitchLevel: o.level, snap, workerStatus: "ready" });
  for (const [name, snap] of Object.entries(SNAPS)) {
    const g = gated.out.map((o) => rowsOf(o, snap));
    const b = base.out.map((o) => rowsOf(o, snap));
    check(`${name}: the resonance row stays idle on every hidden frame (no dot, no "keep talking…")`,
      g.every((r, i) => !hidden[i] || r.resonance === "idle"),
      g.map((r, i) => (!hidden[i] || r.resonance === "idle" ? "" : `${i}:${r.resonance}`)).filter(String).slice(0, 8).join(","));
    check(`${name}: the ungated app's resonance row reacts there (the case is real)`,
      b.filter((r, i) => hidden[i] && r.resonance !== "idle").length > 60);
    check(`${name}: both rows equal the ungated app's on every frame the gate does not hide`,
      g.every((r, i) => hidden[i] || (r.resonance === b[i].resonance && r.pitch === b[i].pitch)),
      g.map((r, i) => (hidden[i] || (r.resonance === b[i].resonance && r.pitch === b[i].pitch) ? "" : `${i}:${r.resonance}/${b[i].resonance}`)).filter(String).slice(0, 8).join(","));
  }
  const offRows = off.out.map((o) => rowsOf(o, SNAPS.warming));
  const baseRows = base.out.map((o) => rowsOf(o, SNAPS.warming));
  check("setting off: the rows equal the ungated app's", offRows.every((r, i) => r.resonance === baseRows[i].resonance && r.pitch === baseRows[i].pitch));
  // The rows read the gated flags only: the raw ones no longer matter.
  check("the raw voiced / holding flags no longer drive the resonance row",
    CS.cueRowStates({ voiced: true, holding: true, pitchVoiced: false, pitchHolding: false, pitchLevel: null, snap: SNAPS.live, workerStatus: "ready" }).resonance === "idle");
}

console.log("\nsetting off");
check("display identical to the ungated app", off.out.every((o, i) => JSON.stringify(o) === JSON.stringify(base.out[i])));
check("recorded painted identical; voiceGate novoice / voice", off.rec.every((r, i) => r.painted === base.rec[i].painted && r.voiceGate === (hidden[i] ? "novoice" : "voice")));

console.log("\ndecision voice everywhere");
{
  const allVoice = await run(SEQ.map((f) => ({ x: f.x, vad: true })));
  check("display identical to the ungated app", allVoice.out.every((o, i) => JSON.stringify(o) === JSON.stringify(base.out[i])));
}

console.log("\nsilence after speech: the 5 s silence hold is unchanged");
{
  // Speech, then quiet: the detector's hangover keeps "voice" for 2 s, then
  // says "no voice". The dim held readout still holds for the whole 5 s
  // silence hold (3 s here), as without the gate: it holds the last pitch the
  // gate showed.
  const HOLD = [...rep(205, 60, true), ...rep("q", 80, true), ...rep("q", 40, false)];
  const b = await run(strip(HOLD));
  const g = await run(HOLD);
  const late = HOLD.map((f) => f.x === "q" && f.vad === false);
  check("the ungated app holds the last pitch dimmed through these quiet frames (the case is real)",
    b.out.filter((o, i) => late[i] && o.pitch !== null && o.pitchHolding).length === 40);
  check("gate on: readout, note, level, steadiness and pitch flags equal the ungated app on every frame",
    g.out.every((o, i) => ["pitch", "note", "level", "steadiness", "pitchVoiced", "pitchHolding"].every((k) => o[k] === b.out[i][k])),
    g.out.map((o, i) => (["pitch", "note", "level", "steadiness", "pitchVoiced", "pitchHolding"].every((k) => o[k] === b.out[i][k]) ? "" : i)).filter(String).slice(0, 8).join(","));
  check("recorded frames: voiceGate hidden on the no-voice quiet frames, nothing painted there",
    g.rec.every((r, i) => !late[i] || (r.voiceGate === "hidden" && r.painted === false)));
  check("HNR: the held value for the whole silence hold, as in the ungated app (also once the detector says no voice)",
    g.out.every((o, i) => o.hnr === b.out[i].hnr) && b.out.filter((o, i) => late[i] && o.hnr !== null).length === 40,
    g.out.map((o, i) => (o.hnr === b.out[i].hnr ? "" : i)).filter(String).slice(0, 8).join(","));
}
{
  // The same quiet after painted frames the gate hid: no stale held value.
  const NOISE = [...rep(205, 40, true), ...rep(117, 40, false), ...rep("q", 40, false)];
  const g = await run(NOISE);
  const b = await run(strip(NOISE));
  const q = NOISE.map((f) => f.x === "q");
  check("after a line the gate hid, the silence hold shows nothing and no holding flag (not the older pitch)",
    g.out.every((o, i) => !q[i] || (o.pitch === null && o.note === null && !o.pitchHolding)));
  check("after a line the gate hid, the silence hold shows no HNR either (the ungated app holds one there)",
    g.out.every((o, i) => !q[i] || o.hnr === null) && b.out.filter((o, i) => q[i] && o.hnr !== null).length === 40);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
