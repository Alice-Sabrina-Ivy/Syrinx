// analyze.mjs — attribution tables of measurements/heard-as-low-pitch-and-pauses-2026-10-21.md
// from run.mjs outputs: the SHIPPED panel, or a pre-registered candidate
// (§6.1: H1 minVoicedMs 2000, H2 speech-time pool, H3 first reading on the
// 250 ms check, and their combinations) with --variant.
//
//   node analyze.mjs --runs=<run.0.jsonl,run.1.jsonl> --out=<dir> [--variant=<name>] [--split=dev|test]
//
// (importable: candidates.mjs uses simulate / settled / streamMetrics.)
//
// Live panel = src/ml/heard-as.js + src/ml/heardAsCalibration.js, updates every
// 2 s of audio from the stream start, the 250 ms held-note check, the display
// sampled every 250 ms (scripts/heard-as/hop-study.mjs and
// voiced-windows/eval.mjs convention), "Can't tell yet" = heard-as.js
// isWideShare on the two-way range (the panel's heardAsAxisModel.js rule).
// Times are measured from the stream's speech start (1 s lead-in of low noise).
// Writes <out>/streams.json (per stream summaries) and prints the tables.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { createHeardAsAggregator, heardAsShares, isWideShare, outsideTestedRange, ML_WINDOW_MS } = await import(pathToFileURL(path.join(repo, "src/ml/heard-as.js")).href);
const { HEARD_AS_CALIBRATION: C } = await import(pathToFileURL(path.join(repo, "src/ml/heardAsCalibration.js")).href);
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");

// Pre-registered candidates (measurements/heard-as-low-pitch-and-pauses-2026-10-21.md §6.1).
// "shipped" is the panel BEFORE 2026-10-21 (4a3db78): the 3 s voiced rule and
// no first-reading check. It is pinned here, not read from
// heardAsCalibration.js, which carries H1's 2 s since 2026-10-21 (until the
// 2026-10-21 review, `shipped: { agg: {} }` took the calibration file's value,
// so a run after the change compared H1 with H1+H3 — note §8.3, §9).
const BASE = { minVoicedMs: 3000 };
const H1 = { minVoicedMs: 2000 };
const H2 = { poolGapCapMs: ML_WINDOW_MS, poolMaxBackMs: 16000 };
const H3 = { fastFirst: true };
export const VARIANTS = {
  shipped: { agg: { ...BASE }, panel: {}, changes: 0 },
  H1: { agg: { ...BASE, ...H1 }, panel: {}, changes: 1 },
  H2: { agg: { ...BASE, ...H2 }, panel: {}, changes: 1 },
  H3: { agg: { ...BASE }, panel: { ...H3 }, changes: 1 },
  "H1+H2": { agg: { ...BASE, ...H1, ...H2 }, panel: {}, changes: 2 },
  "H1+H3": { agg: { ...BASE, ...H1 }, panel: { ...H3 }, changes: 2 },
  "H2+H3": { agg: { ...BASE, ...H2 }, panel: { ...H3 }, changes: 2 },
  "H1+H2+H3": { agg: { ...BASE, ...H1, ...H2 }, panel: { ...H3 }, changes: 3 },
};
const VARIANT = arg("variant", "shipped");

// ---------------------------------------------------------------- panel
// H3 (panel.fastFirst): while no reading is shown, the 250 ms check also runs
// estimate() and shows a reading as soon as there is one (a check that finds
// none leaves the hidden view and its reason as they are); shown, updates stay
// on the 2 s timer (and only the 2 s updates are recorded in `updates`, the
// stream the pitch-only warning would see).
export function simulate(s, v = VARIANTS[VARIANT], phaseMs = 0) {
  const aggOpts = { ...v.agg };
  // v.makeAgg (lowhide.mjs): an aggregator wrapper that adds a candidate hide rule
  const agg = v.makeAgg ? v.makeAgg(aggOpts) : createHeardAsAggregator(aggOpts);
  const minWindows = aggOpts.minWindows ?? C.minWindows, minVoicedMs = aggOpts.minVoicedMs ?? C.minVoicedMs;
  const ev = [];
  for (const [ms, f0] of s.pitch) ev.push([ms, 0, f0]);
  for (const w of s.windows) ev.push([w[0], 1, w]);
  for (const t of s.ticks) ev.push([t[0], 2, t[1]]);
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const endMs = s.durS * 1000;
  let k = 0, voiceState = null, cur = { shown: false, reason: "listening" };
  const samples = [], updates = [];
  for (let now = 250; now <= endMs + 1e-6; now += 250) {
    while (k < ev.length && ev[k][0] <= now) {
      const [ms, type, x] = ev[k++];
      if (type === 0) agg.addPitch({ audioMs: ms, f0: x });
      else if (type === 1) agg.addWindow({ audioMs: ms, logit: x[2] ? s.logits[ms] : null, mode: x[1], classified: !!x[2] });
      else voiceState = x;
    }
    const update = (now - phaseMs) % C.updateMs === 0;
    const hideCheck = cur.shown && voiceState === "sustained";
    // H3's extra check (as HeardAsPanel.jsx): shows a ready reading, otherwise leaves the view as it is
    const firstCheck = !update && !hideCheck && !!v.panel?.fastFirst && !cur.shown;
    if (update || hideCheck || firstCheck) {
      const e = agg.estimate(now, voiceState);
      const g = agg.aggregate(now);
      if (e.hidden && firstCheck) {
        // still no reading: the hidden view (and its reason) stays
      } else if (e.hidden) {
        let why = e.hidden;
        if (why === "short") {
          // which input rule fails (several can): the first in this order
          why = g.nWindows < minWindows ? "short:windows" : g.voicedMs < minVoicedMs ? "short:voiced" : g.meterLogit === null ? "short:noLogit" : "short:noF0";
        } else if (why === "outside") {
          why = g.lnF0 < C.range.lnF0[0] ? "outside:lowF0" : g.lnF0 > C.range.lnF0[1] ? "outside:highF0" : "outside:logit";
        }
        cur = { shown: false, reason: why };
      } else {
        const sh = heardAsShares(e.meterLogit, e.lnF0);
        cur = { shown: true, reason: "", eta: sh.eta, s: sh.s, wide: isWideShare([sh.sLow, sh.sHigh]) };
      }
      if (update) updates.push({ t: now, ...cur, nWindows: g.nWindows, nClassified: g.nClassified, voicedMs: g.voicedMs, lnF0: g.lnF0, meterLogit: g.meterLogit });
    }
    samples.push({ t: now, vs: voiceState, upd: update, ...cur });
  }
  return { samples, updates };
}

/** The stream's settled reading: every scored window of the stream pooled once (no hide rules). */
export function settled(s) {
  const agg = createHeardAsAggregator({ windowMs: Infinity, minVoicedMs: 0, minWindows: 0 });
  for (const [ms, f0] of s.pitch) agg.addPitch({ audioMs: ms, f0 });
  for (const w of s.windows) agg.addWindow({ audioMs: w[0], logit: w[2] ? s.logits[w[0]] : null, mode: w[1], classified: !!w[2] });
  const g = agg.aggregate(Infinity);
  if (g.meterLogit === null || g.lnF0 === null) return null;
  const sh = heardAsShares(g.meterLogit, g.lnF0);
  return { eta: sh.eta, wide: isWideShare([sh.sLow, sh.sHigh]), outside: outsideTestedRange(g.meterLogit, g.lnF0), f0: Math.exp(g.lnF0), meterLogit: g.meterLogit, nClassified: g.nClassified, voicedMs: g.voicedMs };
}

// ---------------------------------------------------------------- per-stream metrics
const inSpeech = (spans, a, b) => { let x = 0; for (const [s0, s1] of spans) x += Math.max(0, Math.min(b, s1) - Math.max(a, s0)); return x; };

function refAt(ref, hopMs, ms) { const i = Math.round(ms / hopMs); return i >= 0 && i < ref.length ? ref[i] : 0; }

// The panel's 2 s timer starts when the panel mounts, not when speech starts:
// every stream is simulated at four timer phases (0, 0.5, 1, 1.5 s) and the
// time / share metrics are their mean (a phase that never reaches a state
// counts the whole stream span; "never" = no phase reaches it). Update-level
// tables use phase 0.
const PHASES = [0, 500, 1000, 1500];
export function streamMetrics(s, vname = VARIANT) {
  const lead = s.leadMs ?? 1000;
  const speechEnd = s.speechSpans[s.speechSpans.length - 1][1];
  const spanS = (speechEnd + 1000 - lead) / 1000;
  const per = PHASES.map((ph) => {
    const { samples, updates } = simulate(s, VARIANTS[vname], ph);
    const vis = samples.filter((x) => x.t >= lead && x.t <= speechEnd + 1000);
    const tFirst = (pred) => { const x = samples.find((q) => q.t >= lead && pred(q)); return x ? (x.t - lead) / 1000 : null; };
    return { samples, updates, vis, tF: tFirst((q) => q.shown), tI: tFirst((q) => q.shown && !q.wide),
      shown: vis.filter((x) => x.shown).length / vis.length, inf: vis.filter((x) => x.shown && !x.wide).length / vis.length };
  });
  const meanT = (k) => per.every((p) => p[k] === null) ? null : per.reduce((a, p) => a + (p[k] ?? spanS), 0) / per.length;
  const reasons = {};
  let nVis = 0;
  for (const p of per) { for (const x of p.vis) { const r = x.shown ? (x.wide ? "shown:wide" : "shown:informative") : x.reason; reasons[r] = (reasons[r] ?? 0) + 1; } nVis += p.vis.length; }
  const { updates, vis } = per[0];
  const m = {
    id: s.id, family: s.family, set: s.set, split: s.split, sex: s.sex, voice: s.voice, pause: s.pause, speaker: s.speaker, factor: s.factor,
    speechS: s.speechSpans.reduce((a, [x, y]) => a + (y - x), 0) / 1000,
    spanS,
    tFirst: meanT("tF"),
    tInf: meanT("tI"),
    tFirstPh: per.map((p) => p.tF), tInfPh: per.map((p) => p.tI),
    shareShown: per.reduce((a, p) => a + p.shown, 0) / per.length,
    shareInf: per.reduce((a, p) => a + p.inf, 0) / per.length,
    reasons, nVis,
  };
  // the same "after first reading" (hide churn once a reading has appeared)
  const after = per[0].tF === null ? [] : vis.filter((x) => x.t >= lead + per[0].tF * 1000);
  m.shareShownAfterFirst = after.length ? after.filter((x) => x.shown).length / after.length : null;
  const st = settled(s);
  m.settled = st;
  // wide-time decomposition: shown wide samples while the settled reading is wide (voice) or not (pooling)
  const wideS = per.flatMap((p) => p.vis.filter((x) => x.shown && x.wide));
  m.wideVoice = st && st.wide ? wideS.length : 0;
  m.widePool = st && !st.wide ? wideS.length : 0;
  // per update: voiced time inside scored spans (vMs, what the rule counts), all posted voiced time
  // in the trailing 8 s (pv8: what scoring could have counted) and speech time in it (sp8)
  const pv = []; { let last = null; for (const [ms, f0] of s.pitch) { const dt = last === null ? 25 : Math.min(Math.max(ms - last, 0), 100); last = ms; if (f0 > 0) pv.push([ms, dt]); } }
  const pv8 = (t) => { let x = 0; for (const [ms, dt] of pv) if (ms > t - C.windowMs && ms <= t) x += dt; return x; };
  m.updates = updates.filter((u) => u.t >= lead).map((u) => ({ t: u.t - lead, shown: u.shown, reason: u.reason, wide: u.wide ?? null, eta: u.eta ?? null, nW: u.nWindows, nC: u.nClassified, vMs: u.voicedMs, pv8: pv8(u.t), sp8: inSpeech(s.speechSpans, u.t - C.windowMs, u.t), f0: u.lnF0 === null ? null : Math.exp(u.lnF0) }));

  // ---- gate verdicts on speech windows (window span >= 50 % speech)
  const verd = {};
  let nSpeechTicks = 0;
  const sp = s.speech;
  for (const t of s.ticks) {
    const [ms, , verdict, warm, score] = t;
    const frac = inSpeech(s.speechSpans, ms - ML_WINDOW_MS, ms) / ML_WINDOW_MS;
    if (frac < 0.5) continue;
    nSpeechTicks++;
    let key = verdict === "warming" ? `warming:${warm}` : verdict === "score" && !score ? "pause:floor" : verdict;
    if (verdict === "pause") {
      // recency (no speech frame <= 500 ms old) vs share (< 15 % speech frames in the window)
      let last = null, n = 0, on = 0;
      for (const [ts, p] of sp) { if (ts > ms) break; if (p >= 0.5) last = ts; if (ts > ms - ML_WINDOW_MS) { n++; if (p >= 0.5) on++; } }
      key = last === null || ms - last > 500 ? "pause:recency" : on / Math.max(n, 1) < 0.15 ? "pause:share" : "pause:voicing";
    }
    verd[key] = (verd[key] ?? 0) + 1;
  }
  m.verdicts = verd; m.nSpeechTicks = nSpeechTicks;
  // spans (utterances) opened while speech lasted, and closes by the 1 s gap
  const spanIds = new Set(s.ticks.filter((t) => t[5] !== null && t[5] !== undefined && t[2] !== "stale").map((t) => t[5]));
  m.spans = spanIds.size;
  // scored windows mostly in a pause (Silero hangover + recency let them through)
  const sc = s.windows.filter((w) => w[1] === "gated");
  m.scored = sc.length;
  m.scoredMostlyPause = sc.filter((w) => inSpeech(s.speechSpans, w[0] - ML_WINDOW_MS, w[0]) < 0.5 * ML_WINDOW_MS).length;
  // classified windows whose logit does not count (logitMinVoicedMs: < 200 ms posted voiced in its span)
  const fr = s.pitch;
  const cls = sc.filter((w) => w[2]);
  let noQual = 0;
  for (const w of cls) {
    let v = 0, last = null;
    for (const [ms, f0] of fr) { if (ms > w[0]) break; const dt = last === null ? 25 : Math.min(Math.max(ms - last, 0), 100); last = ms; if (ms >= w[0] - ML_WINDOW_MS && f0 > 0) v += dt; }
    if (v < (C.logitMinVoicedMs ?? 0)) noQual++;
  }
  m.classified = cls.length; m.classifiedNoLogit = noQual;
  // Silero hangover: after each speech span, time until the last p >= 0.5 frame
  const hang = [];
  // (only spans followed by a pause >= 0.3 s; the look-ahead stops where the next speech starts)
  for (let i = 0; i + 1 < s.speechSpans.length; i++) {
    const e = s.speechSpans[i][1], next = s.speechSpans[i + 1][0];
    if (next - e < 300) continue;
    let lastOn = null;
    for (const [ts, p] of sp) { if (ts < e) continue; if (ts > Math.min(e + 1500, next)) break; if (p >= 0.5) lastOn = ts; }
    hang.push(lastOn === null ? 0 : lastOn - e);
  }
  m.hangoverMs = median(hang);

  // ---- pitch stages on reference-voiced frames inside speech spans
  if (s.ref) {
    const ref = new Float32Array(readFileSync(s.ref).buffer.slice(0));
    const bands = {};
    for (const [ms, dec, veto, above, gv] of s.stages) {
      if (inSpeech(s.speechSpans, ms - 1, ms) <= 0) continue;
      // posted frame time = chunk end; its analysis window is centred ~40 ms earlier
      const r = refAt(ref, s.refHopMs ?? 5, ms - 40);
      if (!(r > 0)) continue;
      const band = r < 75 ? "<75" : r < 81 ? "75-81" : r < 90 ? "81-90" : r < 100 ? "90-100" : r < 160 ? "100-160" : r < 230 ? "160-230" : ">=230";
      const st = !(dec > 0) ? "tracker" : veto ? "ghost" : above ? "above400" : gv ? "guard" : "posted";
      bands[band] ??= {}; bands[band][st] = (bands[band][st] ?? 0) + 1;
    }
    m.pitchStages = bands;
  }
  return m;
}

function median(a) { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const h = b.length >> 1; return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; }

// ---------------------------------------------------------------- main
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!VARIANTS[VARIANT]) throw new Error(`unknown variant ${VARIANT}`);
  const OUT = arg("out", ".");
  const SPLIT = arg("split", "all");
  mkdirSync(OUT, { recursive: true });
  const rows = [];
  for (const p of arg("runs", "").split(",")) {
    for (const l of readFileSync(p, "utf8").split("\n")) {
      if (!l.trim()) continue;
      const s = JSON.parse(l);
      if (SPLIT !== "all" && s.split !== SPLIT) continue;
      rows.push(streamMetrics(s));
    }
  }
  const tag = SPLIT === "all" ? VARIANT : `${VARIANT}.${SPLIT}`;
  writeFileSync(path.join(OUT, `streams.${tag}.json`), JSON.stringify(rows));
  console.log(`${rows.length} streams -> ${path.join(OUT, `streams.${tag}.json`)}`);
}
