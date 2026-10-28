// pause-report.mjs — the pause-floor dropout of the Dashboard resonance row,
// stage 3 of 3: the REAL cue-strip model at the CueStrip's 4 Hz tick over the
// real hook's flags (pause-row.mjs) and the resonance worker's posts
// (chain.mjs, gate on), per stream; then the dose-response tables.
//
//   node scripts/resonance/mobile/pause-report.mjs [--runs=build/resonance-mobile/pause/runs]
//        [--hook=build/resonance-mobile/pause/hook] [--json=build/resonance-mobile/pause/summary.json]
//        [--from=20] [--md=<file>]
//
// What is replayed (src/components/CueStrip.jsx, read 2026-10-28):
//   - the hook's React state reaches the strip through the 200 ms
//     throttledSetState: the per-frame state (pause-row.mjs) is sampled at the
//     firing frames (the first frame >= 200 ms after the previous firing);
//   - resonanceRef.current = the latest resonance worker `state` post (one
//     post per 9 chunks = 225 ms of audio, at the end of its chunk);
//   - the 4 Hz tick (setInterval TRAIL_EVERY_MS 250): states =
//     cueRowStates({ pitchVoiced, pitchHolding, pitchLevel, snap,
//     workerStatus: "ready", hasRef: true }) from the latest props and snap;
//     trails createTrail() (pitch) and createTrail(RESONANCE_TRAIL.n 15,
//     RESONANCE_TRAIL.everyTicks 8) (resonance), each .tick(state,
//     rowValue(cue, inputs)); view = { snap, trails };
//   - a render (every state update / tick): the row state from the CURRENT
//     props and view.snap; thumb = dotOpacity(state) !== null and u != null;
//     the streak (CueColumn): ys = trail values through axisPos -> G.y,
//     anchor = the thumb's y (axisPos(u, { clamp: resonanceClamp(snap) }))
//     or the newest trail value's, drawn when max - min >= 3 px. G =
//     cueMeterGeometry.meterGeometry(w, h, false) at the 448 x 890 phone
//     (column 189 px, meter clamp(150, 74dvh - 285, 270) = 270 px) and at
//     360 x 690 (145 px, 225 px).
// Time shares are on the 25 ms chunk grid (every render point); trail and
// streak metrics at the ticks. Window: --from (20 s) to the end (150 s) for
// speech; the whole stream for noise only.
//
// Counterfactual (DIAGNOSTIC ONLY): the resonance row reads holding =
// pitchHolding OR (NOT pitchVoiced AND <= 5 s since the last render point
// whose pitchVoiced was true) — a 5 s row hold after the last shown voiced
// frame, whatever the pause floor; the pitch row is unchanged. It has its
// own trail (not cleared while the hold keeps the row out of "idle").
//
// Pauses: from the CLEAN condition's posted voicing (chain.mjs pitch cache,
// display-hop index = the chunk whose handling posted the message): maximal
// runs of chunks whose messages are all unvoiced, >= 12 chunks (0.3 s);
// classes 0.3-1 s, 1-5 s, >= 5 s; only pauses that start at or after --from.
// "Thumb disappears in a pause": a render point in [start, end + 10 chunks]
// (250 ms for the throttle / tick) without the resonance thumb.
// Pause floor = the real DSP worker's intensity at chunks whose 50 ms window
// lies inside the pause's audio span (frame centres = message contextTime
// - 40 ms, trimmed 25 ms each side).
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const CS = await import(pathToFileURL(path.join(repo, "src/components/cueStripModel.js")).href);
const GEO = await import(pathToFileURL(path.join(repo, "src/components/cueMeterGeometry.js")).href);
const VERD = ["silent", "warming", "score", "sustained", "pause", "stale"];
const STATES = ["starting", "restarting", "reload", "unavailable", "paused", "narrowband", "idle", "sustained", "warming", "settling", "holding", "live"];
const P_ = { k: 0, u: 2, raw: 3, shownStartU: 5, startU: 6, fill: 7, voicedS: 8, verdict: 9, since: 10, nbOn: 11, nbDec: 12 };
const runsDir = path.resolve(repo, arg("runs", "build/resonance-mobile/pause/runs"));
const hookDir = path.resolve(repo, arg("hook", "build/resonance-mobile/pause/hook"));
const FROM = Number(arg("from", "20"));
const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const med = (a) => q(a, 0.5);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

// ---- geometry (CueColumn): px per axis fraction, the 3 px streak threshold
const GEOS = {
  p448: GEO.meterGeometry(189, 270, false),
  p360: GEO.meterGeometry(145, 225, false),
};
const pxPerX = (G) => G.y(0) - G.y(1);
const U_SPAN = 2.2 - -1.0;

function loadJsonl(dir, re) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => re.test(f)).flatMap((f) => readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean)
    .flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }));
}

// ---- one stream: the strip over time, actual and counterfactual
export function stripReplay(hook, chainRec, { from = 0, cfHoldMs = 5000 } = {}) {
  const n = hook.n;
  const code = Buffer.from(hook.code, "base64");
  // throttled props per chunk
  const S = new Uint8Array(n), L = new Array(n).fill(null);
  let lastFire = -Infinity, cur = 0, curL = null;
  for (let k = 0; k < n; k++) {
    const tms = (k + 1) * 25;
    if (code[k] & 64 && tms - lastFire >= 200) { lastFire = tms; cur = code[k] & 63; curL = hook.level[k]; }
    S[k] = cur; L[k] = curL;
  }
  // snaps: post index active at chunk k (post made at the end of chunk p[0])
  const posts = chainRec.posts;
  const snapOf = (p) => (p ? {
    u: p[P_.u], raw: p[P_.raw], shownStartU: p[P_.shownStartU], startU: p[P_.startU], fill: p[P_.fill], voicedS: p[P_.voicedS],
    verdict: VERD[p[P_.verdict]], sinceResumeS: p[P_.since], narrowband: { on: !!p[P_.nbOn], decided: !!p[P_.nbDec] },
  } : null);
  const snapAt = new Array(n).fill(null);
  { let pi = -1; for (let k = 0; k < n; k++) { while (pi + 1 < posts.length && posts[pi + 1][P_.k] <= k) pi++; snapAt[k] = pi >= 0 ? pi : null; } }
  const snaps = posts.map(snapOf);
  const flags = (c) => ({ pitchVoiced: !!(c & 4), pitchHolding: !!(c & 8) });
  // per chunk: last shown-voiced render point (counterfactual)
  const lastV = new Float64Array(n).fill(-Infinity);
  { let lv = -Infinity; for (let k = 0; k < n; k++) { if (S[k] & 4) lv = (k + 1) * 25; lastV[k] = lv; } }
  const cfHolding = (k) => !!(S[k] & 8) || (!(S[k] & 4) && (k + 1) * 25 - lastV[k] <= cfHoldMs);

  const arms = {};
  for (const arm of ["act", "cf"]) {
    const holdingAt = arm === "act" ? (k) => !!(S[k] & 8) : cfHolding;
    const tr = { pitch: CS.createTrail(), resonance: CS.createTrail(CS.RESONANCE_TRAIL.n, CS.RESONANCE_TRAIL.everyTicks) };
    let view = { snap: null, trail: [], ptrail: [] };
    // grid series
    const rs = new Uint8Array(n), ps = new Uint8Array(n), thumb = new Uint8Array(n), thumbU = new Float64Array(n).fill(NaN);
    const ticks = []; // { t, rstate, trailLen, spanX, anchorX, drawable: {p448, p360}, u }
    let nextTick = 100 + 250; // ms: setInterval phase (arbitrary): 350, 600, ...
    for (let k = 0; k < n; k++) {
      const tms = (k + 1) * 25;
      // ticks due up to this chunk's time (state = this chunk's props if the tick is at/after it)
      while (nextTick <= tms) {
        // the latest chunk whose time <= tick
        const kk = Math.min(n - 1, Math.floor(nextTick / 25) - 1);
        const fl = { pitchVoiced: !!(S[kk] & 4), pitchHolding: holdingAt(kk), pitchLevel: L[kk] };
        const snap = snapAt[kk] != null ? snaps[snapAt[kk]] : null;
        const st = CS.cueRowStates({ ...fl, snap, workerStatus: "ready", hasRef: true });
        const pFlags = { ...fl, pitchHolding: !!(S[kk] & 8) }; // the pitch row never gets the counterfactual hold
        const stP = CS.cueRowStates({ ...pFlags, snap, workerStatus: "ready", hasRef: true }).pitch;
        const inputs = { ...fl, snap };
        const trail = tr.resonance.tick(st.resonance, CS.rowValue("resonance", inputs));
        const ptrail = tr.pitch.tick(stP, CS.rowValue("pitch", inputs));
        view = { snap, trail, ptrail };
        // the render right after the tick: the streak
        const dotOp = CS.dotOpacity(st.resonance);
        const val = CS.rowValue("resonance", inputs);
        const dotPos = dotOp !== null && val != null ? CS.axisPos("resonance", val, { clamp: CS.resonanceClamp(snap) }) : null;
        const xs = trail.map((v) => CS.axisPos("resonance", v)).filter(Boolean).map((p) => p.x);
        let spanX = null, drawable = { p448: false, p360: false };
        if (xs.length) {
          const anchor = dotPos ? dotPos.x : xs[xs.length - 1];
          spanX = Math.max(anchor, ...xs) - Math.min(anchor, ...xs);
          for (const [g, G] of Object.entries(GEOS)) drawable[g] = spanX * pxPerX(G) >= 3;
        }
        ticks.push({ t: nextTick / 1000, rstate: st.resonance, pstate: stP, trailLen: trail.length, ptrailLen: ptrail.length, spanX, drawable, thumbU: dotPos ? val : null });
        nextTick += 250;
      }
      // render point at this chunk: current props + view.snap
      const fl = { pitchVoiced: !!(S[k] & 4), pitchHolding: holdingAt(k), pitchLevel: L[k] };
      const st = CS.cueRowStates({ ...fl, snap: view.snap, workerStatus: "ready", hasRef: true });
      const stP = CS.cueRowStates({ ...fl, pitchHolding: !!(S[k] & 8), snap: view.snap, workerStatus: "ready", hasRef: true }).pitch;
      rs[k] = STATES.indexOf(st.resonance);
      ps[k] = stP === "idle" ? 0 : stP === "holding" ? 1 : 2;
      const val = view.snap?.u;
      if (CS.dotOpacity(st.resonance) !== null && val != null) { thumb[k] = 1; thumbU[k] = val; }
    }
    arms[arm] = { rs, ps, thumb, thumbU, ticks };
  }
  // per-frame (unthrottled) row state with the latest post per chunk — the
  // 2026-10-21 note's method (voice-gate-resonance.mjs --row: per 25 ms chunk)
  const perFrame = { notIdle: 0, warming: 0, dot: 0, n: 0, cfNotIdle: 0, cfWarming: 0, cfDot: 0 };
  let lvF = -Infinity;
  for (let k = 0; k < n; k++) {
    const c = code[k];
    const snap = snapAt[k] != null ? snaps[snapAt[k]] : null;
    if (c & 4) lvF = (k + 1) * 25;
    const st = CS.resonanceRowState({ workerStatus: "ready", snap, voiced: !!(c & 4), holding: !!(c & 8) });
    const cfH = !!(c & 8) || (!(c & 4) && (k + 1) * 25 - lvF <= cfHoldMs);
    const stC = CS.resonanceRowState({ workerStatus: "ready", snap, voiced: !!(c & 4), holding: cfH });
    perFrame.n++;
    if (st !== "idle" && st !== "starting") perFrame.notIdle++;
    if (st === "warming") perFrame.warming++;
    if (CS.dotOpacity(st) !== null && snap?.u != null) perFrame.dot++;
    if (stC !== "idle" && stC !== "starting") perFrame.cfNotIdle++;
    if (stC === "warming") perFrame.cfWarming++;
    if (CS.dotOpacity(stC) !== null && snap?.u != null) perFrame.cfDot++;
  }
  return { n, S, code, arms, perFrame, kFrom: Math.max(0, Math.round(from / 0.025) - 1) };
}

// ---- metrics over a window
function windowMetrics(R, arm, { kFrom, kTo }) {
  const A = R.arms[arm];
  let idle = 0, pIdle = 0, thumb = 0, entries = 0, nPts = 0, warming = 0, notIdle = 0;
  for (let k = kFrom; k < kTo; k++) {
    nPts++;
    const st = STATES[A.rs[k]];
    if (st === "idle") { idle++; if (k > kFrom && STATES[A.rs[k - 1]] !== "idle") entries++; }
    if (st !== "idle" && st !== "starting") notIdle++;
    if (st === "warming") warming++;
    if (A.ps[k] === 0) pIdle++;
    if (A.thumb[k]) thumb++;
  }
  const t0 = (kFrom + 1) * 0.025, t1 = kTo * 0.025;
  const tk = A.ticks.filter((x) => x.t >= t0 && x.t <= t1);
  const lens = tk.map((x) => x.trailLen);
  let clears = 0; for (let i = 1; i < tk.length; i++) if (tk[i - 1].trailLen > 0 && tk[i].trailLen === 0) clears++;
  const spans = tk.map((x) => (x.spanX == null ? 0 : x.spanX * U_SPAN));
  const spansDrawn = tk.filter((x) => x.drawable.p448).map((x) => x.spanX * U_SPAN);
  return {
    sec: nPts * 0.025,
    idlePct: (100 * idle) / nPts, notIdlePct: (100 * notIdle) / nPts, warmingPct: (100 * warming) / nPts,
    idlePerMin: entries / ((nPts * 0.025) / 60), pitchIdlePct: (100 * pIdle) / nPts, thumbPct: (100 * thumb) / nPts,
    trailMean: mean(lens), trailMed: med(lens), clearsPerMin: clears / ((tk.length * 0.25) / 60),
    spanMeanU: mean(spans), spanMeanDrawnU: mean(spansDrawn),
    streakPct448: (100 * tk.filter((x) => x.drawable.p448).length) / tk.length,
    streakPct360: (100 * tk.filter((x) => x.drawable.p360).length) / tk.length,
    ticks: tk.length,
  };
}

// ---- pauses from the clean condition's posted voicing
function pausesFromClean(byChunk) {
  const n = byChunk.length, out = [];
  let s = -1;
  for (let k = 0; k <= n; k++) {
    const unv = k < n && byChunk[k].length > 0 && byChunk[k].every((m) => !m[0]);
    const none = k < n && byChunk[k].length === 0;
    if (k < n && (unv || (none && s >= 0))) { if (s < 0) s = k; continue; }
    if (s >= 0 && k - s >= 12) out.push([s, k - 1]);
    s = -1;
  }
  return out;
}
// Per-frame (unthrottled) runs where the hook's gated flags are both false
// (both cue-strip rows "idle"), by cause (first match):
//   silence the silence gate is engaged on the run's first frame (the 5 s
//           silence hold ran out);
//   gate    raw voiced / holding true at the run's start but the gated flags
//           false (FireRedVAD "no voice", setting on);
//   onset   the run ends in a shown voiced frame and lasts <= 250 ms: speech
//           resumed, its first frames have no painted pitch yet (the pitch
//           message lags the DSP frame by the tracker's 2 hops, plus the paint
//           gate's onset confirmation), and the unpainted frames of the pause
//           — quiet ones included — already took the VOICED_FALL_FRAMES (16)
//           counter past 16, so displayHolding is false: an idle blink at the
//           start of an utterance, at ANY floor;
//   pause   the run lasts > 250 ms or ends back in a holding frame: the row
//           went idle INSIDE the pause — 16 unpainted non-quiet frames (after
//           the 400 ms pitch hold) while the silence gate is off: the floor
//           effect. "flick" = the subset that ends back in holding (the noise
//           dipped below -50 dBFS again: the silence hold re-arms).
export function idleRuns(code, { kFrom = 0, kTo = code.length } = {}) {
  const runs = [];
  let s = -1;
  for (let k = kFrom; k <= kTo; k++) {
    const idle = k < kTo && !(code[k] & 12);
    if (idle) { if (s < 0) s = k; continue; }
    if (s >= 0) {
      const c0 = code[s], next = k < kTo ? code[k] : 0, len = k - s;
      const cause = c0 & 32 ? "silence" : c0 & 3 ? "gate" : next & 4 && len <= 10 ? "onset" : "pause";
      runs.push({ a: s, b: k - 1, cause, flick: cause === "pause" && !!(next & 8) });
    }
    s = -1;
  }
  return runs;
}
function pauseMetrics(R, arm, pauses, { kFrom }) {
  const A = R.arms[arm];
  const runs = arm === "act" ? idleRuns(R.code, { kFrom: Math.max(1, kFrom - 400) }) : [];
  const mk = () => ({ n: 0, gone: 0, idle: 0, goneFrac: [], fall: 0, onset: 0 });
  const cls = { short: mk(), mid: mk(), long: mk() };
  for (const [a, b] of pauses) {
    if (a < kFrom || b + 10 >= R.n) continue;
    const d = (b - a + 1) * 0.025;
    const c = d < 1 ? cls.short : d < 5 ? cls.mid : cls.long;
    let gone = 0, idle = 0;
    for (let k = a; k <= b + 10; k++) { if (!A.thumb[k]) gone++; if (STATES[A.rs[k]] === "idle") idle++; }
    c.n++;
    if (gone) c.gone++;
    if (idle) c.idle++;
    c.goneFrac.push(gone / (b + 11 - a));
    // the hook's own per-frame cause (actual arm): a run starting inside the pause or at its end
    // in the pause: a "pause" run starting before the clean voicing resumes; at its end: an "onset" blink
    if (runs.some((r) => r.cause === "pause" && r.a >= a && r.a <= b)) c.fall++;
    if (runs.some((r) => r.cause === "onset" && r.a >= a && r.a <= b + 6)) c.onset++;
  }
  for (const c of Object.values(cls)) {
    c.gonePct = c.n ? (100 * c.gone) / c.n : null; c.idlePct = c.n ? (100 * c.idle) / c.n : null; c.goneTimePct = c.n ? 100 * mean(c.goneFrac) : null;
    c.fallPct = c.n ? (100 * c.fall) / c.n : null; c.onsetPct = c.n ? (100 * c.onset) / c.n : null;
    delete c.goneFrac;
  }
  return cls;
}
function pauseFloor(hook, cleanByChunk, pauses, { kFrom }) {
  const code = Buffer.from(hook.code, "base64");
  const v = [], quietIn = [0, 0];
  for (const [a, b] of pauses) {
    if (a < kFrom) continue;
    const ctA = cleanByChunk[a][0]?.[2], ctB = cleanByChunk[b][0]?.[2];
    if (ctA == null || ctB == null) continue;
    const A = (ctA - 0.04 + 0.025) * 1000, B = (ctB - 0.04 - 0.025) * 1000;
    for (let j = 0; j < hook.n; j++) {
      const e = (j + 1) * 25;
      if (e - 50 >= A && e <= B && hook.inten[j] != null) v.push(hook.inten[j] === -999 ? -Infinity : hook.inten[j]);
    }
    for (let k = a; k <= b; k++) { quietIn[1]++; if (code[k] & 32) quietIn[0]++; }
  }
  const s = [...v].sort((x, y) => x - y);
  return { medDb: s.length ? s[s.length >> 1] : null, q10: s.length ? s[Math.floor(0.1 * (s.length - 1))] : null, q90: s.length ? s[Math.floor(0.9 * (s.length - 1))] : null,
    n: s.length, quietPct: quietIn[1] ? (100 * quietIn[0]) / quietIn[1] : null };
}
// posted voicing inside the clean pauses (false voicing from the noise), and what the gate hid
function pauseVoicing(byChunk, pauses, { kFrom }) {
  let n = 0, v = 0, shownV = 0;
  for (const [a, b] of pauses) {
    if (a < kFrom) continue;
    for (let k = a; k <= b; k++) for (const m of byChunk[k] ?? []) { n++; if (m[0]) { v++; if (m[3] !== 0) shownV++; } }
  }
  return { n, voicedPct: n ? (100 * v) / n : null, voicedNotHiddenPct: n ? (100 * shownV) / n : null };
}

// ---- main
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const hooks = loadJsonl(hookDir, /^hook-.*\.jsonl$/);
  const chainBy = new Map();
  const conds = [...new Set(hooks.map((h) => h.cond))];
  for (const c of conds) for (const r of loadJsonl(path.join(runsDir, c), /^runs-.*\.jsonl$/)) if (r.gate === "on") chainBy.set(`${c}|${r.id}`, r);
  const cleanPitch = new Map();
  const cleanOf = (id) => {
    if (!cleanPitch.has(id)) {
      const f = path.join(runsDir, "clean", "pitch", `${id}.json`);
      cleanPitch.set(id, existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).byChunk : null);
    }
    return cleanPitch.get(id);
  };
  const rows = [];
  const checks = { hintMismatch: 0, hints: 0, levelSame: 0, streams: 0, uDiff: 0, uBoth: 0 };
  for (const h of hooks) {
    const cr = chainBy.get(`${h.cond}|${h.id}`);
    if (!cr) { console.error(`no chain record for ${h.cond} ${h.id}`); continue; }
    const pm = JSON.parse(readFileSync(path.join(runsDir, h.cond, "pitch", `${h.id}.json`), "utf8"));
    checks.streams++; checks.hints += h.hint.want; checks.hintMismatch += h.hint.mismatch; if (h.levelCheck.same) checks.levelSame++;
    const noiseOnly = h.kind === "ext";
    const R = stripReplay(h, cr, { from: noiseOnly ? 0 : FROM });
    const kFrom = noiseOnly ? 0 : R.kFrom, kTo = R.n;
    // the display path never changes u: where both arms draw a thumb, the same u
    for (let k = 0; k < R.n; k++) if (R.arms.act.thumb[k] && R.arms.cf.thumb[k]) { checks.uBoth++; if (R.arms.act.thumbU[k] !== R.arms.cf.thumbU[k]) checks.uDiff++; }
    const fam = h.cond === "clean" ? "clean" : h.cond.replace(/^N-/, "").split("_")[0];
    const floor = h.cond === "clean" ? null : -Number(h.cond.split("_m")[1]);
    const row = { cond: h.cond, fam, floor, noiseOnly, id: h.id, reader: h.reader, sex: h.sex,
      act: windowMetrics(R, "act", { kFrom, kTo }), cf: windowMetrics(R, "cf", { kFrom, kTo }),
      perFrame: Object.fromEntries(["notIdle", "warming", "dot", "cfNotIdle", "cfWarming", "cfDot"].map((k) => [`${k}Pct`, (100 * R.perFrame[k]) / R.perFrame.n])),
      voicedHopRmsMedDb: cr.level?.voicedHopRmsMedDb ?? null, pitchStats: cr.pitchStats };
    // whole-stream, skeptic-style (ticks from 0.25 s): idle %, entries/min, mean trail over non-idle ticks after first voice, ticks with >= 2 trail points
    for (const arm of ["act", "cf"]) {
      const tk = R.arms[arm].ticks;
      let idle = 0, ent = 0, prev = true, seenV = false, tr = [], two = 0;
      for (const x of tk) {
        const isIdle = x.rstate === "idle";
        if (isIdle) { idle++; if (!prev) ent++; }
        prev = isIdle;
        if (x.rstate === "live") seenV = true;
        if (!isIdle && seenV) { tr.push(x.trailLen); if (x.trailLen >= 2) two++; }
      }
      row[arm].skeptic = { idlePct: (100 * idle) / tk.length, idlePerMin: ent / (tk.length * 0.25 / 60), meanTrail: mean(tr), twoPct: tr.length ? (100 * two) / tr.length : null };
    }
    {
      const runs = idleRuns(R.code, { kFrom: Math.max(1, kFrom), kTo });
      const min = ((kTo - kFrom) * 0.025) / 60;
      row.causes = Object.fromEntries(["onset", "pause", "flick", "gate", "silence"].map((c) => {
        const rr = runs.filter((r) => (c === "flick" ? r.flick : r.cause === c));
        const fr = rr.reduce((a, r) => a + r.b - r.a + 1, 0);
        return [c, { perMin: rr.length / min, pct: (100 * fr) / (kTo - kFrom), meanMs: rr.length ? (fr * 25) / rr.length : null }];
      }));
    }
    if (!noiseOnly) {
      const cb = cleanOf(h.id);
      if (cb) {
        const pauses = pausesFromClean(cb);
        row.pauses = { count: pauses.filter(([a]) => a >= kFrom).length, act: pauseMetrics(R, "act", pauses, { kFrom }), cf: pauseMetrics(R, "cf", pauses, { kFrom }) };
        row.floorMeas = pauseFloor(h, cb, pauses, { kFrom });
        row.pauseVoicing = pauseVoicing(pm.byChunk, pauses, { kFrom });
      }
    } else {
      const v = h.inten.filter((x) => x != null).map((x) => (x === -999 ? -Infinity : x)).sort((a, b) => a - b);
      const code = Buffer.from(h.code, "base64");
      let qn = 0; for (const c of code) if (c & 32) qn++;
      row.floorMeas = { medDb: v[v.length >> 1], q10: v[Math.floor(0.1 * (v.length - 1))], q90: v[Math.floor(0.9 * (v.length - 1))], n: v.length, quietPct: (100 * qn) / code.length };
      row.noiseVoicing = { voicedPct: (100 * cr.pitchStats.voiced) / cr.pitchStats.hops, shownPct: (100 * (cr.pitchStats.voiced - cr.pitchStats.hidden)) / cr.pitchStats.hops };
    }
    rows.push(row);
  }
  const out = path.resolve(repo, arg("json", "build/resonance-mobile/pause/summary.json"));
  writeFileSync(out, JSON.stringify({ from: FROM, geos: Object.fromEntries(Object.entries(GEOS).map(([k, G]) => [k, { pxPerU: pxPerX(G) / U_SPAN, minSpanU: 3 / (pxPerX(G) / U_SPAN) }])), checks, rows }, null, 1));
  console.log(`checks: ${JSON.stringify(checks)}`);
  console.log(`wrote ${rows.length} rows -> ${out}`);
  const md = tables(rows, checks);
  console.log(md);
  if (arg("md", "")) writeFileSync(path.resolve(repo, arg("md", "")), md);
}

// ---- tables: median [q25-q75] over readers
function tables(rows, checks) {
  const f1 = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));
  const cell = (vals, d = 1) => { const v = vals.filter((x) => x != null && Number.isFinite(x)); if (!v.length) return "—"; return `${f1(med(v), d)} [${f1(q(v, 0.25), d)}–${f1(q(v, 0.75), d)}]`; };
  const medOnly = (vals, d = 1) => f1(med(vals.filter((x) => x != null && Number.isFinite(x))), d);
  const ORDER = [null, -70, -60, -55, -52, -50, -48, -45, -40];
  const fams = ["brown", "pink", "ac"];
  const lines = [];
  const groups = (noiseOnly) => {
    const g = [];
    for (const fam of noiseOnly ? fams : ["clean", ...fams]) for (const fl of ORDER) {
      if ((fam === "clean") !== (fl === null)) continue;
      const r = rows.filter((x) => x.noiseOnly === noiseOnly && x.fam === fam && x.floor === fl);
      if (r.length) g.push({ fam, fl, r });
    }
    return g;
  };
  const name = (fam, fl) => (fam === "clean" ? "no noise (desktop-like)" : `${fam === "ac" ? "real AC" : fam} ${fl}`);
  const SEX = [["m", "men"], ["f", "women"], [null, "all"]];
  lines.push(`checks: streams ${checks.streams}, rebuilt audio identical ${checks.levelSame}/${checks.streams}, hook hints = runner hints ${checks.hints - checks.hintMismatch}/${checks.hints}, thumb u act vs counterfactual differing ${checks.uDiff}/${checks.uBoth}`);
  lines.push("");
  // ---- the dose-response at a glance (all 12 readers) and the threshold
  lines.push("### 0. Dose-response at a glance — speech, all 12 readers, medians (actual display; cf = counterfactual 5 s row hold)");
  lines.push("");
  lines.push("| noise, target floor | pause floor (DSP) | silence gate on in pauses % | row idle % | idle entries/min | thumb shown % | in-pause idle runs/min | onset blinks/min | trail clears/min | trail pts mean | ticks with streak % | 1–5 s pauses: row idle inside % | cf: row idle % | cf: trail pts mean | cf: ticks with streak % |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const thr = {};
  for (const { fam, fl, r } of groups(false)) {
    const M_ = (f) => medOnly(r.map(f));
    lines.push(`| ${name(fam, fl)} | ${M_((x) => x.floorMeas?.medDb)} | ${M_((x) => x.floorMeas?.quietPct)} | ${M_((x) => x.act.idlePct)} | ${M_((x) => x.act.idlePerMin)} | ${M_((x) => x.act.thumbPct)} | ${M_((x) => x.causes?.pause?.perMin)} | ${M_((x) => x.causes?.onset?.perMin)} | ${M_((x) => x.act.clearsPerMin)} | ${M_((x) => x.act.trailMean)} | ${M_((x) => x.act.streakPct448)} | ${medOnly(r.filter((x) => x.pauses).map((x) => x.pauses.act.mid.fallPct))} | ${M_((x) => x.cf.idlePct)} | ${M_((x) => x.cf.trailMean)} | ${M_((x) => x.cf.streakPct448)} |`);
    if (fam !== "clean") (thr[fam] ??= []).push({ floor: med(r.map((x) => x.floorMeas?.medDb)), idle: med(r.map((x) => x.act.idlePct)), quiet: med(r.map((x) => x.floorMeas?.quietPct)) });
  }
  lines.push("");
  const cleanIdle = med(rows.filter((x) => x.fam === "clean" && !x.noiseOnly).map((x) => x.act.idlePct));
  for (const [fam, pts] of Object.entries(thr)) {
    pts.sort((a, b) => a.floor - b.floor);
    const hi = med(pts.filter((p) => p.floor > -49).map((p) => p.idle));
    const cross = (lvl, key = "idle", rising = true) => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (rising ? a[key] < lvl && b[key] >= lvl : a[key] > lvl && b[key] <= lvl) return a.floor + ((lvl - a[key]) / (b[key] - a[key])) * (b.floor - a.floor);
      }
      return null;
    };
    const step = hi - cleanIdle;
    lines.push(`threshold ${fam}: row idle ${f1(cleanIdle)} % (no noise) -> plateau ${f1(hi)} % (floors > -49 dBFS); 10 / 50 / 90 % of the step at a measured pause floor of ${f1(cross(cleanIdle + 0.1 * step))} / ${f1(cross(cleanIdle + 0.5 * step))} / ${f1(cross(cleanIdle + 0.9 * step))} dBFS; silence gate on in pauses falls through 50 % of its no-noise share at ${f1(cross(pts[0].quiet / 2, "quiet", false))} dBFS`);
  }
  lines.push("");
  lines.push(`### A. Speech (12 readers, ${FROM}-150 s), actual display — median [IQR] over readers`);
  lines.push("");
  lines.push("| noise, target floor | sex | n | pause floor (DSP, dBFS) | silence gate on in pauses % | posted voiced in pauses (shown) % | row idle % | idle entries / min | thumb shown % | trail clears / min | trail pts mean | trail pts median | streak span mean (u) | ticks with streak % (448×890) | (360×690) | pitch row idle % |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { fam, fl, r } of groups(false)) for (const [sx, sl] of SEX) {
    const rr = sx ? r.filter((x) => x.sex === sx) : r;
    lines.push(`| ${name(fam, fl)} | ${sl} | ${rr.length} | ${cell(rr.map((x) => x.floorMeas?.medDb))} | ${cell(rr.map((x) => x.floorMeas?.quietPct))} | ${cell(rr.map((x) => x.pauseVoicing?.voicedNotHiddenPct))} | ${cell(rr.map((x) => x.act.idlePct))} | ${cell(rr.map((x) => x.act.idlePerMin))} | ${cell(rr.map((x) => x.act.thumbPct))} | ${cell(rr.map((x) => x.act.clearsPerMin))} | ${cell(rr.map((x) => x.act.trailMean))} | ${cell(rr.map((x) => x.act.trailMed))} | ${cell(rr.map((x) => x.act.spanMeanU), 2)} | ${cell(rr.map((x) => x.act.streakPct448))} | ${cell(rr.map((x) => x.act.streakPct360))} | ${cell(rr.map((x) => x.act.pitchIdlePct))} |`);
  }
  lines.push("");
  lines.push(`### B. Pauses (from the clean run's posted voicing, >= 0.3 s, starting >= ${FROM} s): pauses in which the resonance thumb disappears (any render point, pause + 250 ms) — % of pauses, median [IQR] over readers; pooled counts`);
  lines.push("");
  lines.push("| noise, target floor | sex | 0.3–1 s: thumb gone % | row idle % | thumb-absent time % | 1–5 s: thumb gone % | row idle % | thumb-absent time % | >= 5 s: n | pauses pooled (0.3–1 / 1–5 / >= 5 s) | pooled thumb gone 0.3–1 / 1–5 s |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { fam, fl, r } of groups(false)) for (const [sx, sl] of SEX) {
    const rr = (sx ? r.filter((x) => x.sex === sx) : r).filter((x) => x.pauses);
    const P = (c, k) => rr.map((x) => x.pauses.act[c][k]);
    const sum = (c, k) => rr.reduce((a, x) => a + (x.pauses.act[c][k] ?? 0), 0);
    const pooled = (c) => { const nn = sum(c, "n"); return nn ? f1((100 * sum(c, "gone")) / nn) : "—"; };
    lines.push(`| ${name(fam, fl)} | ${sl} | ${cell(P("short", "gonePct"))} | ${cell(P("short", "idlePct"))} | ${cell(P("short", "goneTimePct"))} | ${cell(P("mid", "gonePct"))} | ${cell(P("mid", "idlePct"))} | ${cell(P("mid", "goneTimePct"))} | ${sum("long", "n")} | ${sum("short", "n")} / ${sum("mid", "n")} / ${sum("long", "n")} | ${pooled("short")} / ${pooled("mid")} |`);
  }
  lines.push("");
  lines.push("### B2. Why the rows go idle — per-frame runs of the hook's gated flags both false (before the 200 ms throttle), by cause; runs / min and % of time, median [IQR] over readers");
  lines.push("");
  lines.push("onset = an idle blink <= 250 ms that ends when the resumed speech paints (its first frames are unpainted and VOICED_FALL already expired in the pause, quiet frames included) — at any floor; pause = the row went idle inside the pause (16 unpainted non-quiet frames after the 400 ms pitch hold, silence gate off) — the floor effect; flick = pause runs that end back in holding (the silence hold re-armed); gate = the voice gate hid a voiced / holding display; silence = the 5 s silence hold ran out.");
  lines.push("");
  lines.push("| noise, target floor | sex | onset runs/min | onset % time | onset mean ms | pause runs/min | pause % time | pause mean ms | of which flick runs/min | gate runs/min | gate % time | silence % time | pauses 0.3–1 s: idle inside % | onset blink % | pauses 1–5 s: idle inside % | onset blink % |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { fam, fl, r } of groups(false)) for (const [sx, sl] of SEX) {
    const rr = sx ? r.filter((x) => x.sex === sx) : r;
    const C = (c, k) => rr.map((x) => x.causes?.[c]?.[k]);
    const Pp = (c, k) => rr.filter((x) => x.pauses).map((x) => x.pauses.act[c][k]);
    lines.push(`| ${name(fam, fl)} | ${sl} | ${cell(C("onset", "perMin"))} | ${cell(C("onset", "pct"))} | ${medOnly(C("onset", "meanMs"), 0)} | ${cell(C("pause", "perMin"))} | ${cell(C("pause", "pct"))} | ${medOnly(C("pause", "meanMs"), 0)} | ${cell(C("flick", "perMin"))} | ${cell(C("gate", "perMin"))} | ${cell(C("gate", "pct"))} | ${cell(C("silence", "pct"))} | ${cell(Pp("short", "fallPct"))} | ${cell(Pp("short", "onsetPct"))} | ${cell(Pp("mid", "fallPct"))} | ${cell(Pp("mid", "onsetPct"))} |`);
  }
  lines.push("");
  lines.push("### C. Counterfactual (diagnostic only): resonance row holds 5 s after the last shown voiced frame — speech, same window");
  lines.push("");
  lines.push("| noise, target floor | sex | row idle % | idle entries / min | thumb shown % | trail clears / min | trail pts mean | trail pts median | streak span mean (u) | ticks with streak % (448×890) | pauses 0.3–1 s thumb gone % | 1–5 s thumb gone % |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { fam, fl, r } of groups(false)) for (const [sx, sl] of SEX) {
    const rr = sx ? r.filter((x) => x.sex === sx) : r;
    lines.push(`| ${name(fam, fl)} | ${sl} | ${cell(rr.map((x) => x.cf.idlePct))} | ${cell(rr.map((x) => x.cf.idlePerMin))} | ${cell(rr.map((x) => x.cf.thumbPct))} | ${cell(rr.map((x) => x.cf.clearsPerMin))} | ${cell(rr.map((x) => x.cf.trailMean))} | ${cell(rr.map((x) => x.cf.trailMed))} | ${cell(rr.map((x) => x.cf.spanMeanU), 2)} | ${cell(rr.map((x) => x.cf.streakPct448))} | ${cell(rr.filter((x) => x.pauses).map((x) => x.pauses.cf.short.gonePct))} | ${cell(rr.filter((x) => x.pauses).map((x) => x.pauses.cf.mid.gonePct))} |`);
  }
  lines.push("");
  lines.push("### D. Noise only (150 s, no speech): one stream per family and floor");
  lines.push("");
  lines.push("| noise, target floor | DSP intensity median [q10–q90] | silence gate on % | posted voiced % | shown voiced (gate) % | row not idle, rendered: actual | counterfactual | per frame (2026-10-21 method): actual | counterfactual | 'keep talking…' act / cf | thumb drawn act / cf |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { fam, fl, r } of groups(true)) for (const x of r) {
    lines.push(`| ${name(fam, fl)} | ${f1(x.floorMeas.medDb)} [${f1(x.floorMeas.q10)}–${f1(x.floorMeas.q90)}] | ${f1(x.floorMeas.quietPct)} | ${f1(x.noiseVoicing.voicedPct)} | ${f1(x.noiseVoicing.shownPct)} | ${f1(x.act.notIdlePct)} | ${f1(x.cf.notIdlePct)} | ${f1(x.perFrame.notIdlePct)} | ${f1(x.perFrame.cfNotIdlePct)} | ${f1(x.act.warmingPct)} / ${f1(x.cf.warmingPct)} | ${f1(x.act.thumbPct)} / ${f1(x.cf.thumbPct)} |`);
  }
  lines.push("");
  lines.push("### E. Skeptic-style whole-stream numbers (ticks from 0.25 s; trail over non-idle ticks after the first live tick) — median over readers");
  lines.push("");
  lines.push("| noise, target floor | sex | idle % act | idle entries/min act | mean trail act | ticks trail >= 2 % act | idle % cf | mean trail cf | ticks trail >= 2 % cf |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const { fam, fl, r } of groups(false)) for (const [sx, sl] of SEX) {
    const rr = sx ? r.filter((x) => x.sex === sx) : r;
    lines.push(`| ${name(fam, fl)} | ${sl} | ${medOnly(rr.map((x) => x.act.skeptic.idlePct))} | ${medOnly(rr.map((x) => x.act.skeptic.idlePerMin))} | ${medOnly(rr.map((x) => x.act.skeptic.meanTrail))} | ${medOnly(rr.map((x) => x.act.skeptic.twoPct))} | ${medOnly(rr.map((x) => x.cf.skeptic.idlePct))} | ${medOnly(rr.map((x) => x.cf.skeptic.meanTrail))} | ${medOnly(rr.map((x) => x.cf.skeptic.twoPct))} |`);
  }
  return lines.join(String.fromCharCode(10));
}
