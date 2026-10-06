// bridge-evidence-test.js — the voice-evidence rule for drawing the
// pitch-hold bridge (src/audio/bridgeEvidence.js) and its wiring in the REAL
// hook (useAudioPipeline.js handleAnalysisResult), 2026-10-06,
// measurements/pitch-hold-bridge-rework-2026-10-06.md. Same harness as
// display-hook-test.js: the session oracle's module hooks load the hook in
// Node with a one-render React mock.
//
// Usage: node tests/audio/bridge-evidence-test.js

import { register } from "node:module";

register(new URL("../../scripts/session-oracle/lib/hooks.mjs", import.meta.url));
const { M } = await import(new URL("../../scripts/session-oracle/lib/react-mock.mjs", import.meta.url).href);
const HOOK = new URL("../../src/audio/useAudioPipeline.js", import.meta.url).href;
const BE = await import(new URL("../../src/audio/bridgeEvidence.js", import.meta.url).href);

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`); }
}

const HOP = 25;
// A frame sequence driver for the module alone: push(fresh, cpp) advances 25 ms.
function drive() {
  const ev = BE.createBridgeEvidence();
  let t = 1000;
  return {
    ev,
    push(fresh, cpp) { t += HOP; ev.push({ now: t, fresh, cpp }); },
    allow() { return ev.allowHeld(t); },
  };
}

console.log("createBridgeEvidence");
{
  const d = drive();
  for (let i = 0; i < 4; i++) d.push(true, 0.3);    // weak voiced run (100 ms, < BRIDGE_LONG_RUN_MS)
  d.push(false, 0.3); d.push(false, 0.3);           // 50 ms into the gap
  check(`a gap's first BRIDGE_GRACE_MS (${BE.BRIDGE_GRACE_MS} ms) is drawn without evidence`, d.allow());
  d.push(false, 0.3);
  check("past the grace, no strong voiced frame: not drawn", !d.allow());
  d.push(true, BE.BRIDGE_CPP_MIN + 0.05); d.push(true, BE.BRIDGE_CPP_MIN + 0.05);
  for (let i = 0; i < 4; i++) d.push(false, 0.3);
  check("two voiced frames with mean CPP >= BRIDGE_CPP_MIN are evidence: drawn", d.allow());
  const n = Math.ceil(BE.BRIDGE_EVIDENCE_MS / HOP) + 2;
  for (let i = 0; i < n; i++) d.push(i % 5 === 0, 0.3);
  d.push(false, 0.3); d.push(false, 0.3); d.push(false, 0.3);
  check(`the evidence expires after BRIDGE_EVIDENCE_MS (${BE.BRIDGE_EVIDENCE_MS} ms)`, !d.allow());
}
{
  const d = drive();
  for (let i = 0; i < BE.BRIDGE_LONG_RUN_MS / HOP; i++) d.push(true, 0.3);   // a 250 ms weak run
  for (let i = 0; i < BE.BRIDGE_LONG_GRACE_MS / HOP; i++) d.push(false, 0.3);
  check(`after a >= BRIDGE_LONG_RUN_MS run the first BRIDGE_LONG_GRACE_MS (${BE.BRIDGE_LONG_GRACE_MS} ms) are drawn`, d.allow());
  d.push(false, 0.3);
  check("... and not beyond", !d.allow());
}
{
  const d = drive();
  d.push(true, 0.9); d.push(false, 0.2); d.push(false, 0.2); d.push(false, 0.2); d.push(false, 0.2);
  check("one strong voiced frame alone is not evidence (needs CPP_SMOOTH_MIN voiced frames)", !d.allow());
}
{
  const d = drive();
  d.push(false, 0.9); d.push(false, 0.9); d.push(true, 0.3); d.push(false, 0.9); d.push(false, 0.3); d.push(false, 0.3); d.push(false, 0.3);
  check("CPP of unvoiced frames never counts", !d.allow());
}
{
  const d = drive();
  for (let i = 0; i < 4; i++) d.push(true, null);
  for (let i = 0; i < 10; i++) d.push(false, null);
  check("no CPP from the DSP worker (input < 16 kHz) fails open", d.allow());
  const e = drive();
  for (let i = 0; i < 4; i++) e.push(true, 0.3);
  for (let i = 0; i < BE.CPP_MISSING_MS / HOP + 2; i++) e.push(false, null);
  check(`CPP missing for > CPP_MISSING_MS (${BE.CPP_MISSING_MS} ms) fails open`, e.allow());
}
{
  const ev = BE.createBridgeEvidence();
  check("before any voiced frame (nothing to hold) the rule is open", ev.allowHeld(5000));
}

// ---- the real hook ---------------------------------------------------------
// seq items: [pitch | null, cpp | null, intensity?]; one pitch message per
// frame (confidence 0.8 voiced / 0.3 unvoiced). Returns the painted value per
// frame (0 = gap) and the readout style (2 voiced, 1 holding, 0 inactive).
let gen = 0;
async function run(seq) {
  M.refs = []; M.effects = []; M.state = null;
  const mod = await import(`${HOOK}?be=${++gen}`);
  const api = mod.useAudioPipeline();
  for (const e of M.effects) { try { e(); } catch { /* effects that need a DOM */ } }
  const latest = M.refs.find((r) => r.current && typeof r.current === "object" &&
    "pitch" in r.current && "ts" in r.current && "confidence" in r.current && "voiced" in r.current);
  const har = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handleAnalysisResult");
  if (!latest || !har) throw new Error("hook refs not found — did useAudioPipeline's ref layout change?");
  let t = 1e6;
  const paint = [];
  for (const [pitch, cpp, intensity = -30] of seq) {
    t += HOP;
    latest.current = { pitch, confidence: pitch === null ? 0.3 : 0.8, voiced: pitch !== null, ts: t };
    har.current({ intensity, formants: null, spectralTilt: null, hnr: null, cpp, absoluteTime: t });
    const trace = api.pitchTraceRef.current;
    const e = trace[trace.length - 1];
    paint.push(e && e.time === Math.round(t) && e.pitch !== null ? e.pitch : 0);
  }
  return paint;
}
const rep = (x, n) => Array(n).fill(x);
const idx = (start, len) => Array.from({ length: len }, (_, i) => start + i);
const show = (a) => a.map((v) => Math.round(v)).join(",");

console.log("\nreal hook: weak-CPP (noise-like) vs strong-CPP (voice-like) gaps");
{
  // Short weakly harmonic runs 200 ms apart: the pattern the bridge used to
  // join into one line on real machine noise.
  const weak = [...rep([120, 0.3], 6), ...rep([null, 0.3], 8), ...rep([120, 0.3], 6), ...rep([null, 0.3], 8), ...rep([120, 0.3], 6)];
  const out = await run(weak);
  const g1 = idx(6, 8), g2 = idx(20, 8);
  check("weak: the first 2 frames of each gap (grace) are drawn", [g1, g2].every((g) => out[g[0]] > 0 && out[g[1]] > 0), show(out));
  check("weak: gap frames past the grace are hidden", [g1, g2].every((g) => g.slice(2).every((i) => out[i] === 0)), show(out));
  check("weak: the run after a hidden gap paints from its first frame (continuity kept)", out[14] > 0 && out[28] > 0, show(out));
  const strong = weak.map(([p, c]) => [p, p === null ? c : 0.8]);
  const o2 = await run(strong);
  check("strong: every gap frame is drawn, as before", [g1, g2].every((g) => g.every((i) => o2[i] > 0)), show(o2));
}
{
  // A voice from the stream's first frame: its own strong frames are the
  // evidence (nothing is learned about a background).
  const out = await run([...rep([200, 0.9], 5), ...rep([null, 0.3], 10), ...rep([200, 0.9], 5)]);
  check("voice from the first frame: its first gap is drawn", idx(5, 10).every((i) => out[i] > 0), show(out));
}
{
  const out = await run([...rep([150, null], 6), ...rep([null, null], 10), ...rep([150, null], 4)]);
  check("no CPP: the bridge is drawn as before", idx(6, 10).every((i) => out[i] > 0), show(out));
}

console.log("\nhide-only: the painted trace is the fail-open trace minus some held frames");
{
  // Random words / gaps / blips with random CPP. With CPP the hook may only
  // REMOVE held frames from what it paints with CPP absent (the pre-change
  // display) — never add, move or change a painted value.
  let seed = 4242;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  let extra = 0, changed = 0, hidden = 0, painted = 0, example = "";
  for (let s = 0; s < 40; s++) {
    const seq = [];
    let f = pick([110, 130, 220, 250]);
    const strongWord = rnd() < 0.3;
    for (let w = 0; w < 8; w++) {
      const len = 3 + Math.floor(rnd() * 14);
      for (let k = 0; k < len; k++) {
        const r = rnd();
        const p = r < 0.06 ? f * pick([2, 0.5, 1.5]) : f * Math.pow(2, (rnd() - 0.5) * 0.4 / 12);
        seq.push([p, strongWord ? 0.4 + 0.6 * rnd() : 0.15 + 0.3 * rnd()]);
      }
      const gl = 1 + Math.floor(rnd() * 18);
      const quiet = rnd() < 0.2;
      for (let k = 0; k < gl; k++) seq.push([null, 0.1 + 0.2 * rnd(), quiet ? -70 : -38]);
      if (rnd() < 0.4) f = pick([110, 130, 220, 250]);
    }
    const withCpp = await run(seq);
    const failOpen = await run(seq.map(([p, , i]) => [p, null, i]));
    for (let k = 0; k < seq.length; k++) {
      if (withCpp[k] > 0) painted++;
      if (withCpp[k] > 0 && failOpen[k] === 0) { extra++; if (!example) example = `seq ${s} frame ${k}: extra`; }
      if (withCpp[k] > 0 && failOpen[k] > 0 && withCpp[k] !== failOpen[k]) { changed++; if (!example) example = `seq ${s} frame ${k}: changed`; }
      if (withCpp[k] === 0 && failOpen[k] > 0) {
        hidden++;
        if (seq[k][0] !== null && !example) example = `seq ${s} frame ${k}: a fresh frame was hidden`;
      }
    }
  }
  check(`no frame painted that the fail-open display leaves blank, no value changed (${painted} painted)`, extra === 0 && changed === 0, example);
  check(`only held frames are hidden (${hidden} hidden)`, hidden > 0 && !example.includes("fresh"), example);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
