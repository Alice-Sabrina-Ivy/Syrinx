// heard-as-responsiveness-test.js — the "Likely heard as" panel's first
// reading and its readings through pauses (2026-10-21: H1 = 2 s of voiced
// pitch in the 8 s pool instead of 3 s, H3 = with no reading shown, the
// panel's 250 ms check shows one as soon as estimate() has it;
// measurements/heard-as-low-pitch-and-pauses-2026-10-21.md §8.7).
//
// The panel's two timers are replayed on the audio clock exactly as
// HeardAsPanel.jsx runs them (model ready): compute() at mount and every
// updateMs, and every HIDE_CHECK_MS the app's own quickCheck() (update /
// first reading / nothing), over the app's aggregator with the shipped
// constants, at four timer phases. The streams are the app's chain output on
// public data (tests/ml/fixtures/heard-as-responsiveness.json: LibriSpeech
// dev-clean readers with natural and 2.5 s pauses, the same readers
// WORLD-shifted to ~75 Hz, real-chain held notes, noise and silence) plus a
// synthetic whisper stand-in (the real whisper sets are CC BY-NC, not stored).
// A source check ties the replay to HeardAsPanel.jsx's wiring.
//
// Fails on the panel before 2026-10-21 (3 s rule, no first-reading check):
// the first-reading, pause, phase and low-pitch checks. The held-note, noise
// and whisper checks pass on both by design: they guard that the faster panel
// adds no reading there.
//
//   node tests/ml/heard-as-responsiveness-test.js

import { readFileSync } from "node:fs";
import { createHeardAsAggregator, heardAsShares, isWideShare } from "../../src/ml/heard-as.js";
import { HEARD_AS_CALIBRATION as C } from "../../src/ml/heardAsCalibration.js";
import { quickCheck } from "../../src/components/heardAsAxisModel.js";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/heard-as-responsiveness.json", import.meta.url), "utf8"));
const PANEL = readFileSync(new URL("../../src/components/HeardAsPanel.jsx", import.meta.url), "utf8");

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

const HIDE_CHECK_MS = Number(/const HIDE_CHECK_MS = (\d+);/.exec(PANEL)?.[1]);
const PHASES = [0, 500, 1000, 1500];

console.log("HeardAsPanel.jsx wiring (what the replay below assumes)");
{
  check("the 250 ms check: HIDE_CHECK_MS 250, 2 s updates", HIDE_CHECK_MS === 250 && C.updateMs === 2000, `${HIDE_CHECK_MS}, ${C.updateMs}`);
  check("compute() at mount and every updateMs", /computeRef\.current = compute;\s*compute\(\);\s*const id = setInterval\(compute, HEARD_AS_CALIBRATION\.updateMs\);/.test(PANEL));
  check("the 250 ms timer runs quickCheck(shown, voice state): update -> compute(), first -> first()",
    /setInterval\(\(\) => \{\s*const q = quickCheck\(shownRef\.current, genderStateRef\?\.current\?\.state \?\? null\);\s*if \(q === "update"\) compute\(\);\s*else if \(q === "first"\) first\(\);\s*\}, HIDE_CHECK_MS\)/.test(PANEL));
  const first = /const first = \(\) => \{([\s\S]*?)\n {4}\};/.exec(PANEL)?.[1] ?? "";
  check("first(): a reading when estimate() has one, else the view stays; it never feeds the pitch-only warning",
    first.includes(".estimate(") && /if \(e\.hidden\) return;/.test(first) && first.includes("show(") && !first.includes("warn(") && !first.includes("warning?.update"),
    first ? "" : "first() not found");
  // 2026-10-21 review: after a hide, the reading came back without the
  // pitch-only note while the live region still announced the warning.
  check("first(): the pitch-only note and the live region both follow the warning's held run",
    /const held = warning\?\.held\(\) === true;/.test(first) && /pitchOnly: held, live: held/.test(first) && !/pitchOnly: false/.test(first),
    first ? "" : "first() not found");
}

// ---------------------------------------------------------------- replay
function decode(st) {
  const ev = [];
  let i = 0;
  for (const v of st.f0) {
    if (v < 0) for (let k = 0; k < -v; k++, i++) ev.push([st.t0 + 25 * i, 0, 0]);
    else ev.push([st.t0 + 25 * i++, 0, v]);
  }
  let j = 0;
  for (const [ms, c] of st.windows) ev.push([ms, 1, c ? st.logits[j++] : null, c]);
  for (const [ms, s] of st.states) ev.push([ms, 2, s]);
  return ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// The panel before 2026-10-21 (reference only): its 250 ms timer recomputed only to hide a shown reading on a held note.
const OLD_CHECK = (shown, vs) => (shown && vs === "sustained" ? "update" : null);
const OLD = { agg: { minVoicedMs: 3000 }, check: OLD_CHECK };
const SHIPPED = { agg: {}, check: quickCheck };

function replay(st, { agg = {}, check: q = quickCheck } = {}, phaseMs = 0) {
  const a = createHeardAsAggregator(agg);
  const ev = decode(st);
  let k = 0, vs = null, view = { shown: false, reason: "listening" };
  const reading = (e) => { const sh = heardAsShares(e.meterLogit, e.lnF0); return { shown: true, eta: sh.eta, wide: isWideShare([sh.sLow, sh.sHigh]) }; };
  const compute = (now) => { const e = a.estimate(now, vs); view = e.hidden ? { shown: false, reason: e.hidden } : reading(e); };
  const out = [];
  for (let now = HIDE_CHECK_MS; now <= st.durMs + 1e-6; now += HIDE_CHECK_MS) {
    while (k < ev.length && ev[k][0] <= now) {
      const [ms, type, x, c] = ev[k++];
      if (type === 0) a.addPitch({ audioMs: ms, f0: x });
      else if (type === 1) a.addWindow({ audioMs: ms, logit: x, mode: "gated", classified: !!c });
      else vs = x;
    }
    if ((now - phaseMs) % C.updateMs === 0) compute(now); // the 2 s timer (mounted at phaseMs)
    const r = q(view.shown, vs); // the 250 ms timer
    if (r === "update") compute(now);
    else if (r === "first") { const e = a.estimate(now, vs); if (!e.hidden) view = reading(e); }
    out.push({ t: now, vs, ...view });
  }
  return out;
}
const firstS = (st, sm) => { const x = sm.find((s) => s.t >= st.leadMs && s.shown); return x ? (x.t - st.leadMs) / 1000 : null; };
const shownShare = (st, sm) => { const v = sm.filter((s) => s.t >= st.leadMs); return v.filter((s) => s.shown).length / v.length; };
const fmt = (xs) => xs.map((x) => (x === null ? "never" : typeof x === "number" ? +x.toFixed(2) : x)).join(" / ");
const streams = (kind) => FIX.streams.filter((s) => s.kind === kind);

console.log("\nnatural pauses (LibriSpeech dev-clean): first reading sooner, the same at every timer phase");
for (const st of streams("pauses").filter((s) => s.id.endsWith("pnat"))) {
  const t = PHASES.map((p) => firstS(st, replay(st, SHIPPED, p)));
  const told = PHASES.map((p) => firstS(st, replay(st, OLD, p)));
  check(`${st.id} (${st.sex}): first reading <= 4.5 s at every phase`, t.every((x) => x !== null && x <= 4.5), `${fmt(t)} s; 3 s rule ${fmt(told)} s`);
  check(`${st.id}: shown as soon as ready, not on the 2 s timer (same time at all four phases)`, t.every((x) => x === t[0]), fmt(t));
}

console.log("\n2.5 s pauses between sentences: the reading comes early and stays through the pauses");
for (const st of streams("pauses").filter((s) => s.id.endsWith("p2.5"))) {
  const sm = PHASES.map((p) => replay(st, SHIPPED, p)), so = PHASES.map((p) => replay(st, OLD, p));
  const t = sm.map((x) => firstS(st, x)), share = sm.map((x) => shownShare(st, x)), shareOld = so.map((x) => shownShare(st, x));
  check(`${st.id} (${st.sex}): first reading <= 3.5 s at every phase`, t.every((x) => x !== null && x <= 3.5), `${fmt(t)} s; 3 s rule ${fmt(so.map((x) => firstS(st, x)))} s`);
  check(`${st.id}: a reading shown >= 70 % of the time from the speech start (${(st.durMs / 1000).toFixed(0)} s)`, share.every((x) => x >= 0.7),
    `${fmt(share.map((x) => 100 * x))} %; 3 s rule ${fmt(shareOld.map((x) => 100 * x))} %`);
}

console.log("\nvoices WORLD-shifted to ~75 Hz (natural pauses): a reading, which the 3 s rule never gave");
for (const st of streams("low")) {
  const sm = PHASES.map((p) => replay(st, SHIPPED, p));
  const t = sm.map((x) => firstS(st, x));
  const told = PHASES.map((p) => firstS(st, replay(st, OLD, p)));
  check(`${st.id} (${st.sex}): a reading by 8 s at every phase`, t.every((x) => x !== null && x <= 8), `${fmt(t)} s; 3 s rule ${fmt(told)} s within ${(st.durMs / 1000).toFixed(0)} s`);
}

console.log("\nreadings the 3 s rule showed are unchanged (same pool, same instant)");
{
  let n = 0, bad = 0, detail = "";
  for (const st of [...streams("pauses"), ...streams("low"), ...streams("held-after")]) {
    for (const p of PHASES) {
      const a = replay(st, OLD, p), b = replay(st, SHIPPED, p);
      a.forEach((x, i) => {
        if (!x.shown) return;
        n++;
        if (!b[i].shown || b[i].eta !== x.eta || b[i].wide !== x.wide) { bad++; detail ||= `${st.id} phase ${p} t ${x.t}`; }
      });
    }
  }
  check("every reading the 3 s rule showed is shown, identical, by the shipped panel", n > 500 && bad === 0, `${n} samples, ${bad} differ ${detail}`);
}

console.log("\nheld notes (real chain): no reading while the voice state is \"sustained\"");
for (const st of streams("held-after")) {
  const sm = PHASES.map((p) => replay(st, SHIPPED, p));
  const before = sm.some((x) => x.some((s) => s.shown && s.vs !== "sustained"));
  const during = sm.reduce((a, x) => a + x.filter((s) => s.vs === "sustained" && s.shown).length, 0);
  const atStart = sm.map((x) => { const i = x.findIndex((s) => s.vs === "sustained"); return i < 0 ? "none" : x[i].shown ? "shown" : x[i].reason; });
  check(`${st.id}: a reading on the speech before it (the check is not vacuous)`, before);
  check(`${st.id}: hidden at the first 250 ms check of "sustained", and none shown while it lasts`, atStart.every((r) => r === "sustained") && during === 0,
    `at "sustained" start: ${atStart.join(" / ")}; shown during: ${during}`);
}
for (const st of streams("held")) {
  const sm = PHASES.map((p) => replay(st, SHIPPED, p));
  check(`${st.id}: no reading (voice state reaches "sustained")`, sm.every((x) => x.every((s) => !s.shown)) && st.states.some(([, s]) => s === "sustained"));
}

console.log("\nnoise and silence (real chain): no reading");
for (const st of streams("noise")) {
  const sm = PHASES.map((p) => replay(st, SHIPPED, p));
  check(`${st.id}: no reading in ${(st.durMs / 1000).toFixed(0)} s`, sm.every((x) => x.every((s) => !s.shown)));
}

console.log("\nunphonated whisper (synthetic stand-in): no reading");
{
  // Patterned on the worst unphonated whisper-only stream of the 2026-10-08 probe set rebuilt on
  // 2026-10-21 (EARS p084: at most 1.375 s of posted voiced pitch in the 8 s pool, 4 classified windows
  // counting), a little above it (up to 1.65 s pooled): 2 s whisper phrases every 2.6 s; the gate scores a window every 150 ms through each
  // phrase (+0.3 s), the classifier every third; three 150 ms voiced blips per phrase, the rest unvoiced.
  const durMs = 30000, f0 = [], windows = [], logits = [];
  const phrase = (t) => t >= 1000 && (t - 1000) % 2600 < 2000;
  const blip = (t) => phrase(t) && [300, 900, 1500].some((o) => { const d = (t - 1000) % 2600 - o; return d >= 0 && d < 150; });
  for (let t = 100; t <= durMs; t += 25) {
    if (blip(t)) f0.push(180);
    else if (f0.length && f0[f0.length - 1] < 0) f0[f0.length - 1]--;
    else f0.push(-1);
  }
  let n = 0;
  for (let t = 1450; t <= durMs; t += 150) {
    const u = (t - 1000) % 2600; // from 0.45 s into a phrase to 0.3 s after it
    if (u < 450 || u > 2300) continue;
    const c = n++ % 3 === 0 ? 1 : 0;
    windows.push([t, c]);
    if (c) logits.push(-1);
  }
  const st = { id: "synthetic whisper", leadMs: 1000, durMs, t0: 100, f0, windows, logits, states: [[0, "listening"], [1450, "scoring"]] };
  // what the pool holds, without the hide rules
  const a = createHeardAsAggregator({ minVoicedMs: 0, minWindows: 0 });
  let maxV = 0, maxW = 0, maxC = 0, k = 0;
  const ev = decode(st);
  for (let now = 250; now <= durMs; now += 250) {
    while (k < ev.length && ev[k][0] <= now) { const [ms, type, x, c] = ev[k++]; if (type === 0) a.addPitch({ audioMs: ms, f0: x }); else if (type === 1) a.addWindow({ audioMs: ms, logit: x, mode: "gated", classified: !!c }); }
    const g = a.aggregate(now);
    maxV = Math.max(maxV, g.voicedMs); maxW = Math.max(maxW, g.nWindows); maxC = Math.max(maxC, g.nClassified);
  }
  check("the stand-in pools like the worst real one: >= 10 windows, counted logits, 1.2-2 s voiced", maxW >= C.minWindows && maxC > 0 && maxV >= 1200 && maxV < C.minVoicedMs,
    `max ${maxW} windows, ${maxC} counted logits, ${maxV.toFixed(0)} ms voiced`);
  const sm = PHASES.map((p) => replay(st, SHIPPED, p));
  check("no reading in 30 s at any phase", sm.every((x) => x.every((s) => !s.shown)), `shown samples ${sm.map((x) => x.filter((s) => s.shown).length).join(" / ")}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
